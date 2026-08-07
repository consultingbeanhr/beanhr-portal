"""
AI Search Route  —  POST /api/ai/search

Flask endpoint that accepts plain-English HR questions from the Super Admin,
uses Gemini 2.0 Flash with function calling to translate them into safe
Firestore queries, executes those queries, and returns a natural-language
answer alongside the raw structured data for the frontend to render.

Architecture overview:
  1. Verify Firebase token + super_admin role
  2. Rate-limit (30 req / min per UID, in-memory)
  3. Call Gemini with the full HR schema as system prompt + 3 tool schemas
  4. If Gemini calls a tool → validate params against whitelist → execute safely
  5. Feed raw results back to Gemini → get natural-language answer
  6. Return { answer, results, result_type } + log to aiSearchLogs
"""
import json
import os
import threading
import time
import tempfile
from collections import defaultdict
from datetime import datetime

import google.generativeai as genai
from flask import Blueprint, g, jsonify, request
from google.generativeai import protos

from backend.services.firebase_service import get_db
from backend.utils.auth_helpers import require_auth, require_super_admin

ai_bp = Blueprint('ai', __name__)

# ───────────────────────────────────────────────────────────────────────────────
# Rate limiter (in-memory, per UID)
# ───────────────────────────────────────────────────────────────────────────────
_rl_lock   = threading.Lock()
_rl_times  = defaultdict(list)
RL_WINDOW  = 60   # seconds
RL_MAX     = 30   # requests per window


def _check_rate_limit(uid: str) -> bool:
    now = time.monotonic()
    with _rl_lock:
        _rl_times[uid] = [t for t in _rl_times[uid] if now - t < RL_WINDOW]
        if len(_rl_times[uid]) >= RL_MAX:
            return False
        _rl_times[uid].append(now)
        return True


# ───────────────────────────────────────────────────────────────────────────────
# Field whitelists per collection  (security: Gemini cannot query unknown fields)
# ───────────────────────────────────────────────────────────────────────────────
ALLOWED_FIELDS: dict[str, set[str]] = {
    'employees': {
        'accountId', 'employeeCode', 'fullName', 'email', 'phone',
        'designation', 'department', 'companyTag', 'managerId',
        'employmentStatus', 'employmentType', 'joiningDate',
        'resignationDate', 'noticePeriodDays', 'noticePeriodEndDate',
        'extractedResumeTags', 'address', 'createdAt', 'updatedAt',
        'baseSalary', 'promotedAt', 'promotedBy',
    },
    'leaveRequests': {
        'employeeId', 'leaveType', 'startDate', 'endDate', 'reason',
        'backdated', 'status', 'docRequestedBy', 'docRequestedById',
        'docRequestMessage', 'docRespondedAt', 'createdAt',
    },
    'payrollRecords': {
        'employeeId', 'month', 'baseSalary', 'bonus', 'deductions',
        'netSalary', 'employmentType', 'totalWorkingDays', 'calendarDays',
        'dailyRate', 'status', 'paymentId', 'issuedAt', 'paidAt',
        'generatedByJobAt', 'createdAt',
    },
    'salaryAdvanceRequests': {
        'employeeId', 'amount', 'reason', 'status',
        'disbursedBy', 'disbursedAt', 'createdAt',
    },
    'resignationRequests': {
        'employeeId', 'managerId', 'reason', 'lastWorkingDate',
        'noticePeriodDays', 'status', 'settlementAmount', 'createdAt',
    },
    'attendanceLogs': {
        'employeeId', 'date', 'status', 'checkInTime', 'checkOutTime',
        'workHours', 'isLate', 'isEarlyCheckout', 'createdAt',
    },
    'leaveBalances': {
        'employeeId', 'sick', 'casual', 'paid',
        'sickUsed', 'casualUsed', 'paidUsed',
        'sickRemaining', 'casualRemaining', 'paidRemaining', 'updatedAt',
    },
    'bonusProposals': {
        'employeeId', 'month', 'amount', 'reason', 'status',
        'addedBy', 'approvedBy', 'createdAt', 'updatedAt',
    },
    'hiringRequests': {
        'proposedByManagerId', 'jobTitle', 'department', 'reason',
        'urgency', 'status', 'createdAt',
    },
    'attendanceStats': {
        'employeeId', 'totalPresent', 'totalAbsent', 'totalLate',
        'totalLeave', 'updatedAt',
    },
    'payslips': {
        'employeeId', 'month', 'payrollRecordId', 'issuedAt', 'generatedAt',
    },
    'payments': {
        'employeeId', 'payrollId', 'amount', 'gateway',
        'transactionId', 'status', 'paidAt', 'createdAt',
    },
    'auditLogs': {
        'actorAccountId', 'action', 'targetCollection',
        'targetDocId', 'ipAddress', 'createdAt',
    },
    'sessionLogs': {
        'employeeId', 'accountId', 'role', 'loginAt',
        'logoutAt', 'duration', 'ipAddress', 'device', 'createdAt',
    },
    'holidays': {
        'name', 'date', 'type', 'createdAt',
    },
    'documents': {
        'employeeId', 'documentId', 'docType', 'fileName', 'fileSize',
        'status', 'uploadedAt', 'requestedAt', 'fileUrl', 'uploadedFileUrl',
        'documentLabel', 'decidedAt', 'managerComment',
    },
    'employeeDocuments': {
        'employeeId', 'documentId', 'docType', 'fileName', 'fileSize',
        'status', 'uploadedAt', 'requestedAt', 'fileUrl', 'uploadedFileUrl',
        'documentLabel', 'decidedAt', 'managerComment',
    },
    'accounts': {
        'role', 'email', 'status', 'employeeId', 'isActive',
        'passwordResetRequired', 'forcePasswordChange', 'createdAt',
    },
    'candidateProfiles': {
        'accountId', 'fullName', 'email', 'phone', 'designation', 'department',
        'currentStage', 'offerLetterStatus', 'companyDecision',
        'assignedManagerIds', 'assignedManagerNames', 'docsRequested',
        'docsVerified', 'roundsCount', 'latestRoundName', 'latestRoundStatus',
        'createdAt', 'submittedAt', 'portalCredentialsExpiresAt', 'joiningDate',
        'holdDetails',
    },
    'candidates': {
        'accountId', 'fullName', 'email', 'phone', 'designation', 'department',
        'currentStage', 'offerLetterStatus', 'companyDecision',
        'assignedManagerIds', 'assignedManagerNames', 'docsRequested',
        'docsVerified', 'roundsCount', 'latestRoundName', 'latestRoundStatus',
        'createdAt', 'submittedAt', 'portalCredentialsExpiresAt', 'joiningDate',
        'holdDetails', 'hiringRounds', 'offerDetails', 'documents', 'candidateId',
    },
    'candidateDocuments': {
        'candidateId', 'docId', 'documentLabel', 'status', 'requestedBy',
        'requestedAt', 'adminComment', 'fileUrl', 'uploadedFileUrl',
    },
    'hiringProposals': {
        'proposedByManagerId', 'jobTitle', 'department', 'reason',
        'urgency', 'status', 'createdAt',
    },
    'removalProposals': {
        'employeeId', 'managerId', 'reason', 'status', 'createdAt', 'adminReason', 'resolvedAt',
    },
    'attendanceSettings': {
        'windowStart', 'windowEnd', 'checkoutWindowStart', 'checkoutWindowEnd', 'tomorrowOverride',
    },
    'workingCalendar': {
        'overrides',
    },
    'leaveQuotaSettings': {
        'sick', 'casual', 'paid',
    },
    'notifications': {
        'recipientAccountId', 'title', 'message', 'read', 'timestamp', 'createdAt',
    },
    'portalSettings': {
        'minutes',
    },
}

