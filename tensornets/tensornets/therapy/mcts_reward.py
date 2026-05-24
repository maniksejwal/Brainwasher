"""
Multi-dimensional MCTS reward for the HTN framework.

The current comparison_runner uses a single scalar cost: projected stress.
This is necessary but not sufficient. A response can reduce stress while:
  - Making no clinical progress (empty soothing)
  - Eroding trust (condescending phrasing)
  - Leaving required information uncovered
  - Contradicting another agent's prior statement

This module defines a vector cost C ∈ R^5 and its composition into a
weighted scalar for UCB1 comparison.

Dimensions
----------
1. STRESS_REDUCTION     Δσ = σ_t - σ_{t+n}  (positive = good)
                        Current: ✓ implemented via keyword heuristic.
                        Phase 3: ⟨Ψ|Γ|Ψ⟩ forward simulation.

2. GOAL_PROGRESS        How much does this turn advance the session goal?
                        Measured by: presence of required elements from
                        the current dialog graph node's required_elements list.
                        Current: ✓ partial (node required_elements in schema).
                        Phase 3: semantic cosine similarity to goal embedding.

3. TRUST_DELTA          Estimated change in patient's engagement level.
                        Proxy: presence of trust-building vs. trust-eroding signals
                        in the candidate text. Calibrated per ReactivityArchetype.
                        Current: ✗ not implemented → add keyword heuristic here.
                        Phase 3: separate trust-prediction head on the LLM.

4. INFO_COVERAGE        Fraction of required_elements covered so far in the session.
                        Penalises responses that loop over already-covered content
                        while leaving critical items unaddressed.
                        Current: ✗ not tracked.
                        Phase 3: slot-filling over dialog graph node sequence.

5. MULTI_AGENT_CONSISTENCY  Does this response align with the current framing
                            established by other agents (clinical, billing, empathy)?
                            Proxy: absence of contradiction signals.
                            Current: ✗ not implemented.
                            Phase 3: shared tensor state ⟨Ψ|V_int|Ψ⟩ inner product.

Weighting
---------
The weights depend on the therapeutic mode and session phase. In flooding therapy,
GOAL_PROGRESS (keep the patient in the stimulus) dominates. In rapport-building,
TRUST_DELTA dominates. In billing negotiation, INFO_COVERAGE dominates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from tensornets.therapy.modes import TherapeuticMode, DeaddictionPhase


# ── Weight vectors ─────────────────────────────────────────────────────────────

# Each row: [stress_reduction, goal_progress, trust_delta, info_coverage, consistency]
WEIGHTS: dict[str, list[float]] = {
    "standard":      [0.35, 0.25, 0.20, 0.15, 0.05],
    "flooding":      [0.10, 0.50, 0.15, 0.20, 0.05],   # goal = stay in stimulus
    "rapport":       [0.30, 0.10, 0.45, 0.10, 0.05],   # trust dominates
    "ambivalence":   [0.20, 0.25, 0.25, 0.25, 0.05],   # balanced
    "insight":       [0.15, 0.30, 0.20, 0.30, 0.05],   # coverage + progress
    "strike":        [0.20, 0.35, 0.20, 0.20, 0.05],   # progress matters most
    "negotiation":   [0.25, 0.20, 0.20, 0.30, 0.05],   # info coverage key
}

# Trust-building keywords (presence → positive trust delta)
TRUST_BUILD = frozenset({
    "understand", "hear", "together", "here for you", "your choice",
    "support", "advocate", "no judgment", "whenever", "brave",
    "i believe", "you know best", "your decision", "listen",
})

# Trust-eroding keywords (presence → negative trust delta)
TRUST_ERODE = frozenset({
    "should", "must", "have to", "you need to", "compliance",
    "non-compliant", "failure", "wrong", "incorrect", "however you",
    "technically", "as i said", "as mentioned",
})

# Goal-progress indicators per mode
GOAL_KEYWORDS: dict[str, frozenset] = {
    "standard":    frozenset({"appeal", "file", "document", "step", "option", "next"}),
    "flooding":    frozenset({"stay", "remain", "notice", "feel", "describe", "still here"}),
    "rapport":     frozenset({"tell me", "how are", "what matters", "personal", "share"}),
    "ambivalence": frozenset({"on one hand", "part of you", "wondering", "what if", "imagine"}),
    "insight":     frozenset({"noticed", "pattern", "when you", "every time", "what happens"}),
    "strike":      frozenset({"know", "truth", "silence", "sit with", "what would it feel"}),
    "negotiation": frozenset({"option", "propose", "fair", "both", "alternative", "request"}),
    "flooding":    frozenset({"stay", "hold", "don't run", "still there", "describe the"}),
}


# ── Multi-dimensional score ────────────────────────────────────────────────────

@dataclass
class RewardVector:
    stress_reduction:      float = 0.0   # positive = stress went down
    goal_progress:         float = 0.0   # [0, 1]
    trust_delta:           float = 0.0   # [-1, +1]
    info_coverage:         float = 0.0   # [0, 1]
    consistency:           float = 0.0   # [0, 1]

    def weighted_scalar(self, weights: list[float]) -> float:
        """Dot product with weight vector. Higher = better response."""
        return (
            weights[0] * self.stress_reduction
            + weights[1] * self.goal_progress
            + weights[2] * (self.trust_delta + 1.0) / 2.0   # shift to [0,1]
            + weights[3] * self.info_coverage
            + weights[4] * self.consistency
        )

    def as_cost(self, weights: list[float]) -> float:
        """Invert for minimisation-based MCTS (lower cost = better)."""
        return 1.0 - self.weighted_scalar(weights)


def score_candidate_multidim(
    candidate_text: str,
    base_stress: float,
    projected_stress: float,       # from existing stress model
    mode: TherapeuticMode,
    phase: DeaddictionPhase = DeaddictionPhase.RAPPORT,
    covered_elements: set[str] | None = None,
    required_elements: list[str] | None = None,
    prior_agent_framing: str = "",
) -> tuple[RewardVector, float]:
    """
    Compute a full RewardVector for one candidate response.

    Returns (RewardVector, weighted_scalar_cost).

    Parameters
    ----------
    candidate_text     : The candidate response text.
    base_stress        : Patient's current stress_index (before response).
    projected_stress   : Projected stress after n_lookahead turns (from modes.py).
    mode               : TherapeuticMode.
    phase              : DeaddictionPhase (only used when mode=DEADDICTION).
    covered_elements   : Set of required_elements already addressed in session.
    required_elements  : Full list of required elements for current graph node.
    prior_agent_framing: Key terms from other agents' recent responses (for consistency).
    """
    words_lower = candidate_text.lower()
    word_set    = set(words_lower.split())

    # ── Dimension 1: Stress reduction ────────────────────────────────────────
    stress_red = max(-1.0, min(1.0, base_stress - projected_stress))

    # ── Dimension 2: Goal progress ───────────────────────────────────────────
    mode_key  = phase.value if mode == TherapeuticMode.DEADDICTION else mode.value
    goal_kws  = GOAL_KEYWORDS.get(mode_key, GOAL_KEYWORDS.get("standard", frozenset()))
    goal_hits = sum(1 for kw in goal_kws if kw in words_lower)
    goal_prog = min(1.0, goal_hits / max(1, len(goal_kws) * 0.3))

    # ── Dimension 3: Trust delta ──────────────────────────────────────────────
    build_hits = sum(1 for kw in TRUST_BUILD if kw in words_lower)
    erode_hits = sum(1 for kw in TRUST_ERODE if kw in words_lower)
    trust_raw  = (build_hits - 2 * erode_hits) / max(1, build_hits + erode_hits + 1)
    trust_d    = max(-1.0, min(1.0, trust_raw))

    # ── Dimension 4: Info coverage ────────────────────────────────────────────
    if required_elements and len(required_elements) > 0:
        covered = covered_elements or set()
        newly_covered = sum(
            1 for el in required_elements
            if el.lower() not in covered and el.lower() in words_lower
        )
        total_remaining = len(required_elements) - len(covered)
        info_cov = min(1.0, newly_covered / max(1, total_remaining)) if total_remaining > 0 else 1.0
    else:
        # No required elements specified — assume neutral (0.5)
        info_cov = 0.5

    # ── Dimension 5: Multi-agent consistency ──────────────────────────────────
    if prior_agent_framing:
        prior_kws = set(prior_agent_framing.lower().split())
        overlap   = len(word_set & prior_kws)
        contra_markers = {"however", "actually", "but wait", "in fact", "on the other hand"}
        contra = sum(1 for m in contra_markers if m in words_lower)
        consistency = min(1.0, (overlap / max(1, len(prior_kws) * 0.2)) * (1 - min(1, contra * 0.4)))
    else:
        consistency = 0.8   # no prior framing — assume neutral

    rv = RewardVector(
        stress_reduction = stress_red,
        goal_progress    = goal_prog,
        trust_delta      = trust_d,
        info_coverage    = info_cov,
        consistency      = consistency,
    )

    weight_key = phase.value if mode == TherapeuticMode.DEADDICTION else mode.value
    weights    = WEIGHTS.get(weight_key, WEIGHTS["standard"])
    cost       = rv.as_cost(weights)

    return rv, cost


# ── Session-level tracking for INFO_COVERAGE ─────────────────────────────────

@dataclass
class SessionCoverageTracker:
    """
    Tracks which required elements have been addressed across all turns.
    Passed into score_candidate_multidim() as covered_elements.
    """
    required_elements: list[str] = field(default_factory=list)
    covered:           set[str]  = field(default_factory=set)

    def update(self, response_text: str) -> list[str]:
        """Mark elements present in response_text as covered. Returns newly covered."""
        lower = response_text.lower()
        newly = [el for el in self.required_elements
                 if el.lower() not in self.covered and el.lower() in lower]
        self.covered.update(n.lower() for n in newly)
        return newly

    @property
    def coverage_fraction(self) -> float:
        return len(self.covered) / max(1, len(self.required_elements))

    @property
    def uncovered(self) -> list[str]:
        return [el for el in self.required_elements if el.lower() not in self.covered]
