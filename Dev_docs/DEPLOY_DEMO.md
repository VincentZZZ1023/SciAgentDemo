# Linux Demo Deployment

## Goal

Run the demo on one Linux host with:

- `postgres` in Docker
- `backend` in Docker
- `frontend` in Docker
- agent containers launched on demand by backend via Docker socket

## Host layout

Use stable absolute paths on the host:

```text
/opt/SciAgentDemo
/opt/ResearchAgent
/opt/sciagent-data/runs
```

Important:

- `backend` launches agent containers through `/var/run/docker.sock`
- paths passed to `docker run -v ...` are resolved by the host Docker daemon
- therefore the host paths and the backend-container-visible paths must match

## Required files

Under `/opt/SciAgentDemo/deploy`:

1. Copy `.env.example` to `.env`
2. Copy `backend.env.example` to `backend.env`
3. Fill in all required API keys
4. Adjust these values in `.env`:

```bash
RESEARCH_AGENT_HOST_ROOT=/opt/ResearchAgent
SCIAGENT_RUNS_HOST_ROOT=/opt/sciagent-data/runs
VITE_BACKEND_BASE_URL=http://<server-ip>:8000
```

## Startup

From `/opt/SciAgentDemo/deploy`:

```bash
docker compose -f docker-compose.demo.yml up -d --build
```

Frontend:

- `http://<server-ip>:8080`

Backend health:

- `http://<server-ip>:8000/api/health`

## Runtime notes

- `survey-only`, `idea-only`, `experiment-only`, and full multi-stage runs are all accepted
- if only `experiment` is enabled, backend creates a minimal seed `idea_result.json` so the experiment agent can still run for demo purposes
- `idea` still does not fully cover embedding / retrieval / RAG configuration parity; the current target is demo-grade execution, not full feature parity