ALLOWED_OPERATORS = {'==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains'}

# Fields that should be cast to numbers
_NUMERIC_FIELDS = {
    'amount', 'baseSalary', 'salary', 'netSalary', 'bonus', 'deductions',
    'dailyRate', 'settlementAmount', 'workHours', 'totalWorkingDays',
    'calendarDays', 'noticePeriodDays', 'sick', 'casual', 'paid',
    'sickUsed', 'casualUsed', 'paidUsed',
    'sickRemaining', 'casualRemaining', 'paidRemaining',
    'totalPresent', 'totalAbsent', 'totalLate', 'totalLeave', 'duration',
}

# Fields that should be cast to bool
_BOOL_FIELDS = {'backdated', 'isLate', 'isEarlyCheckout'}


def _coerce_value(field: str, value):
    """Cast string filter values to the appropriate Python type."""
    if field in _BOOL_FIELDS:
        return str(value).lower() in ('true', '1', 'yes')
    if field in _NUMERIC_FIELDS:
        try:
            return float(value) if '.' in str(value) else int(value)
        except (ValueError, TypeError):
            return value
    # 'in' operator — value may already be a list
    if isinstance(value, list):
        return value
    return str(value)


# ───────────────────────────────────────────────────────────────────────────────
# Firestore query executor
# ───────────────────────────────────────────────────────────────────────────────
def _execute_query(
    db,
    collection: str,
    filters: list | None = None,
    order_by: str | None = None,
    order_direction: str = 'asc',
    limit: int = 50,
) -> list[dict]:
    """Build and execute a safe Firestore query. Returns list of dicts."""
    if collection == 'documents':
        collection = 'employeeDocuments'

    if collection not in ALLOWED_FIELDS:
        raise ValueError(f"Collection '{collection}' is not accessible via AI Search")

    query = db.collection(collection)

    if filters:
        for f in (filters or []):
            field    = f.get('field', '')
            operator = f.get('operator', '')
            value    = f.get('value')

            if field not in ALLOWED_FIELDS[collection]:
                raise ValueError(f"Field '{field}' is not allowed in '{collection}'")
            if operator not in ALLOWED_OPERATORS:
                raise ValueError(f"Operator '{operator}' is not allowed")

            value = _coerce_value(field, value)
            from google.cloud.firestore_v1 import FieldFilter
            query = query.where(filter=FieldFilter(field, operator, value))

    if order_by:
        if order_by not in ALLOWED_FIELDS[collection]:
            raise ValueError(f"Order field '{order_by}' not allowed in '{collection}'")
        from google.cloud.firestore_v1.base_query import Query
        direction = Query.DESCENDING if order_direction == 'desc' else Query.ASCENDING
        query = query.order_by(order_by, direction=direction)

    limit = min(int(limit or 50), 200)
    docs  = query.limit(limit).stream()

    results = []
    for doc in docs:
        data       = doc.to_dict() or {}
        data['id'] = doc.id
        # Convert Firestore timestamps to ISO strings so they can be JSON-serialised
        for k, v in data.items():
            if hasattr(v, 'isoformat'):
                data[k] = v.isoformat()
        results.append(data)

    return results


