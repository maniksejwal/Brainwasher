"""
AWS Bedrock inference backend for the HTN linguistic engine.

Uses the Bedrock Converse API with cross-region inference profiles.
Direct model IDs require reserved throughput; inference profiles
(prefixed us.) work with on-demand throughput.

Model roster (all confirmed working):
    us.meta.llama4-scout-17b-instruct-v1:0    — primary (fast, cost-efficient)
    us.meta.llama4-maverick-17b-instruct-v1:0 — larger Llama 4 MoE
    us.meta.llama3-3-70b-instruct-v1:0        — Llama 3.3 70B fallback
    mistral.mistral-large-3-675b-instruct     — largest available (675B)
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterator, Optional

import boto3
from botocore.exceptions import ClientError


# ── Model registry ─────────────────────────────────────────────────────────────
# All IDs confirmed working with on-demand throughput as of May 2026.

LLAMA4_SCOUT    = "us.meta.llama4-scout-17b-instruct-v1:0"
LLAMA4_MAVERICK = "us.meta.llama4-maverick-17b-instruct-v1:0"
LLAMA3_70B      = "us.meta.llama3-3-70b-instruct-v1:0"
MISTRAL_675B    = "mistral.mistral-large-3-675b-instruct"

# Default: Llama 4 Scout — best latency/quality trade-off for real-time dialogue
DEFAULT_MODEL = LLAMA4_SCOUT

FALLBACK_ORDER = [LLAMA4_SCOUT, LLAMA4_MAVERICK, LLAMA3_70B, MISTRAL_675B]


@dataclass
class BedrockResponse:
    model_id: str
    content: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    stop_reason: str = "end_turn"


@dataclass
class BedrockConfig:
    max_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.9
    system: str = ""


class BedrockBackend:
    """
    Bedrock inference backend using the Converse API.

    Usage
    -----
    >>> backend = BedrockBackend()
    >>> resp = backend.generate("Explain HRV to a patient in one sentence.")
    >>> print(resp.content)
    """

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        region: str = "us-east-1",
    ) -> None:
        self.model_id = model_id
        self.region   = region
        self._client  = boto3.client("bedrock-runtime", region_name=region)

    # ── Core inference ─────────────────────────────────────────────────────────

    def generate(
        self,
        prompt: str,
        config: BedrockConfig | None = None,
    ) -> BedrockResponse:
        """Single-turn generation."""
        cfg = config or BedrockConfig()
        messages = [{"role": "user", "content": [{"text": prompt}]}]
        return self._converse(messages, cfg)

    def chat(
        self,
        messages: list[dict],
        config: BedrockConfig | None = None,
    ) -> BedrockResponse:
        """
        Multi-turn chat. messages is a list of dicts:
            [{"role": "user"|"assistant", "content": "text"}]
        """
        cfg = config or BedrockConfig()
        bedrock_messages = [
            {"role": m["role"], "content": [{"text": m["content"]}]}
            for m in messages
        ]
        return self._converse(bedrock_messages, cfg)

    def stream(
        self,
        prompt: str,
        config: BedrockConfig | None = None,
    ) -> Iterator[str]:
        """
        Stream token-by-token output. Yields text chunks as they arrive.
        Uses Converse stream API for sub-200ms time-to-first-token.
        """
        cfg = config or BedrockConfig()
        messages = [{"role": "user", "content": [{"text": prompt}]}]
        kwargs = self._build_kwargs(messages, cfg)

        resp = self._client.converse_stream(**kwargs)
        for event in resp["stream"]:
            if "contentBlockDelta" in event:
                delta = event["contentBlockDelta"]["delta"]
                if "text" in delta:
                    yield delta["text"]

    # ── Auto-fallback ──────────────────────────────────────────────────────────

    def generate_with_fallback(
        self,
        prompt: str,
        config: BedrockConfig | None = None,
    ) -> BedrockResponse:
        """
        Try models in FALLBACK_ORDER until one succeeds.
        Returns the first successful response with the model_id that worked.
        """
        cfg = config or BedrockConfig()
        last_err = None
        for model_id in FALLBACK_ORDER:
            try:
                original = self.model_id
                self.model_id = model_id
                resp = self.generate(prompt, cfg)
                self.model_id = original
                return resp
            except ClientError as e:
                last_err = e
                self.model_id = model_id  # reset on error too
        raise RuntimeError(
            f"All Bedrock models failed. Last error: {last_err}"
        )

    # ── Health check ───────────────────────────────────────────────────────────

    def ping(self) -> bool:
        """Return True if the model is reachable with a minimal call."""
        try:
            resp = self.generate("OK", BedrockConfig(max_tokens=3, temperature=0.0))
            return len(resp.content) > 0
        except Exception:
            return False

    @staticmethod
    def list_working_models(region: str = "us-east-1") -> list[str]:
        """Test all known models and return the IDs that respond successfully."""
        client  = boto3.client("bedrock-runtime", region_name=region)
        working = []
        for model_id in FALLBACK_ORDER:
            try:
                client.converse(
                    modelId=model_id,
                    messages=[{"role": "user", "content": [{"text": "OK"}]}],
                    inferenceConfig={"maxTokens": 3},
                )
                working.append(model_id)
            except Exception:
                pass
        return working

    # ── Internal ───────────────────────────────────────────────────────────────

    def _converse(
        self,
        messages: list[dict],
        cfg: BedrockConfig,
    ) -> BedrockResponse:
        kwargs = self._build_kwargs(messages, cfg)
        t0  = time.perf_counter()
        raw = self._client.converse(**kwargs)
        ms  = (time.perf_counter() - t0) * 1000.0

        content = raw["output"]["message"]["content"][0]["text"]
        usage   = raw.get("usage", {})
        return BedrockResponse(
            model_id=self.model_id,
            content=content,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
            latency_ms=ms,
            stop_reason=raw.get("stopReason", "end_turn"),
        )

    def _build_kwargs(self, messages: list[dict], cfg: BedrockConfig) -> dict:
        kwargs: dict = {
            "modelId": self.model_id,
            "messages": messages,
            "inferenceConfig": {
                "maxTokens": cfg.max_tokens,
                "temperature": cfg.temperature,
                "topP": cfg.top_p,
            },
        }
        if cfg.system:
            kwargs["system"] = [{"text": cfg.system}]
        return kwargs

    def __repr__(self) -> str:
        status = "reachable" if self.ping() else "unreachable"
        return f"BedrockBackend(model={self.model_id!r}, {status})"
