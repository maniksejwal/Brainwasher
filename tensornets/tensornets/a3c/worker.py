"""
tensornets.a3c.worker — A3C base components for the HTN three-arm trial.

J1  A3CWorker  : episode runner, per-turn reward accumulator, jsonl logging.
J2  Actor      : Scout-backed policy head, loaded from bandit prior (I4 output).
J3  Critic     : Maverick-backed value estimator V(s).
J4  advantage  : A(s,a) = r + γ·V(s') − V(s); policy-gradient weight update.

Design constraints (from A3C_COMPARISON_DESIGN.md §3 and §8)
------------------------------------------------------------
- Rollout / action selection   → Scout (fast, cheap, bulk)
- Value estimation             → Maverick (quality, once per turn)
- Actor prior init             → bandit_actor_prior.json from I4
- No gradient-descent engine   : the "weights" are prompt log-biases stored as
  a plain float dict; update rule is an exponentially-weighted moving average
  of advantage signals.  This avoids bringing PyTorch / JAX into the loop for
  what is ultimately a *prompt-selection* policy.
- All episode data is written to jsonl for K1–K5 analysis.

References
----------
Mnih et al. (2016). Asynchronous Methods for Deep Reinforcement Learning.
  ICML 2016.  arXiv:1602.01783.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from tensornets.a3c.action_bandit import ACTION_TAXONOMY, STRESS_BUCKETS
from tensornets.a3c.scorer import A3CScorer, TurnScoreResult, map_scorer_to_reward_dims
from tensornets.a3c import node_client as _nc

# TensorRAG — lazy singleton; only initialised when first turn requires scoring
_TENSOR_RAG = None
_TENSOR_RAG_LOCK = __import__("threading").Lock()


def _get_worker_rag():
    """Return the shared TensorRAG instance, initialising it on first call."""
    global _TENSOR_RAG
    if _TENSOR_RAG is None:
        with _TENSOR_RAG_LOCK:
            if _TENSOR_RAG is None:
                try:
                    import os
                    from tensornets.tensor_rag.rag import TensorRAG
                    db_path = os.environ.get("DB_PATH", "data/dbs/care_circle_dev.db")
                    _TENSOR_RAG = TensorRAG(db_path=db_path, data_dir="data/rag")
                    _TENSOR_RAG.init()
                except Exception as exc:
                    import logging
                    logging.getLogger(__name__).warning(
                        "TensorRAG init failed in worker: %s — continuing without RAG", exc
                    )
                    _TENSOR_RAG = None  # will retry next call
    return _TENSOR_RAG


def _log_turn_to_db(
    episode_id: str,
    run_id: str,
    arm: str,
    turn_idx: int,
    action: str,
    response: str,
    state: "TurnState",
    reward_dict: dict,
    score_result: "TurnScoreResult",
    latency_ms: float,
    cost_usd: float,
    llm_calls: int,
) -> None:
    """
    Persist one turn to the DB via node_client.record_turn().

    Thin wrapper that unpacks worker-internal types (TurnState, TurnScoreResult)
    into the flat keyword args that node_client expects.  Failures are non-fatal.
    """
    try:
        _nc.record_turn(
            episode_id   = episode_id,
            run_id       = run_id,
            arm          = arm,
            turn_idx     = turn_idx,
            action       = action,
            response     = response,
            stress_index = state.stress_index,
            stress_bucket= state.stress_bucket,
            hrv_ms       = state.physio.get("hrv_ms") if state.physio else None,
            reward       = reward_dict,
            judge        = score_result.dimensions or {},
            critical_failure = score_result.critical_failure,
            latency_ms   = latency_ms,
            cost_usd     = cost_usd,
            llm_calls    = llm_calls,
        )
    except Exception as exc:
        log.warning("Turn DB log failed (non-fatal): %s", exc)

# V_int / SharedTensorBuffer — lazy import (no torch requirement at module level)
_SharedTensorBuffer = None
def _get_shared_tensor_buffer():
    global _SharedTensorBuffer
    if _SharedTensorBuffer is None:
        try:
            from tensornets.agents.shared_tensor_state import SharedTensorBuffer
            _SharedTensorBuffer = SharedTensorBuffer
        except ImportError:
            pass
    return _SharedTensorBuffer

# SharedDialogueState — lazy import (inter-agent commitment tracking)
_SharedDialogueState = None
def _get_shared_dialogue_state():
    global _SharedDialogueState
    if _SharedDialogueState is None:
        try:
            from tensornets.agents.inter_agent_comm import SharedDialogueState
            _SharedDialogueState = SharedDialogueState
        except ImportError:
            pass
    return _SharedDialogueState

# ReactivityProfile — lazy import
_ReactivityProfile = None
_ReactivityArchetype = None
def _get_reactivity():
    global _ReactivityProfile, _ReactivityArchetype
    if _ReactivityProfile is None:
        try:
            from tensornets.physio.reactivity import ReactivityProfile, ReactivityArchetype
            _ReactivityProfile = ReactivityProfile
            _ReactivityArchetype = ReactivityArchetype
        except ImportError:
            pass
    return _ReactivityProfile, _ReactivityArchetype

# ReactivityProfile archetype mapping from old JS names → Python enum values
_ARCHETYPE_MAP: dict[str, str] = {
    "anxious":          "hypersensitive",
    "hypersensitive":   "hypersensitive",
    "reactive":         "labile",
    "labile":           "labile",
    "avoidant":         "stoic",
    "stoic":            "stoic",
    "intellectualiser": "ruminant",
    "ruminant":         "ruminant",
    # 'standard' → no profile (None)
}


def _build_reactivity_profile(subject_id: str, archetype: str):
    """
    Instantiate a ReactivityProfile from an archetype string.
    Returns None for unknown or 'standard' archetypes.
    """
    ReactivityProfile, ReactivityArchetype = _get_reactivity()
    if ReactivityProfile is None:
        return None
    arch_key = _ARCHETYPE_MAP.get(archetype.lower())
    if arch_key is None:
        return None
    try:
        arch_enum = ReactivityArchetype(arch_key)
        return ReactivityProfile.from_archetype(subject_id, arch_enum)
    except Exception:
        return None

log = logging.getLogger("tensornets.a3c.worker")

# ── Hyper-parameters ──────────────────────────────────────────────────────────

GAMMA_DISCOUNT: float = 0.95        # temporal discount for V(s')
ALPHA_LR: float       = 0.05        # learning rate for log-bias update
ENTROPY_COEF: float   = 0.01        # entropy bonus weight (prevents collapse)
MAX_TURNS: int        = 50          # episode truncation; individual scenarios may override


def progressive_lookahead(ep_count: int, session_boundary: bool = False) -> int:
    """
    Return the MCTS lookahead depth for the given episode count.

    Early training has random policy — deep lookahead wastes compute on noise.
    Ramp up as the policy stabilises:

      ep <  100  →  4  (fast iterations, policy is random — no point looking far)
      ep < 1000  → 10  (policy has some signal, moderate tree depth)
      ep >= 1000 → 20  (trained policy, full lookahead for quality decisions)

    MCTS6: reduce depth at the start of a new session.  On session_boundary=True
    the first 1–2 turns are rapport re-establishment — deep lookahead over a cold
    state is wasteful and can select premature deep therapeutic actions.
    Depth is halved at session boundary and ramps back to normal after turn 1.
    """
    if ep_count < 100:
        base = 4
    elif ep_count < 1000:
        base = 10
    else:
        base = 20
    return max(2, base // 2) if session_boundary else base


def drift_physio_for_gap(physio: dict, gap_days: float, baseline_stress: float = 0.40) -> dict:
    """
    Apply inter-session physiological drift to a physio snapshot.

    Over a gap of `gap_days` days, the patient's physio state partially relaxes
    back toward population baseline.  This models the reality that a patient who
    was highly stressed at session end is not necessarily at the same stress level
    when the next session begins days later.

    Drift model: exponential decay toward baseline.
        stress_new = baseline + (stress_last - baseline) × exp(-λ × gap_days)

    λ = 0.20 (half-life ≈ 3.5 days — consistent with HRV recovery literature).
    For gap_days = 0 (same session / no gap) the function is a no-op.

    Only numeric physio fields are drifted.  Sentinel values (-1, None) are
    passed through unchanged.
    """
    if gap_days <= 0:
        return physio
    import math
    _LAMBDA = 0.20  # per-day decay constant
    decay = math.exp(-_LAMBDA * gap_days)
    drifted = dict(physio)
    for field, baseline in (
        ("stress_index",  baseline_stress),
        ("hrv_ms",        55.0),    # population median resting HRV (ms)
        ("eda_us",        2.0),     # population median resting EDA (µS)
        ("sleep_deficit", 0.0),     # assume sleep recovered across gap
    ):
        val = drifted.get(field)
        if val is not None and val >= 0:
            drifted[field] = round(baseline + (val - baseline) * decay, 4)
    return drifted


# ── Per-turn LLM cost estimator ───────────────────────────────────────────────

def _compute_turn_cost(tokens: dict) -> float:
    """
    Estimate USD cost for one turn given its token dict from generate_response().

    Token dict keys:
        scout        : total scout tokens (in + out combined, if in/out not split)
        scout_in     : scout input tokens (optional; used when split is available)
        scout_out    : scout output tokens (optional)
        maverick     : total maverick tokens (in + out combined)
        maverick_in  : maverick input tokens (optional)
        maverick_out : maverick output tokens (optional)

    Uses the same per-token rates as cost_tracker.py / judge.py.
    Raises ValueError if tokens dict contains unrecognised model keys
    beyond {scout, maverick, scout_in, scout_out, maverick_in, maverick_out}.
    """
    from tensornets.a3c.cost_tracker import _cost_usd

    known_keys = {"scout", "scout_in", "scout_out", "maverick", "maverick_in", "maverick_out"}
    unknown = set(tokens.keys()) - known_keys
    if unknown:
        raise ValueError(
            f"_compute_turn_cost: unrecognised token keys {unknown}. "
            f"Add the model to cost_tracker.py with its per-token rate."
        )

    cost = 0.0

    # Scout
    if "scout_in" in tokens or "scout_out" in tokens:
        cost += _cost_usd("scout", tokens.get("scout_in", 0), tokens.get("scout_out", 0))
    elif "scout" in tokens:
        # Combined total — split 40/60 as typical prompt/completion ratio for short calls
        total = tokens["scout"]
        cost += _cost_usd("scout", int(total * 0.4), int(total * 0.6))

    # Maverick
    if "maverick_in" in tokens or "maverick_out" in tokens:
        cost += _cost_usd("maverick", tokens.get("maverick_in", 0), tokens.get("maverick_out", 0))
    elif tokens.get("maverick", 0) > 0:
        total = tokens["maverick"]
        cost += _cost_usd("maverick", int(total * 0.4), int(total * 0.6))

    return round(cost, 8)

REWARD_DIMS = ("stress", "trust_delta", "goal_progress", "info_coverage",
               "consistency", "safety", "count_penalty")
# Weights must sum to 1.0.
# goal_progress + info_coverage together form the primary goal-achievement
# signal.  They were previously under-weighted (0.20 + 0.10 = 0.30) vs the
# stress signal alone (0.30), which caused the A3C to learn emotionally
# supportive behaviour that reduced stress but never covered scenario goals.
# Rebalanced so goal signals = 0.45 and stress = 0.20.
REWARD_WEIGHTS: dict[str, float] = {
    "stress":        0.20,   # was 0.30 — still important but no longer dominant
    "trust_delta":   0.18,   # was 0.20
    "goal_progress": 0.28,   # was 0.20 — primary goal signal (↑)
    "info_coverage": 0.17,   # was 0.10 — LLM-scored novelty/relevance per turn (↑)
    "consistency":   0.08,
    "safety":        0.06,   # was 0.07
    "count_penalty": 0.03,   # was 0.05
}


def physio_reward_modifier(physio: dict, prev_physio: dict | None = None) -> float:
    """
    Continuous modifier in [-0.15, +0.15] derived from raw physiological signals.

    This is applied multiplicatively on top of scalar_reward() so it cannot
    dominate the signal — it shapes the gradient without overwhelming it.

    Signals used:
      hrv_ms         — HRV RMSSD.  Trend (vs prev_physio) is more informative than absolute.
                       Rising HRV during an exchange = positive physiological engagement.
      eda_us         — EDA/skin conductance. Sudden spike (>1.5× prev) = acute arousal.
                       Penalise: companion may have triggered distress.
      sleep_deficit  — Hours of sleep lost. > 1.5h deficit = lower tolerance; cap reward.
      glucose_mg_dl  — Blood glucose proxy for energy/cognitive load.
                       Very low (<70) or very high (>140) = physiological stress penalty.
      circadian      — Time-of-day receptivity [0,1] from synthetic_patient physio block.
                       Low circadian (night/early morning) = patient less receptive.

    Args:
        physio:      Current turn physio snapshot (from TurnState.physio).
        prev_physio: Previous turn physio snapshot for trend computation.

    Returns:
        Scalar modifier ∈ [-0.15, +0.15].
    """
    mod = 0.0

    hrv      = physio.get("hrv_ms",        40.0)
    eda      = physio.get("eda_us",         2.0)
    sleep_d  = physio.get("sleep_deficit",  0.0)
    glucose  = physio.get("glucose_mg_dl", 90.0)
    circad   = physio.get("circadian",      0.7)   # 0=worst, 1=peak receptivity

    # ── HRV trend ────────────────────────────────────────────────────────────
    if prev_physio is not None:
        prev_hrv = prev_physio.get("hrv_ms", hrv)
        hrv_delta = hrv - prev_hrv
        # Normalise: ±10ms change → ±0.05 modifier
        mod += max(-0.05, min(0.05, hrv_delta / 200.0))

    # ── EDA spike (acute arousal) ─────────────────────────────────────────────
    if prev_physio is not None:
        prev_eda = prev_physio.get("eda_us", eda)
        if prev_eda > 0 and eda / prev_eda > 1.5:
            mod -= 0.05   # sudden arousal spike — companion may have pushed too hard

    # ── Sleep deficit ─────────────────────────────────────────────────────────
    # > 1.5h deficit: −0.03; > 3h deficit: −0.06 (cumulative fatigue gate)
    if sleep_d > 3.0:
        mod -= 0.06
    elif sleep_d > 1.5:
        mod -= 0.03

    # ── Glucose extremes ──────────────────────────────────────────────────────
    if glucose < 70 or glucose > 140:
        mod -= 0.04   # physiological stress from dysglycaemia

    # ── Circadian receptivity ─────────────────────────────────────────────────
    # Low receptivity (circadian < 0.4) caps positive reward
    if circad < 0.4:
        mod -= 0.03

    return max(-0.15, min(0.15, mod))


def scalar_reward(reward_dict: dict[str, float]) -> float:
    """Aggregate multi-dimensional reward into a scalar for A3C updates."""
    return sum(REWARD_WEIGHTS.get(k, 0.0) * v for k, v in reward_dict.items())


# ── State representation passed to Actor / Critic ────────────────────────────

@dataclass
class TurnState:
    """
    Full environment state at one dialogue turn — mirrors what CompanionCoordinator
    assembles in the production JS system (coordinateCompanions).

    Fields present in the old framework that we must carry for fair comparison:

    stress_index          float [0,1]   — from physio/empathyHandler
    stress_bucket         str           — 'low' | 'moderate' | 'high'  (bandit buckets)
    therapeutic_mode      str           — 'standard'|'flooding'|'deaddiction'|'negotiation'
    deaddiction_phase     str           — 'rapport'|'ambivalence'|'insight'|'strike'
    last_action           str           — action taken on previous turn (for consistency)
    session_goal          str           — e.g. 'reduce craving', 'general support'
    turn_count            int           — number of completed turns this session
    info_coverage         float [0,1]   — fraction of session goal topics covered so far
    repetition_detected   bool          — inputUnderstanding flagged patient is repeating
    frames_component      str | None    — FRAMES element guiding current response
    known_context         str           — RAG block from facts_v2 (longitudinal + session)
    longitudinal_hint     str           — cross-session memory from tensornetsBridge
    activity_context      str           — patient's current activity (sitting, exercising…)
    archetype             str           — ReactivityProfile archetype key
                                          ('standard'|'anxious'|'avoidant'|
                                           'intellectualiser'|'reactive')
    has_misconception     bool          — patient holds a specific factual misconception;
                                          if True, psychoeducation actions should be
                                          prioritised by the Actor
    flooding_target_stress float        — target σ for flooding mode (default 0.80)
    conversation_history  list[dict]    — last K turns {"role", "content"};
                                          window size set by scenario['context_window']
                                          (default 60 messages = 30 exchanges)
    physio                dict          — raw physio snapshot for logging
    session_id            str
    subject_id            str
    """
    turn_idx:             int
    stress_index:         float
    stress_bucket:        str
    conversation_history: list[dict]
    physio:               dict[str, Any]

    # Production-framework fields — required for fair A3C parity
    therapeutic_mode:       str   = "standard"
    deaddiction_phase:      str   = "precontemplation"
    last_action:            str   = "none"
    session_goal:           str   = "general support"
    turn_count:             int   = 0
    info_coverage:          float = 0.3
    repetition_detected:    bool  = False
    frames_component:       Optional[str] = None
    known_context:          str   = ""        # RAG block injected into action prompt
    longitudinal_hint:      str   = ""        # cross-session memory
    activity_context:       str   = "none"

    # New fields for complete A3C coverage
    archetype:              str   = "standard"   # ReactivityProfile archetype
    has_misconception:      bool  = False        # patient has a factual misconception
    flooding_target_stress: float = 0.80         # target σ for flooding mode

    # C5.4 — DrugRegimen: optional dict of active drugs for PK/PD Γ modifier
    # Format: {"metoprolol": {"dose_mg": 50, "t_h": 3.0}, "ssri": {...}, ...}
    # None = patient has no active drug regimen (the common case)
    drug_regimen:           Optional[dict] = None

    # Source of the physiological data for this episode.
    #
    #   "sensor"     — real wearable / clinical measurement (HRV monitor, EDA sensor, etc.)
    #                  Full MCTS pipeline + history append.  Arm3 shows numeric values.
    #                  stress_index is the device reading.
    #
    #   "simulated"  — derived from scenario description and/or persona profile.
    #                  PhysioSimulator seeded by role + physio_narrative.  Internally
    #                  consistent across turns.  Arm3 labels values as "estimated".
    #                  stress_index starts from the narrative-derived sample.
    #
    #   "population" — pure population prior with no scenario-specific information.
    #                  Used when neither sensor data nor a narrative description is
    #                  available.  MCTS receives the values but should weight them less.
    #                  Arm3 labels values as "population estimate".
    #
    #   "none"       — no physio data of any kind.  MCTS receives sentinel values
    #                  (-1 for each field + physio_unknown=True) so it can apply a prior.
    #                  Arm3 shows only the conversation-inferred stress bucket.
    #                  stress_index starts at 0.5 (neutral/unknown).
    #
    physio_source:          str   = "sensor"   # "sensor"|"simulated"|"population"|"none"

    # Rolling natural-language summary of the conversation so far.
    # Built incrementally by the episode loop and injected into CoT prompts
    # so the model has a compact context rather than the full raw history.
    # None until the first turn completes.
    summary:                Optional[str] = None

    # Conversation-inferred stress estimate — updated each turn from the scorer's
    # assessment of the patient's actual response (acceptance, resistance, disclosure).
    # This is SEPARATE from stress_index (which is physio-based / model-based).
    #
    # The delta  (stress_index - conversation_stress)  is a clinically meaningful
    # signal fed into MCTS:
    #   Δ > 0  → physio says stressed but patient seems calm → possible masking
    #   Δ < 0  → patient expresses distress but physio is low → emotional outburst / panic
    #   Δ ≈ 0  → physio and conversation in agreement
    #
    # Starts at 0.5 regardless of physio_source (no info at turn 0).
    conversation_stress:    float = 0.5

    session_id:   str = ""
    subject_id:   str = ""

    # ── Heuristics imported from the JS production stack ─────────────────────
    # These mirror what CompanionCoordinator makes available in context:
    #
    # future_plans_summary: natural-language digest of the most recent future_plans
    #   rows for this subject_id.  Populated by the episode runner via a Node.js
    #   /api/future-plans/{subjectId} call.  Lets the Python arms maintain cross-session
    #   intent the same way the JS system does.  Empty string if unavailable.
    #
    # recent_n_gram_overlap: float [0,1] — cosine similarity between the current
    #   turn's assistant response and the mean of the last 3 assistant turns.
    #   Computed inline in Python (no LLM call) to mirror JS historyAnalyzer.
    #   > 0.55 → mark repetition_detected = True on the next turn.
    #   Stored separately so the reward function can use the raw score, not just
    #   the binary flag.
    future_plans_summary:   str   = ""    # cross-session intent from future_plans table
    recent_n_gram_overlap:  float = 0.0   # JS-historyAnalyzer proxy

    # ── Temporal-gap fields (MCTS6) ───────────────────────────────────────────
    # These three fields let MCTS and the inertia model understand that different
    # turns are separated by very different real-time intervals.
    #
    # session_gap_days: days elapsed between the previous session and the start of
    #   this one.  0.0 = first session or same-session turn.  The inter-session
    #   physio drift model uses this to reset the stress trajectory.
    #
    # session_boundary: True only on the very first turn of a session that follows
    #   a previous session.  Used to gate session-start actions (goal_reassess,
    #   summarise_session) and suppress premature deep therapeutic actions
    #   (flooding_deepen, socratic_probe, develop_discrepancy).
    #
    # elapsed_since_last_s: wall-clock seconds since the last turn in the same
    #   session.  0 at turn 0.  Within a session this is typically 30–120 s.
    #   Used to scale HPVOOT inertia γ: long between-turn pauses (phone put down)
    #   reduce γ slightly even within-session.
    session_gap_days:       float = 0.0   # days since previous session
    session_boundary:       bool  = False  # first turn of a new session
    elapsed_since_last_s:   float = 0.0   # seconds since last turn (within session)

    # ── Social alliance fields (SA2.1) ────────────────────────────────────────
    # alliance_score: composite alliance quality [0,1] from AllianceGraph.
    #   0.5 = neutral; > 0.5 = good alliance (stress recovery faster);
    #   < 0.5 = rupture risk (stress recovery harder).
    #   Populated by arms that have access to AllianceGraph; 0.5 = unknown.
    #
    # companion_stress: the companion/caregiver's own stress estimate [0,1].
    #   Used by social_Gamma_modifier to scale the speaker influence factor —
    #   a panicked speaker cannot effectively co-regulate even with good alliance.
    alliance_score:         float = 0.5   # composite working alliance [0,1]
    companion_stress:       float = 0.5   # speaker/companion stress estimate

    # ── Physio availability (no-watch scenario) ───────────────────────────────
    # physio_available: True if a wearable or validated physio source is present.
    # When False, stress_index is inferred entirely from conversation_stress
    # (the scorer's estimate of the patient's emotional state from language cues).
    # All physio-gated MCTS features (hysteresis_zone, HRV, EDA) fall back to
    # their neutral defaults so the system degrades gracefully rather than crashing.
    # The MCTS exploration constant is widened by _NO_PHYSIO_C_BOOST when physio
    # is unavailable, because uncertainty is higher.
    physio_available:       bool  = True  # set False when no watch is worn

    # ── Anticipatory anxiety (MCTS9) ─────────────────────────────────────────
    # pending_event: describes an upcoming feared event driving the patient's
    # current anxiety.  When populated, MultiHorizonHPVOOTMCTS applies the
    # _anticipatory_anxiety_bonus to route the tree toward time_bracketing,
    # uncertainty_tolerance, probability_reframe, or graded_imagery.
    # Keys:
    #   days_until   (float) — time remaining until the event
    #   threat_level (float, 0–1) — patient's subjective worst-case probability
    #   event_type   (str) — label ("exam", "diagnosis", "procedure", "job_decision", ...)
    # Empty dict = no anticipatory context (standard scenario).
    pending_event:          dict  = field(default_factory=dict)

    # AS2 / AS3 axis gating — updated per turn by scorer / conversation classifier.
    # session_count: number of sessions with this specific companion instance.
    #   Gates paradoxical interventions (AS2): require ≥ 3.
    # reflex_detected: True when last patient utterance was classically reactive
    #   (short, closed, fight/flight language). Gates deliberated actions (AS3).
    # panic_mode: True when the patient has entered hypervigilant rejection state.
    #   PAN1 (pending): set by panic classifier. When True, MCTS gates out
    #   all deliberated, motivational, and advisory actions. PU3 also injects
    #   a "[Patient Mode: PANIC]" block into Scout's known_context so the LLM
    #   generates presence-only responses rather than advice.
    session_count:          int   = 0
    reflex_detected:        bool  = False
    panic_mode:             bool  = False

    # OBS1: Observation uncertainty — probability weights for 11 distortion modes.
    # MULTI-ROLE: keyed by participant role for sessions with caregivers / clinicians.
    # {"patient": {...modes...}, "caregiver": {...modes...}, ...}
    # The "patient" key tracks patient self-report reliability (used by MCTS/action gating).
    # Other roles are tracked for belief cross-validation and coupling updates.
    # Caller code reads state.observation_uncertainty.get("patient", {}) for patient,
    # or state.observation_uncertainty.get(role, {}) for any participant.
    # Backward-compat: if the dict has mode keys directly (old format), treat as patient.
    observation_uncertainty: dict = field(default_factory=dict)

    # MA-MCTS3: coupling_tensor from the companion→patient AllianceEdge.
    # Seeded from RelationalField; updated by advance_relational_field() each episode.
    # Passed into MCTS payload so MultiAgentHPVOOTMCTS uses real coupling instead of
    # the 0.55 default. Range [0, 1]; 0.55 = neutral/unknown.
    coupling_tensor:        float = 0.55

    # MA-MCTS4: per-topic engagement + alignment from the companion→patient AllianceEdge.
    # topic_engagement: {topic_key: float[0,1]}   — how actively a topic has been discussed
    # topic_alignment:  {topic_key: float[-1,+1]} — how much src and tgt agree on topic
    # For Exp 22, keys are BeliefNode IDs; for other arms, TOPIC_CLUSTERS string keys.
    # Passed into MCTS payload for semantic coupling-aware rollout evaluation.
    topic_engagement:       dict = field(default_factory=dict)
    topic_alignment:        dict = field(default_factory=dict)

    @staticmethod
    def bucket_from_stress(stress_index: float) -> str:
        """Map stress_index [0,1] to the bandit bucket keys used by ActionBandit."""
        if stress_index < 0.35:
            return "low"
        if stress_index < 0.65:
            return "moderate"
        return "high"

    def to_action_context(self) -> dict:
        """
        Build the context dict that the action selector / patient optimizer expect.
        Mirrors the `enhancedContext` assembled in coordinateCompanions.
        """
        return {
            "stressLevel":          self.stress_bucket,
            "therapeuticMode":      self.therapeutic_mode,
            "deaddictionPhase":     self.deaddiction_phase,
            "lastAction":           self.last_action,
            "sessionGoal":          self.session_goal,
            "turnsCompleted":       self.turn_count,
            "infoCoverage":         self.info_coverage,
            "repetitionDetected":   self.repetition_detected,
            "framesComponent":      self.frames_component,
            "knownContextBlock":    self.known_context,
            "longitudinalHint":     self.longitudinal_hint,
            "activityContext":      self.activity_context,
            "physioState":          self.physio,
            "futurePlans":          self.future_plans_summary,
            "recentRepetitionScore": self.recent_n_gram_overlap,
        }

    @classmethod
    def from_scenario(cls, scenario: dict) -> "TurnState":
        """Construct the turn-0 state from a scenario dict."""
        from tensornets.a3c.physio_simulator import PhysioSimulator  # lazy import

        initial_physio = scenario.get("initial_physio") or {}
        # physio_source resolution priority:
        #   1. Explicit scenario key "physio_source" ("sensor"|"simulated"|"none")
        #   2. Legacy boolean "sensor_present" key (backwards compat)
        #   3. Presence/absence of initial_physio + embedded "_sensor_present" flag
        explicit_source = scenario.get("physio_source", None)

        if explicit_source in ("sensor", "simulated", "none"):
            physio_source = explicit_source
        elif scenario.get("sensor_present") is False:
            physio_source = "none"
        else:
            physio_source = None  # resolve below from physio content

        if not initial_physio:
            # No physio dict — sample from role/context-aware distributions.
            # physio_narrative in the scenario seeds the sampler with keyword cues.
            from tensornets.a3c.physio_simulator import physio_from_narrative  # lazy
            users = scenario.get("users", [{}])
            role  = (users[0].get("role", "patient") if users else "patient")
            narrative = scenario.get("physio_narrative", "")
            if narrative:
                initial_physio = physio_from_narrative(
                    narrative, role=role,
                    scenario_id=scenario.get("scenario_id", ""),
                )
                if physio_source is None:
                    physio_source = "simulated"
            else:
                initial_physio = PhysioSimulator().sample(
                    role=role,
                    scenario_id=scenario.get("scenario_id", ""),
                )
                if physio_source is None:
                    # No explicit source and no authored physio → population estimate
                    physio_source = "simulated"
        else:
            if physio_source is None:
                # Check for _sensor_present flag embedded by _physioFromPersona
                embedded = initial_physio.get("_sensor_present", None)
                physio_source = "sensor" if (embedded is None or embedded) else "simulated"

        stress = initial_physio.get("stress_index", scenario.get("initial_stress_index", 0.5))
        # For no-sensor episodes, the stress index at turn 0 is unknown.
        # Start at the neutral midpoint (0.5) so the arm isn't biased by sampled
        # estimates — stress will evolve from conversation cues via _stress_after_response.
        if physio_source == "none":
            stress = 0.5
        # Strip internal flags from the physio dict before storing.
        clean_physio = {k: v for k, v in initial_physio.items()
                        if k not in ("_sensor_present", "_physio_narrative")}
        # For "none" source, keep the physio dict (arms use it for context/logging)
        # but arms check physio_source before injecting it into LLM prompts.

        # MCTS6: apply inter-session physio drift when a session gap is present.
        # This ensures that a patient who was highly stressed at the end of session k
        # has partially recovered by the start of session k+1.
        gap_days = float(scenario.get("session_gap_days", 0.0))
        if gap_days > 0 and physio_source != "none":
            baseline = scenario.get("baseline_stress", 0.40)
            clean_physio = drift_physio_for_gap(clean_physio, gap_days, baseline)
            stress = clean_physio.get("stress_index", stress)

        return cls(
            turn_idx=0,
            stress_index=stress,
            stress_bucket=cls.bucket_from_stress(stress),
            conversation_history=[],
            physio=clean_physio,
            therapeutic_mode=scenario.get("therapeutic_mode", "standard"),
            deaddiction_phase=scenario.get("deaddiction_phase", "precontemplation"),
            last_action="none",
            session_goal=scenario.get("session_goal", "general support"),
            turn_count=0,
            info_coverage=scenario.get("initial_info_coverage", 0.3),
            repetition_detected=False,
            frames_component=None,
            known_context=scenario.get("known_context", ""),
            longitudinal_hint=scenario.get("longitudinal_hint", ""),
            activity_context=scenario.get("activity_context", "none"),
            archetype=scenario.get("archetype", "standard"),
            has_misconception=scenario.get("has_misconception", False),
            flooding_target_stress=scenario.get("flooding_target_stress", 0.80),
            drug_regimen=scenario.get("drug_regimen", None) or None,
            physio_source=physio_source,
            session_id=scenario.get("session_id", str(uuid.uuid4())),
            subject_id=scenario.get("subject_id", "synthetic"),
            future_plans_summary=scenario.get("future_plans_summary", ""),
            # MCTS6: temporal gap fields — populated by multi-session episode runners.
            # For a fresh (no prior session) episode these default to zero/False.
            session_gap_days=float(scenario.get("session_gap_days", 0.0)),
            session_boundary=bool(scenario.get("session_boundary", False)),
            elapsed_since_last_s=0.0,
            # No-watch: physio_available=False when scenario flags no wearable data.
            # Also infer from physio_source: "none" means no sensor.
            physio_available=physio_source not in ("none",)
                             and bool(scenario.get("physio_available", True)),
            # MCTS9: anticipatory anxiety context — carries forward for the whole episode.
            pending_event=scenario.get("pending_event", {}),
            # AS2/AS3: session_count from scenario; reflex_detected starts False.
            session_count=int(scenario.get("session_count", 0)),
            reflex_detected=False,
        )


def _ngram_overlap(text_a: str, text_b: str, n: int = 3) -> float:
    """
    Jaccard similarity of character n-grams between two strings.
    Used as a lightweight repetition proxy (mirrors JS historyAnalyzer token overlap).
    Returns 0.0 for empty inputs.
    """
    if not text_a or not text_b:
        return 0.0
    def ngrams(s: str) -> set:
        s = s.lower()
        return {s[i:i+n] for i in range(len(s) - n + 1)}
    a, b = ngrams(text_a), ngrams(text_b)
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def _qualitative_feedback_pass(
    episode_log: "list[EpisodeTurn]",
    scenario_goal: str,
    arm: str,
) -> "dict | None":
    """
    FB1: post-episode qualitative feedback from Scout.

    Sends the 6 most diagnostic turns to Scout with the prompt:
    "What 2 specific things went wrong and what 1 thing worked well?"

    Returns a dict with:
      ``insights``   list[str] — 2–3 actionable plain-English observations
      ``penalty``    float — suggested additional reward deduction (0–0.15)
      ``arm``        str
      ``goal``       str

    Returns None on any LLM or parsing failure so the episode is never blocked.
    """
    if not episode_log:
        return None

    # Select the 6 most diagnostic turns: 2 lowest scoring + 2 highest + 2 most recent.
    sorted_turns = sorted(
        episode_log,
        key=lambda t: float(t.judge.get("scorer_continuous", 0.5) or 0.5),
    )
    selected = (
        sorted_turns[:2]           # 2 worst
        + sorted_turns[-2:]        # 2 best
        + episode_log[-2:]         # 2 most recent
    )
    seen = set()
    unique_turns = [t for t in selected if id(t) not in seen and not seen.add(id(t))]

    # Build compact transcript
    lines: list[str] = []
    for t in unique_turns:
        action  = t.action
        patient = (t.judge.get("patient_message") or "")[:120]
        agent   = (t.response or "")[:120]
        score   = round(float(t.judge.get("scorer_continuous", 0.5) or 0.5), 2)
        lines.append(f"[turn {t.turn_idx} | {action} | score={score}]\n  P: {patient}\n  A: {agent}")
    transcript_snippet = "\n".join(lines)

    prompt = f"""You are reviewing a therapeutic companion training episode.

