"""
backend_base.py — B1: Abstract LLMBackend interface
====================================================

PURPOSE
-------
Provides a unified abstract base class for all LLM backends used in tensornets.
Currently we have:
  - BedrockBackend  (tensornets/linguistic/bedrock.py)  — AWS Bedrock
  - OllamaBackend   (tensornets/distillation/backends/ollama_local.py)  — local

Without a common interface:
  - comparison_runner.py must branch on backend type
  - judge.py must branch on whether boto3 is available
  - Tests cannot mock the LLM cleanly

With LLMBackend:
  - Any backend can be swapped by passing a different instance
  - Mock backend (MockLLMBackend) enables offline testing with zero network calls
  - JS Python overlap is reduced: backend selection logic lives here, not scattered

JS / PYTHON OVERLAP (the user's concern)
-----------------------------------------
The overlap is NOT that the same code runs twice. It is that:
  1. Bedrock call pattern (prompt → response → parse) exists in BOTH:
     - agents/api/providers/llama.js  (JS side)
     - tensornets/linguistic/bedrock.py (Python side)
  2. Stress label logic exists in BOTH:
     - companions/physio/state.js  stress_index(), stressLabel()
     - tensornets/physio/state.py  PhysiologicalState.stress_index()

WHY THIS IS ACCEPTABLE (for now)
---------------------------------
The JS side is the PRODUCTION inference path (user messages → companion response).
The Python side is the RESEARCH/TRAINING path (simulation, benchmarking, MCTS).
They MUST run in different runtimes (Node.js vs Python) so the code cannot be shared.

WHAT WE CAN DO TO REDUCE DRIFT
--------------------------------
1. The FastAPI server is the single source of truth for physiological computations.
   The JS side calls /physio/state rather than recomputing.
   [Current status: tensornetsBridge.js already does this — DONE]

2. Bedrock credentials and model IDs are shared via environment variables,
   not hardcoded in both files. Already true.

3. Stress label thresholds are defined in STRESS_THRESHOLDS / HRV_THRESHOLDS (this file).
   The FastAPI server exposes them at GET /physio/thresholds (server.py, done).
   JS reads them at startup via tensornetsBridge.loadThresholds().

4. Action selector logic (action_selector.js) delegates MCTS to the Python
   server via getMCTSAction(). The JS does not reimplement MCTS.
   [DONE in this session]

This file is the CANONICAL definition of backend behaviour.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Response schema
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LLMResponse:
    """
    Standardised response from any LLM backend.
    All backends must return this structure.
    """
    text: str                   # generated text
    model_id: str               # which model produced this
    input_tokens: int = 0
    output_tokens: int = 0
    temperature: float = 0.7
    backend_name: str = ""

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def cost_usd_estimate(self) -> float:
        """
        Rough cost estimate (USD).
        Uses Bedrock on-demand pricing for Scout as default.
        Override per backend if needed.
        """
        # Scout: $0.00017 / 1K tokens (input+output combined)
        return self.total_tokens * 0.00017 / 1000


# ─────────────────────────────────────────────────────────────────────────────
# Abstract base
# ─────────────────────────────────────────────────────────────────────────────

class LLMBackend(ABC):
    """
    Abstract base class for all LLM backends.

    Concrete implementations:
      BedrockBackend  — AWS Bedrock Converse API (boto3)
      OllamaBackend   — local Ollama REST API
      MockLLMBackend  — deterministic mock for testing (this file)

    Usage
    -----
    backend = BedrockBackend(model_id=LLAMA4_SCOUT)
    response = backend.generate("What is HRV?", temperature=0.7, max_tokens=200)
    print(response.text)

    Multi-candidate generation (for MCTS)
    --------------------------------------
    candidates = backend.generate_candidates(
        prompt=system_prompt,
        user_message=patient_utterance,
        temperatures=[0.1, 0.5, 0.9, 1.0],
        max_tokens=120,
    )
    # Returns list[LLMResponse], one per temperature
    """

    @property
    @abstractmethod
    def backend_name(self) -> str:
        """Human-readable name (e.g., 'bedrock-scout', 'ollama-mistral')."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        """
        Generate a single response.

        Parameters
        ----------
        prompt : str
            The user message / query.
        temperature : float
            Sampling temperature [0.0, 1.0].
        max_tokens : int
            Maximum output tokens.
        system_prompt : str, optional
            System instruction prepended to the conversation.

        Returns
        -------
        LLMResponse
        """

    def generate_candidates(
        self,
        prompt: str,
        temperatures: list[float] | None = None,
        max_tokens: int = 120,
        system_prompt: str | None = None,
        role_suffixes: list[str] | None = None,
    ) -> list[LLMResponse]:
        """
        Generate N diverse candidates at different temperatures.

        This is the standard interface for E-006b style candidate generation.
        Default temperatures: [0.1, 0.5, 0.9, 1.0] (conservative → aggressive).

        role_suffixes: optional list of per-candidate style instructions appended
                       to the system prompt. Length must match temperatures.

        Returns list[LLMResponse], one per temperature.
        """
        temps   = temperatures or [0.1, 0.5, 0.9, 1.0]
        suffixes = role_suffixes or [''] * len(temps)
        if len(suffixes) < len(temps):
            suffixes = suffixes + [''] * (len(temps) - len(suffixes))

        results = []
        for temp, suffix in zip(temps, suffixes):
            full_system = ((system_prompt or '') + (f'\n\n{suffix}' if suffix else '')).strip()
            response = self.generate(
                prompt=prompt,
                temperature=temp,
                max_tokens=max_tokens,
                system_prompt=full_system or None,
            )
            results.append(response)
        return results

    def is_available(self) -> bool:
        """
        Check if the backend is reachable. Overrideable for lazy init.
        Default: always returns True (assumes availability on import).
        """
        return True

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(backend_name={self.backend_name!r})"


# ─────────────────────────────────────────────────────────────────────────────
# Mock backend (for offline testing / CI)
# ─────────────────────────────────────────────────────────────────────────────

class MockLLMBackend(LLMBackend):
    """
    Deterministic mock backend for unit tests.

    Returns pre-configured responses keyed by prompt substrings.
    Falls back to a generic response.

    Usage in tests
    --------------
    backend = MockLLMBackend(responses={
        "appeal": "Your appeal has a strong basis. File within 30 days.",
        "anxiety": "Stay with the image. This is the exposure moment.",
    })
    assert "appeal" in backend.generate("Tell me about my insurance appeal").text
    """

    def __init__(
        self,
        responses: dict[str, str] | None = None,
        default_response: str = "I understand. Can you tell me more?",
    ):
        self._responses = responses or {}
        self._default = default_response
        self._call_log: list[dict] = []

    @property
    def backend_name(self) -> str:
        return "mock"

    def generate(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 512,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        # Match prompt to configured responses
        text = self._default
        prompt_lower = prompt.lower()
        for key, response in self._responses.items():
            if key.lower() in prompt_lower:
                text = response
                break

        # Log call for assertion in tests
        self._call_log.append({
            'prompt': prompt[:100],
            'temperature': temperature,
            'system_prompt': (system_prompt or '')[:80],
        })

        return LLMResponse(
            text=text,
            model_id='mock',
            input_tokens=len(prompt.split()),
            output_tokens=len(text.split()),
            temperature=temperature,
            backend_name='mock',
        )

    @property
    def call_count(self) -> int:
        return len(self._call_log)

    @property
    def last_call(self) -> dict | None:
        return self._call_log[-1] if self._call_log else None


# ─────────────────────────────────────────────────────────────────────────────
# Shared physiological thresholds
# (canonical definition — JS reads these from /physio/thresholds endpoint)
# ─────────────────────────────────────────────────────────────────────────────

STRESS_THRESHOLDS = {
    # stress_index → label
    'critical':        0.75,   # HRV < ~15ms equivalent
    'high_stress':     0.55,   # HRV < ~25ms
    'moderate_stress': 0.35,   # HRV < ~38ms
    'low_stress':      0.0,
}

HRV_THRESHOLDS = {
    # HRV (ms) → label
    'critical':        15,
    'high_stress':     25,
    'moderate_stress': 40,
}


# ─────────────────────────────────────────────────────────────────────────────
# Concrete backends that implement LLMBackend
# ─────────────────────────────────────────────────────────────────────────────

class BedrockLLMBackend(LLMBackend):
    """
    LLMBackend adapter for BedrockBackend (tensornets/linguistic/bedrock.py).

    This is the real backend used in production and comparison_runner.py.
    MockLLMBackend is for unit tests only.

    Default model: Llama 4 Scout (fast, cost-efficient for real-time dialogue).
    For judging / diversity: use Maverick.

    Usage
    -----
    backend = BedrockLLMBackend()                          # Scout
    backend = BedrockLLMBackend(model_id=LLAMA4_MAVERICK)  # Maverick
    r = backend.generate("Explain HRV in one sentence.")
    candidates = backend.generate_candidates(
        prompt=system_prompt, user_message=patient_turn,
        temperatures=[0.1, 0.5, 0.9, 1.0],
    )
    """

    def __init__(self, model_id: str | None = None, region: str = "us-east-1"):
        try:
            from tensornets.linguistic.bedrock import (
                BedrockBackend, BedrockConfig,
                LLAMA4_SCOUT, LLAMA4_MAVERICK,
            )
            self._inner = BedrockBackend(
                model_id=model_id or LLAMA4_SCOUT,
                region=region,
            )
            self._BedrockConfig = BedrockConfig
            self._model_id = model_id or LLAMA4_SCOUT
        except ImportError as e:
            raise ImportError(
                f"BedrockLLMBackend requires boto3 and tensornets.linguistic.bedrock. "
                f"Install with: pip install boto3. Error: {e}"
            )

    @property
    def backend_name(self) -> str:
        return f"bedrock-{self._model_id.split('.')[-1].split(':')[0]}"

    def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 512,
        **_,
    ) -> LLMResponse:
        cfg = self._BedrockConfig(
            max_tokens=max_tokens,
            temperature=min(temperature, 1.0),  # Bedrock cap is 1.0
            system=system_prompt or "",
        )
        resp = self._inner.generate(prompt, cfg)
        return LLMResponse(
            text=resp.content,
            model_id=resp.model_id,
            input_tokens=resp.input_tokens,
            output_tokens=resp.output_tokens,
            temperature=temperature,
            backend_name=self.backend_name,
        )


def get_default_backend(model_key: str = "scout") -> LLMBackend:
    """
    Return the appropriate LLM backend for a given model key.
    Raises ImportError if Bedrock is unavailable — do not silently fall back
    to MockLLMBackend in production. Use MockLLMBackend explicitly in tests.

    model_key: 'scout' | 'maverick' | '70b'

    Guidance:
      'scout'    — real-time dialogue turns, action selection (low latency)
      'maverick' — feedback scoring, judge turns, prompt iteration (higher quality)
      '70b'      — fallback when Maverick quota is exhausted
    """
    from tensornets.linguistic.bedrock import (
        LLAMA4_SCOUT, LLAMA4_MAVERICK, LLAMA3_70B,
    )
    model_map = {
        "scout":    LLAMA4_SCOUT,
        "maverick": LLAMA4_MAVERICK,
        "70b":      LLAMA3_70B,
    }
    if model_key not in model_map:
        raise ValueError(
            f"Unknown model_key={model_key!r}. Use one of {list(model_map)}. "
            "For tests, use MockLLMBackend() directly."
        )
    return BedrockLLMBackend(model_id=model_map[model_key])


if __name__ == "__main__":
    print("B1: LLMBackend abstract interface — smoke test")
    mock = MockLLMBackend(responses={
        'flooding': "Stay with the image. This is the moment of habituation.",
        'appeal': "Your appeal has a strong basis.",
    })
    r1 = mock.generate("Tell me about flooding therapy")
    r2 = mock.generate("How do I file an insurance appeal?")
    r3 = mock.generate("What is HRV?")

    print(f"  Call 1: '{r1.text[:60]}'")
    print(f"  Call 2: '{r2.text[:60]}'")
    print(f"  Call 3 (default): '{r3.text[:60]}'")
    print(f"  Call count: {mock.call_count}")

    # Multi-candidate
    candidates = mock.generate_candidates(
        prompt="flooding therapy scenario",
        temperatures=[0.1, 0.5, 0.9, 1.0],
    )
    print(f"  Candidates generated: {len(candidates)}")
    assert len(candidates) == 4
    print("B1 smoke test PASSED")
