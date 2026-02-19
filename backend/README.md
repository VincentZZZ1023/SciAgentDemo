# Backend（SQLite 持久化版）

本目录实现 FastAPI 后端真接口、真 WebSocket、SQLite 持久化、artifact 文件存储与假 pipeline runner。

## 环境变量

可在仓库根目录 `.env` 或 `backend/.env` 中配置：

```env
JWT_SECRET=your-secret
ACCESS_TOKEN_EXPIRE_MINUTES=60
DATABASE_URL=sqlite:///./data.db
```

说明：

- 未配置 `JWT_SECRET` 时会使用默认开发密钥 `dev-jwt-secret-change-me`。
- 生产环境必须显式配置强随机 `JWT_SECRET`。
- 默认 SQLite 文件会生成在 `backend/data.db`。
- artifact 文件会写入 `backend/data/artifacts/{topicId}/{runId}/`。

## 安装依赖

```bash
pip install -r backend/requirements.txt
```

## 启动服务

在 `backend/` 目录执行：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

服务启动时会自动创建数据表（首次启动会生成 `data.db`）。

健康检查：

```bash
curl http://localhost:8000/api/health
```

## 接口联调示例

1) 登录拿 token：

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo"}'
```

2) 创建 topic：

```bash
curl -X POST http://localhost:8000/api/topics \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Neural-Symbolic Discovery","description":"demo topic"}'
```

3) 启动 run：

```bash
curl -X POST http://localhost:8000/api/topics/<TOPIC_ID>/runs \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

4) 读取 artifact 内容：

```bash
curl -X GET "http://localhost:8000/api/topics/<TOPIC_ID>/artifacts/survey.md" \
  -H "Authorization: Bearer <TOKEN>"
```

5) 删除 topic：

```bash
curl -X DELETE "http://localhost:8000/api/topics/<TOPIC_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

## WebSocket 连接示例

浏览器地址（query token）：

```text
ws://localhost:8000/api/ws?topicId=<TOPIC_ID>&token=<TOKEN>
```

`wscat` 示例：

```bash
wscat -c "ws://localhost:8000/api/ws?topicId=<TOPIC_ID>&token=<TOKEN>"
```
