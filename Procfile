web: gunicorn "backend.app:create_app()" -b 0.0.0.0:$PORT
worker: C_FORCE_ROOT=true celery -A backend.celery_app.celery_app worker --loglevel=info --pool=solo
beat: C_FORCE_ROOT=true celery -A backend.celery_app.celery_app beat --loglevel=info
