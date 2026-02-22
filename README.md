# SciAgentDemo

一个可联调的科研多 Agent 开发者控制台 Demo。  
技术栈：`FastAPI + WebSocket + SQLite + React(Vite/TS) + React Flow`。

## 当前能力

- 三 Agent 自动闭环：`review -> ideation -> experiment -> ideation(feedback)`
- 真实 REST + 真实 WS（不依赖 mock 业务数据）
- SQLite 持久化（topics/runs/events/messages/artifacts）
- Artifact 文件落盘与鉴权读取
- Topic Trace 时间线（List/Graph）
- Agent Drawer（Logs / Artifacts / Context / Chat）
- DeepSeek 可选接入（未配置 key 时自动 fallback）

## 目录结构

```text
.
├─ backend/
│  ├─ app/
│  │  ├─ api/
│  │  ├─ core/
│  │  ├─ models/
│  │  ├─ services/
│  │  └─ store/
│  ├─ requirements.txt
│  └─ README.md
├─ frontend/
│  └─ src/
└─ shared/
   └─ schema/
      ├─ events.schema.json
      ├─ events.example.json
      └─ api-contract.md
```

## 数据流（核心）

1. 前端登录获取 JWT，后续 REST/WS 都带 token。
2. 进入 topic 时先拉 `snapshot`，再连 `WS` 接收实时事件。
3. 点击 `Run` 后，后端异步执行 pipeline 并持续广播事件。
4. Agent 产物写入 `backend/data/artifacts/{topicId}/{runId}/`，元数据写入 SQLite。
5. Trace 视图从 `/api/topics/{topicId}/trace` 拉历史，并由 WS 增量追加。

## CLI 输入如何影响系统

- `Command`（`POST /agents/{agentId}/command`）：当前主要写事件流，用于操作与审计。
- `Chat`（`POST /agents/{agentId}/messages`）：会写入 `messages`，并在 Agent 调 LLM 前注入 prompt 上下文，对后续生成有直接影响。

## DeepSeek 说明

- 在 `.env` 配置 `DEEPSEEK_API_KEY` 后，runner 会真实调用 DeepSeek。
- 未配置 key 时不会阻塞运行，会 fallback 到模板产物并写 `warn/error` 事件。
- 当前建议配置：
  - `DEEPSEEK_TIMEOUT_SECONDS=120`
  - `DEEPSEEK_MAX_RETRIES=1`
  - `DEEPSEEK_RETRY_BACKOFF_SECONDS=1.5`

## 本地启动

### 一键联调（Windows）

```powershell
.\dev-up.ps1
```

默认行为：

- 自动重启（先停旧进程，再启动）
- 自动清理本项目残留的 `uvicorn/vite` 端口占用
- 若端口已被健康服务占用，会自动复用现有 backend/frontend，避免重复报错
- 自动检测依赖：缺少 `uvicorn` 或 `frontend/node_modules` 时会自动安装

常用参数：

```powershell
.\dev-up.ps1 -Quick
.\dev-up.ps1 -InstallDeps
.\dev-up.ps1 -OpenBrowser
.\dev-up.ps1 -Stop
.\dev-up.ps1 -Status
.\dev-up.ps1 -NoRestart
.\dev-up.ps1 -ForceCleanPorts
.\dev-up.ps1 -RequireDeepSeek
.\dev-up.ps1 -ReadyTimeoutSec 45
.\dev-up.ps1 -DryRun
```

说明：

- `-Quick` = `-Restart + -ForceCleanPorts + -OpenBrowser`，适合日常测试。
- 双击 `dev-up.bat` 默认就是 `-Quick` 模式。
- `-Status` 可快速查看前后端是否在线、端口占用和已记录 PID。

### 手动启动

后端见 `backend/README.md`，前端：

```bash
cd frontend
npm i
npm run dev
```

## 协议与契约

- WS 事件规范：`shared/schema/events.schema.json`
- WS 示例：`shared/schema/events.example.json`
- REST/WS 契约：`shared/schema/api-contract.md`

## 安全

- `DEEPSEEK_API_KEY` 仅放后端环境变量（`.env`），前端不可接触。
- 不要把真实密钥提交到 Git。
