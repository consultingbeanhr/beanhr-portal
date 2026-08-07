web: gunicorn "backend.app:create_app()" -b 0.0.0.0:$PORT
worker: celery -A backend.celery_app.celery_app worker --loglevel=info
beat: celery -A backend.celery_app.celery_app beat --loglevel=info