def _execute_aggregate(
    db,
    collection: str,
    group_by: str,
    aggregate_function: str,
    aggregate_field: str | None = None,
    filters: list | None = None,
    chart_type: str = 'bar',
    chart_title: str | None = None,
    limit: int = 15,
) -> dict:
    """Fetch documents, group by a field, aggregate, and return Chart.js-shaped data."""
    if collection == 'documents':
        collection = 'employeeDocuments'

    # Validate group_by and aggregate_field
    allowed = ALLOWED_FIELDS.get(collection, set())
    if group_by not in allowed:
        raise ValueError(f"group_by field '{group_by}' not allowed in '{collection}'")
    if aggregate_field and aggregate_field not in allowed:
        raise ValueError(f"aggregate_field '{aggregate_field}' not allowed in '{collection}'")

    docs = _execute_query(db, collection, filters=filters, limit=1000)

    groups: dict[str, list] = defaultdict(list)
    for doc in docs:
        key = doc.get(group_by)
        groups[str(key) if key is not None else 'Unknown'].append(doc)

    # Sort by value descending; cap at limit
    agg_fn = aggregate_function.lower()
    items = []
    for label, group_docs in groups.items():
        if agg_fn == 'count':
            val = len(group_docs)
        elif agg_fn == 'sum':
            val = sum(float(d.get(aggregate_field, 0) or 0) for d in group_docs)
        elif agg_fn == 'avg':
            vals = [float(d.get(aggregate_field, 0) or 0) for d in group_docs]
            val  = sum(vals) / len(vals) if vals else 0
        elif agg_fn == 'min':
            vals = [float(d.get(aggregate_field, 0) or 0) for d in group_docs]
            val  = min(vals) if vals else 0
        elif agg_fn == 'max':
            vals = [float(d.get(aggregate_field, 0) or 0) for d in group_docs]
            val  = max(vals) if vals else 0
        else:
            raise ValueError(f"aggregate_function '{agg_fn}' not supported")
        items.append((label, round(val, 2)))

    items.sort(key=lambda x: x[1], reverse=True)
    items = items[:limit]

    labels = [i[0] for i in items]
    values = [i[1] for i in items]

    if not chart_title:
        agg_label  = aggregate_field or 'count'
        chart_title = f"{agg_fn.capitalize()} of {agg_label} by {group_by}"

    return {
        'chart_type': chart_type or 'bar',
        'title':      chart_title,
        'labels':     labels,
        'datasets':   [{'label': chart_title, 'data': values}],
    }


def _execute_join(
    db,
    primary_collection: str,
    join_collection: str,
    join_on_primary: str,
    join_on_secondary: str,
    primary_filters: list | None = None,
    secondary_filters: list | None = None,
    limit: int = 50,
) -> list[dict]:
    """Simple two-collection join: fetch primary docs, then query secondary by FK."""
    if primary_collection == 'documents':
        primary_collection = 'employeeDocuments'
    if join_collection == 'documents':
        join_collection = 'employeeDocuments'
    primary_docs = _execute_query(db, primary_collection, filters=primary_filters, limit=limit)
    if not primary_docs:
        return []

    pk_values = list({doc.get(join_on_primary, doc.get('id')) for doc in primary_docs if doc.get(join_on_primary) or doc.get('id')})
    pk_values = pk_values[:30]  # Firestore 'in' operator limit

    secondary_filters = list(secondary_filters or [])
    secondary_filters.append({'field': join_on_secondary, 'operator': 'in', 'value': pk_values})
    secondary_docs = _execute_query(db, join_collection, filters=secondary_filters, limit=limit * 3)

    # Index secondary by join key
    secondary_by_pk: dict[str, list] = defaultdict(list)
    for doc in secondary_docs:
        key = doc.get(join_on_secondary)
        if key:
            secondary_by_pk[key].append(doc)

    # Merge
    merged = []
    for pdoc in primary_docs:
        pk  = pdoc.get(join_on_primary, pdoc.get('id'))
        for sdoc in secondary_by_pk.get(pk, [{}]):
            merged.append({**pdoc, '_joined': sdoc})

    return merged[:limit]


def _read_storage_document(file_url: str) -> dict:
    """Download any document from Firebase Storage and extract its text.

    Supports: PDF, DOCX, DOC, images (JPG/PNG), plain text.
    Strategy 1 — Gemini inline base64 (handles all formats natively).
    Strategy 2 — pypdf (PDF fallback if Gemini fails).
    Strategy 3 — python-docx (DOCX fallback if Gemini fails).
    """
    import urllib.parse, base64, os as _os

    # ── MIME type map by extension ─────────────────────────────────────────────
    MIME_MAP = {
        '.pdf':  'application/pdf',
        '.doc':  'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt':  'text/plain',
        '.rtf':  'application/rtf',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
    }

    try:
        from backend.services.firebase_service import get_storage_bucket
        bucket = get_storage_bucket()

        # ── Resolve Storage path ───────────────────────────────────────────────
        path = file_url
        if path.startswith('gs://'):
            path = path.split('/', 3)[-1]
        elif 'firebasestorage.googleapis.com' in path:
            try:
                parsed = urllib.parse.urlparse(path)
                if '/o/' in parsed.path:
                    path = parsed.path.split('/o/', 1)[-1]
                    path = urllib.parse.unquote(path)
                    path = path.split('?')[0]   # strip ?alt=media&token=...
            except Exception:
                pass

        print(f'[read_doc] resolved storage path: {path!r}')

        # ── Detect file type ───────────────────────────────────────────────────
        ext = _os.path.splitext(path)[-1].lower()
        mime_type = MIME_MAP.get(ext, 'application/pdf')  # default to PDF
        print(f'[read_doc] detected ext={ext!r} mime_type={mime_type!r}')

        blob = bucket.blob(path)
        if not blob.exists():
            return {'error': f'File not found in Storage at path: {path}'}

        # ── Download file bytes ────────────────────────────────────────────────
        file_bytes = blob.download_as_bytes()
        print(f'[read_doc] downloaded {len(file_bytes)} bytes')

        # ── Strategy 1: Gemini inline base64 (works for all supported types) ──
        try:
            import google.generativeai as genai_local
            model_name   = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
            reader_model = genai_local.GenerativeModel(model_name)
            b64_data = base64.standard_b64encode(file_bytes).decode('utf-8')
            res = reader_model.generate_content([
                {'inline_data': {'mime_type': mime_type, 'data': b64_data}},
                'Extract ALL text, skills, experience, education, and qualifications '
                'from this document verbatim. Do not summarise — return the full raw content.',
            ])
            text_content = res.text
            print(f'[read_doc] Gemini extracted {len(text_content)} chars')
            return {'content': text_content}
        except Exception as gemini_err:
            print(f'[read_doc] Gemini inline failed ({gemini_err}). Trying format-specific fallback...')

        # ── Strategy 2: pypdf fallback (PDF only) ─────────────────────────────
        if ext == '.pdf':
            try:
                import io, pypdf
                reader = pypdf.PdfReader(io.BytesIO(file_bytes))
                text_content = '\n'.join(
                    page.extract_text() or '' for page in reader.pages
                ).strip()
                print(f'[read_doc] pypdf extracted {len(text_content)} chars')
                if text_content:
                    return {'content': text_content}
                return {'error': 'PDF has no selectable text (likely image-based scan).'}
            except ImportError:
                print('[read_doc] pypdf not installed, skipping.')
            except Exception as pdf_err:
                print(f'[read_doc] pypdf failed: {pdf_err}')

        # ── Strategy 3: python-docx fallback (DOCX only) ──────────────────────
        if ext in ('.docx', '.doc'):
            try:
                import io, docx
                doc_obj = docx.Document(io.BytesIO(file_bytes))
                text_content = '\n'.join(p.text for p in doc_obj.paragraphs).strip()
                print(f'[read_doc] python-docx extracted {len(text_content)} chars')
                if text_content:
                    return {'content': text_content}
                return {'error': 'DOCX has no readable text.'}
            except ImportError:
                print('[read_doc] python-docx not installed, skipping.')
            except Exception as docx_err:
                print(f'[read_doc] python-docx failed: {docx_err}')

        # ── Strategy 4: Plain text ─────────────────────────────────────────────
        if ext == '.txt':
            try:
                text_content = file_bytes.decode('utf-8', errors='replace').strip()
                if text_content:
                    return {'content': text_content}
            except Exception:
                pass

        return {'error': f'Could not extract text from {ext or "unknown"} file. All strategies failed.'}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'error': f'Failed to read document: {str(e)}'}


def _search_employees_by_name(db, name_query: str) -> list[dict]:
    """Fetch all employees and perform a case-insensitive substring match on fullName."""
    query = name_query.lower().strip()
    docs = db.collection('employees').stream()
    
    matches = []
    for doc in docs:
        data = doc.to_dict() or {}
        full_name = str(data.get('fullName', '')).lower()
        if query in full_name:
            # Return only necessary identifier fields to keep context small
            matches.append({
                'id': doc.id,
                'employeeId': data.get('employeeId', doc.id),
                'fullName': data.get('fullName', ''),
                'department': data.get('department', ''),
                'designation': data.get('designation', ''),
            })
            
    return matches


# ───────────────────────────────────────────────────────────────────────────────
# Gemini tool declarations
# ───────────────────────────────────────────────────────────────────────────────
_FILTER_ITEM_SCHEMA = protos.Schema(
    type=protos.Type.OBJECT,
    properties={
        'field':    protos.Schema(type=protos.Type.STRING, description='Document field name to filter on.'),
        'operator': protos.Schema(type=protos.Type.STRING, description='One of: ==  !=  <  <=  >  >=  in  array-contains'),
        'value':    protos.Schema(type=protos.Type.STRING, description='Filter value (always as string; backend coerces the type).'),
    },
    required=['field', 'operator', 'value'],
)

