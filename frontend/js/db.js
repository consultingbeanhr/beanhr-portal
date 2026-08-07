// ── BeanHR — Data Layer (db.js) ───────────────────────────────
// Single abstraction layer between UI and data source.
// All dashboard pages call functions from this file — never Firestore directly.
//
// CURRENT STATE: returns hardcoded mock data matching the Firestore schema exactly.
//
// ⚠️  FIREBASE MIGRATION — for each function:
//      1. Fill in firebase/firebase_config.js with real credentials
//      2. Delete the "// MOCK return" block
//      3. Uncomment the "── Firestore stub ──" block below it
//   Zero page rewiring needed — all pages keep calling the same function names.
// ─────────────────────────────────────────────────────────────

// Centralized safe fallback for API_BASE and showDocumentPreview
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:5000'
    : window.location.origin;

// Automatically convert all relative .html navigation links to clean URLs on DOM load
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href$=".html"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && href.endsWith('.html') && !href.startsWith('http') && !href.startsWith('//')) {
            a.setAttribute('href', href.slice(0, -5));
        }
    });
});

window.showDocumentPreview = function(url, name) {
    if (url && url.startsWith('mock://')) {
        url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    }
    
    let modal = document.getElementById('docPreviewModal');
    if (!modal) {
        // Inject styles
        const style = document.createElement('style');
        style.id = 'dynamicDocPreviewStyles';
        style.textContent = `
            .doc-modal-overlay {
                position: fixed; inset: 0; z-index: 99999;
                background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                opacity: 0; pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .doc-modal-overlay.open { opacity: 1; pointer-events: auto; }
            .doc-modal-panel {
                width: 900px; max-width: calc(100vw - 32px);
                background: var(--bg, #0f0f1a);
                border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
                border-radius: 20px; padding: 24px;
                transform: translateY(14px) scale(0.97);
                transition: transform 0.22s cubic-bezier(0.22,1,0.36,1);
                box-shadow: 0 24px 80px rgba(0,0,0,0.7);
                display: flex;
                flex-direction: column;
            }
            .doc-modal-overlay.open .doc-modal-panel { transform: translateY(0) scale(1); }
            .doc-modal-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
            .doc-modal-title { font-size: 16px; font-weight: 700; color: var(--text, #fff); }
            .doc-modal-close {
                width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
                background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border, rgba(255,255,255,0.08));
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; color: var(--text-muted, #8e8e9f); font-size: 20px;
                transition: background 0.15s, color 0.15s, transform 0.15s;
            }
            .doc-modal-close:hover {
                background: rgba(255,255,255,0.15);
                color: var(--text, #fff);
                transform: scale(1.05);
            }
            .doc-preview-body-container {
                min-height: 100px;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            [data-theme="light"] .doc-modal-panel {
                background: var(--bg, #ffffff);
                border: 1px solid var(--glass-border, rgba(0,0,0,0.08));
            }
            [data-theme="light"] .doc-modal-title {
                color: var(--text, #1f2937);
            }
            [data-theme="light"] .doc-modal-close {
                background: rgba(0,0,0,0.04);
                border: 1px solid var(--glass-border, rgba(0,0,0,0.08));
                color: var(--text-muted, #6b7280);
            }
            [data-theme="light"] .doc-modal-close:hover {
                background: rgba(0,0,0,0.08);
                color: var(--text, #111827);
            }
        `;
        document.head.appendChild(style);

        // Inject HTML
        modal = document.createElement('div');
        modal.className = 'doc-modal-overlay';
        modal.id = 'docPreviewModal';
        modal.innerHTML = `
            <div class="doc-modal-panel">
                <div class="doc-modal-header">
                    <div>
                        <div class="doc-modal-title">Document Previewer</div>
                        <div id="docPreviewName" style="font-size:12px;color:var(--text-faint, #6b7280);margin-top:3px"></div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <a id="docPreviewDownloadLink" href="#" target="_blank" rel="noopener noreferrer" class="doc-modal-close" style="text-decoration:none;font-size:12px;width:auto;padding:0 10px;gap:5px;display:inline-flex;font-weight:600;" title="Download Original File"><i class="ph ph-download-simple"></i> Download</a>
                        <button class="doc-modal-close" id="docPreviewCloseBtn" aria-label="Close">&times;</button>
                    </div>
                </div>
                <div class="doc-preview-body-container" id="docPreviewBody"></div>
            </div>
        `;
        document.body.appendChild(modal);

        // Event listeners
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeDocPreview();
            }
        });
        document.getElementById('docPreviewCloseBtn').addEventListener('click', closeDocPreview);
    }

    const nameEl = document.getElementById('docPreviewName');
    const bodyEl = document.getElementById('docPreviewBody');
    const dlLink = document.getElementById('docPreviewDownloadLink');

    if (nameEl) nameEl.textContent = name || 'Document';
    if (dlLink) {
        dlLink.href = url || '#';
        dlLink.style.display = url ? 'inline-flex' : 'none';
    }

    // Detect file type
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i.test(url) || (url && url.startsWith('data:image/'));
    const isDoc   = /\.(docx?|doc|rtf|odt|pages)($|\?)/i.test(url) || (name && /\.(docx?|doc|rtf|odt|pages)$/i.test(name));
    
    if (isImage) {
        bodyEl.innerHTML = `<img src="${url}" style="width:100%; max-height: 75vh; object-fit: contain; border-radius: 12px; border: 1px solid var(--glass-border, rgba(255,255,255,0.08));" alt="${name || 'Document'}" />`;
    } else if (isDoc) {
        const googleDocsUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
        bodyEl.innerHTML = `<iframe src="${googleDocsUrl}" style="width:100%; height: 75vh; border: none; border-radius: 12px; background: white;" title="${name || 'Document'}"></iframe>`;
    } else {
        bodyEl.innerHTML = `<iframe src="${url}" style="width:100%; height: 75vh; border: none; border-radius: 12px; background: white;" title="${name || 'Document'}"></iframe>`;
    }

    modal.classList.add('open');

    function closeDocPreview() {
        modal.classList.remove('open');
        setTimeout(() => {
            if (!modal.classList.contains('open') && bodyEl) {
                bodyEl.innerHTML = '';
            }
        }, 250);
    }

    window.closeDocPreview = closeDocPreview;
};

