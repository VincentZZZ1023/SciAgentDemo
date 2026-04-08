# FLOW

## Main Flow

1. Frontend calls `POST /api/topics/{topicId}/runs`.
2. Backend route keeps the existing API contract and starts `research_agent_runner.run_pipeline(...)`.
3. `research_agent_runner` builds a per-run workspace and runtime YAML from the canonical ResearchAgent config.
4. Backend executes three real stages in order:
   - `review -> survey container`
   - `ideation -> idea container`
   - `experiment -> experiment container`
5. Stage outputs are collected from the per-run local workspace.
6. Backend registers artifacts through the existing store layer.
7. Backend emits the existing event kinds so the current frontend updates without changes.

## Branch Flows

- If a module is disabled in the current run config, the backend emits `module_skipped`.
- If approval is required, the backend uses the existing approval flow.
- If a stage fails, the backend marks the run failed and emits the existing failure events.

## Data Entry Points

- Frontend topic creation and run creation APIs
- Existing topic metadata in PostgreSQL
- Runtime overrides from the run config

## Processing Chain

- `runs.py`
- `research_agent_runner.py`
- `runtime_config_builder.py`
- local workspace
- stage container
- output scan
- `store/database.py`
- `event_bus.py`

## Output Points

- `snapshot`
- `trace`
- `artifact` download endpoints
- topic websocket stream

## External Dependencies

- PostgreSQL
- Current backend filesystem
- Docker runtime
- Three runnable agent containers
- ResearchAgent config baseline
- Required model/API credentials