Session goal: {scenario_goal}
Arm: {arm}

Selected turns (worst + best + most recent):
{transcript_snippet}

Respond with ONLY valid JSON — no prose outside the JSON:
{{
  "what_went_wrong": ["<1-sentence specific observation>", "<second observation>"],
  "what_worked":     ["<1 thing that was effective>"],
  "penalty_score":   <float 0.0–0.15; 0.15 = major strategic failure, 0 = minor issues>
}}"""

    try:
        from tensornets.a3c.node_client import _http_post_attempt
        resp = _http_post_attempt(
            "/companion/scout",
            {
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.2,
            },
            timeout=15.0,
        )
        raw = resp.get("content", "") if isinstance(resp, dict) else ""
        # Strip markdown code fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = raw[: raw.rfind("```")]
        import json as _json
        data = _json.loads(raw.strip())
        return {
            "insights":       data.get("what_went_wrong", []) + data.get("what_worked", []),
            "what_went_wrong":data.get("what_went_wrong", []),
            "what_worked":    data.get("what_worked",     []),
            "penalty":        min(0.15, max(0.0, float(data.get("penalty_score", 0.0)))),
            "arm":            arm,
            "goal":           scenario_goal,
        }
    except Exception:
        return None


def _compute_repetition(history: list[dict], new_response: str, window: int = 3) -> tuple[bool, float]:
    """
    Detect repetition by comparing new_response against the last `window`
    assistant turns in conversation_history using character n-gram Jaccard.

    Returns (repetition_detected: bool, overlap_score: float).
    Threshold mirrors JS historyAnalyzer: flag if mean overlap > 0.55.
    """
    assistant_turns = [
        m["content"] for m in history
        if m.get("role") == "assistant" and m.get("content")
    ][-window:]
    if not assistant_turns or not new_response:
        return False, 0.0
    scores = [_ngram_overlap(new_response, t) for t in assistant_turns]
    mean_overlap = sum(scores) / len(scores)
    return mean_overlap > 0.55, round(mean_overlap, 4)


# ── J2: Actor ─────────────────────────────────────────────────────────────────

class Actor:
    """
    J2: Policy head for A3C.

    The policy is a softmax distribution over ACTION_TAXONOMY conditioned on
    the current stress bucket.  Weights are log-probability biases stored as
    a float dict — no neural-net engine required.

    Initialisation
    --------------
    Call `Actor.from_prior(path)` to load bandit_actor_prior.json (I4 output).
    Cold-start (no prior file) initialises to uniform log-biases (0.0).

    Action selection
    ----------------
    `select(state)` samples from the softmax policy using Scout for any
    tie-breaking or context-sensitive refinement.  The Scout call is optional
    and gated by `use_llm=True` (set False in unit tests).
    """

    def __init__(self, log_biases: dict[str, dict[str, float]] | None = None) -> None:
        self.log_biases: dict[str, dict[str, float]] = {}
        for bucket in STRESS_BUCKETS:
            self.log_biases[bucket] = {a: 0.0 for a in ACTION_TAXONOMY}
        if log_biases:
            for bucket, biases in log_biases.items():
                if bucket in self.log_biases:
                    for action, bias in biases.items():
                        if action in self.log_biases[bucket]:
                            self.log_biases[bucket][action] = float(bias)

    # ── Construction helpers ─────────────────────────────────────────────────

    @classmethod
    def from_prior(cls, prior_path: str | Path) -> "Actor":
        """
        Load from bandit_actor_prior.json (I4 export_actor_prior() output).

        Prior format: {bucket: {action: mean_reward [0..1]}}.
        We convert mean_reward → log-bias using log(p / (1-p)) (logit),
        clipped to [-3, +3] to avoid degenerate initialisation.
        """
        path = Path(prior_path)
        if not path.exists():
            log.warning("Actor prior not found at %s — using uniform init", path)
            return cls()

        raw: dict = json.loads(path.read_text(encoding="utf-8"))
        log_biases: dict[str, dict[str, float]] = {}
        for bucket, action_probs in raw.items():
            log_biases[bucket] = {}
            for action, p in action_probs.items():
                p_clipped = max(0.05, min(0.95, float(p)))
                log_biases[bucket][action] = math.log(p_clipped / (1.0 - p_clipped))
        log.info("Actor initialised from prior: %s (%d buckets)", path.name, len(log_biases))
        return cls(log_biases=log_biases)

    @classmethod
    def cold_start(cls) -> "Actor":
        return cls()

    # ── Policy distribution ──────────────────────────────────────────────────

    def _bucket_key(self, bucket: str, mode: str = "standard") -> str:
        """
        Return the compound lookup key "{mode}_{bucket}" if it exists, else plain "{bucket}".
        This allows mode-specific policies to develop over training while remaining
        backward-compatible with checkpoints that only have plain bucket keys.
        """
        compound = f"{mode}_{bucket}"
        return compound if compound in self.log_biases else bucket

    def action_distribution(self, bucket: str, mode: str = "standard") -> dict[str, float]:
        """Softmax over log-biases for the given stress bucket and therapeutic mode."""
        key = self._bucket_key(bucket, mode)
        biases = self.log_biases.get(key, {a: 0.0 for a in ACTION_TAXONOMY})
        max_b = max(biases.values(), default=0.0)
        exp_b = {a: math.exp(b - max_b) for a, b in biases.items()}
        total = sum(exp_b.values()) or 1.0
        return {a: v / total for a, v in exp_b.items()}

    def entropy(self, bucket: str, mode: str = "standard") -> float:
        """Shannon entropy of the action distribution (nats)."""
        dist = self.action_distribution(bucket, mode)
        return -sum(p * math.log(p + 1e-12) for p in dist.values())

    def select(self, state: TurnState) -> tuple[str, float]:
        """
        Sample an action from the policy, conditioned on both stress bucket and
        therapeutic mode so that different clinical contexts develop distinct policies.

        Returns
        -------
        (action_name, log_prob)
        """
        import random
        dist = self.action_distribution(state.stress_bucket, state.therapeutic_mode)
        actions = list(dist.keys())
        weights = list(dist.values())
        chosen = random.choices(actions, weights=weights, k=1)[0]
        log_prob = math.log(dist[chosen] + 1e-12)
        return chosen, log_prob

    # ── Weight update (J4 calls this) ────────────────────────────────────────

    def update(self, bucket: str, action: str, advantage: float,
               mode: str = "standard") -> None:
        """
        Policy-gradient update for one (bucket, action, advantage) triple.

        Δ log_bias = α · advantage · (1 − π(a|s))
        The (1 − π) term is the policy-gradient baseline correction that
        prevents the weight from growing unboundedly for already-likely actions.

        The update is applied to the compound "{mode}_{bucket}" key, creating
        mode-specific log-bias tables that share the plain-bucket fallback for
        unseen modes.
        """
        key = self._bucket_key(bucket, mode)
        # Lazily initialise compound key from plain bucket defaults
        if key not in self.log_biases:
            base = self.log_biases.get(bucket, {a: 0.0 for a in ACTION_TAXONOMY})
            self.log_biases[key] = dict(base)

        dist = self.action_distribution(bucket, mode)
        pi_a = dist.get(action, 1.0 / len(ACTION_TAXONOMY))
        delta = ALPHA_LR * advantage * (1.0 - pi_a)
        if action in self.log_biases[key]:
            self.log_biases[key][action] += delta

    # ── Persistence ──────────────────────────────────────────────────────────

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.log_biases, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Actor":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(log_biases=data)


# ── J3: Critic ────────────────────────────────────────────────────────────────

class Critic:
    """
    J3: State-value estimator V(s) for A3C.

    The value function is a linear model over a compact feature vector derived
    from TurnState.  Weights are updated by minimising (r + γ·V(s') - V(s))².

    Linear critic rationale
    -----------------------
    The "LLM-as-environment" setting differs from Atari: the state features
    (stress_index, turn_idx, n_history) are already semantically meaningful
    floats.  A linear critic avoids over-fitting to the small episode counts
    typical of a PhD comparison run (K1: 50 episodes × 3 arms).

    The Maverick LLM call in `estimate()` is used for the *residual* — the
    critic first computes the linear estimate, then optionally asks Maverick
    for a quality adjustment signal.  In unit tests, set `use_llm=False`.
    """

    FEATURE_NAMES = ("stress_index", "turn_progress", "history_len_norm",
                     "info_coverage", "repetition", "mode_idx", "bias")

    # Ordered list of all known modes — index is the feature value
    _MODE_ORDER = ["standard", "flooding", "deaddiction", "behaviour_change",
                   "negotiation", "mental_health", "professional_critique"]

    def __init__(self, weights: list[float] | None = None) -> None:
        n = len(self.FEATURE_NAMES)
        self.weights: list[float] = weights if weights is not None else [0.0] * n

    @classmethod
    def _mode_idx(cls, mode: str) -> float:
        """Normalised mode index ∈ [0, 1] for use as a feature."""
        try:
            idx = cls._MODE_ORDER.index(mode)
        except ValueError:
            idx = 0
        return idx / max(len(cls._MODE_ORDER) - 1, 1)

    @staticmethod
    def _features(state: TurnState, max_turns: int = MAX_TURNS) -> list[float]:
        return [
            state.stress_index,
            state.turn_idx / max(max_turns, 1),
            min(len(state.conversation_history), 20) / 20.0,
            state.info_coverage,
            1.0 if state.repetition_detected else 0.0,
            Critic._mode_idx(state.therapeutic_mode),
            1.0,                   # bias term
        ]

    def estimate(self, state: TurnState) -> float:
        """V(s) — expected discounted cumulative reward from state s."""
        feats = self._features(state)
        return sum(w * f for w, f in zip(self.weights, feats))

    def update(self, state: TurnState, target: float) -> float:
        """
        One-step TD update.  Returns the TD error (for logging).

        Δw = α · (target - V(s)) · ∇V(s)   where ∇V(s) = features(s)
        """
        v_s   = self.estimate(state)
        error = target - v_s
        feats = self._features(state)
        for i, f in enumerate(feats):
            self.weights[i] += ALPHA_LR * error * f
        return error

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({"weights": self.weights}), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Critic":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        weights = data["weights"]
        expected = len(cls.FEATURE_NAMES)
        # Backward compat: old checkpoints have 6 weights; new has 7 (mode_idx added).
        # Pad with 0.0 for the new mode_idx weight (inserted at index 5, before bias).
        if len(weights) == expected - 1:
            weights = weights[:-1] + [0.0] + [weights[-1]]
        return cls(weights=weights)


# ── J4: Advantage and update orchestration ────────────────────────────────────

def compute_advantage(
    reward: float,
    v_current: float,
    v_next: float,
    discount: float = GAMMA_DISCOUNT,
) -> float:
    """
    A(s,a) = r + γ·V(s') − V(s)

    Positive advantage: the action performed *better* than expected → increase
    its log-bias.  Negative: *worse* than expected → decrease it.

    The A3C paper uses n-step returns for stability.  We use 1-step here
    because episodes are short (≤ MAX_TURNS) and the linear critic converges
    fast with limited data.  Switch to n-step in K1 if variance is too high.

    References: Mnih et al. (2016) §4.
    """
    return reward + discount * v_next - v_current


def apply_update(
    actor: Actor,
    critic: Critic,
    state: TurnState,
    next_state: TurnState | None,
    action: str,
    reward: float,
    terminal: bool = False,
    update_lock: "threading.Lock | None" = None,
) -> dict[str, float]:
    """
    J4: Full per-turn update.

    1.  Estimate V(s) and V(s') from critic.
    2.  Compute advantage A(s,a).
    3.  Update actor log-biases via policy gradient.
    4.  Update critic weights via TD(0).
    5.  Return metrics dict for logging.

    update_lock
    -----------
    When multiple async workers share the same Actor and Critic (true A3C),
    pass a threading.Lock here.  The entire read-modify-write (value estimate
    + both weight updates) is atomic under the lock so workers do not corrupt
    each other's log-bias tables or weight vectors.  Without a lock the
    updates are still correct on average (the original A3C paper shows they
    converge even with unsynchronised updates), but a lock eliminates the
    small probability of a torn write on CPython's GIL-release boundaries.
    """
    import threading as _threading
    _lock = update_lock or _threading.Lock()   # trivial no-op lock if none passed

    with _lock:
        v_s    = critic.estimate(state)
        v_next = 0.0 if (terminal or next_state is None) else critic.estimate(next_state)
        adv    = compute_advantage(reward, v_s, v_next)
        entropy = actor.entropy(state.stress_bucket, state.therapeutic_mode)

        actor.update(state.stress_bucket, action, adv + ENTROPY_COEF * entropy,
                     mode=state.therapeutic_mode)
        td_error = critic.update(state, reward + GAMMA_DISCOUNT * v_next)

    return {
        "v_s":        round(v_s, 5),
        "v_next":     round(v_next, 5),
        "advantage":  round(adv, 5),
        "td_error":   round(td_error, 5),
        "entropy":    round(entropy, 5),
        "reward":     round(reward, 5),
    }



# ── Heuristic scorer carry (odd-turn substitute) ─────────────────────────────

# Actions with well-understood positive impact on goal progress / trust.
_HIGH_VALUE_ACTIONS = frozenset({
    "elicit_change_talk", "explore_ambivalence", "reframe_perspective",
    "build_alliance", "validate_emotion", "clarify_goal", "invite_reflection",
    "suggest_coping_strategy", "summarise_session",
})
# Surface-level distress cues in patient message that lower expected quality.
_DISTRESS_CUES = ("I can't", "I give up", "this is pointless", "you don't understand",
                  "leave me alone", "I'm fine", "nothing helps", "why bother")


def _heuristic_score_carry(
    prev_score,
    action: str,
    patient_msg: str,
    agent_resp: str,
) -> TurnScoreResult:
    """
    Return a lightweight copy of `prev_score` adjusted by cheap heuristics.

    Called on odd turns to halve LLM scorer calls.  The adjustments are
    intentionally small (±0.05) to avoid drifting far from the LLM signal.
    """
    import copy

    carry = copy.copy(prev_score)

    # Small quality boost for high-value therapeutic actions
    boost = 0.05 if action in _HIGH_VALUE_ACTIONS else 0.0

    # Small quality penalty when patient shows distress cues
    pm_lower = patient_msg.lower()
    penalty  = 0.04 if any(c in pm_lower for c in _DISTRESS_CUES) else 0.0

    # Lift / drag continuous score within [0, 1]
    carry.continuous_score = max(0.0, min(1.0, prev_score.continuous_score + boost - penalty))

    # Never escalate critical_failure on a carry turn — only the LLM can set it
    carry.critical_failure = False

    return carry


# ── J1: A3CWorker base class ──────────────────────────────────────────────────

@dataclass
class EpisodeTurn:
    """Single turn record written to the episode jsonl log."""
    turn_idx:         int
    arm:              str
    state:            dict
    action:           str
    log_prob:         float
    patient_message:  str          # what the patient/participant said this turn
    response:         str          # what the companion said
    reward:           dict[str, float]
    scalar_reward:    float
    judge:            dict
    update_metrics:   dict
    tokens:           dict[str, int]
    latency_ms:       float
    cost_usd:         float = 0.0  # estimated USD cost for all LLM calls this turn
    llm_calls:        int   = 1    # number of LLM API calls this turn
    discrepancy:      Any = None


class A3CWorker:
    """
    J1: Episode runner and per-turn reward accumulator.

    Subclasses override `generate_response()` to implement all 24 experiment arms:

    Base (Exp 0–7):
      - OldschoolWorker                        (Exp 0): Classic JS via HTTP (no physio)
      - PhysioLLMWorker                        (Exp 1): Physio in prompt, no MCTS
      - PhysioLLMCoTMCTSWorker                 (Exp 2): PhysioLLM + CoT + MCTS
      - PhysioMPSMCTSWorker                    (Exp 3): Full HTN + MPS + MCTS
      - InertialPhysioMPSMCTSWorker            (Exp 4): Exp 3 + zone inertia
      - InertialPhysioLLMCoTMCTSWorker         (Exp 5): Exp 2 + zone inertia
      - InertialHPVOOTPhysioMPSMCTSWorker      (Exp 6): Exp 4 + HPVOOT
      - InertialHPVOOTPhysioLLMCoTMCTSWorker   (Exp 7): Exp 5 + HPVOOT

    Safety ablations (Exp 0a–7a): same as base but DISABLE_CRITICAL_FAILURE_GATE=True.
    DPO/RLAIF variants (Exp 0p–7p): same as base but PROMPT_VARIANT="dpo".

    Protocol
    --------
    1. Call `run_episode(scenario)` to execute one full episode.
    2. Each turn: build TurnState → select action → generate_response()
       → score reward → apply_update() → log turn.
    3. At episode end: flush jsonl, return EpisodeSummary.

    The worker does NOT own the Actor/Critic; it receives them by reference so
    async workers can share parameters (classic A3C global network pattern).
    """

    ARM: str = "base"   # overridden by subclasses

    # PROMPT_VARIANT: "baseline" for the 16 original experiments;
    # "dpo" for the 8 prompt-improved variants (Exp 0p–7p).
    # Written to every episode summary so the dashboard can group experiments
    # by treatment group without parsing the arm name.
    PROMPT_VARIANT: str = "baseline"

    # ── Experimental safety-veto flags ───────────────────────────────────────
    # These are class-level so that a subclass can disable a single safety
    # mechanism while inheriting all other behaviour unchanged.  Setting them
    # to True produces the "a" variant arms (Exp 0a–7a) used to measure each
    # gate's contribution to outcome metrics.
    #
    # DISABLE_CRITICAL_FAILURE_GATE:
    #   When True, the 2-strike critical-failure episode-termination rule is
    #   suppressed.  The episode runs to the configured max turns even when
    #   the patient would normally have triggered the safety cutoff.
    #   All 8 "a" ablation arms set this to True (Exp 0a–7a).
    DISABLE_CRITICAL_FAILURE_GATE: bool = False

    def __init__(
        self,
        actor: Actor,
        critic: Critic,
        run_dir: str | Path,
        worker_id: str | None = None,
        update_lock: "threading.Lock | None" = None,
    ) -> None:
        import threading as _threading
        self.actor       = actor
        self.critic      = critic
        self.run_dir     = Path(run_dir)
        self.worker_id   = worker_id or str(uuid.uuid4())[:8]
        # Shared lock used by apply_update() when multiple workers share one Actor/Critic.
        # None means single-worker mode — apply_update creates a trivial per-call lock.
        self.update_lock: "_threading.Lock | None" = update_lock
        self._episode_log: list[EpisodeTurn] = []

    # ── Subclass interface ───────────────────────────────────────────────────

    def update_system_prompt(self, new_prompt: str) -> None:
        """
        Replace the arm's active system prompt.  Called by PromptOptimizer.
        Subclasses that use a trainable prompt must override this.
        The base implementation is a no-op (for arms that use external prompts).
        """

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
    ) -> dict:
        """
        Generate a companion response for the current turn.

        Returns a dict with at minimum:
            response   : str    — the generated companion utterance
            reward     : dict   — {dim: float} reward signal
            judge      : dict   — HTN judge scores (may be empty at turn time)
            tokens     : dict   — {"scout": N, "maverick": M}
            latency_ms : float  — wall time for generation
        """
        raise NotImplementedError("Subclasses must implement generate_response()")

    def build_initial_state(self, scenario: dict) -> TurnState:
        """Build the turn-0 TurnState from scenario metadata."""
        return TurnState.from_scenario(scenario)

    def next_state(
        self,
        prev_state: TurnState,
        response_dict: dict,
        user_message: str,
        context_window: int = 60,
    ) -> TurnState:
        """
        Build the TurnState for the next turn from the previous state + response.

        context_window controls how many messages to keep in conversation_history
        (default 60 = 30 exchanges).  Pass scenario['context_window'] to override.
        """
        new_history = list(prev_state.conversation_history) + [
            {"role": "assistant", "content": response_dict.get("response", "")},
            {"role": "user",      "content": user_message},
        ]
        new_stress      = response_dict.get("next_stress_index", prev_state.stress_index)
        new_physio      = response_dict.get("next_physio", prev_state.physio)
        new_action      = response_dict.get("action_taken", prev_state.last_action)
        new_frames      = response_dict.get("frames_component", prev_state.frames_component)
        new_info_cov    = response_dict.get("info_coverage", prev_state.info_coverage)
        _overlap_score  = 0.0   # initialised here; overwritten by _compute_repetition below
        new_repetition  = response_dict.get("repetition_detected", False)
        # ── Python-side repetition detection (mirrors JS historyAnalyzer) ────
        # Compute n-gram overlap between the new response and recent assistant
        # turns.  Override the arm's placeholder False value with a real signal.
        _new_response_text = response_dict.get("response", "")
        _rep_computed, _overlap = _compute_repetition(
            list(prev_state.conversation_history), _new_response_text
        )
        # Use computed value if the arm returned the default placeholder (False).
        # Arms that genuinely detect repetition can still override via response_dict.
        if not new_repetition and _rep_computed:
            new_repetition = True
        _overlap_score = _overlap
        new_phase       = response_dict.get("deaddiction_phase", prev_state.deaddiction_phase)
        new_mode        = response_dict.get("therapeutic_mode", prev_state.therapeutic_mode)

        # Update conversation-inferred stress from scorer signal (running estimate).
        # _scorer_continuous is set by the episode runner after scoring each turn.
        # Higher score → patient engaged/accepting → conversation stress trends down.
        # Lower score or critical failure → patient resistant → stress trends up.
        _scorer_signal  = response_dict.get("_scorer_continuous", None)
        if _scorer_signal is not None:
            _conv_delta     = (0.55 - float(_scorer_signal)) * 0.15   # max ±0.083 per turn
            new_conv_stress = round(max(0.0, min(1.0,
                prev_state.conversation_stress + _conv_delta)), 4)
        else:
            new_conv_stress = prev_state.conversation_stress  # no scorer update this turn

        # keep known_context + longitudinal_hint: they are session-scoped, not turn-scoped
        return TurnState(
            turn_idx=prev_state.turn_idx + 1,
            stress_index=new_stress,
            stress_bucket=TurnState.bucket_from_stress(new_stress),
            conversation_history=new_history[-context_window:],
            physio=new_physio,
            therapeutic_mode=new_mode,
            deaddiction_phase=new_phase,
            last_action=new_action,
            session_goal=prev_state.session_goal,
            turn_count=prev_state.turn_count + 1,
            info_coverage=new_info_cov,
            repetition_detected=new_repetition,
            frames_component=new_frames,
            known_context=prev_state.known_context,
            longitudinal_hint=prev_state.longitudinal_hint,
            activity_context=response_dict.get("activity_context", prev_state.activity_context),
            archetype=prev_state.archetype,
            has_misconception=prev_state.has_misconception,
            flooding_target_stress=prev_state.flooding_target_stress,
            drug_regimen=prev_state.drug_regimen,
            physio_source=prev_state.physio_source,
            conversation_stress=new_conv_stress,
            session_id=prev_state.session_id,
            subject_id=prev_state.subject_id,
            future_plans_summary=prev_state.future_plans_summary,
            recent_n_gram_overlap=_overlap_score,
            # MCTS6: session boundary fields — clear after turn 0;
            # elapsed_since_last_s can be set by the episode runner via response_dict.
            session_gap_days=prev_state.session_gap_days,
            session_boundary=False,   # only True on the very first turn of a new session
            elapsed_since_last_s=float(response_dict.get("elapsed_since_last_s", 0.0)),
            # No-watch: physio_available is constant for the episode — carry forward.
            physio_available=prev_state.physio_available,
            # MCTS9: pending_event is episode-scoped — carry forward unchanged.
            pending_event=prev_state.pending_event,
            # AS2/AS3: carry session_count; reflex_detected is updated below.
            # PU3/PAN1: panic_mode updated from scorer; reflex_detected from LLM response.
            # OBS1: observation_uncertainty carried and updated by update_from_scorer_signals.
            session_count=prev_state.session_count,
            reflex_detected=bool(response_dict.get("reflex_detected", False)),
            panic_mode=bool(response_dict.get("panic_mode", prev_state.panic_mode)),
            observation_uncertainty=prev_state.observation_uncertainty,   # updated post-score
        )

    # ── Episode runner ───────────────────────────────────────────────────────

    # ── Hierarchical memory helpers ───────────────────────────────────────────

    _HIERMEM_SCOUT_SYSTEM = (
        "You are a clinical session analyst. "
        "Output ONLY a raw JSON object (no markdown). Start with { and end with }."
    )

    _HIERMEM_PROMPT = (
        "Session goal: {session_goal}\n"
        "Turns so far: {turn_count}\n\n"
        "Most recent {n_turns} turns:\n{recent_turns}\n\n"
        "{prior_summary_block}"
        "Produce a JSON object with EXACTLY these keys:\n"
        '  "arc_summary": one sentence (≤25 words) capturing the key clinical '
        "development this session so far,\n"
        '  "open_threads": array of ≤3 strings — unresolved themes worth revisiting,\n'
        '  "momentum": "positive" | "neutral" | "resistant" — patient engagement trend,\n'
        '  "key_facts": array of ≤3 short strings — most clinically important facts '
        "established this session.\n"
        "Do not repeat the prior summary verbatim; synthesise it."
    )

    def _update_session_arc(self, state: "TurnState", scenario: dict) -> "TurnState":
        """
        MEMORY-LLM G2: Incrementally update the session-arc summary.

        Called every 4 turns (or at session end).  Uses one Scout call to condense
        the last N turns + prior arc into a compact clinical narrative stored in
        state.summary.  This is the middle granularity between per-turn history
        and cross-session longitudinal_hint.

        Cost: 1 Scout call per 4 turns (≈ 25% overhead, acceptable for training).
        Gracefully falls back to prior summary if Scout fails.
        """
        # Only update every 4 turns or on the last turn to control LLM cost.
        if state.turn_count % 4 != 0 or state.turn_count == 0:
            return state

        try:
            import os, urllib.request, json as _j
            _url  = os.environ.get("TENSORNETS_URL", "http://localhost:8765")
            n_recent = 6
            recent = state.conversation_history[-n_recent:]
            recent_text = "\n".join(
                f"{m['role'].upper()}: {m['content'][:120]}"
                for m in recent
            )
            prior_block = ""
            if state.summary:
                prior_block = f"Prior session arc (from earlier turns):\n{state.summary}\n\n"

            prompt = self._HIERMEM_PROMPT.format(
                session_goal     = state.session_goal or "general support",
                turn_count       = state.turn_count,
                n_turns          = len(recent),
                recent_turns     = recent_text,
                prior_summary_block = prior_block,
            )
            payload   = {"system": self._HIERMEM_SCOUT_SYSTEM, "prompt": prompt,
                         "max_tokens": 200}
            data      = _j.dumps(payload).encode()
            req       = urllib.request.Request(
                f"{_url}/llm/scout", data=data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                raw = _j.loads(resp.read().decode())
            text = raw.get("text", "").strip()
            bstart, bend = text.find("{"), text.rfind("}")
            if bstart != -1 and bend != -1:
                parsed = _j.loads(text[bstart: bend + 1])
                arc    = parsed.get("arc_summary", "")
                threads = parsed.get("open_threads", [])
                facts   = parsed.get("key_facts",   [])
                momentum = parsed.get("momentum",   "neutral")
                summary = (
                    f"[Arc] {arc} "
                    f"[Momentum: {momentum}] "
                )
                if threads:
                    summary += f"[Open: {'; '.join(threads[:3])}] "
                if facts:
                    summary += f"[Facts: {'; '.join(facts[:3])}]"
                state = state.__class__(
                    **{**state.__dict__, "summary": summary.strip()}
                )
        except Exception as exc:
            log.debug("[HIERMEM] session arc update failed (non-fatal): %s", exc)
        return state

    def _build_hierarchical_memory_block(self, state: "TurnState") -> str:
        """
        MEMORY-LLM: Assemble the three-granularity memory block injected into
        known_context at episode start and refreshed every 4 turns.

        G1 — Turn-recent   : last 4 turns in conversation_history (raw)
        G2 — Session-arc   : state.summary (LLM-condensed arc; updated every 4t)
        G3 — Cross-session : longitudinal_hint + future_plans_summary + BeliefGraph hints

        Only non-empty sections are included.  The block starts with a header so
        the LLM understands the granularity hierarchy.
        """
        parts: list[str] = []

        # G2: session arc
        if state.summary:
            parts.append(f"[Session arc] {state.summary}")

        # G3: cross-session longitudinal hint
        hint = (getattr(state, "longitudinal_hint", None) or "").strip()
        if hint:
            parts.append(f"[Prior sessions] {hint}")

        # G3: future plans / commitments from prior sessions
        fp = (getattr(state, "future_plans_summary", None) or "").strip()
        if fp:
            parts.append(f"[Future plans] {fp}")

        if not parts:
            return ""
        return "[Clinical memory — three granularities]\n" + "\n".join(parts)

    def run_episode(
        self,
        scenario: dict,
        prior_session: "dict | None" = None,
        patient_mode:  str = "llm",
        episode_id:    "str | None" = None,
        run_id:        "str | None" = None,
    ) -> dict:
        """
        Execute one full episode with a live SyntheticPatient and A3CScorer.

        Parameters
        ----------
        scenario       : Scenario dict from the JS /api/scenarios endpoint.
                         Required keys: scenario_id, initial_physio, session_goal,
                         therapeutic_mode, required_elements, patient_prompt.
                         Optional: max_turns, context_window, users (for multi-user).
        prior_session  : Optional dict from a previous episode's summary['session_memory'].
                         If provided, the episode continues from the end of that session
                         (multi-session continuity, Q5a).  The prior TurnState, covered
                         elements, and conversation history are pre-loaded.
        patient_mode   : 'llm' (default) or 'scripted'.

        Returns
        -------
        EpisodeSummary dict with 'session_memory' key for continuation.

        Early termination
        -----------------
        The episode stops early if:
        (a) A3CScorer detects semantically flat repetition (Q4b), or
        (b) A TurnScoreResult has critical_failure=True AND the agent has been
            warned at least once (2-strike rule).

        Grace period for turns 0–2: during rapport-building, `denial` and
        `generic_response` scoring ≤ -2 are expected behaviour and do not
        count as qualifying strikes.  Only `urgency` ≤ -2 (a real safety signal)
        triggers the 2-strike logic in the early turns.

        The repetition penalty from A3CScorer is added to REWARD_DIMS['count_penalty']
        so the Actor learns to avoid semantic flatness without hard rule gating.

        Multi-session continuity (Q5a)
        --------------------------------
        If prior_session is given, the state, conversation history, covered_elements,
        and archetype are reloaded from it.  The scenario may be the same or different
        (same personas, any scenario).  The session_goal from the new scenario overrides
        the prior session's goal so the patient reacts to the new clinical objective.
        """
        from tensornets.a3c.synthetic_patient import CareCircleOrchestrator, _normalise_role

        # Use caller-supplied id (so JSONL filename == DB episode_id) or generate fresh.
        episode_id           = episode_id or str(uuid.uuid4())
        self._current_run_id = run_id or ""   # stored for _log_turn_to_db
        self._episode_log    = []
        cumulative_reward = 0.0
        score_history:    list = []

        max_turns_ep   = scenario.get("max_turns",    MAX_TURNS)
        context_window = scenario.get("context_window", 60)

        # Build initial state — load from prior session if given
        state = self._build_state_with_continuity(scenario, prior_session)

        # ── Social Alliance Graph — load or create for this circle ───────────────
        # circle_id uses subject_id so alliance persists across chained episodes.
        _alliance_circle_id = (
            scenario.get("subject_id") or scenario.get("scenario_id") or "synthetic"
        )
        _alliance_state_dir = Path(self.run_dir).parent.parent / "state"
        try:
            from tensornets.agents.social_alliance import AllianceGraph, signals_from_score_result
            _alliance_graph = AllianceGraph.load_or_create(
                state_dir = _alliance_state_dir,
                circle_id = _alliance_circle_id,
                members   = ["companion", "patient"],
            )
            _alliance_graph.apply_cross_session_decay()
        except Exception:
            _alliance_graph = None

        # ── C6.1: ReactivityProfile — instantiate from archetype string ──────────
        # Maps the scenario/persona archetype to a ReactivityProfile that modifies
        # the Γ operator (autonomic recovery) based on trait-level reactivity.
        reactivity_profile = _build_reactivity_profile(
            subject_id = state.subject_id,
            archetype  = state.archetype,
        )
        if reactivity_profile:
            log.debug("[%s] ReactivityProfile: archetype=%s → %s",
                      self.worker_id, state.archetype, reactivity_profile.archetype.value)

        # Build care-circle orchestrator (handles multi-user speaker selection)
        orchestrator = CareCircleOrchestrator.from_scenario(
            scenario,
            mode     = patient_mode,
            rng_seed = hash(episode_id) & 0xFFFF,
        )
        # If continuing a session, reload the patient's covered elements
        if prior_session:
            covered = set(prior_session.get("covered_elements", []))
            orchestrator.primary_patient.covered_elements = covered
            orchestrator.primary_patient.current_goal_idx = prior_session.get("goal_idx", 0)
            # Reload conversation history into the patient
            for m in state.conversation_history:
                orchestrator.primary_patient.conversation_history.append(m)

        # ── PhysioSimulator for longitudinal per-participant dynamics ────────────
        from tensornets.a3c.physio_simulator import PhysioSimulator as _PhysioSim
        _physio_sim = _PhysioSim(seed=hash(episode_id) & 0xFFFF)

        # ── V_int / SharedTensorBuffer — G3 social coupling ───────────────────────
        # One slot per participant. V_int propagates HRV deltas between agents
        # after each speaker turn so the next companion sees updated physio context.
        # circle_id is derived from the scenario's subject_id so alliances persist
        # across chained episodes for the same synthetic patient.
        SharedTensorBuffer = _get_shared_tensor_buffer()
        vint_buf = None
        # Use subject_id or scenario_id as stable circle identifier for
        # cross-session alliance persistence.
        _vint_circle_id = (
            scenario.get("subject_id") or scenario.get("scenario_id") or "synthetic"
        )
        if SharedTensorBuffer is not None and len(orchestrator.participants) > 1:
            agents = [
                {"agent_id": p.role, "role": _normalise_role(p.role)}
                for p in orchestrator.participants
            ]
            # Add a "companion" slot — the companion's calm presence also propagates
            agents.append({"agent_id": "companion", "role": "companion"})
            try:
                vint_buf = SharedTensorBuffer(agents, circle_id=_vint_circle_id)
                # Seed each slot with initial HRV from scenario physio
                init_hrv = state.physio.get("hrv_ms", 35.0)
                for a in agents:
                    vint_buf.put_mps(a["agent_id"], None, init_hrv)
            except Exception as exc:
                log.debug("[%s] SharedTensorBuffer init failed (non-fatal): %s",
                          self.worker_id, exc)
                vint_buf = None

        # ── SharedDialogueState — cross-companion consistency tracking ───────────
        # Records commitments made by each agent during the episode.
        # Before each companion response, the consistency_hint() is injected into
        # known_context so the companion avoids contradicting prior statements.
        # This implements the semantic layer of cross-companion coordination.
        SharedDialogueState = _get_shared_dialogue_state()
        dialogue_state = None
        is_world_scenario = len(orchestrator.participants) > 1
        if SharedDialogueState is not None:
            try:
                dialogue_state = SharedDialogueState(
                    session_id = episode_id,
                    agents     = [_normalise_role(p.role) for p in orchestrator.participants],
                )
            except Exception as exc:
                log.debug("[%s] SharedDialogueState init failed (non-fatal): %s",
                          self.worker_id, exc)
                dialogue_state = None

        scorer         = A3CScorer()
        warned_once    = False
        last_user_msg  = ""
        redirect_streak = 0   # consecutive turns companion redirected despite patient avoidance
        prev_physio: dict | None = None   # for HRV trend and EDA spike detection
        # LLM scorer is called on even turns (0, 2, 4 …) and skipped on odd turns.
        # Odd turns use the most-recent LLM result plus a lightweight heuristic

        # ── Genuine progress metric trackers ─────────────────────────────────
        # These are computed over the episode and added to the episode summary.
        # They provide methodologically independent measures of progress,
        # not circular wrt action selection heuristics.
        _stress_samples: list[float] = []
        _turns_to_goal: int | None   = None   # first turn where info_coverage ≥ 0.75
        _start_change_stage: str     = state.deaddiction_phase
        _trust_acc: float            = 0.0    # accumulated trust_delta over episode
        _ended_crit_fail: bool       = False  # set True when 2-strike break fires
        _ended_dropout: bool         = False  # set True when synthetic user drops out
        # Escalation tracking: used for the terminal escalation bonus/penalty.
        # escalation_expected = scenario flags that a correct escalation should occur.
        # _escalation_occurred = we saw at least one escalation_quality > 0 from scorer.
        # _escalation_missed   = escalation was expected but scorer never gave quality > 0.
        _escalation_expected: bool = bool(scenario.get("escalation_expected", False))
        _escalation_occurred: bool = False

        # ── Inject alliance context into known_context at episode start ──────────
        # The companion prompt gets a one-line summary of the current alliance state.
        _belief_graph = None  # PU1: loaded below if available
        if _alliance_graph is not None:
            try:
                # PU1: Load BeliefGraph for this subject and inject safe/risky hints.
                # Cost: 0 extra LLM calls — belief_graph.prompt_context() is purely local.
                # Effect: Scout knows which beliefs are foundational vs. peripheral
                #         before generating any response this episode.
                try:
                    from tensornets.agents.belief_graph import load_belief_graph, BeliefGraph
                    _belief_graph = load_belief_graph(state.subject_id)
                    if _belief_graph is None:
                        # Cold-start: no saved belief graph for this user.
                        # Create an empty graph — beliefs will be populated by
                        # extract_beliefs_from_turn() during the episode.
                        _belief_graph = BeliefGraph(subject_id=state.subject_id)
                    # FOR1: apply memory fade proportional to session gap before episode starts
                    if state.session_gap_days > 0 and len(_belief_graph.nodes) > 0:
                        _faded = _belief_graph.apply_memory_fade(state.session_gap_days)
                        if _faded:
                            import logging as _lg
                            _lg.getLogger(__name__).debug(
                                "[BG/FOR1] Applied memory fade (gap=%.1f days): %d beliefs faded",
                                state.session_gap_days, len(_faded),
                            )
                except Exception:
                    _belief_graph = None

                _alliance_ctx = _alliance_graph.prompt_context_for(
                    companion_role="companion",
                    patient_role  ="patient",
                    belief_graph  =_belief_graph,
                )
                existing_ctx = state.known_context or ""
                state = state.__class__(
                    **{**state.__dict__,
                       "known_context": (_alliance_ctx + "\n\n" + existing_ctx).strip()}
                )
            except Exception:
                pass

        # PU2: Inject CommunicationRegime + RelationshipType into known_context.
        # This is separate from the alliance block so it can be injected even
        # when the full AllianceGraph is not available (e.g., early training episodes).
        try:
            if _alliance_graph is not None:
                _cp_edge = _alliance_graph.get_edge("companion", "patient")
                _regime  = _cp_edge.detect_communication_regime()
                _rel_type = _cp_edge.relationship_type
                _comm_temp = _cp_edge.comm_temp

                # MA-MCTS3: propagate coupling_tensor onto TurnState so generate_response
                # can include it in the MCTS payload (real value instead of 0.55 default).
                # MA-MCTS4: also propagate topic_engagement + topic_alignment dicts.
                state = state.__class__(
                    **{
                        **state.__dict__,
                        "coupling_tensor":  float(_cp_edge.coupling_tensor),
                        "topic_engagement": dict(_cp_edge.topic_engagement),
                        "topic_alignment":  dict(_cp_edge.topic_alignment),
                    }
                )
                if _regime not in ("standard", "") or _rel_type not in ("unknown", ""):
                    _pu2_block = (
                        f"[Patient Relationship]\n"
                        f"Type: {_rel_type}  |  Temp: {_comm_temp}  |  Regime: {_regime}\n"
                        f"Adapt your language register: "
                        + {
                            "cold_conflict":       "establish safety first; no advice yet.",
                            "warm_collaborative":  "full therapeutic range available.",
                            "professional_distant":"formal register; avoid over-familiarity.",
                            "enmeshed_flooded":    "calm, low-affect language; avoid emotional amplification.",
                            "guarded_negotiation": "rupture is pending; repair before goal-setting.",
                        }.get(_regime, "standard approach.")
                    )
                    existing_ctx = state.known_context or ""
                    state = state.__class__(
                        **{**state.__dict__,
                           "known_context": (_pu2_block + "\n\n" + existing_ctx).strip()}
                    )
        except Exception:
            pass

        # PU3: Inject reflex_mode and panic_mode into known_context.
        # Ensures Scout-generated language matches the action gate applied by MCTS.
        # E.g. if reflex_detected=True, MCTS blocked deliberated actions — the text
        # should also be short, concrete, not explanatory.
        try:
            _reflex = getattr(state, "reflex_detected", False)
            _panic  = getattr(state, "panic_mode",      False)
            if _reflex or _panic:
                _mode_label = "panic" if _panic else "reflex"
                _mode_hints = {
                    "panic":  (
                        "[Patient Mode: PANIC]\n"
                        "Patient is hypervigilant and rejecting advice. "
                        "Use presence only — no goals, no explanations, no solutions. "
                        "Short sentences. Validate and wait."
                    ),
                    "reflex": (
                        "[Patient Mode: REFLEX]\n"
                        "Patient is in reactive mode (short, closed, fight/flight). "
                        "Use concrete, 1–2 sentence responses. "
                        "Avoid multi-step explanations or motivational prompts."
                    ),
                }
                _pu3_block = _mode_hints[_mode_label]
                existing_ctx = state.known_context or ""
                state = state.__class__(
                    **{**state.__dict__,
                       "known_context": (_pu3_block + "\n\n" + existing_ctx).strip()}
                )
        except Exception:
            pass

        # With only 10-15 turns per episode and a 0.75 info_coverage threshold
        # to achieve the goal, skipping odd turns cuts goal-coverage opportunities
        # nearly in half.  The extra Scout calls increase episode cost slightly
        # but are worth it for accurate gradient signal.
        _SCORE_EVERY_N = 1

        # MEMORY-LLM G3: inject hierarchical cross-session memory into known_context
        # at episode start (G3 layer — cross-session and prior arc from prior_session).
        # Within-episode arc updates (G2) are applied every 4 turns in the turn loop.
        try:
            _hiermem_block = self._build_hierarchical_memory_block(state)
            if _hiermem_block:
                existing_ctx = state.known_context or ""
                state = state.__class__(
                    **{**state.__dict__,
                       "known_context": (_hiermem_block + "\n\n" + existing_ctx).strip()}
                )
        except Exception as _hme:
            log.debug("[HIERMEM] G3 episode-start injection failed (non-fatal): %s", _hme)

        for turn_idx in range(max_turns_ep):
            t_start = time.perf_counter()

            # ── Actor selects action(s) ──────────────────────────────────────
            action, log_prob = self.actor.select(state)

            # ── Cross-companion: inject consistency hint before response ─────
            # Before the companion generates its response, inject any commitments
            # made by other agents in this episode into known_context.
            # This prevents the companion from contradicting the clinician's advice
            # or repeating information another companion already delivered.
            if dialogue_state is not None:
                try:
                    cc_hint = dialogue_state.consistency_hint(requesting_agent="companion")
                    if cc_hint:
                        state = state.__class__(
                            **{**state.__dict__,
                               "known_context": (cc_hint + "\n\n" +
                                                 state.known_context).strip()}
                        )
                except Exception:
                    pass

            # ── Generate companion response ──────────────────────────────────
            # Compute conversation_correction from previous turn's score_result.
            # Positive = patient more resistant than expected → push σ up.
            # Negative = patient more accepting / info-sharing → pull σ down.
            # First turn has no prior score, so correction is 0.
            if score_history:
                prev = score_history[-1]
                # critical_failure or very low score → patient rejected the strategy
                # high info_gain + high continuous_score → patient accepted / opened up
                _expected_score = 0.55  # neutral expectation per turn
                _discrepancy    = _expected_score - prev.continuous_score   # + = worse than expected
                _conv_correction = round(max(-0.05, min(0.05, _discrepancy * 0.3)), 4)
            else:
                _conv_correction = 0.0

            resp_dict  = self.generate_response(
                state, action, scenario,
                conversation_correction=_conv_correction,
            )
            agent_resp = resp_dict.get("response", "")

            # ── SyntheticPatient generates the patient turn ──────────────────
            speaker, patient_msg, conv_ctx = orchestrator.next_turn(
                agent_response   = agent_resp,
                turn_idx         = turn_idx,
                covered_elements = orchestrator.covered_elements,
            )

            # ── V_int: propagate speaker's HRV delta to all other agents ─────
            # After the speaker generates their turn, their physio may have shifted.
            # We use conv_ctx.emotional_tension as a proxy for HRV change: higher
            # tension → lower HRV. The propagation updates other participants'
            # expected HRV before the companion generates the next response.
            vint_updates: dict[str, float] = {}
            if vint_buf is not None:
                speaker_role  = _normalise_role(speaker.role)
                # Estimate speaker's current HRV from emotional tension (rough proxy)
                tension       = getattr(conv_ctx, "emotional_tension", 2.5)  # 0–5 scale
                speaker_hrv   = max(10.0, 55.0 - tension * 8.0)   # tension 0→55ms, 5→15ms
                try:
                    vint_updates = vint_buf.v_int_propagate(speaker_role, speaker_hrv)
                    # If companion action was calming, also propagate companion HRV
                    if action in ("validate", "empathic_reflection", "breathing_exercise",
                                  "mindfulness_prompt", "validate_emotion", "acknowledge_only"):
                        companion_hrv = 60.0   # companion stays calm; propagates calm
                        vint_buf.v_int_propagate("companion", companion_hrv)
                except Exception:
                    pass   # non-fatal; never block training on V_int failures

            # Inject V_int consistency hint into state for next turn's companion call.
            # The hint warns the companion if any participant is in high stress
            # so it doesn't deliver complex information at the wrong moment.
            if vint_updates and vint_buf is not None:
                try:
                    consistency_hint = vint_buf.consistency_hint()
                    # Append to known_context so it reaches the companion's prompt
                    if consistency_hint and state.known_context is not None:
                        state = state.__class__(
                            **{**state.__dict__,
                               "known_context": (state.known_context + "\n\n" +
                                                 consistency_hint).strip()}
                        )
                except Exception:
                    pass

            # ── Cross-companion: record companion's commitment ────────────────
            # After the companion speaks, extract any clinical commitments from
            # the response and store them in the SharedDialogueState so other
            # companions (next turn) won't contradict them.
            if dialogue_state is not None and agent_resp:
                try:
                    dialogue_state.turn = turn_idx
                    # Classify as clinical if action is in an advisory group
                    is_clinical_action = action in (
                        "psychoeducation", "direct_advice", "negotiate_compromise",
                        "schedule_commitment", "future_planning", "relapse_plan",
                        "motivational_interviewing", "challenge_distortion",
                    )
                    # Only log substantive responses (not generic short deflections)
                    if len(agent_resp) > 60:
                        dialogue_state.add_commitment(
                            agent_id    = "companion",
                            statement   = agent_resp[:200],   # truncated for memory
                            topic       = action,
                            is_clinical = is_clinical_action,
                        )
                    # Record speaker's HRV prediction from V_int
                    if vint_updates:
                        for rcv_role, hrv in vint_updates.items():
                            if rcv_role in dialogue_state.agents:
                                dialogue_state.agent_hrv_predictions[rcv_role] = hrv
                except Exception:
                    pass

            # ── A3CScorer: LLM call on even turns, heuristic carry on odd ───
            use_llm_scorer = (turn_idx % _SCORE_EVERY_N == 0)
            if use_llm_scorer:
                # TensorRAG: retrieve physio-conditioned context for this turn's scoring.
                # Adds clinical knowledge relevant to the patient's current state so the
                # LLM scorer has access to guidelines rather than reasoning from scratch.
                _rag_context = ""
                try:
                    _rag = _get_worker_rag()
                    if _rag is not None:
                        _physio = state.physio or {}
                        _rag_context = _rag.query_context(
                            text        = f"{patient_msg} {agent_resp}",
                            physio_dict = {
                                "hrv_ms":            float(_physio.get("hrv_rmssd_ms", 35.0) or 35.0),
                                "stress_index":      float(_physio.get("stress_index",  0.3)  or 0.3),
                                "sleep_quality":     float(_physio.get("sleep_quality", 1.0)  or 1.0),
                                "therapeutic_stage": float(_physio.get("stage_index",   0.0)  or 0.0),
                            },
                            k       = 3,
                            sources = ["clinical_kb"],   # only KB in scorer (episode memory in companion)
                            max_chars = 800,
                        )
                except Exception:
                    _rag_context = ""

                score_result = scorer.score_turn(
                    patient_message   = patient_msg,
                    agent_response    = agent_resp,
                    turn_idx          = turn_idx,
                    therapeutic_mode  = state.therapeutic_mode,
                    # Use the arm's freshly-inferred phase if available (resp_dict may
                    # have detected a stage transition this turn). Falls back to the
                    # state value if the arm didn't return a new phase.
                    change_stage      = resp_dict.get("deaddiction_phase", state.deaddiction_phase),
                    scenario_goal     = state.session_goal,
                    scenario_context  = scenario.get("context", ""),
                    history           = state.conversation_history,
                    physio            = state.physio or None,
                    goal_descriptions = scenario.get("goal_descriptions") or None,
                    # Pass recent clinical commitments so the scorer can detect contradictions.
                    commitment_context = (
                        dialogue_state.consistency_hint("companion")
                        if dialogue_state and dialogue_state.commitments
                        else ""
                    ),
                    rag_context       = _rag_context,
                )
            else:
                # Carry the previous score result but apply a heuristic nudge:
                # if the action is in a high-value group, lift continuous_score
                # slightly; if the patient message contains a distress cue, lower it.
                score_result = _heuristic_score_carry(
                    prev_score    = score_result,
                    action        = action,
                    patient_msg   = patient_msg,
                    agent_resp    = agent_resp,
                )
            score_history.append(score_result)

            # ── OBS1: Update ObservationUncertainty from scorer signals ─────
            # The scorer already detects contradictions, probing quality, etc.
            # We extract those signals and update the observation uncertainty model.
            # This updates state.observation_uncertainty in-place (dict carried forward).
            try:
                from tensornets.agents.observation_uncertainty import (
                    ObservationUncertainty, update_from_scorer_signals,
                )
                # MULTI-ROLE: observation_uncertainty is now keyed by participant role.
                # Backward-compat: if the top-level dict has mode keys directly (old format),
                # treat the whole dict as the patient's obs.
                _obs_all = state.observation_uncertainty or {}
                _is_role_keyed = "patient" in _obs_all or "caregiver" in _obs_all
                _obs_dict = _obs_all.get("patient", _obs_all) if _is_role_keyed else _obs_all
                _obs = ObservationUncertainty.from_dict(_obs_dict) if _obs_dict else ObservationUncertainty()
                # OBS1 / independence principle:
                # obs_* fields target the PATIENT's self-report reliability.
                # commitment_contradiction_score / consent_respect_score target the AGENT's quality.
                # These two dimensions must NOT be mixed: agent contradicting itself is a training
                # signal for A3C reward, not a signal that the patient is being deceptive.
                # The dedicated obs_* fields were added to the A3CScorer prompt precisely to keep
                # patient-reliability signals independent of agent-quality signals.
                _scorer_signals = {
                    # Patient-side: dedicated obs_* fields added to scorer JSON output.
                    # These evaluate whether the PATIENT's message shows distortion signals.
                    "obs_contradiction_score": score_result.dimensions.get("obs_contradiction_score", 0),
                    "obs_avoidance_score":      score_result.dimensions.get("obs_avoidance_score", 0),
                    "obs_confidence_mismatch":  float(score_result.dimensions.get("obs_confidence_mismatch", 0.0)),
                    "obs_distortion_modes":     score_result.dimensions.get("obs_distortion_modes", []),
                    # Common signals: these are neutral indicators (not agent vs patient)
                    "probing_score":            score_result.dimensions.get("probing_score", 0),
                    "info_novelty":             score_result.info_novelty,
                }
                _obs = update_from_scorer_signals(_obs, _scorer_signals, state.stress_index)
                # Inject OBS hint into state for next turn's context
                _obs_hint = _obs.prompt_context()
                # Write back under role-keyed structure; merge with any existing caregiver obs
                _new_obs_all = dict(_obs_all)  # preserve other roles (caregiver, clinician)
                _new_obs_all["patient"] = _obs.to_dict()
                state = state.__class__(
                    **{**state.__dict__,
                       "observation_uncertainty": _new_obs_all,
                       "known_context": (
                           (_obs_hint + "\n\n" + (state.known_context or "")).strip()
                           if _obs_hint else state.known_context
                       )}
                )
            except Exception:
                pass

            # ── BG2: Extract beliefs from patient turn (every 3 turns) ────────
            # Uses Scout (1 LLM call) to parse beliefs from the patient's message.
            # Gated to every 3rd turn to stay within Bedrock budget.
            # Only runs when a _belief_graph is attached (arms that loaded one at
            # episode start).  The extracted beliefs are merged into the graph and
            # persisted at episode end alongside the alliance state.
            try:
                if (
                    patient_msg
                    and turn_number % 3 == 0   # every 3rd turn
                    and _belief_graph is not None
                ):
                    from tensornets.agents.belief_graph import (
                        extract_beliefs_from_turn, save_belief_graph,
                    )
                    raw_beliefs = extract_beliefs_from_turn(
                        text    = patient_msg,
                        role    = "patient",
                        arm     = getattr(self, "ARM", "belief_graph"),
                    )
                    for b in raw_beliefs:
                        _belief_graph.add_or_update({
                            "id":             b.get("id", ""),
                            "text":           b.get("text", ""),
                            "confidence":     float(b.get("confidence", 0.5)),
                            "valence":        int(b.get("valence", 0)),
                            "identity_linked": bool(b.get("identity_linked", False)),
                            # Provenance: stress and credibility at extraction time
                            "patient_stress":  state.stress_index,
                            "obs_credibility": (
                                state.observation_uncertainty.get("_credibility", 1.0)
                                if isinstance(state.observation_uncertainty, dict)
                                else 1.0
                            ),
                            "speaker_role":    "patient",
                        })
            except Exception:
                pass

            # ── EXP-22: Belief-node topic coupling update (LLM-driven) ───────
            # If this arm sets USE_BELIEF_TOPIC_COUPLING=True and both alliance
            # graph and belief graph are loaded, update per-belief-node coupling
            # scalars using a Scout call instead of keyword-heuristic topics.
            # Gated to every other turn to save Bedrock budget.
            try:
                if (
                    getattr(self, "USE_BELIEF_TOPIC_COUPLING", False)
                    and _alliance_graph is not None
                    and _belief_graph is not None
                    and patient_msg
                    and agent_reply
                    and turn_number % 2 == 0
                ):
                    _cp_edge = _alliance_graph.get_edge("companion", "patient")
                    _active_nodes = _belief_graph.get_active_nodes(top_n=6)
                    if _active_nodes:
                        from tensornets.agents.observation_uncertainty import (
                            _scout_call_sync,
                        )
                        _cp_edge.update_coupling_from_belief_turn(
                            belief_nodes       = _active_nodes,
                            patient_text       = patient_msg,
                            companion_response = agent_reply,
                            llm_fn             = _scout_call_sync,
                        )
            except Exception:
                pass


            scorer_reward_dims = map_scorer_to_reward_dims(score_result)

            # ── Info gain from scorer (no extra LLM call) ─────────────────────
            # novelty + relevance are now part of the scorer's JSON output,
            # so the A3CScorer call (every 2 turns) covers both quality scoring
            # AND info gain.  On carry turns, the previous score_result's values
            # are reused via the heuristic carry — same cost as before.
            #
            # TASK 1 FIX: _auto_ tokens were fired on BOTH scorer turns AND carry
            # turns because _heuristic_score_carry preserves info_novelty/relevance
            # unchanged, making info_gain carry its previous value.  This caused
            # double-fire: coverage filled in ~n_goals turns instead of ~2*n_goals.
            # Fix: only add covered_goals on real scorer turns (use_llm_scorer=True).
            #
            # TASK 2: Replace synthetic _auto_ tokens with real goal strings from
            # the scorer's covered_goals field.  score_and_advance() is called with
            # the pre-computed covered list so no second LLM call is made.
            covered_from_scorer: list[str] = (
                score_result.covered_goals if use_llm_scorer else []
            )
            info_gain_result = {
                "gain":      score_result.info_gain,
                "novelty":   score_result.info_novelty,
                "relevance": score_result.info_relevance,
                "covered":   covered_from_scorer,
            }
            # On scorer turns, wire real goal strings into covered_elements via
            # score_and_advance() (no extra LLM call — covered list is passed in).
            # On carry turns, only advance the goal pointer without adding new coverage.
            try:
                if use_llm_scorer:
                    orchestrator.primary_patient.score_and_advance(
                        agent_resp, turn_idx, covered=covered_from_scorer
                    )
                else:
                    orchestrator.primary_patient._advance_goal_pointer()
            except Exception:
                import logging as _log
                _log.getLogger("tensornets.a3c.worker").warning(
                    "score_and_advance failed at turn %d — coverage not updated", turn_idx
                )

            # Inject onto state for compute_reward() in arms.py
            state._orchestrator_coverage = info_gain_result["gain"]
            state._info_novelty          = info_gain_result["novelty"]
            arm_reward_dims    = resp_dict.get("reward", {dim: 0.5 for dim in REWARD_DIMS})

            # ── Pestering penalty & rapport bonus ────────────────────────────
            # Track how many consecutive turns the patient deflected/redirected
            # and the companion still steered back to the clinical topic.
            # A patient "redirect" is any message asking to change topic or
            # discussing something off-topic (sports, family, work anecdotes).
            _REDIRECT_PHRASES = (
                "can we talk about something else", "speak about something else",
                "change the subject", "don't want to talk about", "let's move on",
                "by the way", "speaking of which", "did you hear", "how about",
                "catch the game", "my team", "coffee shop", "summer plans",
            )
            patient_redirected = any(
                p in patient_msg.lower() for p in _REDIRECT_PHRASES
            )
            # A "clinical push" is the companion re-introducing the health topic
            # after the patient has redirected.
            _CLINICAL_PUSH = (
                "your drinking", "alcohol", "your health", "your doctor",
                "cut back", "your liver", "your diagnosis", "your medication",
                "behaviour change", "your smoking", "your condition",
            )
            companion_pushed_clinical = any(
                p in agent_resp.lower() for p in _CLINICAL_PUSH
            )

            if patient_redirected and companion_pushed_clinical:
                redirect_streak += 1
            else:
                redirect_streak = 0

            # Penalty starts at streak=2 (one gentle redirect is acceptable),
            # capped at 0.3 so it doesn't dominate the reward signal.
            pester_penalty = min(0.3, max(0.0, (redirect_streak - 1) * 0.10))

            # ── Rapport bonus ─────────────────────────────────────────────────
            # Small reward (+0.07) when the companion genuinely engages with
            # something the patient raised (sport, family, hobby, work anecdote)
            # WITHOUT immediately redirecting to a clinical topic.
            # This reinforces "person first, problem second" (MI spirit).
            # The bonus is intentionally small — it should never outweigh safety.
            _PERSONAL_TOPICS = (
                "that sounds", "tell me more", "what happened", "how did that go",
                "what do you enjoy", "that must", "sounds like", "what was it like",
                "that's interesting", "i can imagine", "how are things with",
            )
            companion_engaged_personally = (
                any(p in agent_resp.lower() for p in _PERSONAL_TOPICS)
                and not companion_pushed_clinical
            )
            rapport_bonus = 0.07 if (patient_redirected and companion_engaged_personally) else 0.0

            # Merge: scorer dims override for quality/safety; arm dims for
            # stress/trust where the arm has richer context.
            # info_coverage now uses the LLM-scored gain (novelty + relevance)
            # instead of the keyword-match coverage_fraction.
            reward_dict = {
                "stress":        arm_reward_dims.get("stress",        scorer_reward_dims["stress"]),
                "trust_delta":   scorer_reward_dims["trust_delta"],
                "goal_progress": scorer_reward_dims["goal_progress"],
                "info_coverage": info_gain_result["gain"],       # LLM novelty+relevance
                "info_novelty":  info_gain_result["novelty"],    # logged separately
                "consistency":   scorer_reward_dims["consistency"],
                "safety":        scorer_reward_dims["safety"],
                "count_penalty": scorer_reward_dims["count_penalty"],
            }

            # count_penalty is subtracted (high repetition → negative reward)
            rep_penalty = 1.0 - score_result.repetition_penalty
            reward_dict["count_penalty"] = rep_penalty

            # ── Physio reward modifier ────────────────────────────────────────
            # Uses HRV trend, EDA spike, sleep deficit, glucose, and circadian
            # receptivity to shape reward without adding new critic dimensions.
            p_mod = physio_reward_modifier(state.physio, prev_physio)
            prev_physio = dict(state.physio)   # store for next turn comparison

            # ── Information delivery quality modifier ─────────────────────────
            # Five components combined into a single `delivery_mod` ∈ [-0.15, +0.15]:
            #
            # 1. TIMING — penalise informing before rapport (turns 0-2, precontemplation)
            # 2. GROUNDING — bonus when the response references content from the patient's
            #    RAG context (known_context) or longitudinal hint (cross-session memory)
            # 3. CIRCLE RELAY — bonus when the companion relays relevant information
            #    another circle member disclosed (speaker wasn't primary patient)
            # 4. NEGOTIATION LISTEN RATIO — in negotiation mode, penalise informing too
            #    early (turn < 4); bonus for listening first, informing later
            # 5. HUMOR/LIGHTNESS — small bonus when the companion uses appropriate
            #    light framing (not during high stress, not safety-critical turn)
            delivery_mod = 0.0

            is_inform_action = action in {
                "give_facts", "psychoeducation", "provide_information", "direct_advice",
                "give_options", "suggest_coping_strategy", "schedule_commitment",
                "companion_handoff", "share_circle_insight",
            }
            resp_lower = agent_resp.lower()

            # 1. Timing penalty: information too early, before the patient has opened up
            if is_inform_action and state.turn_idx < 3 and state.info_coverage < 0.25:
                if state.deaddiction_phase in ("precontemplation", "contemplation", "rapport", "ambivalence"):
                    delivery_mod -= 0.08   # too early — patient hasn't opened up yet

            # 2. Grounding bonus: response references specific content from patient's
            #    RAG context (known_context block) rather than generic clinical fluff.
            #    Proxy: at least 3 words from known_context appear in agent_resp.
            if is_inform_action and state.known_context:
                ctx_words = set(state.known_context.lower().split()) - {
                    "the", "a", "an", "and", "or", "but", "is", "was", "are",
                    "you", "your", "they", "their", "it", "in", "on", "at", "to",
                }
                resp_words = set(resp_lower.split())
                overlap = len(ctx_words & resp_words)
                if overlap >= 3:
                    delivery_mod += 0.08   # response is grounded in actual patient context
                elif overlap == 0 and len(ctx_words) > 5:
                    delivery_mod -= 0.04   # companion knows context but ignored it

            # 3. Circle relay bonus: when the current speaker is NOT the primary patient
            #    (caregiver, relative, clinician) and the companion shares information
            #    the primary patient disclosed — this is the cross-user handoff.
            #    Proxy: non-patient speaker turn + informing action + patient name/pronoun
            #    referenced in response without leaking privacy keywords.
            _PRIVACY_LEAK_WORDS = (
                "confidential", "private", "secret", "didn't want you to know",
                "told me not to", "hasn't told you",
            )
            is_non_patient_speaker = (
                hasattr(speaker, "role") and
                _normalise_role(speaker.role) not in ("patient",)
            )
            if (is_non_patient_speaker and is_inform_action and
                    not any(p in resp_lower for p in _PRIVACY_LEAK_WORDS)):
                delivery_mod += 0.06   # appropriate information relay to a non-patient

            # 4. Negotiation listen-before-inform: penalise informing before turn 4
            #    in negotiation mode (companion should listen first, understand position)
            if state.therapeutic_mode == "negotiation" and is_inform_action:
                if state.turn_idx < 4:
                    delivery_mod -= 0.06   # too early to inform in negotiation
                elif state.turn_idx >= 6:
                    delivery_mod += 0.05   # well-timed information after listening phase

            # 5. Humor / lightness bonus: appropriate levity under low stress
            #    Proxy: response contains a playful/light phrase, stress is low, not safety turn
            _HUMOR_CUES = (
                "haha", "funny", "joke", "laugh", "that's amusing", "a bit of a",
                "on the bright side", "light note", "speaking of which", "by the way",
                "fun fact", "interestingly",
            )
            if (state.stress_index < 0.40 and action not in {"safety_protocol", "escalate"} and
                    any(c in resp_lower for c in _HUMOR_CUES)):
                delivery_mod += 0.04   # appropriate lightness — not pestering, not crisis

            delivery_mod = max(-0.15, min(0.15, delivery_mod))

            r             = scalar_reward(reward_dict) - pester_penalty + rapport_bonus + p_mod + delivery_mod

            # ── Escalation / caregiver-relay bonus ───────────────────────────────
            # For multi-role scenarios (patient + caregiver/clinician), reward the
            # companion for knowing WHEN to escalate or relay information.
            # Three sub-bonuses, non-overlapping:
            #   +0.15  escalate at high stress (stress_index ≥ 0.70) — correct triage
            #   +0.10  share_circle_insight when a non-patient just spoke — timely relay
            #   −0.10  escalate at low stress (< 0.40) — unnecessary alarm
            is_multi_role = len(orchestrator.participants) > 1
            if is_multi_role:
                if action == "escalate":
                    if state.stress_index >= 0.70:
                        r += 0.15   # appropriate escalation to clinician under high stress
                    elif state.stress_index < 0.40:
                        r -= 0.10   # unnecessary escalation — undermines patient autonomy
                elif action == "share_circle_insight":
                    last_role = getattr(conv_ctx, "last_speaker_role", "patient")
                    if last_role != "patient":
                        r += 0.10   # timely relay of what a caregiver/clinician just shared

            # ── Negotiation convergence bonus ─────────────────────────────────
            # For negotiation scenarios (billing, professional critique, etc.),
            # reward language of agreement / concession from either party.
            # This approximates "position gap closure" without requiring a
            # full two-party state tracker.
            if state.therapeutic_mode == "negotiation":
                _CONVERGENCE_CUES = (
                    "i can agree", "that works", "fair enough", "let's go with",
                    "i'll accept", "we have a deal", "that seems reasonable",
                    "i can meet", "let me offer", "i'm willing to",
                    "that's acceptable", "we could try", "i'd be open to",
                )
                combined_text = (patient_msg + " " + agent_resp).lower()
                convergence_hit = any(c in combined_text for c in _CONVERGENCE_CUES)
                if convergence_hit:
                    r += 0.10

            # ── AS4 per-turn inaction appropriateness bonus ───────────────────
            # Applied here (per turn) rather than at episode end, so the A3C
            # TD(0) update sees the bonus signal on the correct turn.
            try:
                from tensornets.a3c.physio_simulator import inaction_appropriateness_bonus
                _ia_bonus = inaction_appropriateness_bonus(
                    action_taken  = action,
                    scenario_type = scenario.get("scenario_type", "standard"),
                    stress_index  = state.stress_index,
                )
                if _ia_bonus:
                    r += _ia_bonus
            except ImportError:
                pass

            # ── Dynamic topic coupling update ──────────────────────────────────
            # After every turn, raise topic coupling on the patient→companion
            # and companion→patient edges for whichever topics appeared in the
            # patient's utterance.  Conflict in the current turn gets extra
            # amplification (see _CONFLICT_BOOST_FACTOR in social_alliance.py).
            # This is a fire-and-forget update; errors are silently ignored
            # so they never disrupt training.
            try:
                from tensornets.agents.social_alliance import (
                    AllianceGraph, detect_topic_from_text,
                )
                _ag: "AllianceGraph | None" = getattr(self, "_alliance_graph", None)
                if _ag is not None and patient_msg:
                    _conflict = score_result.critical_failure > 0 or (
                        score_result.rupture_repair_score < -0.3
                        if hasattr(score_result, "rupture_repair_score") else False
                    )
                    _ag.update_topic_coupling_from_turn(
                        speaker_role    = "patient",
                        listener_role   = "companion",
                        text            = patient_msg,
                        conflict_detected = _conflict,
                    )
            except Exception:
                pass

            cumulative_reward += r
            latency_ms    = (time.perf_counter() - t_start) * 1000.0

            # ── Build next state ─────────────────────────────────────────────
            next_state = self.next_state(
                prev_state     = state,
                response_dict  = {
                    **resp_dict,
                    "info_coverage":        orchestrator.coverage_fraction,
                    "repetition_detected":  score_result.repetition_penalty > 0.4,
                    # Pass scorer signal so build_next_state can update conversation_stress
                    "_scorer_continuous":   score_result.continuous_score,
                },
                user_message   = patient_msg,
                context_window = context_window,
            )

            terminal = (turn_idx >= max_turns_ep - 1)

            # ── J4 update ────────────────────────────────────────────────────
            update_metrics = apply_update(
                actor       = self.actor,
                critic      = self.critic,
                state       = state,
                next_state  = None if terminal else next_state,
                action      = action,
                reward      = r,
                terminal    = terminal,
                update_lock = self.update_lock,
            )

            turn_record = EpisodeTurn(
                turn_idx    = state.turn_idx,
                arm         = self.ARM,
                state       = {
                    "stress_index":           state.stress_index,
                    "stress_bucket":          state.stress_bucket,
                    "therapeutic_mode":       state.therapeutic_mode,
                    "deaddiction_phase":      state.deaddiction_phase,
                    "last_action":            state.last_action,
                    "session_goal":           state.session_goal,
                    "turn_count":             state.turn_count,
                    "info_coverage":          state.info_coverage,
                    "repetition_detected":    state.repetition_detected,
                    "frames_component":       state.frames_component,
                    "archetype":              state.archetype,
                    "has_misconception":      state.has_misconception,
                    "flooding_target_stress": state.flooding_target_stress,
                    "physio":                 state.physio,
                    "speaker_role":           speaker.role,
                    "change_stage":           state.deaddiction_phase,
                },
                action         = action,
                log_prob       = round(log_prob, 5),
                patient_message = patient_msg,
                response       = agent_resp,
                reward         = reward_dict,
                scalar_reward  = round(r, 5),
                judge          = {
                    "scorer_integer": score_result.total_integer,
                    "scorer_continuous": score_result.continuous_score,
                    "critical_failure": score_result.critical_failure,
                    "issues": score_result.issues,
                    "pester_penalty": round(pester_penalty, 3),
                    "redirect_streak": redirect_streak,
                    "rapport_bonus": round(rapport_bonus, 3),
                    "physio_modifier": round(p_mod, 3),
                    "delivery_quality": round(delivery_mod, 3),
                    "vint_updates": {k: round(v, 2) for k, v in vint_updates.items()} if vint_updates else {},
                },
                update_metrics = update_metrics,
                tokens         = resp_dict.get("tokens", {}),
                latency_ms     = round(latency_ms, 1),
                cost_usd       = (
                    _compute_turn_cost(resp_dict.get("tokens", {}))
                    # Add scorer cost (0 on heuristic carry turns)
                    + _compute_turn_cost({
                        "scout_in":  score_result.scorer_tokens_in,
                        "scout_out": score_result.scorer_tokens_out,
                    })
                    # Add patient LLM cost (0 on scripted turns)
                    + _compute_turn_cost({
                        "scout_in":  getattr(speaker, "_last_tokens_in",  0),
                        "scout_out": getattr(speaker, "_last_tokens_out", 0),
                    })
                ),
                llm_calls      = (
                    resp_dict.get("llm_calls", 1)
                    + (1 if score_result.scorer_tokens_out > 0 else 0)   # scorer used LLM
                    + (1 if getattr(speaker, "_last_tokens_out", 0) > 0 else 0)  # patient used LLM
                ),
                discrepancy    = resp_dict.get("discrepancy", None),
            )
            self._episode_log.append(turn_record)

            # ── Persist turn to DB (non-fatal) ────────────────────────────────
            # Only log for non-oldschool arms; oldschool turns are logged by the
            # Node.js companion API automatically.
            if self.ARM != "oldschool":
                _log_turn_to_db(
                    episode_id  = episode_id,
                    run_id      = getattr(self, "_current_run_id", ""),
                    arm         = self.ARM,
                    turn_idx    = turn_idx,
                    action      = action,
                    response    = agent_resp,
                    state       = state,
                    reward_dict = reward_dict,
                    score_result= score_result,
                    latency_ms  = latency_ms,
                    cost_usd    = turn_record.cost_usd,
                    llm_calls   = turn_record.llm_calls,
                )

            # ── Advance non-primary participants' physio (longitudinal dynamics) ─
            # The primary patient's physio is stepped by arms.py via next_physio.
            # Secondary participants (caregiver, doctor) get a stochastic step here
            # so their profiles drift realistically across turns.
            _safety_score = next(
                (s for d, s, _ in score_result.integer_scores if d == "safety"),
                score_result.dimensions.get("safety", 0),
            )
            emotionally_loaded = (
                _safety_score < 0 or
                state.stress_index > 0.65
            )
            for _p in orchestrator.participants:
                if _p is not orchestrator.primary_patient and _p.physio:
                    _p.physio = _physio_sim.step(_p.physio, emotionally_loaded=emotionally_loaded)

            # ── Genuine progress metric updates (per turn) ───────────────────
            _stress_samples.append(state.stress_index)
            if _turns_to_goal is None and state.info_coverage >= 0.75:
                _turns_to_goal = turn_idx
            _trust_acc += scorer_reward_dims.get("trust_delta", 0.0)
            # Track escalation via scorer dimension
            if not _escalation_occurred and score_result is not None:
                _esc_q = dict(score_result.dimensions).get("escalation_quality_score", 0)
                try:
                    if int(_esc_q) > 0:
                        _escalation_occurred = True
                except (TypeError, ValueError):
                    pass

            # ── Early termination check (Q4b) ────────────────────────────────
            should_stop, ep_penalty = scorer.should_terminate_early(
                score_history, turn_idx, max_turns_ep
            )
            if should_stop:
                cumulative_reward -= ep_penalty * 2.0   # amplified penalty for early stop
                log.info(
                    "[%s] early termination at turn %d (rep_penalty=%.3f)",
                    self.worker_id, turn_idx, ep_penalty,
                )
                break

            if score_result.critical_failure:
                # 2-strike rule: two *consecutive* critical failures → end episode.
                # Can be disabled at the class level (DISABLE_CRITICAL_FAILURE_GATE=True)
                # in safety-ablation experiments (Exp 0a–7a) to measure the gate's
                # independent contribution to goal rate.
                #
                # Grace period for turns 0–2: during rapport-building, denial and
                # generic_response scoring ≤ -2 is expected.  Only urgency ≤ -2
                # (a true safety signal) counts as a critical strike in early turns.
                is_safety_critical = any(
                    dim == "urgency" and s <= -2
                    for dim, s, _ in score_result.integer_scores
                )
                counts_as_strike = is_safety_critical or (turn_idx >= 3)

                if not self.DISABLE_CRITICAL_FAILURE_GATE and counts_as_strike and warned_once:
                    # 2-strike: end episode after second consecutive qualifying strike
                    log.info(
                        "[%s] 2-strike critical failure at turn %d", self.worker_id, turn_idx
                    )
                    cumulative_reward -= 1.5
                    _ended_crit_fail = True
                    break
                if counts_as_strike:
                    warned_once = True
                # non-qualifying critical (early-turn denial/generic): log but don't strike
            else:
                warned_once = False

            # ── Synthetic user dropout check (Q4c) ──────────────────────────
            # A patient who receives consistently poor responses may choose to
            # end the session early.  This simulates user churn — a signal that
            # is hard to observe IRL but critical to train against.
            #
            # Dropout fires when ALL THREE conditions are met:
            #   1. ≥ 3 consecutive very-low-quality turns (continuous_score < 0.35)
            #   2. Stress is rising or already high (stress_index > 0.60)
            #   3. Minimum 4 turns have elapsed (avoid terminating before rapport)
            #
            # Probability is proportional to the dissatisfaction signal so that
            # a borderline patient has a small chance of continuing (realistic).
            # The episode is marked dropout=True for CurriculumScheduler to track:
            # the experience is retained in training (agent needs to learn it
            # failed) but excluded from the prior-session success pool.
            #
            # No additional penalty is applied here — the lack of a terminal
            # goal bonus and the low per-turn scores are already the training
            # signal.  Penalising further would double-count the failure.
            _recent_scores = [t.judge.get("scorer_continuous", 1.0)  # type: ignore[attr-defined]
                              for t in self._episode_log[-3:]]
            _n_poor = sum(1 for s in _recent_scores if s < 0.35)
            if (turn_idx >= 4 and _n_poor >= 3
                    and state.stress_index > 0.60
                    and state.therapeutic_mode != "flooding"):  # flooding is intentionally stressful
                import random as _rand
                _dissatisfaction = _n_poor / max(len(_recent_scores), 1)
                _dropout_p = _dissatisfaction * 0.45 * (1.0 + state.stress_index * 0.5)
                if _rand.random() < _dropout_p:
                    log.info(
                        "[%s] synthetic dropout at turn %d (poor=%d stress=%.2f p=%.2f)",
                        self.worker_id, turn_idx, _n_poor, state.stress_index, _dropout_p,
                    )
                    _ended_dropout = True
                    break

            last_user_msg = patient_msg

            # ── Adversarial physio deterioration ─────────────────────────────
            # Some scenarios (health_deterioration, inverse_hrv) specify physio
            # deltas that are applied every turn independent of the companion's
            # actions.  This simulates a physiological trend the companion cannot
            # directly reverse — MCTS must *detect* it and escalate appropriately.
            _detn = scenario.get("physio_deterioration_per_turn")
            if _detn and next_state.physio:
                _p = dict(next_state.physio)
                for _k, _dv in _detn.items():
                    if _k in _p:
                        _p[_k] = round(float(_p[_k]) + float(_dv), 4)
                # Recompute stress_bucket for the dashboard
                _p["stress_index"] = round(max(0.0, min(1.0, _p.get("stress_index", 0.5))), 4)
                next_state = next_state.__class__(
                    **{**next_state.__dict__, "physio": _p,
                       "stress_index":  _p["stress_index"],
                       "stress_bucket": TurnState.bucket_from_stress(_p["stress_index"])}
                )

            state = next_state

            # MEMORY-LLM G2: update session-arc summary every 4 turns
            state = self._update_session_arc(state, scenario)

        # ── Terminal reward signal ────────────────────────────────────────────
        # Per-turn weights alone leave a sycophancy gap: a policy that soothes
        # without delivering earns ~0.46 max per-turn reward (stress=0.20 +
        # trust=0.18 + consistency=0.08) while never advancing the clinical goal.
        # Terminal bonus/penalty closes that gap.
        #
        # Penalty is stage-aware and progress-aware:
        #
        #   +3.0  goal achieved  → always rewarded; primary gradient signal
        #   -0.5  session fell short of goal BUT had real utility — trust
        #          accumulated (>0.5) OR coverage grew ≥ 15pp this session.
        #          A mild push rather than a punishment.
        #   -1.0  early-stage (precontemplation/contemplation) session where
        #          rapport/listening IS the therapeutic goal. Moderate nudge.
        #   -1.0  late-stage session with partial absolute coverage (≥ 0.40).
        #   -2.0  late-stage, low coverage, low trust — genuine sycophancy
        #          or no-op policy. Reserved for sessions with no measurable
        #          progress on any axis.
        #
        # "Stage" is assessed at session START, not end: a session that begins
        # in precontemplation should be judged as rapport-first regardless of
        # where it ends.
        #
        # 2-strike episodes already applied -1.5 in-loop; no extra penalty.
        _EARLY_STAGE_SET   = {"precontemplation", "contemplation"}
        _final_coverage    = state.info_coverage
        _prior_coverage    = float(scenario.get("initial_info_coverage", 0.0))
        _coverage_delta    = _final_coverage - _prior_coverage  # progress this session only
        _early_stage       = _start_change_stage in _EARLY_STAGE_SET
        # Trust and coverage-delta are independent axes of session utility.
        # Either alone is sufficient to avoid the full penalty.
        _session_had_utility = (_trust_acc > 0.5) or (_coverage_delta >= 0.15)

        if _turns_to_goal is not None:
            cumulative_reward += 3.0
            log.debug("[%s] terminal +3.0 (goal achieved, cov=%.2f)", self.worker_id, _final_coverage)
        elif not _ended_crit_fail:
            if _session_had_utility:
                cumulative_reward -= 0.5
                log.debug("[%s] terminal -0.5 (utility met: cov_delta=%.2f trust=%.2f)",
                          self.worker_id, _coverage_delta, _trust_acc)
            elif _early_stage:
                cumulative_reward -= 1.0
                log.debug("[%s] terminal -1.0 (early-stage session, cov=%.2f trust=%.2f)",
                          self.worker_id, _final_coverage, _trust_acc)
            elif _final_coverage >= 0.40:
                cumulative_reward -= 1.0
                log.debug("[%s] terminal -1.0 (late-stage partial cov=%.2f)",
                          self.worker_id, _final_coverage)
            else:
                cumulative_reward -= 2.0
                log.debug("[%s] terminal -2.0 (late-stage low cov=%.2f, no trust)",
                          self.worker_id, _final_coverage)

        # ── Terminal escalation signal ────────────────────────────────────────
        # Separate from the goal/coverage signal above.  Rewards correct escalation
        # (e.g. calling for emergency help when the patient is in crisis) and
        # penalises missed escalation when the scenario required it.
        #
        # Only applied when the scenario is tagged escalation_expected=True, to
        # avoid penalising scenarios where no escalation was needed.
        #
        #   +1.5  scenario required escalation AND agent escalated correctly
        #   -1.0  scenario required escalation AND agent never escalated
        #
        # "Escalated correctly" = at least one turn had escalation_quality_score > 0
        # from the scorer.  No partial credit: escalation is binary in clinical practice.
        if _escalation_expected:
            if _escalation_occurred:
                cumulative_reward += 1.5
                log.debug("[%s] terminal +1.5 (correct escalation on escalation scenario)",
                          self.worker_id)
            else:
                cumulative_reward -= 1.0
                log.debug("[%s] terminal -1.0 (missed escalation on escalation scenario)",
                          self.worker_id)

        # ── SC1 + AS4 terminal modifiers ──────────────────────────────────────
        # Stress-calibration bonus: was final stress in the optimal action window?
        # Inaction appropriateness: did inaction actions help in grief/shock scenarios?
        # Both are small nudges (+/-0.05 to +/-0.12) designed to break the A3C
        # habit of always pushing toward zero-stress, and to reward clinical restraint.
        try:
            from tensornets.a3c.physio_simulator import (
                stress_calibration_bonus,
                inaction_appropriateness_bonus,
            )
            _sc_archetype = scenario.get("patient_archetype", "default")
            _sc_phase     = scenario.get("episode_phase",     "any")
            _sc_bonus     = stress_calibration_bonus(
                state.stress_index, _sc_archetype, _sc_phase
            )
            if _sc_bonus:
                cumulative_reward += _sc_bonus
                log.debug("[%s] SC1 stress_calibration=%+.2f (arch=%s phase=%s stress=%.2f)",
                          self.worker_id, _sc_bonus, _sc_archetype, _sc_phase, state.stress_index)

            # Inaction appropriateness: score over the full episode action list.
            # Aggregate the per-turn inaction bonuses rather than scoring once at the end,
            # but we track the count here since we don't have per-turn action_taken in scope.
            # Per-turn inaction rewards are applied in the turn loop (see below); this block
            # checks for overuse: ≥3 consecutive inaction actions in late episode is a penalty.
            _inaction_cluster = {
                "hold_space", "therapeutic_silence",
                "await_readiness", "pause_and_breathe_together",
            }
            _scenario_type = scenario.get("scenario_type", "standard")
            _last_3_actions = [
                t.action_taken
                for t in episode_log[-3:]
                if hasattr(t, "action_taken") and t.action_taken
            ]
            if (len(_last_3_actions) == 3
                    and all(a in _inaction_cluster for a in _last_3_actions)
                    and _scenario_type not in {"bereavement", "health_deterioration"}):
                cumulative_reward -= 0.30
                log.debug("[%s] AS4 overuse penalty -0.30 (3 consecutive inaction actions)",
                          self.worker_id)
        except ImportError:
            pass

        summary = self._flush_episode(episode_id, scenario, cumulative_reward)


        # ── Genuine progress metrics ──────────────────────────────────────────
        # These are the methodologically independent measures that supplement the
        # A3C reward signal. They help differentiate real therapeutic progress from
        # easy-to-game action-selection parameters.
        _STAGE_ORDER = [
            "precontemplation", "contemplation", "preparation",
            "action", "maintenance",
        ]

        # 1. change_stage_delta: ordinal change in the patient's TTM stage.
        #    Positive = advancement. Estimated heuristically from coverage + stress.
        #    Phase 5 will replace with a dedicated LLM judge call.
        end_stage = state.deaddiction_phase
        _stage_start_idx = _STAGE_ORDER.index(_start_change_stage) \
            if _start_change_stage in _STAGE_ORDER else 0
        # Heuristic advancement: if patient covered ≥ 80% AND low mean stress → advance 1
        mean_stress = (sum(_stress_samples) / len(_stress_samples)) if _stress_samples else 0.5
        _inferred_advance = 0
        if (state.info_coverage >= 0.80 and mean_stress <= 0.50
                and state.turn_count >= 4
                and _stage_start_idx < len(_STAGE_ORDER) - 1):
            _inferred_advance = 1
            end_stage = _STAGE_ORDER[_stage_start_idx + 1]
        _stage_end_idx = _STAGE_ORDER.index(end_stage) \
            if end_stage in _STAGE_ORDER else _stage_start_idx
        change_stage_delta = _stage_end_idx - _stage_start_idx

        # 2. stress_auc: area under the calm curve — higher is better.
        #    stress_auc = mean(1 - stress_index) over all turns.
        stress_auc = (sum(1.0 - s for s in _stress_samples) / len(_stress_samples)) \
            if _stress_samples else 0.5

        # 3. turns_to_goal: first turn where info_coverage ≥ 0.75.
        #    None if never achieved. Lower is better for a given goal difficulty.
        turns_to_goal = _turns_to_goal

        # 4. discrepancy_flag: did the A3C reward diverge significantly from the
        #    LLM scorer's assessment? Flags training validity issues.
        scorer_cumulative = sum(
            t.judge.get("scorer_continuous", 0.5) for t in self._episode_log
        ) if self._episode_log else 0.0
        arm_cumulative = cumulative_reward
        discrepancy_flag = abs(arm_cumulative - scorer_cumulative) > 3.0  # 3σ threshold

        # 5. trust_delta_final: accumulated trust_delta over the episode.
        trust_delta_final = round(_trust_acc, 4)

        genuine_metrics = {
            "change_stage_start":  _start_change_stage,
            "change_stage_end":    end_stage,
            "change_stage_delta":  change_stage_delta,
            "inferred_advance":    bool(_inferred_advance),
            "stress_auc":          round(stress_auc, 4),
            "turns_to_goal":       turns_to_goal,
            "goal_achieved":       turns_to_goal is not None,
            "discrepancy_flag":    discrepancy_flag,
            "trust_delta_final":   trust_delta_final,
            "mean_stress":         round(mean_stress, 4),
            "turn_count":          state.turn_count,
            "reactivity_archetype": state.archetype,
            "vint_active":         vint_buf is not None,
            # Cross-companion coordination metrics
            "world_scenario":      is_world_scenario,
            "commitment_count":    len(dialogue_state.commitments) if dialogue_state else 0,
            "clinical_commitments": sum(
                1 for c in dialogue_state.commitments if c.is_clinical
            ) if dialogue_state else 0,
            "escalation_requested": dialogue_state.escalation_requested if dialogue_state else False,
            # Cost and LLM call metrics (aggregated from EpisodeTurn records)
            "cost_usd_total":      round(sum(t.cost_usd for t in self._episode_log), 6),
            "llm_calls_total":     sum(t.llm_calls for t in self._episode_log),
            "tokens_scout_total":  sum(t.tokens.get("scout", 0) for t in self._episode_log),
            "tokens_maverick_total": sum(t.tokens.get("maverick", 0) for t in self._episode_log),
            "mean_latency_ms":     round(
                sum(t.latency_ms for t in self._episode_log) / max(len(self._episode_log), 1), 1
            ),
            # Hysteresis gate metrics (non-zero only for Exp 4/5/6/7)
            "hysteresis_zone_changes": sum(
                1 for t in self._episode_log
                if t.state.get("hysteresis_changed", False)
            ),
            # Synthetic user dropout: True if the patient ended the session early
            # due to dissatisfaction. Tracked separately from crit_fail to allow
            # CurriculumScheduler to distinguish agent failure modes.
            "synthetic_dropout":   _ended_dropout,
        }
        # Attach session memory for multi-session continuity
        summary["session_memory"] = {
            "scenario_id":    scenario.get("scenario_id", "unknown"),
            "subject_id":     scenario.get("subject_id", "synthetic"),
            "archetype":      state.archetype,
            "session_goal":   state.session_goal,
            "therapeutic_mode": state.therapeutic_mode,
            "deaddiction_phase": end_stage,      # use inferred end stage
            "turn_count":     state.turn_count,
            "info_coverage":  state.info_coverage,
            "covered_elements": list(orchestrator.covered_elements),
            "goal_idx":       orchestrator.primary_patient.current_goal_idx,
            "conversation_history": state.conversation_history[-10:],
            "physio":         state.physio,
            "longitudinal_hint": state.longitudinal_hint,
            "cumulative_reward": round(cumulative_reward, 5),
            "synthetic_dropout": _ended_dropout,
            # SimulatedTimeline is carried forward for multi-session chains.
            # CurriculumScheduler._attach_simulated_timeline will advance the
            # day and time when this session is used as a prior for the next.
            "simulated_timeline": scenario.get("simulated_timeline") or {},
        }
        # Propagate session_number to top-level summary for CurriculumScheduler
        # chain-length tracking and dashboard visibility.
        sim_tl = scenario.get("simulated_timeline") or {}
        summary["session_number"] = int(sim_tl.get("session_number") or 1)
        summary["genuine_metrics"] = genuine_metrics

        # ── V_int episode close: update alliances from episode reward, persist ──────
        # Positive reward → alliance slightly strengthens; negative → weakens.
        # This is the hysteretic V_int cross-session persistence step (§5 future_work).
        if vint_buf is not None:
            try:
                norm_reward = float(cumulative_reward) / max(1.0, abs(float(cumulative_reward)) + 1e-6)
                vint_buf.record_interaction_outcome("companion", norm_reward)
                vint_buf.close_session()
            except Exception:
                pass

        # ── Social Alliance Graph: update + persist ────────────────────────────────
        # Use the aggregated trust_delta from genuine_metrics and rupture signals
        # from the last scorer result to update the companion→patient edge.
        if _alliance_graph is not None:
            try:
                _last_score = score_history[-1] if score_history else None
                _rupture, _repair, _no_go = signals_from_score_result(_last_score)
                _td = genuine_metrics.get("trust_delta_final", 0.0)
                _goal = genuine_metrics.get("goal_achieved", False)
                # Update companion→patient edge
                _alliance_graph.update_from_episode(
                    speaker_role       = "companion",
                    listener_role      = "patient",
                    trust_delta        = _td,
                    goal_achieved      = _goal,
                    rupture_signal     = _rupture,
                    repair_signal      = _repair,
                    new_no_go          = _no_go or None,
                    advance_disclosure = state.info_coverage >= 0.6,
                    session_id         = episode_id,
                )
                # AUDIT-FIX: coupling_tensor (RelationalField) was never updated after episodes.
                # update_v_ij() advances coupling_tensor one step toward current alliance_score
                # and proportionally scales all topic couplings.  Must be called AFTER
                # update_from_episode() so alliance_score is already updated.
                try:
                    cp_edge = _alliance_graph.get_edge("companion", "patient")
                    if cp_edge is not None:
                        cp_edge.advance_relational_field()
                except Exception:
                    pass
                # Persist to disk
                _alliance_graph.persist(_alliance_state_dir)
                # Embed compact alliance snapshot in session_memory
                summary["session_memory"]["alliance"] = (
                    _alliance_graph.to_session_memory_snippet(
                        companion_role="companion", patient_role="patient"
                    )
                )
                summary["session_memory"]["alliance_circle_id"] = _alliance_circle_id

                # BG2 persistence: save updated BeliefGraph (beliefs extracted per turn above)
                if _belief_graph is not None:
                    try:
                        from tensornets.agents.belief_graph import save_belief_graph
                        save_belief_graph(_belief_graph)
                    except Exception:
                        pass
            except Exception:
                pass

        # Index this episode into TensorRAG episode memory (non-blocking)
        try:
            _rag = _get_worker_rag()
            if _rag is not None:
                _rag.add_episode(summary)
        except Exception:
            pass

        # ── FB1: Post-episode qualitative feedback pass ────────────────────────
        # Every K episodes (default: every 5th), run a brief Scout pass over
        # the episode transcript to extract "what went wrong / what worked".
        # This produces a qualitative_feedback dict stored in the episode summary
        # and a per-arm scalar qualitative_penalty that is subtracted from the
        # cumulative reward to enrich the A3C gradient signal.
        #
        # Only fires when goal_achieved=False (failure episodes are most diagnostic)
        # or when a critical_failure was recorded.  On success episodes it fires
        # 1-in-3 to keep feedback diversity without doubling cost.
        _FB1_EVERY_K = 5
        _ep_count = getattr(self, "_episode_counter", 0) + 1
        self._episode_counter = _ep_count
        _goal_achieved_fb = genuine_metrics.get("goal_achieved", False)
        _had_crit_fail = any(
            t.judge.get("critical_failure", False)
            for t in self._episode_log
        )
        _should_run_fb1 = (
            (_ep_count % _FB1_EVERY_K == 0)
            and (not _goal_achieved_fb or _had_crit_fail or (_ep_count % 15 == 0))
        )
        if _should_run_fb1:
            try:
                fb_result = _qualitative_feedback_pass(
                    episode_log   = self._episode_log,
                    scenario_goal = state.session_goal,
                    arm           = self.ARM,
                )
                if fb_result:
                    summary["qualitative_feedback"] = fb_result
                    # Apply the feedback penalty: a small negative scalar added to
                    # the returned summary's cumulative_reward so the curriculum
                    # scheduler can down-weight failure episodes more strongly.
                    q_penalty = fb_result.get("penalty", 0.0)
                    summary["cumulative_reward"] = round(
                        summary.get("cumulative_reward", cumulative_reward)
                        - q_penalty, 5
                    )
            except Exception:
                pass   # qualitative feedback is always non-fatal

        return summary

    def _build_state_with_continuity(
        self,
        scenario:       dict,
        prior_session:  "dict | None",
    ) -> TurnState:
        """
        Build the initial TurnState, optionally loading from a prior session
        for multi-session continuity (Q5a).

        Why this function exists
        -----------------------
        Longitudinal training simulates a patient who attends multiple sessions
        with the same companion.  Carrying forward physio, conversation history,
        and goal-coverage creates realistic continuity — the agent should not
        re-discover facts already established in a prior session.

        When prior_session is provided:
        - The initial physio, stress, and conversation history come from the
          prior session's saved state.
        - The session_goal is from the NEW scenario (patient has a new clinical
          objective this session, even if the persona is the same).
        - longitudinal_hint is updated to summarise what happened in prior session.

        RISKS / EDGE CASES
        ------------------
        1. Coverage carry-over inflation: a prior session with info_coverage=1.0
           would set initial_info_coverage=1.0 → goal_achieved=True before turn 0.
           Guard: ``initial_info_coverage`` is capped at 0.5 regardless of the
           prior value.  Even a near-perfect prior session should not pre-solve
           the new episode; the new scenario has its own required_elements.

        2. Goal pointer inflation: the prior session's goal_idx and covered_elements
           are imported (see run_episode()).  If the new scenario has fewer elements,
           the pointer is clamped by _advance_goal_pointer().  This is safe.

        3. Phase lock-in: prior session's deaddiction_phase is inherited, which
           can artificially keep the patient in a late stage (e.g. "maintenance")
           even when the new scenario starts at "precontemplation".  Currently
           accepted as realistic — a returning patient is unlikely to regress
           fully.  If this becomes a problem, add a cap here similar to coverage.
        """
        if prior_session is None:
            return TurnState.from_scenario(scenario)

        # Build a merged scenario: new scenario goals + prior session context
        merged = dict(scenario)
        merged["initial_physio"]     = prior_session.get("physio", scenario.get("initial_physio", {}))

        # Cap at 0.5 — even a great prior session should not pre-solve the new episode.
        # A value of 1.0 would mean goal_achieved=True before the first agent turn.
        prior_coverage = prior_session.get("info_coverage", 0.3)
        merged["initial_info_coverage"] = min(prior_coverage, 0.5)

        merged["known_context"]      = prior_session.get("known_context", "")

        # ── SimulatedTimeline: inject temporal context when available ─────────
        # If CurriculumScheduler attached a simulated_timeline, use it to:
        #   1. Enrich the longitudinal_hint with human-readable temporal framing.
        #   2. Adjust physio baseline for time-of-day (circadian effects).
        #   3. Carry the timeline forward in session_memory for the next chain.
        # If no timeline is present, fall back to the prior hint without dates.
        sim_tl = prior_session.get("simulated_timeline") or {}
        days_gap    = int(sim_tl.get("days_since_last", 0))
        day_label   = ""
        if days_gap == 0:
            day_label = ""
        elif days_gap == 1:
            day_label = "1 day later"
        else:
            day_label = f"{days_gap} days later"

        time_h      = sim_tl.get("time_of_day_h")
        time_label  = ""
        if time_h is not None:
            if time_h < 12.0:
                time_label = f"morning ({time_h:.0f}h)"
            elif time_h < 17.0:
                time_label = f"afternoon ({time_h:.0f}h)"
            else:
                time_label = f"evening ({time_h:.0f}h)"

        temporal_prefix = ""
        if day_label and time_label:
            temporal_prefix = f"[{day_label}, {time_label}] "
        elif day_label:
            temporal_prefix = f"[{day_label}] "

        merged["longitudinal_hint"] = (
            f"{temporal_prefix}"
            f"[Prior session {prior_session.get('scenario_id','?')}]: "
            f"goal={prior_session.get('session_goal','?')}, "
            f"coverage={prior_session.get('info_coverage',0.0):.0%}, "
            f"reward={prior_session.get('cumulative_reward',0.0):.2f}"
        )

        # Circadian physio adjustment: time_of_day_h affects HRV and stress baseline.
        # Higher time_of_day (late evening) → slightly reduced HRV, elevated stress.
        # This is a lightweight heuristic; the physio simulator handles per-turn dynamics.
        if time_h is not None and merged.get("initial_physio"):
            physio = dict(merged["initial_physio"])
            # Evening: HRV drops ~10%, stress index rises ~0.05
            circadian_mod = max(-1.0, min(1.0, (time_h - 14.0) / 14.0))  # -1 (morning) → +1 (midnight)
            hrv_key = "hrv_rmssd_ms" if "hrv_rmssd_ms" in physio else "hrv_ms"
            if hrv_key in physio:
                physio[hrv_key] = max(15.0, physio[hrv_key] * (1.0 - 0.08 * max(0.0, circadian_mod)))
            physio["time_of_day_h"] = time_h
            merged["initial_physio"] = physio

        # Carry the timeline forward for the next chain level
        merged["simulated_timeline"] = sim_tl
        merged["archetype"]          = prior_session.get("archetype", scenario.get("archetype", "standard"))
        merged["deaddiction_phase"]  = prior_session.get("deaddiction_phase", scenario.get("deaddiction_phase", "precontemplation"))

        state = TurnState.from_scenario(merged)
        # Pre-populate conversation history from prior session
        prior_history = prior_session.get("conversation_history", [])
        state.conversation_history = list(prior_history)

        # ── Restore alliance context into known_context if available ─────────
        # The alliance graph is loaded from disk in run_episode() separately.
        # Here we inject the prior session's compact alliance snippet as text so
        # the companion prompt immediately reflects the relationship state.
        prior_alliance = prior_session.get("alliance")
        if prior_alliance:
            try:
                _score = prior_alliance.get("alliance_score", 0.35)
                _rupt  = prior_alliance.get("rupture_pending", False)
                _disc  = ["none", "surface", "moderate", "deep"][
                    min(3, int(prior_alliance.get("disclosure_level", 0)))
                ]
                _nogo  = prior_alliance.get("no_go_zones", [])
                alliance_hint = (
                    f"[Prior session alliance] Score: {_score:.0%}, "
                    f"rupture: {'YES — repair first' if _rupt else 'no'}, "
                    f"disclosure: {_disc}"
                    + (f", no-go: {', '.join(_nogo)}" if _nogo else "")
                )
                prev_ctx = state.known_context or ""
                state.known_context = (alliance_hint + "\n" + prev_ctx).strip()
            except Exception:
                pass

        return state

    # ── Logging ──────────────────────────────────────────────────────────────

    def _flush_episode(
        self,
        episode_id: str,
        scenario: dict,
        cumulative_reward: float,
    ) -> dict:
        """Write episode jsonl and return summary dict."""
        episodes_dir = self.run_dir / "episodes"
        episodes_dir.mkdir(parents=True, exist_ok=True)

        jsonl_path = episodes_dir / f"episode_{episode_id}.jsonl"

        n_turns = len(self._episode_log)
        mean_reward = cumulative_reward / max(n_turns, 1)

        # Genuine metrics derived from turn log.
        # info_coverage is the canonical goal-achievement signal: ≥ 0.75 means the
        # agent surfaced enough high-quality information across the episode.
        # (judge dict has no "goal_achieved" key — that was a stale lookup.)
        stress_values = [
            t.state.get("stress_index", 0) for t in self._episode_log if isinstance(t.state, dict)
        ]
        # stress_auc = mean(1 - stress_index) — same definition as run_episode().
        # Higher is better: 1.0 means the patient was calm throughout; 0.0 means
        # maximal stress every turn. Using raw mean(stress_index) here was inverted.
        stress_auc = (sum(1.0 - v for v in stress_values) / len(stress_values)) if stress_values else 0.5
        trust_deltas = [
            t.reward.get("trust_delta", 0) for t in self._episode_log if isinstance(t.reward, dict)
        ]
        trust_delta_final = sum(trust_deltas)
        # First turn where state.info_coverage crossed the goal threshold.
        turns_to_goal = next(
            (t.state.get("info_coverage", 0) >= 0.75
             and t.turn_idx + 1
             for t in self._episode_log
             if isinstance(t.state, dict) and t.state.get("info_coverage", 0) >= 0.75),
            None,
        )
        # Normalise: next() returns an int or None; False is falsy but not None-safe here.
        if turns_to_goal is False:
            turns_to_goal = None
        goal_achieved = turns_to_goal is not None

        genuine_metrics = {
            "goal_achieved":    bool(goal_achieved),
            "turns_to_goal":    turns_to_goal,
            "stress_auc":       round(stress_auc, 5),
            "trust_delta_final": round(trust_delta_final, 5),
            "turn_count":       n_turns,
        }

        summary = {
            "episode_id":        episode_id,
            "arm":               self.ARM,
            "prompt_variant":    self.PROMPT_VARIANT,
            "worker_id":         self.worker_id,
            "scenario_id":       scenario.get("scenario_id", "unknown"),
            "subject_id":        scenario.get("subject_id", "synthetic"),
            "n_turns":           n_turns,
            "cumulative_reward": round(cumulative_reward, 5),
            "mean_reward":       round(mean_reward, 5),
            "timestamp":         datetime.now(timezone.utc).isoformat(),
            "jsonl_path":        str(jsonl_path),
            "genuine_metrics":   genuine_metrics,
            # session_summary_quality: placeholder for future post-session LLM judge.
            # When implemented, this will call a Scout/Maverick pass over the full
            # episode transcript to score the agent's overall session quality.
            # Until then it defaults to None and is excluded from reward computation.
            "session_summary_quality": None,
        }

        with jsonl_path.open("w", encoding="utf-8") as fh:
            for turn in self._episode_log:
                line = {
                    "turn":           turn.turn_idx,
                    "arm":            turn.arm,
                    "state":          turn.state,
                    "action":         turn.action,
                    "log_prob":       turn.log_prob,
                    "patient_message": turn.patient_message,
                    "response":       turn.response,
                    "reward":         turn.reward,
                    "scalar_reward":  turn.scalar_reward,
                    "judge":          turn.judge,
                    "update":         turn.update_metrics,
                    "tokens":         turn.tokens,
                    "latency_ms":     turn.latency_ms,
                    "discrepancy":    turn.discrepancy,
                }
                fh.write(json.dumps(line, ensure_ascii=False) + "\n")
            # Trailing summary event — makes backfilling and auditing deterministic
            fh.write(json.dumps({
                "type":            "episode_summary",
                "episode_id":      episode_id,
                "episode_meta":    {
                    "scenario_id": scenario.get("scenario_id", "unknown"),
                    "n_turns":     n_turns,
                    "started_at":  summary["timestamp"],
                },
                "cumulative_reward": summary["cumulative_reward"],
                "genuine_metrics":   genuine_metrics,
            }, ensure_ascii=False) + "\n")
        log.info(
            "[%s] episode %s  arm=%s  turns=%d  R=%.3f",
            self.worker_id, episode_id[:8], self.ARM, n_turns, cumulative_reward,
        )
        return summary

    def save_checkpoint(self, step: int) -> None:
        """Persist actor + critic weights for resumable training."""
        ckpt_dir = self.run_dir / "checkpoints"
        ckpt_dir.mkdir(parents=True, exist_ok=True)
        self.actor.save(ckpt_dir / f"actor_{step}.json")
        self.critic.save(ckpt_dir / f"critic_{step}.json")
        log.info("Checkpoint saved at step %d → %s", step, ckpt_dir)
