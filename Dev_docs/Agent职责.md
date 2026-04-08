# Agent职责

## BackendCompatAgent

### Owns

- `E:\SciAgentDemo\backend\app\api\`
- `E:\SciAgentDemo\backend\app\models\schemas.py`
- `E:\SciAgentDemo\backend\app\store\database.py`
- `E:\SciAgentDemo\backend\app\services\event_bus.py`

### Does Not Own

- ResearchAgent algorithm code
- Container image internals

### Read First

- `E:\SciAgentDemo\Dev_docs\CONTRACT.md`
- `E:\SciAgentDemo\frontend\src\types\events.ts`

## RuntimeConfigAgent

### Owns

- `E:\SciAgentDemo\backend\app\services\runtime_config_builder.py`
- environment variable mapping for ResearchAgent runtime

### Does Not Own

- frontend contracts
- artifact registration logic

### Read First

- `E:\SciAgentDemo\Dev_docs\FLOW.md`
- `E:\ResearchAgent\ResearchAgent\src\config\default.yaml`

## StageExecutionAgent

### Owns

- `E:\SciAgentDemo\backend\app\services\research_agent_runner.py`
- stage-to-container command mapping
- stage log capture

### Does Not Own

- route schemas
- frontend code

### Dependencies

- Requires runnable survey/idea/experiment containers
- Requires PostgreSQL

## SurveyAgent

### Owns

- survey container image
- survey stage command
- survey output correctness

### Must Preserve

- outputs under `/workspace/survey/output`

## IdeaAgent

### Owns

- idea container image
- idea stage command
- idea output correctness

### Must Preserve

- `idea_result.json` discoverability inside `/workspace/idea`

## ExperimentAgent

### Owns

- experiment container image
- experiment stage command
- experiment output correctness

### Must Preserve

- experiment workspace rooted at `/workspace/experiment`
- readable `ablation_results.json` when successful
