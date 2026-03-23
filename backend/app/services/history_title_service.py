from __future__ import annotations

import asyncio
import logging
import re

from app.services.deepseek_client import DeepSeekClientError, deepseek_client
from app.store import store

logger = logging.getLogger(__name__)

_MAX_TITLE_LENGTH = 20
_MIN_TITLE_LENGTH = 6
_TITLE_STRIP_RE = re.compile(r"^[\"'`\s\-\u00b7:;\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u300a\u300b\u3010\u3011\uff08\uff09()]+|[\"'`\s\-\u00b7:;\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u300a\u300b\u3010\u3011\uff08\uff09()]+$")
_WHITESPACE_RE = re.compile(r"\s+")
_LEADING_FILLER_RE = re.compile(
    r"^(?:\u8bf7\u4f60|\u8bf7\u5e2e\u6211|\u8bf7\u5e2e\u5fd9|\u5e2e\u6211|\u9ebb\u70e6\u4f60|\u9ebb\u70e6|\u60f3\u8bf7\u4f60|\u60f3\u8ba9\u4f60|\u8bf7|\u60f3|\u9700\u8981|\u5e2e\u5fd9)+"
)
_SPLIT_RE = re.compile(r"[\u3002\uff01\uff1f!?:;\n\r]+")


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\u3000", " ")).strip()


def _strip_title_noise(value: str) -> str:
    return _TITLE_STRIP_RE.sub("", _normalize_text(value)).strip()


def _clip_title(value: str, *, max_length: int = _MAX_TITLE_LENGTH) -> str:
    return _strip_title_noise(value)[:max_length].strip()


def _choose_seed_text(*candidates: str) -> str:
    for candidate in candidates:
        text = _normalize_text(candidate)
        if text:
            return text
    return ""


def _semantic_chars(value: str) -> set[str]:
    return {
        char
        for char in value
        if char.isalnum() or ("\u4e00" <= char <= "\u9fff")
    }


def _prefer_fallback_title(*, generated: str, fallback: str, user_text: str) -> str:
    user_chars = _semantic_chars(user_text)
    if not user_chars:
        return generated

    generated_overlap = len(user_chars & _semantic_chars(generated))
    fallback_overlap = len(user_chars & _semantic_chars(fallback))

    if generated_overlap == 0 and fallback_overlap > 0:
        return fallback

    if fallback_overlap >= 4 and generated_overlap * 3 < fallback_overlap:
        return fallback

    return generated


def _fallback_history_title(*, user_text: str, assistant_text: str) -> str:
    seed = _choose_seed_text(user_text, assistant_text)
    if not seed:
        return "\u65b0\u7684\u79d1\u7814\u4efb\u52a1"

    first_segment = _SPLIT_RE.split(seed, maxsplit=1)[0].strip()
    first_segment = _LEADING_FILLER_RE.sub("", first_segment).strip(" ,\u3002\uff0c")
    first_segment = _normalize_text(first_segment) or seed

    clipped = _clip_title(first_segment, max_length=_MAX_TITLE_LENGTH)
    if len(clipped) >= _MIN_TITLE_LENGTH:
        return clipped

    ascii_ratio = sum(1 for char in first_segment if ord(char) < 128) / max(len(first_segment), 1)
    if ascii_ratio > 0.7:
        keyword = _clip_title(first_segment, max_length=12)
        if keyword:
            return _clip_title(f"\u5173\u4e8e{keyword}\u7684\u7814\u7a76")

    return _clip_title(first_segment or "\u65b0\u7684\u79d1\u7814\u4efb\u52a1") or "\u65b0\u7684\u79d1\u7814\u4efb\u52a1"


class HistoryTitleService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    async def _generate_title(self, *, user_text: str, assistant_text: str) -> str:
        fallback = _fallback_history_title(user_text=user_text, assistant_text=assistant_text)
        prompt_input = _choose_seed_text(user_text, assistant_text)
        if not prompt_input or not deepseek_client.is_configured:
            return fallback

        try:
            response = await deepseek_client.chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "\u4f60\u662f\u4f1a\u8bdd\u6807\u9898\u751f\u6210\u5668\u3002"
                            "\u8bf7\u57fa\u4e8e\u7528\u6237\u9996\u8f6e\u63d0\u95ee\u4e0e\u7cfb\u7edf\u9996\u8f6e\u8f93\u51fa\uff0c"
                            "\u751f\u6210\u4e00\u4e2a\u7b80\u77ed\u4e2d\u6587\u6807\u9898\u3002"
                            "\u8981\u6c42\uff1a10\u523020\u4e2a\u5b57\u5de6\u53f3\uff0c\u50cf GPT/Gemini \u5de6\u4fa7\u5386\u53f2\u6807\u9898\uff0c"
                            "\u4e0d\u8981\u53e5\u53f7\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u5f15\u53f7\uff0c\u53ea\u8f93\u51fa\u6807\u9898\u672c\u8eab\u3002"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"\u7528\u6237\u9996\u8f6e\u8f93\u5165\uff1a{user_text or '\u65e0'}\n"
                            f"\u7cfb\u7edf\u9996\u8f6e\u8f93\u51fa\uff1a{assistant_text or '\u65e0'}"
                        ),
                    },
                ],
                max_tokens=32,
                temperature=0.2,
            )
        except DeepSeekClientError:
            return fallback
        except Exception:
            logger.exception("History title generation failed unexpectedly")
            return fallback

        title = _clip_title(response, max_length=_MAX_TITLE_LENGTH)
        if len(title) < _MIN_TITLE_LENGTH:
            return fallback
        return _prefer_fallback_title(generated=title, fallback=fallback, user_text=user_text)

    async def maybe_generate_for_message_pair(
        self,
        *,
        topic_id: str,
        run_id: str | None,
        user_text: str,
        assistant_text: str,
    ) -> str | None:
        try:
            async with self._lock:
                topic = await store.get_topic(topic_id)
                if topic is None:
                    return None

                existing_topic_title = topic.get("historyTitle")
                if isinstance(existing_topic_title, str) and existing_topic_title.strip():
                    await store.set_history_title(
                        topic_id=topic_id,
                        run_id=run_id,
                        history_title=existing_topic_title,
                    )
                    return existing_topic_title

                generated = await self._generate_title(user_text=user_text, assistant_text=assistant_text)
                if not generated:
                    return None

                await store.set_history_title(
                    topic_id=topic_id,
                    run_id=run_id,
                    history_title=generated,
                )
                return generated
        except Exception:
            logger.exception("Failed to persist generated history title for message pair")
            return None

    async def maybe_generate_for_run_output(
        self,
        *,
        topic_id: str,
        run_id: str,
        assistant_text: str,
    ) -> str | None:
        try:
            async with self._lock:
                topic = await store.get_topic(topic_id)
                if topic is None:
                    return None

                existing_topic_title = topic.get("historyTitle")
                if isinstance(existing_topic_title, str) and existing_topic_title.strip():
                    await store.set_history_title(
                        topic_id=topic_id,
                        run_id=run_id,
                        history_title=existing_topic_title,
                    )
                    return existing_topic_title

                user_text = _choose_seed_text(
                    str(topic.get("description") or ""),
                    str(topic.get("objective") or ""),
                    str(topic.get("title") or ""),
                )
                generated = await self._generate_title(user_text=user_text, assistant_text=assistant_text)
                if not generated:
                    return None

                await store.set_history_title(
                    topic_id=topic_id,
                    run_id=run_id,
                    history_title=generated,
                )
                return generated
        except Exception:
            logger.exception("Failed to persist generated history title for run output")
            return None


history_title_service = HistoryTitleService()
