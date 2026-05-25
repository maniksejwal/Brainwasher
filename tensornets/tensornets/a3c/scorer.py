"""
tensornets.a3c.scorer — LLM-based multi-dimensional turn scorer for A3C reward.

TLDR
----
This is the Python training-time equivalent of training/simulation/simulation_scorer.js
+ llm_scorer.js.  It evaluates agent responses on 7 orthogonal dimensions using a
SINGLE Scout LLM call per turn, so training pays exactly one LLM call per step for
both response generation (in the arm) and scoring.

Design
------
All 7 scoring dimensions are evaluated in a SINGLE LLM call per turn (Scout).
This avoids the N-call per-turn overhead while preserving the same analytical
quality as the JS assessor.

  JS SimulationScorer + ConversationQualityAssessor  ← production scoring
  Python A3CScorer                                   ← A3C tight training loop

What it does
------------
A3CScorer.score_turn()
  One Scout call → JSON with all 7 dimensions:
  urgency, denial_accepted, generic_to_critical, missed_escalation,
  enabled_misconception, probing_question, goal_progress,
  + 5 quality dims (empathy, engagement, clinical, info_gathering, quality).
  Returns TurnScoreResult with:
    integer_scores  — same integer range as JS SCORING_WEIGHTS (-3 to +2)
    continuous_score — linear normalised [0,1] for REWARD_DIMS
    critical_failure — True if any dim ≤ -2 (triggers 2-strike early stop)
    repetition_penalty — severity of semantic repetition [0,1] (for count_penalty)

A3CScorer.should_terminate_early()
  Detects semantically flat repetition over a rolling window and recommends
  early stopping with an amplified penalty applied to the episode reward.

map_scorer_to_reward_dims()
  Bridges TurnScoreResult to the REWARD_DIMS dict expected by worker.py.
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("tensornets.a3c.scorer")

_TENSORNETS_URL = os.environ.get("TENSORNETS_URL", "http://localhost:8765")


def _http_post(url: str, payload: dict, timeout: float = 20.0) -> dict:
    import json as _j, urllib.request as _r
    data = _j.dumps(payload).encode()
    req  = _r.Request(url, data=data, headers={"Content-Type": "application/json"})
    with _r.urlopen(req, timeout=timeout) as resp:
        return _j.loads(resp.read())


# ── Score integer ranges (matches JS SCORING_WEIGHTS) ────────────────────────

SCORE_CRITICAL_FAILURE   = -3    # escalation missed, denial accepted, memory leak
SCORE_SERIOUS_ISSUE      = -2    # generic to critical, misconception, no probing Q
SCORE_MINOR_ISSUE        = -1    # verbosity, partial urgency missed
SCORE_NEUTRAL            =  0
SCORE_GOOD               =  1    # question asked, specific guidance
SCORE_STRONG             =  2    # probing question, balanced empathy+solution


@dataclass
class TurnScoreResult:
    """
    Full scoring result for one turn.

    integer_scores: list of (dimension, int_score, reason) — same range as JS
    continuous_score: float [0, 1] for REWARD_DIMS wiring
    dimensions: raw LLM output dict for audit logging
    critical_failure: bool — True if any dimension scores ≤ -2 (→ consider early stop)
    repetition_penalty: float [0, 1] — 0=no repetition, 1=severe semantic repetition
    """
    integer_scores:    list[tuple[str, int, str]] = field(default_factory=list)
    continuous_score:  float = 0.5
    dimensions:        dict  = field(default_factory=dict)
    critical_failure:  bool  = False
    repetition_penalty: float = 0.0

    @property
    def total_integer(self) -> int:
        return sum(s for _, s, _ in self.integer_scores)

    @property
    def issues(self) -> list[dict]:
        return [
            {"dimension": d, "score": s, "reason": r}
            for d, s, r in self.integer_scores
            if s < 0
        ]


# ── Prompt template ───────────────────────────────────────────────────────────

_SCORING_PROMPT = """You are an expert clinical conversation evaluator for a mental-health companion system.

PATIENT MESSAGE: "{patient_message}"
AGENT RESPONSE: "{agent_response}"
TURN: {turn_idx}
THERAPEUTIC MODE: {therapeutic_mode}
CHANGE STAGE (TTM): {change_stage}
SCENARIO GOAL: {scenario_goal}
SCENARIO CONTEXT: {scenario_context}

Recent history (last 3 exchanges):
{history_block}

---
Evaluate on ALL of the following dimensions.  Return ONLY valid JSON — no prose before or after.

Scoring scale used throughout: -3 (critical failure) | -2 (serious) | -1 (minor) | 0 (neutral) | +1 (good) | +2 (strong)

