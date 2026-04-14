# Backend (FastAPI + PostgreSQL + Alembic)

## Environment

Configure in repo root `.env` (or `backend/.env`):

```env
JWT_SECRET=your-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60

DATABASE_URL=postgresql+psycopg2://sciagent:sciagent@localhost:5432/sciagent
ARTIFACTS_ROOT=data/artifacts
RESEARCH_AGENT_ROOT=/home/your-user/code/ResearchAgent
RESEARCH_AGENT_RUNS_ROOT=/home/your-user/SciAgentDemo/backend/data/research_runs
RESEARCH_AGENT_EXECUTION_MODE=docker
RESEARCH_AGENT_DOCKER_IMAGE=xcientist:v1.0
RESEARCH_AGENT_CONTAINER_CODE_DIR=/workspace/ResearchAgent
RESEARCH_AGENT_CONTAINER_TASK_DIR=/task
RESEARCH_AGENT_CONTAINER_PYTHON=/workspace/miniconda/envs/xcientist/bin/python
RESEARCH_AGENT_EXPERIMENT_NODE_VERSION=20.10.0

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
- ResearchAgent pipeline now defaults to **Docker execution** and expects the host machine to have:
  - the `xcientist:v1.0` image available
  - a checked-out `ResearchAgent` repo at `RESEARCH_AGENT_ROOT`
  - required API keys exported in the backend process environment
  - working proxy env vars if your survey / experiment stages depend on them

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

## Server Deployment

Recommended topology on the server:

1. Clone this repo and `ResearchAgent` on the same host.
2. Build or load `xcientist:v1.0`.
3. Put all required agent secrets in the backend service environment.
4. Start PostgreSQL.
5. Run backend with `uvicorn`.
6. Build frontend and serve the static assets behind Nginx or Caddy.

Example backend environment additions:

```env
OPENAI_API_KEY=...
OPENAI_API_BASE=https://api-2.xi-ai.cn/v1
OPENAI_BASE_URL=https://api-2.xi-ai.cn/v1
SEMANTIC_SCHOLAR_API_KEY=...
S2_API_KEY=...
S2_API_TIMEOUT=60
SERPER_API_KEY=...
MINIMAX_API_KEY=...
XIAOMI_API_KEY=...
GITHUB_AI_TOKEN=...
JINA_API_KEY=...
HF_TOKEN=...
TAVILY_API_KEY=...
OPENHANDS_MCP_TIMEOUT=6000
http_proxy=...
https_proxy=...
HTTP_PROXY=...
HTTPS_PROXY=...
```

Important runtime behavior:

- `review` uses `/task/config/runtime.yaml`
- `ideation` uses `/task/config/runtime_full.yaml`
- `experiment` uses `/task/config/runtime_full.yaml`
- `ideation` explicitly clears proxy env vars before entering the container
- `experiment` runs with `--network host` and bootstraps Node.js into `/tmp/node`
- If only `experiment` is enabled for a run, backend now generates a minimal `idea_result.json` seed from the topic so the demo can still execute the experiment stage end-to-end

Recommended Linux demo host layout:

```text
/opt/SciAgentDemo
/opt/ResearchAgent
/opt/sciagent-data/runs
```

Suggested backend env on Linux:

```env
RESEARCH_AGENT_ROOT=/opt/ResearchAgent
RESEARCH_AGENT_RUNS_ROOT=/opt/sciagent-data/runs
RESEARCH_AGENT_DOCKER_IMAGE=xcientist:v1.0
DATABASE_URL=postgresql+psycopg2://sciagent:sciagent@postgres:5432/sciagent
```

Frontend deployment:

```bash
cd frontend
npm i
npm run build
```

Then serve `frontend/dist` from Nginx and reverse-proxy `/api` and `/ws` to the FastAPI backend.

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
