"""
Ollama local backend for the HTN linguistic engine.

Wraps the Ollama REST API (http://localhost:11434) for use with any model
pulled locally — currently Mistral 7B.

This backend serves two purposes:
1. Linguistic engine: generate fluent responses (what Ollama is good at)
2. Logit extraction: get per-token log-probabilities for constraint projection

Note on activation extraction
------------------------------
Ollama serves GGUF-quantized models via llama.cpp. It does NOT expose
intermediate layer hidden states. This backend is for inference only.
For activation extraction (Track D), an EC2 job with HuggingFace is required.

Ollama API reference: https://github.com/ollama/ollama/blob/main/docs/api.md
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Iterator, Optional
from urllib import request, error as urllib_error

import torch


OLLAMA_BASE_URL   = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_MODEL     = "mistral:latest"
DEFAULT_TIMEOUT_S = 120


# ── Response dataclasses ───────────────────────────────────────────────────────

@dataclass
class OllamaResponse:
    model: str
    content: str
    prompt_tokens: int
    completion_tokens: int
    total_duration_ms: float
    logprobs: Optional[dict] = None  # populated when logprobs=True


@dataclass
class GenerationConfig:
    """
    Sampling configuration passed to Ollama.

    temperature : float
        Sampling temperature. 0.0 = deterministic (greedy).
        For constraint projection tests, use 0.0 to make outputs reproducible.
    top_p : float
        Nucleus sampling threshold.
    top_k : int
        Top-k sampling cutoff.
    num_predict : int
        Maximum tokens to generate. -1 = unlimited (model default).
    num_ctx : int
        Context window size. Mistral 7B default is 8192.
    logprobs : bool
        Whether to request per-token log-probabilities from Ollama.
        Requires Ollama ≥ 0.1.33. Not all builds support this.
    seed : int
        Random seed. -1 = random. Set for reproducible benchmarks.
    """
    temperature: float = 0.7
    top_p: float = 0.9
    top_k: int = 40
    num_predict: int = 256
    num_ctx: int = 8192
    logprobs: bool = False
    seed: int = -1


# ── Backend ────────────────────────────────────────────────────────────────────

class OllamaLocalBackend:
    """
    Inference backend wrapping the Ollama REST API.

    Usage
    -----
    >>> backend = OllamaLocalBackend()
    >>> response = backend.generate("Explain HRV to a patient in one sentence.")
    >>> print(response.content)
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        base_url: str = OLLAMA_BASE_URL,
        timeout_s: int = DEFAULT_TIMEOUT_S,
    ) -> None:
        self.model    = model
        self.base_url = base_url.rstrip("/")
        self.timeout  = timeout_s

    # ── Health check ──────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """Return True if the Ollama server is reachable."""
        try:
            req = request.Request(f"{self.base_url}/api/tags")
            with request.urlopen(req, timeout=5):
                return True
        except Exception:
            return False

    def list_models(self) -> list[str]:
        """Return names of locally available models."""
        req = request.Request(f"{self.base_url}/api/tags")
        with request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return [m["name"] for m in data.get("models", [])]

    # ── Inference ─────────────────────────────────────────────────────────────

    def generate(
        self,
        prompt: str,
        system: str = "",
        config: GenerationConfig | None = None,
    ) -> OllamaResponse:
        """
        Generate a completion for the given prompt.

        Parameters
        ----------
        prompt : str
            User message / prompt text.
        system : str
            Optional system prompt (injected as Ollama 'system' field).
        config : GenerationConfig
            Sampling parameters. Uses defaults if None.

        Returns
        -------
        OllamaResponse
            Contains the generated text and token counts.
        """
        if config is None:
            config = GenerationConfig()

        payload = self._build_payload(prompt, system, config, stream=False)
        t0 = time.perf_counter()
        raw = self._post("/api/generate", payload)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        return OllamaResponse(
            model=raw.get("model", self.model),
            content=raw.get("response", ""),
            prompt_tokens=raw.get("prompt_eval_count", 0),
            completion_tokens=raw.get("eval_count", 0),
            total_duration_ms=elapsed_ms,
            logprobs=raw.get("logprobs"),
        )

    def generate_stream(
        self,
        prompt: str,
        system: str = "",
        config: GenerationConfig | None = None,
    ) -> Iterator[str]:
        """
        Stream token-by-token generation. Yields each token string as it arrives.
        Useful for real-time display during demonstrations.
        """
        if config is None:
            config = GenerationConfig()

        payload = self._build_payload(prompt, system, config, stream=True)
        url = f"{self.base_url}/api/generate"
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=self.timeout) as resp:
            for line in resp:
                line = line.strip()
                if not line:
                    continue
                chunk = json.loads(line)
                token = chunk.get("response", "")
                if token:
                    yield token
                if chunk.get("done"):
                    break

    def generate_with_logprobs(
        self,
        prompt: str,
        system: str = "",
        config: GenerationConfig | None = None,
    ) -> tuple[str, torch.Tensor | None]:
        """
        Generate text and attempt to return per-token log-probabilities.

        Ollama returns logprobs only for the generated tokens, not the full
        vocabulary distribution. The returned tensor has shape [n_tokens]
        where each value is the log-probability of the token that was sampled.

        For full vocabulary logits needed by project_constraint(), this is
        insufficient — you need the raw logit vector over all vocab tokens.
        That requires HuggingFace access, not Ollama.

        Returns
        -------
        (text, logprob_tensor)
            text: generated string
            logprob_tensor: Tensor[n_tokens] or None if not supported
        """
        cfg = config or GenerationConfig(logprobs=True)
        cfg.logprobs = True
        response = self.generate(prompt, system, cfg)

        logprobs = None
        if response.logprobs is not None:
            try:
                lp_list = response.logprobs.get("token_logprobs", [])
                if lp_list:
                    logprobs = torch.tensor(lp_list, dtype=torch.float32)
            except Exception:
                pass

        return response.content, logprobs

    # ── Chat format ───────────────────────────────────────────────────────────

    def chat(
        self,
        messages: list[dict],
        config: GenerationConfig | None = None,
    ) -> OllamaResponse:
        """
        Chat completion using the /api/chat endpoint.

        Parameters
        ----------
        messages : list[dict]
            OpenAI-compatible message list:
            [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]
        """
        if config is None:
            config = GenerationConfig()

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": self._options_dict(config),
        }
        t0 = time.perf_counter()
        raw = self._post("/api/chat", payload)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        content = ""
        msg = raw.get("message", {})
        if isinstance(msg, dict):
            content = msg.get("content", "")

        return OllamaResponse(
            model=raw.get("model", self.model),
            content=content,
            prompt_tokens=raw.get("prompt_eval_count", 0),
            completion_tokens=raw.get("eval_count", 0),
            total_duration_ms=elapsed_ms,
        )

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _build_payload(
        self,
        prompt: str,
        system: str,
        config: GenerationConfig,
        stream: bool,
    ) -> dict:
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": stream,
            "options": self._options_dict(config),
        }
        if system:
            payload["system"] = system
        if config.logprobs:
            payload["options"]["logprobs"] = True
        return payload

    @staticmethod
    def _options_dict(config: GenerationConfig) -> dict:
        opts: dict = {
            "temperature": config.temperature,
            "top_p": config.top_p,
            "top_k": config.top_k,
            "num_predict": config.num_predict,
            "num_ctx": config.num_ctx,
        }
        if config.seed >= 0:
            opts["seed"] = config.seed
        return opts

    def _post(self, path: str, payload: dict) -> dict:
        url  = f"{self.base_url}{path}"
        body = json.dumps(payload).encode("utf-8")
        req  = request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read())
        except urllib_error.URLError as exc:
            raise ConnectionError(
                f"Ollama server unreachable at {self.base_url}. "
                f"Is `ollama serve` running? Error: {exc}"
            ) from exc

    def __repr__(self) -> str:
        status = "available" if self.is_available() else "unreachable"
        return f"OllamaLocalBackend(model={self.model!r}, server={status})"
