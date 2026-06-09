"""
tensornets.mcts.hierarchical_pw_voot — HP + VOOT + PW MCTS for dialogue planning.

Three complementary techniques combined into one tree:

1. Hierarchical Partitioning (HP)
   The 47-action ACTION_TAXONOMY is split into 6 semantically coherent clusters.
   Tree search operates at two tiers:
     Tier 1  cluster selection  (6 arms)       — VOOT bandit
     Tier 2  action selection   (~8 per cluster) — UCB1 with PW

2. VOOT Bandits (Variable-Order Option Trees)
   Cluster selection uses a variance-aware UCB bound:
     score = Q̄ + c_explore · √(ln N / n) + c_var · √(σ² / n)
   This penalises under-explored clusters even when their mean Q looks low,
   preventing the search from prematurely committing to one cluster.

3. Progressive Widening (PW)
   Within each cluster, actions are expanded one-at-a-time in LLM-prior rank
   order.  A new action is admitted when:
     n_admitted < C_pw · n_cluster^alpha      (default alpha=0.5, C_pw=2.0)
   This delays expanding rare/high-risk actions until the cluster has been
   explored enough to estimate their value reliably.

LLM prior
---------
The caller supplies an `llm_prior_fn(actions, state) -> list[float]` function
that returns a probability or score for each action given the current state.
For MPS-MCTS arms this is the existing Scout batch-score call.
For CoT-MCTS arms the prior is derived from the Maverick CoT ranking.

Hysteresis zone seeding
-----------------------
If `physio_state` contains `hysteresis_zone` (0-4), the cluster prior is
initialised using zone-to-cluster affinity weights:
  Zone 0 (calm)       → explore cluster boosted
  Zone 1 (mild)       → challenge cluster boosted
  Zone 2 (moderate)   → challenge + inform
  Zone 3 (elevated)   → de_escalate boosted
  Zone 4 (critical)   → de_escalate strongly forced, meta available
This converts the HysteresisGate signal directly into search guidance.

This module has no fallbacks.  Callers must handle RuntimeError from search().
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Callable, Any

from tensornets.mcts.base import BaseMCTS, MCTSNode, REWARD_WEIGHTS

# ── Action clusters ───────────────────────────────────────────────────────────
# Six semantically coherent groups.  Every entry in ACTION_TAXONOMY belongs to
# exactly one cluster.  The order within each cluster is the *default* PW
# expansion order — LLM prior will override this per-call.

ACTION_CLUSTERS: dict[str, list[str]] = {
    # Zone 3-4: high-stress → de-escalate first
    "de_escalate": [
        "validate",
        "empathic_reflection",
        "unconditional_regard",
        "affirmation",
        "validate_emotion",
        "breathing_exercise",
        "mindfulness_prompt",
        "flooding_hold",
        "acknowledge_only",
        "build_alliance",
    ],
    # Zone 0-1: low stress → explore to gather info and deepen rapport
    "explore": [
        "open_question",
        "specific_question",
        "probing_question",
        "socratic_probe",
        "topic_from_stack",
        "explore_ambivalence",
        "invite_reflection",
        "check_understanding",
    ],
    # Zone 1-2: moderate stress + good trust → productive challenge
    "challenge": [
        "challenger_insight",
        "develop_discrepancy",
        "socratic_reframe",
        "loss_frame",
        "address_resistance",
        "reframe_perspective",
        "elicit_change_talk",
    ],
    # Zone 1-2: psychoeducation and information transfer
    "inform": [
        "give_facts",
        "give_options",
        "psychoeducation",
        "provide_information",
        "suggest_coping_strategy",
        "motivational_frame",
    ],
    # Structural / session management actions
    "structure": [
        "summarise",
        "oars_summary",
        "summarise_session",       # L1: was missing from all clusters
        "change_topic",            # L1: was missing from all clusters
        "introduce_new_angle",     # L1: was missing from all clusters
        "companion_handoff",
        "share_circle_insight",
        "clarify_goal",
        "direct_advice",
        "schedule_commitment",
        "future_planning",
    ],
    # Safety / terminal / exposure escalation
    "meta": [
        "escalate",
        "safety_protocol",
        "end_conversation",
        "spike_step",
        "flooding_deepen",
    ],
}

# Reverse lookup: action → cluster name
_ACTION_TO_CLUSTER: dict[str, str] = {
    action: cluster
    for cluster, actions in ACTION_CLUSTERS.items()
    for action in actions
}

# Zone → cluster affinity boosts (additive to cluster Q prior)
# Higher value = stronger initial preference for this cluster at this zone.
_ZONE_CLUSTER_AFFINITY: dict[int, dict[str, float]] = {
    0: {"explore":    0.20, "challenge":   0.10, "inform":      0.10},
    1: {"challenge":  0.15, "explore":     0.10, "inform":      0.10},
    2: {"challenge":  0.12, "inform":      0.12, "de_escalate": 0.08},
    3: {"de_escalate": 0.25, "structure":  0.05},
    4: {"de_escalate": 0.40, "meta":       0.10},
}

# ── PW parameters ─────────────────────────────────────────────────────────────
PW_ALPHA:  float = 0.5    # expansion rate: admit new action when n^alpha changes
PW_C:      float = 2.0    # expansion coefficient: n_admitted < C_pw * n^alpha

# ── VOOT exploration constants ────────────────────────────────────────────────
# L3 fix: VOOT_C_VAR reduced from 0.8 to 0.4.
# At n=25 visits with σ²≈0.10, old value added +0.16 to every cluster score —
# comparable to the Q_mean gap between good/bad clusters, drowning the signal.
# 0.4 still provides variance-aware exploration without overriding zone affinity.
VOOT_C_EXPLORE: float = 1.414   # standard UCB exploration
VOOT_C_VAR:     float = 0.4     # variance bonus weight (reduced from 0.8, L3 fix)

# ── Warm-start persistence ────────────────────────────────────────────────────
# After each episode, cluster Q statistics are decayed and carried into the
# next search() call (warm start).  This eliminates cold-start inconsistency
# where the first ~30 iterations of every episode are wasted re-learning
# cluster priors that were already established in previous episodes.
#
# L4 fix: two-tier decay — aggressive early (explores all clusters), conservative
# late (preserves converged statistics).  Threshold = 500 arm episodes.
WARM_START_DECAY_EARLY: float = 0.75   # ep < 500: explore cluster space
WARM_START_DECAY_LATE:  float = 0.90   # ep ≥ 500: preserve converged statistics
WARM_START_EPISODE_THRESHOLD: int = 500
WARM_START_MIN_VISITS: int   = 3       # minimum synthetic visits after decay


# ── Cluster state ─────────────────────────────────────────────────────────────

@dataclass
class _ClusterState:
    """Per-cluster visit/reward statistics for the VOOT bandit."""
    name: str
    all_actions: list[str]           # full ordered list (may be LLM-ranked)
    admitted: list[str] = field(default_factory=list)  # PW-expanded so far
    visits:       int   = 0
    total_reward: float = 0.0
    _reward_sq:   float = 0.0        # sum of reward² for variance estimate
    q_bias:       float = 0.0        # additive zone-prior bias

    # ── Action-level UCB within cluster ─────────────────────────────────────
    _action_visits:  dict = field(default_factory=dict)
    _action_rewards: dict = field(default_factory=dict)

    @property
    def q_mean(self) -> float:
        return self.total_reward / max(1, self.visits)

    @property
    def q_var(self) -> float:
        if self.visits < 2:
            return 1.0
        mean_sq = self._reward_sq / self.visits
        return max(0.0, mean_sq - self.q_mean ** 2)

    def voot_score(self, n_total: int) -> float:
        """VOOT UCB: mean + exploration bonus + variance bonus + zone bias."""
        if self.visits == 0:
            return float('inf')
        log_n = math.log(max(2, n_total))
        explore = VOOT_C_EXPLORE * math.sqrt(log_n / self.visits)
        var_bo  = VOOT_C_VAR    * math.sqrt(self.q_var / self.visits)
        return self.q_mean + explore + var_bo + self.q_bias

    def pw_capacity(self) -> int:
        """Number of actions PW allows to be expanded given current visits."""
        return max(1, int(PW_C * math.pow(max(1, self.visits), PW_ALPHA)))

    def maybe_admit_next(self) -> str | None:
        """Admit the next un-expanded action if PW capacity allows."""
        if len(self.admitted) < self.pw_capacity() and len(self.admitted) < len(self.all_actions):
            next_action = self.all_actions[len(self.admitted)]
            self.admitted.append(next_action)
            self._action_visits[next_action]  = 0
            self._action_rewards[next_action] = 0.0
            return next_action
        return None

    def select_action(self) -> str:
        """UCB1 over the admitted actions."""
        unvisited = [a for a in self.admitted if self._action_visits[a] == 0]
        if unvisited:
            return random.choice(unvisited)
        return max(
            self.admitted,
            key=lambda a: (
                self._action_rewards[a] / max(1, self._action_visits[a])
                + 1.414 * math.sqrt(math.log(max(2, self.visits)) / self._action_visits[a])
            ),
        )

    def record_action(self, action: str, reward: float) -> None:
        self._action_visits[action]  = self._action_visits.get(action, 0) + 1
        self._action_rewards[action] = self._action_rewards.get(action, 0.0) + reward

    def record_cluster(self, reward: float) -> None:
        self.visits       += 1
        self.total_reward += reward
        self._reward_sq   += reward ** 2

    def warm_snapshot(self) -> dict:
        """Return a compact snapshot of statistics for warm-starting the next episode."""
        return {
            "q_mean":          self.q_mean,
            "visits":          self.visits,
            "_reward_sq":      self._reward_sq,
            "admitted":        list(self.admitted),
            "_action_visits":  dict(self._action_visits),
            "_action_rewards": dict(self._action_rewards),
        }

    def apply_warm_snapshot(self, snap: dict, decay: float) -> None:
        """
        Restore decayed statistics from a previous-episode snapshot.
        Decay factor shrinks Q-values toward zero while keeping visit counts
        high enough to avoid infinite VOOT UCB scores on the first iteration.
        """
        self.visits       = max(WARM_START_MIN_VISITS, int(snap["visits"] * decay))
        self.total_reward = snap["q_mean"] * self.visits * decay   # preserve Q_mean direction
        self._reward_sq   = snap["_reward_sq"] * decay ** 2
        # Restore admitted actions list (re-populate PW expansion state)
        for a in snap.get("admitted", []):
            if a not in self.admitted and a in self.all_actions:
                self.admitted.append(a)
                self._action_visits[a]  = max(1, int(snap["_action_visits"].get(a, 0) * decay))
                self._action_rewards[a] = snap["_action_rewards"].get(a, 0.0) * decay

    def best_action(self) -> str:
        if not self.admitted:
            raise RuntimeError(
                f"_ClusterState.best_action: cluster '{self.name}' has no admitted "
                f"actions.  PW did not expand any actions before best_action() was "
                f"called.  Ensure at least 1 iteration runs before extraction."
            )
        return max(
            self.admitted,
            key=lambda a: self._action_rewards[a] / max(1, self._action_visits[a]),
        )


# ── HierarchicalPWVOOTMCTS ────────────────────────────────────────────────────

class HierarchicalPWVOOTMCTS(BaseMCTS):
    """
    HP + VOOT + PW MCTS for within-session dialogue action selection.

    Parameters
    ----------
    llm_prior_fn : callable(actions: list[str], state: dict) -> list[float]
        Returns a score (higher = better) for each action in `actions` given
        the current state.  Called once per `search()` invocation.
        Scores need not sum to 1.0.
    mode : str
        Therapeutic mode (passed to compute_reward weight selection).
    iterations : int
        Total MCTS iteration budget.  Default 150.
    max_depth : int
        Maximum rollout depth within a cluster.  Default 20.
    exploration_c : float
        UCB exploration constant used for within-cluster action selection.
    seed : int | None
        RNG seed for reproducibility.
    """

    def __init__(
        self,
        llm_prior_fn: Callable[[list[str], dict], list[float]],
        mode: str = "standard",
        iterations: int = 150,
        max_depth: int = 20,
        exploration_c: float = 1.414,
        reward_weights: dict | None = None,
        seed: int | None = None,
    ):
        super().__init__(
            mode=mode,
            iterations=iterations,
            max_depth=max_depth,
            exploration_c=exploration_c,
            reward_weights=reward_weights,
            seed=seed,
        )
        self._llm_prior_fn = llm_prior_fn
        self._clusters: dict[str, _ClusterState] = {}
        self._n_total: int = 0   # total visits across all clusters
        # Warm-start snapshots: persisted across search() calls within a run
        self._warm_snapshots: dict[str, dict] = {}
        self._episode_count:  int             = 0   # episodes processed so far

    # ── Public API ──────────────────────────────────────────────────────────

    def search(self, initial_state: Any) -> MCTSNode:  # type: ignore[override]
        """
        Run HP+VOOT+PW search and return a synthetic root MCTSNode whose
        children carry per-action visit/reward statistics.

        Raises
        ------
        RuntimeError
            If llm_prior_fn raises or returns wrong-length list.
        """
        import time
        t0 = time.perf_counter()

        # ── 1. Initialise cluster states ────────────────────────────────────
        self._n_total = 0
        self._clusters = self._init_clusters(initial_state)

        # ── 2. Apply warm-start snapshots from previous episodes (if any) ────
        # L4 fix: adaptive decay — preserve converged statistics after 500 episodes.
        _decay = (
            WARM_START_DECAY_LATE
            if self._episode_count >= WARM_START_EPISODE_THRESHOLD
            else WARM_START_DECAY_EARLY
        )
        if self._warm_snapshots:
            for name, snap in self._warm_snapshots.items():
                if name in self._clusters:
                    self._clusters[name].apply_warm_snapshot(snap, _decay)
                    self._n_total += self._clusters[name].visits
        else:
            # Cold start: admit the first action in every cluster
            for cs in self._clusters.values():
                cs.maybe_admit_next()

        # ── 3. Main loop ────────────────────────────────────────────────────
        for _ in range(self.iterations):
            # a) VOOT cluster selection
            cs = self._select_cluster()

            # b) PW — possibly admit a new action before selecting
            cs.maybe_admit_next()

            # c) UCB1 action selection within cluster
            action = cs.select_action()

            # d) Rollout from a synthetic state for this (cluster, action)
            sim_state = {**initial_state, "action_taken": action}
            reward = self._rollout_action(sim_state, action)

            # e) Backpropagate
            cs.record_action(action, reward)
            cs.record_cluster(reward)
            self._n_total += 1

        # ── 4. Build a synthetic MCTSNode tree for compatibility ─────────────
        root = MCTSNode(state=initial_state)
        for cs in self._clusters.values():
            for action in cs.admitted:
                visits  = cs._action_visits.get(action, 0)
                rewards = cs._action_rewards.get(action, 0.0)
                child = MCTSNode(
                    state={**initial_state, "action_taken": action},
                    action=action,
                    parent=root,
                )
                child.visits       = visits
                child.total_reward = rewards
                root.children.append(child)

        elapsed_ms = (time.perf_counter() - t0) * 1000

        # ── 5. Save warm-start snapshots for next episode ────────────────────
        self._warm_snapshots = {name: cs.warm_snapshot() for name, cs in self._clusters.items()}
        self._episode_count += 1
        self._last_tree_stats = {
            "iterations":    self.iterations,
            "depth":         self.max_depth,
            "root_visits":   self._n_total,
            "n_children":    len(root.children),
            "n_admitted":    sum(len(cs.admitted) for cs in self._clusters.values()),
            "elapsed_ms":    round(elapsed_ms, 1),
            "episode_count": self._episode_count,
            "warm_start":    self._episode_count > 1,
            "clusters":      {
                name: {
                    "visits":    cs.visits,
                    "q_mean":    round(cs.q_mean, 4),
                    "q_var":     round(cs.q_var, 4),
                    "admitted":  cs.admitted,
                    "best":      cs.best_action() if cs.admitted else None,
                }
                for name, cs in self._clusters.items()
                if cs.visits > 0
            },
            "best_action":   root.best_action_child().action if root.children else None,
            "best_q":        round(root.best_action_child().q_value, 4) if root.children else None,
        }
        return root

    # ── BaseMCTS abstract interface (not used in flat HP search) ────────────

    def get_children(self, node: MCTSNode) -> list[MCTSNode]:
        """Not used in HP mode; raises to prevent accidental standard-mode calls."""
        raise RuntimeError(
            "HierarchicalPWVOOTMCTS.get_children: HP search does not use a "
            "standard node expansion tree.  Call search() directly."
        )

    def rollout(self, node: MCTSNode) -> float:
        """Not used directly; see _rollout_action."""
        raise RuntimeError(
            "HierarchicalPWVOOTMCTS.rollout: use _rollout_action instead."
        )

    # ── Private ─────────────────────────────────────────────────────────────

    def _init_clusters(self, state: dict) -> dict[str, _ClusterState]:
        """
        Build per-cluster state with LLM-prior-ranked action lists and
        optional hysteresis-zone affinity biases.
        """
        # Get LLM prior scores over all actions
        all_actions: list[str] = []
        for actions in ACTION_CLUSTERS.values():
            all_actions.extend(actions)
        # Deduplicate while preserving order (shouldn't have dupes but be safe)
        seen: set[str] = set()
        unique_actions = [a for a in all_actions if not (a in seen or seen.add(a))]  # type: ignore[func-returns-value]

        prior_scores = self._llm_prior_fn(unique_actions, state)
        if len(prior_scores) != len(unique_actions):
            raise RuntimeError(
                f"HierarchicalPWVOOTMCTS._init_clusters: llm_prior_fn returned "
                f"{len(prior_scores)} scores for {len(unique_actions)} actions. "
                f"They must match exactly."
            )
        score_map: dict[str, float] = dict(zip(unique_actions, prior_scores))

        # Zone-affinity bias
        hz = state.get("physio", {}).get("hysteresis_zone")
        zone_affinity: dict[str, float] = _ZONE_CLUSTER_AFFINITY.get(hz, {}) if hz is not None else {}

        clusters: dict[str, _ClusterState] = {}
        for cluster_name, actions in ACTION_CLUSTERS.items():
            # Sort actions within cluster by LLM prior (highest first = expanded first)
            ranked = sorted(actions, key=lambda a: score_map.get(a, 0.0), reverse=True)
            clusters[cluster_name] = _ClusterState(
                name=cluster_name,
                all_actions=ranked,
                q_bias=zone_affinity.get(cluster_name, 0.0),
            )
        return clusters

    def _select_cluster(self) -> _ClusterState:
        """Select cluster with highest VOOT UCB score."""
        return max(
            self._clusters.values(),
            key=lambda cs: cs.voot_score(self._n_total),
        )

    def _rollout_action(self, state: dict, action: str) -> float:
        """
        Single-turn reward estimate for a (state, action) pair using the
        same heuristic priors as DialogMCTS but extended with cluster-level
        stress logic.
        """
        from tensornets.mcts.base import DialogMCTS
        prior = DialogMCTS.ACTION_REWARD_PRIORS.get(action, {})

        stress      = state.get("stress_index", 0.5)
        mode        = state.get("mode", "standard")
        hz          = state.get("physio", {}).get("hysteresis_zone")
        cluster     = _ACTION_TO_CLUSTER.get(action, "structure")

        # Base reward components
        stress_delta = prior.get("stress", 0.0)
        goal_delta   = prior.get("goal",   0.0)
        trust_delta  = prior.get("trust",  0.0)

        # Penalise de-escalation actions in calm zone (low stress → wasteful)
        if cluster == "de_escalate" and stress < 0.25:
            goal_delta  -= 0.08
            trust_delta -= 0.03

        # Penalise challenge actions in critical zone (high stress → harmful)
        if cluster == "challenge" and stress > 0.65:
            goal_delta  -= 0.15
            trust_delta -= 0.10

        # Hysteresis zone bonus: reward correctly zone-matched actions
        if hz is not None:
            preferred_clusters = {
                0: {"explore", "challenge"},
                1: {"challenge", "explore", "inform"},
                2: {"challenge", "inform", "de_escalate"},
                3: {"de_escalate", "structure"},
                4: {"de_escalate", "meta"},
            }
            if cluster in preferred_clusters.get(hz, set()):
                goal_delta  += 0.06
                trust_delta += 0.03

        # Mode-specific weight lookup
        weights = self.reward_weights
        components = {
            "stress": max(-1.0, min(1.0, -stress_delta)),   # negative stress_delta = good
            "goal":   goal_delta,
            "trust":  trust_delta,
            "info":   0.05 if cluster == "inform" else 0.0,
        }
        score = self.compute_reward(components)

        # Clip to [0, 1]
        return max(0.0, min(1.0, score))
