# CONTRACT

## Frontend Contract

The frontend contract is frozen and must remain compatible with:

- `E:\SciAgentDemo\frontend\src\api\client.ts`
- `E:\SciAgentDemo\frontend\src\api\ws.ts`
- `E:\SciAgentDemo\frontend\src\types\events.ts`

## Lane Mapping

- `review` maps to real `survey`
- `ideation` maps to real `idea`
- `experiment` maps to real `experiment`

`paper` is out of scope for the current frontend and must not introduce a fourth lane in V1.

## Runtime Workspace Contract

Per run, backend owns one local workspace root:

- `backend/data/research_runs/<run_id>/`

Required subdirectories:

- `config/`
- `logs/`
- `survey/output/`
- `idea/`
- `experiment/`
- `shared/`

## Container Contract

For demo V1, each real stage is executed as a container with:

- mounted run workspace at `/workspace`
- access to generated runtime config at `/workspace/config/runtime.yaml`
- stage-local outputs written under the mounted workspace

Expected stage outputs:

### Survey

- `/workspace/survey/output/survey.md`
- `/workspace/survey/output/survey.json`
- `/workspace/survey/output/evaluation.txt`

### Idea

- `/workspace/idea/<run-result-dir>/idea_result.json`

Optional:

- `idea_candidate.json`
- `replanned_idea_result.json`

### Experiment

- `/workspace/experiment/ablation_results.json`

Optional:

- `/workspace/experiment/final_report.md`

## Error Convention

- Container non-zero exit code means stage failure
- Backend stage log path must be captured in:
  - `backend/data/research_runs/<run_id>/logs/<stage>.log`
- Backend emits existing `module_failed` and `event_emitted` error payloads

## Boundary Conditions

- Disabled modules must emit `module_skipped`, not crash the run
- Missing upstream ideation output must skip experiment if ideation was disabled
- Missing required artifact after a successful process exit still counts as stage failure
- Frontend-visible event names and agent ids must not drift
