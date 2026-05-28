"""
action_bandit.py — Thompson Sampling bandit warm-up for A3C (I1–I4)

PURPOSE
-------
A3C requires a policy initialisation that is better than random. Starting with
uniform random action selection wastes the first 10-20% of episodes on trivially
bad actions (high-confrontation opening, inappropriate humour with a distressed patient).

This module implements a Thompson Sampling multi-armed bandit over the action taxonomy
defined in action_selector.js. It pre-trains for N episodes, giving A3C a warm prior
that avoids obvious policy failures during the early exploration phase.

WHY THOMPSON SAMPLING AND NOT A3C DIRECTLY?
--------------------------------------------
The Thompson Sampling bandit operates on the aggregate reward signal alone, without
needing the actor-critic architecture, GAE computation, or multi-agent setup that A3C
requires. It is cheap (Scout-class inference, scalar reward) and converges quickly
(100 episodes, 3 buckets × 12 actions = 3600 bandit pulls).

The learned Beta posteriors (α_ij, β_ij) are exported as prior weights for the A3C
actor initialisation, which then refines them through full A3C rollouts.

DESIGN (per A3C_COMPARISON_DESIGN.md Section 4)
-------------------------------------------------
- Stress buckets: low (HRV > 45ms), moderate (25–45ms), high (<25ms)
- Action vocabulary: 12 actions from action_selector.js taxonomy
- Reward: scalar ∈ [0,1] from llm_scorer.js / simulation_scorer.js rubric
- Beta posteriors: α[bucket][action], β[bucket][action] initialised at (1, 1) = uniform
- After N episodes, export as actor_prior.json for J2 (A3C actor init)

CITATIONS
----------
- Thompson (1933). On the likelihood that one unknown probability exceeds another.
- Russo et al. (2018). A Tutorial on Thompson Sampling. Found. Trends Mach. Learn.
- Chapelle & Li (2011). An Empirical Evaluation of Thompson Sampling. NeurIPS.
"""
from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Action taxonomy (mirrors action_selector.js MCTS action taxonomy)
# ─────────────────────────────────────────────────────────────────────────────

ACTION_TAXONOMY: list[str] = [
    # ── Ask actions (production — from action_selector.js) ────────────────────
    "open_question",          # 5W question inviting extended narrative (OARS: O)
    "specific_question",      # targeted closed-ended fact gathering
    "probing_question",       # drill down on something mentioned
    "socratic_probe",         # surfaces contradiction in patient's own statements
    "topic_from_stack",       # reintroduce a prior topic patient didn't finish
    # ── Answer / tell actions (production) ────────────────────────────────────
    "give_facts",             # share relevant clinical / practical information
    "give_options",           # present 2-3 alternatives (FRAMES: Advice + Menu)
    "psychoeducation",        # explain a mechanism (FRAMES: Feedback)
    "summarise",              # OARS summary: collect and transition
    # ── Empathy / relationship actions (production) ───────────────────────────
    "empathic_reflection",    # OARS reflection: mirror meaning, not just words
    "affirmation",            # OARS: specific genuine strength recognition
    "validate",               # normalise experience without reinforcing it
    "unconditional_regard",   # non-judgment signal (behaviour-change rapport only)
    # ── Strategic challenge actions (production) ──────────────────────────────
    "challenger_insight",     # Challenger Sale: new perspective
    "develop_discrepancy",    # MET: gap between values and behaviour
    "socratic_reframe",       # patient discovers insight through questions
    "loss_frame",             # Tversky-Kahneman: cost of NOT changing
    # ── Topic management (production) ─────────────────────────────────────────
    "change_topic",           # pivot (use when high stress OR repetition)
    "introduce_new_angle",    # stay on topic but shift perspective
    "acknowledge_only",       # brief ack, invite patient to continue
    # ── Mode-gated technique-specific (production) ────────────────────────────
    "flooding_hold",          # [flooding] hold at exposure, prevent escape
    "flooding_deepen",        # [flooding] intensify stimulus
    "oars_summary",           # [session transitions] full OARS before topic change
    # ── Meta actions (production) ─────────────────────────────────────────────
    "escalate",               # hand to clinician / human
    "safety_protocol",        # crisis or harm risk
    "motivational_frame",     # MET self-efficacy framing (FRAMES: Self-efficacy)
    "end_conversation",       # natural close
    # ── SPIKE protocol ────────────────────────────────────────────────────────
    "spike_step",             # [SPIKE] advance to next exposure step if HRV permits
    # ── Commitment / future-focused (post-action and maintenance phases) ──────
    "direct_advice",          # brief clear recommendation (FRAMES: Advice; post-insight only)
    "schedule_commitment",    # collaboratively set a concrete next-step/date
    "future_planning",        # explore patient's vision of life after change
    # ── Cross-circle information relay ────────────────────────────────────────
    "companion_handoff",      # summarise the session to the patient (end-of-session brief)
    "share_circle_insight",   # relay privacy-filtered information from another circle member
    # ── Abstract MI / CBT actions (retained from original taxonomy) ───────────
    "validate_emotion",       # empathic reflection / validation (MI)
    "explore_ambivalence",    # MI ambivalence surfacing
    "build_alliance",         # therapeutic alliance reinforcement
    "provide_information",    # psychoeducation / factual update
    "reframe_perspective",    # cognitive reframe
    "elicit_change_talk",     # evocation of motivation
    "address_resistance",     # roll with resistance (MI)
    "check_understanding",    # comprehension check / teach-back
    "invite_reflection",      # Socratic open question
    "suggest_coping_strategy",# concrete coping tool
    "clarify_goal",           # goal clarification / narrowing
    "summarise_session",      # recap and next-step alignment
    # ── Specific technique actions (from original discrete taxonomy) ──────────
    "breathing_exercise",     # guided diaphragmatic / box breathing intervention
    "mindfulness_prompt",     # brief grounding / mindfulness check-in
]

