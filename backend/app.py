import os
import firebase_admin
from firebase_admin import credentials
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(ROOT_DIR, '.env'))

if not firebase_admin._apps:
    cred_val = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY') or os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    
    if cred_val and cred_val.strip().startswith('{'):
        import json
        try:
            cred_dict = json.loads(cred_val)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        except Exception as e:
            print(f"[Error] Failed to parse Firebase credentials JSON string: {e}")
    elif cred_val and os.path.exists(cred_val):
        cred = credentials.Certificate(cred_val)
        firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
    else:
        # Fallback to local file
        local_path = os.path.join(ROOT_DIR, 'beanhr-portal-firebase-adminsdk.json')
        if os.path.exists(local_path):
            cred = credentials.Certificate(local_path)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        else:
            print(f"[Warning] Firebase credentials not found. Relying on Default Application Credentials.")
            firebase_admin.initialize_app(options={'storageBucket': 'beanhr-portal.firebasestorage.app'})


def create_app():
    app = Flask(__name__)

    # ── CORS ────────────────────────────────────────────────────────
    # Allow requests from the frontend dev server and production domain.
    # Update ALLOWED_ORIGINS in .env for production.
    allowed_origins_raw = os.environ.get('ALLOWED_ORIGINS', 'http://127.0.0.1:5500,http://localhost:5500')
    allowed_origins = [o.strip() for o in allowed_origins_raw.split(',')]
    CORS(app, origins=allowed_origins, supports_credentials=True)

    # ── Blueprints ───────────────────────────────────────────────────
    from backend.routes.ai import ai_bp
    from backend.routes.mail import mail_bp
    from backend.routes.auth import auth_bp
    from backend.routes.pdf import pdf_bp
    from backend.routes.payroll import payroll_bp
    
    app.register_blueprint(ai_bp)
    app.register_blueprint(mail_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(pdf_bp)
    app.register_blueprint(payroll_bp, url_prefix='/api/payroll')

    # ── Serve Frontend Static Files ──────────────────────────────────
    # ── Serve Frontend Static Files & Page Routing ────────────────────
    frontend_dir = os.path.join(ROOT_DIR, 'frontend')

    @app.route('/')
    def index():
        return send_from_directory(os.path.join(frontend_dir, 'pages'), 'login.html')

    @app.route('/<path:filename>')
    def serve_frontend_files(filename):
        # 1. Check inside frontend/pages/ (e.g. admin/dashboard.html, manager/team.html, set-password.html)
        pages_file = os.path.join(frontend_dir, 'pages', filename)
        if os.path.isfile(pages_file):
            return send_from_directory(os.path.join(frontend_dir, 'pages'), filename)

        # 2. Check directly inside frontend/ (e.g. js/db.js, css/style.css, assets/logo.svg)
        direct_file = os.path.join(frontend_dir, filename)
        if os.path.isfile(direct_file):
            return send_from_directory(frontend_dir, filename)

        return jsonify({'error': 'Endpoint not found'}), 404

    # ── Global error handlers ────────────────────────────────────────
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({'error': 'Endpoint not found'}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({'error': 'Method not allowed'}), 405

    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({'error': 'Internal server error'}), 500

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok', 'service': 'beanhr-backend'})

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
