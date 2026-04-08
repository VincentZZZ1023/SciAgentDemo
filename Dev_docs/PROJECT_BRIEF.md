# PROJECT_BRIEF

## Goal

Keep the existing `SciAgentDemo` frontend unchanged and replace the fake backend execution path with real `ResearchAgent` execution for:

- `survey`
- `idea`
- `experiment`

The demo must still present the three existing frontend lanes:

- `review`
- `ideation`
- `experiment`

## Inputs

- Existing frontend REST requests and WebSocket subscriptions
- Topic metadata stored by `SciAgentDemo`
- Canonical ResearchAgent config:
  - `E:\ResearchAgent\ResearchAgent\src\config\default.yaml`
- Runtime overrides generated per run
- Local filesystem workspace per run

## Outputs

- Existing `SciAgentDemo` run status updates
- Existing `SciAgentDemo` event stream
- Existing artifact records and downloadable files
- Real artifacts from ResearchAgent stages

## Primary Users

- Demo users operating the current SciAgentDemo frontend
- Backend developer integrating the real agent pipeline
- Algorithm teammates delivering runnable survey/idea/experiment containers

## Success Criteria

- Frontend remains unchanged
- Backend API and WS contracts remain compatible
- A run started from the frontend can drive real `survey -> idea -> experiment`
- Each stage produces artifacts visible in the current frontend
- Failures are surfaced through the current run/event model

## Non-Goals

- Production-grade distributed scheduling
- Multi-node deployment
- New frontend lanes for `paper`
- Full worker service / queue microservice split
- MinIO or cross-machine artifact storage for V1 demo
