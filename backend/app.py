import os
import firebase_admin
from firebase_admin import credentials
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(ROOT_DIR, '.env'))

if not firebase_admin._apps:
    cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    
    if cred_path and cred_path.strip().startswith('{'):
        # Handled as raw JSON string (common in Railway/Heroku)
        import json
        try:
            cred_dict = json.loads(cred_path)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        except Exception as e:
            print(f"[Error] Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON: {e}")
    elif cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
    else:
        # Fallback to local file
        local_path = os.path.join(ROOT_DIR, 'beanhr-portal-firebase-adminsdk.json')
        if os.path.exists(local_path):
            cred = credentials.Certificate(local_path)
            firebase_admin.initialize_app(cred, {'storageBucket': 'beanhr-portal.firebasestorage.app'})
        else:
            print(f"[Warning] Firebase credentials not found at {cred_path} or {local_path}. Relying on Default Application Credentials.")
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
    frontend_dir = os.path.join(ROOT_DIR, 'frontend')

    @app.route('/')
    def index():
        return send_from_directory(os.path.join(frontend_dir, 'pages'), 'login.html')

    @app.route('/frontend/<path:filename>')
    def serve_frontend(filename):
        return send_from_directory(frontend_dir, filename)

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
