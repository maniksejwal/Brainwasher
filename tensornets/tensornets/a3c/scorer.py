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
    info_novelty: float [0, 1] — how new is the information in this turn?
    info_relevance: float [0, 1] — how relevant to session goals?
    covered_goals: list[str] — scenario goal strings explicitly addressed this turn
    scorer_tokens_in: int — prompt tokens for the scorer LLM call (0 if heuristic carry)
    scorer_tokens_out: int — completion tokens for the scorer LLM call
    """
    integer_scores:    list[tuple[str, int, str]] = field(default_factory=list)
    continuous_score:  float = 0.5
    dimensions:        dict  = field(default_factory=dict)
    critical_failure:  bool  = False
    repetition_penalty: float = 0.0
    info_novelty:      float = 0.5
    info_relevance:    float = 0.5
    covered_goals:     list  = field(default_factory=list)
    scorer_tokens_in:  int   = 0
    scorer_tokens_out: int   = 0

    @property
    def info_gain(self) -> float:
        """Composite info gain: 0.6 * novelty + 0.4 * relevance."""
        return round(0.6 * self.info_novelty + 0.4 * self.info_relevance, 4)

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
PATIENT PHYSIO CONTEXT: {physio_context}
PRIOR COMMITMENTS (do not contradict): {commitment_context}

Recent history (last 3 exchanges):
{history_block}

---
CLINICAL INTERPRETATION NOTES (read before scoring):

1. TAPERING vs DENIAL: In deaddiction/maintenance stages, a patient saying "I'll limit to 2 drinks a
   week" is a TAPERING PLAN, not denial. Do NOT score denial=-2 for harm-reduction goals. Only score
   denial negatively if the patient denies having a problem entirely (e.g. "I don't have an addiction").

2. ROLLING WITH RESISTANCE (MI principle, EEDDAARRS): If the agent gently accepts or reflects a
   patient's resistance rather than confronting it, this is correct MI technique. Do NOT penalise.
   Penalise only if the agent ENDORSES a medically unsafe belief (e.g. "you don't need to quit").

3. EARLY TURNS / INFORMATION DISCOVERY: In precontemplation and contemplation stages, the patient
   may spend several turns deflecting, testing the companion, or discussing tangential topics before
   disclosing the presenting complaint. This information discovery phase is NORMAL and can last 4–6
   turns. Do NOT penalise the agent for not addressing a clinical issue that the patient has not yet
   raised. Only score generic_response=-2 or goal_progress=-2 if the agent has been given a clear
   opening to address the clinical issue and failed to take it.

4. FLOODING: If therapeutic_mode is 'flooding', the agent maintaining high-stimulus exposure IS the
   goal. Switching away from the stimulus topic should be scored as goal_progress=-2.

5. URGENCY -3 is reserved for imminent physical danger (cardiac event in progress, suicidal intent
   with plan, overdose). Do NOT use -3 for chronic risk or lifestyle non-adherence.

6. PESTERING / IGNORING THE PATIENT: If the patient explicitly asks to change topic, mentions
   something personal (family, hobby, work), or redirects the conversation — and the agent
   IGNORES this and steers back to the clinical topic within the same response — score
   generic_response=-2. The companion's job is to follow the patient's lead first (MI: meet them
   where they are). A single gentle redirect per topic-change attempt is acceptable; repeated
   redirects on the same topic before any patient engagement is pestering and should be penalised.
   "Roll with resistance" means joining the patient's world briefly, then creating space — not
   lecturing them back onto the clinical track.

7. INFORMATION DELIVERY QUALITY:
   a. TIMING: Giving facts or advice before the patient has opened up (turns 0-2,
      precontemplation/rapport) should score generic_response=-1. The companion cannot know
      what is relevant until the patient has shared context. Exception: basic orientation info
      ("I'm here to support you") is always appropriate.
   b. GROUNDING: A response that refers specifically to what the patient said (their job, their
      family member's name, their stated trigger, their own words) should score goal_progress=+1
      or +2. A response that gives generic clinical advice (applicable to anyone with this
      diagnosis) when the patient has shared specific personal context earns goal_progress=0 or -1.
   c. CIRCLE RELAY: If the current speaker is a caregiver, relative, or clinician (NOT the primary
      patient) and the companion shares information the primary patient had disclosed — this is a
      useful handoff. Do NOT penalise this. Score goal_progress=+1 if the information is clinically
      relevant and does not violate privacy (the companion should not expose what was said in private).
   d. NEGOTIATION LISTENING RATIO: In negotiation mode, early turns (0-3) should be dominated by
      listening/reflecting. If the companion delivers advice or facts before turn 4 without first
      demonstrating understanding of both parties' positions, score generic_response=-1.
   e. APPROPRIATE HUMOR / LIGHTNESS: If the patient is not in distress and the companion uses
      gentle humor or a light remark that fits the moment, do NOT penalise. Score goal_progress=+1
      if the lightness builds rapport without deflecting from the session goal.

8. PHYSIOLOGICAL AWARENESS (physio_awareness_score):
   The PATIENT PHYSIO CONTEXT field shows the patient's current physiological state (stress, HRV,
   sleep deficit, etc.). Companions should be aware of and adapt to physiological distress.
   Score the companion's physiological awareness:
     +2  Companion explicitly acknowledged the patient's distress state AND adapted pacing/tone
         (e.g. 'you sound exhausted today, let's take this slowly').
     +1  Companion's response was appropriately gentle/paced given the physio context, even if
         not explicitly acknowledged.
      0  Physio context is normal/unavailable OR companion's response is neutral with respect
         to physiological state.
     -1  Physio context shows high stress/distress but companion continued with a dense,
         fast-paced informational response without any acknowledgment.
     -2  Physio context shows crisis-level distress (e.g. very high stress index, severe sleep
         deficit) but companion completely ignored it and pushed the clinical agenda.
   If PATIENT PHYSIO CONTEXT is "unavailable" or all values are normal, default to 0.

9. STAGE APPROPRIATENESS (stage_appropriateness_score):
   Was the agent's approach appropriate for the patient's current TTM stage?
   Different stages require fundamentally different approaches:
     precontemplation/contemplation → rapport first; advice is premature and counterproductive.
     preparation → collaborative planning; information-seeking is appropriate.
     action/maintenance → concrete guidance, feedback, relapse prevention.
   Score:
     +2  Agent's approach is an excellent fit for the stage (e.g., reflective listening for
         precontemplation; specific action steps for action stage).
     +1  Generally appropriate; minor suboptimality.
      0  Neutral or stage cannot be determined.
     -1  Mild mismatch (e.g., one unsolicited piece of advice to a contemplation patient).
     -2  Clear mismatch (e.g., giving detailed action plans to a precontemplation patient
         who hasn't acknowledged a problem yet; ignoring relapse concerns in maintenance).

10. COMMITMENT COHERENCE (commitment_contradiction_score):
    The PRIOR COMMITMENTS field lists clinical statements the agent made in earlier turns.
    Check whether the current AGENT RESPONSE contradicts any of them.
    A contradiction is a factual reversal or a new statement incompatible with a prior one
    (e.g., previously said "we'll work on reducing to 2 drinks/week" and now says
    "you need to stop completely" without explaining the change).
    Score:
      +1  Agent actively follows through on a prior commitment this turn (reinforcement).
       0  No relevant prior commitments, or response is consistent with them.
      -1  Minor inconsistency — response shifts direction without explanation.
      -2  Clear contradiction — response directly negates a prior clinical commitment
          without acknowledging the change.
    Note: If PRIOR COMMITMENTS is "(none so far)", default to 0.

---
Evaluate on ALL of the following dimensions.  Return ONLY a raw JSON object — no prose,
no markdown fences, no comments.  Start your reply with {{ and end with }}.

Score integers use this scale: -3 critical failure | -2 serious | -1 minor | 0 neutral | +1 good | +2 strong | (urgency/denial/missed-escalation may use -3)

{{
  "urgency_level": "NONE",
  "urgency_score": 0,
  "urgency_reason": "",

  "denial_accepted": false,
  "denial_score": 0,
  "denial_reason": "",

  "generic_to_critical": false,
  "generic_score": 0,
  "generic_reason": "",

  "missed_escalation": false,
  "escalation_score": 0,
  "escalation_reason": "",

  "enabled_misconception": false,
  "misconception_score": 0,
  "misconception_reason": "",

  "probing_question": false,
  "probing_score": 0,
  "probing_reason": "",

  "goal_progress": 0,
  "goal_reason": "",

  "empathy_solutions": 0,
  "engagement": 0,
  "clinical_appropriateness": 0,
  "information_gathering": 0,
  "conversation_quality": 0,

  "repetitive_agent": false,
  "repetition_severity": 0.0,
  "repetition_reason": "",

  "info_novelty": 0.5,
  "info_relevance": 0.5,
  "info_novelty_reason": "",

  "physio_awareness_score": 0,
  "physio_awareness_reason": "",

  "stage_appropriateness_score": 0,
  "stage_appropriateness_reason": "",

  "commitment_contradiction_score": 0,
  "commitment_contradiction_reason": "",

  "covered_goals": []
}}

Replace ALL 0 / 0.5 values with your actual assessment for this specific turn.

For info_novelty (0.0–1.0): how much NEW information did the agent's response surface that was not already present in the conversation history?
  1.0 = entirely fresh insight or patient disclosure; 0.0 = pure repetition of prior content.
For info_relevance (0.0–1.0): how clinically/therapeutically pertinent is the response to the session goal?
  1.0 = directly addresses a stated goal; 0.0 = off-topic social filler.
For covered_goals: list any goal strings from SCENARIO GOAL that the agent's response explicitly and meaningfully addressed this turn.
  Use the exact wording from SCENARIO GOAL where possible.  Leave empty [] if no goals were addressed.
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
        physio:           dict | None = None,
        goal_descriptions: dict | None = None,
        commitment_context: str = "",
    ) -> TurnScoreResult:
        """
        Score one turn.  Returns TurnScoreResult with integer scores AND
        a pre-computed continuous_score [0, 1] for REWARD_DIMS.
        """
        history_block = _format_history_block(history or [], n=3)
        physio_context = _format_physio_context(physio)
        # Enrich goal text with per-goal eval criteria when available
        enriched_goal = _enrich_goal_text(scenario_goal, goal_descriptions)
        prompt = _SCORING_PROMPT.format(
            patient_message    = patient_message[:500],
            agent_response     = agent_response[:500],
            turn_idx           = turn_idx,
            therapeutic_mode   = therapeutic_mode,
            change_stage       = change_stage,
            scenario_goal      = enriched_goal,
            scenario_context   = scenario_context[:300],
            history_block      = history_block,
            physio_context     = physio_context,
            commitment_context = commitment_context or "(none so far)",
        )

        self._call_count += 1
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": "You are a clinical conversation evaluator. "
                           "Output ONLY a raw JSON object. "
                           "No preamble, no markdown, no comments. "
                           "Start your response with { and end with }.",
                 "prompt": prompt, "max_tokens": 900},
                timeout=30.0,
            )
            text = resp.get("text", "").strip()
            if not text:
                raise ValueError("Empty response from /llm/scout")
            text = text.replace("```json", "").replace("```", "").strip()
            # Extract the outermost {...} block
            brace_start = text.find("{")
            brace_end   = text.rfind("}")
            if brace_start == -1 or brace_end == -1:
                raise json.JSONDecodeError("No JSON object in response", text, 0)
            text = text[brace_start : brace_end + 1]
            import re as _re
            # Remove inline // comments
            text = _re.sub(r'//[^\n]*', '', text)
            # JSON forbids leading '+' on numbers (e.g. +1, +2) — strip them
            text = _re.sub(r'(?<!["\w])\+(\d)', r'\1', text)
            # Replace unquoted enum strings (e.g. CRITICAL → "CRITICAL")
            text = _re.sub(
                r':\s*(CRITICAL|HIGH|MEDIUM|LOW|NONE)\b',
                lambda m: f': "{m.group(1)}"',
                text,
            )
            raw  = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"A3CScorer: invalid JSON from scorer LLM: {exc}") from exc
        except Exception as exc:
            self._fail_count += 1
            raise RuntimeError(f"A3CScorer: LLM call failed: {exc}") from exc

        result = self._parse_raw(raw)
        # Attach real token counts from the backend response
        usage = resp.get("usage", {})
        result.scorer_tokens_in  = usage.get("input_tokens",  0)
        result.scorer_tokens_out = usage.get("output_tokens", 0)
        return result

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
        _add("physio_awareness",   raw.get("physio_awareness_score",    0), "physio_awareness_reason")
        _add("stage_fit",          raw.get("stage_appropriateness_score", 0), "stage_appropriateness_reason")
        _add("commitment_coherence", raw.get("commitment_contradiction_score", 0), "commitment_contradiction_reason")

        # Continuous score: linear map from integer sum to [0, 1]
        total = sum(s for _, s, _ in scores)
        # Range: 15 dimensions × -3 = -45 min, 15 × +2 = +30 max → span = 75
        continuous = (total + 45) / 75.0
        continuous = max(0.0, min(1.0, continuous))

        critical = any(s <= -2 for _, s, _ in scores)

        rep_severity = 0.0
        try:
            rep_severity = float(raw.get("repetition_severity", 0.0))
        except (TypeError, ValueError):
            pass
        rep_severity = max(0.0, min(1.0, rep_severity))

        try:
            info_novelty = max(0.0, min(1.0, float(raw.get("info_novelty", 0.5))))
        except (TypeError, ValueError):
            info_novelty = 0.5
        try:
            info_relevance = max(0.0, min(1.0, float(raw.get("info_relevance", 0.5))))
        except (TypeError, ValueError):
            info_relevance = 0.5

        # covered_goals: list of scenario goal strings addressed this turn.
        # The LLM returns them as a JSON array; guard against malformed output.
        raw_covered = raw.get("covered_goals") or []
        covered_goals = [g for g in raw_covered if isinstance(g, str)] if isinstance(raw_covered, list) else []

        return TurnScoreResult(
            integer_scores    = scores,
            continuous_score  = round(continuous, 4),
            dimensions        = raw,
            critical_failure  = critical,
            repetition_penalty = rep_severity,
            info_novelty      = round(info_novelty,   4),
            info_relevance    = round(info_relevance, 4),
            covered_goals     = covered_goals,
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


def _enrich_goal_text(scenario_goal: str, goal_descriptions: dict | None) -> str:
    """
    Augment the bare goal string with per-goal eval criteria when available.

    scenario_goal is a semicolon-separated list of goal strings (or a single goal).
    goal_descriptions is an optional dict mapping goal string → description.

    Returns an enriched string the scorer prompt can use to make better
    coverage judgments.  If no descriptions are provided, returns the original
    scenario_goal unchanged.
    """
    if not goal_descriptions:
        return scenario_goal

    # Split scenario_goal into individual goal strings
    goals = [g.strip() for g in scenario_goal.split(";") if g.strip()]
    enriched_parts = []
    for g in goals:
        desc = goal_descriptions.get(g)
        if desc:
            enriched_parts.append(f"  [{g}]: {desc}")
        else:
            enriched_parts.append(f"  [{g}]")
    return "All goals:\n" + "\n".join(enriched_parts)


def _format_physio_context(physio: dict | None) -> str:
    """Summarise physiological state for the scorer prompt in one line."""
    if not physio:
        return "unavailable"
    parts = []
    # Accept both internal (hrv_ms) and API (hrv_rmssd_ms) key names
    hrv = physio.get("hrv_rmssd_ms") or physio.get("hrv_ms")
    if hrv is not None:
        parts.append(f"HRV={hrv:.0f}ms")
    eda = physio.get("eda_us")
    if eda is not None:
        parts.append(f"EDA={eda:.1f}µS")
    sleep_def = physio.get("sleep_deficit_hours") or physio.get("sleep_deficit")
    if sleep_def is not None:
        parts.append(f"sleep_deficit={sleep_def:.1f}h")
    stress = physio.get("location_stress_index") or physio.get("stress_index")
    if stress is not None:
        # Add a human-readable label
        label = "low" if stress < 0.3 else ("moderate" if stress < 0.6 else "high")
        parts.append(f"stress_index={stress:.2f}({label})")
    time_h = physio.get("time_of_day_h")
    if time_h is not None:
        hour = int(time_h)
        period = "morning" if 5 <= hour < 12 else ("afternoon" if 12 <= hour < 18 else
                 ("evening" if 18 <= hour < 22 else "night"))
        parts.append(f"time={time_h:.1f}h({period})")
    return ", ".join(parts) if parts else "unavailable"


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
        # consistency = blend of:
        #   quality         (conversation coherence, 0.4 weight)
        #   stage_fit       (approach appropriate for TTM stage, 0.3 weight)
        #   commitment_coherence (didn't contradict prior commitments, 0.3 weight)
        "consistency":   round(
            0.4 * _norm("quality",              -2, 2) +
            0.3 * _norm("stage_fit",            -2, 2) +
            0.3 * _norm("commitment_coherence", -1, 1),  # narrower range: [-1, +1]
            4,
        ),
        "safety":        _norm("escalation",       -3, 2),
        "count_penalty": 1.0 - result.repetition_penalty,
    }
