"""Firebase Admin SDK initialisation and helpers.

The service account key can be provided two ways:
  1. FIREBASE_SERVICE_ACCOUNT_KEY  = path to the JSON key file   (local dev)
  2. FIREBASE_SERVICE_ACCOUNT_JSON = the raw JSON string          (Railway / Render env var)
Option 2 takes priority when both are set.
"""
import json
import os

import firebase_admin
from firebase_admin import auth, credentials, firestore, storage

_app = None
_db  = None


def _init():
    global _app, _db
    if _app:
        return

    if firebase_admin._apps:
        _app = firebase_admin.get_app()
        _db  = firestore.client()
        return

    # Raw JSON string (preferred for cloud deployment)
    raw_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
    if raw_json:
        cred = credentials.Certificate(json.loads(raw_json))
    else:
        key_path = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY')
        if not key_path:
            # Fallback to local default file
            ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
            local_path = os.path.join(ROOT_DIR, 'beanhr-portal-firebase-adminsdk.json')
            if os.path.exists(local_path):
                key_path = local_path
            else:
                raise RuntimeError(
                    'Set FIREBASE_SERVICE_ACCOUNT_KEY (path) or '
                    'FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON) in .env'
                )
        cred = credentials.Certificate(key_path)

    _app = firebase_admin.initialize_app(cred, {
        'storageBucket': 'beanhr-portal.firebasestorage.app'
    })
    _db  = firestore.client()


def get_storage_bucket():
    """Return the default Firebase Storage bucket."""
    if not _app:
        _init()
    return storage.bucket()


def get_db():
    """Return a Firestore client, initialising Firebase if needed."""
    if not _db:
        _init()
    return _db


def verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded payload."""
    if not _app:
        _init()
    return auth.verify_id_token(id_token, clock_skew_seconds=10)
