# SciAgent API Contract Addendum (RunConfig + Approval + Admin)

> Scope: contract-only for T0 schema finalization. No backend/frontend implementation in this step.

## 1. Auth and Conventions

- Base URL: `http://localhost:8000`
- Auth: `Authorization: Bearer <access_token>`
- Content-Type: `application/json`
- RunConfig schema reference: `shared/schema/run_config.schema.json`
- Event schema reference: `shared/schema/events.schema.json`
- New event kinds: `module_started | module_finished | module_skipped | module_failed | approval_required | approval_resolved | admin_metrics`

---

## 2. `GET /api/config/default`

Return default RunConfig for UI prefill.

### Request

- Headers: `Authorization: Bearer <access_token>`

### Response `200`

```json
{
  "thinkingMode": "normal",
  "online": true,
  "presetName": "default",
  "modules": {
    "review": {
      "enabled": true,
      "model": "deepseek-chat",
      "requireHuman": false
    },
    "ideation": {
      "enabled": true,
      "model": "deepseek-chat",
      "requireHuman": false
    },
    "experiment": {
      "enabled": true,
      "model": "deepseek-chat",
      "requireHuman": true
    }
  }
}
```

---

## 3. `POST /api/topics/{topicId}/runs`

Create a run for one topic, with optional RunConfig override.

### Request

- Headers: `Authorization: Bearer <access_token>`

```json
{
  "prompt": "Start from literature review and generate an executable experiment plan.",
  "config": {
    "thinkingMode": "deep",
    "online": true,
    "presetName": "research-deep",
    "modules": {
      "review": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": false
      },
      "ideation": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": false
      },
      "experiment": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": true
      }
    }
  }
}
```

### Response `201`

```json
{
  "runId": "run-20260227-001",
  "topicId": "topic-neural-symbolic-discovery",
  "status": "queued",
  "startedAt": 1772158200000,
  "config": {
    "thinkingMode": "deep",
    "online": true,
    "presetName": "research-deep",
    "modules": {
      "review": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": false
      },
      "ideation": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": false
      },
      "experiment": {
        "enabled": true,
        "model": "deepseek-chat",
        "requireHuman": true
      }
    }
  }
}
```

Notes:
- Keep compatibility with existing run response fields.
- If current backend does not echo `config`, it MAY still return existing fields only; clients should tolerate both.

---

## 4. `POST /api/runs/{runId}/approve`

Resolve human approval for a specific module.

### Request

- Headers: `Authorization: Bearer <access_token>`

```json
{
  "module": "experiment",
  "approved": true,
  "note": "Budget approved, allow one retry."
}
```

### Response `200`

```json
{
  "ok": true
}
```

Expected events after approval resolution:
- `approval_resolved`
- follow-up `module_started/module_finished` or `module_failed`

---

## 5. `GET /api/admin/overview` (admin only)

Return current admin overview snapshot.

### Request

- Headers:
  - `Authorization: Bearer <access_token>`
  - token must carry admin privileges

### Response `200`

```json
{
  "ts": 1772158270000,
  "activeRuns": 3,
  "runsLast5m": 7,
  "eventsLast5m": 214,
  "moduleInFlight": {
    "review": 1,
    "ideation": 1,
    "experiment": 1
  },
  "approvalsPending": 2,
  "errorRateLast5m": 0.08
}
```

This response aligns with `admin_metrics` payload shape.

---

## 6. `WS /api/admin/ws` (admin only)

Subscribe to admin event stream.

### Auth

- Same token transport rule as existing WS:
  - Query: `/api/admin/ws?token=<access_token>`
  - or Header: `Authorization: Bearer <access_token>`

### Message

Server pushes `admin_metrics` event objects that conform to `shared/schema/events.schema.json`.

```json
{
  "eventId": "9f3a9d30-3f58-4f9f-8fe8-29a4b2f41010",
  "ts": 1772158270000,
  "topicId": "admin-overview",
  "runId": "admin-0001",
  "agentId": "review",
  "kind": "admin_metrics",
  "severity": "info",
  "summary": "admin metrics snapshot",
  "payload": {
    "ts": 1772158270000,
    "activeRuns": 3,
    "runsLast5m": 7,
    "eventsLast5m": 214,
    "moduleInFlight": {
      "review": 1,
      "ideation": 1,
      "experiment": 1
    },
    "approvalsPending": 2,
    "errorRateLast5m": 0.08
  }
}
```

---

## 7. Event Payload Summary (New)

- `module_started`
  - required payload: `runId`, `module`, `model`, `thinkingMode`, `online`
  - optional payload: `topicId`
- `module_finished`
  - required payload: `runId`, `module`, `status`, `artifactNames`
  - optional payload: `metrics`
- `module_skipped`
  - required payload: `runId`, `module`, `reason`
- `module_failed`
  - required payload: `runId`, `module`, `error.message`
  - optional payload: `error.code`, `retryable`
- `approval_required`
  - required payload: `runId`, `module`, `summary`
  - optional payload: `artifactName` or `draftArtifact`
- `approval_resolved`
  - required payload: `runId`, `module`, `approved`
  - optional payload: `note`
- `admin_metrics`
  - required payload: `ts`, `activeRuns`, `runsLast5m`, `eventsLast5m`, `moduleInFlight`, `approvalsPending`, `errorRateLast5m`
