# TREE_AND_ANCHOR

## Directory Tree

- `E:\SciAgentDemo\frontend\`
- `E:\SciAgentDemo\backend\`
- `E:\SciAgentDemo\Dev_docs\`

## Global Worker Constraints

- Do not change frontend lane ids.
- Do not change event kind names.
- Do not replace the existing API surface with a new contract.
- Do not move artifact ownership out of the current backend store layer.
- For V1 demo, keep orchestration inside the current backend process.

## File Anchor List

`E:\SciAgentDemo\backend\app\api\routes\runs.py # owns frontend-compatible run creation and dispatch into the real pipeline runner`

- `async def create_run(topicId: str, payload: RunCreateRequest, _user: str) -> RunCreateResponse`

`E:\SciAgentDemo\backend\app\services\research_agent_runner.py # owns real stage orchestration and translation from ResearchAgent outputs into current SciAgentDemo events and artifacts`

- `class ResearchAgentPipelineRunner`
- `async def run_pipeline(self, topic_id: str, run_id: str) -> None`

Special Constraints

- Must preserve lane mapping:
  - `review -> survey`
  - `ideation -> idea`
  - `experiment -> experiment`
- Must not emit new frontend agent ids

`E:\SciAgentDemo\backend\app\services\runtime_config_builder.py # owns per-run workspace creation and runtime YAML generation from the canonical ResearchAgent config`

- `class ResearchAgentRuntimeConfigBuilder`
- `def build(self, *, topic: dict[str, Any], run_id: str, run_config: RunConfig) -> ResearchAgentRuntime`

`E:\SciAgentDemo\backend\app\core\config.py # owns deployment-level settings for ResearchAgent path, Python executable, config path, and run workspace root`

- `class Settings`
- `def default_research_agent_python(root: Path) -> Path`

`E:\SciAgentDemo\frontend\src\types\events.ts # owns the frozen frontend event and lane contract`

- `AGENT_IDS`
- `EVENT_KINDS`
- `RunConfig`
- `Event`

Special Constraints

- This file is contract-defining for V1 and must not drift during backend integration.