_TOOLS = protos.Tool(function_declarations=[

    protos.FunctionDeclaration(
        name='query_collection',
        description=(
            'Query a single Firestore collection with optional filters, ordering, and limit. '
            'Use this for most questions: showing employees, listing leave requests, payroll records, etc.'
        ),
        parameters=protos.Schema(
            type=protos.Type.OBJECT,
            properties={
                'collection':      protos.Schema(type=protos.Type.STRING,  description='Firestore collection name.'),
                'filters':         protos.Schema(type=protos.Type.ARRAY,   description='List of filter conditions.', items=_FILTER_ITEM_SCHEMA),
                'order_by':        protos.Schema(type=protos.Type.STRING,  description='Field to sort by.'),
                'order_direction': protos.Schema(type=protos.Type.STRING,  description='"asc" or "desc".'),
                'limit':           protos.Schema(type=protos.Type.INTEGER, description='Max results (default 50, max 200).'),
            },
            required=['collection'],
        ),
    ),

    protos.FunctionDeclaration(
        name='aggregate_collection',
        description=(
            'Aggregate data from a collection and return Chart.js-ready data. '
            'Use when the question implies totals, averages, distributions, counts by group, '
            'or whenever a chart or graph would be the best answer. '
            'Examples: headcount by department, average salary by department, leave usage breakdown.'
        ),
        parameters=protos.Schema(
            type=protos.Type.OBJECT,
            properties={
                'collection':          protos.Schema(type=protos.Type.STRING,  description='Collection to aggregate.'),
                'group_by':            protos.Schema(type=protos.Type.STRING,  description='Field to group documents by.'),
                'aggregate_function':  protos.Schema(type=protos.Type.STRING,  description='One of: count  sum  avg  min  max'),
                'aggregate_field':     protos.Schema(type=protos.Type.STRING,  description='Field to aggregate (required for sum/avg/min/max; omit for count).'),
                'filters':             protos.Schema(type=protos.Type.ARRAY,   description='Optional pre-filters.', items=_FILTER_ITEM_SCHEMA),
                'chart_type':          protos.Schema(type=protos.Type.STRING,  description='Chart type: bar | line | pie | doughnut. Default: bar.'),
                'chart_title':         protos.Schema(type=protos.Type.STRING,  description='Human-readable chart title.'),
                'limit':               protos.Schema(type=protos.Type.INTEGER, description='Max groups to show (default 15).'),
            },
            required=['collection', 'group_by', 'aggregate_function'],
        ),
    ),

    protos.FunctionDeclaration(
        name='query_with_join',
        description=(
            'Query two related collections and merge them. '
            'Use when the question spans two collections, e.g. "employees who have pending leaves". '
            'Primary collection is fetched first; secondary is filtered by the join field.'
        ),
        parameters=protos.Schema(
            type=protos.Type.OBJECT,
            properties={
                'primary_collection':   protos.Schema(type=protos.Type.STRING, description='First collection.'),
                'join_collection':      protos.Schema(type=protos.Type.STRING, description='Second collection to join.'),
                'join_on_primary':      protos.Schema(type=protos.Type.STRING, description='Field in primary that is the join key (usually "id" or "employeeId").'),
                'join_on_secondary':    protos.Schema(type=protos.Type.STRING, description='Field in secondary collection that references primary.'),
                'primary_filters':      protos.Schema(type=protos.Type.ARRAY,  description='Filters for the primary collection.', items=_FILTER_ITEM_SCHEMA),
                'secondary_filters':    protos.Schema(type=protos.Type.ARRAY,  description='Filters for the secondary collection.', items=_FILTER_ITEM_SCHEMA),
                'limit':                protos.Schema(type=protos.Type.INTEGER, description='Max merged results.'),
            },
            required=['primary_collection', 'join_collection', 'join_on_primary', 'join_on_secondary'],
        ),
    ),

    protos.FunctionDeclaration(
        name='read_storage_document',
        description=(
            'Download and read the contents of a document (e.g., PDF, Image) from Firebase Storage. '
            'Use this when you have found a file URL (like a resumeUrl or from the documents collection) '
            'and need to know what is written inside it to answer the users question.'
        ),
        parameters=protos.Schema(
            type=protos.Type.OBJECT,
            properties={
                'file_url': protos.Schema(type=protos.Type.STRING, description='The gs:// URL or storage path of the file.'),
            },
            required=['file_url'],
        ),
    ),

    protos.FunctionDeclaration(
        name='search_employees_by_name',
        description=(
            'Search for employees by name (first name, last name, or partial name). '
            'Use this FIRST when the user asks about a specific person (e.g., "Raj" or "Priya") '
            'to find their exact employeeId before querying their documents or payroll.'
        ),
        parameters=protos.Schema(
            type=protos.Type.OBJECT,
            properties={
                'name_query': protos.Schema(type=protos.Type.STRING, description='The name or partial name to search for (e.g., "Raj").'),
            },
            required=['name_query'],
        ),
    ),
])


# ───────────────────────────────────────────────────────────────────────────────
# System prompt  (injected once per session — tells Gemini the full schema)
# ───────────────────────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """
You are an AI assistant for BeanHR, an internal HR management portal.
You help the Super Admin query employee and HR data using plain English.
You have READ-ONLY access. Never suggest creating, updating, or deleting data.

IMPORTANT INSTRUCTION: You MUST ONLY answer questions related to HR, employees, payroll, leave, attendance, documents, and BeanHR portal data. If the user asks ANY question outside of this context (e.g., coding, math, recipes), you MUST explicitly reject the query by saying: "I am an HR assistant for BeanHR. I can only answer questions related to our portal's HR, payroll, documents, and employee data."