# ─────────────────────────────────────────────────────────────────────────────
# CALMING_WEIGHT: continuous [0, 1] stress-reduction potential per action
# ─────────────────────────────────────────────────────────────────────────────
# Values: 0 = no calming effect (or may escalate), 1 = maximum de-escalation.
# Used in _stress_after_response() for continuous OU-decay stress modelling.
# Derived from action_selector.js SELECTION RULES + FRAMES/MI empirical literature.

CALMING_WEIGHT: dict[str, float] = {
    # High calming — use first under high stress
    "validate":              0.90,
    "empathic_reflection":   0.88,
    "unconditional_regard":  0.85,
    "affirmation":           0.82,
    "safety_protocol":       0.80,
    "breathing_exercise":    0.85,
    "mindfulness_prompt":    0.80,
    "validate_emotion":      0.88,
    "acknowledge_only":      0.65,
    "change_topic":          0.70,
    "address_resistance":    0.68,
    "motivational_frame":    0.65,
    # Moderate calming — safe under moderate stress
    "escalate":              0.65,
    "flooding_hold":         0.72,
    "flooding_deepen":       0.60,
    "build_alliance":        0.65,
    "summarise":             0.55,
    "summarise_session":     0.55,
    "oars_summary":          0.60,
    "invite_reflection":     0.60,
    "explore_ambivalence":   0.55,
    "suggest_coping_strategy": 0.70,
    "empathic_reflection":   0.88,   # duplicate anchor — key stays last
    # Moderate/neutral — context-dependent
    "open_question":         0.50,
    "socratic_probe":        0.45,
    "topic_from_stack":      0.45,
    "introduce_new_angle":   0.45,
    "elicit_change_talk":    0.50,
    "check_understanding":   0.50,
    "clarify_goal":          0.45,
    "invite_reflection":     0.55,
    # Low calming / may escalate — avoid under high stress
    "give_options":          0.40,
    "provide_information":   0.40,
    "give_facts":            0.30,
    "psychoeducation":       0.30,
    "specific_question":     0.35,
    "reframe_perspective":   0.40,
    "socratic_reframe":      0.38,
    # Potentially escalating — gated by stress level in production
    "challenger_insight":    0.20,
    "develop_discrepancy":   0.20,
    "loss_frame":            0.15,
    "end_conversation":      0.30,
    # New actions
    "spike_step":            0.25,   # SPIKE exposure — mild stress maintained
    "direct_advice":         0.35,   # brief directive; calming only in post-insight
    "schedule_commitment":   0.50,   # future focus reduces present tension slightly
    "future_planning":       0.55,   # envisioning positive future — mild de-stress
    "companion_handoff":     0.60,   # session summary — grounding, reduces uncertainty
    "share_circle_insight":  0.50,   # sharing circle context — trust-building if done well
}

