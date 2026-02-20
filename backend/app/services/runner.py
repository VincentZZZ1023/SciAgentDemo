from __future__ import annotations

import asyncio
import json
import logging
import time
from uuid import uuid4

from sqlmodel import Session

from app.models.schemas import AgentId, ArtifactRef, Event, EventKind, Severity
from app.services.deepseek_client import DeepSeekClientError, deepseek_client
from app.services.event_bus import event_bus
from app.services.prompt_builder import build_agent_prompt_context, infer_language_code
from app.store import store
from app.store.database import ENGINE

logger = logging.getLogger(__name__)


def now_ms() -> int:
    return int(time.time() * 1000)


def build_event(
    *,
    topic_id: str,
    run_id: str,
    agent_id: AgentId,
    kind: EventKind,
    severity: Severity,
    summary: str,
    payload: dict | None = None,
    artifacts: list[ArtifactRef] | None = None,
    trace_id: str | None = None,
) -> Event:
    return Event(
        eventId=str(uuid4()),
        ts=now_ms(),
        topicId=topic_id,
        runId=run_id,
        agentId=agent_id,
        kind=kind,
        severity=severity,
        summary=summary,
        payload=payload,
        artifacts=artifacts,
        traceId=trace_id,
    )


class FakePipelineRunner:
    def __init__(self) -> None:
        self._step_sleep = 0.8

    @staticmethod
    def _pick_by_lang(language: str, zh_text: str, en_text: str) -> str:
        return zh_text if language == "zh" else en_text

    @staticmethod
    def _safe_text(value: object, fallback: str = "") -> str:
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
        return fallback

    @staticmethod
    def _build_topic_anchor(
        *,
        topic_id: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        return (
            "<topic_context>\n"
            f"<topic_id>{topic_id}</topic_id>\n"
            f"<title>{topic_title}</title>\n"
            f"<description>{topic_description or 'N/A'}</description>\n"
            f"<objective>{topic_objective or 'N/A'}</objective>\n"
            "</topic_context>"
        )

    @staticmethod
    def _error_payload(exc: Exception) -> dict:
        message = str(exc).strip()
        return {
            "error": message or repr(exc),
            "errorType": exc.__class__.__name__,
        }

    async def _emit(self, event: Event) -> None:
        await store.add_event(event)
        await event_bus.publish(event.topicId, event)

    async def _create_artifact(
        self,
        *,
        topic_id: str,
        run_id: str,
        name: str,
        content_type: str,
        content: str | dict,
    ) -> ArtifactRef:
        return await store.create_artifact(
            topic_id=topic_id,
            run_id=run_id,
            name=name,
            content_type=content_type,
            content=content,
        )

    async def _update_agent(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        status: str,
        progress: float,
        summary: str,
        trace_id: str,
    ) -> None:
        await store.set_agent_status(
            topic_id,
            agent_id=agent_id,
            status=status,
            progress=progress,
            run_id=run_id,
            summary=summary,
        )

        severity = Severity.error if status == "failed" else Severity.info
        event = build_event(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            kind=EventKind.agent_status_updated,
            severity=severity,
            summary=summary,
            payload={"status": status, "progress": progress},
            trace_id=trace_id,
        )
        await self._emit(event)

    async def _emit_llm_stage(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        summary: str,
        severity: Severity = Severity.info,
        payload: dict | None = None,
    ) -> None:
        await self._emit(
            build_event(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                kind=EventKind.event_emitted,
                severity=severity,
                summary=summary,
                payload=payload,
                trace_id=trace_id,
            )
        )

    @staticmethod
    def _strip_markdown_fence(content: str) -> str:
        text = content.strip()
        if not text.startswith("```"):
            return text

        lines = text.splitlines()
        if len(lines) >= 2 and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()

        return text

    @classmethod
    def _parse_json_payload(cls, content: str) -> dict | None:
        raw = cls._strip_markdown_fence(content)
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end <= start:
            return None

        try:
            parsed = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    @staticmethod
    def _fallback_review_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 文献综述（回退）\n\n"
                "## 主题对齐\n"
                f"- 研究主题：{topic_title}\n"
                f"- 场景描述：{topic_description or '未提供'}\n"
                f"- 核心目标：{topic_objective or '未提供'}\n\n"
                "## 现状观察\n"
                "- 该方向常见方案包括检索增强、知识蒸馏与评估闭环。\n"
                "- 实际落地中最常见瓶颈是数据质量与评测口径不一致。\n"
                "- 需要明确在线约束，避免实验结果不可复现。\n\n"
                "## 方法对比\n"
                "- 规则驱动：可控但覆盖有限。\n"
                "- 端到端模型：潜力高但解释性较弱。\n"
                "- 混合式架构：在稳定性与性能间更平衡。\n\n"
                "## 后续建议\n"
                "- 进入 ideation 阶段，先做 2-3 个可执行方案。\n"
                "- 同步定义实验指标、成本预算、失败回退机制。\n"
                "- 保留与主题目标直接相关的约束，减少泛化描述。\n"
            )
        return (
            f"# Literature Survey for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Topic: {topic_title}\n"
            f"- Description: {topic_description or 'N/A'}\n"
            f"- Objective: {topic_objective or 'N/A'}\n\n"
            "## Current Landscape\n"
            "- Typical directions include retrieval augmentation, distillation, and closed-loop evaluation.\n"
            "- Common production bottleneck is mismatch between data quality and evaluation protocol.\n"
            "- Online constraints must be explicit to keep experiments reproducible.\n\n"
            "## Method Comparison\n"
            "- Rule-driven: controllable but narrow coverage.\n"
            "- End-to-end: high performance ceiling but weaker interpretability.\n"
            "- Hybrid: balanced trade-off between reliability and performance.\n\n"
            "## Next Actions\n"
            "- Move to ideation with 2-3 executable proposals.\n"
            "- Define metrics, budget, and rollback policy together.\n"
            "- Keep constraints tightly bound to the topic objective.\n"
        )

    @staticmethod
    def _fallback_ideas_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 方案构思（回退）\n\n"
                "## 主题对齐\n"
                f"- 描述约束：{topic_description or '未提供'}\n"
                f"- 目标约束：{topic_objective or '未提供'}\n"
                "- 下述方案均围绕该主题目标设计，不做泛化扩展。\n\n"
                "## 方案 A：检索增强 + 质量门控\n"
                "- 假设：提升检索相关性能显著提高回答可靠性。\n"
                "- 执行：引入 query rewrite、rerank、低分拒答策略。\n"
                "- 指标：Hit@k、回答准确率、拒答正确率。\n\n"
                "## 方案 B：多路径推理 + 置信度路由\n"
                "- 假设：按任务难度路由可提升总体稳定性。\n"
                "- 执行：轻量路径与重路径并行，按置信度选择。\n"
                "- 指标：端到端延迟、失败率、复杂问题成功率。\n\n"
                "## 方案 C：反馈闭环优化\n"
                "- 假设：将失败样本回灌可持续提升表现。\n"
                "- 执行：沉淀 error cases，定期离线再评估。\n"
                "- 指标：迭代增益、回归率、维护成本。\n"
            )
        return (
            f"# Research Ideas for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Description constraints: {topic_description or 'N/A'}\n"
            f"- Objective constraints: {topic_objective or 'N/A'}\n"
            "- All ideas below are scoped to this topic and objective.\n\n"
            "## Idea A: Retrieval Augmentation + Quality Gates\n"
            "- Hypothesis: improving retrieval relevance lifts answer reliability.\n"
            "- Plan: add query rewrite, rerank, and low-score abstention.\n"
            "- Metrics: Hit@k, answer accuracy, abstention precision.\n\n"
            "## Idea B: Multi-path Reasoning + Confidence Routing\n"
            "- Hypothesis: route-by-difficulty improves stability.\n"
            "- Plan: lightweight and heavy paths, selected by confidence.\n"
            "- Metrics: latency, failure rate, hard-case success rate.\n\n"
            "## Idea C: Feedback-Driven Iteration\n"
            "- Hypothesis: replaying failure cases yields compounding gains.\n"
            "- Plan: collect error cases and run periodic offline reevaluation.\n"
            "- Metrics: iteration uplift, regression rate, maintenance overhead.\n"
        )

    @staticmethod
    def _fallback_result_report_markdown(
        *,
        language: str,
        topic_title: str,
        topic_description: str,
        topic_objective: str,
        metrics: dict,
    ) -> str:
        if language == "zh":
            return (
                f"# {topic_title} 实验结果报告（回退）\n\n"
                "## 主题对齐\n"
                f"- 场景描述：{topic_description or '未提供'}\n"
                f"- 目标说明：{topic_objective or '未提供'}\n"
                "- 本报告仅围绕主题目标解释实验结果。\n\n"
                "## 关键观察\n"
                "- 检索增强路线在稳定性上提升明显。\n"
                "- 置信度路由降低了高难样本的失败率。\n"
                "- 反馈闭环对迭代增益有正向作用。\n\n"
                "## 指标解读\n"
                f"- Accuracy: {metrics.get('accuracy', 'n/a')}\n"
                f"- F1: {metrics.get('f1', 'n/a')}\n"
                f"- Robustness: {metrics.get('robustness', 'n/a')}\n"
                "- 指标表明当前方案可进入下一轮优化。\n\n"
                "## 风险与下一步\n"
                "- 风险：数据分布漂移可能导致线上回落。\n"
                "- 风险：复杂路由策略增加维护成本。\n"
                "- 下一步：扩样本、做消融、补充成本收益分析。\n"
            )
        return (
            f"# Experiment Result Report for {topic_title} (Fallback)\n\n"
            "## Topic Alignment\n"
            f"- Description: {topic_description or 'N/A'}\n"
            f"- Objective: {topic_objective or 'N/A'}\n"
            "- This report remains scoped to the topic constraints.\n\n"
            "## Key Observations\n"
            "- Retrieval-augmented setup improved reliability.\n"
            "- Confidence routing reduced failure rate on hard cases.\n"
            "- Feedback loop contributed to iterative gains.\n\n"
            "## Metrics Interpretation\n"
            f"- Accuracy: {metrics.get('accuracy', 'n/a')}\n"
            f"- F1: {metrics.get('f1', 'n/a')}\n"
            f"- Robustness: {metrics.get('robustness', 'n/a')}\n"
            "- Signals are positive for the next optimization cycle.\n\n"
            "## Risks and Next Steps\n"
            "- Risk: distribution shift can hurt online quality.\n"
            "- Risk: more complex routing increases maintenance burden.\n"
            "- Next: scale data, run ablations, add cost-benefit analysis.\n"
        )

    async def _generate_text_content(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        system_policy: str,
        upstream_content: str,
        final_task: str,
        fallback_content: str,
        max_tokens: int | None = None,
    ) -> str:
        with Session(ENGINE) as db:
            messages = await build_agent_prompt_context(
                db=db,
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id.value,
                system_policy=system_policy,
                upstream_content=upstream_content,
                final_task=final_task,
            )

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} invoking DeepSeek",
            payload={
                "provider": "deepseek",
                "messageCount": len(messages),
                "maxTokens": max_tokens,
            },
        )

        if not deepseek_client.is_configured:
            logger.warning(
                "DeepSeek key missing; fallback text used (topic=%s run=%s agent=%s)",
                topic_id,
                run_id,
                agent_id.value,
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DEEPSEEK_API_KEY is missing, fallback content used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return fallback_content

        try:
            response = await deepseek_client.chat(messages, max_tokens=max_tokens)
        except DeepSeekClientError as exc:
            error_payload = self._error_payload(exc)
            logger.warning(
                "DeepSeek text call failed (topic=%s run=%s agent=%s): %s",
                topic_id,
                run_id,
                agent_id.value,
                error_payload["error"],
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek request failed, fallback content used",
                severity=Severity.error,
                payload={"provider": "deepseek", "fallback": True, **error_payload},
            )
            return fallback_content

        normalized = self._strip_markdown_fence(response).strip()
        if not normalized:
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek returned empty content, fallback content used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return fallback_content

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} received DeepSeek response",
            payload={"provider": "deepseek", "fallback": False},
        )
        return normalized

    async def _generate_json_content(
        self,
        *,
        topic_id: str,
        run_id: str,
        agent_id: AgentId,
        trace_id: str,
        system_policy: str,
        upstream_content: str,
        final_task: str,
        fallback_content: dict,
        max_tokens: int | None = None,
    ) -> dict:
        with Session(ENGINE) as db:
            messages = await build_agent_prompt_context(
                db=db,
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id.value,
                system_policy=system_policy,
                upstream_content=upstream_content,
                final_task=final_task,
            )

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} invoking DeepSeek",
            payload={
                "provider": "deepseek",
                "messageCount": len(messages),
                "maxTokens": max_tokens,
            },
        )

        if not deepseek_client.is_configured:
            logger.warning(
                "DeepSeek key missing; fallback JSON used (topic=%s run=%s agent=%s)",
                topic_id,
                run_id,
                agent_id.value,
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DEEPSEEK_API_KEY is missing, fallback JSON used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return dict(fallback_content)

        try:
            response = await deepseek_client.chat(messages, max_tokens=max_tokens)
        except DeepSeekClientError as exc:
            error_payload = self._error_payload(exc)
            logger.warning(
                "DeepSeek JSON call failed (topic=%s run=%s agent=%s): %s",
                topic_id,
                run_id,
                agent_id.value,
                error_payload["error"],
            )
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek request failed, fallback JSON used",
                severity=Severity.error,
                payload={"provider": "deepseek", "fallback": True, **error_payload},
            )
            return dict(fallback_content)

        parsed = self._parse_json_payload(response)
        if parsed is None:
            await self._emit_llm_stage(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=agent_id,
                trace_id=trace_id,
                summary="DeepSeek response is not valid JSON, fallback JSON used",
                severity=Severity.warn,
                payload={"provider": "deepseek", "fallback": True},
            )
            return dict(fallback_content)

        await self._emit_llm_stage(
            topic_id=topic_id,
            run_id=run_id,
            agent_id=agent_id,
            trace_id=trace_id,
            summary=f"{agent_id.value} received DeepSeek response",
            payload={"provider": "deepseek", "fallback": False},
        )
        return parsed

    async def run_pipeline(self, topic_id: str, run_id: str) -> None:
        trace_id = f"trace-{uuid4()}"

        try:
            await store.update_run_status(topic_id, run_id, "running")
            topic = await store.get_topic(topic_id)
            if topic is None:
                raise KeyError(topic_id)

            topic_title = self._safe_text(topic.get("title"), self._safe_text(topic.get("name"), topic_id))
            topic_description = self._safe_text(topic.get("description"))
            topic_objective = self._safe_text(topic.get("objective"))

            topic_anchor = self._build_topic_anchor(
                topic_id=topic_id,
                topic_title=topic_title,
                topic_description=topic_description,
                topic_objective=topic_objective,
            )
            preferred_language = infer_language_code(topic_title, topic_description, topic_objective)

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run started",
                    payload={"phase": "run_started", "topicTitle": topic_title},
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                status="running",
                progress=0.1,
                summary="review running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="starting literature review",
                    payload={"stage": "review"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            survey_content = await self._generate_text_content(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                trace_id=trace_id,
                system_policy="You are the review agent. Produce a rigorous, topic-grounded literature survey in markdown.",
                upstream_content=topic_anchor,
                final_task=(
                    "Generate survey.md using <upstream_reference>. You must explicitly map all conclusions to "
                    "topic title/description/objective and avoid generic boilerplate."
                ),
                fallback_content=self._fallback_review_markdown(
                    language=preferred_language,
                    topic_title=topic_title,
                    topic_description=topic_description,
                    topic_objective=topic_objective,
                ),
                max_tokens=1800,
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.review,
                status="completed",
                progress=1.0,
                summary="review completed",
                trace_id=trace_id,
            )

            survey_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="survey.md",
                content_type="text/markdown",
                content=survey_content,
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.review,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="review produced survey.md",
                    payload={"handoffTo": "ideation", "artifactRole": "survey"},
                    artifacts=[survey_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="running",
                progress=0.2,
                summary="ideation running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="generating ideas from survey",
                    payload={"stage": "ideation"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            ideas_upstream = (
                f"{topic_anchor}\n\n"
                "<review_survey>\n"
                f"{survey_content}\n"
                "</review_survey>"
            )
            ideas_content = await self._generate_text_content(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                trace_id=trace_id,
                system_policy="You are the ideation agent. Produce implementation-ready ideas that are tightly scoped to the topic.",
                upstream_content=ideas_upstream,
                final_task=(
                    "Generate ideas.md from <upstream_reference>. Provide at least 3 executable ideas. "
                    "Each idea must include assumptions, metrics, risk, and how it serves the topic objective."
                ),
                fallback_content=self._fallback_ideas_markdown(
                    language=preferred_language,
                    topic_title=topic_title,
                    topic_description=topic_description,
                    topic_objective=topic_objective,
                ),
                max_tokens=1800,
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="completed",
                progress=1.0,
                summary="ideation completed",
                trace_id=trace_id,
            )

            ideas_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="ideas.md",
                content_type="text/markdown",
                content=ideas_content,
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="ideation produced ideas.md",
                    payload={"handoffTo": "experiment", "artifactRole": "idea"},
                    artifacts=[ideas_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="running",
                progress=0.25,
                summary="experiment running",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="running experiments for idea",
                    payload={"stage": "experiment"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.error,
                    summary="experiment encountered temporary failure, retrying",
                    payload={"errorCode": "SIM_TEMP_FAILURE", "retryable": True},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            fallback_results = {
                "topicId": topic_id,
                "topicTitle": topic_title,
                "runId": run_id,
                "metrics": {"accuracy": 0.78, "f1": 0.74, "robustness": 0.71},
                "notes": (
                    "Temporary issue recovered. Metrics are simulated fallback values "
                    "but remain aligned with the topic objective."
                ),
                "next_actions": [
                    "Scale evaluation set with harder samples",
                    "Add ablation on retrieval and routing components",
                    "Track quality-cost tradeoff in production-like environment",
                ],
            }
            experiment_upstream = (
                f"{topic_anchor}\n\n"
                "<ideas_input>\n"
                f"{ideas_content}\n"
                "</ideas_input>"
            )
            results_content = await self._generate_json_content(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                trace_id=trace_id,
                system_policy="You are the experiment agent. Return strict JSON only.",
                upstream_content=experiment_upstream,
                final_task=(
                    "Generate strict JSON results from <upstream_reference>. Required keys: "
                    "topicId, topicTitle, runId, metrics, notes, next_actions. Ensure metrics align to topic objective."
                ),
                fallback_content=fallback_results,
                max_tokens=1200,
            )
            results_content.setdefault("topicId", topic_id)
            results_content.setdefault("topicTitle", topic_title)
            results_content.setdefault("runId", run_id)
            metrics = results_content.get("metrics")
            if not isinstance(metrics, dict):
                metrics = fallback_results["metrics"]
                results_content["metrics"] = metrics
            if not isinstance(results_content.get("notes"), str):
                results_content["notes"] = fallback_results["notes"]
            next_actions = results_content.get("next_actions")
            if not isinstance(next_actions, list):
                results_content["next_actions"] = fallback_results["next_actions"]

            result_report_content = await self._generate_text_content(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                trace_id=trace_id,
                system_policy="You are the experiment reporting agent. Produce a detailed markdown report grounded in topic context.",
                upstream_content=(
                    f"{topic_anchor}\n\n"
                    "<ideas_input>\n"
                    f"{ideas_content}\n"
                    "</ideas_input>\n\n"
                    "<results_json>\n"
                    f"{json.dumps(results_content, ensure_ascii=False, indent=2)}\n"
                    "</results_json>"
                ),
                final_task=(
                    "Generate result.md from <upstream_reference>. Include setup, observations, metric interpretation, "
                    "risk assessment, and next-step plan. Explicitly tie conclusions to topic objective."
                ),
                fallback_content=self._fallback_result_report_markdown(
                    language=preferred_language,
                    topic_title=topic_title,
                    topic_description=topic_description,
                    topic_objective=topic_objective,
                    metrics=metrics,
                ),
                max_tokens=1800,
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="completed",
                progress=1.0,
                summary="experiment completed",
                trace_id=trace_id,
            )

            results_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="results.json",
                content_type="application/json",
                content=results_content,
            )
            result_report_artifact = await self._create_artifact(
                topic_id=topic_id,
                run_id=run_id,
                name="result.md",
                content_type="text/markdown",
                content=result_report_content,
            )

            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="experiment produced results.json",
                    payload={"handoffTo": "ideation", "artifactRole": "results", "metrics": metrics},
                    artifacts=[results_artifact],
                    trace_id=trace_id,
                )
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.artifact_created,
                    severity=Severity.info,
                    summary="experiment produced result.md",
                    payload={"handoffTo": "ideation", "artifactRole": "result_report"},
                    artifacts=[result_report_artifact],
                    trace_id=trace_id,
                )
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="running",
                progress=0.7,
                summary="ideation refining from experiment feedback",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="refining idea from results",
                    payload={"stage": "feedback"},
                    trace_id=trace_id,
                )
            )
            await asyncio.sleep(self._step_sleep)

            feedback_fallback = self._pick_by_lang(
                preferred_language,
                (
                    "## 反馈计划（回退）\n"
                    f"- 主题：{topic_title}\n"
                    "- 保留：检索增强与置信度路由主路径。\n"
                    "- 调整：增加候选方案多样性和难样本覆盖。\n"
                    "- 验证：补充成本与延迟指标，确保目标对齐。\n"
                ),
                (
                    "## Feedback Plan (Fallback)\n"
                    f"- Topic: {topic_title}\n"
                    "- Keep: retrieval augmentation and confidence routing core path.\n"
                    "- Change: broaden candidate diversity and hard-case coverage.\n"
                    "- Validate: add cost and latency metrics for objective alignment.\n"
                ),
            )
            _ = await self._generate_text_content(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                trace_id=trace_id,
                system_policy="You are the ideation feedback agent. Refine roadmap from experiment outcomes and topic constraints.",
                upstream_content=(
                    f"{topic_anchor}\n\n"
                    "<result_json>\n"
                    f"{json.dumps(results_content, ensure_ascii=False, indent=2)}\n"
                    "</result_json>\n\n"
                    "<result_report>\n"
                    f"{result_report_content}\n"
                    "</result_report>"
                ),
                final_task=(
                    "Generate a concise feedback plan. Explain what to keep, what to change, and what to validate next. "
                    "Every point must tie to the topic objective."
                ),
                fallback_content=feedback_fallback,
                max_tokens=1000,
            )

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.ideation,
                status="completed",
                progress=1.0,
                summary="ideation feedback loop completed",
                trace_id=trace_id,
            )

            await store.update_run_status(topic_id, run_id, "completed")
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.ideation,
                    kind=EventKind.event_emitted,
                    severity=Severity.info,
                    summary="run completed",
                    payload={"phase": "completed"},
                    trace_id=trace_id,
                )
            )
        except Exception as exc:
            logger.exception("Pipeline crashed (topic=%s run=%s)", topic_id, run_id)
            try:
                await store.update_run_status(topic_id, run_id, "failed")
            except Exception:
                return

            await self._update_agent(
                topic_id=topic_id,
                run_id=run_id,
                agent_id=AgentId.experiment,
                status="failed",
                progress=1.0,
                summary="pipeline failed",
                trace_id=trace_id,
            )
            await self._emit(
                build_event(
                    topic_id=topic_id,
                    run_id=run_id,
                    agent_id=AgentId.experiment,
                    kind=EventKind.event_emitted,
                    severity=Severity.error,
                    summary="pipeline crashed",
                    payload=self._error_payload(exc),
                    trace_id=trace_id,
                )
            )


fake_runner = FakePipelineRunner()
