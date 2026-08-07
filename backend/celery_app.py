import os
from celery import Celery
from dotenv import load_dotenv

# Load env variables
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(ROOT_DIR, '.env'))

# Set up Celery
# If running locally without Redis, it might fail. Railway provides REDIS_URL
redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

celery_app = Celery(
    'beanhr_tasks',
    broker=redis_url,
    backend=redis_url,
    include=['backend.services.tasks']
)

# Optional config
celery_app.conf.update(
    timezone='Asia/Kolkata',
    enable_utc=False,
)

# Setup Periodic Tasks (Beat)
from celery.schedules import crontab

celery_app.conf.beat_schedule = {
    # 1. Credential Expiry (Hourly)
    'check-credential-expiry-hourly': {
        'task': 'backend.services.tasks.run_hourly_jobs',
        'schedule': crontab(minute=0),  # Runs at minute 0 of every hour
    },
    # 2. Auto-Checkout and Absence Checker (Daily at 2:00 AM)
    'run-daily-attendance-checks': {
        'task': 'backend.services.tasks.run_daily_jobs',
        'schedule': crontab(hour=2, minute=0),  # Runs daily at 02:00 AM
    }
}
