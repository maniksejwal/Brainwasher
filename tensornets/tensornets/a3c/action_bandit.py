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
    "validate_emotion",          # empathic reflection / validation
    "explore_ambivalence",       # MI ambivalence surfacing
    "build_alliance",            # therapeutic alliance reinforcement
    "provide_information",       # psychoeducation / factual update
    "reframe_perspective",       # cognitive reframe
    "elicit_change_talk",        # evocation of motivation
    "address_resistance",        # roll with resistance (MI)
    "check_understanding",       # comprehension check / teach-back
    "invite_reflection",         # Socratic open question
    "suggest_coping_strategy",   # concrete coping tool
    "clarify_goal",              # goal clarification / narrowing
    "summarise_session",         # recap and next-step alignment
]

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
        I2: Select an action via Thompson Sampling for the given HRV stress level.

        For each candidate action, sample θ ~ Beta(α, β). Choose argmax(θ).
        This naturally balances exploration (uncertain arms) vs exploitation (high α/β ratio).

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
            # Beta sample via standard gamma ratio: θ = Gamma(α,1) / (Gamma(α,1)+Gamma(β,1))
            scores[action] = _beta_sample(a, b)

        return max(scores, key=lambda x: scores[x])

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

# Domain knowledge priors: which actions are appropriate at which stress levels.
# These are conservative starting estimates; A3C will refine them.
# Values: expected reward ∈ [0, 1].
_HEURISTIC_REWARD_TABLE: dict[str, dict[str, float]] = {
    'low': {
        'validate_emotion':      0.55,
        'explore_ambivalence':   0.65,
        'build_alliance':        0.60,
        'provide_information':   0.70,
        'reframe_perspective':   0.65,
        'elicit_change_talk':    0.70,
        'address_resistance':    0.55,
        'check_understanding':   0.60,
        'invite_reflection':     0.65,
        'suggest_coping_strategy': 0.60,
        'clarify_goal':          0.65,
        'summarise_session':     0.55,
    },
    'moderate': {
        'validate_emotion':      0.75,  # validation is high-value under stress
        'explore_ambivalence':   0.55,
        'build_alliance':        0.70,
        'provide_information':   0.50,  # info dump under stress is counterproductive
        'reframe_perspective':   0.55,
        'elicit_change_talk':    0.50,
        'address_resistance':    0.60,
        'check_understanding':   0.55,
        'invite_reflection':     0.65,
        'suggest_coping_strategy': 0.70,
        'clarify_goal':          0.55,
        'summarise_session':     0.50,
    },
    'high': {
        'validate_emotion':      0.85,  # distressed patient needs validation first
        'explore_ambivalence':   0.35,  # complex cognitive task inappropriate
        'build_alliance':        0.80,
        'provide_information':   0.25,  # worst action under high stress
        'reframe_perspective':   0.30,
        'elicit_change_talk':    0.30,
        'address_resistance':    0.55,
        'check_understanding':   0.40,
        'invite_reflection':     0.50,
        'suggest_coping_strategy': 0.75,
        'clarify_goal':          0.35,
        'summarise_session':     0.45,
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
