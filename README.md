# SciAgentDemo

这是一个科研多 Agent 协作 Demo。

当前进度：

- Step 1 已完成：契约与工程骨架（`shared/schema`）
- Step 2 已完成：FastAPI 后端（真 REST、真 WebSocket、SQLite 持久化、假 runner）
- Step 3 已完成：React 前端（Vite + TypeScript）与后端真接口联调

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

## 三个 Agent 的数据流向

核心 pipeline：`review -> ideation -> experiment -> ideation(feedback)`

- `review` 产出 `survey.md` 并交给 `ideation`
- `ideation` 产出 `ideas.md` 并交给 `experiment`
- `experiment` 产出 `results.json` 并反馈给 `ideation`

## 前后端对接方式

- 前端先调用 `GET /api/topics/{topicId}/snapshot` 拉取初始状态
- 再连接 `WS /api/ws?topicId=...&token=...` 接收增量事件
- 事件结构必须满足 `shared/schema/events.schema.json`
- 前端状态只能由后端真实返回的 `snapshot + WS events` 驱动，禁止 mock 业务数据

## 后端启动

详见 `backend/README.md`。

## 前端启动

```bash
cd frontend
npm i
npm run dev
```

## 一键联调启动（Windows）

在仓库根目录执行：

```powershell
.\dev-up.ps1
```

可选参数：

```powershell
.\dev-up.ps1 -InstallDeps      # 先安装后端/前端依赖，再启动
.\dev-up.ps1 -OpenBrowser      # 启动后自动打开前端页面
.\dev-up.ps1 -Restart          # 先停止旧进程，再重新启动
.\dev-up.ps1 -Stop             # 停止由 dev-up 启动的前后端进程
```

也可以直接双击：

- `dev-up.bat`

## 安全约束

- `DEEPSEEK_API_KEY` 只允许存在于后端环境变量
- 前端代码与浏览器请求不得接触 DeepSeek API Key
- 本仓库不得提交真实密钥
