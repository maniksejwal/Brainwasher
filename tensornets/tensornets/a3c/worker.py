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


# ── Reward dimensionality (must match HTN judge output schema) ────────────────

REWARD_DIMS = ("stress", "trust_delta", "goal_progress", "info_coverage",
               "consistency", "safety", "count_penalty")
REWARD_WEIGHTS: dict[str, float] = {
    "stress":        0.30,
    "trust_delta":   0.20,
    "goal_progress": 0.20,
    "info_coverage": 0.10,
    "consistency":   0.08,
    "safety":        0.07,
    "count_penalty": 0.05,   # Poisson K repetition penalty (Q4b, Q6a)
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
        )


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
    discrepancy:      Any = None


class A3CWorker:
    """
    J1: Episode runner and per-turn reward accumulator.

    Subclasses override `generate_response()` to implement the three arms:
      - Arm1Worker  (J5): HTN + MCTS (full tensornets bridge)
      - Arm2Worker  (J6): Old-school production JS via HTTP
      - Arm3Worker  (J7): Hysteresis-in-prompt (no MPS, no MCTS)

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
        new_repetition  = response_dict.get("repetition_detected", False)
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
        )

    # ── Episode runner ───────────────────────────────────────────────────────

    def run_episode(
        self,
        scenario: dict,
        prior_session: "dict | None" = None,
        patient_mode:  str = "llm",
        episode_id:    "str | None" = None,
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
        episode_id        = episode_id or str(uuid.uuid4())
        self._episode_log = []
        cumulative_reward = 0.0
        score_history:    list = []

        max_turns_ep   = scenario.get("max_turns",    MAX_TURNS)
        context_window = scenario.get("context_window", 60)

        # Build initial state — load from prior session if given
        state = self._build_state_with_continuity(scenario, prior_session)

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
        # This is pure arithmetic — no LLM calls.
        SharedTensorBuffer = _get_shared_tensor_buffer()
        vint_buf = None
        if SharedTensorBuffer is not None and len(orchestrator.participants) > 1:
            agents = [
                {"agent_id": p.role, "role": _normalise_role(p.role)}
                for p in orchestrator.participants
            ]
            # Add a "companion" slot — the companion's calm presence also propagates
            agents.append({"agent_id": "companion", "role": "companion"})
            try:
                vint_buf = SharedTensorBuffer(agents)
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
        # adjustment so the reward signal is still turn-level granular.
        # This halves Scout calls from the scorer (−33 % total per episode).
        _SCORE_EVERY_N = 2

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
                score_result = scorer.score_turn(
                    patient_message   = patient_msg,
                    agent_response    = agent_resp,
                    turn_idx          = turn_idx,
                    therapeutic_mode  = state.therapeutic_mode,
                    change_stage      = state.deaddiction_phase,
                    scenario_goal     = state.session_goal,
                    scenario_context  = scenario.get("context", ""),
                    history           = state.conversation_history,
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

            # ── Build reward_dict from scorer output + arm-specific reward ───
            scorer_reward_dims = map_scorer_to_reward_dims(score_result)

            # ── Info gain from scorer (no extra LLM call) ─────────────────────
            # novelty + relevance are now part of the scorer's JSON output,
            # so the A3CScorer call (every 2 turns) covers both quality scoring
            # AND info gain.  On carry turns, the previous score_result's values
            # are reused via the heuristic carry — same cost as before.
            info_gain_result = {
                "gain":      score_result.info_gain,
                "novelty":   score_result.info_novelty,
                "relevance": score_result.info_relevance,
                "covered":   [],
            }
            # Accumulate coverage_fraction via info_gain signal.
            # The scorer doesn't identify specific goal strings, so we treat each
            # high-quality turn (info_gain ≥ 0.55) as advancing one goal element.
            # This gives coverage_fraction a meaningful trajectory over the episode
            # rather than staying frozen at the initial 0.3.
            try:
                if score_result.info_gain >= 0.55:
                    n_goals = max(1, len(orchestrator.primary_patient.goals))
                    # Synthesise a unique coverage token per advancing turn so the
                    # set grows monotonically.  We cap at n_goals so coverage_fraction
                    # reaches at most 1.0.
                    token = f"_auto_{turn_idx}"
                    if len(orchestrator.primary_patient.covered_elements) < n_goals:
                        orchestrator.primary_patient.covered_elements.add(token)
                orchestrator.primary_patient._advance_goal_pointer()
            except Exception:
                pass

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
                discrepancy    = resp_dict.get("discrepancy", None),
            )
            self._episode_log.append(turn_record)

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
                #
                # Grace period for turns 0–2: during rapport-building, denial and
                # generic_response scoring ≤ -2 is expected.  Only urgency ≤ -2
                # (a true safety signal) counts as a critical strike in early turns.
                is_safety_critical = any(
                    dim == "urgency" and s <= -2
                    for dim, s, _ in score_result.integer_scores
                )
                counts_as_strike = is_safety_critical or (turn_idx >= 3)

                if counts_as_strike and warned_once:
                    # 2-strike: end episode after second consecutive qualifying strike
                    log.info(
                        "[%s] 2-strike critical failure at turn %d", self.worker_id, turn_idx
                    )
                    cumulative_reward -= 1.5
                    break
                if counts_as_strike:
                    warned_once = True
                # non-qualifying critical (early-turn denial/generic): log but don't strike
            else:
                warned_once = False

            last_user_msg = patient_msg
            state = next_state

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
        }
        summary["genuine_metrics"] = genuine_metrics
        return summary

    def _build_state_with_continuity(
        self,
        scenario:       dict,
        prior_session:  "dict | None",
    ) -> TurnState:
        """
        Build the initial TurnState, optionally loading from a prior session
        for multi-session continuity (Q5a).

        When prior_session is provided:
        - The initial physio, stress, and conversation history come from the
          prior session's saved state.
        - The session_goal is from the NEW scenario (patient has a new clinical
          objective this session, even if the persona is the same).
        - longitudinal_hint is updated to summarise what happened in prior session.
        """
        if prior_session is None:
            return TurnState.from_scenario(scenario)

        # Build a merged scenario: new scenario goals + prior session context
        merged = dict(scenario)
        merged["initial_physio"]     = prior_session.get("physio", scenario.get("initial_physio", {}))
        merged["initial_info_coverage"] = prior_session.get("info_coverage", 0.3)
        merged["known_context"]      = prior_session.get("known_context", "")
        merged["longitudinal_hint"]  = (
            f"[Prior session {prior_session.get('scenario_id','?')}]: "
            f"goal={prior_session.get('session_goal','?')}, "
            f"coverage={prior_session.get('info_coverage',0.0):.0%}, "
            f"reward={prior_session.get('cumulative_reward',0.0):.2f}"
        )
        merged["archetype"]          = prior_session.get("archetype", scenario.get("archetype", "standard"))
        merged["deaddiction_phase"]  = prior_session.get("deaddiction_phase", scenario.get("deaddiction_phase", "precontemplation"))

        state = TurnState.from_scenario(merged)
        # Pre-populate conversation history from prior session
        prior_history = prior_session.get("conversation_history", [])
        state.conversation_history = list(prior_history)
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
            "worker_id":         self.worker_id,
            "scenario_id":       scenario.get("scenario_id", "unknown"),
            "subject_id":        scenario.get("subject_id", "synthetic"),
            "n_turns":           n_turns,
            "cumulative_reward": round(cumulative_reward, 5),
            "mean_reward":       round(mean_reward, 5),
            "timestamp":         datetime.now(timezone.utc).isoformat(),
            "jsonl_path":        str(jsonl_path),
            "genuine_metrics":   genuine_metrics,
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
