from flask import Blueprint, request, jsonify
from firebase_admin import storage, firestore
import datetime
import uuid
import os
from backend.services.pdf_generator import generate_offer_letter_pdf, generate_payslip_pdf

pdf_bp = Blueprint('pdf_bp', __name__, url_prefix='/api/pdf')

import urllib.parse

def upload_pdf_to_firebase(pdf_bytes, destination_blob_name):
    bucket = storage.bucket()
    blob = bucket.blob(destination_blob_name)
    
    # Generate a download token instead of changing bucket ACLs
    token = uuid.uuid4()
    metadata = {"firebaseStorageDownloadTokens": str(token)}
    blob.metadata = metadata
    
    blob.upload_from_string(pdf_bytes, content_type='application/pdf')
    
    # Construct the native Firebase Storage download URL
    encoded_path = urllib.parse.quote(destination_blob_name, safe='')
    url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_path}?alt=media&token={token}"
    return url

@pdf_bp.route('/generate-offer-letter', methods=['POST'])
def generate_offer_letter():
    try:
        data = request.json
        candidate_id = data.get('candidateId')
        
        if not candidate_id:
            return jsonify({'error': 'Candidate ID is required'}), 400
            
        db = firestore.client()
        cand_ref = db.collection('candidateProfiles').document(candidate_id)
        cand_doc = cand_ref.get()
        
        if not cand_doc.exists:
            # Fallback for mock frontend data testing
            cand_data = {
                'fullName': 'Mock Candidate ' + candidate_id,
                'email': 'mock.candidate@example.com'
            }
        else:
            cand_data = cand_doc.to_dict()
        
        # Merge termsData provided by Finance into cand_data so the PDF has the correct role/salary
        terms_data = data.get('termsData', {})
        cand_data.update(terms_data)
        
        # We can pass specific company details later, mock for now
        company_details = {'name': 'Zyrodev (BeanHR)'}
        
        # Generate PDF
        pdf_bytes = generate_offer_letter_pdf(cand_data, company_details)
        
        # Upload
        filename = f"offer_letters/{candidate_id}_{uuid.uuid4().hex[:6]}.pdf"
        url = upload_pdf_to_firebase(pdf_bytes, filename)
        
        # Update Candidate Doc
        try:
            update_payload = {
                'offerLetterUrl': url,
                'offerLetterStatus': 'admin_approved',
                'offerLetterGeneratedAt': firestore.SERVER_TIMESTAMP
            }
            # Also persist the negotiated terms (designation, department, employmentType, etc.)
            for k, v in terms_data.items():
                if v is not None:
                    update_payload[k] = v
                    
            cand_ref.update(update_payload)
        except Exception as update_err:
            print(f"Warning: Could not update Firestore doc for {candidate_id}, likely a mock: {update_err}")
        
        return jsonify({
            'success': True,
            'url': url,
            'message': 'Offer letter generated and saved successfully.'
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@pdf_bp.route('/generate-payslip', methods=['POST'])
def generate_payslip():
    try:
        data = request.json
        employee_id = data.get('employeeId')
        payslip_data = data.get('payslipData') # {month: 'Jan 2026', basic: 50000, ...}
        
        if not employee_id or not payslip_data:
            return jsonify({'error': 'Employee ID and payslip data required'}), 400
            
        db = firestore.client()
        emp_ref = db.collection('employees').document(employee_id)
        emp_doc = emp_ref.get()
        
        if not emp_doc.exists:
            # Fallback for mock frontend data testing
            emp_data = {
                'fullName': payslip_data.get('mockName', 'Mock Employee'),
                'employeeCode': 'BHR-MOCK',
                'designation': 'Mock Designation',
                'department': 'Mock Department',
                'employmentStatus': 'Active'
            }
        else:
            emp_data = emp_doc.to_dict()
        company_details = {'name': 'Zyrodev (BeanHR)'}
        
        # Generate PDF
        pdf_bytes = generate_payslip_pdf(emp_data, payslip_data, company_details)
        
        # Upload
        month_formatted = payslip_data.get('month', 'unknown').replace(' ', '_')
        filename = f"payslips/{employee_id}/{month_formatted}_{uuid.uuid4().hex[:6]}.pdf"
        url = upload_pdf_to_firebase(pdf_bytes, filename)
        
        # Optionally, save record to a 'payslips' collection
        db.collection('payslips').add({
            'employeeId': employee_id,
            'month': payslip_data.get('month'),
            'url': url,
            'createdAt': firestore.SERVER_TIMESTAMP
        })
        
        return jsonify({
            'success': True,
            'url': url,
            'message': 'Payslip generated successfully.'
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500