# ─────────────────────────────────────────────────────────────────────────────
# ACTION_INTENT_GROUP: groupings for consistency reward shaping
# ─────────────────────────────────────────────────────────────────────────────
# Consecutive actions in the same intent group on non-repetition turns incur
# a consistency penalty (repetition without advance = low progress signal).
# Actions in different groups are always compatible.

ACTION_INTENT_GROUP: dict[str, str] = {
    # Asking
    "open_question":           "ask",
    "specific_question":       "ask",
    "probing_question":        "ask",
    "socratic_probe":          "ask",
    "topic_from_stack":        "ask",
    "invite_reflection":       "ask",
    "check_understanding":     "ask",
    # Informing
    "give_facts":              "inform",
    "give_options":            "inform",
    "psychoeducation":         "inform",
    "provide_information":     "inform",
    "clarify_goal":            "inform",
    # Validating / empathy
    "empathic_reflection":     "validate",
    "affirmation":             "validate",
    "validate":                "validate",
    "unconditional_regard":    "validate",
    "validate_emotion":        "validate",
    "acknowledge_only":        "validate",
    "build_alliance":          "validate",
    # Motivating / change-talk
    "challenger_insight":      "motivate",
    "develop_discrepancy":     "motivate",
    "socratic_reframe":        "motivate",
    "loss_frame":              "motivate",
    "motivational_frame":      "motivate",
    "elicit_change_talk":      "motivate",
    "reframe_perspective":     "motivate",
    "address_resistance":      "motivate",
    # Summarising / transitioning
    "summarise":               "summarise",
    "summarise_session":       "summarise",
    "oars_summary":            "summarise",
    # Topic / direction
    "change_topic":            "direction",
    "introduce_new_angle":     "direction",
    # Coping / somatic
    "suggest_coping_strategy": "coping",
    "breathing_exercise":      "coping",
    "mindfulness_prompt":      "coping",
    # Flooding
    "flooding_hold":           "flooding",
    "flooding_deepen":         "flooding",
    # Explore
    "explore_ambivalence":     "explore",
    # Safety / meta
    "escalate":                "safety",
    "safety_protocol":         "safety",
    "end_conversation":        "meta",
    # SPIKE / exposure
    "spike_step":              "flooding",
    # Commitment / future-focus
    "direct_advice":           "inform",
    "schedule_commitment":     "commitment",
    "future_planning":         "commitment",
    # Cross-circle relay
    "companion_handoff":       "summarise",
    "share_circle_insight":    "inform",
}

# ─────────────────────────────────────────────────────────────────────────────
# Stress bucket definitions
# ─────────────────────────────────────────────────────────────────────────────

STRESS_BUCKETS: dict[str, tuple[float, float]] = {
    "low":       (45.0, float('inf')),   # HRV > 45ms  — calm, engaged
    "moderate":  (25.0, 45.0),           # HRV 25–45ms — mildly stressed
    "high":      (0.0,  25.0),           # HRV < 25ms  — distressed, crisis risk
}


def stress_bucket_for_hrv(hrv_ms: float) -> str:
    """Map a raw HRV RMSSD value to a stress bucket label."""
    for bucket, (lo, hi) in STRESS_BUCKETS.items():
        if lo <= hrv_ms < hi:
            return bucket
    return "moderate"


