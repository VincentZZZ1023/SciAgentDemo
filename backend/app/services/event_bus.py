from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from app.models.schemas import Event


class EventBus:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, topic_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[topic_id].add(websocket)

    async def disconnect(self, topic_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(topic_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(topic_id, None)

    async def publish(self, topic_id: str, event: Event) -> None:
        payload = event.model_dump(mode="json", exclude_none=True)

        async with self._lock:
            sockets = list(self._connections.get(topic_id, set()))

        stale_sockets: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                stale_sockets.append(socket)

        for socket in stale_sockets:
            await self.disconnect(topic_id, socket)

    async def send_personal(self, websocket: WebSocket, event: Event) -> None:
        payload = event.model_dump(mode="json", exclude_none=True)
        await websocket.send_json(payload)


event_bus = EventBus()
