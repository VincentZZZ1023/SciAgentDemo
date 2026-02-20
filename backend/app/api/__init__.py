from fastapi import APIRouter

from app.api.routes import auth, commands, messages, runs, topics, trace, ws

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(topics.router)
api_router.include_router(runs.router)
api_router.include_router(commands.router)
api_router.include_router(messages.router)
api_router.include_router(trace.router)
api_router.include_router(ws.router)