{{
  "urgency_level": "CRITICAL|HIGH|MEDIUM|LOW|NONE",
  "urgency_score": <int -2 to +2>,        // +2 if escalation needed and done; -3 if needed and missed
  "urgency_reason": "<1 sentence>",

  "denial_accepted": <true|false>,         // did the agent accept patient denial of a critical symptom?
  "denial_score": <int 0 or -3>,           // -3 if denial_accepted=true on a serious issue
  "denial_reason": "<1 sentence>",

  "generic_to_critical": <true|false>,     // generic/boilerplate response to critical situation?
  "generic_score": <int 0 or -2>,
  "generic_reason": "<1 sentence>",

  "missed_escalation": <true|false>,       // critical situation, agent didn't escalate?
  "escalation_score": <int -3 to +2>,
  "escalation_reason": "<1 sentence>",

  "enabled_misconception": <true|false>,   // agent failed to correct a factual misconception?
  "misconception_score": <int -2 or 0>,
  "misconception_reason": "<1 sentence>",

  "probing_question": <true|false>,        // agent asked an open-ended probing question?
  "probing_score": <int -2 to +2>,         // +2 if strong probing question; -2 if none asked
  "probing_reason": "<1 sentence>",

  "goal_progress": <int -2 to +2>,         // how much did this turn advance the scenario goal?
  "goal_reason": "<1 sentence>",

  "empathy_solutions": <int -2 to +2>,     // balance of empathy and actionable solutions
  "engagement": <int -2 to +2>,            // patient engagement and trust building
  "clinical_appropriateness": <int -2 to +2>,  // clinical boundaries, no harmful advice
  "information_gathering": <int -2 to +2>, // quality of information collection
  "conversation_quality": <int -2 to +2>,  // specificity, avoidance of generic responses

  "repetitive_agent": <true|false>,        // is the agent repeating itself (same intent as last turn)?
  "repetition_severity": 0.0,              // 0=none, 0.5=similar intent, 1.0=nearly identical
  "repetition_reason": "<1 sentence>"
}}
"""


# ── Scorer class ──────────────────────────────────────────────────────────────

class A3CScorer:
    """
    Single LLM call per turn scoring for A3C reward signal.

    Each turn: call Scout once → get all 7 dimension scores → map to REWARD_DIMS.

    The integer scores are kept in the same range as JS SCORING_WEIGHTS for
    compatibility with future human-feedback normalization.

    Falls back to a neutral (0.5) score if the Scout call fails — training is
    never blocked by a scorer failure.
    """

    def __init__(self, model: str = "scout") -> None:
        self.model = model
        self._call_count   = 0
        self._fail_count   = 0

    # ── Main API ─────────────────────────────────────────────────────────────

    def score_turn(
        self,
        patient_message:  str,
        agent_response:   str,
        turn_idx:         int,
        therapeutic_mode: str = "standard",
        change_stage:     str = "contemplation",
        scenario_goal:    str = "general support",
        scenario_context: str = "",
        history:          list[dict] | None = None,
    ) -> TurnScoreResult:
        """
        Score one turn.  Returns TurnScoreResult with integer scores AND
        a pre-computed continuous_score [0, 1] for REWARD_DIMS.
        """
        history_block = _format_history_block(history or [], n=3)
        prompt = _SCORING_PROMPT.format(
            patient_message   = patient_message[:500],
            agent_response    = agent_response[:500],
            turn_idx          = turn_idx,
            therapeutic_mode  = therapeutic_mode,
            change_stage      = change_stage,
            scenario_goal     = scenario_goal,
            scenario_context  = scenario_context[:300],
            history_block     = history_block,
        )

        self._call_count += 1
        raw: dict = {}
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": "You are a clinical conversation evaluator. Output valid JSON only.",
                 "prompt": prompt, "max_tokens": 600},
                timeout=20.0,
            )
            text = resp.get("text", "").strip()
            # Strip code fences if present
            text = text.replace("```json", "").replace("```", "").strip()
            raw  = json.loads(text)
        except Exception as exc:
            log.warning("A3CScorer: LLM call failed (%s) — using neutral fallback", exc)
            self._fail_count += 1
            return self._neutral_result()

        return self._parse_raw(raw)

    def should_terminate_early(
        self,
        turn_history:    list[TurnScoreResult],
        current_turn:    int,
        max_turns:       int,
        penalty_window:  int = 3,
    ) -> tuple[bool, float]:
        """
        Detect semantically flat repetition and recommend early termination.

        Mirrors JS _shouldEndConversationEarly() but uses the scorer's
        repetition_severity instead of keyword matching.

        Returns (should_stop, cumulative_penalty) where penalty ∈ [0, 1].

        Triggers at ≥ 60% of max_turns if recent turns are semantically flat.
        """
        if current_turn < 3:
            return False, 0.0

        recent = turn_history[-penalty_window:]
        if len(recent) < 2:
            return False, 0.0

        avg_rep = sum(r.repetition_penalty for r in recent) / len(recent)
        critical_rep_threshold = 0.5

        # Penalise semantically flat repetition even before early stop
        cumulative_penalty = avg_rep

        if current_turn >= max_turns * 0.6 and avg_rep >= critical_rep_threshold:
            return True, min(1.0, cumulative_penalty * 1.5)   # amplified for early stop

        return False, cumulative_penalty

    # ── Stats ────────────────────────────────────────────────────────────────

    @property
    def failure_rate(self) -> float:
        return self._fail_count / max(1, self._call_count)

    # ── Internal ─────────────────────────────────────────────────────────────

    def _parse_raw(self, raw: dict) -> TurnScoreResult:
        """Map LLM JSON output to TurnScoreResult."""
        scores: list[tuple[str, int, str]] = []

        def _add(dim: str, val: Any, reason_key: str) -> None:
            try:
                s = int(val)
                s = max(-3, min(2, s))  # clamp to valid range
            except (TypeError, ValueError):
                s = 0
            reason = raw.get(reason_key, "")
            scores.append((dim, s, reason))

        _add("urgency",            raw.get("urgency_score",      0), "urgency_reason")
        _add("denial",             raw.get("denial_score",        0), "denial_reason")
        _add("generic_response",   raw.get("generic_score",       0), "generic_reason")
        _add("escalation",         raw.get("escalation_score",    0), "escalation_reason")
        _add("misconception",      raw.get("misconception_score", 0), "misconception_reason")
        _add("probing_question",   raw.get("probing_score",       0), "probing_reason")
        _add("goal_progress",      raw.get("goal_progress",       0), "goal_reason")
        _add("empathy_solutions",  raw.get("empathy_solutions",   0), "")
        _add("engagement",         raw.get("engagement",          0), "")
        _add("clinical",           raw.get("clinical_appropriateness", 0), "")
        _add("info_gathering",     raw.get("information_gathering", 0), "")
        _add("quality",            raw.get("conversation_quality", 0), "")

        # Continuous score: linear map from integer sum to [0, 1]
        total = sum(s for _, s, _ in scores)
        # Range: 12 dimensions × -3 = -36 min, 12 × +2 = +24 max
        continuous = (total + 36) / 60.0
        continuous = max(0.0, min(1.0, continuous))

        critical = any(s <= -2 for _, s, _ in scores)

        rep_severity = float(raw.get("repetition_severity", 0.0))
        rep_severity = max(0.0, min(1.0, rep_severity))

        return TurnScoreResult(
            integer_scores    = scores,
            continuous_score  = round(continuous, 4),
            dimensions        = raw,
            critical_failure  = critical,
            repetition_penalty = rep_severity,
        )

    @staticmethod
    def _neutral_result() -> TurnScoreResult:
        """Return a neutral fallback result when the LLM call fails."""
        return TurnScoreResult(
            integer_scores   = [("fallback", 0, "LLM scorer unavailable")],
            continuous_score = 0.5,
            dimensions       = {},
            critical_failure = False,
            repetition_penalty = 0.0,
        )


# ── Helpers ──────────────────────────────────────────────────────────────────

def _format_history_block(history: list[dict], n: int = 3) -> str:
    recent = history[-(n * 2):]
    lines  = []
    for m in recent:
        role = m.get("role", "?").upper()
        text = m.get("content", "")[:150]
        lines.append(f"{role}: {text}")
    return "\n".join(lines) if lines else "(no history)"


def map_scorer_to_reward_dims(result: TurnScoreResult) -> dict[str, float]:
    """
    Convert TurnScoreResult into the REWARD_DIMS dict expected by arms.py.

    Bridges the scorer output to the continuous reward dimensions.
    The `continuous_score` is split across dimensions proportionally.
    """
    dim_map: dict[str, int] = {d: s for d, s, _ in result.integer_scores}

    def _norm(key: str, lo: int = -3, hi: int = 2) -> float:
        raw = dim_map.get(key, 0)
        return round((raw - lo) / (hi - lo), 4)

    return {
        "stress":        _norm("urgency",         -3, 2),   # urgency managed well → stress reduced
        "trust_delta":   _norm("engagement",       -2, 2),
        "goal_progress": _norm("goal_progress",    -2, 2),
        "info_coverage": _norm("info_gathering",   -2, 2),
        "consistency":   _norm("quality",          -2, 2),
        "safety":        _norm("escalation",       -3, 2),
        "count_penalty": 1.0 - result.repetition_penalty,
    }
