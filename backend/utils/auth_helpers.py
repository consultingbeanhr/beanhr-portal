"""Authentication / authorisation decorators for Flask routes."""
from functools import wraps

from flask import g, jsonify, request

from backend.services.firebase_service import get_db, verify_id_token


def require_auth(f):
    """Verify the Firebase Bearer token and attach g.uid + g.email."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or malformed Authorization header'}), 401

        token = auth_header[7:]
        try:
            decoded  = verify_id_token(token)
            g.uid    = decoded['uid']
            g.email  = decoded.get('email', '')
        except Exception as exc:
            print(f'[require_auth ERROR] {type(exc).__name__}: {exc}')
            # Distinguish config errors (bad key file) from bad tokens
            msg = str(exc).lower()
            if any(k in msg for k in ('no such file', 'certificate', 'credential', 'initialize', 'default app')):
                return jsonify({'error': f'Backend config error: {exc}'}), 503
            return jsonify({'error': 'Invalid or expired token'}), 401

        return f(*args, **kwargs)
    return decorated


def require_super_admin(f):
    """Verify token AND check that the account has role == 'super_admin'.

    Must be applied AFTER @require_auth so that g.uid is already set.
    Fetches the account document once and sets g.role.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'uid'):
            return jsonify({'error': 'Authentication required'}), 401

        db  = get_db()
        doc = db.collection('accounts').document(g.uid).get()
        if not doc.exists:
            return jsonify({'error': 'Account not found'}), 403

        role = doc.get('role')
        g.role = role

        if role != 'super_admin':
            return jsonify({'error': 'Super admin access required'}), 403

        return f(*args, **kwargs)
    return decorated
