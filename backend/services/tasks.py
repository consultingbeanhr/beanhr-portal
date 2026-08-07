from celery.utils.log import get_task_logger
import firebase_admin
from firebase_admin import firestore, credentials
import os
from datetime import datetime, timedelta
import pytz

from backend.celery_app import celery_app

logger = get_task_logger(__name__)

# Ensure Firebase is initialized
if not firebase_admin._apps:
    ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
    cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    
    if cred_path and cred_path.strip().startswith('{'):
        import json
        try:
            cred_dict = json.loads(cred_path)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        except Exception as e:
            logger.error(f"Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON: {e}")
    elif cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
    else:
        local_path = os.path.join(ROOT_DIR, 'beanhr-portal-firebase-adminsdk.json')
        if os.path.exists(local_path):
            cred = credentials.Certificate(local_path)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        else:
            logger.warning(f"Firebase credentials not found. Relying on Default Application Credentials.")
            firebase_admin.initialize_app(options={'storageBucket': 'beanhr-portal.firebasestorage.app'})

@celery_app.task(name='backend.services.tasks.run_hourly_jobs')
def run_hourly_jobs():
    logger.info("Starting hourly cron job...")
    db = firestore.client()
    now = datetime.utcnow()
    
    # 1. Credential Expiry (Candidates)
    try:
        accounts_ref = db.collection('accounts').where('role', '==', 'candidate').where('status', '==', 'active').stream()
        disabled_count = 0
        batch_count = 0
        batch = db.batch()
        
        for acc in accounts_ref:
            data = acc.to_dict()
            
            cand_ref = db.collection('candidateProfiles').document(acc.id).get()
            if not cand_ref.exists:
                continue
                
            cand_data = cand_ref.to_dict()
            offer_status = cand_data.get('offerLetterStatus', 'not_sent')
            should_expire = False
            
            if offer_status == 'accepted':
                joining_date_str = cand_data.get('joiningDate')
                if joining_date_str:
                    try:
                        joining_date = datetime.strptime(joining_date_str, '%Y-%m-%d').replace(tzinfo=pytz.UTC)
                        if now.replace(tzinfo=pytz.UTC) >= joining_date:
                            should_expire = True
                    except ValueError:
                        pass
            elif offer_status == 'rejected':
                rejected_at_str = cand_data.get('offerRejectedAt')
                if rejected_at_str:
                    try:
                        rejected_at = datetime.fromisoformat(rejected_at_str.replace('Z', '+00:00'))
                        if now.replace(tzinfo=pytz.UTC) > rejected_at + timedelta(hours=72):
                            should_expire = True
                    except Exception:
                        pass
                else:
                    should_expire = True
            else:
                expiry_date = data.get('expiresAt') or cand_data.get('portalCredentialsExpiresAt')
                if expiry_date:
                    if now.replace(tzinfo=pytz.UTC) > expiry_date:
                        should_expire = True
                        
            if should_expire:
                batch.update(db.collection('accounts').document(acc.id), {
                    'status': 'expired'
                })
                disabled_count += 1
                batch_count += 1
                logger.info(f"Expired candidate portal for {acc.id}")
                
                # PREVENT BATCH LIMIT CRASH (> 500)
                if batch_count >= 400:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
                    
                # Extra Production Security: Disable the Firebase Auth user entirely
                from firebase_admin import auth
                try:
                    auth.update_user(acc.id, disabled=True)
                except Exception as e:
                    logger.warning(f"Could not disable Firebase Auth for {acc.id}: {e}")
                    
        if batch_count > 0:
            batch.commit()
            
        logger.info(f"Hourly job complete. Disabled candidates: {disabled_count}")
        return {'status': 'success', 'disabled_candidates': disabled_count}
        
    except Exception as e:
        logger.error(f'[CRON HOURLY ERROR] {e}')
        raise e


