# SciAgent 接口契约（Step 1）

> 本文档仅定义前后端联调契约，不包含业务实现。前端必须按本契约调用真实后端接口，禁止使用 mock 数据替代。

## 1. 全局约定

- Base URL：`http://localhost:8000`（可由 `BACKEND_BASE_URL` 覆盖）
- 数据格式：`application/json; charset=utf-8`
- 鉴权：JWT Bearer Token
- Agent 枚举：`review | ideation | experiment`
- WS 事件协议：见 `shared/schema/events.schema.json`
- WS `kind` 枚举：`agent_status_updated | event_emitted | artifact_created | message_created`

### 1.1 通用错误体

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

## 2. REST 契约

### 2.1 `POST /api/auth/login`

用途：登录并返回访问令牌。

请求体：

```json
{
  "username": "string",
  "password": "string"
}
```

成功响应 `200`：

```json
{
  "access_token": "jwt-token-string",
  "token_type": "bearer",
  "expires_in": 3600
}
```

失败：`401 Unauthorized`

### 2.2 `GET /api/topics`

用途：获取课题列表。

请求头：

- `Authorization: Bearer <access_token>`

成功响应 `200`：

```json
{
  "items": [
    {
      "topicId": "topic-neural-symbolic-discovery",
      "title": "Neural-Symbolic Discovery for Materials",
      "status": "active",
      "createdAt": 1771462000000,
      "updatedAt": 1771463046000,
      "lastRunId": "run-20260219-001"
    }
  ],
  "total": 1
}
```

### 2.3 `POST /api/topics`

用途：创建新课题。

请求头：

- `Authorization: Bearer <access_token>`

请求体：

```json
{
  "title": "string",
  "description": "string",
  "objective": "string",
  "tags": ["string"]
}
```

成功响应 `201`：

```json
{
  "topicId": "topic-new-id",
  "title": "string",
  "description": "string",
  "objective": "string",
  "tags": ["string"],
  "status": "active",
  "createdAt": 1771462000000
}
```

### 2.4 `GET /api/topics/{topicId}/snapshot`

用途：获取某个课题当前快照（前端初始化页面时必须先调用此接口）。

请求头：

- `Authorization: Bearer <access_token>`

路径参数：

- `topicId: string`

查询参数：

- `limit: number`，可选，返回最近 N 条事件，默认 `50`

成功响应 `200`：

```json
{
  "topic": {
    "topicId": "topic-neural-symbolic-discovery",
    "title": "Neural-Symbolic Discovery for Materials",
    "description": "string",
    "objective": "string",
    "status": "active",
    "createdAt": 1771462000000,
    "updatedAt": 1771463046000,
    "activeRunId": "run-20260219-001"
  },
  "agents": [
    {
      "agentId": "review",
      "state": "completed",
      "runId": "run-20260219-001",
      "updatedAt": 1771462871000,
      "lastSummary": "survey 已发往 ideation"
    },
    {
      "agentId": "ideation",
      "state": "running",
      "runId": "run-20260219-001",
      "updatedAt": 1771462922000,
      "lastSummary": "idea 已发往 experiment"
    },
    {
      "agentId": "experiment",
      "state": "running",
      "runId": "run-20260219-001",
      "updatedAt": 1771463046000,
      "lastSummary": "results 已反馈 ideation"
    }
  ],
  "events": [
    {
      "eventId": "9f3a9d30-3f58-4f9f-8fe8-29a4b2f40008",
      "ts": 1771463046000,
      "topicId": "topic-neural-symbolic-discovery",
      "runId": "run-20260219-001",
      "agentId": "experiment",
      "kind": "event_emitted",
      "severity": "info",
      "summary": "experiment 将 results 反馈给 ideation 进行下一轮改进"
    }
  ],
  "artifacts": [
    {
      "artifactId": "art-survey-001",
      "name": "survey.md",
      "uri": "artifact://topic-neural-symbolic-discovery/run-20260219-001/survey.md",
      "contentType": "text/markdown"
    },
    {
      "artifactId": "art-results-001",
      "name": "results.json",
      "uri": "artifact://topic-neural-symbolic-discovery/run-20260219-001/results.json",
      "contentType": "application/json"
    }
  ]
}
```

说明：

- `events` 数组内每条对象必须满足 `events.schema.json`。
- `artifacts` 为可选字段；无产物时可省略或返回空数组。

### 2.5 `POST /api/topics/{topicId}/runs`

用途：为课题创建一次新的运行（run）。

请求头：

- `Authorization: Bearer <access_token>`

请求体：

```json
{
  "trigger": "manual",
  "initiator": "user",
  "note": "optional string"
}
```

成功响应 `201`：

```json
{
  "runId": "run-20260219-002",
  "topicId": "topic-neural-symbolic-discovery",
  "status": "queued",
  "createdAt": 1771465000000
}
```

### 2.6 `POST /api/topics/{topicId}/agents/{agentId}/command`

用途：向指定 agent 发送控制命令。

请求头：

- `Authorization: Bearer <access_token>`

路径参数：

- `topicId: string`
- `agentId: review | ideation | experiment`

请求体：

```json
{
  "command": "start",
  "runId": "run-20260219-002",
  "args": {}
}
```

`command` 枚举：`start | pause | resume | stop | retry`

成功响应 `202`：

```json
{
  "accepted": true,
  "commandId": "cmd-001",
  "topicId": "topic-neural-symbolic-discovery",
  "agentId": "review",
  "runId": "run-20260219-002",
  "queuedAt": 1771465000100
}
```