# ─────────────────────────────────────────────────────────────────────────────
# I1: ActionBandit — Beta posterior per action per stress bucket
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ActionBandit:
    """
    Beta-distribution Thompson Sampling bandit over (stress_bucket, action) pairs.

    Each arm is a (bucket, action) pair with a Beta(alpha, beta) posterior.
    alpha tracks cumulative successes (high reward), beta tracks failures (low reward).

    The Beta distribution is conjugate to the Bernoulli, so updates are O(1):
      success:  alpha[b][a] += reward          (fractional update for continuous reward)
      failure:  beta[b][a]  += (1 - reward)

    Attributes:
        alpha  : dict[bucket][action] → float  (posterior success counts, init 1.0)
        beta_  : dict[bucket][action] → float  (posterior failure counts, init 1.0)
        pulls  : dict[bucket][action] → int    (total pulls per arm)
        episodes: number of training episodes completed
    """
    actions: list[str] = field(default_factory=lambda: list(ACTION_TAXONOMY))
    alpha:   dict      = field(default_factory=dict)
    beta_:   dict      = field(default_factory=dict)
    pulls:   dict      = field(default_factory=dict)
    episodes: int      = 0

    def __post_init__(self):
        for bucket in STRESS_BUCKETS:
            self.alpha[bucket]  = {a: 1.0 for a in self.actions}
            self.beta_[bucket]  = {a: 1.0 for a in self.actions}
            self.pulls[bucket]  = {a: 0   for a in self.actions}

    # ── I2: Thompson Sampling selection ─────────────────────────────────────

    def select_action(self, hrv_ms: float, exclude: list[str] | None = None) -> str:
        """
        I2: Select a single action via Thompson Sampling.

        For each candidate action, sample θ ~ Beta(α, β). Choose argmax(θ).
        This naturally balances exploration (uncertain arms) vs exploitation.

        Arguments:
            hrv_ms  : current HRV RMSSD in milliseconds (used to select stress bucket)
            exclude : actions to exclude from selection (e.g. already used this turn)

        Returns:
            Selected action string.
        """
        bucket = stress_bucket_for_hrv(hrv_ms)
        candidates = [a for a in self.actions if a not in (exclude or [])]
        if not candidates:
            candidates = list(self.actions)

        scores: dict[str, float] = {}
        for action in candidates:
            a = self.alpha[bucket][action]
            b = self.beta_[bucket][action]
            scores[action] = _beta_sample(a, b)

        return max(scores, key=lambda x: scores[x])

    def select_actions_poisson(
        self,
        hrv_ms:   float,
        base_lam: float = 1.5,
    ) -> list[str]:
        """
        Poisson K multi-action selection (λ=1.5 by default, per user spec §Q6a).

        Samples K ~ Poisson(λ_effective) where λ_effective is learned per stress
        bucket (high stress → lower λ, calmer → higher λ), then selects K
        distinct actions without replacement via Thompson Sampling.

        Design notes
        ------------
        - K is Poisson-sampled, not deterministic.  This makes the action count
          stochastic and interpretable (expected actions = λ).
        - Under high stress, λ is reduced because multi-action turns fragment
          patient attention — single focused de-escalation is empirically better.
        - Actions within the same ACTION_INTENT_GROUP are penalised when selected
          consecutively (consistency penalty — see arms.py count_penalty).
        - Minimum K = 1, maximum K = 4 (hard cap to prevent overwhelming the
          patient's context window).

        Arguments:
            hrv_ms   : current HRV RMSSD in milliseconds
            base_lam : base Poisson rate (λ=1.5 by default)

        Returns:
            Ordered list of action strings (most important first).
        """
        bucket    = stress_bucket_for_hrv(hrv_ms)
        lam_eff   = self._effective_lambda(bucket, base_lam)
        k         = _poisson_sample(lam_eff)
        k         = max(1, min(k, 4))

        selected: list[str] = []
        for _ in range(k):
            action = self.select_action(hrv_ms, exclude=selected)
            selected.append(action)

        return selected

    def _effective_lambda(self, bucket: str, base_lam: float) -> float:
        """
        Stress-bucket-conditional Poisson rate.

        High stress → λ ≈ 1.0 (single focused action).
        Moderate   → λ ≈ base_lam (default behaviour).
        Low stress → λ ≈ base_lam + 0.5 (richer multi-action turns allowed).
        """
        bucket_lam_offset = {"low": 0.5, "moderate": 0.0, "high": -0.5}
        offset = bucket_lam_offset.get(bucket, 0.0)
        return max(1.0, base_lam + offset)

    def update(self, hrv_ms: float, action: str, reward: float) -> None:
        """
        Update Beta posterior for (bucket, action) after observing a reward.

        reward ∈ [0, 1]. Fractional updates allow continuous reward signals.
          α += reward
          β += (1 - reward)

        This is the standard Beta-Bernoulli conjugate update generalised to [0,1].
        See Russo et al. (2018) Section 2.2 for derivation.
        """
        bucket = stress_bucket_for_hrv(hrv_ms)
        if action not in self.actions:
            return
        self.alpha[bucket][action]  += reward
        self.beta_[bucket][action]  += (1.0 - reward)
        self.pulls[bucket][action]  += 1

    def arm_stats(self) -> dict:
        """Return summary statistics for all arms (for logging / diagnostics)."""
        stats = {}
        for bucket in STRESS_BUCKETS:
            stats[bucket] = {}
            for action in self.actions:
                a = self.alpha[bucket][action]
                b = self.beta_[bucket][action]
                total = a + b - 2.0  # subtract the Laplace prior of 1+1
                mean = a / (a + b)
                # Variance of Beta(α,β) = αβ / ((α+β)²(α+β+1))
                var = (a * b) / ((a + b) ** 2 * (a + b + 1))
                stats[bucket][action] = {
                    'alpha': round(a, 3),
                    'beta':  round(b, 3),
                    'mean_reward': round(mean, 4),
                    'std': round(math.sqrt(var), 4),
                    'pulls': self.pulls[bucket][action],
                    'total_reward': round(total, 3),
                }
        return stats

    # ── I4: Export weights for A3C actor initialisation ─────────────────────

    def export_actor_prior(self) -> dict:
        """
        I4: Export bandit weights as a prior for A3C actor (J2) initialisation.

        Format: {bucket: {action: mean_reward}} — the posterior mean μ = α/(α+β).
        The A3C actor (J2) uses these as log-probability biases in the initial policy
        head, so high-performing actions start with higher selection probability.

        The prior is soft: A3C will adjust these weights after the first few episodes.
        Actions with mean_reward > 0.6 get a positive log-prior bias.
        Actions with mean_reward < 0.4 get a negative log-prior bias.
        """
        prior: dict = {}
        for bucket in STRESS_BUCKETS:
            prior[bucket] = {}
            for action in self.actions:
                a = self.alpha[bucket][action]
                b = self.beta_[bucket][action]
                prior[bucket][action] = round(a / (a + b), 4)
        return prior

    def save(self, path: str | Path) -> None:
        """Persist bandit state to JSON for resumable training."""
        state = {
            'actions':  self.actions,
            'alpha':    self.alpha,
            'beta_':    self.beta_,
            'pulls':    self.pulls,
            'episodes': self.episodes,
        }
        Path(path).write_text(json.dumps(state, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> 'ActionBandit':
        """Load bandit state from JSON."""
        state = json.loads(Path(path).read_text())
        obj = cls(actions=state['actions'])
        obj.alpha    = state['alpha']
        obj.beta_    = state['beta_']
        obj.pulls    = state['pulls']
        obj.episodes = state['episodes']
        return obj


# ─────────────────────────────────────────────────────────────────────────────
# I3: Bandit training loop
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BanditTrainingConfig:
    """Hyperparameters for the bandit training loop (I3)."""
    n_episodes:        int   = 100    # total training episodes
    n_turns_per_ep:    int   = 10     # turns per episode
    hrv_noise_std:     float = 3.0    # OU noise for HRV simulation per turn
    hrv_ou_target:     float = 38.0   # OU mean-reversion target (ms)
    hrv_ou_theta:      float = 0.18   # OU mean-reversion rate
    seed:              int   = 42


def run_bandit_training(
    bandit: ActionBandit,
    reward_fn,
    config: BanditTrainingConfig | None = None,
    verbose: bool = False,
) -> dict:
    """
    I3: Run the Thompson Sampling bandit training loop.

    For each episode:
      1. Sample a starting HRV from a uniform prior over [20ms, 60ms].
      2. For each turn:
         a. Select an action via Thompson Sampling (select_action).
         b. Simulate HRV OU step.
         c. Compute reward from reward_fn(action, hrv_ms, turn).
         d. Update bandit posterior (update).
      3. Log episode results.

    Arguments:
        bandit     : ActionBandit instance to train.
        reward_fn  : Callable(action: str, hrv_ms: float, turn: int) -> float.
                     In the full A3C system, this calls the JS llm_scorer via the
                     FastAPI bridge. For I3 training and tests, use the default
                     _heuristic_reward() which is a fast heuristic.
        config     : BanditTrainingConfig hyperparameters.
        verbose    : If True, print episode-level stats.

    Returns:
        Training log dict with per-episode reward history and final arm stats.
    """
    if config is None:
        config = BanditTrainingConfig()

    rng = random.Random(config.seed)
    log: dict = {'episodes': [], 'config': config.__dict__}

    for ep in range(config.n_episodes):
        # Random starting HRV for this episode
        hrv_ms = rng.uniform(20.0, 60.0)
        ep_rewards: list[float] = []
        ep_actions: list[str]   = []

        for turn in range(config.n_turns_per_ep):
            action = bandit.select_action(hrv_ms)
            reward = float(reward_fn(action, hrv_ms, turn))
            reward = max(0.0, min(1.0, reward))  # clamp
            bandit.update(hrv_ms, action, reward)
            ep_rewards.append(reward)
            ep_actions.append(action)

            # OU step for HRV
            noise = rng.gauss(0, 1)
            hrv_ms += config.hrv_ou_theta * (config.hrv_ou_target - hrv_ms) + \
                      config.hrv_noise_std * noise
            hrv_ms = max(10.0, min(80.0, hrv_ms))

        mean_ep_reward = sum(ep_rewards) / len(ep_rewards)
        log['episodes'].append({
            'episode':    ep,
            'mean_reward': round(mean_ep_reward, 4),
            'actions':    ep_actions,
        })
        bandit.episodes += 1

        if verbose and (ep % 20 == 0 or ep == config.n_episodes - 1):
            print(f"  Episode {ep:3d}: mean_reward={mean_ep_reward:.4f}  "
                  f"most_used={max(set(ep_actions), key=ep_actions.count)}")

    log['arm_stats']    = bandit.arm_stats()
    log['actor_prior']  = bandit.export_actor_prior()
    return log


# ─────────────────────────────────────────────────────────────────────────────
# Heuristic reward function (for offline training without the live LLM)
# ─────────────────────────────────────────────────────────────────────────────

# Domain knowledge priors: appropriate action at each stress level.
# Rows = STRESS_BUCKETS; values = expected reward ∈ [0, 1].
# Derived from action_selector.js SELECTION RULES + mcts_reward.py WEIGHTS.
# A3C will refine these during training.
_HEURISTIC_REWARD_TABLE: dict[str, dict[str, float]] = {
    # ── Low stress: information and progress are most valuable ───────────────
    'low': {
        'open_question':        0.70,
        'specific_question':    0.65,
        'probing_question':     0.65,
        'socratic_probe':       0.68,
        'topic_from_stack':     0.60,
        'give_facts':           0.72,
        'give_options':         0.70,
        'psychoeducation':      0.70,
        'summarise':            0.60,
        'empathic_reflection':  0.60,
        'affirmation':          0.58,
        'validate':             0.55,
        'unconditional_regard': 0.55,
        'challenger_insight':   0.68,
        'develop_discrepancy':  0.65,
        'socratic_reframe':     0.65,
        'loss_frame':           0.60,
        'change_topic':         0.40,
        'introduce_new_angle':  0.55,
        'acknowledge_only':     0.35,
        'flooding_hold':        0.50,
        'flooding_deepen':      0.45,
        'oars_summary':         0.55,
        'escalate':             0.20,
        'safety_protocol':      0.20,
        'motivational_frame':   0.62,
        'end_conversation':     0.30,
        # Abstract MI / CBT actions
        'validate_emotion':     0.58,
        'explore_ambivalence':  0.65,
        'build_alliance':       0.60,
        'provide_information':  0.70,
        'reframe_perspective':  0.65,
        'elicit_change_talk':   0.70,
        'address_resistance':   0.55,
        'check_understanding':  0.60,
        'invite_reflection':    0.65,
        'suggest_coping_strategy': 0.58,
        'clarify_goal':         0.65,
        'summarise_session':    0.55,
        # Specific somatic
        'breathing_exercise':   0.55,
        'mindfulness_prompt':   0.55,
        # New actions (low stress: commitment and SPIKE are valuable)
        'spike_step':           0.55,
        'direct_advice':        0.65,
        'schedule_commitment':  0.68,
        'future_planning':      0.70,
        'companion_handoff':    0.65,
        'share_circle_insight': 0.62,
    },
    # ── Moderate stress: trust-building and reflection gain weight ────────────
    'moderate': {
        'open_question':        0.60,
        'specific_question':    0.55,
        'probing_question':     0.55,
        'socratic_probe':       0.55,
        'topic_from_stack':     0.55,
        'give_facts':           0.50,
        'give_options':         0.58,
        'psychoeducation':      0.50,
        'summarise':            0.55,
        'empathic_reflection':  0.75,
        'affirmation':          0.72,
        'validate':             0.78,
        'unconditional_regard': 0.72,
        'challenger_insight':   0.45,
        'develop_discrepancy':  0.45,
        'socratic_reframe':     0.50,
        'loss_frame':           0.40,
        'change_topic':         0.65,
        'introduce_new_angle':  0.55,
        'acknowledge_only':     0.50,
        'flooding_hold':        0.60,
        'flooding_deepen':      0.55,
        'oars_summary':         0.60,
        'escalate':             0.30,
        'safety_protocol':      0.25,
        'motivational_frame':   0.62,
        'end_conversation':     0.25,
        # Abstract MI / CBT actions
        'validate_emotion':     0.78,
        'explore_ambivalence':  0.65,
        'build_alliance':       0.70,
        'provide_information':  0.50,
        'reframe_perspective':  0.55,
        'elicit_change_talk':   0.60,
        'address_resistance':   0.65,
        'check_understanding':  0.55,
        'invite_reflection':    0.60,
        'suggest_coping_strategy': 0.70,
        'clarify_goal':         0.55,
        'summarise_session':    0.55,
        # Specific somatic
        'breathing_exercise':   0.72,
        'mindfulness_prompt':   0.68,
        # New actions (moderate stress: future/commitment moderate value; spike cautious)
        'spike_step':           0.40,
        'direct_advice':        0.45,
        'schedule_commitment':  0.55,
        'future_planning':      0.58,
        'companion_handoff':    0.55,
        'share_circle_insight': 0.52,
    },
    # ── High stress: only safety actions and direct de-escalation ─────────────
    'high': {
        'open_question':        0.30,
        'specific_question':    0.25,
        'probing_question':     0.25,
        'socratic_probe':       0.20,
        'topic_from_stack':     0.25,
        'give_facts':           0.20,
        'give_options':         0.30,
        'psychoeducation':      0.20,
        'summarise':            0.40,
        'empathic_reflection':  0.88,
        'affirmation':          0.82,
        'validate':             0.90,
        'unconditional_regard': 0.85,
        'challenger_insight':   0.15,
        'develop_discrepancy':  0.15,
        'socratic_reframe':     0.20,
        'loss_frame':           0.10,
        'change_topic':         0.70,
        'introduce_new_angle':  0.45,
        'acknowledge_only':     0.60,
        'flooding_hold':        0.72,
        'flooding_deepen':      0.65,
        'oars_summary':         0.55,
        'escalate':             0.65,
        'safety_protocol':      0.80,
        'motivational_frame':   0.55,
        'end_conversation':     0.40,
        # Abstract MI / CBT actions
        'validate_emotion':     0.90,
        'explore_ambivalence':  0.35,
        'build_alliance':       0.75,
        'provide_information':  0.20,
        'reframe_perspective':  0.30,
        'elicit_change_talk':   0.30,
        'address_resistance':   0.68,
        'check_understanding':  0.40,
        'invite_reflection':    0.45,
        'suggest_coping_strategy': 0.78,
        'clarify_goal':         0.30,
        'summarise_session':    0.45,
        # Specific somatic — critical under high stress
        'breathing_exercise':   0.88,
        'mindfulness_prompt':   0.82,
        # New actions (high stress: spike/advice harmful; future planning mild)
        'spike_step':           0.20,
        'direct_advice':        0.15,
        'schedule_commitment':  0.35,
        'future_planning':      0.40,
        'companion_handoff':    0.45,   # summarising can be grounding under stress
        'share_circle_insight': 0.30,   # risky under high stress — may overwhelm
    },
}


def heuristic_reward(action: str, hrv_ms: float, turn: int = 0,
                     noise_std: float = 0.08) -> float:
    """
    Domain-knowledge heuristic reward for bandit training without a live LLM.

    Returns a noisy reward sampled around the prior table value.
    The noise models the variability in patient responses to the same action.

    In production (live A3C), replace with a call to the JS llm_scorer bridge.
    """
    bucket = stress_bucket_for_hrv(hrv_ms)
    base = _HEURISTIC_REWARD_TABLE.get(bucket, {}).get(action, 0.5)
    noise = random.gauss(0, noise_std)
    return max(0.0, min(1.0, base + noise))


# ─────────────────────────────────────────────────────────────────────────────
# Helper: Beta sample via gamma ratio
# ─────────────────────────────────────────────────────────────────────────────

def _beta_sample(alpha: float, beta: float) -> float:
    """
    Sample from Beta(alpha, beta) using the gamma-ratio method.
    Standard in Thompson Sampling implementations (Russo et al. 2018).
    """
    x = random.gammavariate(alpha, 1.0)
    y = random.gammavariate(beta, 1.0)
    denom = x + y
    if denom < 1e-300:
        return 0.5
    return x / denom


def _poisson_sample(lam: float) -> int:
    """
    Sample K ~ Poisson(λ) using Knuth's algorithm (exact for λ < 30).
    Returns an integer ≥ 0.  Use _effective_lambda to keep λ < 5 in practice.
    """
    import math as _math
    L = _math.exp(-lam)
    k, p = 0, 1.0
    while p > L:
        k += 1
        p *= random.random()
    return k - 1


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: train and export in one call
# ─────────────────────────────────────────────────────────────────────────────

def train_and_export(
    n_episodes: int = 100,
    reward_fn=None,
    output_path: str | Path | None = None,
    verbose: bool = True,
) -> tuple[ActionBandit, dict]:
    """
    I1–I4 combined entry point: create bandit, run training, export prior.

    Arguments:
        n_episodes  : Number of training episodes.
        reward_fn   : reward_fn(action, hrv_ms, turn) -> float.
                      Defaults to heuristic_reward (no LLM required).
        output_path : If provided, save bandit state to this JSON file.
        verbose     : Print progress every 20 episodes.

    Returns:
        (bandit, training_log) where training_log['actor_prior'] is the
        dict ready for A3C actor (J2) initialisation.
    """
    if reward_fn is None:
        reward_fn = heuristic_reward

    bandit = ActionBandit()
    config = BanditTrainingConfig(n_episodes=n_episodes)
    log    = run_bandit_training(bandit, reward_fn, config, verbose=verbose)

    if output_path is not None:
        bandit.save(output_path)
        prior_path = Path(output_path).with_name(
            Path(output_path).stem + '_actor_prior.json'
        )
        prior_path.write_text(json.dumps(log['actor_prior'], indent=2))
        if verbose:
            print(f"\nBandit state saved to: {output_path}")
            print(f"Actor prior saved to:  {prior_path}")

    return bandit, log