const db = (() => {

    // ══ SESSION & IDLE AUTO-LOGOUT ════════════════════════════
    //
    // Idle timeout duration — configurable by admin via setIdleTimeoutSetting().
    let _activeIdleTimeoutMs = 10 * 60 * 1000;  // default: 10 minutes
    function getIdleTimeoutMs() { return _activeIdleTimeoutMs; }

    // Mutable salary overrides — updated by adminDirectSalaryEdit & adminActOnHikeRequest
    var _mockSalaryOverrides = {};

    let _sessionId  = null;
    let _idleTimer  = null;

    // ── _mockSessionLogs ─────────────────────────────────────────
    // Accumulates session records in mock mode.
    // recordSessionLogin pushes; recordSessionLogout finds and updates.
    // Pre-populated with 7 days of realistic sample data.
    var _mockSessionLogs = (function() {
        var _n = Date.now();
        var H = 3600000, D = 86400000;
        function sl(id, empId, name, role, lIn, lOut, reason) {
            return {
                sessionId:    id,
                employeeId:   empId,
                employeeName: name,
                role:         role,
                loginAt:      new Date(_n - lIn).toISOString(),
                logoutAt:     lOut != null ? new Date(_n - lOut).toISOString() : null,
                logoutReason: reason,
                userAgent:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            };
        }
        return [
            // ── Today (Tue May 5) ────────────────────────────────
            sl('SES2605050001', 'EMP001', 'Rahul Mehta',   'employee', 5.0*H, 2.5*H,  'idle_timeout'),
            sl('SES2605050002', 'EMP002', 'Ananya Singh',  'employee', 5.0*H, null,    null),
            sl('SES2605050003', 'EMP003', 'Rohan Das',     'employee', 4.5*H, null,    null),
            sl('SES2605050004', 'MGR001', 'Priya Sharma',  'manager',  5.5*H, null,    null),
            sl('SES2605050005', 'EMP004', 'Kavya Nair',    'employee', 4.0*H, 1.5*H,  'idle_timeout'),
            sl('SES2605050006', 'EMP001', 'Rahul Mehta',   'employee', 2.0*H, null,    null),
            sl('SES2605050007', 'EMP006', 'Divya Reddy',   'employee', 3.5*H, null,    null),
            sl('SES2605050008', 'MGR002', 'Vikram Patel',  'manager',  6.0*H, 4.0*H,  'manual'),
            // ── Mon May 4 ────────────────────────────────────────
            sl('SES2605040001', 'EMP001', 'Rahul Mehta',   'employee', D+6.0*H, D+0.5*H, 'manual'),
            sl('SES2605040002', 'EMP002', 'Ananya Singh',  'employee', D+6.5*H, D+0.5*H, 'manual'),
            sl('SES2605040003', 'EMP003', 'Rohan Das',     'employee', D+6.0*H, D+1.0*H, 'manual'),
            sl('SES2605040004', 'EMP004', 'Kavya Nair',    'employee', D+7.0*H, D+0.5*H, 'manual'),
            sl('SES2605040005', 'EMP005', 'Arjun Kapoor',  'employee', D+6.5*H, D+3.0*H, 'idle_timeout'),
            sl('SES2605040006', 'MGR001', 'Priya Sharma',  'manager',  D+7.0*H, D+0.5*H, 'manual'),
            sl('SES2605040007', 'MGR002', 'Vikram Patel',  'manager',  D+6.0*H, D+1.0*H, 'manual'),
            // ── Sun May 3 (weekend) ──────────────────────────────
            sl('SES2605030001', 'EMP001', 'Rahul Mehta',   'employee', 2*D+8.0*H, 2*D+6.0*H, 'manual'),
            sl('SES2605030002', 'MGR001', 'Priya Sharma',  'manager',  2*D+7.0*H, 2*D+5.5*H, 'manual'),
            // ── Sat May 2 (weekend) ──────────────────────────────
            sl('SES2605020001', 'EMP003', 'Rohan Das',     'employee', 3*D+9.0*H, 3*D+7.5*H, 'manual'),
            // ── Fri May 1 ────────────────────────────────────────
            sl('SES2605010001', 'EMP001', 'Rahul Mehta',   'employee', 4*D+6.5*H, 4*D+0.5*H, 'manual'),
            sl('SES2605010002', 'EMP002', 'Ananya Singh',  'employee', 4*D+6.5*H, 4*D+0.5*H, 'manual'),
            sl('SES2605010003', 'EMP003', 'Rohan Das',     'employee', 4*D+6.0*H, 4*D+1.0*H, 'manual'),
            sl('SES2605010004', 'EMP004', 'Kavya Nair',    'employee', 4*D+7.0*H, 4*D+1.5*H, 'idle_timeout'),
            sl('SES2605010005', 'EMP005', 'Arjun Kapoor',  'employee', 4*D+6.5*H, 4*D+0.5*H, 'manual'),
            sl('SES2605010006', 'EMP006', 'Divya Reddy',   'employee', 4*D+7.0*H, 4*D+0.5*H, 'manual'),
            sl('SES2605010007', 'MGR001', 'Priya Sharma',  'manager',  4*D+7.0*H, 4*D+0.5*H, 'manual'),
            // ── Thu Apr 30 ───────────────────────────────────────
            sl('SES2604300001', 'EMP001', 'Rahul Mehta',   'employee', 5*D+6.5*H, 5*D+0.5*H, 'manual'),
            sl('SES2604300002', 'EMP002', 'Ananya Singh',  'employee', 5*D+7.0*H, 5*D+1.0*H, 'manual'),
            sl('SES2604300003', 'EMP003', 'Rohan Das',     'employee', 5*D+6.0*H, 5*D+3.0*H, 'idle_timeout'),
            sl('SES2604300004', 'EMP005', 'Arjun Kapoor',  'employee', 5*D+6.5*H, 5*D+0.5*H, 'manual'),
            sl('SES2604300005', 'MGR001', 'Priya Sharma',  'manager',  5*D+7.0*H, 5*D+0.5*H, 'manual'),
            sl('SES2604300006', 'MGR002', 'Vikram Patel',  'manager',  5*D+6.5*H, 5*D+1.0*H, 'manual'),
            // ── Wed Apr 29 ───────────────────────────────────────
            sl('SES2604290001', 'EMP001', 'Rahul Mehta',   'employee', 6*D+6.5*H, 6*D+0.5*H, 'manual'),
            sl('SES2604290002', 'EMP002', 'Ananya Singh',  'employee', 6*D+7.0*H, 6*D+0.5*H, 'manual'),
            sl('SES2604290003', 'EMP004', 'Kavya Nair',    'employee', 6*D+6.5*H, 6*D+4.0*H, 'idle_timeout'),
            sl('SES2604290004', 'EMP006', 'Divya Reddy',   'employee', 6*D+7.0*H, 6*D+0.5*H, 'manual'),
            sl('SES2604290005', 'MGR002', 'Vikram Patel',  'manager',  6*D+6.5*H, 6*D+0.5*H, 'manual'),
        ];
    })();

    // --- Auth Helper ---
    function _getUid() {
        return new Promise((resolve, reject) => {
            if (firebase.auth().currentUser) {
                return resolve(firebase.auth().currentUser.uid);
            }
            const unsubscribe = firebase.auth().onAuthStateChanged(user => {
                unsubscribe();
                if (user) resolve(user.uid);
                else reject(new Error('User not logged in'));
            });
        });
    }

    // ── logAuditEvent ───────────────────────────────────────────
    async function logAuditEvent(category, action, actionLabel, targetType, targetId, targetName, details = {}) {
        try {
            const uid = await _getUid().catch(() => null);
            if (!uid) return;
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get().catch(() => null);
            const accData = accSnap && accSnap.exists ? accSnap.data() : {};
            const empId = accData.employeeId || uid;
            const empSnap = await firebase.firestore().collection('employees').doc(empId).get().catch(() => null);
            const empData = empSnap && empSnap.exists ? empSnap.data() : {};
            const role = accData.role || 'user';
            const name = accData.fullName || accData.name || empData.fullName || empData.name || (accData.email ? accData.email.split('@')[0] : '') || 'User';

            await firebase.firestore().collection('auditLogs').add({
                actorAccountId: uid,
                actorName: name,
                actorRole: role,
                category: category || 'general',
                action: action,
                actionLabel: actionLabel || action,
                targetType: targetType || 'system',
                targetId: targetId || '',
                targetName: targetName || '',
                details: details || {},
                createdAt: new Date().toISOString()
            });
        } catch(e) {
            console.warn('logAuditEvent failed:', e);
        }
    }

    // ── recordSessionLogin ──────────────────────────────────────
    async function recordSessionLogin(role) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get().catch(() => null);
        const accData = accSnap && accSnap.exists ? accSnap.data() : {};
        const empId = accData.employeeId || uid;
        const empSnap = await firebase.firestore().collection('employees').doc(empId).get().catch(() => null);
        const empData = empSnap && empSnap.exists ? empSnap.data() : {};

        const name = accData.fullName || accData.name || empData.fullName || empData.name || (accData.email ? accData.email.split('@')[0] : '') || 'User';
        const empCode = empData.employeeCode || empId;

        // Auto-close any previous unclosed sessions for this account
        try {
            const oldSnap = await firebase.firestore().collection('sessionLogs')
                .where('accountId', '==', uid)
                .where('logoutAt', '==', null)
                .get();
            if (oldSnap && !oldSnap.empty) {
                const batch = firebase.firestore().batch();
                const nowStr = new Date().toISOString();
                oldSnap.docs.forEach(d => {
                    batch.update(d.ref, {
                        logoutTime: nowStr,
                        logoutAt: nowStr,
                        logoutReason: 'session_expired'
                    });
                });
                await batch.commit().catch(() => {});
            }
        } catch(e) {
            console.warn('[DB] Could not auto-close previous active sessions:', e);
        }

        const docRef = firebase.firestore().collection('sessionLogs').doc();
        const nowStr = new Date().toISOString();
        await docRef.set({
            accountId: uid,
            employeeId: empId,
            employeeName: name,
            employeeCode: empCode,
            role: role || accData.role || 'employee',
            loginTime: nowStr,
            loginAt: nowStr,
            logoutTime: null,
            logoutAt: null,
            logoutReason: null
        });
        _sessionId = docRef.id;
        try { sessionStorage.setItem('bhr_session_id', docRef.id); } catch(e) {}

        logAuditEvent('security', 'user_login', 'User Session Login', 'user_session', docRef.id, name, { role: role || accData.role });

        return { sessionId: docRef.id };
    }

    // ── recordSessionLogout ─────────────────────────────────────
    async function recordSessionLogout(sessionId, reason) {
        if (!sessionId) {
            sessionId = _sessionId || sessionStorage.getItem('bhr_session_id');
        }
        if (!sessionId) {
            try {
                const uid = await _getUid();
                const snap = await firebase.firestore().collection('sessionLogs')
                  .where('accountId', '==', uid)
                  .where('logoutAt', '==', null)
                  .orderBy('loginAt', 'desc')
                  .limit(1)
                  .get().catch(() => null);
                if (snap && !snap.empty) sessionId = snap.docs[0].id;
            } catch(e) {}
        }
        if (sessionId) {
            const nowStr = new Date().toISOString();
            await firebase.firestore().collection('sessionLogs').doc(sessionId).update({
                logoutTime: nowStr,
                logoutAt: nowStr,
                logoutReason: reason || 'manual'
            }).catch(() => null);
            logAuditEvent('security', 'user_logout', 'User Session Logout', 'user_session', sessionId, 'User', { reason: reason || 'manual' });
        }
    }

    // ── endSession ──────────────────────────────────────────────
    async function endSession(reason = 'manual') {
        try {
            await _getUid();
            const sid = _sessionId || sessionStorage.getItem('bhr_session_id');
            if (sid) {
                console.log('[DB] Session ended:', { sessionId: sid, reason, at: new Date().toISOString() });
                await recordSessionLogout(sid, reason).catch(e => console.warn('[DB] recordSessionLogout error:', e));
                sessionStorage.removeItem('bhr_session_id');
                _sessionId = null;
            } else {
                await recordSessionLogout(null, reason).catch(e => console.warn('[DB] recordSessionLogout fallback error:', e));
            }
        } catch (err) {
            console.warn('[DB] endSession error:', err);
        }
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    }

    // ── logout ──────────────────────────────────────────────────
    async function logout(redirectUrl = '../login.html') {
        try {
            await endSession('manual');
        } catch (e) {
            console.warn('[DB] logout error:', e);
        }
        sessionStorage.removeItem('bhr_role');
        sessionStorage.removeItem('bhr_email');
        if (redirectUrl) window.location.replace(redirectUrl);
    }

    // ── startIdleWatcher ────────────────────────────────────────
    // Call once from every page's init(). Pass the page's logout handler as onTimeout.
    // Handles session recording automatically:
    //   — if bhr_session_id already in sessionStorage → resumes existing session (page navigation)
    //   — if not → records a fresh login and stores the new sessionId
    //
    // Warning toast behaviour:
    //   If idle timeout > 1 minute  → warning toast fires at (timeout − 1 min); logout fires 1 min later.
    //   If idle timeout ≤ 1 minute  → no warning; logout fires immediately after timeout.
    //   Any user activity resets both timers and removes the warning toast if visible.
    async function startIdleWatcher(onTimeout) {
        await _getUid();
        const role = sessionStorage.getItem('bhr_role');
        if (!role) return;

        try {
            const doc = await firebase.firestore().collection('portalSettings').doc('global').get();
            if (doc.exists) {
                _activeIdleTimeoutMs = (doc.data().minutes || 10) * 60 * 1000;
            }
        } catch (e) {
            console.warn('[DB] Failed to load idle timeout from DB, using fallback.', e);
        }

        const existing = sessionStorage.getItem('bhr_session_id');
        if (existing) {
            _sessionId = existing;  // page navigation within same session — no new login record
        } else {
            recordSessionLogin(role).then(function(result) {
                _sessionId = result.sessionId;
                sessionStorage.setItem('bhr_session_id', result.sessionId);
            }).catch(function() {});
        }

        var _warnTimer    = null;
        var _warnToastEl  = null;

        function removeWarnToast() {
            clearTimeout(_warnTimer);
            _warnTimer = null;
            if (_warnToastEl && _warnToastEl.parentNode) {
                _warnToastEl.classList.add('out');
                var el = _warnToastEl;
                setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
            }
            _warnToastEl = null;
        }

        function showWarnToast() {
            // Ensure a toast container exists (uses the page's #toastContainer if present,
            // otherwise injects a minimal one so the warning works on every dashboard page).
            var container = document.getElementById('toastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toastContainer';
                container.className = 'toast-container';
                Object.assign(container.style, {
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
                    display: 'flex', flexDirection: 'column', gap: '10px', pointerEvents: 'none'
                });
                document.body.appendChild(container);
            }
            var el = document.createElement('div');
            el.className = 'toast';
            el.innerHTML = '&#9888;&#65039; You will be logged out in <strong>1&nbsp;minute</strong> due to inactivity.';
            el.style.borderColor = 'rgba(255, 180, 0, 0.45)';
            container.appendChild(el);
            _warnToastEl = el;

            // After the 1-minute warning window, actually log out.
            _warnTimer = setTimeout(function() {
                endSession('idle_timeout');
                if (typeof onTimeout === 'function') { onTimeout(); }
            }, 60000);
        }

        function resetTimer() {
            clearTimeout(_idleTimer);
            removeWarnToast();
            var totalMs = getIdleTimeoutMs();
            var warnMs  = totalMs - 60000;   // time until warning appears
            if (warnMs > 0) {
                // Show warning 1 minute before logout.
                _idleTimer = setTimeout(showWarnToast, warnMs);
            } else {
                // Timeout ≤ 1 min — skip warning, log out directly.
                _idleTimer = setTimeout(function() {
                    endSession('idle_timeout');
                    if (typeof onTimeout === 'function') { onTimeout(); }
                }, totalMs);
            }
        }

        ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function(evt) {
            window.addEventListener(evt, resetTimer, { passive: true });
        });

        resetTimer();
    }

    // ══ EMPLOYEE — PART 1 (Dashboard Home) ═══════════════════

    // ── getEmployeeProfile ──────────────────────────────────────
    async function getEmployeeProfile() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account document not found");
        let empId = accSnap.data().employeeId;
        if (!empId) {
            empId = uid;
            try {
                await firebase.firestore().collection('accounts').doc(uid).update({ employeeId: uid });
            } catch (e) {
                console.warn("Could not update account employeeId:", e);
            }
        }
        const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
        if (!empSnap.exists) {
            const accData = accSnap.data() || {};
            return {
                employeeId: empId,
                fullName: accData.name || accData.email?.split('@')[0] || 'User',
                email: accData.email || '',
                role: accData.role || 'employee',
                employmentStatus: 'active',
                department: 'Operations',
                designation: accData.role === 'manager' ? 'Manager' : 'Employee',
                joiningDate: new Date().toISOString().split('T')[0],
                phone: '',
                address: '',
                emergencyContact: { name: '', phone: '', relation: '' }
            };
        }
        return { employeeId: empSnap.id, ...empSnap.data() };
    }

    // ── getLeaveBalances ────────────────────────────────────────
    async function getLeaveBalances() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return null;
        const empId = accSnap.data().employeeId || uid;

        const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
        const empData = empSnap.exists ? empSnap.data() : {};
        const role = accSnap.data().role || empData.role || 'employee';

        const settingsSnap = await firebase.firestore().collection('leaveQuotaSettings').doc('global').get();
        const data = settingsSnap.exists ? settingsSnap.data() : {};
        const defaultQuotas = { employee: {sick:5,casual:5,paid:10}, manager: {sick:7,casual:7,paid:15} };
        const globalQuotas = {
            employee: { ...defaultQuotas.employee, ...data.employee },
            manager: { ...defaultQuotas.manager, ...data.manager }
        };
        const defaults = globalQuotas[role] || globalQuotas.employee;
        
        const totals = empData.leaveQuotaOverride || defaults;

        const leavesSnap = await firebase.firestore().collection('leaveRequests')
            .where('employeeId', '==', empId)
            .get();

        let sickUsed = 0;
        let casualUsed = 0;
        let paidUsed = 0;

        leavesSnap.forEach(doc => {
            const data = doc.data();
            if (data.status === 'approved') {
                const start = new Date(data.startDate);
                const end = new Date(data.endDate);
                const diffTime = Math.abs(end - start);
                const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                const count = isNaN(days) ? 0 : days;
                
                if (data.leaveType === 'sick') sickUsed += count;
                else if (data.leaveType === 'casual') casualUsed += count;
                else if (data.leaveType === 'paid') paidUsed += count;
            }
        });

        const finalSick = (totals.sick !== undefined && totals.sick !== null) ? Number(totals.sick) : defaults.sick;
        const finalCasual = (totals.casual !== undefined && totals.casual !== null) ? Number(totals.casual) : defaults.casual;
        const finalPaid = (totals.paid !== undefined && totals.paid !== null) ? Number(totals.paid) : defaults.paid;

        return {
            year: new Date().getFullYear(),
            sick: {
                total: finalSick,
                used: sickUsed,
                remaining: Math.max(0, finalSick - sickUsed)
            },
            casual: {
                total: finalCasual,
                used: casualUsed,
                remaining: Math.max(0, finalCasual - casualUsed)
            },
            paid: {
                total: finalPaid,
                used: paidUsed,
                remaining: Math.max(0, finalPaid - paidUsed)
            }
        };
    }

    // ── getLastSalary ───────────────────────────────────────────
    async function getLastSalary() {
        try {
            const uid = await _getUid();
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            if (!accSnap.exists) return null;
            const empAcc = accSnap.data() || {};
            const empId = empAcc.employeeId || uid;
            const searchIds = [uid, empId];
            if (empAcc.employeeCode) searchIds.push(empAcc.employeeCode);

            const snap = await firebase.firestore().collection('payrollRecords')
              .where('employeeId', 'in', searchIds)
              .get().catch(() => null);

            if (snap && !snap.empty) {
                const sorted = snap.docs.map(d => ({ payrollId: d.id, ...d.data() }))
                    .filter(p => p.status === 'issued' || p.status === 'paid' || p.paymentStatus === 'paid' || p.paymentStatus === 'issued')
                    .sort((a, b) => (b.month || '').localeCompare(a.month || ''));
                return sorted[0] || null;
            }

            const snap2 = await firebase.firestore().collection('payrollRecords')
              .where('employeeId', '==', empId)
              .get().catch(() => null);
            if (!snap2 || snap2.empty) return null;
            const sorted2 = snap2.docs.map(d => ({ payrollId: d.id, ...d.data() }))
                .filter(p => p.status === 'issued' || p.status === 'paid' || p.paymentStatus === 'paid' || p.paymentStatus === 'issued')
                .sort((a, b) => (b.month || '').localeCompare(a.month || ''));
            return sorted2[0] || null;
        } catch(e) {
            console.error('getLastSalary error:', e);
            return null;
        }
    }

    // ── getPayslips ──────────────────────────────────────────────
    async function getPayslips() {
        try {
            const uid = await _getUid();
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            if (!accSnap.exists) return [];
            const empAcc = accSnap.data() || {};
            const empId = empAcc.employeeId || uid;
            const searchIds = [uid, empId];
            if (empAcc.employeeCode) searchIds.push(empAcc.employeeCode);

            const snap = await firebase.firestore().collection('payrollRecords')
              .where('employeeId', 'in', searchIds)
              .get().catch(() => null);

            let docs = [];
            if (snap && !snap.empty) {
                docs = snap.docs.map(d => ({ payrollId: d.id, id: d.id, ...d.data() }));
            } else {
                const snap2 = await firebase.firestore().collection('payrollRecords')
                  .where('employeeId', '==', empId)
                  .get().catch(() => null);
                if (snap2 && !snap2.empty) {
                    docs = snap2.docs.map(d => ({ payrollId: d.id, id: d.id, ...d.data() }));
                }
            }
            docs.sort((a, b) => (b.month || '').localeCompare(a.month || ''));
            return docs;
        } catch(e) {
            console.error('getPayslips error:', e);
            return [];
        }
    }

    // ── getAdvanceHistory ────────────────────────────────────────
    async function getAdvanceHistory() {
        try {
            const uid = await _getUid();
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            if (!accSnap.exists) return [];
            const empAcc = accSnap.data() || {};
            const empId = empAcc.employeeId || uid;

            const snap = await firebase.firestore().collection('salaryAdvanceRequests')
              .where('employeeId', '==', empId)
              .get().catch(() => null);

            let docs = [];
            if (snap && !snap.empty) {
                docs = snap.docs.map(d => ({ advanceId: d.id, id: d.id, ...d.data() }));
            } else {
                const snap2 = await firebase.firestore().collection('salaryAdvanceRequests')
                  .where('employeeId', '==', uid)
                  .get().catch(() => null);
                if (snap2 && !snap2.empty) {
                    docs = snap2.docs.map(d => ({ advanceId: d.id, id: d.id, ...d.data() }));
                }
            }
            docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            return docs;
        } catch(e) {
            console.error('getAdvanceHistory error:', e);
            return [];
        }
    }

    // ── requestSalaryAdvance ────────────────────────────────────
    async function requestSalaryAdvance({ amount, reason }) {
        const uid = await _getUid();
        const profile = await getEmployeeProfile();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const accData = accSnap.exists ? accSnap.data() : {};

        const docRef = await firebase.firestore().collection('salaryAdvanceRequests').add({
            employeeId: profile.employeeId || uid,
            employeeName: profile.fullName || accData.name || 'Employee',
            employeeCode: accData.employeeCode || profile.employeeCode || '',
            role: accData.role || profile.role || 'employee',
            department: profile.department || 'Operations',
            designation: profile.designation || 'Employee',
            amount: Number(amount),
            reason: reason || '',
            status: 'pending',
            createdAt: new Date().toISOString(),
            appliedDate: new Date().toISOString()
        });

        await firebase.firestore().collection('notifications').add({
            recipientRole: 'admin',
            title: 'New Salary Advance Request',
            message: `${profile.fullName || 'Employee'} requested a salary advance of ₹${Number(amount).toLocaleString('en-IN')}`,
            createdAt: new Date().toISOString(),
            read: false
        }).catch(() => null);

        return { advanceId: docRef.id };
    }

    // ── getUpcomingHolidays ─────────────────────────────────────
    async function getUpcomingHolidays() {
        await _getUid();
        const snap = await firebase.firestore().collection('holidays')
          .where('date', '>=', new Date().toISOString().split('T')[0])
          .orderBy('date', 'asc')
          .limit(3)
          .get();
        return snap.docs.map(d => ({ holidayId: d.id, ...d.data() }));
    }

    // ── getNotifications ────────────────────────────────────────
    async function getNotifications() {
        try {
            const uid = await _getUid();
            let empId = null;
            try {
                const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
                if (accSnap.exists) empId = accSnap.data().employeeId || null;
            } catch(e) {}

            const queries = [
                firebase.firestore().collection('notifications').where('recipientAccountId', '==', uid).get().catch(() => null),
                firebase.firestore().collection('notifications').where('recipientRole', '==', 'admin').get().catch(() => null),
                firebase.firestore().collection('notifications').where('recipientAccountId', '==', 'admin_broadcast').get().catch(() => null)
            ];
            if (empId && empId !== uid) {
                queries.push(firebase.firestore().collection('notifications').where('recipientAccountId', '==', empId).get().catch(() => null));
            }

            const snaps = await Promise.all(queries);
            const docMap = new Map();
            snaps.forEach(snap => {
                if (snap && snap.docs) {
                    snap.docs.forEach(d => {
                        docMap.set(d.id, { notificationId: d.id, id: d.id, ...d.data() });
                    });
                }
            });

            let docs = Array.from(docMap.values());
            const now = new Date();
            // Filter out notifications with a future reminderAt timestamp that hasn't arrived yet
            docs = docs.filter(d => {
                if (d.reminderAt) {
                    return new Date(d.reminderAt) <= now;
                }
                return true;
            });
            docs.sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0));
            return docs.slice(0, 15);
        } catch(err) {
            console.error('getNotifications error:', err);
            return [];
        }
    }

    // ── Global Sidebar Hold Reminder Exclamation Badge ────────────────────────────
    async function checkSidebarHoldBadge() {
        try {
            if (typeof firebase === 'undefined' || !firebase.auth().currentUser) return;
            
            const hiringLink = document.querySelector('a[href="hiring.html"], a[href*="hiring.html"]');
            if (!hiringLink) return;

            hiringLink.style.position = 'relative';

            const [snap1, snap2] = await Promise.all([
                firebase.firestore().collection('candidateProfiles').get().catch(() => null),
                firebase.firestore().collection('candidates').get().catch(() => null)
            ]);

            const docsMap = {};
            if (snap1 && snap1.docs) snap1.docs.forEach(d => { docsMap[d.id] = d.data(); });
            if (snap2 && snap2.docs) snap2.docs.forEach(d => { if (!docsMap[d.id]) docsMap[d.id] = d.data(); });

            const now = new Date();
            let hasDueHold = false;

            Object.keys(docsMap).forEach(id => {
                const c = docsMap[id];
                if (c && c.holdDetails && c.holdDetails.isOnHold) {
                    const remStr = c.holdDetails.reminderAt || c.holdDetails.holdReminder;
                    if (remStr && new Date(remStr) <= now) {
                        if (localStorage.getItem('dismissed_hold_' + id) !== 'true') {
                            hasDueHold = true;
                        }
                    }
                }
            });

            let badge = hiringLink.querySelector('.hiring-hold-alert-badge');
            if (hasDueHold) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'hiring-hold-alert-badge';
                    badge.title = 'Hold reminder due';
                    badge.innerHTML = '!';
                    badge.style.cssText = 'position:absolute;top:4px;right:6px;background:#fbbf24;color:#0e0e1a;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;box-shadow:0 0 6px rgba(251,191,36,0.6);z-index:10;pointer-events:none;';
                    hiringLink.appendChild(badge);
                } else {
                    badge.style.display = 'inline-flex';
                }
            } else if (badge) {
                badge.style.display = 'none';
            }
        } catch(err) {
            console.warn('checkSidebarHoldBadge error:', err);
        }
    }

    if (typeof document !== 'undefined') {
        const startSidebarTicker = () => {
            checkSidebarHoldBadge();
            if (!window._sidebarHoldBadgeInterval) {
                window._sidebarHoldBadgeInterval = setInterval(checkSidebarHoldBadge, 4000);
            }
        };
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(startSidebarTicker, 500);
            if (typeof firebase !== 'undefined') {
                firebase.auth().onAuthStateChanged(() => {
                    startSidebarTicker();
                });
            }
        });
    }

    function subscribeToNotifications(callback) {
        if (typeof firebase === 'undefined' || !firebase.auth().currentUser) return () => {};
        const uid = firebase.auth().currentUser.uid;
        checkSidebarHoldBadge();
        return firebase.firestore().collection('notifications')
            .where('recipientAccountId', '==', uid)
            .onSnapshot(async (snap) => {
                checkSidebarHoldBadge();
                const notifs = await getNotifications();
                if (typeof callback === 'function') callback(notifs);
            }, err => console.warn('subscribeToNotifications error:', err));
    }

    // ── markAllNotificationsRead ────────────────────────────────
    async function markAllNotificationsRead() {
        try {
            const uid = await _getUid();
            let empId = null;
            try {
                const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
                if (accSnap.exists) empId = accSnap.data().employeeId || null;
            } catch(e) {}

            const queries = [
                firebase.firestore().collection('notifications').where('recipientAccountId', '==', uid).where('read', '==', false).get()
            ];
            if (empId && empId !== uid) {
                queries.push(firebase.firestore().collection('notifications').where('recipientAccountId', '==', empId).where('read', '==', false).get());
            }

            const snaps = await Promise.all(queries);
            const batch = firebase.firestore().batch();
            let count = 0;
            snaps.forEach(snap => {
                snap.docs.forEach(d => {
                    batch.update(d.ref, { read: true });
                    count++;
                });
            });
            if (count > 0) await batch.commit();
            return { success: true };
        } catch(err) {
            console.error('markAllNotificationsRead error:', err);
            return { success: false };
        }
    }

    // ── markNotificationAsRead ───────────────────────────────────
    async function markNotificationAsRead(notificationId) {
        if (!notificationId) return { success: false };
        try {
            await firebase.firestore().collection('notifications').doc(notificationId).update({ read: true });
            return { success: true };
        } catch(e) {
            console.error('markNotificationAsRead error:', e);
            return { success: false };
        }
    }

    // ── deleteNotification ──────────────────────────────────────
    async function deleteNotification(notificationId) {
        await _getUid();
        await firebase.firestore().collection('notifications').doc(notificationId).delete();
        return { success: true };
    }


    // ══ EMPLOYEE — ATTENDANCE ════════════════════════════════════

    // ── getAttendanceSettings ───────────────────────────────────
    // Returns the current effective time window for today.
    // Flask resolves tomorrowOverride; in mock we just return the default.
    // ── getAttendanceSettings ───────────────────────────────────
    async function getAttendanceSettings() {
        await _getUid();
        const snap = await firebase.firestore().collection('attendanceSettings').doc('global').get();
        let s = snap.exists ? snap.data() : { windowStart: '09:00', windowEnd: '09:30', checkoutWindowStart: '18:00', checkoutWindowEnd: '18:30' };
        
        const todayD = new Date();
        const todayStr = todayD.toISOString().slice(0, 10);
        const y = todayD.getFullYear();
        const m = String(todayD.getMonth() + 1).padStart(2, '0');
        const monthStr = `${y}-${m}`;
        
        let isWorking = true;
        try {
            const calSnap = await firebase.firestore().collection('workingCalendar').doc(monthStr).get();
            if (calSnap.exists && Array.isArray(calSnap.data().overrides)) {
                const match = calSnap.data().overrides.find(o => o.date === todayStr);
                if (match) isWorking = match.isWorking;
            } else {
                const dayOfWeek = todayD.getDay();
                if (dayOfWeek === 0) isWorking = false;
                else if (dayOfWeek === 6) {
                    const satCount = Math.ceil(todayD.getDate() / 7);
                    if (satCount === 2 || satCount === 4) isWorking = false;
                }
            }
        } catch(e) { console.error('Error fetching calendar', e); }

        const override = s.tomorrowOverride && s.tomorrowOverride.date === todayStr ? s.tomorrowOverride : null;
        if (override && override.isWorkingDay === false) isWorking = false;

        return {
          windowStart:   override ? override.windowStart : s.windowStart,
          windowEnd:     override ? override.windowEnd   : s.windowEnd,
          isWorkingDay:  isWorking,
          tomorrowOverride: s.tomorrowOverride,
          checkoutWindowStart: override ? override.checkoutWindowStart || s.checkoutWindowStart : s.checkoutWindowStart,
          checkoutWindowEnd:   override ? override.checkoutWindowEnd   || s.checkoutWindowEnd   : s.checkoutWindowEnd
        };
    }

    // ── getTodayAttendance ──────────────────────────────────────
    async function getTodayAttendance() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return null;
        const todayStr = new Date().toISOString().slice(0, 10);
        const snap = await firebase.firestore().collection('attendanceLogs')
          .where('employeeId', '==', accSnap.data().employeeId)
          .where('date', '==', todayStr)
          .limit(1).get();
        return snap.empty ? null : { logId: snap.docs[0].id, ...snap.docs[0].data() };
    }

    // ── markAttendance ──────────────────────────────────────────
    async function markAttendance(type, existingLogId) {
        const uid = await _getUid();
        let empId = uid;
        try {
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            if (accSnap.exists && accSnap.data().employeeId) empId = accSnap.data().employeeId;
        } catch (e) { console.warn('Account fetch fallback:', e); }

        const now = new Date();
        const nowISO = now.toISOString();
        const todayStr = nowISO.slice(0, 10);
        const settings = await getAttendanceSettings();

        function _toMinutes(timeStr) {
            if (!timeStr) return 0;
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
        }
        const nowMin = now.getHours() * 60 + now.getMinutes();

        if (type === 'checkin') {
            const endMin = _toMinutes(settings.windowEnd || '09:30');
            const status = (nowMin <= endMin) ? 'present' : 'late';
            const logId = `ATT-${todayStr}-${empId}`;
            const logData = {
                employeeId: empId,
                date: todayStr,
                checkInAt: nowISO,
                checkOutAt: null,
                status: status,
                earlyCheckout: false,
                createdAt: nowISO
            };

            await firebase.firestore().collection('attendanceLogs').doc(logId).set(logData, { merge: true });

            try {
                const statRef = firebase.firestore().collection('attendanceStats').doc(empId);
                const curMonth = todayStr.slice(0, 7);
                const fieldToInc = status === 'present' ? 'presentCount' : 'lateCount';
                const statSnap = await statRef.get();
                if (statSnap.exists && statSnap.data().month === curMonth) {
                    await statRef.update({
                        [fieldToInc]: firebase.firestore.FieldValue.increment(1),
                        updatedAt: nowISO
                    });
                } else {
                    await statRef.set({
                        month: curMonth,
                        presentCount: status === 'present' ? 1 : 0,
                        lateCount: status === 'late' ? 1 : 0,
                        absentCount: 0,
                        leaveCount: 0,
                        earlyCheckoutCount: 0,
                        updatedAt: nowISO
                    });
                }
            } catch (statErr) {
                console.warn('[DB] Failed to update attendanceStats:', statErr);
            }

            return { logId, status, checkInAt: nowISO, date: todayStr };
        } else {
            const checkOutLogId = existingLogId || `ATT-${todayStr}-${empId}`;
            const checkoutStartMin = _toMinutes(settings.checkoutWindowStart || '18:00');
            const earlyCheckout = nowMin < checkoutStartMin;

            await firebase.firestore().collection('attendanceLogs').doc(checkOutLogId).update({
                checkOutAt: nowISO,
                earlyCheckout: earlyCheckout,
                updatedAt: nowISO
            });

            if (earlyCheckout) {
                try {
                    const statRef = firebase.firestore().collection('attendanceStats').doc(empId);
                    await statRef.update({
                        earlyCheckoutCount: firebase.firestore.FieldValue.increment(1)
                    });
                } catch (e) { console.warn('Stat early checkout update failed:', e); }
            }

            return { logId: checkOutLogId, checkOutAt: nowISO, earlyCheckout };
        }
    }

    // ── getAttendanceHistory ────────────────────────────────────
    async function getAttendanceHistory() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const empId = accSnap.data().employeeId || uid;
        const snap = await firebase.firestore().collection('attendanceLogs')
          .where('employeeId', '==', empId)
          .get();
        const list = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return list.slice(0, 30);
    }

    // ── getAttendanceStats ──────────────────────────────────────
    async function getAttendanceStats() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return null;
        const snap = await firebase.firestore().collection('attendanceStats').doc(accSnap.data().employeeId).get();
        return snap.exists && snap.data().month ? snap.data() : { month: new Date().toISOString().slice(0, 7), presentCount:0, lateCount:0, absentCount:0, leaveCount:0 };
    }

    // ── getLeaveHistory ─────────────────────────────────────────
    // ── getLeaveHistory ─────────────────────────────────────────
    async function getLeaveHistory() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const snap = await firebase.firestore().collection('leaveRequests')
          .where('employeeId', '==', accSnap.data().employeeId)
          .orderBy('createdAt', 'desc')
          .get();
        return snap.docs.map(d => ({ leaveRequestId: d.id, ...d.data() }));
    }

    // ── submitLeaveRequest ──────────────────────────────────────
    async function submitLeaveRequest(data) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const accData = accSnap.data() || {};
        let empId = accData.employeeId || uid;
        const role = accData.role || 'employee';

        let applicantName = accData.fullName || accData.name || '';
        if (!applicantName && empId) {
            const empSnap = await firebase.firestore().collection('employees').doc(empId).get().catch(() => null);
            if (empSnap && empSnap.exists) {
                applicantName = empSnap.data().fullName || empSnap.data().name || '';
            }
        }
        if (!applicantName && accData.email) {
            applicantName = accData.email.split('@')[0];
        }
        if (!applicantName) applicantName = 'Employee';

        const statusVal = (role === 'manager' || role === 'super_admin' || role === 'admin') ? 'pending_admin' : 'pending';

        const sDate = new Date(data.startDate);
        const eDate = new Date(data.endDate);
        const calcDays = (isNaN(sDate) || isNaN(eDate)) ? 1 : (Math.ceil(Math.abs(eDate - sDate) / (1000 * 60 * 60 * 24)) + 1);

        const ref = firebase.firestore().collection('leaveRequests').doc();
        const nowStr = new Date().toISOString();
        await ref.set({
          employeeId:        empId,
          leaveType:         data.leaveType,
          startDate:         data.startDate,
          endDate:           data.endDate,
          days:              calcDays,
          reason:            data.reason || null,
          backdated:         data.backdated || false,
          supportingDocUrl:  data.supportingDocUrl || null,
          supportingDocName: data.supportingDocName || null,
          status:            statusVal,
          managerDecision:   { managerId: null, decision: null, comment: null, decidedAt: null },
          adminDecision:     { adminId: null,   decision: null, comment: null, decidedAt: null },
          createdAt:         nowStr
        });

        // Send notification to Admin accounts
        try {
            const batch = firebase.firestore().batch();
            const roleLabel = role === 'manager' ? 'Manager' : 'Employee';
            const leaveLabel = data.leaveType ? (data.leaveType.charAt(0).toUpperCase() + data.leaveType.slice(1)) : 'Leave';
            const notifMsg = `${applicantName} (${roleLabel}) submitted a ${leaveLabel} leave request (${data.startDate} to ${data.endDate}).`;

            // Broadcast role-based notification for Admins
            const bRef = firebase.firestore().collection('notifications').doc();
            batch.set(bRef, {
                recipientRole: 'admin',
                recipientAccountId: 'admin_broadcast',
                type: 'leave_request',
                leaveRequestId: ref.id,
                title: 'New Leave Request Submitted',
                message: notifMsg,
                read: false,
                timestamp: nowStr,
                createdAt: nowStr
            });

            // Also query employees collection where role is admin to notify individual accounts
            const empSnap = await firebase.firestore().collection('employees')
                .where('role', 'in', ['super_admin', 'admin']).get().catch(() => null);
            if (empSnap && !empSnap.empty) {
                empSnap.docs.forEach(ed => {
                    if (ed.id !== uid) {
                        const nRef = firebase.firestore().collection('notifications').doc();
                        batch.set(nRef, {
                            recipientAccountId: ed.id,
                            type: 'leave_request',
                            leaveRequestId: ref.id,
                            title: 'New Leave Request Submitted',
                            message: notifMsg,
                            read: false,
                            timestamp: nowStr,
                            createdAt: nowStr
                        });
                    }
                });
            }
            await batch.commit();
        } catch (nErr) {
            console.warn('Leave request notification error:', nErr);
        }

        return { leaveRequestId: ref.id, ...data, status: statusVal };
    }

    // ── Helper: File to Data URL fallback ───────────────────────
    function _fileToDataUrl(file, fallbackName = 'document') {
        return new Promise((resolve) => {
            if (!file || typeof FileReader === 'undefined') {
                return resolve('mock://doc/' + encodeURIComponent(fallbackName));
            }
            const reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = function() { resolve('mock://doc/' + encodeURIComponent(fallbackName)); };
            reader.readAsDataURL(file);
        });
    }

    // ── uploadLeaveDocument ──────────────────────────────────────
    async function uploadLeaveDocument(file) {
        if (!file) return { url: null, name: null };
        try {
            const uid = await _getUid();
            const timestamp = Date.now();
            const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const path = `leaveDocuments/${uid}/${timestamp}_${safeName}`;
            const snap = await firebase.storage().ref(path).put(file);
            const url = await snap.ref.getDownloadURL();
            return { url: url, name: file.name };
        } catch (err) {
            console.warn('[DB] Storage upload fallback to DataURL for leave doc:', err);
            const dataUrl = await _fileToDataUrl(file, file.name);
            return { url: dataUrl, name: file.name };
        }
    }

    // ── respondToDocRequest ─────────────────────────────────────
    async function respondToDocRequest(leaveRequestId, fileUrl, fileName) {
        await _getUid(); await firebase.firestore().collection('leaveRequests').doc(leaveRequestId).update({ supportingDocUrl: fileUrl, supportingDocName: fileName, status: 'pending' }); return { success: true };
    }

    // ── requestLeaveDocument ────────────────────────────────────
    async function requestLeaveDocument(leaveRequestId, message) {
        await _getUid();
        await firebase.firestore().collection('leaveRequests').doc(leaveRequestId).update({ docRequestedBy: 'admin', docRequestMessage: message, status: 'pending_admin' });
        return { success: true };
    }

    // ── managerRequestLeaveDocument ─────────────────────────────
    async function managerRequestLeaveDocument(leaveRequestId, message) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('leaveRequests').doc(leaveRequestId).update({
          docRequestedBy: managerId,
          docRequestMessage: message || null,
          docRequestedAt: new Date().toISOString(),
          status: 'pending_document'
        });
        return { success: true };
    }

    // ══ EMPLOYEE — PART 3 (Document Vault) ═══════════════════
    async function getMyDocuments() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const empId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('employeeDocuments')
          .where('employeeId', '==', empId)
          .orderBy('uploadedAt', 'desc')
          .get();
        return snap.docs.map(d => ({ documentId: d.id, ...d.data() }));
    }

    async function uploadDocument(data) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const empId = accSnap.data().employeeId;
        
        let url = null;
        if (data.file) {
            try {
                const safeName = (data.fileName || 'document').replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const path = `employeeVault/${uid}/${Date.now()}_${safeName}`;
                const snap = await firebase.storage().ref(path).put(data.file);
                url = await snap.ref.getDownloadURL();
            } catch (storageErr) {
                console.warn('[DB] Storage upload fallback to DataURL for doc:', storageErr);
                url = await _fileToDataUrl(data.file, data.fileName || 'document');
            }
        }

        const payload = {
            fileName: data.fileName,
            fileSize: data.fileSize,
            fileUrl: url,
            uploadedFileUrl: url,
            status: 'pending',
            uploadedAt: new Date().toISOString()
        };

        if (data.documentId) {
            const ref = firebase.firestore().collection('employeeDocuments').doc(data.documentId);
            const docSnap = await ref.get();
            const docData = docSnap.exists ? docSnap.data() : {};
            await ref.update(payload);
            
            // Notify the requester if there was one
            if (docData.requestedBy) {
                try {
                    const recipientId = docData.requestedBy.id || docData.requestedBy.accountId || docData.requestedBy.employeeId;
                    if (recipientId) {
                        const nowStr = new Date().toISOString();
                        const uploaderName = accSnap.data().name || 'Employee';
                        await firebase.firestore().collection('notifications').add({
                            recipientAccountId: recipientId,
                            title: 'Document Uploaded',
                            message: `${uploaderName} has uploaded the requested document: ${docData.documentLabel || data.fileName}`,
                            read: false,
                            timestamp: nowStr,
                            createdAt: nowStr
                        });
                    }
                } catch (notifErr) {
                    console.error("Failed to send upload notification:", notifErr);
                }
            }
            return { docId: data.documentId, documentId: data.documentId, ...docData, ...payload };
        } else {
            const ref = firebase.firestore().collection('employeeDocuments').doc();
            payload.employeeId = empId;
            payload.docType = data.docType;
            payload.documentLabel = data.documentLabel || data.fileName;
            payload.managerReview = { reviewerName: null, reviewerRole: null, reviewedAt: null, feedback: null };
            payload.adminReview = { reviewerName: null, reviewerRole: null, reviewedAt: null, feedback: null };
            await ref.set(payload);
            return { docId: ref.id, documentId: ref.id, ...payload };
        }
    }

    // ══ EMPLOYEE — PART 4 (Payslips & Salary) ════════════════

    // ── getPayslips ─────────────────────────────────────────────
    async function getPayslips() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const empId = accSnap.data().employeeId || uid;
        const snap = await firebase.firestore().collection('payslips')
          .where('employeeId', '==', empId)
          .orderBy('month', 'desc')
          .get();
        return snap.docs.map(d => ({ payslipId: d.id, ...d.data() }));
    }

    // ── requestSalaryAdvance ────────────────────────────────────
    async function requestSalaryAdvance(data) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const accData = accSnap.data() || {};
        let empId = accData.employeeId || uid;

        let employeeCode = null;
        let employeeName = accData.fullName || accData.name || null;
        let designation = null;
        let department = null;

        try {
            const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
            if (empSnap.exists) {
                const empData = empSnap.data();
                employeeCode = empData.employeeCode || empId;
                employeeName = empData.fullName || empData.name || employeeName;
                designation = empData.designation || null;
                department = empData.department || null;
            } else {
                const qSnap = await firebase.firestore().collection('employees').where('accountId', '==', uid).get();
                if (!qSnap.empty) {
                    const empData = qSnap.docs[0].data();
                    empId = qSnap.docs[0].id;
                    employeeCode = empData.employeeCode || empId;
                    employeeName = empData.fullName || empData.name || employeeName;
                    designation = empData.designation || null;
                    department = empData.department || null;
                }
            }
        } catch (e) {
            console.warn('[db.js] requestSalaryAdvance employee lookup warning:', e);
        }

        const ref = firebase.firestore().collection('salaryAdvanceRequests').doc();
        const payload = {
          employeeId:    empId,
          employeeCode:  employeeCode || empId,
          employeeName:  employeeName || (accData.email ? accData.email.split('@')[0] : 'Employee'),
          designation:   designation || (accData.role === 'manager' ? 'Manager' : 'Team Member'),
          department:    department || 'General',
          amount:        data.amount,
          reason:        data.reason || null,
          status:        'pending',
          adminDecision: { adminId: null, decision: null, comment: null, decidedAt: null },
          createdAt:     new Date().toISOString()
        };
        await ref.set(payload);
        return { requestId: ref.id, ...payload };
    }

    // ── getAdvanceHistory ───────────────────────────────────────
    async function getAdvanceHistory() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const empId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('salaryAdvanceRequests')
          .where('employeeId', '==', empId)
          .orderBy('createdAt', 'desc')
          .get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ══ EMPLOYEE — PART 5 (Resignation) ══════════════════════

    // ── getResignationStatus ────────────────────────────────────
    async function getResignationStatus() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return null;
        const empId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('resignationRequests')
          .where('employeeId', '==', empId)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        return snap.empty ? null : { resignationId: snap.docs[0].id, ...snap.docs[0].data() };
    }

    // ── submitResignation ───────────────────────────────────────
    async function submitResignation(data) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const empId = accSnap.data().employeeId;
        const relievingDate = new Date(); relievingDate.setDate(relievingDate.getDate() + 30);
        const ref = firebase.firestore().collection('resignationRequests').doc();
        
        let url = data.supportingDocUrl || null;
        const docName = data.supportingDocName || (data.file ? data.file.name : null);
        if (data.file) {
            try {
                const safeName = (docName || 'document').replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const path = `resignationDocuments/${uid}/${Date.now()}_${safeName}`;
                const snap = await firebase.storage().ref(path).put(data.file);
                url = await snap.ref.getDownloadURL();
            } catch (storageErr) {
                console.warn('[DB] Storage upload fallback to DataURL for resignation doc:', storageErr);
                url = await _fileToDataUrl(data.file, docName || 'document');
            }
        }

        const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
        const empData = empSnap.exists ? empSnap.data() : accSnap.data();

        const payload = {
          employeeId:            empId,
          employeeName:          empData.name || empData.fullName || empData.email || 'Employee (' + empId + ')',
          designation:           empData.designation || (accSnap.data().role === 'manager' ? 'Manager' : 'Staff'),
          department:            empData.department || 'General',
          role:                  accSnap.data().role || empData.role || 'employee',
          avatarUrl:             empData.avatarUrl || null,
          reportingManager:      empData.managerName || (accSnap.data().role === 'manager' ? 'Direct to Admin' : 'N/A'),
          reason:                data.reason || null,
          noticePeriodDays:      30,
          resignationDate:       new Date().toISOString(),
          expectedRelievingDate: relievingDate.toISOString(),
          supportingDocUrl:      url,
          supportingDocName:     docName,
          status:                'pending',
          managerDecision:       { managerId: null, decision: null, comment: null, decidedAt: null },
          adminDecision:         { adminId: null, decision: null, comment: null, decidedAt: null },
          createdAt:             new Date().toISOString()
        };
        await ref.set(payload);
        return { resignationId: ref.id, ...payload };
    }

    // ══ EMPLOYEE — PART 6 (Profile) ══════════════════════════

    async function updateEmployeePhone(phone) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const empId = accSnap.data().employeeId;
        await firebase.firestore().collection('employees').doc(empId).update({
          phone,
          updatedAt: new Date().toISOString()
        });
        return { phone };
    }

    // ── updateEmployeeContactInfo ────────────────────────────────
    async function updateEmployeeContactInfo({ address, emergencyContact }) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const empId = accSnap.data().employeeId;
        await firebase.firestore().collection('employees').doc(empId).update({
          address,
          emergencyContact,
          updatedAt: new Date().toISOString()
        });
        return { address, emergencyContact };
    }

    async function updateProfilePhoto(fileDataUrl, fileObject) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) throw new Error("Account not found");
        const empId = accSnap.data().employeeId;
        
        if (!fileObject) throw new Error("No file object provided");
        const ref = firebase.storage().ref(`profile_photos/${empId}`);
        await ref.put(fileObject);
        const url = await ref.getDownloadURL();
        
        await firebase.firestore().collection('employees').doc(empId).update({
          profilePhotoUrl: url,
          updatedAt: new Date().toISOString()
        });
        return { profilePhotoUrl: url };
    }

    // ── getMyReminders ───────────────────────────────────────────
    async function getMyReminders() {
        const uid = await _getUid();
        const snap = await firebase.firestore().collection('reminderDeliveries')
          .where('recipientAccountId', '==', uid)
          .where('dismissed', '==', false)
          .orderBy('createdAt', 'desc')
          .get();
        
        const reminders = [];
        for (const d of snap.docs) {
            const data = d.data();
            const pSnap = await firebase.firestore().collection('reminders').doc(data.reminderId).get();
            if (pSnap.exists) {
                reminders.push({
                    deliveryId: d.id,
                    ...data,
                    title: pSnap.data().title,
                    message: pSnap.data().message,
                    createdByName: pSnap.data().createdByName,
                    createdByRole: pSnap.data().createdByRole
                });
            }
        }
        return reminders;
    }

    // ── getManagerReminders ──────────────────────────────────────
    async function getManagerReminders() {
        await _getUid();
        return getMyReminders();
    }

    // ── dismissReminder ──────────────────────────────────────────
    async function dismissReminder(deliveryId) {
        await _getUid();
        await firebase.firestore().collection('reminderDeliveries').doc(deliveryId).update({
            dismissed: true,
            dismissedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── sendReminder ─────────────────────────────────────────────
    // Admin/Manager composes and sends a reminder. Flask creates the reminders doc
    // and fans out one reminderDeliveries doc per recipient.
    async function sendReminder({ title, message, targetType, targetId = null }) {
        const uid = await _getUid();
        const reminderRef = firebase.firestore().collection('reminders').doc();
        await reminderRef.set({
            title, message, targetType, targetId, senderAccountId: uid, createdAt: new Date().toISOString()
        });

        let uids = [];
        if (targetType === 'individual') {
            const accSnap = await firebase.firestore().collection('accounts').where('employeeId', '==', targetId).get();
            if (!accSnap.empty) uids.push(accSnap.docs[0].id);
        } else if (targetType === 'my_team') {
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            const senderId = accSnap.data().employeeId;
            const teamSnap = await firebase.firestore().collection('employees').where('managerId', '==', senderId).get();
            const empIds = teamSnap.docs.map(d => d.id);
            if (empIds.length > 0) {
                const accs = await firebase.firestore().collection('accounts').get();
                uids = accs.docs.filter(d => empIds.includes(d.data().employeeId)).map(d => d.id);
            }
        } else if (targetType === 'all_employees') {
            const accs = await firebase.firestore().collection('accounts').get();
            uids = accs.docs.map(d => d.id);
        } else if (targetType === 'all_managers') {
            const mgrSnap = await firebase.firestore().collection('employees').where('role', '==', 'manager').get();
            const empIds = mgrSnap.docs.map(d => d.id);
            if (empIds.length > 0) {
                const accs = await firebase.firestore().collection('accounts').get();
                uids = accs.docs.filter(d => empIds.includes(d.data().employeeId)).map(d => d.id);
            }
        }
        
        const batch = firebase.firestore().batch();
        for (const rUid of uids) {
            const delRef = firebase.firestore().collection('reminderDeliveries').doc();
            batch.set(delRef, {
                reminderId: reminderRef.id,
                recipientAccountId: rUid,
                title,
                message,
                dismissed: false,
                createdAt: new Date().toISOString()
            });
        }
        await batch.commit();
        
        return { reminderId: reminderRef.id, recipientCount: uids.length };
    }

    // ── getSentReminders ─────────────────────────────────────────
    // Returns reminders authored by the currently logged-in admin/manager (history view).
    async function getSentReminders() {
        await _getUid();
        // MOCK
        return [
            {
                reminderId:    'REM001',
                title:         'Submit Timesheet Before Friday',
                message:       'Please ensure all pending timesheets are submitted by Friday 5 PM to avoid any payroll discrepancies.',
                targetType:    'all_employees',
                targetName:    null,
                deliveryCount: 5,
                createdAt:     '2026-05-16T10:00:00Z',
            },
        ];
        // Firebase: query reminders where createdBy == firebase.auth().currentUser.uid
        //   orderBy createdAt DESC, limit 20
    }


    // ══ MANAGER — PART 1 (Dashboard Home) ════════════════════

    // ── getManagerProfile ───────────────────────────────────────
    async function getManagerProfile() {
        await _getUid();
        return getEmployeeProfile();
    }

    // ── getManagerDashboard ─────────────────────────────────────
    async function getManagerDashboard() {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return { teamSize: 0, pendingApprovals: 0, onLeaveToday: 0, recentActivityCount: 0 };
        const managerId = accSnap.data().employeeId || uid;
        
        const empSnap = await firebase.firestore().collection('employees').where('managerId', '==', managerId).get();
        const teamSize = empSnap.size;
        
        let pendingApprovals = 0;
        let onLeaveToday = 0;
        
        if (teamSize > 0) {
            const empIds = empSnap.docs.map(d => d.id);
            const chunks = [];
            for (let i = 0; i < empIds.length; i += 30) chunks.push(empIds.slice(i, i + 30));
            
            for (const chunk of chunks) {
                const lvSnap = await firebase.firestore().collection('leaveRequests').where('employeeId', 'in', chunk).get();
                lvSnap.forEach(doc => {
                    const data = doc.data();
                    if (data.status === 'pending') pendingApprovals++;
                    const todayStr = new Date().toISOString().slice(0, 10);
                    if (data.status.includes('approved') && data.startDate <= todayStr && data.endDate >= todayStr) onLeaveToday++;
                });
                
                const resSnap = await firebase.firestore().collection('resignationRequests').where('employeeId', 'in', chunk).get();
                resSnap.forEach(doc => {
                    if (doc.data().status === 'pending') pendingApprovals++;
                });
            }
        }
        
        return { teamSize, pendingApprovals, onLeaveToday, recentActivityCount: 0 };
    }

    // ── getManagerLeaveBalance ──────────────────────────────────
    async function getManagerLeaveBalance() {
        await _getUid();
        return getLeaveBalances();
    }

    // ── getManagerLastSalary ────────────────────────────────────
    async function getManagerLastSalary() {
        await _getUid();
        return getLastSalary();
    }

    // ── getManagerPayslips ───────────────────────────────────────
    async function getManagerPayslips() {
        await _getUid();
        return getPayslips();
    }

    // ── requestManagerSalaryAdvance ──────────────────────────────
    async function requestManagerSalaryAdvance(data) {
        await _getUid();
        return requestSalaryAdvance(data);
    }

    // ── getManagerAdvanceHistory ─────────────────────────────────
    async function getManagerAdvanceHistory() {
        await _getUid();
        return getAdvanceHistory();
    }

    // ── getRecentTeamActivity ───────────────────────────────────
    async function getRecentTeamActivity() {
        await _getUid();

        return [];
    }

    // ── getManagerNotifications ─────────────────────────────────
    async function getManagerNotifications() {
        await _getUid();
        return getNotifications();
    }

    // ── getManagerTeam ───────────────────────────────────────────
    // employmentStatus: 'active' | 'on_notice' | 'resigned'
    // todayAttendance:  'present' | 'late' | 'absent' | null
    //   null when employee is on approved leave, serving notice, or resigned
    // onLeaveToday: true when there is an admin/manager-approved leave covering today
    // lateLoginCount: running monthly counter — resets on 1st of each month AND after every
    //   4th late (penalty day). Every 4th late = half salary for that day.
    // noticePeriodEndDate: last working day (only when employmentStatus === 'on_notice')
    async function getManagerTeam() {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const managerId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('employees')
          .where('managerId', '==', managerId)
          .get();
          
        const todayStr = new Date().toISOString().slice(0, 10);
        const team = [];
        for (const doc of snap.docs) {
            const emp = { id: doc.id, ...doc.data() };
            const attSnap = await firebase.firestore().collection('attendanceLogs')
                .where('employeeId', '==', doc.id)
                .where('date', '==', todayStr)
                .limit(1).get();
            emp.todayAttendance = attSnap.empty ? null : attSnap.docs[0].data().status;
            
            const lvSnap = await firebase.firestore().collection('leaveRequests')
                .where('employeeId', '==', doc.id)
                .where('status', 'in', ['manager_approved', 'admin_approved'])
                .get();
                
            emp.onLeaveToday = false;
            for (const lDoc of lvSnap.docs) {
                const lData = lDoc.data();
                if (lData.startDate <= todayStr && lData.endDate >= todayStr) {
                    emp.onLeaveToday = true;
                    break;
                }
            }
            team.push(emp);
        }
        return team;
    }

    // ── getTeamLeaveRequests ─────────────────────────────────────
    // Returns leave requests submitted by the logged-in manager's direct reports.
    // filter: 'all' | 'pending' | 'decided'  (default 'all')
    async function getTeamLeaveRequests(filter = 'all') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const managerId = accSnap.data().employeeId;
        
        const empSnap = await firebase.firestore().collection('employees').where('managerId', '==', managerId).get();
        if (empSnap.empty) return [];
        const empIds = empSnap.docs.map(d => d.id);
        
        const chunks = [];
        for (let i = 0; i < empIds.length; i += 30) chunks.push(empIds.slice(i, i + 30));
        
        let allLeaves = [];
        for (const chunk of chunks) {
            const snap = await firebase.firestore().collection('leaveRequests').where('employeeId', 'in', chunk).get();
            allLeaves.push(...snap.docs.map(d => ({ id: d.id, leaveRequestId: d.id, ...d.data() })));
        }
        
        const empMap = {};
        empSnap.docs.forEach(d => empMap[d.id] = d.data());
        allLeaves = allLeaves.map(l => ({
            ...l,
            employeeName: empMap[l.employeeId]?.fullName || 'Unknown',
            employeeCode: empMap[l.employeeId]?.employeeCode || 'Unknown'
        }));
        
        if (filter === 'pending') allLeaves = allLeaves.filter(r => r.status === 'pending');
        if (filter === 'decided') allLeaves = allLeaves.filter(r => r.status !== 'pending');
        allLeaves.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return allLeaves;
    }

    // ── approveLeaveRequest ──────────────────────────────────────
    async function approveLeaveRequest(requestId, comment = '') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('leaveRequests').doc(requestId).update({
          status: 'manager_approved',
          managerDecision: { managerId, decision: 'approved', comment, decidedAt: new Date().toISOString() }
        });
        return { success: true };
    }

    // ── rejectLeaveRequest ───────────────────────────────────────
    async function rejectLeaveRequest(requestId, comment = '') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('leaveRequests').doc(requestId).update({
          status: 'rejected',
          managerDecision: { managerId, decision: 'rejected', comment, decidedAt: new Date().toISOString() }
        });
        return { success: true };
    }

    // ── getTeamResignationRequests ───────────────────────────────
    async function getTeamResignationRequests(filter = 'all') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        if (!accSnap.exists) return [];
        const managerId = accSnap.data().employeeId;
        
        const empSnap = await firebase.firestore().collection('employees').where('managerId', '==', managerId).get();
        if (empSnap.empty) return [];
        const empIds = empSnap.docs.map(d => d.id);
        
        const chunks = [];
        for (let i = 0; i < empIds.length; i += 30) chunks.push(empIds.slice(i, i + 30));
        
        let allResig = [];
        for (const chunk of chunks) {
            const snap = await firebase.firestore().collection('resignationRequests').where('employeeId', 'in', chunk).get();
            allResig.push(...snap.docs.map(d => ({ id: d.id, resignationRequestId: d.id, ...d.data() })));
        }
        
        const empMap = {};
        empSnap.docs.forEach(d => empMap[d.id] = d.data());
        allResig = allResig.map(l => ({
            ...l,
            employeeName: empMap[l.employeeId]?.fullName || 'Unknown',
            employeeCode: empMap[l.employeeId]?.employeeCode || 'Unknown'
        }));
        
        if (filter === 'pending') allResig = allResig.filter(r => r.status === 'pending');
        if (filter === 'decided') allResig = allResig.filter(r => r.status !== 'pending');
        allResig.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return allResig;
    }

    // ── approveResignationRequest ────────────────────────────────
    async function approveResignationRequest(requestId, comment = '') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('resignationRequests').doc(requestId).update({
          status: 'manager_approved',
          managerDecision: { managerId, decision: 'approved', comment, decidedAt: new Date().toISOString() }
        });
        return { success: true };
    }

    // ── rejectResignationRequest ─────────────────────────────────
    async function rejectResignationRequest(requestId, comment = '') {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('resignationRequests').doc(requestId).update({
          status: 'rejected',
          managerDecision: { managerId, decision: 'rejected', comment, decidedAt: new Date().toISOString() }
        });
        return { success: true };
    }

    // ── managerRequestResignationDoc ─────────────────────────────
    async function managerRequestResignationDoc(requestId, message) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('resignationRequests').doc(requestId).update({
          docRequestedBy: managerId,
          docRequestMessage: message || null,
          docRequestedAt: new Date().toISOString(),
          status: 'pending_document'
        });
        return { success: true };
    }

    // ── getTeamPendingDocuments ──────────────────────────────────
    // Returns employeeDocuments for the manager's direct reports (all statuses).
    async function getTeamPendingDocuments() {
        try {
            const uid = await _getUid();
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
            if (!accSnap.exists) return [];
            const managerId = accSnap.data().employeeId;
            
            const empSnap = await firebase.firestore().collection('employees').where('managerId', '==', managerId).get();
            if (empSnap.empty) return [];
            const empIds = empSnap.docs.map(d => d.id);
            
            const chunks = [];
            for (let i = 0; i < empIds.length; i += 30) chunks.push(empIds.slice(i, i + 30));
            
            let allDocs = [];
            for (const chunk of chunks) {
                const snap = await firebase.firestore().collection('employeeDocuments').where('employeeId', 'in', chunk).get();
                allDocs.push(...snap.docs.map(d => ({ id: d.id, documentId: d.id, ...d.data() })));
            }
            
            const empMap = {};
            empSnap.docs.forEach(d => empMap[d.id] = d.data());
            allDocs = allDocs.map(l => ({
                ...l,
                employeeName: empMap[l.employeeId]?.fullName || 'Unknown',
                employeeCode: empMap[l.employeeId]?.employeeCode || 'Unknown'
            }));
            return allDocs;
        } catch (err) {
            console.warn('[getTeamPendingDocuments] Error or permission warning:', err);
            return [];
        }
    }

    // ── verifyDocument ───────────────────────────────────────────
    async function verifyDocument(documentId) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        await firebase.firestore().collection('employeeDocuments').doc(documentId).update({
          status: 'manager_verified',
          managerVerifiedAt: new Date().toISOString(),
          managerVerifiedBy: managerId,
        });
        return { success: true };
    }


    // ── rejectDocument ───────────────────────────────────────────
    async function rejectDocument(documentId, reason) {
        await _getUid();
        console.log(`[MOCK] Manager rejected document ${documentId} — reason: "${reason}"`);
        return { success: true };
        // ── Firestore stub ──────────────────────────────────────────
        // const managerId = db._currentManagerId();
        // await firebase.firestore().collection('employeeDocuments').doc(documentId).update({
        //   status: 'rejected',
        //   managerComment: reason,
        //   managerRejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        //   managerRejectedBy: managerId,
        // });
        // return { success: true };
    }

    // ── requestDocumentFromEmployee ──────────────────────────────
    // Manager proactively requests a document from one of their direct reports.
    // Creates a new employeeDocuments record with status: 'requested'.
    let _mockDocIdCounter = 10;
    async function requestDocumentFromEmployee(employeeId, documentLabel) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const accData = accSnap.data();
        const managerId = accData.employeeId || uid;
        let role = accData.role || 'manager';
        const isAdminRole = (role === 'super_admin' || role === 'admin');
        let name = isAdminRole ? 'Admin' : 'Manager';

        if (!isAdminRole && accData.employeeId) {
            const empSnap = await firebase.firestore().collection('employees').doc(accData.employeeId).get();
            if (empSnap.exists) name = empSnap.data().fullName;
        }

        // Infer docType from label
        let docType = 'other';
        const lbl = (documentLabel || '').toLowerCase();
        if (lbl.includes('resume') || lbl.includes('cv')) docType = 'resume';
        else if (lbl.includes('id') || lbl.includes('identity')) docType = 'id_proof';
        else if (lbl.includes('contract') || lbl.includes('agreement')) docType = 'contract';

        const reqRoleStr = isAdminRole ? 'Admin' : (role.charAt(0).toUpperCase() + role.slice(1));

        const ref = firebase.firestore().collection('employeeDocuments').doc();
        await ref.set({
          employeeId,
          documentLabel,
          docType,
          requestedBy: {
              id: uid,
              employeeId: managerId,
              name: name,
              role: reqRoleStr
          },
          requestedAt: new Date().toISOString(),
          status: 'requested',
          uploadedAt: null,
          uploadedFileUrl: null,
          fileUrl: null,
          managerComment: null,
          decidedAt: null,
        });

        // Send notification to the employee
        try {
            const nowStr = new Date().toISOString();
            await firebase.firestore().collection('notifications').add({
                recipientAccountId: employeeId,
                title: 'Document Requested',
                message: `${name} (${reqRoleStr}) has requested a document: ${documentLabel}`,
                read: false,
                timestamp: nowStr,
                createdAt: nowStr
            });
        } catch (e) {
            console.error("Failed to send notification for document request:", e);
        }

        return { success: true, newDocId: ref.id };
    }

    async function getTeamMemberDetail(employeeId) {
        await _getUid();

        const doc = await firebase.firestore().collection('employees').doc(employeeId).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    }

    // ── getManagerLeaveHistory ───────────────────────────────────
    // Manager's own personal leave request history.
    // Note: Manager leave goes straight to Admin (no manager_approved intermediate state).
    async function getManagerLeaveHistory() {
        await _getUid();
        return getLeaveHistory();
    }

    // ── submitManagerLeaveRequest ────────────────────────────────
    async function submitManagerLeaveRequest(data) {
        await _getUid();
        return submitLeaveRequest(data);
    }

    // ══ MANAGER — DOCUMENTS ══════════════════════════════════════

    // ── getManagerDocuments ──────────────────────────────────────
    async function getManagerDocuments() {
        await _getUid();
        return getMyDocuments();
    }

    // ── uploadManagerDocument ────────────────────────────────────
    async function uploadManagerDocument(data) {
        await _getUid();
        return uploadDocument(data);
    }

    // ══ MANAGER — RESIGNATION ════════════════════════════════════

    // ── getManagerResignationStatus ──────────────────────────────
    async function getManagerResignationStatus() {
        await _getUid();
        return getResignationStatus();
    }

    // ── submitManagerResignation ─────────────────────────────────
    async function submitManagerResignation(data) {
        await _getUid();
        return submitResignation(data);
    }

    // ── respondToManagerResignationDoc ───────────────────────────
    async function respondToManagerResignationDoc(resignationId, fileUrl, fileName, file) {
        await _getUid();
        return respondToResignationDoc(resignationId, fileUrl, fileName, file);
    }

    // ── getHiringProposals ───────────────────────────────────────
    async function getHiringProposals() {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('hiringProposals')
          .where('managerId', '==', managerId)
          .where('type', '==', 'hire')
          .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.submittedAt||0) - new Date(a.submittedAt||0));
    }

    // ── submitHiringProposal ─────────────────────────────────────
    async function submitHiringProposal(data) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        const managerSnap = await firebase.firestore().collection('employees').doc(managerId).get();
        const ref = firebase.firestore().collection('hiringProposals').doc();
        let jdUrl = null;
        if (data.jdFileData) {
            const ext = data.jdFileName.split('.').pop();
            const storageRef = firebase.storage().ref('jds/' + ref.id + '.' + ext);
            const base64Data = data.jdFileData.split(',')[1];
            await storageRef.putString(base64Data, 'base64', { contentType: 'application/pdf' });
            jdUrl = await storageRef.getDownloadURL();
        }
        await ref.set({
            designation: data.designation,
            department: data.department,
            companyTag: data.companyTag,
            reason: data.reason,
            jdFileName: data.jdFileName || null,
            jdFileUrl: jdUrl,
            type: 'hire',
            managerId,
            managerName: managerSnap.exists ? managerSnap.data().fullName : managerId,
            status: 'pending',
            submittedAt: new Date().toISOString(),
            adminComment: null
        });
        return { id: ref.id, success: true };
    }

    // ── getRemovalProposals ──────────────────────────────────────
    async function getRemovalProposals() {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        const snap = await firebase.firestore().collection('hiringProposals')
          .where('managerId', '==', managerId)
          .where('type', '==', 'remove')
          .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.submittedAt||0) - new Date(a.submittedAt||0));
    }

    // ── submitRemovalProposal ────────────────────────────────────
    async function submitRemovalProposal(employeeId, reason) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        const managerSnap = await firebase.firestore().collection('employees').doc(managerId).get();
        const empSnap = await firebase.firestore().collection('employees').doc(employeeId).get();
        
        const ref = firebase.firestore().collection('hiringProposals').doc();
        await ref.set({
            employeeId,
            employeeName: empSnap.exists ? empSnap.data().fullName : employeeId,
            employeeCode: empSnap.exists ? empSnap.data().employeeCode : '',
            reason,
            type: 'remove',
            managerId,
            managerName: managerSnap.exists ? managerSnap.data().fullName : managerId,
            status: 'pending',
            submittedAt: new Date().toISOString(),
            adminComment: null
        });
        return { id: ref.id, success: true };
    }

    function _formatCandidateDoc(d) {
        const id = d.id || (typeof d.data === 'function' ? d.id : null);
        const itemData = typeof d.data === 'function' ? (d.data() || {}) : (d || {});
        const fullName = itemData.fullName || itemData.candidateName || itemData.name || 'Candidate';
        const designation = itemData.designation || itemData.role || 'Position';
        const department = itemData.department || itemData.dept || 'Department';
        const companyTag = itemData.companyTag || itemData.company || 'BeanTech';
        const originatingManagerName = itemData.originatingManagerName || itemData.managerName || (itemData.assignedManagerNames && itemData.assignedManagerNames[0]) || 'Hiring Manager';
        const appliedOn = itemData.appliedOn || (itemData.submittedAt ? new Date(itemData.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Applied');
        const source = itemData.source || 'Direct Application';

        return {
            id: id || itemData.candidateId || itemData.id,
            candidateId: id || itemData.candidateId || itemData.id,
            ...itemData,
            fullName: fullName,
            candidateName: fullName,
            designation: designation,
            role: designation,
            department: department,
            companyTag: companyTag,
            originatingManagerName: originatingManagerName,
            appliedOn: appliedOn,
            source: source,
            currentStage: itemData.currentStage || 'document_collection',
            roundsCount: itemData.roundsCount || (itemData.hiringRounds ? itemData.hiringRounds.length : 1),
            latestRoundName: itemData.latestRoundName || (itemData.hiringRounds && itemData.hiringRounds.length ? (itemData.hiringRounds[itemData.hiringRounds.length - 1].stageName || itemData.hiringRounds[itemData.hiringRounds.length - 1].name) : 'Job Application'),
            latestRoundStatus: itemData.latestRoundStatus || 'completed',
            docsRequested: itemData.docsRequested || (itemData.requestedDocuments ? itemData.requestedDocuments.length : 0),
            docsVerified: itemData.docsVerified || 0,
            offerLetterStatus: itemData.offerLetterStatus || 'not_started',
            submittedAt: itemData.submittedAt || new Date().toISOString()
        };
    }

    async function getCandidateDetail(candidateId) {
        await _getUid();

        let snap = await firebase.firestore().collection('candidates').doc(candidateId).get();
        let data = snap.exists ? snap.data() : null;

        let snap2 = await firebase.firestore().collection('candidateProfiles').doc(candidateId).get();
        let data2 = snap2.exists ? snap2.data() : null;

        if (!data && !data2) return null;

        const combined = { ...(data || {}), ...(data2 || {}) };
        return _formatCandidateDoc({ id: candidateId, data: () => combined });
    }

    async function _getCandidateDocRefAndSnap(candidateId) {
        let ref = firebase.firestore().collection('candidates').doc(candidateId);
        let snap = await ref.get();
        if (snap.exists) return { ref, snap, data: snap.data() || {} };

        ref = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        snap = await ref.get();
        if (snap.exists) return { ref, snap, data: snap.data() || {} };

        if (candidateId && candidateId.includes('@')) {
            let q = await firebase.firestore().collection('candidates').where('email', '==', candidateId.toLowerCase()).get();
            if (!q.empty) return { ref: q.docs[0].ref, snap: q.docs[0], data: q.docs[0].data() || {} };

            q = await firebase.firestore().collection('candidateProfiles').where('email', '==', candidateId.toLowerCase()).get();
            if (!q.empty) return { ref: q.docs[0].ref, snap: q.docs[0], data: q.docs[0].data() || {} };
        }

        const defaultRef = firebase.firestore().collection('candidates').doc(candidateId);
        return { ref: defaultRef, snap: null, data: {} };
    }

    // ── addHiringRound ────────────────────────────────────────────
    async function addHiringRound(candidateId, roundData) {
        await _getUid();

        const ref1 = firebase.firestore().collection('candidates').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidateProfiles').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const rounds1 = data1.hiringRounds || [];
        const rounds2 = data2.hiringRounds || [];
        const rounds  = rounds1.length >= rounds2.length ? [...rounds1] : [...rounds2];

        const newRound = {
            id: 'RND' + Date.now(),
            roundId: 'RND' + Date.now(),
            stageName: roundData.stageName || roundData.type || roundData.name || 'Round',
            type: roundData.type || roundData.stageName || 'Interview',
            status: roundData.status || 'pending',
            order: roundData.order || rounds.length + 1,
            interviewer: roundData.interviewer || null,
            scheduledAt: roundData.scheduledAt || null,
            outcome: roundData.status || 'pending',
            notes: roundData.notes || null,
            date: roundData.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            feedbackDocUrl: null,
            feedbackDocName: null
        };
        rounds.push(newRound);

        const updatePayload = {
            hiringRounds: rounds,
            latestRoundName: newRound.stageName,
            latestRoundStatus: newRound.status,
            roundsCount: rounds.length
        };

        await Promise.all([
            ref1.set(updatePayload, { merge: true }).catch(e => console.warn('addHiringRound ref1 failed:', e)),
            ref2.set(updatePayload, { merge: true }).catch(e => console.warn('addHiringRound ref2 failed:', e))
        ]);

        return newRound;
    }

    // ── updateHiringRound ─────────────────────────────────────────
    async function updateHiringRound(candidateId, roundId, fields) {
        await _getUid();

        const ref1 = firebase.firestore().collection('candidates').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidateProfiles').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const rounds1 = data1.hiringRounds || [];
        const rounds2 = data2.hiringRounds || [];
        const rounds  = rounds1.length >= rounds2.length ? [...rounds1] : [...rounds2];

        const idx = rounds.findIndex(r => r.id === roundId || r.roundId === roundId);
        if (idx !== -1) {
            rounds[idx] = { ...rounds[idx], ...fields };
        }

        const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
        const updatePayload = {
            hiringRounds: rounds,
            latestRoundName: lastRound ? (lastRound.stageName || lastRound.name) : 'Job Application',
            latestRoundStatus: lastRound ? lastRound.status : 'completed',
            roundsCount: rounds.length
        };

        await Promise.all([
            ref1.set(updatePayload, { merge: true }).catch(e => console.warn('updateHiringRound ref1 failed:', e)),
            ref2.set(updatePayload, { merge: true }).catch(e => console.warn('updateHiringRound ref2 failed:', e))
        ]);

        return { success: true };
    }

    // ── requestCandidateDocument ──────────────────────────────────
    async function requestCandidateDocument(candidateId, label, description) {
        await _getUid();

        const { ref, data } = await _getCandidateDocRefAndSnap(candidateId);
        const docs = data.documents || data.requestedDocuments || [];
        const newDoc = {
            id: 'CDOC' + Date.now(),
            docId: 'CDOC' + Date.now(),
            documentLabel: label,
            label: label,
            description: description || null,
            status: 'requested',
            finalStatus: 'pending',
            requestedByRole: 'manager',
            requestedAt: new Date().toISOString(),
            uploadedAt: null,
            fileUrl: null,
            fileName: null
        };
        docs.push(newDoc);
        const updatePayload = { documents: docs, requestedDocuments: docs, docsRequested: (data.docsRequested || 0) + 1 };
        await ref.set(updatePayload, { merge: true });
        try {
            await firebase.firestore().collection('candidateProfiles').doc(ref.id).set(updatePayload, { merge: true });
            await firebase.firestore().collection('candidates').doc(ref.id).set(updatePayload, { merge: true });
        } catch(e) {}
        return { success: true };
    }

    // ── verifyManagerDocument ─────────────────────────────────────
    async function verifyManagerDocument(candidateId, docId) {
        await _getUid();
        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const docs1 = data1.requestedDocuments || data1.documents || [];
        const docs2 = data2.requestedDocuments || data2.documents || [];
        const docs  = docs1.length >= docs2.length ? [...docs1] : [...docs2];

        const idx = docs.findIndex(d => d.id === docId || d.docId === docId);
        if (idx !== -1) {
            docs[idx].status = 'fully_verified';
            docs[idx].finalStatus = 'manager_verified';
            const verifiedCount = docs.filter(x => x.finalStatus === 'manager_verified' || x.finalStatus === 'fully_verified' || x.status === 'fully_verified').length;
            const updatePayload = { documents: docs, requestedDocuments: docs, docsVerified: verifiedCount };

            await Promise.all([
                ref1.set(updatePayload, { merge: true }).catch(e => console.warn('verifyManagerDocument ref1 error:', e)),
                ref2.set(updatePayload, { merge: true }).catch(e => console.warn('verifyManagerDocument ref2 error:', e))
            ]);
        }
        return { success: true };
    }

    // ── rejectManagerDocument ─────────────────────────────────────
    async function rejectManagerDocument(candidateId, docId, reason) {
        await _getUid();
        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const docs1 = data1.requestedDocuments || data1.documents || [];
        const docs2 = data2.requestedDocuments || data2.documents || [];
        const docs  = docs1.length >= docs2.length ? [...docs1] : [...docs2];

        const idx = docs.findIndex(d => d.id === docId || d.docId === docId);
        if (idx !== -1) {
            docs[idx].status = 'rejected';
            docs[idx].finalStatus = 'rejected';
            docs[idx].rejectReason = reason;
            docs[idx].rejectionReason = reason;
            const updatePayload = { documents: docs, requestedDocuments: docs };

            await Promise.all([
                ref1.set(updatePayload, { merge: true }).catch(e => console.warn('rejectManagerDocument ref1 error:', e)),
                ref2.set(updatePayload, { merge: true }).catch(e => console.warn('rejectManagerDocument ref2 error:', e))
            ]);
        }
        return { success: true };
    }

    async function getCandidatePipeline() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const accData = accSnap.exists ? accSnap.data() : {};
        const managerId = accData.employeeId || uid;
        
        let snap = await firebase.firestore().collection('candidates')
          .where('assignedManagerIds', 'array-contains', managerId).get().catch(() => null);
          
        let docsMap = {};
        if (snap && snap.docs) {
            snap.docs.forEach(d => { docsMap[d.id] = _formatCandidateDoc(d); });
        }
        
        const snap2 = await firebase.firestore().collection('candidateProfiles')
          .where('assignedManagerIds', 'array-contains', managerId).get().catch(() => null);
        if (snap2 && snap2.docs) {
            snap2.docs.forEach(d => { if (!docsMap[d.id]) docsMap[d.id] = _formatCandidateDoc(d); });
        }
        
        return Object.values(docsMap);
    }

    // ── prepareOfferLetterDraft ───────────────────────────────────
    async function prepareOfferLetterDraft(candidateId, offerData) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            offerDetails: offerData,
            offerLetterStatus: 'pending_admin_review',
            currentStage: 'offer_draft'
        });
        return { success: true };
    }

    // ── putCandidateOnHold ────────────────────────────────────────
    async function putCandidateOnHold(candidateId, reason, reminderAt) {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get().catch(() => null);
        const accData = accSnap && accSnap.exists ? accSnap.data() : {};
        const managerId = accData.employeeId || uid;
        const role = accData.role || 'manager';
        
        let name = accData.fullName || accData.name || '';
        if (!name && managerId) {
            const empSnap = await firebase.firestore().collection('employees').doc(managerId).get().catch(() => null);
            if (empSnap && empSnap.exists) {
                name = empSnap.data().fullName || empSnap.data().name || '';
            }
        }
        if (!name && accData.email) {
            name = accData.email.split('@')[0];
        }
        if (!name) name = 'Manager';

        let setByText = 'Admin';
        if (role === 'manager' || role === 'employee') {
            setByText = `Manager \u2022 ${name}`;
        } else if (role === 'super_admin' || role === 'admin') {
            setByText = 'Admin';
        }

        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const candData = snap1 && snap1.exists ? snap1.data() : {};
        const candName = candData.fullName || candData.candidateName || 'Candidate';
        const assignedMgrs = candData.assignedManagerIds || (candData.originatingManagerId ? [candData.originatingManagerId] : []);

        const holdDetails = {
            isOnHold: true,
            reason: reason || 'Application under review',
            reminderAt: reminderAt || null,
            setByEmployeeId: managerId,
            setByName: name,
            setByRole: role,
            setByText: setByText,
            setAt: new Date().toISOString()
        };

        const updatePayload = { holdDetails };

        await Promise.all([
            ref1.set(updatePayload, { merge: true }).catch(e => console.warn('putOnHold ref1 failed:', e)),
            ref2.set(updatePayload, { merge: true }).catch(e => console.warn('putOnHold ref2 failed:', e))
        ]);

        // Insert notification for Manager & Admin
        try {
            const batch = firebase.firestore().batch();
            const notifTitle = 'Reminder: Remove candidate from hold';
            const notifMsg   = `Reminder: Remove ${candName} from hold${reason ? ' (Reason: ' + reason + ')' : ''}`;

            assignedMgrs.forEach(mgrId => {
                const nRef = firebase.firestore().collection('notifications').doc();
                batch.set(nRef, {
                    recipientAccountId: mgrId,
                    type: 'candidate_hold',
                    candidateId,
                    title: notifTitle,
                    message: notifMsg,
                    reminderAt: reminderAt || null,
                    createdAt: new Date().toISOString(),
                    read: false
                });
            });

            const adminsSnap = await firebase.firestore().collection('accounts').where('role', '==', 'super_admin').get();
            adminsSnap.forEach(aDoc => {
                const nRef = firebase.firestore().collection('notifications').doc();
                batch.set(nRef, {
                    recipientAccountId: aDoc.id,
                    type: 'candidate_hold',
                    candidateId,
                    title: notifTitle,
                    message: notifMsg,
                    reminderAt: reminderAt || null,
                    createdAt: new Date().toISOString(),
                    read: false
                });
            });

            await batch.commit();
        } catch(nErr) { console.warn('Hold notifications creation error:', nErr); }

        logAuditEvent('hiring', 'candidate_hold_set', 'Candidate Put On Hold', 'candidate', candidateId, candName, { reason: reason || 'Application under review', reminderAt: reminderAt || null });

        return { success: true };
    }

    // ── removeCandidateHold ───────────────────────────────────────
    async function removeCandidateHold(candidateId) {
        await _getUid();
        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const updatePayload = { holdDetails: null };

        await Promise.all([
            ref1.set(updatePayload, { merge: true }).catch(e => console.warn('removeHold ref1 failed:', e)),
            ref2.set(updatePayload, { merge: true }).catch(e => console.warn('removeHold ref2 failed:', e))
        ]);

        try { localStorage.removeItem('dismissed_hold_' + candidateId); } catch(e) {}

        logAuditEvent('hiring', 'candidate_hold_removed', 'Candidate Removed From Hold', 'candidate', candidateId, candidateId);

        return { success: true };
    }

    // ── managerRejectCandidate ────────────────────────────────────
    async function managerRejectCandidate(candidateId, reason) {
        await _getUid();

        await firebase.firestore().collection('candidates').doc(candidateId).update({
            currentStage: 'rejected',
            companyDecision: 'rejected',
            rejectionType: 'manager',
            rejectionReason: reason,
            rejectedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Dashboard Stats ───────────────────────────────────
    async function getAdminDashboardStats() {
        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const adminName = accSnap.exists ? accSnap.data().name || 'Admin' : 'Admin User';

        const empSnap = await firebase.firestore().collection('employees').where('employmentStatus', 'in', ['active', 'on_notice']).get();
        let payrollBurn = 0;
        empSnap.forEach(d => payrollBurn += (Number(d.data().baseSalary) || 0));

        const candSnap = await firebase.firestore().collection('candidates').where('currentStage', 'in', ['document_collection', 'offer_draft', 'offer_stage']).get();
        
        const counts = await getPendingApprovalCounts();
        const totalPending = Object.values(counts).reduce((a,b)=>a+b, 0);

        return {
            adminName,
            headcount: empSnap.size,
            payrollBurn,
            totalPending,
            activeCandidates: candSnap.size
        };
    }

    // ── Admin: Pending Approval Counts ──────────────────────────
    async function getPendingApprovalCounts() {
        await _getUid();
        const [leaveSnap, resigSnap, advSnap, hireSnap, remSnap, docSnap, candDocSnap, bonusSnap, hikeSnap, settleSnap] = await Promise.all([
            firebase.firestore().collection('leaveRequests').where('status', 'in', ['pending', 'pending_admin', 'manager_approved']).get(),
            firebase.firestore().collection('resignationRequests').where('status', 'in', ['pending', 'pending_admin', 'manager_approved']).get(),
            firebase.firestore().collection('salaryAdvanceRequests').where('status', 'in', ['pending', 'pending_admin']).get(),
            firebase.firestore().collection('hiringProposals').where('status', '==', 'pending').get(),
            firebase.firestore().collection('removalProposals').where('status', '==', 'pending').get(),
            firebase.firestore().collection('employeeDocuments').where('status', '==', 'manager_verified').get(),
            firebase.firestore().collection('candidates').where('currentStage', '==', 'document_collection').get(),
            firebase.firestore().collection('bonusProposals').where('approvalStatus', 'in', ['pending', 'pending_admin']).get(),
            firebase.firestore().collection('salaryHikeRequests').where('status', 'in', ['pending', 'pending_admin']).get(),
            firebase.firestore().collection('resignationRequests').where('status', '==', 'approved').get()
        ]);
        
        let candDocs = 0;
        candDocSnap.forEach(d => {
            const docs = d.data().documents || [];
            candDocs += docs.filter(x => x.status === 'manager_verified').length;
        });

        const pendingSettlementsCount = settleSnap.docs.filter(d => !d.data().settlementReleased).length;

        return {
            leaveRequests: leaveSnap.size,
            resignations: resigSnap.size,
            salaryAdvances: advSnap.size,
            hireProposals: hireSnap.size,
            removalProposals: remSnap.size,
            docVerifications: docSnap.size + candDocs,
            bonuses: bonusSnap.size,
            hikes: hikeSnap.size,
            settlements: pendingSettlementsCount
        };
    }

    // ── Admin: Recent Audit Activity ────────────────────────────
    async function getRecentAuditActivity() {
        await _getUid();
        const snap = await firebase.firestore().collection('auditLogs')
            .orderBy('createdAt', 'desc').limit(6).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // ══ ADMIN — EMPLOYEES PAGE ═══════════════════════════════════

    // ── Admin: Get All Employees ─────────────────────────────────
    async function getAllEmployees(includeFormer = false) {
        await _getUid();
        let q = firebase.firestore().collection('employees');
        if (!includeFormer) {
            q = q.where('employmentStatus', 'in', ['active', 'on_notice']);
        }
        const snap = await q.get();
        return snap.docs.map(d => ({ employeeId: d.id, ...d.data() }));
    }

    // ── Admin: Add Employee ──────────────────────────────────────
    async function addEmployee(data) {
        await _getUid();
        const res = await fetch(`${API_BASE}/api/auth/provision-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, role: 'employee' })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to add employee');
        return { employeeId: json.employeeId, employeeCode: json.employeeCode, ...json.data };
    }

    // ── Admin: Add Manager ───────────────────────────────────────
    async function addManager(data) {
        await _getUid();
        const res = await fetch(`${API_BASE}/api/auth/provision-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, role: 'manager' })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to add manager');
        return { employeeId: json.employeeId, employeeCode: json.employeeCode, ...json.data };
    }

    // ── Admin: Terminate Employee ────────────────────────────────
    async function terminateEmployee(employeeId, reason) {
        const uid = await _getUid();
        await firebase.firestore().collection('employees').doc(employeeId).update({
          employmentStatus: 'terminated',
          updatedAt: new Date().toISOString(),
        });
        await firebase.firestore().collection('auditLogs').add({
          actor: uid, action: 'employee_terminated', targetId: employeeId, reason, createdAt: new Date().toISOString(),
        });
        return { success: true };
    }

    // ── Admin: Promote Employee to Manager ───────────────────────
    async function promoteEmployeeToManager(employeeId, { newSalary, effectiveDate, teamMemberIds = [] }) {
        const uid = await _getUid();
        const batch = firebase.firestore().batch();
        const empRef = firebase.firestore().collection('employees').doc(employeeId);
        const accRef = firebase.firestore().collection('accounts').doc(employeeId);
        
        batch.update(empRef, { role: 'manager', baseSalary: Number(newSalary) });
        batch.update(accRef, { role: 'manager' });
        
        for (const tid of teamMemberIds) {
            batch.update(firebase.firestore().collection('employees').doc(tid), {
                managerId: employeeId
            });
        }
        await batch.commit();
        await firebase.firestore().collection('auditLogs').add({
          actor: uid, action: 'promoted_to_manager', targetId: employeeId, createdAt: new Date().toISOString(),
        });
        return { success: true, message: 'Promoted to manager successfully' };
    }

    // ── Admin: Force Reset Password ──────────────────────────────
    async function forceResetPassword(employeeId) {
        await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(employeeId).get();
        if(accSnap.exists && accSnap.data().email) {
            await firebase.auth().sendPasswordResetEmail(accSnap.data().email);
        }
        return { success: true };
    }

    // ── Admin: Get Employee Detail ───────────────────────────────
    async function getEmployeeDetail(employeeId) {
        await _getUid();
        const doc = await firebase.firestore().collection('employees').doc(employeeId).get();
        if (!doc.exists) return null;
        const data = { employeeId: doc.id, id: doc.id, ...doc.data() };
        
        const [docSnap, resigSnap, attSnap] = await Promise.all([
            firebase.firestore().collection('employeeDocuments').where('employeeId', '==', employeeId).get(),
            firebase.firestore().collection('resignationRequests').where('employeeId', '==', employeeId).orderBy('createdAt', 'desc').limit(1).get(),
            firebase.firestore().collection('attendanceLogs').where('employeeId', '==', employeeId).orderBy('date', 'desc').limit(1).get()
        ]);
        
        data.documents = docSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        data.noticeDocs = []; // Unified into documents
        
        if (!resigSnap.empty) {
            data.resignation = resigSnap.docs[0].data();
            data.resignation.resignationId = resigSnap.docs[0].id;
        }
        
        if (!attSnap.empty) {
            data.lastAttendance = attSnap.docs[0].data();
        }
        
        return data;
    }

    // ── Admin: Update Employee Profile ───────────────────────────
    async function updateEmployeeProfile(employeeId, data) {
        await _getUid();
        await firebase.firestore().collection('employees').doc(employeeId).update({
            ...data,
            updatedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ══ ADMIN — APPROVALS PAGE ════════════════════════════════════

    // ── Admin: Get Pending Leave Requests ─────────────────────────
    async function getPendingLeaveRequests() {
        await _getUid();
        const snap = await firebase.firestore().collection('leaveRequests')
            .where('status', 'in', ['pending', 'pending_admin', 'manager_approved'])
            .orderBy('createdAt', 'desc').get();
        
        if (snap.empty) return [];

        const empIds = [...new Set(snap.docs.map(d => d.data().employeeId).filter(Boolean))];
        const empMap = {};
        const accMap = {};

        if (empIds.length > 0) {
            const empSnaps = await Promise.all(
                empIds.map(id => firebase.firestore().collection('employees').doc(id).get().catch(() => null))
            );
            empSnaps.forEach(s => {
                if (s && s.exists) empMap[s.id] = s.data();
            });

            const accSnaps = await Promise.all(
                empIds.map(id => firebase.firestore().collection('accounts').doc(id).get().catch(() => null))
            );
            accSnaps.forEach(s => {
                if (s && s.exists) accMap[s.id] = s.data();
            });
        }

        return snap.docs.map(d => {
            const data = d.data();
            const emp = empMap[data.employeeId] || {};
            const acc = accMap[data.employeeId] || {};
            const fullName = data.employeeName || emp.fullName || emp.name || acc.fullName || acc.name || (acc.email ? acc.email.split('@')[0] : '') || 'Employee';
            const designation = data.designation || emp.designation || (acc.role === 'manager' ? 'Manager' : 'Team Member');
            const department = data.department || emp.department || 'Operations';
            const role = data.role || acc.role || emp.role || 'employee';

            return {
                requestId: d.id,
                id: d.id,
                ...data,
                employeeName: fullName,
                designation: designation,
                department: department,
                role: role
            };
        });
    }

    // ── Admin: Approve Leave ──────────────────────────────────────
    async function approveLeave(requestId, comment) {
        await _getUid();
        await firebase.firestore().collection('leaveRequests').doc(requestId).update({ status: 'approved', adminComment: comment || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'leave_approved', 'Leave Approved', 'leave_request', requestId, requestId, { comment: comment || null });
        return { success: true };
    }

    // ── Admin: Reject Leave ───────────────────────────────────────
    async function rejectLeave(requestId, reason) {
        await _getUid();
        await firebase.firestore().collection('leaveRequests').doc(requestId).update({ status: 'rejected', adminReason: reason || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'leave_rejected', 'Leave Rejected', 'leave_request', requestId, requestId, { reason: reason || null });
        return { success: true };
    }

    // ── Admin: Get Pending Resignations ───────────────────────────
    async function getPendingResignations() {
        await _getUid();
        const snap = await firebase.firestore().collection('resignationRequests')
            .where('status', 'in', ['pending', 'pending_admin', 'manager_approved', 'doc_requested'])
            .get();
        const list = snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
        list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (!list.length) return [];

        const empIds = [...new Set(list.map(d => d.employeeId).filter(Boolean))];
        const empMap = {};
        for (const empId of empIds) {
            try {
                const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
                if (empSnap.exists) {
                    empMap[empId] = empSnap.data();
                } else {
                    const accSnap = await firebase.firestore().collection('accounts').doc(empId).get();
                    if (accSnap.exists) empMap[empId] = accSnap.data();
                }
            } catch (err) {
                console.warn('[DB] Failed to fetch employee info for resignation:', empId, err);
            }
        }

        return list.map(item => {
            const emp = empMap[item.employeeId] || {};
            return {
                ...item,
                employeeName: item.employeeName || emp.name || emp.fullName || emp.email || 'Employee (' + item.employeeId + ')',
                designation: item.designation || emp.designation || (emp.role === 'manager' ? 'Manager' : 'Staff'),
                department: item.department || emp.department || 'General',
                role: item.role || emp.role || 'employee',
                avatarUrl: item.avatarUrl || emp.avatarUrl || null,
                reportingManager: item.reportingManager || emp.managerName || (emp.role === 'manager' ? 'Direct to Admin' : 'N/A'),
                submittedAt: item.submittedAt || item.createdAt || item.resignationDate || new Date().toISOString()
            };
        });
    }

    // ── Admin: Approve Resignation ────────────────────────────────
    async function approveResignation(requestId, comment) {
        await _getUid();
        const docRef = firebase.firestore().collection('resignationRequests').doc(requestId);
        const doc = await docRef.get();
        await docRef.update({ status: 'approved', adminComment: comment || null, resolvedAt: new Date().toISOString() });
        if (doc.exists) await firebase.firestore().collection('employees').doc(doc.data().employeeId).update({ employmentStatus: 'on_notice' });
        logAuditEvent('approvals', 'resignation_approved', 'Resignation Approved', 'resignation_request', requestId, requestId, { comment: comment || null });
        return { success: true };
    }

    // ── Admin: Reject Resignation ─────────────────────────────────
    async function rejectResignation(requestId, reason) {
        await _getUid();
        await firebase.firestore().collection('resignationRequests').doc(requestId).update({ status: 'rejected', adminReason: reason || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'resignation_rejected', 'Resignation Rejected', 'resignation_request', requestId, requestId, { reason: reason || null });
        return { success: true };
    }

    // ── Admin: Request Document for Resignation ───────────────────
    async function requestResignationDoc(requestId, message) {
        await _getUid();
        const docRef = firebase.firestore().collection('resignationRequests').doc(requestId);
        const docSnap = await docRef.get();
        const existingData = docSnap.exists ? docSnap.data() : {};
        const docRequests = existingData.docRequests || [];
        
        const newReq = {
            reqId: 'req_' + Date.now(),
            message: message || 'Document requested by Admin',
            requestedBy: 'admin',
            requestedAt: new Date().toISOString(),
            status: 'pending',
            docUrl: null,
            docName: null
        };
        docRequests.push(newReq);

        await docRef.update({ 
            docRequestedBy: 'admin', 
            docRequestMessage: message || null, 
            status: 'doc_requested',
            docRequests: docRequests
        });
        return { success: true };
    }

    // ── Employee: Respond with Document for Resignation ───────────
    async function respondToResignationDoc(requestId, fileUrl, fileName, file) {
        if (!requestId) throw new Error("Invalid resignation request ID");
        const uid = await _getUid();
        let url = fileUrl || null;
        if (file) {
            try {
                const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const path = `resignationDocuments/${uid}/${Date.now()}_${safeName}`;
                const snap = await firebase.storage().ref(path).put(file);
                url = await snap.ref.getDownloadURL();
            } catch (storageErr) {
                console.warn('[DB] Storage upload fallback to DataURL for resignation response doc:', storageErr);
                url = await _fileToDataUrl(file, file.name || 'document');
            }
        }

        const docRef = firebase.firestore().collection('resignationRequests').doc(requestId);
        const docSnap = await docRef.get();
        const existingData = docSnap.exists ? docSnap.data() : {};
        const docRequests = existingData.docRequests || [];
        const uploadedName = fileName || (file ? file.name : null);

        // Fulfill latest pending request in history
        for (let i = docRequests.length - 1; i >= 0; i--) {
            if (docRequests[i].status === 'pending') {
                docRequests[i].status = 'fulfilled';
                docRequests[i].docUrl = url;
                docRequests[i].docName = uploadedName;
                docRequests[i].uploadedAt = new Date().toISOString();
                break;
            }
        }

        const updatePayload = {
            docRespondedAt: new Date().toISOString(),
            status: 'pending',
            docRequestedBy: null,
            docRequestMessage: null,
            docRequests: docRequests
        };

        await docRef.update(updatePayload);
        return { success: true };
    }

    // ── Admin: Get Pending Salary Advances ────────────────────────
    async function getPendingAdvances() {
        await _getUid();
        const snap = await firebase.firestore().collection('salaryAdvanceRequests').where('status', 'in', ['pending', 'pending_admin']).get();
        const docs = snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
        docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        if (!docs.length) return [];

        const empIds = [...new Set(docs.map(d => d.employeeId).filter(Boolean))];
        const empMap = {};
        for (const empId of empIds) {
            try {
                const empDoc = await firebase.firestore().collection('employees').doc(empId).get();
                if (empDoc.exists) {
                    empMap[empId] = empDoc.data();
                } else {
                    const accDoc = await firebase.firestore().collection('accounts').doc(empId).get();
                    if (accDoc.exists) {
                        const accData = accDoc.data();
                        empMap[empId] = accData;
                        // Also check if employees collection has a doc matching accountId
                        const qSnap = await firebase.firestore().collection('employees').where('accountId', '==', empId).get();
                        if (!qSnap.empty) {
                            empMap[empId] = { ...accData, ...qSnap.docs[0].data() };
                        }
                    }
                }
            } catch (e) {
                console.warn('[db.js] Error fetching employee for advance:', empId, e);
            }
        }

        return docs.map(d => {
            const emp = empMap[d.employeeId] || {};
            return {
                ...d,
                employeeCode: d.employeeCode || emp.employeeCode || d.employeeId,
                employeeName: d.employeeName || emp.fullName || emp.name || (emp.email ? emp.email.split('@')[0] : 'Employee'),
                designation:  d.designation || emp.designation || (emp.role === 'manager' ? 'Manager' : 'Team Member'),
                department:   d.department || emp.department || 'General',
                submittedAt:  d.submittedAt || d.createdAt
            };
        });
    }

    // ── Admin: Approve Salary Advance ─────────────────────────────
    async function approveAdvance(requestId, comment) {
        await _getUid();
        await firebase.firestore().collection('salaryAdvanceRequests').doc(requestId).update({ status: 'approved', adminComment: comment || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('payroll', 'advance_approved', 'Salary Advance Approved', 'salary_advance', requestId, requestId, { comment: comment || null });
        return { success: true };
    }

    // ── Admin: Reject Salary Advance ──────────────────────────────
    async function rejectAdvance(requestId, reason) {
        await _getUid();
        await firebase.firestore().collection('salaryAdvanceRequests').doc(requestId).update({ status: 'rejected', adminReason: reason || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('payroll', 'advance_rejected', 'Salary Advance Rejected', 'salary_advance', requestId, requestId, { reason: reason || null });
        return { success: true };
    }

    // ── Admin: Get Pending Hire Proposals ─────────────────────────
    async function getPendingHireProposals() {
        await _getUid();
        const snap = await firebase.firestore().collection('hiringProposals').where('status', '==', 'pending').orderBy('submittedAt', 'desc').get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ── Admin: Approve Hire Proposal ──────────────────────────────
    async function approveHireProposal(requestId, comment) {
        await _getUid();
        await firebase.firestore().collection('hiringProposals').doc(requestId).update({ status: 'approved', adminComment: comment || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'hire_proposal_approved', 'Team Expansion Approved', 'hiring_proposal', requestId, requestId, { comment: comment || null });
        return { success: true };
    }

    // ── Admin: Reject Hire Proposal ───────────────────────────────
    async function rejectHireProposal(requestId, reason) {
        await _getUid();
        await firebase.firestore().collection('hiringProposals').doc(requestId).update({ status: 'rejected', adminReason: reason || null, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'hire_proposal_rejected', 'Team Expansion Rejected', 'hiring_proposal', requestId, requestId, { reason: reason || null });
        return { success: true };
    }

    // ── Admin: Get Pending Removal Proposals ──────────────────────
    async function getPendingRemovalProposals() {
        await _getUid();
        const snap = await firebase.firestore().collection('removalProposals').where('status', '==', 'pending').orderBy('submittedAt', 'desc').get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ── Admin: Approve Removal Proposal ───────────────────────────
    async function approveRemovalProposal(requestId) {
        await _getUid();
        const docRef = firebase.firestore().collection('removalProposals').doc(requestId);
        const doc = await docRef.get();
        await docRef.update({ status: 'approved', resolvedAt: new Date().toISOString() });
        if (doc.exists) {
            await firebase.firestore().collection('employees').doc(doc.data().employeeId).update({ employmentStatus: 'terminated', updatedAt: new Date().toISOString() });
        }
        logAuditEvent('approvals', 'removal_proposal_approved', 'Offboarding Proposal Approved', 'removal_proposal', requestId, doc.exists ? doc.data().employeeName : requestId);
        return { success: true };
    }

    // ── Admin: Reject Removal Proposal ────────────────────────────
    async function rejectRemovalProposal(requestId, reason) {
        await _getUid();
        await firebase.firestore().collection('removalProposals').doc(requestId).update({ status: 'rejected', adminReason: reason, resolvedAt: new Date().toISOString() });
        logAuditEvent('approvals', 'removal_proposal_rejected', 'Offboarding Proposal Rejected', 'removal_proposal', requestId, requestId, { reason: reason });
        return { success: true };
    }

    // ══ SHARED — EMPLOYEE DIRECTORY (TYPEAHEAD) ══════════════════════════════

    // ── Get Employee Directory ────────────────────────────────────
    // Lightweight list of active employees for UI typeahead / autocomplete.
    // Returns only the fields needed: employeeId, fullName, department, designation, employeeCode.
    //
    // ⚠️  Firebase / scale notes:
    //   • ≤ 1 000 employees  → fetch all once, cache in memory (this implementation).
    //   • 1 000 – 5 000      → store this projection in a dedicated Firestore sub-collection
    //                          called `employeeDirectory` (write on create/update/terminate).
    //                          Read it once at app init and cache in localStorage with a 10-min TTL.
    //   • 5 000+             → replace with server-side search:
    //                          Algolia, Typesense, or the Firebase Extensions "Search with Algolia".
    //                          Keep the function signature identical; just swap the body.
    async function getEmployeeDirectory() {
        await _getUid();
        const employees = await getAllEmployees(false); // active + on_notice only
        return employees.map(e => ({
            employeeId:   e.employeeId,
            fullName:     e.fullName,
            department:   e.department,
            designation:  e.designation,
            employeeCode: e.employeeCode,
        }));
        // ── Firestore stub (1k-5k scale) ────────────────────────
        // const snap = await firebase.firestore().collection('employeeDirectory').get();
        // return snap.docs.map(d => d.data());
    }

    // ══ ADMIN — HIRING PAGE ══════════════════════════════════════

    // ── Admin: Get All Candidates ─────────────────────────────────
    // includeDecided = true → include accepted + rejected candidates
    async function getAllCandidates(includeDecided = false) {
        console.log('[Admin candidates query] getAllCandidates called, includeDecided:', includeDecided);
        const uid = await _getUid().catch(() => null);
        let docsMap = {};

        // Query candidateProfiles first as single source-of-truth master collection
        let q2 = firebase.firestore().collection('candidateProfiles');
        if (!includeDecided) q2 = q2.where('currentStage', 'in', ['document_collection', 'offer_draft', 'offer_stage']);
        let snap2 = await q2.get().catch((err) => { console.warn('[Admin candidates query] candidateProfiles query failed:', err); return null; });
        if (snap2 && snap2.docs) {
            snap2.docs.forEach(d => { docsMap[d.id] = _formatCandidateDoc(d); });
        }

        // Query candidates (legacy collection) to capture any missing documents
        let q1 = firebase.firestore().collection('candidates');
        if (!includeDecided) q1 = q1.where('currentStage', 'in', ['document_collection', 'offer_draft', 'offer_stage']);
        let snap1 = await q1.get().catch((err) => { console.warn('[Admin candidates query] candidates query failed:', err); return null; });
        if (snap1 && snap1.docs) {
            snap1.docs.forEach(d => {
                if (docsMap[d.id]) {
                    const masterData = docsMap[d.id];
                    const legData    = d.data() || {};
                    const r1 = masterData.hiringRounds || [];
                    const r2 = legData.hiringRounds || [];
                    const bestR = r1.length >= r2.length ? r1 : r2;
                    docsMap[d.id] = _formatCandidateDoc({ id: d.id, data: () => ({ ...legData, ...masterData, hiringRounds: bestR }) });
                } else {
                    docsMap[d.id] = _formatCandidateDoc(d);
                }
            });
        }

        console.log('[Admin candidates query] final candidate list:', Object.values(docsMap));
        return Object.values(docsMap);
    }

    // ── Admin: Get Admin Candidate Detail ─────────────────────────
    async function getAdminCandidateDetail(candidateId) {
        return getCandidateDetail(candidateId);
    }

    // ── Admin: Add Candidate ─────────────────────────────────────
    async function addCandidate(data) {
        await _getUid();
        const res = await fetch(`${API_BASE}/api/auth/provision-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, role: 'candidate' })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to add candidate');
        return { id: json.candidateId, ...json.data };
    }

    // ── Admin: Send Portal Invite ─────────────────────────────────
    async function sendPortalInvite(candidateId) {
        await _getUid();
        const candSnap = await firebase.firestore().collection('candidates').doc(candidateId).get();
        if(candSnap.exists && candSnap.data().email) {
            await firebase.auth().sendPasswordResetEmail(candSnap.data().email);
        }
        return { success: true };
    }

    // ── Admin: Prepare Offer Package ──────────────────────────────
    async function prepareOfferPackage(candidateId, packageData) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            offerDetails: packageData,
            offerLetterStatus: 'draft_by_admin',
            currentStage: 'offer_draft'
        });
        return { success: true };
    }

    // ── Admin: Admin Verify Candidate Document ────────────────────
    async function adminVerifyCandidateDocument(candidateId, docId) {
        await _getUid();
        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const docs1 = data1.requestedDocuments || data1.documents || [];
        const docs2 = data2.requestedDocuments || data2.documents || [];
        const docs  = docs1.length >= docs2.length ? [...docs1] : [...docs2];

        const idx = docs.findIndex(d => d.docId === docId || d.id === docId);
        if (idx !== -1) {
            docs[idx].status = 'fully_verified';
            docs[idx].finalStatus = 'fully_verified';
            docs[idx].adminDecidedAt = new Date().toISOString();
            const verifiedCount = docs.filter(x => x.status === 'fully_verified' || x.finalStatus === 'fully_verified').length;
            const payload = { requestedDocuments: docs, documents: docs, docsVerified: verifiedCount };

            await Promise.all([
                ref1.set(payload, { merge: true }).catch(e => console.warn('adminVerifyCandidateDocument ref1 error:', e)),
                ref2.set(payload, { merge: true }).catch(e => console.warn('adminVerifyCandidateDocument ref2 error:', e))
            ]);
        }
        return { success: true };
    }

    // ── Admin: Admin Reject Candidate Document ────────────────────
    async function adminRejectCandidateDocument(candidateId, docId, reason) {
        await _getUid();
        const ref1 = firebase.firestore().collection('candidateProfiles').doc(candidateId);
        const ref2 = firebase.firestore().collection('candidates').doc(candidateId);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const docs1 = data1.requestedDocuments || data1.documents || [];
        const docs2 = data2.requestedDocuments || data2.documents || [];
        const docs  = docs1.length >= docs2.length ? [...docs1] : [...docs2];

        const idx = docs.findIndex(d => d.docId === docId || d.id === docId);
        if (idx !== -1) {
            docs[idx].status = 'rejected';
            docs[idx].finalStatus = 'rejected';
            docs[idx].rejectionReason = reason;
            docs[idx].rejectReason = reason;
            docs[idx].adminComment = reason;
            docs[idx].adminDecidedAt = new Date().toISOString();
            const payload = { requestedDocuments: docs, documents: docs };

            await Promise.all([
                ref1.set(payload, { merge: true }).catch(e => console.warn('adminRejectCandidateDocument ref1 error:', e)),
                ref2.set(payload, { merge: true }).catch(e => console.warn('adminRejectCandidateDocument ref2 error:', e))
            ]);
        }
        return { success: true };
    }

    // ── Admin: Verify Employee Document ───────────────────────────
    async function adminVerifyEmployeeDocument(docId) {
        await _getUid();
        await firebase.firestore().collection('employeeDocuments').doc(docId).update({
            status: 'fully_verified',
            adminDecidedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Reject Employee Document ────────────────────────────
    async function adminRejectEmployeeDocument(docId, reason) {
        await _getUid();
        await firebase.firestore().collection('employeeDocuments').doc(docId).update({
            status: 'rejected',
            adminComment: reason,
            adminDecidedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Admin Request Candidate Document ───────────────────
    async function adminRequestCandidateDocument(candidateId, documentLabel) {
        await _getUid();
        const ref = firebase.firestore().collection('candidates').doc(candidateId);
        const doc = await ref.get();
        if (!doc.exists) return { success: false };
        const docs = doc.data().documents || [];
        docs.push({
            docId: 'DOC' + Date.now(),
            documentLabel,
            status: 'requested',
            requestedBy: 'admin',
            requestedAt: new Date().toISOString()
        });
        await ref.update({ documents: docs, docsRequested: docs.length });
        return { success: true };
    }

    // ── Admin: Reject Candidate ───────────────────────────────────
    async function adminRejectCandidate(candidateId, reason) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            currentStage: 'rejected',
            companyDecision: 'rejected',
            rejectionReason: reason,
            decidedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Get Pending Offer Drafts ───────────────────────────
    async function adminGetPendingOfferDrafts() {
        await _getUid();
        const snap = await firebase.firestore().collection('candidates')
            .where('offerLetterStatus', 'in', ['pending_admin_review', 'admin_approved'])
            .orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ candidateId: d.id, ...d.data() }));
    }

    // ── Admin: Approve Offer Draft (distribute to manager + finance) ──
    async function adminApproveOfferDraft(candidateId, note) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            offerLetterStatus: 'admin_approved',
            adminNote: note || null,
            adminDecidedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Reject Offer Draft back to Manager ─────────────────
    async function adminRejectOfferDraft(candidateId, reason) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            offerLetterStatus: 'draft_by_manager', // send back to manager
            adminNote: reason,
            adminDecidedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Admin: Trigger Employee Credentials (joining day only) ────
    async function adminTriggerEmployeeCredentials(candidateId, payload = {}) {
        await _getUid();
        const bodyData = { candidateId, ...payload };
        const res = await fetch(`${API_BASE}/api/auth/hire-candidate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to trigger credentials');
        return json;
        // Firestore: update candidateProfiles/{id}: { joiningConfirmed:true, currentStage:'joined',
        //   employeeCredentialsSentAt:serverTimestamp(),
        //   portalCredentialsExpiresAt: Timestamp.fromMillis(Date.now()+48*3600*1000) }
        // Cloud Function: creates accounts/{uid} + employees/{empId} record
    }

    // ── Finance: Get Pending Offer Letters ────────────────────────
    async function getFinancePendingOfferLetters() {
        await _getUid();
        const snap = await firebase.firestore().collection('candidates').where('offerLetterStatus', '==', 'admin_approved').get();
        return snap.docs.map(d => ({ candidateId: d.id, ...d.data() }));
    }

    // ── Finance: Add T&C and Send Both Docs to Candidate ─────────
    async function financeAddTermsAndSend(candidateId, termsData) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({ offerLetterStatus: 'sent', financeTermsUrl: termsData.financeTermsUrl, sentAt: new Date().toISOString() });
        return { success: true };
    }

    // ── Candidate Portal: acceptOffer ─────────────────────────────
    async function acceptOffer(candidateId) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({ offerLetterStatus: 'accepted', currentStage: 'post_acceptance', acceptedAt: new Date().toISOString() });
        return { success: true };
    }

    // ── Candidate Portal: rejectOffer ─────────────────────────────
    async function rejectOffer(candidateId, reason) {
        await _getUid();
        const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        await firebase.firestore().collection('candidates').doc(candidateId).update({ offerLetterStatus: 'rejected', currentStage: 'rejected', companyDecision: 'rejected', rejectionReason: reason || 'Candidate declined offer', portalCredentialsExpiresAt: expiresAt });
        return { success: true, portalCredentialsExpiresAt: expiresAt };
    }


    // ── Candidate Portal ──────────────────────────────────────
    async function getCandidateProfile() {
        const uid = await _getUid();
        const snap = await firebase.firestore().collection('candidates').where('uid', '==', uid).limit(1).get();
        if (snap.empty) return null;
        return { candidateId: snap.docs[0].id, id: snap.docs[0].id, ...snap.docs[0].data() };
    }

    async function getCandidateDocuments() {
        const uid = await _getUid();
        const candSnap = await firebase.firestore().collection('candidates').where('uid', '==', uid).limit(1).get();
        if (candSnap.empty) return [];
        const candidateId = candSnap.docs[0].id;
        const docSnap = await firebase.firestore().collection('candidateDocuments').where('candidateId', '==', candidateId).get();
        return docSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
    }

    async function uploadCandidateDocument(typeOrUid, fileUrlOrDocId, docRefNoOrFileUrl, fileName) {
        let authUid = (firebase.auth().currentUser ? firebase.auth().currentUser.uid : null);
        if (!authUid) authUid = await _getUid().catch(() => null);

        let docId = typeof fileUrlOrDocId === 'string' ? fileUrlOrDocId : null;
        let fileObj = null;
        let fileUrl = null;
        let name = fileName || 'Uploaded Document';

        if (typeof typeOrUid === 'string' && typeOrUid.length > 15 && !fileName && !docId) {
            authUid = typeOrUid;
        }

        if (docRefNoOrFileUrl && typeof docRefNoOrFileUrl === 'object' && docRefNoOrFileUrl.name) {
            fileObj = docRefNoOrFileUrl;
            name = fileObj.name;
        } else if (fileUrlOrDocId && typeof fileUrlOrDocId === 'object' && fileUrlOrDocId.name) {
            fileObj = fileUrlOrDocId;
            name = fileObj.name;
        } else if (typeof docRefNoOrFileUrl === 'string') {
            fileUrl = docRefNoOrFileUrl;
        }

        if (fileObj) {
            try {
                const path = 'candidate_documents/' + authUid + '/' + (docId || 'CDOC') + '_' + Date.now() + '_' + fileObj.name;
                const storageRef = firebase.storage().ref(path);
                const uploadSnap = await storageRef.put(fileObj);
                fileUrl = await uploadSnap.ref.getDownloadURL();
            } catch (storageErr) {
                console.warn('Firebase Storage upload failed, using Object URL:', storageErr);
                fileUrl = URL.createObjectURL(fileObj);
            }
        }

        if (!fileUrl) fileUrl = 'mock://documents/' + encodeURIComponent(name);

        const ref1 = firebase.firestore().collection('candidateProfiles').doc(authUid);
        const ref2 = firebase.firestore().collection('candidates').doc(authUid);

        const snap1 = await ref1.get().catch(() => null);
        const snap2 = await ref2.get().catch(() => null);

        const data1 = snap1 && snap1.exists ? snap1.data() : {};
        const data2 = snap2 && snap2.exists ? snap2.data() : {};

        const docs1 = data1.requestedDocuments || data1.documents || [];
        const docs2 = data2.requestedDocuments || data2.documents || [];
        const docs  = docs1.length >= docs2.length ? [...docs1] : [...docs2];

        const idx = docs.findIndex(d => (docId && (d.docId === docId || d.id === docId)) || d.label === typeOrUid || d.documentLabel === typeOrUid);

        if (idx !== -1) {
            docs[idx] = {
                ...docs[idx],
                uploadedFileName: name,
                fileName: name,
                uploadedFileUrl: fileUrl,
                fileUrl: fileUrl,
                uploadedAt: new Date().toISOString(),
                status: 'pending_verification',
                finalStatus: 'pending'
            };
        } else {
            docs.push({
                docId: docId || 'CDOC' + Date.now(),
                id: docId || 'CDOC' + Date.now(),
                documentLabel: name,
                label: name,
                uploadedFileName: name,
                fileName: name,
                uploadedFileUrl: fileUrl,
                fileUrl: fileUrl,
                uploadedAt: new Date().toISOString(),
                status: 'pending_verification',
                finalStatus: 'pending'
            });
        }

        const payload = { requestedDocuments: docs, documents: docs };
        await ref1.set(payload, { merge: true });
        ref2.set(payload, { merge: true }).catch(() => {});

        return { success: true, downloadUrl: fileUrl };
    }

    // ── Admin Leave Quotas ────────────────────────────────────
    async function getLeaveQuotaSettings() {
        await _getUid();
        const snap = await firebase.firestore().collection('leaveQuotaSettings').doc('global').get();
        const defaultQuotas = { employee: {sick:5,casual:5,paid:10}, manager: {sick:7,casual:7,paid:15} };
        const data = snap.exists ? snap.data() : {};
        const global = {
            employee: { ...defaultQuotas.employee, ...data.employee },
            manager: { ...defaultQuotas.manager, ...data.manager }
        };
        return { global };
    }

    async function setGlobalLeaveQuota(role, sick, casual, paid) {
        await _getUid();
        await firebase.firestore().collection('leaveQuotaSettings').doc('global').set({
            [role]: { sick: Number(sick), casual: Number(casual), paid: Number(paid) }
        }, { merge: true });
        return { success: true };
    }

    async function getAllLeaveQuotas() {
        await _getUid();
        const employeesSnap = await firebase.firestore().collection('employees').where('employmentStatus', 'in', ['active', 'on_notice']).get();
        const settingsSnap = await firebase.firestore().collection('leaveQuotaSettings').doc('global').get();
        const data = settingsSnap.exists ? settingsSnap.data() : {};
        const defaultQuotas = { employee: {sick:5,casual:5,paid:10}, manager: {sick:7,casual:7,paid:15} };
        const globalQuotas = {
            employee: { ...defaultQuotas.employee, ...data.employee },
            manager: { ...defaultQuotas.manager, ...data.manager }
        };
        
        return employeesSnap.docs.map(doc => {
            const e = doc.data();
            const role = e.role || 'employee';
            const defaults = globalQuotas[role] || globalQuotas.employee;
            const hasOverride = !!e.leaveQuotaOverride;
            const quota = hasOverride ? e.leaveQuotaOverride : defaults;
            return {
                employeeId: doc.id,
                fullName: e.fullName,
                role: role,
                department: e.department,
                designation: e.designation,
                hasOverride: hasOverride,
                sick: Number(quota.sick ?? defaults.sick),
                casual: Number(quota.casual ?? defaults.casual),
                paid: Number(quota.paid ?? defaults.paid),
            };
        });
    }

    // ── Admin Audit Stats ─────────────────────────────────────
    async function getAdminAuditStats() {
        await _getUid();
        const today = new Date().toISOString().split('T')[0];
        const snap = await firebase.firestore().collection('auditLogs').get();
        const logs = snap.docs.map(d => d.data());
        const todayLogs = logs.filter(l => l.createdAt && l.createdAt.startsWith(today));
        const securityLogs = logs.filter(l => l.category === 'security');
        const uniqueActors = new Set(logs.map(l => l.actorId)).size;
        
        return {
            totalLogs: logs.length,
            todayCount: todayLogs.length,
            securityCount: securityLogs.length,
            uniqueActors
        };
    }

    // ── Manager Team Documents ────────────────────────────────
    async function getTeamMemberDocuments(empId) {
        await _getUid();
        try {
            const snap = await firebase.firestore().collection('employeeDocuments').where('employeeId', '==', empId).get();
            return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
        } catch (err) {
            console.warn('[getTeamMemberDocuments] Non-critical error/permission:', err);
            return [];
        }
    }

    // ── Admin: Notifications ────────────────────────────────────
    // Mock store for calendar lock requests sent by Finance this session
    var _mockCalendarLockRequested = {}; // { 'YYYY-MM': 'requested' | 'locked' }

    // Mock store for bonus proposal notifications sent to admin this session
    var _mockBonusProposalNotifs = [];

    // Mock store for leave quotas (global defaults + per-person overrides)
    // ── Admin: Get / Set Idle Timeout Setting ─────────────────
    async function getIdleTimeoutSetting() {
        await _getUid();
        const doc = await firebase.firestore().collection('portalSettings').doc('global').get();
        return doc.exists ? doc.data() : { minutes: 10 };
    }
    async function setIdleTimeoutSetting(minutes) {
        await _getUid();
        const n = parseInt(minutes, 10);
        if (isNaN(n) || n < 1 || n > 480) {
            throw new Error('Idle timeout must be between 1 and 480 minutes.');
        }
        await firebase.firestore().collection('portalSettings').doc('global').set({ minutes: n }, { merge: true });
        return { success: true };
    }

    var _mockLeaveQuotas = {
        global: {
            employee: { sick: 12, casual: 12, paid: 18 },
            manager:  { sick: 12, casual: 12, paid: 15 },
        },
        overrides: {}  // e.g. { 'EMP001': { sick: 15, casual: 12, paid: 22 } }
    };

    // Employee info lookup for bonus proposals (subset of full employee list)
    var _EMP_INFO = {
        'EMP001': { fullName: 'Rahul Mehta',   department: 'Engineering',     employeeCode: 'BHR-2024-001'  },
        'EMP002': { fullName: 'Ananya Singh',  department: 'Design',          employeeCode: 'BHR-2024-002'  },
        'EMP003': { fullName: 'Rohan Das',     department: 'Engineering',     employeeCode: 'BHR-2024-003'  },
        'EMP004': { fullName: 'Kavya Nair',    department: 'Human Resources', employeeCode: 'BHR-2025-001'  },
        'EMP005': { fullName: 'Arjun Kapoor',  department: 'Sales',           employeeCode: 'BHR-2025-002'  },
        'EMP006': { fullName: 'Divya Reddy',   department: 'Engineering',     employeeCode: 'BHR-2025-003'  },
        'MGR001': { fullName: 'Priya Sharma',  department: 'Engineering',     employeeCode: 'BHR-2024-MGR1' },
        'MGR002': { fullName: 'Vikram Patel',  department: 'Operations',      employeeCode: 'BHR-2024-MGR2' },
    };

    async function getAdminNotifications() {
        await _getUid();
        return getNotifications();
    }

    // ══ ADMIN — PAYROLL PAGE ═════════════════════════════════════

    // ── Admin: Get Payroll Month ─────────────────────────────────
    // Returns { records: [...], summary: { totalBurn, totalCount, draftCount, issuedCount, paidCount, failedCount } }
    async function getAdminPayrollMonth(month) {
        await _getUid();
        const res = await fetch(`${API_BASE}/api/payroll/records?month=` + month);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to fetch payroll records');
        
        const calDoc = await firebase.firestore().collection('workingCalendar').doc(month).get();
        const calendarLocked = calDoc.exists ? calDoc.data().lockedForPayroll : false;
        
        return { records: json.records || [], summary: json.summary || {}, calendarLocked };
    }

    // ── Admin: Issue Payslip ─────────────────────────────────────
    async function adminIssuePayslip(payrollId) {
        await _getUid();
        await firebase.firestore().collection('payrollRecords').doc(payrollId).update({
            status: 'issued',
            issuedAt: new Date().toISOString()
        });
        return { success: true, payslipId: 'PSL-' + Date.now() };
    }

    // ── Admin: Release Payment ────────────────────────────────────
    async function adminReleasePayment(payrollId, paymentRef = null) {
        await _getUid();
        await firebase.firestore().collection('payrollRecords').doc(payrollId).update({
            status: 'issued',
            disbursementStatus: 'disbursed',
            paymentRef: paymentRef || 'MANUAL',
            paidAt: new Date().toISOString()
        });
        return { success: true, paymentId: paymentRef || 'MANUAL', status: 'issued' };
    }

    // ── Admin: Set Bonus ──────────────────────────────────────────
    async function adminSetBonus(payrollId, bonusAmount, bonusNote) {
        await _getUid();
        // MOCK: logs and returns success
        console.log('[DB] Setting bonus for payrollId:', payrollId, { bonusAmount, bonusNote });
        return { success: true, bonusAmount, bonusNote };
        // Firebase:
        // const snap = await payrollRef.get();
        // const { baseSalary, deductions } = snap.data();
        // await payrollRef.update({ bonus: bonusAmount, bonusNote: bonusNote || null, netSalary: baseSalary + bonusAmount - deductions })
    }

    // ── Admin: Generate Month Payroll ─────────────────────────────
    async function adminGeneratePayroll(month) {
        await _getUid();
        const res = await fetch(`${API_BASE}/api/payroll/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to generate payroll');
        return { success: true, generatedCount: json.records ? json.records.length : 0 };
    }

    // ══ ADMIN — ATTENDANCE PAGE ═══════════════════════════════════

    // ── Admin: Get Attendance Report ─────────────────────────────
    // Returns { records: [...], stats: { presentCount, lateCount, absentCount, leaveCount, totalCount, deductionTotal } }
    async function getAdminAttendanceReport(month) {
        await _getUid();
        const snap = await firebase.firestore().collection('attendanceLogs')
            .where('date', '>=', month + '-01')
            .where('date', '<=', month + '-31')
            .get();
        const records = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
        let presentCount = 0, lateCount = 0, absentCount = 0, leaveCount = 0, deductionTotal = 0;
        records.forEach(r => {
            if (r.status === 'present') presentCount++;
            else if (r.status === 'late') lateCount++;
            else if (r.status === 'absent') absentCount++;
            else if (r.status === 'leave') leaveCount++;
            deductionTotal += (r.deductionAmount || 0);
        });
        const empSnap = await firebase.firestore().collection('employees').get();
        const empMap = {};
        empSnap.forEach(d => empMap[d.id] = d.data());
        records.forEach(r => {
            if (empMap[r.employeeId]) {
                r.fullName = empMap[r.employeeId].fullName;
                r.department = empMap[r.employeeId].department;
                r.employeeCode = empMap[r.employeeId].employeeCode;
            }
        });
        return { records, stats: { presentCount, lateCount, absentCount, leaveCount, totalCount: records.length, deductionTotal } };
    }

    // ── Admin: Get Early Checkouts ───────────────────────────────
    // Returns all employees who checked out early, with filter/pagination support.
    // params: { search, month, page, pageSize }
    async function getAdminEarlyCheckouts(date) {
        await _getUid();
        const snap = await firebase.firestore().collection('attendanceLogs')
            .where('date', '==', date)
            .where('isEarlyCheckout', '==', true)
            .get();
        const records = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
        const empSnap = await firebase.firestore().collection('employees').get();
        const empMap = {};
        empSnap.forEach(d => empMap[d.id] = d.data());
        records.forEach(r => {
            if (empMap[r.employeeId]) {
                r.fullName = empMap[r.employeeId].fullName;
                r.department = empMap[r.employeeId].department;
            }
        });
        return records;
    }



    // ── Admin: Get Attendance Settings ───────────────────────────
    async function getAdminAttendanceSettings() {
        await _getUid();
        const doc = await firebase.firestore().collection('attendanceSettings').doc('global').get();
        return doc.exists ? doc.data() : { windowStart: '09:00', windowEnd: '09:30', checkoutWindowStart: '18:00', checkoutWindowEnd: '18:30', lateLoginPenaltyThreshold: 3, lateLoginResetOnMonthStart: true, earlyCheckoutPenaltyThreshold: 3, earlyCheckoutResetOnMonthStart: true };
    }

    // ── Admin: Update Attendance Settings ────────────────────────
    async function adminUpdateAttendanceSettings(settings) {
        await _getUid();
        await firebase.firestore().collection('attendanceSettings').doc('global').set(settings, { merge: true });
        return { success: true };
    }

    // ── Admin: Get Working Calendar ──────────────────────────────
    // Returns { month, totalWorkingDays, lockedForPayroll, overrides: [{ date, makeWorking, reason }] }
    async function getAdminWorkingCalendar(month) {
        await _getUid();
        const doc = await firebase.firestore().collection('workingCalendar').doc(month).get();
        if (doc.exists) {
            const data = doc.data();
            if (data) {
                if (data.overrides && !Array.isArray(data.overrides)) {
                    const arr = [];
                    for (const [dateStr, isWorking] of Object.entries(data.overrides)) {
                        arr.push({
                            date: dateStr,
                            isWorking: !!isWorking,
                            reason: isWorking ? 'Admin Override (Working)' : 'Admin Override (Off)'
                        });
                    }
                    data.overrides = arr;
                } else if (!data.overrides) {
                    data.overrides = [];
                }
            }
            return data;
        }
        const [y, m] = month.split('-');
        const daysInMonth = new Date(y, m, 0).getDate();
        const overrides = [];
        let totalWorking = daysInMonth;
        let satCount = 0;
        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(y, m - 1, i);
            const dayOfWeek = d.getDay();
            if (dayOfWeek === 6) satCount++;
            if (dayOfWeek === 0 || (dayOfWeek === 6 && (satCount === 2 || satCount === 4))) {
                overrides.push({ date: month + '-' + String(i).padStart(2, '0'), isWorking: false, reason: dayOfWeek === 0 ? 'Sunday' : 'Saturday Off' });
                totalWorking--;
            }
        }
        return { month, overrides, totalWorkingDays: totalWorking, lockedForPayroll: false };
    }

    // ── Admin: Toggle Working Day ─────────────────────────────────
    async function adminToggleWorkingDay(month, dateStr, isWorking) {
        await _getUid();
        const docRef = firebase.firestore().collection('workingCalendar').doc(month);
        const doc = await docRef.get();
        let data;
        if (doc.exists) {
            data = doc.data();
        } else {
            const [y, m] = month.split('-');
            const daysInMonth = new Date(y, m, 0).getDate();
            const overrides = [];
            let totalWorking = daysInMonth;
            let satCount = 0;
            for (let i = 1; i <= daysInMonth; i++) {
                const d = new Date(y, m - 1, i);
                const dayOfWeek = d.getDay();
                if (dayOfWeek === 6) satCount++;
                if (dayOfWeek === 0 || (dayOfWeek === 6 && (satCount === 2 || satCount === 4))) { 
                    overrides.push({ date: month + '-' + String(i).padStart(2, '0'), isWorking: false, reason: dayOfWeek === 0 ? 'Sunday' : 'Saturday Off' });
                    totalWorking--;
                }
            }
            data = { month, overrides, totalWorkingDays: totalWorking, lockedForPayroll: false };
        }
        data.overrides = data.overrides || [];
        const existingIdx = data.overrides.findIndex(o => o.date === dateStr);
        if (existingIdx >= 0) {
            if (data.overrides[existingIdx].isWorking !== isWorking) {
                data.totalWorkingDays = isWorking ? (data.totalWorkingDays + 1) : (data.totalWorkingDays - 1);
            }
            data.overrides[existingIdx].isWorking = isWorking;
            data.overrides[existingIdx].reason = isWorking ? 'Admin Override (Working)' : 'Admin Override (Off)';
        } else {
            data.overrides.push({ date: dateStr, isWorking: isWorking, reason: isWorking ? 'Admin Override (Working)' : 'Admin Override (Off)' });
            data.totalWorkingDays = isWorking ? (data.totalWorkingDays + 1) : (data.totalWorkingDays - 1);
        }
        await docRef.set(data, { merge: true });
        return { success: true, newStatus: isWorking };
    }

    // ── Admin: Lock Working Calendar ─────────────────────────────
    async function adminLockWorkingCalendar(month) {
        await _getUid();
        await firebase.firestore().collection('workingCalendar').doc(month).set({ lockedForPayroll: true }, { merge: true });
        return { success: true };
    }

    // ── Admin: Override Attendance Record ────────────────────────
    async function adminOverrideAttendance(logId, newStatus, reason) {
        const uid = await _getUid();
        await firebase.firestore().collection('attendanceLogs').doc(logId).update({
            status: newStatus,
            overriddenByAdminId: uid,
            overrideReason: reason,
            updatedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ══ ADMIN — AUDIT LOGS ═══════════════════════════════════════

    const _AUDIT_MOCK = (function() {
        const now  = Date.now();
        const m    = (mins) => new Date(now - mins * 60000).toISOString();
        const h    = (hrs)  => new Date(now - hrs  * 3600000).toISOString();
        const d    = (days) => new Date(now - days  * 86400000).toISOString();
        return [
            // Today
            { logId: 'LOG001', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'security',     action: 'force_password_reset',       actionLabel: 'Force Password Reset',         targetType: 'employee', targetId: 'EMP004', targetName: 'Kavya Nair',     details: { note: 'Employee requested password change via helpdesk ticket #HD-291' },                             createdAt: m(12)  },
            { logId: 'LOG002', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'attendance',    action: 'attendance_override',         actionLabel: 'Attendance Override',          targetType: 'attendance_log', targetId: 'ATT-EMP002-20260429', targetName: 'Ananya Singh', details: { oldStatus: 'absent', newStatus: 'present', reason: 'Employee attended offsite client meeting' }, createdAt: m(38)  },
            { logId: 'LOG003', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'approvals',     action: 'leave_approved',              actionLabel: 'Leave Approved',               targetType: 'leave_request', targetId: 'LR-0045', targetName: 'Rohan Das',      details: { leaveType: 'sick', days: 2, from: '2026-04-30', to: '2026-05-01' },                                   createdAt: m(55)  },
            { logId: 'LOG004', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payslip_issued',              actionLabel: 'Payslip Issued',               targetType: 'employee', targetId: 'EMP001', targetName: 'Rahul Mehta',    details: { month: '2026-03', grossSalary: 85000, netSalary: 72890 },                                              createdAt: h(2)   },
            { logId: 'LOG005', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payslip_issued',              actionLabel: 'Payslip Issued',               targetType: 'employee', targetId: 'EMP002', targetName: 'Ananya Singh',   details: { month: '2026-03', grossSalary: 72000, netSalary: 61940 },                                              createdAt: h(2)   },
            { logId: 'LOG006', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'documents',     action: 'document_verified',           actionLabel: 'Document Verified',            targetType: 'document', targetId: 'DOC-0029', targetName: 'Divya Reddy — Aadhar Card', details: { verifiedAt: h(3), note: 'Original copy submitted during onboarding' },                        createdAt: h(3)   },
            { logId: 'LOG007', actorAccountId: 'ACC_MGR01', actorName: 'Priya Sharma', actorRole: 'manager',   category: 'approvals',     action: 'leave_approved',              actionLabel: 'Leave Approved',               targetType: 'leave_request', targetId: 'LR-0044', targetName: 'Rahul Mehta',    details: { leaveType: 'casual', days: 1, from: '2026-04-30', to: '2026-04-30' },                                  createdAt: h(4)   },
            { logId: 'LOG008', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'attendance',    action: 'calendar_day_override',       actionLabel: 'Working Day Override',         targetType: 'working_calendar', targetId: '2026-04', targetName: '2026-04-26', details: { makeWorking: false, reason: 'Company Foundation Day — declared off' },                              createdAt: h(6)   },
            { logId: 'LOG009', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'salary_advance_approved',     actionLabel: 'Salary Advance Approved',      targetType: 'advance_request', targetId: 'SAR-0012', targetName: 'EMP005 — Arjun Kapoor', details: { amount: 15000, reason: 'Medical emergency', approvedAt: h(7) },                              createdAt: h(7)   },
            // Yesterday
            { logId: 'LOG010', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payment_released',            actionLabel: 'Payment Released',             targetType: 'payroll', targetId: 'PAY-2026-03', targetName: 'March 2026 Payroll', details: { totalAmount: 520000, employeeCount: 8, gatewayTxnId: 'RZP_TXN_8821AB' },                             createdAt: d(1)   },
            { logId: 'LOG011', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'approvals',     action: 'resignation_approved',        actionLabel: 'Resignation Approved',         targetType: 'resignation', targetId: 'RES-0008', targetName: 'Arjun Kapoor',   details: { lastWorkingDay: '2026-05-15', noticePeriod: '30 days', fnfStatus: 'pending' },                         createdAt: d(1)   },
            { logId: 'LOG012', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'employee_added',              actionLabel: 'Employee Added',               targetType: 'employee', targetId: 'EMP006', targetName: 'Divya Reddy',    details: { designation: 'QA Engineer', department: 'Engineering', managerId: 'MGR001' },                          createdAt: d(1)   },
            { logId: 'LOG013', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'documents',     action: 'document_rejected',           actionLabel: 'Document Rejected',            targetType: 'document', targetId: 'DOC-0028', targetName: 'Arjun Kapoor — PAN Card', details: { reason: 'Document blurry and unreadable — please re-upload a clear scan' },                    createdAt: d(1)   },
            { logId: 'LOG014', actorAccountId: 'ACC_MGR02', actorName: 'Vikram Patel', actorRole: 'manager',   category: 'approvals',     action: 'leave_rejected',              actionLabel: 'Leave Rejected',               targetType: 'leave_request', targetId: 'LR-0043', targetName: 'EMP005 — Arjun Kapoor', details: { leaveType: 'casual', days: 3, reason: 'Team at minimum capacity during sprint' },              createdAt: d(1)   },
            { logId: 'LOG015', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payroll_generated',           actionLabel: 'Payroll Draft Generated',      targetType: 'payroll', targetId: 'PAY-2026-03', targetName: 'March 2026',    details: { month: '2026-03', employeeCount: 8, totalGross: 520000 },                                              createdAt: d(1)   },
            // 2 days ago
            { logId: 'LOG016', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'attendance',    action: 'attendance_settings_updated', actionLabel: 'Attendance Settings Updated',   targetType: 'settings', targetId: 'global', targetName: 'Global Attendance Settings', details: { oldWindowEnd: '09:45', newWindowEnd: '09:30', threshold: 3 },                                    createdAt: d(2)   },
            { logId: 'LOG017', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'manager_added',               actionLabel: 'Manager Added',                targetType: 'employee', targetId: 'MGR002', targetName: 'Vikram Patel',   details: { designation: 'Sales Manager', department: 'Sales' },                                                   createdAt: d(2)   },
            { logId: 'LOG018', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'security',      action: 'force_password_reset',        actionLabel: 'Force Password Reset',         targetType: 'employee', targetId: 'MGR001', targetName: 'Priya Sharma',   details: { note: 'Routine quarterly reset for manager accounts' },                                                 createdAt: d(2)   },
            { logId: 'LOG019', actorAccountId: 'ACC_MGR01', actorName: 'Priya Sharma', actorRole: 'manager',   category: 'approvals',     action: 'hire_proposal_submitted',     actionLabel: 'Hire Proposal Submitted',      targetType: 'hiring_request', targetId: 'HIR-0015', targetName: 'Senior React Developer', details: { department: 'Engineering', reason: 'Project bandwidth expansion' },                              createdAt: d(2)   },
            { logId: 'LOG020', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'approvals',     action: 'hire_proposal_approved',      actionLabel: 'Hire Proposal Approved',       targetType: 'hiring_request', targetId: 'HIR-0014', targetName: 'UI/UX Designer', details: { candidateName: 'Ananya Singh', joiningDate: '2024-08-15' },                                         createdAt: d(2)   },
            // 3-4 days ago
            { logId: 'LOG021', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'bonus_added',                 actionLabel: 'Bonus Added',                  targetType: 'employee', targetId: 'EMP001', targetName: 'Rahul Mehta',    details: { month: '2026-03', bonusType: 'performance', amount: 5000 },                                            createdAt: d(3)   },
            { logId: 'LOG022', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'bonus_added',                 actionLabel: 'Bonus Added',                  targetType: 'employee', targetId: 'EMP003', targetName: 'Rohan Das',      details: { month: '2026-03', bonusType: 'project_completion', amount: 7500 },                                     createdAt: d(3)   },
            { logId: 'LOG023', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'documents',     action: 'document_requested',          actionLabel: 'Document Requested',           targetType: 'employee', targetId: 'EMP005', targetName: 'Arjun Kapoor',   details: { documentType: 'Resignation Acceptance Letter', requestNote: 'Required for F&F processing' },           createdAt: d(3)   },
            { logId: 'LOG024', actorAccountId: 'ACC_MGR01', actorName: 'Priya Sharma', actorRole: 'manager',   category: 'documents',     action: 'document_verified',           actionLabel: 'Document Verified',            targetType: 'document', targetId: 'DOC-0025', targetName: 'Rohan Das — Experience Letter', details: { note: 'Verified against previous employer records' },                                    createdAt: d(3)   },
            { logId: 'LOG025', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'attendance',    action: 'calendar_locked',             actionLabel: 'Working Calendar Locked',      targetType: 'working_calendar', targetId: '2026-03', targetName: 'March 2026 Calendar', details: { totalWorkingDays: 26, lockedForPayroll: true },                                           createdAt: d(4)   },
            { logId: 'LOG026', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'employee_terminated',         actionLabel: 'Employee Terminated',          targetType: 'employee', targetId: 'EMP008', targetName: 'Neha Joshi',     details: { reason: 'Performance improvement plan failure — final termination', lastDay: '2026-04-25' },           createdAt: d(4)   },
            { logId: 'LOG027', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'approvals',     action: 'advance_rejected',            actionLabel: 'Advance Request Rejected',     targetType: 'advance_request', targetId: 'SAR-0011', targetName: 'EMP002 — Ananya Singh', details: { amount: 20000, reason: 'Previous advance still outstanding' },                          createdAt: d(4)   },
            // 1-2 weeks ago
            { logId: 'LOG028', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'employee_profile_updated',    actionLabel: 'Employee Profile Updated',     targetType: 'employee', targetId: 'EMP001', targetName: 'Rahul Mehta',    details: { changes: { designation: { old: 'Junior Software Engineer', new: 'Software Engineer' } } },             createdAt: d(8)   },
            { logId: 'LOG029', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'salary_revised',              actionLabel: 'Salary Revised',               targetType: 'employee', targetId: 'EMP001', targetName: 'Rahul Mehta',    details: { oldSalary: 75000, newSalary: 85000, effectiveFrom: '2026-04-01' },                                     createdAt: d(8)   },
            { logId: 'LOG030', actorAccountId: 'ACC_MGR01', actorName: 'Priya Sharma', actorRole: 'manager',   category: 'approvals',     action: 'removal_proposal_submitted',  actionLabel: 'Removal Proposal Submitted',   targetType: 'removal_request', targetId: 'REM-0003', targetName: 'EMP008 — Neha Joshi', details: { reason: 'Persistent performance issues, PIP completed', recommendedBy: 'Priya Sharma' },       createdAt: d(9)   },
            { logId: 'LOG031', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'security',      action: 'login_event',                 actionLabel: 'Admin Login',                  targetType: 'account', targetId: 'ACC_ADMIN', targetName: 'Super Admin',   details: { ip: '103.21.45.12', device: 'Chrome 124 / Windows 11', location: 'Mumbai, IN' },                       createdAt: d(10)  },
            { logId: 'LOG032', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'system',        action: 'firestore_rules_updated',     actionLabel: 'Firestore Rules Updated',      targetType: 'system', targetId: 'firestore', targetName: 'Security Rules v2.3', details: { note: 'Tightened write access on employeeDocuments to manager-scoped only' },                      createdAt: d(11)  },
            { logId: 'LOG033', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'employee_added',              actionLabel: 'Employee Added',               targetType: 'employee', targetId: 'EMP005', targetName: 'Arjun Kapoor',   details: { designation: 'Sales Associate', department: 'Sales', managerId: 'MGR002' },                            createdAt: d(12)  },
            { logId: 'LOG034', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payroll_generated',           actionLabel: 'Payroll Draft Generated',      targetType: 'payroll', targetId: 'PAY-2026-02', targetName: 'February 2026', details: { month: '2026-02', employeeCount: 7, totalGross: 488000 },                                             createdAt: d(14)  },
            { logId: 'LOG035', actorAccountId: 'ACC_MGR02', actorName: 'Vikram Patel', actorRole: 'manager',   category: 'approvals',     action: 'leave_approved',              actionLabel: 'Leave Approved',               targetType: 'leave_request', targetId: 'LR-0040', targetName: 'Arjun Kapoor',   details: { leaveType: 'paid', days: 3, from: '2026-04-10', to: '2026-04-12' },                                    createdAt: d(15)  },
            { logId: 'LOG036', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'documents',     action: 'document_verified',           actionLabel: 'Document Verified',            targetType: 'document', targetId: 'DOC-0022', targetName: 'Kavya Nair — Degree Certificate', details: { note: 'BGV check passed — verified via university portal' },                        createdAt: d(16)  },
            { logId: 'LOG037', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'security',      action: 'force_password_reset',        actionLabel: 'Force Password Reset',         targetType: 'employee', targetId: 'EMP003', targetName: 'Rohan Das',      details: { note: 'Employee reported suspicious login on personal Gmail — precautionary reset' },                  createdAt: d(18)  },
            { logId: 'LOG038', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'attendance',    action: 'attendance_override',         actionLabel: 'Attendance Override',          targetType: 'attendance_log', targetId: 'ATT-EMP006-20260411', targetName: 'Divya Reddy', details: { oldStatus: 'absent', newStatus: 'leave', reason: 'Emergency leave approved verbally — retroactive update' }, createdAt: d(18) },
            { logId: 'LOG039', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'payroll',       action: 'payment_released',            actionLabel: 'Payment Released',             targetType: 'payroll', targetId: 'PAY-2026-02', targetName: 'February 2026 Payroll', details: { totalAmount: 488000, employeeCount: 7, gatewayTxnId: 'RZP_TXN_7714CD' },                        createdAt: d(19)  },
            { logId: 'LOG040', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'system',        action: 'ai_search_query',             actionLabel: 'AI Search Query',              targetType: 'ai_search', targetId: 'AISQ-0018', targetName: 'Query: employees on notice in Engineering', details: { query: 'show me all employees currently on notice period in the Engineering department', resultCount: 1 }, createdAt: d(20) },
            { logId: 'LOG041', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'employee_mgmt', action: 'employee_profile_updated',    actionLabel: 'Employee Profile Updated',     targetType: 'employee', targetId: 'MGR001', targetName: 'Priya Sharma',   details: { changes: { phone: { old: '+91 94567 89123', new: '+91 99123 45678' } } },                              createdAt: d(21)  },
            { logId: 'LOG042', actorAccountId: 'ACC_ADMIN', actorName: 'Super Admin', actorRole: 'super_admin', category: 'approvals',     action: 'leave_rejected',              actionLabel: 'Leave Rejected',               targetType: 'leave_request', targetId: 'LR-0038', targetName: 'Rohan Das',       details: { leaveType: 'paid', days: 5, reason: 'Project delivery deadline — cannot be accommodated this week' }, createdAt: d(22)  },
        ];
    })();

    async function getAdminAuditLogs(filters = {}) {
        await _getUid();
        let q = firebase.firestore().collection('auditLogs');
        if (filters.category && filters.category !== 'all') q = q.where('category', '==', filters.category);
        if (filters.action) q = q.where('action', '==', filters.action);
        if (filters.actor) q = q.where('actor', '==', filters.actor);
        const limit = filters.limit || 20;
        const snap = await q.orderBy('createdAt', 'desc').limit(limit * (filters.page || 1)).get();
        const allLogs = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
        const search = (filters.search || '').toLowerCase();
        const filtered = search ? allLogs.filter(l => 
            (l.actorName || '').toLowerCase().includes(search) ||
            (l.actionLabel || '').toLowerCase().includes(search) ||
            (l.targetName || '').toLowerCase().includes(search)
        ) : allLogs;
        const page = filters.page || 1;
        const start = (page - 1) * limit;
        const paged = filtered.slice(start, start + limit);
        return { logs: paged, total: filtered.length, hasMore: (start + limit) < filtered.length };
    }

    async function setIndividualLeaveQuota(employeeId, sick, casual, paid) {
        await _getUid();
        await firebase.firestore().collection('employees').doc(employeeId).update({
            leaveQuotaOverride: {
                sick: Number(sick),
                casual: Number(casual),
                paid: Number(paid)
            }
        });
        return { success: true };
    }

    async function clearIndividualLeaveQuota(employeeId) {
        await _getUid();
        await firebase.firestore().collection('employees').doc(employeeId).update({ leaveQuotaOverride: firebase.firestore.FieldValue.delete() });
        return { success: true };
    }

    // ══ FINANCE ════════════════════════════════════════════════

    // ── Finance Mock Data ────────────────────────────────────────
    const _FINANCE_MOCK = {
        financeName: 'Kavya Nair',
        headcount: 24,
        payrollBurn: 820000,
        pendingDrafts: 3,
        pendingDisbursements: 2,
        monthlyBurn: [
            { month: 'Nov',  year: '25', amount: 780000 },
            { month: 'Dec',  year: '25', amount: 815000 },
            { month: 'Jan',  year: '26', amount: 798000 },
            { month: 'Feb',  year: '26', amount: 822000 },
            { month: 'Mar',  year: '26', amount: 847000 },
            { month: 'Apr',  year: '26', amount: 820000 },
        ],
        bonuses: [
            { bonusId: 'BON-2026-04-001', employeeId: 'EMP001', employeeCode: 'BHR-2024-001',  fullName: 'Rahul Mehta',   department: 'Engineering',     month: '2026-04', amount: 5000, reason: 'Q1 performance bonus',      approvalStatus: 'admin_approved', payrollLocked: true  },
            { bonusId: 'BON-2026-04-002', employeeId: 'MGR001', employeeCode: 'BHR-2024-MGR1', fullName: 'Priya Sharma', department: 'Engineering',     month: '2026-04', amount: 8000, reason: 'Team delivery excellence',   approvalStatus: 'admin_approved', payrollLocked: false },
            { bonusId: 'BON-2026-03-001', employeeId: 'EMP004', employeeCode: 'BHR-2025-001',  fullName: 'Kavya Nair',   department: 'Human Resources', month: '2026-03', amount: 2000, reason: 'Recruitment drive bonus',   approvalStatus: 'admin_approved', payrollLocked: true  },
            { bonusId: 'BON-2026-03-002', employeeId: 'MGR001', employeeCode: 'BHR-2024-MGR1', fullName: 'Priya Sharma', department: 'Engineering',     month: '2026-03', amount: 5000, reason: 'Product launch bonus',      approvalStatus: 'admin_approved', payrollLocked: true  },
        ],
        advances: [
            { requestId: 'ADV-2026-034', employeeId: 'EMP003', employeeCode: 'BHR-2024-003', fullName: 'Rohan Das',     department: 'Engineering', designation: 'Backend Developer', requestedAmount: 20000, approvedAmount: 20000, purpose: 'Medical emergency — family hospitalisation', repaymentMonths: 4, requestedAt: '2026-04-20T11:00:00Z', adminApprovedAt: '2026-04-22T09:00:00Z', status: 'admin_approved', disbursedAt: null, disbursementRef: null, disbursementNotes: null },
            { requestId: 'ADV-2026-028', employeeId: 'EMP005', employeeCode: 'BHR-2025-002', fullName: 'Arjun Kapoor',  department: 'Sales',       designation: 'Sales Associate',   requestedAmount: 15000, approvedAmount: 15000, purpose: 'Home renovation advance', repaymentMonths: 3, requestedAt: '2026-04-15T14:00:00Z', adminApprovedAt: '2026-04-17T10:30:00Z', status: 'disbursed',      disbursedAt: '2026-04-18T09:00:00Z', disbursementRef: 'pay_mock_adv_028', disbursementNotes: 'Processed via salary advance account' },
        ],
        settlements: [
            { resignationId: 'RES-2026-009', employeeId: 'EMP006', employeeCode: 'BHR-2025-003', fullName: 'Divya Reddy', department: 'Engineering', designation: 'QA Engineer', baseSalary: 52000, joiningDate: '2024-08-01', lastWorkingDay: '2026-05-15', totalWorkingDays: 26, daysWorked: 12, unusedPL: 5, resignationStatus: 'admin_approved', settlementStatus: 'pending_release', releasedAt: null, settlementRef: null },
        ],
    };

    // ── Finance: Dashboard Stats ─────────────────────────────────
    async function getFinanceDashboardStats() {
        try {
            const uid = await _getUid();
            const accSnap = await firebase.firestore().collection('accounts').doc(uid).get().catch(() => null);
            const financeName = (accSnap && accSnap.exists) ? accSnap.data().name || 'Finance' : 'Finance User';
            
            const empSnap = await firebase.firestore().collection('employees').where('employmentStatus', 'in', ['active', 'on_notice']).get().catch(() => ({ size: 0, forEach: () => {} }));
            let payrollBurn = 0;
            if (empSnap && empSnap.forEach) empSnap.forEach(d => payrollBurn += (Number(d.data().baseSalary) || 0));

            const payrollSnap = await firebase.firestore().collection('payrollRecords').where('status', 'in', ['paid', 'issued']).get().catch(() => ({ forEach: () => {} }));
            let monthPayout = 0;
            if (payrollSnap && payrollSnap.forEach) payrollSnap.forEach(d => monthPayout += (Number(d.data().netSalary) || 0));

            const actions = await getFinancePendingActions();

            return {
                financeName,
                pendingPayouts: actions.length,
                payrollBurn,
                monthPayout,
                headcount: (empSnap && empSnap.size) || 0,
                pendingDrafts: actions.filter(a => a.type === 'payroll').length,
                pendingDisbursements: actions.filter(a => a.type === 'advance' || a.type === 'settlement').length,
                monthlyBurn: _FINANCE_MOCK.monthlyBurn
            };
        } catch(e) {
            console.error('getFinanceDashboardStats error:', e);
            return _FINANCE_MOCK;
        }
    }

    // ── Finance: Pending Actions ─────────────────────────────────
    async function getFinancePendingActions() {
        try {
            await _getUid();
            const [payrollSnap, advSnap, resigSnap] = await Promise.all([
                firebase.firestore().collection('payrollRecords').where('status', '==', 'draft').get().catch(() => null),
                firebase.firestore().collection('salaryAdvanceRequests').where('status', '==', 'approved').get().catch(() => null),
                firebase.firestore().collection('resignationRequests').where('status', '==', 'approved').get().catch(() => null)
            ]);

            const actions = [];

            if (payrollSnap && !payrollSnap.empty) {
                payrollSnap.docs.forEach(d => {
                    const data = d.data();
                    actions.push({
                        id: d.id,
                        type: 'payroll',
                        name: `${data.month || 'Payroll'} Draft`,
                        status: 'draft',
                        amount: Number(data.totalNet || data.netSalary || 0),
                        page: 'payroll.html'
                    });
                });
            }

            if (advSnap && !advSnap.empty) {
                advSnap.docs.forEach(d => {
                    const data = d.data();
                    actions.push({
                        id: d.id,
                        type: 'advance',
                        name: `${data.employeeName || 'Employee'} Advance`,
                        status: 'admin_approved',
                        amount: Number(data.amount || data.approvedAmount || 0),
                        page: 'payouts.html'
                    });
                });
            }

            if (resigSnap && !resigSnap.empty) {
                resigSnap.docs.forEach(d => {
                    const data = d.data();
                    if (!data.settlementReleased) {
                        actions.push({
                            id: d.id,
                            type: 'settlement',
                            name: `${data.employeeName || 'Employee'} F&F Settlement`,
                            status: 'pending_release',
                            amount: Number(data.settlementAmount || data.baseSalary || 0),
                            page: 'payouts.html'
                        });
                    }
                });
            }

            return actions;
        } catch(e) {
            console.error('getFinancePendingActions error:', e);
            return [];
        }
    }

    // ── Finance: Pending Offer Letters ───────────────────────────
    async function getFinancePendingOfferLetters() {
        try {
            await _getUid();
            const snap = await firebase.firestore().collection('candidateProfiles')
                .where('offerStatus', '==', 'admin_approved')
                .get().catch(() => null);
            if (!snap || snap.empty) return [];
            return snap.docs.map(d => ({ candidateId: d.id, id: d.id, ...d.data() }));
        } catch(e) {
            console.error('getFinancePendingOfferLetters error:', e);
            return [];
        }
    }

    async function financeAddTermsAndSend(candidateId, { termsNote }) {
        await _getUid();
        await firebase.firestore().collection('candidateProfiles').doc(candidateId).update({
            offerStatus: 'sent_to_candidate',
            financeTermsNote: termsNote || '',
            financeTermsSentAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Finance: Get Payroll Month ───────────────────────────────
    // Returns { records: [], summary: {...}, calendarLocked: bool }
    // calendarLocked: admin has locked the working calendar for this month (no attendance edits allowed).
    // Finance may only issue payslips and release payments when calendarLocked === true.
    async function getFinancePayrollMonth(month) {
        await _getUid();
        return getAdminPayrollMonth(month);
    }

    // ── Finance: Issue Payslip ───────────────────────────────────
    async function financeIssuePayslip(payrollId) {
        await _getUid();
        await firebase.firestore().collection('payrollRecords').doc(payrollId).update({
            status: 'issued',
            issuedAt: new Date().toISOString()
        });
        return { success: true, payslipId: 'PSL-' + Date.now() };
    }

    // ── Finance: Release Payment ─────────────────────────────────
    async function financeReleasePayment(payrollId, paymentRef = null) {
        await _getUid();
        await firebase.firestore().collection('payrollRecords').doc(payrollId).update({
            status: 'issued',
            disbursementStatus: 'disbursed',
            paymentRef: paymentRef || 'MANUAL',
            paidAt: new Date().toISOString()
        });
        return { success: true, paymentId: paymentRef || 'MANUAL', status: 'issued' };
    }

    // ── Finance: Get Bonuses ─────────────────────────────────────
    async function getBonuses(month) {
        await _getUid();
        const snap = await firebase.firestore().collection('bonusProposals').where('month', '==', month).get();
        return snap.docs.map(d => ({ bonusId: d.id, ...d.data() }));
    }

    // ── Finance: Add Bonus ───────────────────────────────────────
    async function addBonus(data) {
        const uid = await _getUid();
        const docRef = firebase.firestore().collection('bonusProposals').doc();
        await docRef.set({
            ...data,
            approvalStatus: 'pending_admin',
            submittedBy: uid,
            submittedAt: new Date().toISOString()
        });
        return { success: true, bonusId: docRef.id };
    }

    // ── Finance: Edit Bonus ──────────────────────────────────────
    async function editBonus(bonusId, data) {
        await _getUid();
        await firebase.firestore().collection('bonusProposals').doc(bonusId).update({
            ...data,
            updatedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Finance: Delete Bonus ────────────────────────────────────
    async function deleteBonus(bonusId) {
        await _getUid();
        await firebase.firestore().collection('bonusProposals').doc(bonusId).delete();
        return { success: true };
    }

    // ── Finance: Get Approved Advances ──────────────────────────
    async function getApprovedAdvances() {
        await _getUid();
        const snap = await firebase.firestore().collection('salaryAdvanceRequests')
            .where('status', '==', 'approved')
            .orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ── Finance: Disburse Advance ────────────────────────────────
    async function disburseAdvance(requestId) {
        await _getUid();
        await firebase.firestore().collection('salaryAdvanceRequests').doc(requestId).update({
            status: 'disbursed',
            disbursedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Finance: Get Pending Settlements ────────────────────────
    async function getPendingSettlements() {
        await _getUid();
        const snap = await firebase.firestore().collection('resignationRequests')
            .where('status', '==', 'approved')
            .get();
        const list = snap.docs.map(d => ({ resignationId: d.id, ...d.data() })).filter(r => !r.settlementReleased);

        if (!list.length) return [];

        const empIds = [...new Set(list.map(d => d.employeeId).filter(Boolean))];
        const empMap = {};
        for (const empId of empIds) {
            try {
                const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
                if (empSnap.exists) {
                    empMap[empId] = empSnap.data();
                } else {
                    const accSnap = await firebase.firestore().collection('accounts').doc(empId).get();
                    if (accSnap.exists) empMap[empId] = accSnap.data();
                }
            } catch (err) {
                console.warn('[DB] Failed to fetch employee info for settlement:', empId, err);
            }
        }

        return list.map(item => {
            const emp = empMap[item.employeeId] || {};
            return {
                ...item,
                fullName: item.employeeName || emp.name || emp.fullName || emp.email || ('Employee (' + item.employeeId + ')'),
                designation: item.designation || emp.designation || (emp.role === 'manager' ? 'Manager' : 'Staff'),
                department: item.department || emp.department || 'General',
                employeeCode: item.employeeCode || emp.employeeCode || emp.empCode || (emp.employeeId && !emp.employeeId.includes('-') && emp.employeeId.length > 20 ? null : emp.employeeId) || 'EMP-001',
                avatarUrl: item.avatarUrl || emp.avatarUrl || null,
                joiningDate: emp.joiningDate || emp.createdAt || item.createdAt,
                lastWorkingDay: item.expectedRelievingDate || item.resignationDate || item.createdAt
            };
        });
    }

    // ── Finance: Get Settlement Details ─────────────────────────
    async function getSettlementDetails(resignationId) {
        await _getUid();
        const docSnap = await firebase.firestore().collection('resignationRequests').doc(resignationId).get();
        if (!docSnap.exists) return null;
        const res = docSnap.data();
        const empId = res.employeeId;

        // Fetch employee data
        let emp = {};
        try {
            const empSnap = await firebase.firestore().collection('employees').doc(empId).get();
            if (empSnap.exists) emp = empSnap.data();
            else {
                const accSnap = await firebase.firestore().collection('accounts').doc(empId).get();
                if (accSnap.exists) emp = accSnap.data();
            }
        } catch (e) {
            console.warn('[DB] Error fetching employee for settlement calc:', e);
        }

        const baseSalary = Number(emp.baseSalary || emp.salary || res.baseSalary || 80000);
        const relDate = new Date(res.expectedRelievingDate || res.resignationDate || Date.now());
        const exitYear = relDate.getFullYear();
        const exitMonth = relDate.getMonth(); // 0-indexed
        const totalWorkingDays = new Date(exitYear, exitMonth + 1, 0).getDate(); // Total days in exit month (28, 30, or 31)

        // Query attendance logs if available
        let daysWorked = Math.min(relDate.getDate(), totalWorkingDays);
        try {
            const monthStr = String(exitMonth + 1).padStart(2, '0');
            const monthPrefix = `${exitYear}-${monthStr}`;

            const searchIds = [empId];
            if (emp.employeeCode && !searchIds.includes(emp.employeeCode)) searchIds.push(emp.employeeCode);
            if (emp.empCode && !searchIds.includes(emp.empCode)) searchIds.push(emp.empCode);

            const attSnap = await firebase.firestore().collection('attendanceLogs')
                .where('employeeId', 'in', searchIds)
                .get();
            const workedLogs = attSnap.docs.filter(d => {
                const data = d.data();
                const logDate = data.date || '';
                const isExitMonth = d.id.includes(monthPrefix) || logDate.startsWith(monthPrefix);
                const isWorkedStatus = data.status === 'present' || data.status === 'late';
                return isExitMonth && isWorkedStatus;
            });
            if (workedLogs.length > 0) {
                daysWorked = Math.min(workedLogs.length, totalWorkingDays);
            }
        } catch (attErr) {
            console.warn('[DB] Attendance log calculation fallback:', attErr);
        }

        // Calculate unused Paid Leave (PL) encashment
        let unusedPL = 12;
        try {
            const role = emp.role || 'manager';
            const settingsSnap = await firebase.firestore().collection('leaveQuotaSettings').doc('global').get();
            const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
            const defaultQuotas = { employee: {sick:5,casual:5,paid:10}, manager: {sick:7,casual:7,paid:12} };
            const globalQuotas = {
                employee: { ...defaultQuotas.employee, ...settingsData.employee },
                manager: { ...defaultQuotas.manager, ...settingsData.manager }
            };
            const defaults = globalQuotas[role] || globalQuotas.manager;
            const totalPLQuota = (emp.leaveQuotaOverride && emp.leaveQuotaOverride.paid !== undefined)
                ? Number(emp.leaveQuotaOverride.paid)
                : Number(defaults.paid || 12);

            const paidLeavesSnap = await firebase.firestore().collection('leaveRequests')
                .where('employeeId', '==', empId)
                .get();

            let usedPL = 0;
            paidLeavesSnap.forEach(doc => {
                const data = doc.data();
                if ((data.leaveType === 'paid' || data.type === 'paid') && (data.status === 'approved' || data.status === 'admin_approved')) {
                    const start = new Date(data.startDate);
                    const end = new Date(data.endDate);
                    const days = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
                    usedPL += isNaN(days) ? 0 : days;
                }
            });

            unusedPL = Math.max(0, totalPLQuota - usedPL);
        } catch (balErr) {
            console.warn('[DB] Leave quota calculation fallback:', balErr);
            unusedPL = 12;
        }

        const dailyRate = Math.round((baseSalary / totalWorkingDays) * 100) / 100;
        const proRatedSalary = Math.round(dailyRate * daysWorked);
        const plEncashment = Math.round(dailyRate * unusedPL);
        const unpaidBonusTotal = 0;
        const totalAmount = proRatedSalary + plEncashment + unpaidBonusTotal;

        return {
            resignationId: docSnap.id,
            fullName: emp.name || emp.fullName || emp.email || 'Employee',
            baseSalary,
            totalWorkingDays,
            dailyRate,
            daysWorked,
            proRatedSalary,
            unusedPL,
            plEncashment,
            unpaidBonusTotal,
            totalAmount
        };
    }

    // ── Admin: Get Admin Pending Approvals Total Count ─────────────
    async function getAdminPendingTotalCount() {
        await _getUid();
        try {
            const [leave, resignations, advances, hire, removal, bonuses, hikes, settlements] = await Promise.all([
                db.getPendingLeaveRequests(),
                db.getPendingResignations(),
                db.getPendingAdvances(),
                db.getPendingHireProposals(),
                db.getPendingRemovalProposals(),
                db.getPendingBonusProposals(),
                db.getSalaryHikeRequests(),
                db.getPendingSettlements()
            ]);
            return (leave.length + resignations.length + advances.length + hire.length + removal.length + bonuses.length + hikes.length + settlements.length);
        } catch (e) {
            console.warn('[DB] Failed to fetch total pending count:', e);
            return 0;
        }
    }

    // ── Finance: Release Settlement ──────────────────────────────
    async function releaseSettlement(resignationId) {
        await _getUid();
        await firebase.firestore().collection('resignationRequests').doc(resignationId).update({
            settlementReleased: true,
            settlementReleasedAt: new Date().toISOString()
        });
        return { success: true };
    }

    // ── Finance: Get Finance Report ──────────────────────────────
    async function getFinanceReport(startMonth, endMonth) {
        await _getUid();
        return {
            months: [startMonth, endMonth],
            burnData: [0, 0],
            headcountData: [0, 0]
        };
    }

    // ── Finance: Get Headcount Summary ───────────────────────────
    async function getHeadcountSummary() {
        await _getUid();
        return { Engineering: 0, Design: 0, Sales: 0, HR: 0, Marketing: 0 };
    }

    // ── Admin: Get Pending Bonus Proposals ───────────────────────
    // Returns all bonus records with approvalStatus === 'pending_approval'
    async function getPendingBonusProposals() {
        await _getUid();
        const snap = await firebase.firestore().collection('bonusProposals').where('status', '==', 'pending_admin').orderBy('submittedAt', 'desc').get();
        return snap.docs.map(d => ({ proposalId: d.id, ...d.data() }));
    }

    // ── Admin: Approve / Reject a Bonus Proposal ─────────────────
    // action: 'approve' | 'reject'
    async function adminActOnBonusProposal(bonusId, action, note) {
        await _getUid();
        const status = action === 'approve' ? 'approved' : 'rejected';
        await firebase.firestore().collection('bonusProposals').doc(bonusId).update({ status, adminComment: note, decidedAt: new Date().toISOString() });
        return { success: true };
    }

    // ── Salary Hike: Mock Data ────────────────────────────────────
    var _MOCK_HIKE_REQUESTS = [
        {
            requestId:      'HIKE-001',
            employeeId:     'EMP001',
            employeeName:   'Rahul Mehta',
            employeeCode:   'BHR-2024-001',
            designation:    'Software Engineer',
            department:     'Engineering',
            managerId:      'MGR001',
            managerName:    'Priya Sharma',
            currentSalary:  65000,
            proposedSalary: 78000,
            justification:  'Rahul has consistently exceeded quarterly targets and took on senior architecture responsibilities not in his original scope.',
            status:         'pending_admin',
            effectiveMonth: '2026-07',
            createdAt:      new Date(Date.now() - 2 * 86400000).toISOString(),
            adminDecision:  { adminId: null, comment: null, decidedAt: null },
        },
        {
            requestId:      'HIKE-002',
            employeeId:     'EMP002',
            employeeName:   'Ananya Singh',
            employeeCode:   'BHR-2024-002',
            designation:    'UI/UX Designer',
            department:     'Design',
            managerId:      'MGR001',
            managerName:    'Priya Sharma',
            currentSalary:  55000,
            proposedSalary: 65000,
            justification:  'Ananya led the end-to-end product redesign and improved user activation by 30%. Requesting a market-rate adjustment.',
            status:         'pending_admin',
            effectiveMonth: '2026-07',
            createdAt:      new Date(Date.now() - 86400000).toISOString(),
            adminDecision:  { adminId: null, comment: null, decidedAt: null },
        },
    ];

    // ── Manager: Request Salary Hike ─────────────────────────────
    // Accepts optional employee details (name, code, etc.) to avoid re-fetching.
    async function requestSalaryHike(employeeId, { proposedSalary, justification, effectiveMonth, employeeName, employeeCode, designation, department, currentSalary }) {

        const uid = await _getUid();
        const accSnap = await firebase.firestore().collection('accounts').doc(uid).get();
        const managerId = accSnap.data().employeeId;
        const managerSnap = await firebase.firestore().collection('employees').doc(managerId).get();
        const managerName = managerSnap.exists ? managerSnap.data().fullName : managerId;
        
        const ref = firebase.firestore().collection('salaryHikeRequests').doc();
        await ref.set({
            employeeId,
            proposedSalary: Number(proposedSalary),
            justification,
            effectiveMonth,
            employeeName,
            employeeCode,
            designation,
            department,
            currentSalary,
            requestedByManager: managerId,
            requestedByManagerName: managerName,
            status: 'pending_admin',
            requestedAt: new Date().toISOString(),
            adminDecision: { adminId: null, comment: null, decidedAt: null },
        });
        return { success: true, requestId: ref.id };
    }

    // ── Admin: Get Pending Salary Hike Requests ───────────────────
    async function getSalaryHikeRequests() {
        await _getUid();
        const snap = await firebase.firestore().collection('salaryHikeRequests').where('status', '==', 'pending_admin').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ── Admin: Approve or Reject a Salary Hike Request ───────────
    async function adminActOnHikeRequest(requestId, action, comment) {
        await _getUid();
        const status = action === 'approve' ? 'approved' : 'rejected';
        const docRef = firebase.firestore().collection('salaryHikeRequests').doc(requestId);
        const doc = await docRef.get();
        await docRef.update({ status, adminReason: comment, decidedAt: new Date().toISOString() });
        if (action === 'approve' && doc.exists) {
            await firebase.firestore().collection('employees').doc(doc.data().employeeId).update({ baseSalary: Number(doc.data().proposedSalary), updatedAt: new Date().toISOString() });
        }
        return { success: true };
    }

    // ── Admin: Direct Salary Edit ─────────────────────────────────
    async function adminDirectSalaryEdit(employeeId, newSalary, reason) {
        const uid = await _getUid();
        const empRef = firebase.firestore().collection('employees').doc(employeeId);
        const empSnap = await empRef.get();
        if (!empSnap.exists) throw new Error('Employee not found');
        const oldSalary = empSnap.data().baseSalary;
        
        await empRef.update({ baseSalary: Number(newSalary), updatedAt: new Date().toISOString() });
        
        await firebase.firestore().collection('auditLogs').add({ 
            action: 'salary_edit', 
            employeeId, oldSalary, newSalary: Number(newSalary), reason: reason || '', 
            actor: uid, createdAt: new Date().toISOString() 
        });
        return { success: true, oldSalary, newSalary: Number(newSalary) };
    }

    // ── Admin: Get Employee Detail (including Resignation & Last Attendance) ──
    async function getEmployeeDetail(employeeId) {
        await _getUid();
        let emp = {};
        try {
            const empSnap = await firebase.firestore().collection('employees').doc(employeeId).get();
            if (empSnap.exists) emp = empSnap.data();
            else {
                const accSnap = await firebase.firestore().collection('accounts').doc(employeeId).get();
                if (accSnap.exists) emp = accSnap.data();
            }
        } catch (e) {
            console.warn('[DB] Error fetching employee in getEmployeeDetail:', e);
        }

        // Fetch Resignation Details if on notice or resigned
        let resignation = null;
        try {
            const searchIds = [employeeId];
            if (emp.employeeCode && !searchIds.includes(emp.employeeCode)) searchIds.push(emp.employeeCode);
            if (emp.empCode && !searchIds.includes(emp.empCode)) searchIds.push(emp.empCode);
            if (emp.employeeId && !searchIds.includes(emp.employeeId)) searchIds.push(emp.employeeId);

            const resSnap = await firebase.firestore().collection('resignationRequests')
                .where('employeeId', 'in', searchIds)
                .get();
            if (!resSnap.empty) {
                const docs = resSnap.docs.map(d => ({ requestId: d.id, ...d.data() }));
                docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                resignation = docs[0];
            }
        } catch (resErr) {
            console.warn('[DB] Error fetching resignation in getEmployeeDetail:', resErr);
        }

        // Fetch Last Attendance Record
        let lastAttendance = null;
        try {
            const searchIds = [employeeId];
            if (emp.employeeCode && !searchIds.includes(emp.employeeCode)) searchIds.push(emp.employeeCode);
            if (emp.empCode && !searchIds.includes(emp.empCode)) searchIds.push(emp.empCode);
            if (emp.employeeId && !searchIds.includes(emp.employeeId)) searchIds.push(emp.employeeId);

            const attSnap = await firebase.firestore().collection('attendanceLogs')
                .where('employeeId', 'in', searchIds)
                .get();
            const allAttSnap = await firebase.firestore().collection('attendanceLogs').limit(5).get().catch(() => null);
            console.log('[NoticeTab Debug]', {
                passedEmployeeId: employeeId,
                empData: emp,
                searchedIDs: searchIds,
                attSnapSize: attSnap.size,
                docs: attSnap.docs.map(d => d.data()),
                allAttendanceLogsInDB: allAttSnap ? allAttSnap.docs.map(d => ({ id: d.id, data: d.data() })) : []
            });
            if (!attSnap.empty) {
                const logs = attSnap.docs.map(d => ({ logId: d.id, ...d.data() }));
                logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                lastAttendance = logs[0];
            }
        } catch (attErr) {
            console.warn('[DB] Error fetching attendance in getEmployeeDetail:', attErr);
        }

        // Fetch Documents
        let documents = [];
        try {
            const docSnap = await firebase.firestore().collection('employeeDocuments')
                .where('employeeId', '==', employeeId)
                .get();
            if (!docSnap.empty) {
                documents = docSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
            }
        } catch (docErr) {
            console.warn('[DB] Error fetching docs in getEmployeeDetail:', docErr);
        }

        return {
            employeeId,
            address: emp.address || emp.contactAddress || '',
            emergencyContact: emp.emergencyContact || null,
            resignation,
            lastAttendance,
            documents,
            noticeDocs: resignation && resignation.requestedDocs ? resignation.requestedDocs : []
        };
    }

    // ── Finance: Request Calendar Lock ───────────────────────────
    async function financeRequestCalendarLock(month) {
        await _getUid();
        const adminsSnap = await firebase.firestore().collection('accounts').where('role', '==', 'super_admin').get();
        const batch = firebase.firestore().batch();
        adminsSnap.forEach(doc => {
            const ref = firebase.firestore().collection('notifications').doc();
            batch.set(ref, {
                recipientAccountId: doc.id,
                type: 'calendar_lock_request',
                month,
                message: 'Finance has requested the working calendar for ' + month + ' to be locked for payroll processing.',
                createdAt: new Date().toISOString(),
                read: false
            });
        });
        await batch.commit();
        return { success: true };
    }

    // ── Admin: Get Payslips for Any Employee ────────────────────
    // Admin-scoped version of getPayslips() that accepts an employeeId.
    // Mock: reuses the employee-self payslip shape (same data for all in demo).
    async function getAdminEmployeePayslips(employeeId) {
        await _getUid();
        const snap = await firebase.firestore().collection('payrollRecords')
          .where('employeeId', '==', employeeId)
          .where('status', 'in', ['paid', 'issued'])
          .orderBy('month', 'desc').get();
        return snap.docs.map(d => ({ payslipId: d.id, ...d.data() }));
    }

    // ── Admin: Get Leave History for Any Employee ────────────────
    // Admin-scoped version of getLeaveHistory() that accepts an employeeId.
    // Mock: reuses the employee-self leave shape (same data for all in demo).
    async function getAdminEmployeeLeaves(employeeId) {
        await _getUid();
        const snap = await firebase.firestore().collection('leaveRequests')
          .where('employeeId', '==', employeeId)
          .orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ requestId: d.id, ...d.data() }));
    }

    // ── Admin: Get Session Logs ──────────────────────────────────
    // params: { page, limit, search, role, dateFrom, dateTo, logoutReason }
    //   search:       matches employeeName or employeeCode or employeeId (case-insensitive)
    //   role:         '' | 'employee' | 'manager'
    //   logoutReason: '' | 'manual' | 'idle_timeout' | 'active' (null logoutAt)
    async function getAdminSessionLogs(params) {
        await _getUid();
        var p      = params || {};
        var page   = p.page   || 1;
        var limit  = p.limit  || 20;
        var search = (p.search || '').toLowerCase();
        var role   = p.role   || '';
        var reason = p.logoutReason || '';
        var from   = p.dateFrom ? new Date(p.dateFrom)              : null;
        var to     = p.dateTo   ? new Date(p.dateTo + 'T23:59:59Z') : null;

        let snap = await firebase.firestore().collection('sessionLogs')
            .orderBy('loginAt', 'desc')
            .limit(100)
            .get().catch(() => null);

        let logs = [];
        if (snap && !snap.empty) {
            const rawDocs = snap.docs.map(d => ({ logId: d.id, sessionId: d.id, ...d.data() }));

            // Look up employee codes for employeeId/accountId
            const empIds = [...new Set(rawDocs.map(d => d.employeeId || d.accountId).filter(Boolean))];
            const empMap = {};
            for (const id of empIds) {
                try {
                    const empDoc = await firebase.firestore().collection('employees').doc(id).get();
                    if (empDoc.exists) {
                        empMap[id] = empDoc.data().employeeCode;
                    } else {
                        const qSnap = await firebase.firestore().collection('employees').where('accountId', '==', id).get();
                        if (!qSnap.empty) {
                            empMap[id] = qSnap.docs[0].data().employeeCode;
                        }
                    }
                } catch(e) {}
            }

            const twelveHoursAgo = Date.now() - (12 * 3600 * 1000);

            logs = rawDocs.map(data => {
                let logoutAt = data.logoutAt || data.logoutTime || null;
                let logoutReason = data.logoutReason || null;
                const loginAt = data.loginAt || data.loginTime || new Date().toISOString();

                // If active for over 12 hours without logout, mark session as expired
                if (!logoutAt && new Date(loginAt).getTime() < twelveHoursAgo) {
                    const expTime = new Date(new Date(loginAt).getTime() + 3600 * 1000).toISOString();
                    logoutAt = expTime;
                    logoutReason = 'session_expired';

                    // Update in Firestore asynchronously
                    firebase.firestore().collection('sessionLogs').doc(data.sessionId).update({
                        logoutTime: expTime,
                        logoutAt: expTime,
                        logoutReason: 'session_expired'
                    }).catch(() => {});
                }

                const empId = data.employeeId || data.accountId || 'EMP';
                const empCode = data.employeeCode || empMap[empId] || empMap[data.accountId] || empId;

                return {
                    logId: data.logId,
                    sessionId: data.sessionId,
                    employeeId: empId,
                    employeeName: data.employeeName || 'User',
                    employeeCode: empCode,
                    role: data.role || 'employee',
                    loginAt: loginAt,
                    logoutAt: logoutAt,
                    logoutReason: logoutReason,
                    ipAddress: '192.168.1.1',
                    userAgent: navigator.userAgent
                };
            });
        }

        var filtered = logs.filter(function(s) {
            if (search && !((s.employeeName || '').toLowerCase().includes(search) || (s.employeeCode || '').toLowerCase().includes(search) || (s.employeeId || '').toLowerCase().includes(search))) return false;
            if (role   && s.role !== role)   return false;
            if (from   && new Date(s.loginAt) < from) return false;
            if (to     && new Date(s.loginAt) > to)   return false;
            if (reason === 'active'       && s.logoutAt !== null)              return false;
            if (reason === 'manual'       && s.logoutReason !== 'manual')       return false;
            if (reason === 'idle_timeout' && s.logoutReason !== 'idle_timeout') return false;
            return true;
        });

        filtered.sort(function(a, b) { return new Date(b.loginAt) - new Date(a.loginAt); });

        var total   = filtered.length;
        var start   = (page - 1) * limit;
        var hasMore = start + limit < total;
        return { logs: filtered.slice(start, start + limit), total: total, hasMore: hasMore };
    }

    async function getAdminAuditLogs(filters = {}) {
        await _getUid();
        let snap = await firebase.firestore().collection('auditLogs')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get().catch(() => null);

        let logs = [];
        if (snap && !snap.empty) {
            logs = snap.docs.map(d => ({ logId: d.id, ...d.data() }));
        }

        if (filters.category && filters.category !== 'all') {
            logs = logs.filter(l => l.category === filters.category);
        }
        if (filters.action) {
            logs = logs.filter(l => l.action === filters.action);
        }
        if (filters.actor) {
            logs = logs.filter(l => l.actorRole === filters.actor || l.actorAccountId === filters.actor);
        }

        const search = (filters.search || '').toLowerCase();
        if (search) {
            logs = logs.filter(l =>
                (l.actorName || '').toLowerCase().includes(search) ||
                (l.actionLabel || '').toLowerCase().includes(search) ||
                (l.targetName || '').toLowerCase().includes(search)
            );
        }

        const limit = filters.limit || 20;
        const page = filters.page || 1;
        const start = (page - 1) * limit;
        const paged = logs.slice(start, start + limit);
        return { logs: paged, total: logs.length, hasMore: (start + limit) < logs.length };
    }

    // ── Public API ──────────────────────────────────────────────


    //  submitNegotiationMessage 
    async function submitNegotiationMessage(candidateId, role, name, message) {
        await _getUid();
        const ref = firebase.firestore().collection('candidates').doc(candidateId);
        const snap = await ref.get();
        const threads = snap.data().offerNegotiations || [];
        threads.push({
            role, name, message, timestamp: new Date().toISOString()
        });
        await ref.update({ offerNegotiations: threads });
        return { success: true };
    }

    //  setOfferStatusToDraft 
    async function setOfferStatusToDraft(candidateId) {
        await _getUid();
        await firebase.firestore().collection('candidates').doc(candidateId).update({
            offerLetterStatus: 'not_started',
            currentStage: 'offer_draft'
        });
        return { success: true };
    }

    return {
        endSession,
        logout,
        startIdleWatcher,
        getEmployeeProfile,
        getLeaveBalances,
        getLastSalary,
        getUpcomingHolidays,
        getNotifications,
        subscribeToNotifications,
        checkSidebarHoldBadge,
        markAllNotificationsRead,
        markNotificationAsRead,
        deleteNotification,
        getAttendanceSettings,
        getTodayAttendance,
        markAttendance,
        getAttendanceHistory,
        getAttendanceStats,
        getLeaveHistory,
        submitLeaveRequest,
        uploadLeaveDocument,
        respondToDocRequest,
        getMyDocuments,
        uploadDocument,
        getPayslips,
        requestSalaryAdvance,
        getAdvanceHistory,
        getResignationStatus,
        submitResignation,
        updateEmployeePhone,
        updateEmployeeContactInfo,
        updateProfilePhoto,
        getMyReminders,
        getManagerReminders,
        dismissReminder,
        sendReminder,
        getSentReminders,
        // Manager functions
        getManagerProfile,
        getManagerDashboard,
        getManagerLeaveBalance,
        getManagerLeaveHistory,
        submitManagerLeaveRequest,
        getManagerDocuments,
        uploadManagerDocument,
        getManagerResignationStatus,
        submitManagerResignation,
        respondToManagerResignationDoc,
        getManagerLastSalary,
        getManagerPayslips,
        requestManagerSalaryAdvance,
        getManagerAdvanceHistory,
        getRecentTeamActivity,
        getManagerNotifications,
        getManagerTeam,
        getTeamMemberDetail,
        getTeamMemberDocuments,
        getTeamLeaveRequests,
        approveLeaveRequest,
        rejectLeaveRequest,
        getTeamResignationRequests,
        approveResignationRequest,
        rejectResignationRequest,
        managerRequestResignationDoc,
        getTeamPendingDocuments,
        verifyDocument,
        rejectDocument,
        requestDocumentFromEmployee,
        getHiringProposals,
        submitHiringProposal,
        getRemovalProposals,
        submitRemovalProposal,
        getCandidatePipeline,
        getCandidateDetail,
        addHiringRound,
        updateHiringRound,
        requestCandidateDocument,
        verifyManagerDocument,
        rejectManagerDocument,
        // Admin functions
        getAdminDashboardStats,
        getPendingApprovalCounts,
        getRecentAuditActivity,
        getAdminNotifications,
        getAllEmployees,
        addEmployee,
        addManager,
        terminateEmployee,
        promoteEmployeeToManager,
        forceResetPassword,
        getEmployeeDetail,
        updateEmployeeProfile,
        // Admin — Approvals
        getPendingLeaveRequests,
        approveLeave,
        rejectLeave,
        requestLeaveDocument,
        managerRequestLeaveDocument,
        getPendingResignations,
        approveResignation,
        rejectResignation,
        requestResignationDoc,
        respondToResignationDoc,
        getPendingAdvances,
        approveAdvance,
        rejectAdvance,
        getPendingHireProposals,
        approveHireProposal,
        rejectHireProposal,
        getPendingRemovalProposals,
        approveRemovalProposal,
        rejectRemovalProposal,
        getEmployeeDirectory,
        getPendingBonusProposals,
        adminActOnBonusProposal,
        requestSalaryHike,
        getSalaryHikeRequests,
        adminActOnHikeRequest,
        adminDirectSalaryEdit,
        // Admin — Hiring
        getAllCandidates,
        getAdminCandidateDetail,
        addCandidate,
        sendPortalInvite,
        prepareOfferPackage,
        adminVerifyCandidateDocument,
        adminRejectCandidateDocument,
        adminRequestCandidateDocument,
        adminVerifyEmployeeDocument,
        adminRejectEmployeeDocument,
        adminRejectCandidate,
        // Admin/Manager — new hiring flow
        prepareOfferLetterDraft,
        putCandidateOnHold,
        removeCandidateHold,
        managerRejectCandidate,
        submitNegotiationMessage,
        setOfferStatusToDraft,
        adminGetPendingOfferDrafts,
        adminApproveOfferDraft,
        adminRejectOfferDraft,
        adminTriggerEmployeeCredentials,
        // Finance — hiring
        getFinancePendingOfferLetters,
        financeAddTermsAndSend,
        // Candidate portal — hiring
        acceptOffer,
        rejectOffer,
        getCandidateProfile,
        getCandidateDocuments,
        uploadCandidateDocument,
        // Admin — Payroll
        getAdminPayrollMonth,
        adminIssuePayslip,
        adminReleasePayment,
        adminSetBonus,
        adminGeneratePayroll,
        // Admin — Attendance
        getAdminAttendanceReport,
        getAdminEarlyCheckouts,
        getAdminAttendanceSettings,
        adminUpdateAttendanceSettings,
        getAdminWorkingCalendar,
        adminToggleWorkingDay,
        adminLockWorkingCalendar,
        adminOverrideAttendance,
        // Admin — Audit Logs
        getAdminAuditLogs,
        getAdminAuditStats,
        // Admin — Leave Quotas
        getLeaveQuotaSettings,
        getAllLeaveQuotas,
        setGlobalLeaveQuota,
        setIndividualLeaveQuota,
        clearIndividualLeaveQuota,
        // Finance functions
        getFinanceDashboardStats,
        getFinancePendingActions,
        getFinancePayrollMonth,
        financeIssuePayslip,
        financeReleasePayment,
        getBonuses,
        addBonus,
        editBonus,
        deleteBonus,
        getApprovedAdvances,
        disburseAdvance,
        getPendingSettlements,
        getSettlementDetails,
        releaseSettlement,
        getAdminPendingTotalCount,
        getFinanceReport,
        getHeadcountSummary,
        financeRequestCalendarLock,
        getIdleTimeoutSetting,
        setIdleTimeoutSetting,
        getAdminSessionLogs,
        getAdminEmployeePayslips,
        getAdminEmployeeLeaves,
        logAuditEvent,
    };

})();

// ── BeanHR Global Error Layer ─────────────────────────────────
// Catches any unhandled async rejection or uncaught error anywhere
// in the app. In dev: shows a visible red banner + console detail.
// In production (Firebase hosting): replace console.error with a
// real error reporting call (e.g. Sentry, Firestore errorLogs collection).
// ─────────────────────────────────────────────────────────────
(function () {
    const IS_DEV = window.location.hostname === 'localhost' ||
                   window.location.hostname === '127.0.0.1' ||
                   window.location.hostname === '';

    function _showErrorBanner(message) {
        if (!IS_DEV) return;
        // Only show one banner at a time
        if (document.getElementById('_bhr_err_banner')) return;
        const banner = document.createElement('div');
        banner.id = '_bhr_err_banner';
        banner.style.cssText = [
            'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:99999', 'background:#1e0505', 'color:#fca5a5',
            'border:1px solid #ef4444', 'border-radius:10px',
            'padding:10px 16px', 'font:12px/1.5 monospace',
            'max-width:calc(100vw - 32px)', 'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
            'cursor:pointer', 'white-space:pre-wrap', 'word-break:break-all',
        ].join(';');
        banner.title = 'Click to dismiss';
        banner.textContent = '⚠ Unhandled error (dev only)\n' + message;
        banner.addEventListener('click', () => banner.remove());
        document.body.appendChild(banner);
        // Auto-remove after 12 seconds
        setTimeout(() => banner && banner.remove(), 12000);
    }

    // Unhandled promise rejections (async functions that throw without try/catch)
    window.addEventListener('unhandledrejection', function (event) {
        const reason = event.reason;
        const msg = reason instanceof Error
            ? reason.stack || reason.message
            : String(reason);
        console.error('[BeanHR] Unhandled promise rejection:', reason);
        _showErrorBanner(msg);
    });

    // Uncaught synchronous errors
    window.addEventListener('error', function (event) {
        console.error('[BeanHR] Uncaught error:', event.error || event.message);
        _showErrorBanner(event.error ? (event.error.stack || event.error.message) : event.message);
    });

})();
