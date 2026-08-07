import io
import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
from reportlab.lib.units import inch
from reportlab.lib import colors

def generate_offer_letter_pdf(candidate_data, company_details):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=72)
    Story = []
    
    styles = getSampleStyleSheet()
    title_style = styles['Title']
    normal_style = styles['Normal']
    
    # Add Company Name / Logo (text for now)
    company_name = candidate_data.get('entity') or company_details.get('name', 'BeanHR')
    Story.append(Paragraph(f"<b>{company_name}</b>", title_style))
    Story.append(Spacer(1, 0.5 * inch))
    
    # Date
    today_str = datetime.date.today().strftime("%B %d, %Y")
    Story.append(Paragraph(f"Date: {today_str}", normal_style))
    Story.append(Spacer(1, 0.2 * inch))
    
    # Candidate Info
    full_name = candidate_data.get('fullName', 'Candidate')
    email = candidate_data.get('email', '')
    Story.append(Paragraph(f"<b>To:</b> {full_name}", normal_style))
    Story.append(Paragraph(f"{email}", normal_style))
    Story.append(Spacer(1, 0.4 * inch))
    
    # Salutation
    Story.append(Paragraph(f"Dear {full_name},", normal_style))
    Story.append(Spacer(1, 0.2 * inch))
    
    # Body
    role = candidate_data.get('designation', 'the role')
    department = candidate_data.get('department', 'our team')
    body_text = f"We are thrilled to offer you the position of <b>{role}</b> in the <b>{department}</b> department at {company_name}. We believe your skills and experience will be an ideal match for our team."
    Story.append(Paragraph(body_text, normal_style))
    Story.append(Spacer(1, 0.2 * inch))
    
    base_salary = candidate_data.get('salary') or candidate_data.get('baseSalary')
    if base_salary:
        joining_date = candidate_data.get('joiningDate')
        joining_str = f' Your expected date of joining is {joining_date}.' if joining_date else ''
        terms_text = f"As discussed, your starting salary will be INR {base_salary} per month, subject to statutory deductions.{joining_str} This offer is contingent upon successful background verification and submission of necessary documents."
    else:
        joining_date = candidate_data.get('joiningDate')
        joining_str = f' Your expected date of joining is {joining_date}.' if joining_date else ''
        terms_text = f"As discussed, your starting salary will be standard as per industry norms, subject to statutory deductions.{joining_str} This offer is contingent upon successful background verification and submission of necessary documents."
    Story.append(Paragraph(terms_text, normal_style))
    Story.append(Spacer(1, 0.4 * inch))
    
    # Additional Terms
    other_terms = candidate_data.get('otherTerms')
    if other_terms:
        Story.append(Paragraph("<b>Additional Terms:</b>", normal_style))
        Story.append(Paragraph(other_terms.replace('\n', '<br />'), normal_style))
        Story.append(Spacer(1, 0.4 * inch))
        
    # Signoff
    Story.append(Paragraph("Sincerely,", normal_style))
    Story.append(Spacer(1, 0.5 * inch))
    Story.append(Paragraph("<b>Authorized Signatory</b>", normal_style))
    Story.append(Paragraph(company_name, normal_style))
    
    doc.build(Story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

def generate_payslip_pdf(emp_data, payslip_data, company_details):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=72)
    Story = []
    
    styles = getSampleStyleSheet()
    title_style = styles['Title']
    normal_style = styles['Normal']
    
    # Header
    company_name = emp_data.get('entity') or company_details.get('name', 'BeanHR')
    month_year = payslip_data.get('month', 'Month')
    Story.append(Paragraph(f"<b>{company_name}</b>", title_style))
    Story.append(Paragraph(f"<center>Payslip for the month of {month_year}</center>", normal_style))
    Story.append(Spacer(1, 0.5 * inch))
    
    # Employee Info Table
    emp_info = [
        ["Employee Name:", emp_data.get('fullName', ''), "Employee ID:", emp_data.get('employeeCode', '')],
        ["Designation:", emp_data.get('designation', ''), "Department:", emp_data.get('department', '')],
        ["Status:", emp_data.get('employmentStatus', 'Active'), "", ""]
    ]
    
    t1 = Table(emp_info, colWidths=[1.2*inch, 2*inch, 1.2*inch, 2*inch])
    t1.setStyle(TableStyle([
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.black),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6)
    ]))
    Story.append(t1)
    Story.append(Spacer(1, 0.5 * inch))
    
    # Earnings & Deductions
    base = payslip_data.get('baseSalary', 0)
    bonus = payslip_data.get('bonus', 0)
    lop = payslip_data.get('lopDeductions', 0)
    gross = base + bonus
    
    data = [
        ['Earnings', 'Amount (INR)', 'Deductions', 'Amount (INR)'],
        ['Base Salary', str(base), 'Loss of Pay (LOP)', str(lop)],
        ['Bonus', str(bonus), '', ''],
        ['Total Earnings', str(gross), 'Total Deductions', str(lop)]
    ]
    
    t2 = Table(data, colWidths=[2*inch, 1.2*inch, 2*inch, 1.2*inch])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
        ('TEXTCOLOR', (0,0), (-1,0), colors.black),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 11),
        ('BOTTOMPADDING', (0,0), (-1,0), 8),
        ('BACKGROUND', (0,-1), (-1,-1), colors.whitesmoke),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), 1, colors.black)
    ]))
    Story.append(t2)
    Story.append(Spacer(1, 0.4 * inch))
    
    # Net Pay
    net_pay = payslip_data.get('netSalary', 0)
    Story.append(Paragraph(f"<b>Net Pay:</b> INR {net_pay}", normal_style))
    Story.append(Spacer(1, 0.5 * inch))
    
    doc.build(Story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes






