"""
base.py — BaseMCTS: Phase 3 Core MCTS Infrastructure
=====================================================

PHASE 3 OBJECTIVES (from RL_ENVIRONMENT.md / TODO.md)
------------------------------------------------------
  1. MCTSNode  — state node with UCB1 scoring
  2. BaseMCTS  — abstract tree search class shared by all MCTS instances:
                   DialogMCTS, ClauseMCTS, SchedulingMCTS
  3. SVD compression hook  — M_trunc (deferred to Phase 2 completion)
  4. Latency test          — tree search must complete < 300ms for 3-depth

WHY A BASE CLASS?
-----------------
Previously each MCTS variant (modes.py, clause_mcts.py, mcts_scheduling.py)
reimplemented UCB1, expansion, backpropagation independently.  This caused:
  - Divergent exploration constants (c=1.41 in modes.py, c=1.0 in clause_mcts)
  - Inconsistent reward normalisation
  - No shared logging / EXPERIMENTS.md tracing

BaseMCTS consolidates to a single UCB1 loop.  Subclasses only override:
  get_children()   — domain-specific state expansion
  rollout()        — domain-specific terminal reward estimate

MCTS DEPTH RECOMMENDATIONS (from RL_ENVIRONMENT.md)
----------------------------------------------------
  Within-session:    depth 3-10   (action space: micro dialogue moves)
  Document MCTS:     depth 3-5    (action space: clause presentation order)
  Scheduling MCTS:   depth 2-3    (action space: appointment slot)
  Longitudinal:      depth 3-5    (action space: deaddiction phase transitions)

  Deeper = better planning but O(branching^depth) compute.
  Default: depth=4, branching=4, iterations=80  → ~80 rollouts total.

MULTI-DIMENSIONAL REWARD VECTOR (from RL_ENVIRONMENT.md Section 3)
-------------------------------------------------------------------
  r = [stress_reduction, goal_progress, trust_delta, info_coverage, consistency]
  weighted by w_mode (mode-specific weight vector)

  BaseMCTS stores a reward_weights dict so each subclass can tune.
  Default weights:
    standard:     stress 0.4, goal 0.3, trust 0.2, info 0.1
    deaddiction:  stress 0.1, goal 0.3, trust 0.4, info 0.1, secrets 0.1
    flooding:     stress 0.6, goal 0.3, trust 0.1
    negotiation:  stress 0.2, goal 0.4, trust 0.2, info 0.2

HOW THIS CONNECTS TO THE COMPLETE SYSTEM
-----------------------------------------
  JS side (CompanionCoordinator.js)
    → POST /mcts/best-action  (tensornetsBridge.js)
    ← {action, score, tree_stats}

  Python side (server.py FastAPI)
    → DialogMCTS(BaseMCTS).search(state)
    ← best MCTSNode

  The JS system does NOT need to know MCTS internals.
  It sends: {physio_state, candidate_actions, mode, depth}
  It receives: {best_action, expected_reward, reasoning}
"""

from __future__ import annotations

import math
import time
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────────────────────
# Reward weights per therapeutic mode
# ─────────────────────────────────────────────────────────────────────────────

