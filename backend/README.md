# Backend (FastAPI + PostgreSQL + Alembic)

## Environment

Configure in repo root `.env` (or `backend/.env`):

```env
JWT_SECRET=your-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60

DATABASE_URL=postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent
ARTIFACTS_ROOT=data/artifacts

DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_SECONDS=120
DEEPSEEK_MAX_RETRIES=1
DEEPSEEK_RETRY_BACKOFF_SECONDS=1.5
```

Notes:
- Runtime database is **PostgreSQL only**.
- SQLite is treated as legacy source for one-time migration only.
- Schema management is **Alembic only** (`create_all` fallback removed).

## Start PostgreSQL

From repo root:

```bash
docker compose up -d postgres
```

## Install + Migrate + Run

```bash
pip install -r backend/requirements.txt
cd backend
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

```bash
curl http://localhost:8000/api/health
```

## Legacy SQLite Data Migration (one-time)

If you still have `backend/data.db`:

```bash
cd backend
python scripts/migrate_sqlite_to_postgres.py --sqlite-path data.db
```

Dry run:

```bash
python scripts/migrate_sqlite_to_postgres.py --sqlite-path data.db --dry-run
```

After verifying migrated rows in PostgreSQL, you can archive/delete `backend/data.db`.