EMPATHY INSTRUCTION: If you search for a specific record or document (e.g., a resignation letter or resume) and the tool returns empty or it doesn't exist, you MUST respond conversationally and politely. Do not say "No data found." Instead say something like: "I checked the vault for [Name]'s [Document], but it doesn't look like they have uploaded it yet."

You have five tools available:
1. query_collection   — query a single collection with filters
2. aggregate_collection — group + aggregate for counts, sums, averages, charts
3. query_with_join    — merge two related collections
4. read_storage_document — read the actual text/content inside a PDF or document from a Storage URL
5. search_employees_by_name — use this FIRST to find a persons exact employeeId if the user gives a partial name (like "Raj")

Always use a tool to answer data questions. Only respond without a tool for
purely conversational messages (greetings, clarifications, etc.) or to reject out-of-context queries.

After receiving tool results, write a concise, friendly natural-language summary.
Use **bold** for key numbers. Format currency as ₹X,XX,XXX (Indian numbering).

=== AVAILABLE COLLECTIONS AND THEIR FIELDS ===

employees:
  accountId, employeeCode, fullName, email, phone, designation, department,
  companyTag, managerId, employmentStatus [active|on_notice|resigned|terminated],
  employmentType [regular|contractual], joiningDate, resignationDate,
  noticePeriodDays, noticePeriodEndDate, baseSalary, extractedResumeTags,
  address, promotedAt, createdAt, updatedAt

leaveRequests:
  employeeId, leaveType [sick|casual|paid], startDate, endDate, reason,
  backdated, status [pending|manager_approved|admin_approved|rejected|doc_requested],
  docRequestedBy, createdAt

payrollRecords:
  employeeId, month (format: "YYYY-MM"), baseSalary, bonus, deductions,
  netSalary, employmentType, totalWorkingDays, calendarDays, dailyRate,
  status [draft|issued|paid|payment_failed], paymentId, issuedAt, paidAt, createdAt

salaryAdvanceRequests:
  employeeId, amount, reason, status [pending|admin_approved|admin_rejected|disbursed],
  disbursedBy, disbursedAt, createdAt

resignationRequests:
  employeeId, managerId, reason, lastWorkingDate, noticePeriodDays,
  status [pending|manager_approved|admin_approved|rejected|settled],
  settlementAmount, createdAt

attendanceLogs:
  employeeId, date, status [present|absent|leave|half_day], checkInTime,
  checkOutTime, workHours, isLate, isEarlyCheckout, createdAt

leaveBalances:
  employeeId, sick, casual, paid, sickUsed, casualUsed, paidUsed,
  sickRemaining, casualRemaining, paidRemaining, updatedAt

bonusProposals:
  employeeId, month, amount, reason, status [pending_admin|approved|rejected],
  addedBy, approvedBy, createdAt, updatedAt

hiringRequests:
  proposedByManagerId, jobTitle, department, reason, urgency, status, createdAt

hiringProposals:
  proposedByManagerId, jobTitle, department, reason, urgency, status, createdAt

removalProposals:
  employeeId, managerId, reason, status, createdAt, adminReason, resolvedAt

attendanceStats:
  employeeId, totalPresent, totalAbsent, totalLate, totalLeave, updatedAt