REWARD_WEIGHTS: dict[str, dict[str, float]] = {
    'standard': {
        'stress':    0.40,
        'goal':      0.30,
        'trust':     0.20,
        'info':      0.10,
    },
    'deaddiction': {
        'stress':    0.10,
        'goal':      0.30,
        'trust':     0.40,
        'info':      0.10,
        'secrets':   0.10,
    },
    'flooding': {
        'stress':    0.60,   # we WANT stress near target (cost ≠ minimise)
        'goal':      0.30,
        'trust':     0.10,
    },
    'negotiation': {
        'stress':    0.20,
        'goal':      0.40,
        'trust':     0.20,
        'info':      0.20,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# MCTSNode
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MCTSNode:
    """
    A single node in the MCTS tree.

    state:      domain-specific state (e.g., dict with physio + dialogue context)
    action:     the action that led to this node from its parent
    parent:     reference to parent node (None for root)
    children:   expanded child nodes
    visits:     N(s,a) — visit count
    total_reward: Q(s,a) — cumulative reward
    """
    state: Any
    action: Any = None
    parent: Optional['MCTSNode'] = None
    children: list['MCTSNode'] = field(default_factory=list)
    visits: int = 0
    total_reward: float = 0.0

    @property
    def q_value(self) -> float:
        """Average reward Q(s,a)."""
        return self.total_reward / max(1, self.visits)

    def ucb1(self, c: float = 1.414) -> float:
        """
        UCB1 score for tree policy selection.

        UCB1 = Q(s,a) + c * sqrt(ln(N_parent) / N(s,a))

        c=1.414 (sqrt(2)) is the standard exploration constant.
        Increase c for more exploration (useful in deaddiction where
        we need to surface less obvious long-horizon moves).
        """
        if self.visits == 0:
            return float('inf')
        parent_visits = self.parent.visits if self.parent else self.visits
        return self.q_value + c * math.sqrt(math.log(parent_visits) / self.visits)

    def is_leaf(self) -> bool:
        return len(self.children) == 0

    def best_child(self, c: float = 1.414) -> 'MCTSNode':
        """Select child with highest UCB1."""
        return max(self.children, key=lambda n: n.ucb1(c))

    def best_action_child(self) -> 'MCTSNode':
        """At inference: select child with highest Q (exploit, no exploration)."""
        return max(self.children, key=lambda n: n.q_value)

    def backpropagate(self, reward: float) -> None:
        """Propagate reward up to root."""
        self.visits += 1
        self.total_reward += reward
        if self.parent:
            self.parent.backpropagate(reward)


# ─────────────────────────────────────────────────────────────────────────────
# BaseMCTS
# ─────────────────────────────────────────────────────────────────────────────

class BaseMCTS(ABC):
    """
    Abstract base class for all MCTS variants in the HTN framework.

    Subclasses must implement:
        get_children(node)  — return list of MCTSNode children
        rollout(node)       — return float reward estimate for a leaf node

    Subclasses may override:
        compute_reward(reward_components)  — apply mode-specific weighting
        should_terminate(node, depth)      — early stop condition
    """

    def __init__(
        self,
        mode: str = 'standard',
        iterations: int = 80,
        max_depth: int = 4,
        exploration_c: float = 1.414,
        reward_weights: dict | None = None,
        seed: int | None = None,
    ):
        self.mode = mode
        self.iterations = iterations
        self.max_depth = max_depth
        self.c = exploration_c
        self.reward_weights = reward_weights or REWARD_WEIGHTS.get(mode, REWARD_WEIGHTS['standard'])
        if seed is not None:
            random.seed(seed)
        self._last_tree_stats: dict = {}

    # ── Abstract interface ──────────────────────────────────────────────────

    @abstractmethod
    def get_children(self, node: MCTSNode) -> list[MCTSNode]:
        """
        Expand node: return list of child MCTSNodes, each with their action.
        Should NOT modify node.children — BaseMCTS will do that.
        """

    @abstractmethod
    def rollout(self, node: MCTSNode) -> float:
        """
        Estimate the cumulative reward from node to a terminal state
        via a random/heuristic simulation policy.
        Should return a float in [0, 1].
        """

    # ── Public API ──────────────────────────────────────────────────────────

    def search(self, initial_state: Any) -> MCTSNode:
        """
        Run MCTS from initial_state.
        Returns the root node (with populated children + visit counts).
        Call .best_action_child() on root to get the best action.
        """
        t0 = time.perf_counter()
        root = MCTSNode(state=initial_state)

        for _ in range(self.iterations):
            # 1. SELECTION — traverse tree using UCB1
            node, depth = self._select(root)

            # 2. EXPANSION — if node is unexpanded and not terminal
            if not self.should_terminate(node, depth):
                children = self.get_children(node)
                if children:
                    node.children = children
                    node = random.choice(children)  # expand one child
                    depth += 1

            # 3. ROLLOUT — simulate to terminal
            reward = self.rollout(node)

            # 4. BACKPROPAGATION
            node.backpropagate(reward)

        elapsed_ms = (time.perf_counter() - t0) * 1000
        self._last_tree_stats = {
            'iterations': self.iterations,
            'depth': self.max_depth,
            'root_visits': root.visits,
            'n_children': len(root.children),
            'elapsed_ms': round(elapsed_ms, 1),
            'best_action': (root.best_action_child().action
                            if root.children else None),
            'best_q': (round(root.best_action_child().q_value, 4)
                       if root.children else None),
        }
        return root

    def best_action(self, initial_state: Any) -> dict:
        """
        Convenience: run search and return {action, q_value, tree_stats}.
        This is what the FastAPI endpoint calls.
        """
        root = self.search(initial_state)
        if not root.children:
            return {'action': None, 'q_value': 0.0, 'tree_stats': self._last_tree_stats}
        best = root.best_action_child()
        return {
            'action': best.action,
            'q_value': round(best.q_value, 4),
            'tree_stats': self._last_tree_stats,
        }

    def compute_reward(self, components: dict) -> float:
        """
        Combine multi-dimensional reward components using mode weights.

        components = {
            'stress':  float,   # For standard: 1 - normalised_stress
                                # For flooding: -abs(stress - target)
            'goal':    float,   # Goal progress delta
            'trust':   float,   # Trust/alliance delta
            'info':    float,   # Information coverage
            'secrets': float,   # (deaddiction) secret detection bonus
        }
        """
        total = 0.0
        for dim, weight in self.reward_weights.items():
            total += weight * components.get(dim, 0.0)
        return max(0.0, min(1.0, total))

    def should_terminate(self, node: MCTSNode, depth: int) -> bool:
        """Override for domain-specific terminal conditions."""
        return depth >= self.max_depth

    @property
    def tree_stats(self) -> dict:
        return self._last_tree_stats

    # ── Private ─────────────────────────────────────────────────────────────

    def _select(self, node: MCTSNode) -> tuple[MCTSNode, int]:
        """Traverse tree to a leaf using UCB1."""
        depth = 0
        while not node.is_leaf() and depth < self.max_depth:
            node = node.best_child(self.c)
            depth += 1
        return node, depth


# ─────────────────────────────────────────────────────────────────────────────
# DialogMCTS (within-session dialogue planning)
# ─────────────────────────────────────────────────────────────────────────────

class DialogMCTS(BaseMCTS):
    """
    MCTS for within-session dialogue planning.

    State shape:
      {
        'physio': PhysiologicalState-like dict,
        'hrv_ms': float,
        'stress_index': float,
        'action_taken': str,
        'turn': int,
        'mode': str,
        'candidate_actions': list[str],  # from action_selector.js
        'context': str,                  # recent dialogue text
      }

    Action space:  candidate_actions from the action_selector prompt
    Depth:         3-6 turns ahead
    Reward:        multi-dimensional (stress, goal, trust, info)

    ROLLOUT POLICY
    --------------
    For each candidate action, the rollout estimates:
      - stress_delta: from linguistic stress model (stress_model.py)
      - trust_delta: from action type (open_question → +trust, challenger → -trust+goal)
      - goal_delta: task-specific heuristic

    A real distilled model (Phase 5) will replace these heuristics.
    """

    # Action-type reward priors (heuristic, to be replaced by learned values)
    ACTION_REWARD_PRIORS: dict[str, dict] = {
        'open_question':        {'stress': -0.05, 'goal': +0.10, 'trust': +0.10},
        'empathic_reflection':  {'stress': -0.10, 'goal': +0.05, 'trust': +0.15},
        'affirmation':          {'stress': -0.08, 'goal': +0.05, 'trust': +0.12},
        'summary_reflection':   {'stress': -0.05, 'goal': +0.08, 'trust': +0.08},
        'challenger_insight':   {'stress': +0.15, 'goal': +0.20, 'trust': -0.05},
        'motivational_frame':   {'stress': -0.05, 'goal': +0.15, 'trust': +0.08},
        'psychoeducation':      {'stress': +0.05, 'goal': +0.15, 'trust': +0.05},
        'strategic_silence':    {'stress': -0.15, 'goal': +0.05, 'trust': +0.10},
        'spike_delivery':       {'stress': +0.25, 'goal': +0.30, 'trust': -0.10},
        'flooding_stimulus':    {'stress': +0.40, 'goal': +0.20, 'trust': -0.05},
        'direct_advice':        {'stress': +0.10, 'goal': +0.20, 'trust': -0.02},
        'document_reference':   {'stress': +0.05, 'goal': +0.15, 'trust': +0.05},
        'escalate_to_clinician':{'stress': +0.20, 'goal': +0.25, 'trust': -0.08},
    }

    def get_children(self, node: MCTSNode) -> list[MCTSNode]:
        state = node.state
        candidates = state.get('candidate_actions', list(self.ACTION_REWARD_PRIORS.keys())[:4])
        children = []
        for action in candidates:
            child_state = {
                **state,
                'action_taken': action,
                'turn': state.get('turn', 0) + 1,
                'stress_index': self._project_stress(state, action),
            }
            children.append(MCTSNode(state=child_state, action=action, parent=node))
        return children

    def rollout(self, node: MCTSNode) -> float:
        state = node.state
        action = state.get('action_taken', 'open_question')
        prior = self.ACTION_REWARD_PRIORS.get(action, {})

        current_stress = state.get('stress_index', 0.5)
        mode = state.get('mode', self.mode)

        # Compute per-dimension rewards
        if mode == 'flooding':
            target_stress = state.get('flooding_target_stress', 0.7)
            stress_component = 1.0 - abs(current_stress - target_stress)
        else:
            stress_component = max(0.0, 1.0 - current_stress + prior.get('stress', 0.0))

        components = {
            'stress': stress_component,
            'goal':   max(0.0, min(1.0, 0.5 + prior.get('goal', 0.0))),
            'trust':  max(0.0, min(1.0, 0.5 + prior.get('trust', 0.0))),
            'info':   0.5,  # neutral until linguistic model is wired
        }
        return self.compute_reward(components)

    def _project_stress(self, state: dict, action: str) -> float:
        """Project next-turn stress given action."""
        current = state.get('stress_index', 0.5)
        delta = self.ACTION_REWARD_PRIORS.get(action, {}).get('stress', 0.0)
        # OU mean-reversion approximation
        mean = state.get('stress_mean', 0.4)
        theta = 0.15
        projected = current + theta * (mean - current) + delta
        return max(0.05, min(0.95, projected))


# ─────────────────────────────────────────────────────────────────────────────
# Demo / smoke test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 60)
    print("BaseMCTS / DialogMCTS — Phase 3 smoke test")
    print("=" * 60)

    initial_state = {
        'physio': {},
        'hrv_ms': 28.0,
        'stress_index': 0.65,
        'turn': 0,
        'mode': 'deaddiction',
        'candidate_actions': [
            'open_question',
            'empathic_reflection',
            'challenger_insight',
            'affirmation',
        ],
        'context': 'Patient mentioned feeling hopeless about quitting.',
    }

    mcts = DialogMCTS(
        mode='deaddiction',
        iterations=120,
        max_depth=4,
        exploration_c=1.5,
        seed=42,
    )

    result = mcts.best_action(initial_state)
    stats = result['tree_stats']

    print(f"\nBest action  : {result['action']}")
    print(f"Q-value      : {result['q_value']}")
    print(f"Iterations   : {stats['iterations']}")
    print(f"Tree children: {stats['n_children']}")
    print(f"Elapsed      : {stats['elapsed_ms']} ms")
    assert stats['elapsed_ms'] < 300, "MCTS exceeded 300ms latency budget"

    # Show all child Q-values
    root = mcts.search(initial_state)
    print("\nAll action Q-values:")
    for child in sorted(root.children, key=lambda n: n.q_value, reverse=True):
        bar = '#' * int(child.q_value * 30)
        print(f"  {child.action:<26} Q={child.q_value:.4f}  N={child.visits:3d}  {bar}")

    print("\nPhase 3 smoke test PASSED")