@celery_app.task(name='backend.services.tasks.run_daily_jobs')
def run_daily_jobs():
    logger.info("Starting daily cron job...")
    db = firestore.client()
    
    # Run at 2:00 AM IST for the previous day
    ist = pytz.timezone('Asia/Kolkata')
    now_ist = datetime.now(ist)
    yesterday_ist = now_ist - timedelta(days=1)
    yesterday_str = yesterday_ist.strftime('%Y-%m-%d')
    
    try:
        # 1. Auto-Checkout
        logs_ref = db.collection('attendanceLogs').where('date', '==', yesterday_str).stream()
        
        batch = db.batch()
        batch_count = 0
        auto_checkout_count = 0
        absent_count = 0
        
        present_employee_ids = set()
        
        for log in logs_ref:
            data = log.to_dict()
            emp_id = data.get('employeeId')
            if emp_id:
                present_employee_ids.add(emp_id)
                
            if data.get('status') in ['present', 'late'] and not data.get('checkOutAt'):
                checkout_dt = yesterday_ist.replace(hour=18, minute=30, second=0, microsecond=0)
                checkout_iso = checkout_dt.astimezone(pytz.UTC).strftime('%Y-%m-%dT%H:%M:%S.000Z')
                
                log_doc_ref = db.collection('attendanceLogs').document(log.id)
                batch.update(log_doc_ref, {
                    'checkOutAt': checkout_iso,
                    'earlyCheckout': False,
                    'autoCheckedOut': True
                })
                auto_checkout_count += 1
                batch_count += 1
                logger.info(f"Auto-checked out employee {emp_id}")
                
                if batch_count >= 400:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
                    
        if batch_count > 0:
            batch.commit()
            batch = db.batch()
            batch_count = 0

        # 2. Absence Checker
        month_str = yesterday_ist.strftime('%Y-%m')
        cal_ref = db.collection('workingCalendar').document(month_str).get()
        is_working_day = True
        
        if cal_ref.exists:
            cal_data = cal_ref.to_dict()
            non_working_dates = cal_data.get('nonWorkingDates', [])
            if yesterday_str in non_working_dates:
                is_working_day = False
                
        if is_working_day:
            employees_ref = db.collection('employees').where('employmentStatus', 'in', ['active', 'on_notice']).stream()
            
            for emp in employees_ref:
                emp_id = emp.id
                if emp_id not in present_employee_ids:
                    leave_ref = db.collection('leaveRequests').where('employeeId', '==', emp_id).where('status', 'in', ['admin_approved', 'manager_approved']).stream()
                    
                    on_leave = False
                    for l_doc in leave_ref:
                        l_data = l_doc.to_dict()
                        s_date = l_data.get('startDate')
                        e_date = l_data.get('endDate')
                        
                        if s_date and e_date:
                            if isinstance(s_date, str):
                                s_dt = s_date
                            else:
                                s_dt = s_date.replace(tzinfo=pytz.UTC).astimezone(ist).strftime('%Y-%m-%d')
                                
                            if isinstance(e_date, str):
                                e_dt = e_date
                            else:
                                e_dt = e_date.replace(tzinfo=pytz.UTC).astimezone(ist).strftime('%Y-%m-%d')
                                
                            if s_dt <= yesterday_str <= e_dt:
                                on_leave = True
                                break
                    
                    if not on_leave:
                        new_log_ref = db.collection('attendanceLogs').document(f'ATT-{yesterday_str}-{emp_id}')
                        batch.set(new_log_ref, {
                            'employeeId': emp_id,
                            'date': yesterday_str,
                            'status': 'absent',
                            'markedAt': now_ist,
                            'autoGenerated': True,
                            'createdAt': firestore.SERVER_TIMESTAMP
                        })
                        absent_count += 1
                        batch_count += 1
                        logger.info(f"Marked employee {emp_id} absent for {yesterday_str}")
                        
                        if batch_count >= 400:
                            batch.commit()
                            batch = db.batch()
                            batch_count = 0
                            
        if batch_count > 0:
            batch.commit()
            
        # 3. Candidate Hold Reminders
        today_str = now_ist.strftime('%Y-%m-%d')
        hold_ref = db.collection('candidateProfiles').where('holdDetails.isOnHold', '==', True).stream()
        
        batch = db.batch()
        batch_count = 0
        hold_reminder_count = 0
        
        for cand in hold_ref:
            cand_data = cand.to_dict()
            hold_details = cand_data.get('holdDetails', {})
            reminder_at = hold_details.get('reminderAt')
            
            if reminder_at:
                try:
                    # FIX: Handle if Firestore returns a python datetime object instead of string
                    matches_today = False
                    if isinstance(reminder_at, datetime):
                        reminder_date_str = reminder_at.astimezone(ist).strftime('%Y-%m-%d')
                        matches_today = (reminder_date_str == today_str)
                    else:
                        matches_today = str(reminder_at).startswith(today_str)
                        
                    if matches_today:
                        set_by_id = hold_details.get('setByEmployeeId')
                        if set_by_id:
                            notif_ref = db.collection('notifications').document()
                            batch.set(notif_ref, {
                                'recipientAccountId': set_by_id,
                                'type': 'candidate_hold_reminder',
                                'title': 'Candidate Hold Reminder',
                                'message': f"Reminder: Review the hold status for candidate {cand_data.get('fullName', 'Unknown')}.",
                                'relatedEntityId': cand.id,
                                'read': False,
                                'createdAt': firestore.SERVER_TIMESTAMP
                            })
                            hold_reminder_count += 1
                            batch_count += 1
                            logger.info(f"Created hold reminder for candidate {cand.id}")
                            
                            if batch_count >= 400:
                                batch.commit()
                                batch = db.batch()
                                batch_count = 0
                except Exception as e:
                    logger.error(f"Error parsing hold reminder date for {cand.id}: {e}")
                    
        if batch_count > 0:
            batch.commit()
            
        logger.info(f"Daily job complete. Auto-checkouts: {auto_checkout_count}, Absences marked: {absent_count}, Hold Reminders: {hold_reminder_count}")
        return {
            'status': 'success',
            'auto_checkouts': auto_checkout_count,
            'auto_absences': absent_count,
            'hold_reminders': hold_reminder_count
        }
        
    except Exception as e:
        logger.error(f'[CRON DAILY ERROR] {e}')
        raise e
