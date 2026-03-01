from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class ApprovalDecision:
    approved: bool
    note: str | None = None


@dataclass
class _PendingApproval:
    event: asyncio.Event
    decision: ApprovalDecision | None = None


class ApprovalManager:
    def __init__(self) -> None:
        self._pending: dict[tuple[str, str], _PendingApproval] = {}
        self._lock = asyncio.Lock()

    async def create_pending(self, run_id: str, module: str) -> None:
        async with self._lock:
            self._pending[(run_id, module)] = _PendingApproval(event=asyncio.Event())

    async def wait_for_decision(self, run_id: str, module: str) -> ApprovalDecision:
        key = (run_id, module)
        async with self._lock:
            waiter = self._pending.get(key)
            if waiter is None:
                waiter = _PendingApproval(event=asyncio.Event())
                self._pending[key] = waiter
            event = waiter.event

        await event.wait()

        async with self._lock:
            resolved = self._pending.pop(key, None)

        if resolved is None or resolved.decision is None:
            return ApprovalDecision(approved=False, note="approval context lost")
        return resolved.decision

    async def resolve(self, run_id: str, module: str, *, approved: bool, note: str | None = None) -> bool:
        key = (run_id, module)
        async with self._lock:
            waiter = self._pending.get(key)
            if waiter is None:
                return False

            waiter.decision = ApprovalDecision(approved=approved, note=note)
            waiter.event.set()
            return True

    async def clear_run(self, run_id: str) -> None:
        async with self._lock:
            keys = [key for key in self._pending if key[0] == run_id]
            for key in keys:
                waiter = self._pending.pop(key, None)
                if waiter is not None:
                    waiter.event.set()


approval_manager = ApprovalManager()

