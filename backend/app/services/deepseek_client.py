from __future__ import annotations

import asyncio
import logging
from typing import Literal, TypedDict

import httpx

from app.core.config import get_settings

ChatRole = Literal["system", "user", "assistant"]


class ChatMessage(TypedDict):
    role: ChatRole
    content: str


class DeepSeekClientError(RuntimeError):
    """Raised when DeepSeek request fails or response is malformed."""


logger = logging.getLogger(__name__)


def _format_exception(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return f"{exc.__class__.__name__}: {message}"
    return exc.__class__.__name__


class DeepSeekClient:
    def __init__(self) -> None:
        self._settings = get_settings()

    @property
    def is_configured(self) -> bool:
        api_key = self._settings.deepseek_api_key
        return isinstance(api_key, str) and api_key.strip() != ""

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        if not messages:
            raise DeepSeekClientError("DeepSeek chat requires at least one message")

        api_key = self._settings.deepseek_api_key
        if not isinstance(api_key, str) or not api_key.strip():
            raise DeepSeekClientError("DEEPSEEK_API_KEY is not configured")

        base_url = self._settings.deepseek_base_url.rstrip("/")
        url = f"{base_url}/chat/completions"

        payload: dict[str, object] = {
            "model": self._settings.deepseek_model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        timeout_value = max(float(self._settings.deepseek_timeout_seconds), 1.0)
        timeout = httpx.Timeout(timeout_value)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        max_attempts = max(1, int(self._settings.deepseek_max_retries) + 1)
        backoff_seconds = max(float(self._settings.deepseek_retry_backoff_seconds), 0.0)
        response: httpx.Response | None = None
        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(url, headers=headers, json=payload)
                break
            except httpx.TimeoutException as exc:
                last_error = exc
                logger.warning(
                    "DeepSeek timeout (attempt %s/%s, model=%s, timeout=%ss, messages=%s): %s",
                    attempt,
                    max_attempts,
                    self._settings.deepseek_model,
                    timeout_value,
                    len(messages),
                    _format_exception(exc),
                )
            except httpx.HTTPError as exc:
                last_error = exc
                logger.warning(
                    "DeepSeek transport error (attempt %s/%s, model=%s): %s",
                    attempt,
                    max_attempts,
                    self._settings.deepseek_model,
                    _format_exception(exc),
                )
            except Exception as exc:
                last_error = exc
                logger.exception(
                    "Unexpected DeepSeek client error (attempt %s/%s, model=%s)",
                    attempt,
                    max_attempts,
                    self._settings.deepseek_model,
                )

            if attempt < max_attempts and backoff_seconds > 0:
                await asyncio.sleep(backoff_seconds * attempt)

        if response is None:
            if last_error is None:
                raise DeepSeekClientError("DeepSeek request failed: unknown transport error")
            raise DeepSeekClientError(
                f"DeepSeek request failed after {max_attempts} attempt(s): "
                f"{_format_exception(last_error)}"
            ) from last_error

        if response.status_code >= 400:
            detail = ""
            try:
                data = response.json()
                if isinstance(data, dict):
                    error_node = data.get("error")
                    if isinstance(error_node, dict):
                        detail = str(error_node.get("message") or "").strip()
                    if not detail:
                        detail = str(data.get("detail") or "").strip()
            except Exception:
                detail = ""
            if not detail:
                detail = response.text.strip() or response.reason_phrase
            logger.warning(
                "DeepSeek API error (status=%s, model=%s): %s",
                response.status_code,
                self._settings.deepseek_model,
                detail,
            )
            raise DeepSeekClientError(f"DeepSeek API {response.status_code}: {detail}")

        try:
            data = response.json()
        except Exception as exc:
            raise DeepSeekClientError("DeepSeek response is not valid JSON") from exc

        content: object | None = None
        if isinstance(data, dict):
            choices = data.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0]
                if isinstance(first, dict):
                    message = first.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")

        if not isinstance(content, str) or not content.strip():
            raise DeepSeekClientError("DeepSeek response missing choices[0].message.content")

        return content.strip()


deepseek_client = DeepSeekClient()
