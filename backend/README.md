# Backend（FastAPI + SQLite + WS）

本目录实现后端真接口、真 WebSocket、SQLite 持久化、artifact 文件存储，以及可接入 DeepSeek 的多 Agent runner。

## 环境变量

可在仓库根目录 `.env` 或 `backend/.env` 配置：

```env
JWT_SECRET=your-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60
DATABASE_URL=sqlite:///./data.db
ARTIFACTS_ROOT=data/artifacts

DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_SECONDS=120
DEEPSEEK_MAX_RETRIES=1
DEEPSEEK_RETRY_BACKOFF_SECONDS=1.5
```

说明：

- 未配置 `JWT_SECRET` 时会使用默认开发密钥 `dev-jwt-secret-change-me`。
- 生产环境必须显式配置强随机 `JWT_SECRET`。
- SQLite 默认在 `backend/data.db`。
- artifact 文件默认在 `backend/data/artifacts/{topicId}/{runId}/`。
- 配置 `DEEPSEEK_API_KEY` 后，runner 会在 review/ideation/experiment/feedback 真实调用 DeepSeek。
- 未配置 key 时自动 fallback，不阻塞联调。

## 安装依赖

```bash
pip install -r backend/requirements.txt
```

## 启动

在 `backend/` 目录执行：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl http://localhost:8000/api/health
```

## 主要接口

### Auth

- `POST /api/auth/login`
- `GET /api/auth/me`

### Topics / Runs / Snapshot

- `GET /api/topics`
- `POST /api/topics`
- `DELETE /api/topics/{topicId}`
- `GET /api/topics/{topicId}/snapshot`
- `POST /api/topics/{topicId}/runs`

### Commands / Messages / Trace

- `POST /api/topics/{topicId}/agents/{agentId}/command`
- `GET /api/topics/{topicId}/agents/{agentId}/messages`
- `POST /api/topics/{topicId}/agents/{agentId}/messages`
- `GET /api/topics/{topicId}/trace?runId=...`

### Artifact 内容读取（鉴权）

- `GET /api/topics/{topicId}/artifacts/{name}`
- 可选 query：`artifactId`（推荐，用于精确定位同名文件）

示例：

```bash
curl -X GET "http://localhost:8000/api/topics/<TOPIC_ID>/artifacts/results.json?artifactId=<ARTIFACT_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

## WebSocket

- 地址：`ws://localhost:8000/api/ws?topicId=<TOPIC_ID>&token=<TOKEN>`
- topic 级广播；无效 token 会被拒绝。
- 连接成功后会收到一条 `connected` 事件。

## 事件与数据

- 事件契约：`shared/schema/events.schema.json`
- 运行示例：`shared/schema/events.example.json`
- REST/WS 合同：`shared/schema/api-contract.md`

## CLI 输入对结果的影响

- `command` 接口：记录 `event_emitted`，偏操作与审计。
- `messages` 接口：落库到 `messages`，runner 调用 LLM 前会注入 prompt 上下文，对生成结果有直接影响。

## 常用调试命令

登录：

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo"}'
```

创建 topic：

```bash
curl -X POST http://localhost:8000/api/topics \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"RAG Study","description":"企业知识库问答"}'
```

启动 run：

```bash
curl -X POST http://localhost:8000/api/topics/<TOPIC_ID>/runs \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

连接 WS：

```text
ws://localhost:8000/api/ws?topicId=<TOPIC_ID>&token=<TOKEN>
```
