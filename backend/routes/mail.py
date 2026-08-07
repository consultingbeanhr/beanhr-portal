import os
import requests
from flask import Blueprint, request, jsonify
from firebase_admin import auth

mail_bp = Blueprint('mail_bp', __name__, url_prefix='/api/mail')

def send_brevo_email(to_email, subject, html_content, attachment_url=None, attachment_name=None):
    """
    Core function to send emails via Brevo v3 API
    """
    api_key = os.environ.get('BREVO_API_KEY')
    sender_email = os.environ.get('BREVO_SENDER_EMAIL')
    sender_name = os.environ.get('BREVO_SENDER_NAME', 'BeanHR')

    if not api_key or not sender_email:
        print("[Mail Error] BREVO_API_KEY or BREVO_SENDER_EMAIL is missing in .env")
        return False

    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "accept": "application/json",
        "api-key": api_key,
        "content-type": "application/json"
    }

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html_content
    }

    # If an attachment is provided (like a PDF Offer Letter or Payslip)
    if attachment_url and attachment_name:
        payload["attachment"] = [{"url": attachment_url, "name": attachment_name}]

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"[Mail Error] Failed to send email to {to_email}: {str(e)}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"[Mail Error Details] {e.response.text}")
        return False

@mail_bp.route('/test', methods=['POST'])
def test_email():
    """Simple route to test the Brevo connection"""
    data = request.json
    to_email = data.get('email')
    
    if not to_email:
        return jsonify({'error': 'Email is required'}), 400
        
    html = "<h3>Welcome to BeanHR!</h3><p>This is a test email from your new backend.</p>"
    success = send_brevo_email(to_email, "Test Email from BeanHR", html)
    
    if success:
        return jsonify({'success': True, 'message': 'Email sent successfully'})
    return jsonify({'error': 'Failed to send email. Check backend console.'}), 500

@mail_bp.route('/send-invite', methods=['POST'])
def send_invite():
    """Send Welcome Invite with Temp Password (Employee/Manager)"""
    data = request.json
    email = data.get('email')
    login_email = data.get('loginEmail', email)
    temp_password = data.get('tempPassword')
    name = data.get('name', 'Employee')

    if not email or not temp_password:
        return jsonify({'error': 'Email and temp password required'}), 400

    html = f"""
    <h3>Welcome to BeanHR, {name}!</h3>
    <p>Your account has been created. Please log in using the details below:</p>
    <p><b>Email:</b> {login_email}</p>
    <p><b>Temporary Password:</b> {temp_password}</p>
    <p>You will be asked to set a permanent password upon first login.</p>
    """
    
    success = send_brevo_email(email, "Welcome to BeanHR - Your Login Details", html)
    return jsonify({'success': success})

@mail_bp.route('/send-portal-invite', methods=['POST'])
def send_portal_invite():
    """Send Candidate Portal Invite"""
    data = request.json
    email = data.get('email')
    login_email = data.get('loginEmail', email)
    temp_password = data.get('tempPassword')
    name = data.get('name', 'Candidate')

    if not email or not temp_password:
        return jsonify({'error': 'Email and temp password required'}), 400

    html = f"""
    <h3>Welcome to the BeanHR Hiring Portal, {name}!</h3>
    <p>We are excited to move forward with your application. Please log in to your candidate portal:</p>
    <p><b>Email:</b> {login_email}</p>
    <p><b>Temporary Password:</b> {temp_password}</p>
    <p>Please log in to track your hiring status and upload any requested documents.</p>
    """
    
    success = send_brevo_email(email, "Your BeanHR Candidate Portal Access", html)
    return jsonify({'success': success})

@mail_bp.route('/send-offer-letter', methods=['POST'])
def send_offer_letter():
    """Send Offer Letter to Candidate"""
    data = request.json
    email = data.get('email')
    name = data.get('name', 'Candidate')
    position = data.get('position', 'a position')
    offer_url = data.get('offerUrl')

    if not email or not offer_url:
        return jsonify({'error': 'Email and offer URL required'}), 400

    html = f"""
    <h3>Congratulations, {name}!</h3>
    <p>We are thrilled to offer you the position of <b>{position}</b> at our company.</p>
    <p>Please review your official offer letter attached.</p>
    <p>You can accept or decline the offer directly inside your Candidate Portal.</p>
    """
    
    success = send_brevo_email(
        email, 
        "Your Offer Letter from BeanHR", 
        html,
        attachment_url=offer_url,
        attachment_name="Offer_Letter.pdf"
    )
    return jsonify({'success': success})

@mail_bp.route('/send-permanent-credentials', methods=['POST'])
def send_permanent_credentials():
    """Send Permanent Employee Credentials (Post-Hiring)"""
    data = request.json
    email = data.get('personalEmail')  # Goes to personal email
    work_email = data.get('workEmail') # The actual login email
    temp_password = data.get('tempPassword')
    name = data.get('name', 'Employee')

    if not email or not work_email or not temp_password:
        return jsonify({'error': 'Emails and password required'}), 400

    html = f"""
    <h3>Welcome aboard, {name}!</h3>
    <p>Your official employee account has been created.</p>
    <p><b>Work Email (Login):</b> {work_email}</p>
    <p><b>Temporary Password:</b> {temp_password}</p>
    <p>Please log in to the employee dashboard.</p>
    """
    
    success = send_brevo_email(email, "Your Official BeanHR Employee Credentials", html)
    return jsonify({'success': success})

@mail_bp.route('/send-rejection', methods=['POST'])
def send_rejection():
    """Send Rejection Email to Candidate"""
    data = request.json
    email = data.get('email')
    name = data.get('name', 'Candidate')

    if not email:
        return jsonify({'error': 'Email required'}), 400

    html = f"""
    <h3>Application Update</h3>
    <p>Dear {name},</p>
    <p>Thank you for your interest and the time you invested in applying.</p>
    <p>While we were impressed with your background, we have decided to move forward with other candidates at this time.</p>
    <p>We wish you all the best in your job search.</p>
    <p>Best regards,<br>The BeanHR Team</p>
    """
    
    success = send_brevo_email(email, "Update on your application", html)
    return jsonify({'success': success})

@mail_bp.route('/send-payslip', methods=['POST'])
def send_payslip():
    """Send Payslip Notification"""
    data = request.json
    email = data.get('email')
    name = data.get('name', 'Employee')
    month = data.get('month', 'this month')
    payslip_url = data.get('payslipUrl')

    if not email or not payslip_url:
        return jsonify({'error': 'Email and payslip URL required'}), 400

    html = f"""
    <h3>Your Payslip for {month} is Ready</h3>
    <p>Hi {name},</p>
    <p>Your salary slip for {month} has been issued and is available for download.</p>
    """
    
    success = send_brevo_email(
        email, 
        f"Your BeanHR Payslip - {month}", 
        html,
        attachment_url=payslip_url,
        attachment_name=f"Payslip_{month}.pdf"
    )
    return jsonify({'success': success})

