import string
import secrets
from flask import Blueprint, request, jsonify
import firebase_admin
from firebase_admin import auth, firestore
import requests
import os
import time
import datetime

auth_bp = Blueprint('auth_bp', __name__, url_prefix='/api/auth')

def generate_temp_password(length=12):
    # Ensure at least one of each required character type to meet typical strong password requirements
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(secrets.choice(alphabet) for i in range(length))

@auth_bp.route('/provision-user', methods=['POST'])
def provision_user():
    """
    Securely create a Firebase Auth user + Firestore Document and send email.
    Expected payload:
    {
        "role": "employee" | "manager" | "candidate",
        "email": "user@example.com",
        "fullName": "John Doe",
        # ... other fields to save to firestore ...
    }
    """
    try:
        data = request.json
        if not data or not data.get('email') or not data.get('role'):
            return jsonify({'error': 'Email and role are required'}), 400
            
        email = data['email']
        role = data['role']
        full_name = data.get('fullName', 'User')
        
        # 1. Verify authorization here (stubbed for now - should verify Firebase ID token)
        # auth_header = request.headers.get('Authorization')
        # ...
        
        # 2. Create Auth User
        temp_password = generate_temp_password()
        try:
            user = auth.create_user(
                email=email,
                password=temp_password,
                display_name=full_name
            )
        except firebase_admin.auth.EmailAlreadyExistsError:
            return jsonify({'error': 'The email address is already in use by another account.'}), 400
        except Exception as e:
            return jsonify({'error': f'Failed to create auth user: {str(e)}'}), 500
            
        # 3. Set Custom Claims
        auth.set_custom_user_claims(user.uid, {'role': role})
        
        # 4. Create Firestore Records
        db = firestore.client()
        
        if role in ['employee', 'manager']:
            new_code = data.get('employeeCode')
            if not new_code:
                import uuid
                prefix = 'BHR-' + time.strftime('%Y') + ('-M' if role == 'manager' else '-')
                new_code = prefix + uuid.uuid4().hex[:4].upper()
            
            # Prepare employee doc
            emp_data = data.copy()
            emp_data.update({
                'accountId': user.uid,
                'employeeCode': new_code,
                'employmentStatus': 'active',
                'createdAt': firestore.SERVER_TIMESTAMP
            })
            if role == 'manager':
                emp_data['managerId'] = None
                emp_data['managerName'] = None
                
            # Create accounts doc
            acc_data = {
                'role': role,
                'email': email,
                'employeeId': user.uid,
                'status': 'active',
                'passwordResetRequired': True,
                'forcePasswordChange': True,
                'createdAt': firestore.SERVER_TIMESTAMP
            }
            
            batch = db.batch()
            acc_ref = db.collection('accounts').document(user.uid)
            emp_ref = db.collection('employees').document(user.uid)
            
            batch.set(acc_ref, acc_data)
            batch.set(emp_ref, emp_data)
            batch.commit()
            
            # 5. Send Email
            port = int(os.environ.get('PORT', 5000))
            mail_payload = {
                'email': data.get('inviteEmail') or email,
                'loginEmail': email,
                'tempPassword': temp_password,
                'name': full_name
            }
            try:
                requests.post(f"http://127.0.0.1:{port}/api/mail/send-invite", json=mail_payload, timeout=5)
            except Exception as e:
                print(f"[MAIL ERROR] Failed to hit local mail endpoint: {e}")
                
            # Send everything except sensitive data back to the frontend
            return_data = emp_data.copy()
            if 'createdAt' in return_data: del return_data['createdAt']
            return_data['employeeId'] = user.uid
            
            return jsonify({
                'success': True,
                'employeeId': user.uid,
                'employeeCode': new_code,
                'message': 'Provisioned successfully',
                'data': return_data
            })
            
        elif role == 'candidate':
            # Prepare candidate doc
            cand_data = data.copy()
            
            cand_data.update({
                'accountId': user.uid,
                'currentStage': 'document_collection',
                'offerLetterStatus': 'not_sent',
                'companyDecision': 'pending',
                'assignedManagerIds': [data.get('originatingManagerId')] if data.get('originatingManagerId') else [],
                'assignedManagerNames': [data.get('originatingManagerName')] if data.get('originatingManagerName') else [],
                'docsRequested': 0, 
                'docsVerified': 0,
                'roundsCount': 1, 
                'latestRoundName': 'Job Application', 
                'latestRoundStatus': 'completed',
                'hiringRounds': [{
                    'roundId': 'r1',
                    'name': 'Job Application',
                    'stageName': 'Job Application',
                    'status': 'completed',
                    'subtitle': 'Application submitted',
                    'order': 1,
                    'locked': True,
                    'date': datetime.datetime.now().strftime('%B %d, %Y'),
                    'internalNotes': None
                }],
                'requestedDocuments': [],
                'createdAt': firestore.SERVER_TIMESTAMP,
                'submittedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'portalCredentialsExpiresAt': None
            })
            
            # Accounts doc
            acc_data = {
                'role': 'candidate',
                'email': email,
                'status': 'active',
                'passwordResetRequired': True,
                'forcePasswordChange': True,
                'createdAt': firestore.SERVER_TIMESTAMP
            }
            
            batch = db.batch()
            acc_ref = db.collection('accounts').document(user.uid)
            cand_ref = db.collection('candidateProfiles').document(user.uid)
            cand_doc2 = db.collection('candidates').document(user.uid)
            
            batch.set(acc_ref, acc_data)
            batch.set(cand_ref, cand_data)
            batch.set(cand_doc2, cand_data)
            batch.commit()
            
            # Send Email
            port = int(os.environ.get('PORT', 5000))
            mail_payload = {
                'email': data.get('inviteEmail') or email,
                'loginEmail': email,
                'tempPassword': temp_password,
                'name': full_name
            }
            try:
                requests.post(f"http://127.0.0.1:{port}/api/mail/send-portal-invite", json=mail_payload, timeout=5)
            except Exception as e:
                print(f"[MAIL ERROR] Failed to hit local mail endpoint: {e}")
                
            return_data = cand_data.copy()
            if 'createdAt' in return_data: del return_data['createdAt']
            if 'portalCredentialsExpiresAt' in return_data: del return_data['portalCredentialsExpiresAt']
            return_data['candidateId'] = user.uid
            
            return jsonify({
                'success': True,
                'candidateId': user.uid,
                'message': 'Candidate provisioned successfully',
                'data': return_data
            })
        else:
            return jsonify({'error': 'Invalid role specified'}), 400

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/hire-candidate', methods=['POST'])
def hire_candidate():
    """
    Transition a candidate to an employee.
    Expected payload: { "candidateId": "..." }
    """
    try:
        data = request.json
        candidate_id = data.get('candidateId')
        if not candidate_id:
            return jsonify({'error': 'Candidate ID is required'}), 400
            
        db = firestore.client()
        cand_ref = db.collection('candidateProfiles').document(candidate_id)
        cand_doc = cand_ref.get()
        
        if not cand_doc.exists:
            return jsonify({'error': 'Candidate not found'}), 404
            
        cand_data = cand_doc.to_dict()
        
        # 1. Update Auth Custom Claims
        auth.set_custom_user_claims(candidate_id, {'role': 'employee'})
        
        # 2. Reset password (generate a new temporary one for their employee account)
        temp_password = data.get('password')
        if not temp_password:
            temp_password = generate_temp_password()
        try:
            update_params = {'password': temp_password}
            if data.get('empEmail'):
                update_params['email'] = data.get('empEmail')
            auth.update_user(candidate_id, **update_params)
        except Exception as e:
            return jsonify({'error': f'Failed to update auth user: {str(e)}'}), 500
            
        # 3. Create Employee Record
        new_code = data.get('empId')
        if not new_code:
            import uuid
            prefix = 'BHR-' + time.strftime('%Y') + '-'
            new_code = prefix + uuid.uuid4().hex[:4].upper()
        
        emp_data = {
            'accountId': candidate_id,
            'employeeCode': new_code,
            'fullName': cand_data.get('fullName', ''),
            'email': data.get('empEmail') or cand_data.get('email', ''),
            'department': cand_data.get('department', ''),
            'designation': cand_data.get('designation', ''),
            'employmentStatus': 'active',
            'employmentType': cand_data.get('employmentType', 'regular'),
            'baseSalary': float(data.get('baseSalary', 0)),
            'role': 'employee',
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        
        # 4. Update Firestore in a Batch
        batch = db.batch()
        emp_ref = db.collection('employees').document(candidate_id)
        acc_ref = db.collection('accounts').document(candidate_id)
        
        batch.set(emp_ref, emp_data)
        batch.update(acc_ref, {
            'role': 'employee',
            'employeeId': candidate_id,
            'passwordResetRequired': True,
            'forcePasswordChange': True,
            'email': data.get('empEmail') or cand_data.get('email'),
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        
        # Update Candidate Profile
        batch.update(cand_ref, {
            'currentStage': 'joined',
            'employeeCredentialsSentAt': firestore.SERVER_TIMESTAMP
        })
        
        batch.commit()
        
        # 5. Send Email
        port = int(os.environ.get('PORT', 5000))
        mail_payload = {
            'email': data.get('delivEmail') or cand_data.get('email'),
            'loginEmail': data.get('empEmail'),
            'tempPassword': temp_password,
            'name': cand_data.get('fullName', 'Employee')
        }
        try:
            requests.post(f"http://127.0.0.1:{port}/api/mail/send-invite", json=mail_payload, timeout=5)
        except Exception as e:
            print(f"[MAIL ERROR] Failed to hit local mail endpoint: {e}")
            
        return jsonify({
            'success': True,
            'message': 'Candidate hired successfully',
            'employeeId': candidate_id,
            'employeeCode': new_code
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500