### 2.7 `GET /api/topics/{topicId}/agents/{agentId}/messages`

用途：获取指定 agent 在当前 topic 下的对话线程（按 `ts` 升序）。

请求头：

- `Authorization: Bearer <access_token>`

路径参数：

- `topicId: string`
- `agentId: review | ideation | experiment`

成功响应 `200`：

```json
{
  "messages": [
    {
      "messageId": "0e850529-a2e1-4431-9668-f4cb482f196e",
      "topicId": "topic-neural-symbolic-discovery",
      "runId": "run-20260219-002",
      "agentId": "ideation",
      "role": "user",
      "content": "请基于 survey 生成可执行 idea",
      "ts": 1771465000200
    },
    {
      "messageId": "b3f2d52f-c2c6-4f7b-b843-777f0f2f8600",
      "topicId": "topic-neural-symbolic-discovery",
      "runId": "run-20260219-002",
      "agentId": "ideation",
      "role": "assistant",
      "content": "Echo: 请基于 survey 生成可执行 idea",
      "ts": 1771465000250
    }
  ]
}
```

### 2.8 `POST /api/topics/{topicId}/agents/{agentId}/messages`

用途：向指定 agent 对话线程写入一条用户消息，并返回新增消息（当前实现为 echo assistant 回复）。

请求头：

- `Authorization: Bearer <access_token>`

路径参数：

- `topicId: string`
- `agentId: review | ideation | experiment`

请求体：

```json
{
  "content": "请总结实验结果并提出下一轮改进方向"
}
```

成功响应 `201`：

```json
{
  "messages": [
    {
      "messageId": "cb88d4f6-b5fd-4aef-a725-4f54a2d0d09f",
      "topicId": "topic-neural-symbolic-discovery",
      "runId": "run-20260219-002",
      "agentId": "ideation",
      "role": "user",
      "content": "请总结实验结果并提出下一轮改进方向",
      "ts": 1771465000300
    },
    {
      "messageId": "3e5ef475-c749-4ec9-9688-fb510f5519e6",
      "topicId": "topic-neural-symbolic-discovery",
      "runId": "run-20260219-002",
      "agentId": "ideation",
      "role": "assistant",
      "content": "Echo: 请总结实验结果并提出下一轮改进方向",
      "ts": 1771465000350
    }
  ]
}
```

### 2.9 `GET /api/topics/{topicId}/trace`

用途：获取 Topic 级 Trace Timeline（按时间顺序聚合 message/artifact/status/event）。

请求头：

- `Authorization: Bearer <access_token>`

路径参数：

- `topicId: string`

查询参数：

- `runId: string`，可选；未传时服务端优先选择 active run，否则选择最近一次 run。

成功响应 `200`：

```json
{
  "topicId": "topic-neural-symbolic-discovery",
  "runId": "run-20260219-002",
  "items": [
    {
      "id": "msg-cb88d4f6-b5fd-4aef-a725-4f54a2d0d09f",
      "ts": 1771465000300,
      "agentId": "ideation",
      "kind": "message",
      "summary": "user: 请总结实验结果并提出下一轮改进方向",
      "payload": {
        "message": {
          "messageId": "cb88d4f6-b5fd-4aef-a725-4f54a2d0d09f",
          "topicId": "topic-neural-symbolic-discovery",
          "runId": "run-20260219-002",
          "agentId": "ideation",
          "role": "user",
          "content": "请总结实验结果并提出下一轮改进方向",
          "ts": 1771465000300
        }
      }
    },
    {
      "id": "artifact-art-results-001",
      "ts": 1771465040000,
      "agentId": "experiment",
      "kind": "artifact",
      "summary": "artifact: results.json",
      "payload": {
        "artifact": {
          "artifactId": "art-results-001",
          "name": "results.json",
          "uri": "/api/topics/topic-neural-symbolic-discovery/artifacts/results.json",
          "contentType": "application/json"
        }
      }
    }
  ]
}
```

## 3. WebSocket 契约

### 3.1 `WS /api/ws?topicId=...`

用途：订阅课题实时事件流。

连接参数：

- 必填：`topicId`
- token 传递方式（二选一）：
  - Query：`/api/ws?topicId={topicId}&token={access_token}`（浏览器推荐）
  - Header：`Authorization: Bearer <access_token>`（非浏览器客户端可用）

连接示例：

```text
ws://localhost:8000/api/ws?topicId=topic-neural-symbolic-discovery&token=<access_token>
```

服务端下行消息：

- 每条消息都是单个 JSON 对象。
- 每条消息必须满足 `shared/schema/events.schema.json`。
- `kind=message_created` 时，`payload.message` 为新增消息对象（`messageId/topicId/runId?/agentId/role/content/ts`）。

客户端上行消息：

- 本阶段不定义业务上行消息；客户端只消费服务端推送。

异常关闭建议：

- `1008`：鉴权失败或 token 过期
- `1003`：消息格式错误

## 4. 前端对接顺序（强约束）

1. 调用 `POST /api/auth/login` 获取 `access_token`。
2. 调用 `GET /api/topics/{topicId}/snapshot` 获取初始状态。
3. 建立 `WS /api/ws?topicId=...`，持续消费增量事件。
4. 前端状态只能由 `snapshot + WS事件` 驱动，禁止本地 mock 事件填充业务数据。
