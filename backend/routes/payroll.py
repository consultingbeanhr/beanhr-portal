from flask import Blueprint, request, jsonify
from firebase_admin import firestore
import datetime
import calendar
import uuid

payroll_bp = Blueprint('payroll', __name__)

@payroll_bp.route('/generate', methods=['POST'])
def generate_payroll():
    """
    Generate draft payroll records for a specific month for all active employees.
    Payload: { "month": "2026-07" }
    """
    data = request.json
    month_str = data.get('month')
    if not month_str:
        return jsonify({'error': 'Month (YYYY-MM) is required'}), 400

    try:
        year, month_num = map(int, month_str.split('-'))
    except ValueError:
        return jsonify({'error': 'Invalid month format, expected YYYY-MM'}), 400

    db = firestore.client()
    
    # 1. Fetch all active and on-notice employees
    employees_ref = db.collection('employees').where('employmentStatus', 'in', ['active', 'on_notice']).stream()
    employees = []
    for emp_doc in employees_ref:
        emp_data = emp_doc.to_dict()
        emp_data['employeeId'] = emp_doc.id  # Critical: Use Firestore document ID, not accountId
        employees.append(emp_data)
        
    if not employees:
        return jsonify({'message': 'No eligible employees found for payroll generation', 'records': []}), 200

    # 2. Fetch Working Calendar for this month
    working_cal_ref = db.collection('workingCalendar').document(month_str).get()
    cal_days = calendar.monthrange(year, month_num)[1]
    total_working_days = cal_days - 8 # Default assumption: ~8 weekend days
    if working_cal_ref.exists:
        cal_data = working_cal_ref.to_dict()
        total_working_days = cal_data.get('totalWorkingDays', total_working_days)

    # 3. Fetch global attendance settings
    settings_ref = db.collection('attendanceSettings').document('global').get()
    settings = settings_ref.to_dict() if settings_ref.exists else {}
    
    late_threshold = settings.get('lateLoginPenaltyThreshold', 3)
    # late_reset = settings.get('lateLoginResetOnMonthStart', True)
    early_threshold = settings.get('earlyCheckoutPenaltyThreshold', 3)
    # early_reset = settings.get('earlyCheckoutResetOnMonthStart', True)

    # Calculate month date range for Firestore query
    start_date = f"{month_str}-01"
    end_date = f"{month_str}-{cal_days:02d}"

    # We will do this in a batch to save the drafts
    batch = db.batch()
    generated_records = []

    for emp in employees:
        emp_id = emp.get('employeeId')
        if not emp_id:
            continue
            
        base_salary = float(emp.get('baseSalary') or 0)
        
        # Apply pending salary hike if effective month is reached
        pending_hike = emp.get('pendingSalaryHike')
        if pending_hike and month_str >= pending_hike.get('effectiveMonth', '9999-99'):
            base_salary = float(pending_hike.get('amount') or 0)
            # Update the employee record to permanently set the new salary and remove the pending hike
            db.collection('employees').document(emp_id).update({
                'baseSalary': base_salary,
                'pendingSalaryHike': firestore.DELETE_FIELD
            })
            
        emp_type = emp.get('employmentType', 'regular')
        
        # Calculate daily rate
        daily_rate_basis = 'calendar_days' if emp_type == 'regular' else 'working_days'
        divisor = cal_days if emp_type == 'regular' else total_working_days
        daily_rate = base_salary / divisor if divisor > 0 else 0
        half_day_rate = daily_rate / 2.0

        # Fetch attendance logs for THIS month (simplest approach for idempotent generation)
        # Avoid composite index requirement by fetching by employeeId and filtering date in memory
        logs_ref = db.collection('attendanceLogs').where('employeeId', '==', emp_id).stream()
        
        logs = []
        for log_doc in logs_ref:
            log = log_doc.to_dict()
            if start_date <= log.get('date', '') <= end_date:
                logs.append(log)
                
        # Sort chronologically
        logs.sort(key=lambda x: x.get('date', ''))
        
        late_counter = 0
        early_counter = 0
        deduction_breakdown = []
        total_deductions = 0.0
        
        # We process chronologically
        for log in logs:
            date = log.get('date')
            status = log.get('status') # 'present', 'late', 'absent'
            is_early = log.get('isEarlyCheckout', False)
            
            penalty_today = 0.0
            reasons = []

            if status == 'absent':
                penalty_today = daily_rate
                reasons.append('absent_lop')
            else:
                hit_penalty = False
                if status == 'late':
                    late_counter += 1
                    if late_counter > late_threshold:
                        hit_penalty = True
                        reasons.append('late_penalty')
                        late_counter = 0 # reset after strike
                        
                if is_early:
                    early_counter += 1
                    if early_counter > early_threshold:
                        hit_penalty = True
                        reasons.append('early_checkout_penalty')
                        early_counter = 0 # reset after strike
                        
                if hit_penalty:
                    penalty_today = half_day_rate # max half day penalty per present day
            
            if penalty_today > 0:
                total_deductions += penalty_today
                deduction_breakdown.append({
                    'date': date,
                    'reason': ' + '.join(reasons),
                    'amount': round(penalty_today, 2)
                })

        # Fetch Bonuses for the month
        # Avoid multiple == filters which might require an index by doing in-memory filter
        bonus = 0.0
        bonuses_ref = db.collection('bonuses').where('employeeId', '==', emp_id).stream()
        for b_doc in bonuses_ref:
            b = b_doc.to_dict()
            if b.get('month') == month_str and b.get('approvalStatus') == 'approved':
                bonus += float(b.get('amount') or 0)

        net_salary = max(0.0, base_salary + bonus - total_deductions)
        
        payroll_id = f"PR-{month_str}-{emp_id[:6].upper()}"
        
        record_data = {
            'payrollId': payroll_id,
            'employeeId': emp_id,
            'month': month_str,
            'baseSalary': round(base_salary, 2),
            'bonus': round(bonus, 2),
            'deductions': round(total_deductions, 2),
            'deductionBreakdown': deduction_breakdown,
            'netSalary': round(net_salary, 2),
            'employmentType': emp_type,
            'totalWorkingDays': total_working_days,
            'calendarDays': cal_days,
            'dailyRateBasis': daily_rate_basis,
            'dailyRate': round(daily_rate, 2),
            'status': 'draft',
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        
        doc_ref = db.collection('payrollRecords').document(payroll_id)
        batch.set(doc_ref, record_data)
        generated_records.append(record_data)
        
        # Firestore limits a single batch to 500 operations
        if len(generated_records) % 450 == 0:
            batch.commit()
            batch = db.batch()

    if len(generated_records) % 450 != 0:
        batch.commit()

    return jsonify({
        'message': f'Successfully generated {len(generated_records)} draft payroll records',
        'records': generated_records
    }), 200


@payroll_bp.route('/records', methods=['GET'])
def get_payroll_records():
    month_str = request.args.get('month')
    if not month_str:
        return jsonify({'error': 'month query param is required'}), 400
    
    db = firestore.client()
    records_ref = db.collection('payrollRecords').where('month', '==', month_str).stream()
    
    records = []
    for doc in records_ref:
        rec = doc.to_dict()
        rec['payrollId'] = doc.id
        records.append(rec)
        
    # Optional: fetch employee full names to attach to records if not saved in payrollRecords directly
    # Since we generate it, we might need employee names
    emp_ids = list(set([r.get('employeeId') for r in records if r.get('employeeId')]))
    emp_map = {}
    if emp_ids:
        # Batch fetch employees or just fetch all active to build map
        emps = db.collection('employees').stream()
        for e in emps:
            data = e.to_dict()
            emp_map[e.id] = data
            
    for r in records:
        emp = emp_map.get(r.get('employeeId'), {})
        r['fullName'] = emp.get('fullName', 'Unknown')
        r['designation'] = emp.get('designation', 'Unknown')
        r['department'] = emp.get('department', 'Unknown')
        r['employeeCode'] = emp.get('employeeCode', 'Unknown')
        
    return jsonify({'records': records, 'summary': {
        'totalBurn': sum(r.get('netSalary', 0) for r in records if r.get('status') in ['paid', 'issued']),
        'pendingDrafts': sum(1 for r in records if r.get('status') == 'draft')
    }}), 200
