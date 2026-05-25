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

log = logging.getLogger("tensornets.a3c.worker")

# ── Hyper-parameters ──────────────────────────────────────────────────────────

GAMMA_DISCOUNT: float = 0.95        # temporal discount for V(s')
ALPHA_LR: float       = 0.05        # learning rate for log-bias update
ENTROPY_COEF: float   = 0.01        # entropy bonus weight (prevents collapse)
MAX_TURNS: int        = 20          # episode truncation


# ── Reward dimensionality (must match HTN judge output schema) ────────────────

REWARD_DIMS = ("stress", "trust_delta", "goal_progress", "info_coverage",
               "consistency", "safety")
REWARD_WEIGHTS: dict[str, float] = {
    "stress":       0.35,
    "trust_delta":  0.20,
    "goal_progress":0.20,
    "info_coverage":0.10,
    "consistency":  0.10,
    "safety":       0.05,
}


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

    stress_index       float [0,1]   — from physio/empathyHandler
    stress_bucket      str           — 'low' | 'moderate' | 'high'  (bandit buckets)
    therapeutic_mode   str           — 'standard'|'flooding'|'skills'|'motivational'
    deaddiction_phase  str           — 'rapport'|'exploration'|'action'|'maintenance'
    last_action        str           — action taken on previous turn (for consistency)
    session_goal       str           — e.g. 'reduce craving', 'general support'
    turn_count         int           — number of completed turns this session
    info_coverage      float [0,1]   — fraction of session goal topics covered so far
    repetition_detected bool         — inputUnderstanding flagged patient is repeating
    frames_component   str | None    — FRAMES element guiding current response
    known_context      str           — RAG block from facts_v2 (longitudinal + session)
    longitudinal_hint  str           — cross-session memory from tensornetsBridge
    activity_context   str           — patient's current activity (sitting, exercising…)
    conversation_history list[dict]  — last K turns {"role", "content"}
    physio             dict          — raw physio snapshot for logging
    session_id         str
    subject_id         str
    """
    turn_idx:             int
    stress_index:         float
    stress_bucket:        str
    conversation_history: list[dict]
    physio:               dict[str, Any]

    # Production-framework fields — required for fair A3C parity
    therapeutic_mode:     str   = "standard"
    deaddiction_phase:    str   = "rapport"
    last_action:          str   = "none"
    session_goal:         str   = "general support"
    turn_count:           int   = 0
    info_coverage:        float = 0.3
    repetition_detected:  bool  = False
    frames_component:     Optional[str] = None
    known_context:        str   = ""        # RAG block injected into action prompt
    longitudinal_hint:    str   = ""        # cross-session memory
    activity_context:     str   = "none"

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
        stress = scenario.get("initial_stress_index", 0.5)
        return cls(
            turn_idx=0,
            stress_index=stress,
            stress_bucket=cls.bucket_from_stress(stress),
            conversation_history=[],
            physio=scenario.get("initial_physio", {}),
            therapeutic_mode=scenario.get("therapeutic_mode", "standard"),
            deaddiction_phase=scenario.get("deaddiction_phase", "rapport"),
            last_action="none",
            session_goal=scenario.get("session_goal", "general support"),
            turn_count=0,
            info_coverage=scenario.get("initial_info_coverage", 0.3),
            repetition_detected=False,
            frames_component=None,
            known_context=scenario.get("known_context", ""),
            longitudinal_hint=scenario.get("longitudinal_hint", ""),
            activity_context=scenario.get("activity_context", "none"),
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

    def action_distribution(self, bucket: str) -> dict[str, float]:
        """Softmax over log-biases for the given stress bucket."""
        biases = self.log_biases.get(bucket, {a: 0.0 for a in ACTION_TAXONOMY})
        max_b = max(biases.values(), default=0.0)
        exp_b = {a: math.exp(b - max_b) for a, b in biases.items()}
        total = sum(exp_b.values()) or 1.0
        return {a: v / total for a, v in exp_b.items()}

    def entropy(self, bucket: str) -> float:
        """Shannon entropy of the action distribution (nats)."""
        dist = self.action_distribution(bucket)
        return -sum(p * math.log(p + 1e-12) for p in dist.values())

    def select(self, state: TurnState) -> tuple[str, float]:
        """
        Sample an action from the policy.

        Returns
        -------
        (action_name, log_prob)
        """
        import random
        dist = self.action_distribution(state.stress_bucket)
        actions = list(dist.keys())
        weights = list(dist.values())
        chosen = random.choices(actions, weights=weights, k=1)[0]
        log_prob = math.log(dist[chosen] + 1e-12)
        return chosen, log_prob

    # ── Weight update (J4 calls this) ────────────────────────────────────────

    def update(self, bucket: str, action: str, advantage: float) -> None:
        """
        Policy-gradient update for one (bucket, action, advantage) triple.

        Δ log_bias = α · advantage · (1 − π(a|s))
        The (1 − π) term is the policy-gradient baseline correction that
        prevents the weight from growing unboundedly for already-likely actions.
        """
        dist = self.action_distribution(bucket)
        pi_a = dist.get(action, 1.0 / len(ACTION_TAXONOMY))
        delta = ALPHA_LR * advantage * (1.0 - pi_a)
        if action in self.log_biases.get(bucket, {}):
            self.log_biases[bucket][action] += delta

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
                     "info_coverage", "repetition", "bias")

    def __init__(self, weights: list[float] | None = None) -> None:
        n = len(self.FEATURE_NAMES)
        self.weights: list[float] = weights if weights is not None else [0.0] * n

    @staticmethod
    def _features(state: TurnState, max_turns: int = MAX_TURNS) -> list[float]:
        return [
            state.stress_index,
            state.turn_idx / max(max_turns, 1),
            min(len(state.conversation_history), 20) / 20.0,
            state.info_coverage,
            1.0 if state.repetition_detected else 0.0,
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
        return cls(weights=data["weights"])


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
) -> dict[str, float]:
    """
    J4: Full per-turn update.

    1.  Estimate V(s) and V(s') from critic.
    2.  Compute advantage A(s,a).
    3.  Update actor log-biases via policy gradient.
    4.  Update critic weights via TD(0).
    5.  Return metrics dict for logging.
    """
    v_s     = critic.estimate(state)
    v_next  = 0.0 if (terminal or next_state is None) else critic.estimate(next_state)
    adv     = compute_advantage(reward, v_s, v_next)
    entropy = actor.entropy(state.stress_bucket)

    actor.update(state.stress_bucket, action, adv + ENTROPY_COEF * entropy)
    td_error = critic.update(state, reward + GAMMA_DISCOUNT * v_next)

    return {
        "v_s":        round(v_s, 5),
        "v_next":     round(v_next, 5),
        "advantage":  round(adv, 5),
        "td_error":   round(td_error, 5),
        "entropy":    round(entropy, 5),
        "reward":     round(reward, 5),
    }


# ── J1: A3CWorker base class ──────────────────────────────────────────────────

@dataclass
class EpisodeTurn:
    """Single turn record written to the episode jsonl log."""
    turn_idx:       int
    arm:            str
    state:          dict
    action:         str
    log_prob:       float
    response:       str
    reward:         dict[str, float]
    scalar_reward:  float
    judge:          dict
    update_metrics: dict
    tokens:         dict[str, int]
    latency_ms:     float
    discrepancy:    Any = None


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
    ) -> None:
        self.actor    = actor
        self.critic   = critic
        self.run_dir  = Path(run_dir)
        self.worker_id = worker_id or str(uuid.uuid4())[:8]
        self._episode_log: list[EpisodeTurn] = []

    # ── Subclass interface ───────────────────────────────────────────────────

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
    ) -> TurnState:
        """Build the TurnState for the next turn from the previous state + response."""
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
        # keep known_context + longitudinal_hint: they are session-scoped, not turn-scoped
        return TurnState(
            turn_idx=prev_state.turn_idx + 1,
            stress_index=new_stress,
            stress_bucket=TurnState.bucket_from_stress(new_stress),
            conversation_history=new_history[-40:],  # keep last 20 exchanges (40 messages)
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
            session_id=prev_state.session_id,
            subject_id=prev_state.subject_id,
        )

    # ── Episode runner ───────────────────────────────────────────────────────

    def run_episode(self, scenario: dict) -> dict:
        """
        Execute one full episode.

        `scenario` is a dict with at minimum:
            session_id         : str
            subject_id         : str
            initial_stress_index: float
            turns              : list[{"user_message": str, ...}]

        Returns an EpisodeSummary dict suitable for jsonl logging.
        """
        episode_id = str(uuid.uuid4())
        self._episode_log = []
        cumulative_reward  = 0.0
        turns = scenario.get("turns", [])

        state = self.build_initial_state(scenario)

        for turn_data in turns[:MAX_TURNS]:
            t_start = time.perf_counter()

            # Actor selects action
            action, log_prob = self.actor.select(state)

            # Arm-specific response generation
            resp_dict = self.generate_response(state, action, scenario)

            reward_dict   = resp_dict.get("reward", {dim: 0.0 for dim in REWARD_DIMS})
            r             = scalar_reward(reward_dict)
            cumulative_reward += r
            latency_ms    = (time.perf_counter() - t_start) * 1000.0

            # Next state
            user_msg   = turn_data.get("user_message", "")
            next_state = self.next_state(state, resp_dict, user_msg)
            terminal   = (state.turn_idx >= len(turns) - 1)

            # J4 update
            update_metrics = apply_update(
                actor=self.actor,
                critic=self.critic,
                state=state,
                next_state=None if terminal else next_state,
                action=action,
                reward=r,
                terminal=terminal,
            )

            turn_record = EpisodeTurn(
                turn_idx=state.turn_idx,
                arm=self.ARM,
                state={
                    "stress_index":        state.stress_index,
                    "stress_bucket":       state.stress_bucket,
                    "therapeutic_mode":    state.therapeutic_mode,
                    "deaddiction_phase":   state.deaddiction_phase,
                    "last_action":         state.last_action,
                    "session_goal":        state.session_goal,
                    "turn_count":          state.turn_count,
                    "info_coverage":       state.info_coverage,
                    "repetition_detected": state.repetition_detected,
                    "frames_component":    state.frames_component,
                    "physio":              state.physio,
                },
                action=action,
                log_prob=round(log_prob, 5),
                response=resp_dict.get("response", ""),
                reward=reward_dict,
                scalar_reward=round(r, 5),
                judge=resp_dict.get("judge", {}),
                update_metrics=update_metrics,
                tokens=resp_dict.get("tokens", {}),
                latency_ms=round(latency_ms, 1),
                discrepancy=resp_dict.get("discrepancy", None),
            )
            self._episode_log.append(turn_record)
            state = next_state

        summary = self._flush_episode(episode_id, scenario, cumulative_reward)
        return summary

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
        with jsonl_path.open("w", encoding="utf-8") as fh:
            for turn in self._episode_log:
                line = {
                    "turn":         turn.turn_idx,
                    "arm":          turn.arm,
                    "state":        turn.state,
                    "action":       turn.action,
                    "log_prob":     turn.log_prob,
                    "response":     turn.response,
                    "reward":       turn.reward,
                    "scalar_reward":turn.scalar_reward,
                    "judge":        turn.judge,
                    "update":       turn.update_metrics,
                    "tokens":       turn.tokens,
                    "latency_ms":   turn.latency_ms,
                    "discrepancy":  turn.discrepancy,
                }
                fh.write(json.dumps(line, ensure_ascii=False) + "\n")

        n_turns = len(self._episode_log)
        mean_reward = cumulative_reward / max(n_turns, 1)
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
        }
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