payslips: employeeId, month, payrollRecordId, issuedAt, generatedAt
payments:  employeeId, payrollId, amount, gateway, transactionId, status, paidAt, createdAt
auditLogs: actorAccountId, action, targetCollection, targetDocId, ipAddress, createdAt
sessionLogs: employeeId, accountId, role, loginAt, logoutAt, duration, ipAddress, device, createdAt
holidays:  name, date, type, createdAt
employeeDocuments: employeeId, documentId, documentLabel, docType [resume|id_proof|resignation_letter|medical_certificate|other], fileName, fileSize, fileUrl, uploadedFileUrl, status [requested|approved|rejected|pending], uploadedAt, requestedAt
accounts: role [super_admin|admin|employee|candidate], email, employeeId, status [active|inactive|expired], isActive, passwordResetRequired, forcePasswordChange, createdAt
candidateProfiles: accountId, fullName, email, phone, designation, department, currentStage, offerLetterStatus [not_sent|sent|accepted|rejected], companyDecision, assignedManagerIds, assignedManagerNames, docsRequested, docsVerified, roundsCount, latestRoundName, latestRoundStatus, createdAt, submittedAt, portalCredentialsExpiresAt, joiningDate, holdDetails [isOnHold, reminderAt]
candidates: accountId, fullName, email, phone, designation, department, currentStage, offerLetterStatus [not_sent|sent|accepted|rejected], companyDecision, assignedManagerIds, assignedManagerNames, docsRequested, docsVerified, roundsCount, latestRoundName, latestRoundStatus, createdAt, submittedAt, portalCredentialsExpiresAt, joiningDate, holdDetails [isOnHold, reminderAt], hiringRounds, offerDetails, documents, candidateId
candidateDocuments: candidateId, docId, documentLabel, status, requestedBy, requestedAt, adminComment, fileUrl, uploadedFileUrl
attendanceSettings: windowStart, windowEnd, checkoutWindowStart, checkoutWindowEnd, tomorrowOverride
workingCalendar: overrides
leaveQuotaSettings: sick, casual, paid
notifications: recipientAccountId, title, message, read, timestamp, createdAt
portalSettings: minutes
""".strip()


# ───────────────────────────────────────────────────────────────────────────────
# Core AI search function
# ───────────────────────────────────────────────────────────────────────────────
def _determine_result_type(tool_name: str, tool_args: dict) -> str:
    if tool_name == 'aggregate_collection':
        return 'chart'
    collection = tool_args.get('collection') or tool_args.get('primary_collection', '')
    _MAP = {
        'employees':             'employees',
        'leaveRequests':         'leave_requests',
        'payrollRecords':        'payroll',
        'salaryAdvanceRequests': 'table',
        'resignationRequests':   'table',
        'attendanceLogs':        'table',
        'documents':             'table',
        'bonusProposals':        'table',
        'employeeDocuments':     'table',
        'accounts':              'table',
        'candidateProfiles':     'table',
        'candidates':            'table',
        'candidateDocuments':    'table',
        'hiringProposals':       'table',
        'removalProposals':      'table',
        'notifications':         'table',
        'portalSettings':        'table',
    }
    return _MAP.get(collection, 'table')


def _shape_results(tool_name: str, tool_args: dict, raw: list | dict):
    """Shape raw Firestore results into the format the frontend expects."""
    result_type = _determine_result_type(tool_name, tool_args)

    if result_type == 'chart':
        # raw is already { chart_type, title, labels, datasets }
        return result_type, raw

    if result_type == 'employees':
        # Reshape each doc to match what the frontend emp-card expects
        employees = []
        for doc in (raw or []):
            employees.append({
                'name':       doc.get('fullName', doc.get('name', 'Unknown')),
                'role':       doc.get('designation', doc.get('role', '')),
                'department': doc.get('department', ''),
                'salary':     doc.get('baseSalary', doc.get('salary')),
                'status':     doc.get('employmentStatus', 'active'),
            })
        return result_type, {'employees': employees}

    # table / leave_requests / payroll
    rows = raw if isinstance(raw, list) else [raw]
    if not rows:
        return result_type, {'rows': [], 'columns': []}
    columns = list(rows[0].keys()) if rows else []
    # Remove internal / noisy columns
    skip = {'id', '_joined', 'accountId', 'profilePhotoUrl', 'extractedResumeTags'}
    columns = [c for c in columns if c not in skip]
    return result_type, {'rows': rows, 'columns': columns}


def run_ai_search(message: str, conversation_history: list, uid: str) -> dict:
    """Main AI search logic. Returns { answer, results, result_type }."""
    gemini_api_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_api_key:
        raise RuntimeError('GEMINI_API_KEY not set in environment')

    genai.configure(api_key=gemini_api_key)

    db         = get_db()
    model_name = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=_SYSTEM_PROMPT,
        tools=[_TOOLS],
    )

    # Convert frontend history to Gemini chat history
    # Frontend sends { role: 'user'|'ai', text: '...' }
    gemini_history = []
    for entry in conversation_history[-10:]:
        role = 'user' if entry.get('role') == 'user' else 'model'
        text = entry.get('text', '')
        if text:
            gemini_history.append({'role': role, 'parts': [{'text': text}]})

    chat     = model.start_chat(history=gemini_history)
    print(f'[AI search] uid={uid} query={message[:80]!r} model={model_name}')
    response = chat.send_message(message)

    raw_data    = None
    result_type = 'text'
    tool_name   = None
    tool_args   = {}

    # Support multi-turn function calls (up to 20 turns).
    # Handles PARALLEL calls: Gemini may return multiple function_call parts in one
    # turn. We must execute ALL of them and send ALL responses in a single message.
    for turn_num in range(20):
        candidate = response.candidates[0]
        finish_reason = getattr(candidate, 'finish_reason', None)
        parts = candidate.content.parts if candidate.content else []

        # ── Debug logging ──────────────────────────────────────────────────────
        print(f'[AI search turn {turn_num}] finish_reason={finish_reason} parts_count={len(parts)}')
        for i, part in enumerate(parts):
            has_fc  = hasattr(part, 'function_call') and part.function_call and part.function_call.name
            has_txt = hasattr(part, 'text') and part.text
            print(f'  part[{i}]: function_call={part.function_call.name if has_fc else ""!r} '
                  f'text={bool(has_txt)} preview={str(getattr(part, "text", ""))[:60]!r}')

        # ── Collect every function call Gemini made this turn ──────────────────
        pending_calls = []
        for part in parts:
            if hasattr(part, 'function_call') and part.function_call and part.function_call.name:
                pending_calls.append(part.function_call)

        if not pending_calls:
            # No more tool calls — Gemini is done
            break

        # ── Execute all tool calls and build response parts list ───────────────
        response_parts = []
        for fc in pending_calls:
            tool_name = fc.name
            tool_args = dict(fc.args)
            print(f'[AI search turn {turn_num}] calling tool={tool_name} args_keys={list(tool_args.keys())}')

            try:
                if tool_name == 'query_collection':
                    raw_data = _execute_query(
                        db,
                        collection      = tool_args.get('collection'),
                        filters         = list(tool_args.get('filters') or []),
                        order_by        = tool_args.get('order_by'),
                        order_direction = tool_args.get('order_direction', 'asc'),
                        limit           = tool_args.get('limit', 50),
                    )

                elif tool_name == 'aggregate_collection':
                    raw_data = _execute_aggregate(
                        db,
                        collection          = tool_args.get('collection'),
                        group_by            = tool_args.get('group_by'),
                        aggregate_function  = tool_args.get('aggregate_function', 'count'),
                        aggregate_field     = tool_args.get('aggregate_field'),
                        filters             = list(tool_args.get('filters') or []),
                        chart_type          = tool_args.get('chart_type', 'bar'),
                        chart_title         = tool_args.get('chart_title'),
                        limit               = tool_args.get('limit', 15),
                    )

                elif tool_name == 'query_with_join':
                    raw_data = _execute_join(
                        db,
                        primary_collection  = tool_args.get('primary_collection'),
                        join_collection     = tool_args.get('join_collection'),
                        join_on_primary     = tool_args.get('join_on_primary', 'id'),
                        join_on_secondary   = tool_args.get('join_on_secondary'),
                        primary_filters     = list(tool_args.get('primary_filters') or []),
                        secondary_filters   = list(tool_args.get('secondary_filters') or []),
                        limit               = tool_args.get('limit', 50),
                    )

                elif tool_name == 'read_storage_document':
                    raw_data = _read_storage_document(
                        file_url = tool_args.get('file_url')
                    )

                elif tool_name == 'search_employees_by_name':
                    raw_data = _search_employees_by_name(
                        db,
                        name_query = tool_args.get('name_query')
                    )

                else:
                    raw_data = {'error': f'Unknown tool: {tool_name}'}

                result_payload = {'result': json.dumps(raw_data, default=str)}

            except ValueError as exc:
                result_payload = {'error': str(exc)}

            response_parts.append(
                protos.Part(
                    function_response=protos.FunctionResponse(
                        name=tool_name,
                        response=result_payload,
                    )
                )
            )

        # Send ALL tool results back to Gemini in one message
        print(f'[AI search turn {turn_num}] sending {len(response_parts)} function response(s) back to Gemini')
        response = chat.send_message(response_parts)

    # Extract the final text answer
    answer = ''
    final_candidate = response.candidates[0]
    final_parts = final_candidate.content.parts if final_candidate.content else []
    final_finish = getattr(final_candidate, 'finish_reason', None)
    print(f'[AI search final] finish_reason={final_finish} parts={len(final_parts)}')
    for part in final_parts:
        if hasattr(part, 'text') and part.text:
            answer += part.text
    print(f'[AI search final] answer_len={len(answer)} answer_preview={answer[:120]!r}')

    # Fallback: if Gemini returned empty text, surface a helpful message
    if not answer.strip():
        print(f'[AI search] WARNING: empty answer from Gemini. finish_reason={final_finish}')
        answer = ("I searched the database but couldn't formulate a response. "
                  "This usually means the data was found but Gemini returned an empty reply — "
                  "please try rephrasing your question.")

    # Shape the raw data for the frontend
    if raw_data is not None and tool_name:
        result_type, shaped = _shape_results(tool_name, tool_args, raw_data)
    else:
        shaped = None

    return {'answer': answer, 'results': shaped, 'result_type': result_type}


# ───────────────────────────────────────────────────────────────────────────────
# Flask route
# ───────────────────────────────────────────────────────────────────────────────
@ai_bp.route('/api/ai/search', methods=['POST'])
@require_auth
@require_super_admin
def ai_search():
    """POST /api/ai/search  { message, history }"""

    if not _check_rate_limit(g.uid):
        return jsonify({'error': 'Rate limit exceeded. Max 30 requests per minute.'}), 429

    data    = request.get_json(force=True, silent=True) or {}
    message = str(data.get('message', '')).strip()
    history = data.get('history', [])

    if not message:
        return jsonify({'error': 'message is required'}), 400
    if len(message) > 2000:
        return jsonify({'error': 'message too long (max 2000 characters)'}), 400

    try:
        result = run_ai_search(message, history, g.uid)
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 503
    except Exception as exc:  # noqa: BLE001
        err_str = str(exc)
        print(f'[AI search error] uid={g.uid} error={exc}')
        if '403' in err_str or 'denied access' in err_str.lower():
            return jsonify({'error': 'Gemini API access denied. Enable the Generative Language API at console.cloud.google.com for your project.'}), 503
        if '404' in err_str or 'not found' in err_str.lower():
            return jsonify({'error': f'Gemini model not found. Check GEMINI_MODEL in .env (currently: {os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")}).'}), 503
        if '429' in err_str or 'quota' in err_str.lower() or 'rate' in err_str.lower():
            # Respond conversationally for rate limits instead of a hard error
            return jsonify({'answer': "I'm so sorry, but I'm processing a very high volume of complex data right now and need a quick breather. Please give me about 60 seconds and try again!", 'result_type': 'text'})
        return jsonify({'error': 'AI search failed. Please try again.'}), 500

    # Fire-and-forget audit log
    try:
        get_db().collection('aiSearchLogs').add({
            'adminAccountId': g.uid,
            'query':          message,
            'resultType':     result.get('result_type'),
            'createdAt':      datetime.utcnow(),
        })
    except Exception:  # noqa: BLE001
        pass  # Logging failure should never break the response

    return jsonify(result)
