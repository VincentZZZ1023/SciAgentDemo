from fastapi import APIRouter

from app.api.routes import admin, approvals, auth, commands, config, messages, runs, topics, trace, ws

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(config.router)
api_router.include_router(topics.router)
api_router.include_router(runs.router)
api_router.include_router(commands.router)
api_router.include_router(messages.router)
api_router.include_router(approvals.router)
api_router.include_router(trace.router)
api_router.include_router(ws.router)
api_router.include_router(admin.router)
