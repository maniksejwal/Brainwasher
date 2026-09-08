"""
belief_graph.py — BG1-BG3: Per-user directed Belief Graph

PURPOSE
-------
The companion currently operates on *disclosed facts* (from facts_v2) and
*physiological state*.  But human behaviour is governed by *beliefs* — stable
cognitive schemas that persist across sessions, resist direct challenge, and
determine which facts the patient accepts or rejects.

This module implements a lightweight directed belief graph per user:
  - BeliefNode  : a single belief/fact with metadata (confidence, valence,
                  moral_weight, identity_linked, temporal_focus)
  - BeliefEdge  : directed relation between beliefs (supports/contradicts/
                  requires/undermines) with a strength value
  - BeliefGraph : the full graph for one user; supports discovery, interpolation,
                  salience scoring, and risk classification

DESIGN PRINCIPLES (BG1–BG3)
----------------------------
BG1  Data structure — BeliefNode, BeliefEdge, BeliefGraph (this file).
     Persisted as JSON alongside AllianceGraph in state/subjects/{id}/.

BG2  Belief discovery pipeline — extract new beliefs from conversation turns
     using a Scout LLM call (extract_beliefs_from_turn).  New nodes are merged
     into the graph with confidence-weighted updates.

BG3  Belief salience and risk classifier — classify beliefs as:
     - "foundational"  : many dependents; changing requires careful sequencing
     - "peripheral"    : few dependents; safe to challenge / explore early
     - "identity_core" : linked to self-concept; highest risk of rupture
     - "actionable"    : no dependents; direct target for therapeutic action

CITATIONS
---------
Beck, A.T. (1979). Cognitive Therapy of Depression. Guilford.
Young, J. (1999). Cognitive Therapy for Personality Disorders. Sarasota.
Hayes, S.C. et al. (2006). Acceptance and Commitment Therapy. Guilford.
"""
from __future__ import annotations

import json
import math
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


__all__ = [
    "BeliefNode",
    "BeliefEdge",
    "ConditionalEdge",
    "BeliefGraph",
    "extract_beliefs_from_turn",
    "load_belief_graph",
    "save_belief_graph",
]

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Relation types between beliefs
BELIEF_RELATIONS = frozenset({
    "supports",       # A makes B more plausible
    "contradicts",    # A conflicts with B
    "requires",       # A logically requires B to be true
    "undermines",     # A weakens the case for B (softer than contradicts)
    "enables",        # A is a prerequisite that unlocks B (conditional)
    "blocks",         # A prevents B from being held simultaneously
})

# Temporal focus of a belief
TEMPORAL_FOCUS = frozenset({"past", "present", "future", "timeless"})

# Source of belief discovery
BELIEF_SOURCE = frozenset({"stated", "inferred", "extrapolated", "therapist"})

# Risk tiers for companion strategy
RISK_TIER = frozenset({
    "foundational",   # high in-degree; changing cascades to many downstream beliefs
    "peripheral",     # low in-degree; safe to explore and challenge
    "identity_core",  # identity_linked=True; highest rupture risk
    "actionable",     # out-degree=0 or isolated; direct target for change
})

# Valence labels (can be +1, 0, -1 but stored as str for readability)
_VALENCE_MAP: dict[str, int] = {
    "positive": 1,
    "neutral": 0,
    "negative": -1,
}

# Discovery LLM prompt template (BG2)
_DISCOVERY_SYSTEM = (
    "You are a clinical psychologist extracting belief statements from a "
    "patient/caregiver transcript turn. Extract only beliefs that the speaker "
    "explicitly holds — not facts about the world, not questions. A belief is "
    "a cognitive schema: a conviction about oneself, others, the world, or the "
    "future that shapes emotional response."
)

_DISCOVERY_PROMPT = """
Transcript turn (speaker: {role}):
\"\"\"{text}\"\"\"

Extract up to 3 core beliefs expressed or implied. For each belief return:
- text: brief belief statement in first person (e.g. "I am a burden")
- confidence: 0–1 (how strongly held does it appear?)
- valence: "positive" | "neutral" | "negative"
- moral_weight: 0–1 (is this a moral/ethical belief, not just factual?)
- identity_linked: true/false (does it touch self-concept / who they are?)
- temporal_focus: "past" | "present" | "future" | "timeless"
- source: "stated" | "inferred"

Return JSON array. If no beliefs extractable, return [].
Example: [{{"text": "I am a burden to my family", "confidence": 0.8,
  "valence": "negative", "moral_weight": 0.3, "identity_linked": true,
  "temporal_focus": "timeless", "source": "inferred"}}]
"""

# Alpha for belief confidence update on re-confirmation
_ALPHA_BELIEF_UPDATE = 0.15


# ─────────────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BeliefNode:
    """A single belief held by a user.

    id          : unique node identifier (uuid4 hex)
    text        : first-person belief statement ("I am a burden to my family")
    confidence  : 0–1, how strongly the patient holds this belief
    valence     : +1 positive, 0 neutral, -1 negative
    moral_weight: 0–1, ethical/moral dimension (0 = purely factual)
    identity_linked: True if this belief forms part of self-concept
    temporal_focus : "past" | "present" | "future" | "timeless"
    source      : how this belief was discovered
    created_at  : unix timestamp of first extraction
    last_seen_at: unix timestamp of most recent confirmation
    session_count: number of sessions in which this belief has appeared

    Provenance fields
    -----------------
    turn_id         : turn identifier where this belief was first extracted.
    session_id      : session identifier at time of first extraction.
    patient_stress  : patient's stress_index at extraction time [0–1].
                      High-stress beliefs may be state_dependent — tracked by OBS1.
                      A belief stated at stress > 0.7 has lower confidence reliability.
    obs_credibility : observation credibility weight at extraction time [0.15–1.0].
                      Beliefs extracted at credibility < 0.70 are "low-provenance" and
                      should not be treated as foundational until re-confirmed.
    speaker_role    : whose belief — "patient" | "caregiver" | "clinician" | "other".
    """
    id:              str
    text:            str
    confidence:      float          = 0.5
    valence:         int            = 0       # +1 / 0 / -1
    moral_weight:    float          = 0.0
    identity_linked: bool           = False
    temporal_focus:  str            = "timeless"
    source:          str            = "inferred"
    created_at:      float          = field(default_factory=time.time)
    last_seen_at:    float          = field(default_factory=time.time)
    session_count:   int            = 1
    # Provenance
    turn_id:         str            = ""
    session_id:      str            = ""
    patient_stress:  float          = 0.5
    obs_credibility: float          = 1.0
    speaker_role:    str            = "patient"

    @classmethod
    def new(
        cls,
        text: str,
        confidence: float = 0.5,
        valence: str = "neutral",
        moral_weight: float = 0.0,
        identity_linked: bool = False,
        temporal_focus: str = "timeless",
        source: str = "inferred",
    ) -> "BeliefNode":
        return cls(
            id=uuid.uuid4().hex,
            text=text,
            confidence=confidence,
            valence=_VALENCE_MAP.get(valence, 0),
            moral_weight=moral_weight,
            identity_linked=identity_linked,
            temporal_focus=temporal_focus,
            source=source,
        )

    def update_confidence(self, new_confidence: float) -> None:
        """EWA confidence update on re-confirmation."""
        self.confidence = round(
            (1 - _ALPHA_BELIEF_UPDATE) * self.confidence
            + _ALPHA_BELIEF_UPDATE * new_confidence,
            4,
        )
        self.last_seen_at = time.time()
        self.session_count += 1

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "text":            self.text,
            "confidence":      self.confidence,
            "valence":         self.valence,
            "moral_weight":    self.moral_weight,
            "identity_linked": self.identity_linked,
            "temporal_focus":  self.temporal_focus,
            "source":          self.source,
            "created_at":      self.created_at,
            "last_seen_at":    self.last_seen_at,
            "session_count":   self.session_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BeliefNode":
        return cls(
            id              = d["id"],
            text            = d["text"],
            confidence      = float(d.get("confidence", 0.5)),
            valence         = int(d.get("valence", 0)),
            moral_weight    = float(d.get("moral_weight", 0.0)),
            identity_linked = bool(d.get("identity_linked", False)),
            temporal_focus  = d.get("temporal_focus", "timeless"),
            source          = d.get("source", "inferred"),
            created_at      = float(d.get("created_at", time.time())),
            last_seen_at    = float(d.get("last_seen_at", time.time())),
            session_count   = int(d.get("session_count", 1)),
            turn_id         = d.get("turn_id", ""),
            session_id      = d.get("session_id", ""),
            patient_stress  = float(d.get("patient_stress", 0.5)),
            obs_credibility = float(d.get("obs_credibility", 1.0)),
            speaker_role    = d.get("speaker_role", "patient"),
        )


@dataclass
class BeliefEdge:
    """Directed relation from one belief to another.

    from_id  : source belief node id
    to_id    : target belief node id
    relation : one of BELIEF_RELATIONS
    strength : 0–1, how strongly the relation holds

    Provenance fields
    -----------------
    turn_id    : when this edge was first established
    session_id : session at edge creation
    """
    from_id:    str
    to_id:      str
    relation:   str   = "supports"
    strength:   float = 0.5
    turn_id:    str   = ""
    session_id: str   = ""

    def to_dict(self) -> dict:
        return {
            "from_id":    self.from_id,
            "to_id":      self.to_id,
            "relation":   self.relation,
            "strength":   self.strength,
            "turn_id":    self.turn_id,
            "session_id": self.session_id,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BeliefEdge":
        return cls(
            from_id    = d["from_id"],
            to_id      = d["to_id"],
            relation   = d.get("relation", "supports"),
            strength   = float(d.get("strength", 0.5)),
            turn_id    = d.get("turn_id", ""),
            session_id = d.get("session_id", ""),
        )


@dataclass
class ConditionalEdge:
    """
    Conditional dependency: belief B is held IF condition C is resolved true.

    Motivation (Schrodinger's cat framing):
    ----------------------------------------
    Many beliefs only exist in a superposition until a condition resolves.
    Example:
      B = "I should quit my job"
      C = "my boss will agree with my performance review"
      Edge: B DEPENDS ON C
        if_true_delta  = +0.4   → if C resolves true,  B's confidence rises 0.4
        if_false_delta = -0.5   → if C resolves false, B's confidence drops 0.5

    Before C resolves, B is in a *contingent* state — the companion should:
      1. Not treat B as actionable until C is resolved.
      2. Help the patient explore C (what will the review actually say?).
      3. Plan for both branches (prepare for each outcome).

    States
    ------
    is_resolved : False = condition unresolved (superposition active).
    resolution  : "true" | "false" | "" (empty = unresolved).

    When is_resolved=True and resolution is set, the graph should apply the
    confidence delta to `to_id` and archive or remove the ConditionalEdge.

    Provenance fields same as BeliefEdge.
    """
    from_id:         str           # the node that is contingent
    condition_text:  str           # natural-language description of the condition
    to_id:           str           # the condition node (resolves this edge)
    if_true_delta:   float = +0.3  # how much `from_id` confidence rises if condition true
    if_false_delta:  float = -0.3  # how much `from_id` confidence falls if condition false
    is_resolved:     bool  = False
    resolution:      str   = ""    # "true" | "false" | ""
    turn_id:         str   = ""
    session_id:      str   = ""
    created_at:      float = field(default_factory=time.time)

    def apply_resolution(
        self,
        graph: "BeliefGraph",
        resolution: str,
    ) -> float:
        """
        Resolve the condition and return the confidence delta applied to from_id.

        Sets is_resolved=True, records the resolution, applies the delta to the
        contingent belief node in the graph, and returns the applied delta.

        Parameters
        ----------
        graph      : the BeliefGraph containing from_id
        resolution : "true" | "false"

        Returns
        -------
        float : applied confidence delta (positive = belief strengthened)
        """
        self.is_resolved = True
        self.resolution  = resolution
        delta = self.if_true_delta if resolution == "true" else self.if_false_delta
        node  = graph.nodes.get(self.from_id)
        if node is not None:
            node.confidence = round(max(0.0, min(1.0, node.confidence + delta)), 4)
            node.last_seen_at = time.time()
        return delta

    def to_dict(self) -> dict:
        return {
            "from_id":        self.from_id,
            "condition_text": self.condition_text,
            "to_id":          self.to_id,
            "if_true_delta":  self.if_true_delta,
            "if_false_delta": self.if_false_delta,
            "is_resolved":    self.is_resolved,
            "resolution":     self.resolution,
            "turn_id":        self.turn_id,
            "session_id":     self.session_id,
            "created_at":     self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ConditionalEdge":
        return cls(
            from_id         = d["from_id"],
            condition_text  = d.get("condition_text", ""),
            to_id           = d["to_id"],
            if_true_delta   = float(d.get("if_true_delta",  +0.3)),
            if_false_delta  = float(d.get("if_false_delta", -0.3)),
            is_resolved     = bool(d.get("is_resolved", False)),
            resolution      = d.get("resolution", ""),
            turn_id         = d.get("turn_id", ""),
            session_id      = d.get("session_id", ""),
            created_at      = float(d.get("created_at", time.time())),
        )


# ─────────────────────────────────────────────────────────────────────────────
# BeliefGraph
# ─────────────────────────────────────────────────────────────────────────────

class BeliefGraph:
    """Directed belief graph for a single user.

    nodes  : dict[node_id, BeliefNode]
    edges  : list[BeliefEdge]

    Key methods
    -----------
    add_or_update(belief_dict)  — merge a newly extracted belief into the graph
    risk_tier(node_id)          — classify a node as foundational/peripheral/etc
    safe_targets()              — return peripheral + actionable nodes (safe to probe)
    risky_targets()             — return identity_core + foundational nodes (avoid)
    cascade_impact(node_id)     — compute downstream influence if this belief shifts
    prompt_context(max_nodes)   — generate a companion hint string for this user's beliefs
    """

    def __init__(self, subject_id: str = "unknown") -> None:
        self.subject_id: str                     = subject_id
        self.nodes: dict[str, BeliefNode]        = {}
        self.edges: list[BeliefEdge]             = []
        self.conditional_edges: list[ConditionalEdge] = []

    # ── Accessors ────────────────────────────────────────────────────────────

    def in_degree(self, node_id: str) -> int:
        """Number of edges pointing INTO this node (how many beliefs support/require it)."""
        return sum(1 for e in self.edges if e.to_id == node_id)

    def out_degree(self, node_id: str) -> int:
        """Number of edges pointing OUT of this node (how many beliefs it influences)."""
        return sum(1 for e in self.edges if e.from_id == node_id)

    def successors(self, node_id: str) -> list[str]:
        """Nodes directly influenced by this belief."""
        return [e.to_id for e in self.edges if e.from_id == node_id]

    def predecessors(self, node_id: str) -> list[str]:
        """Nodes that directly influence this belief."""
        return [e.from_id for e in self.edges if e.to_id == node_id]

    # ── Mutation ─────────────────────────────────────────────────────────────

    def add_node(self, node: BeliefNode) -> None:
        self.nodes[node.id] = node

    def add_edge(self, edge: BeliefEdge) -> None:
        if edge.from_id in self.nodes and edge.to_id in self.nodes:
            # Avoid duplicate edges
            for existing in self.edges:
                if existing.from_id == edge.from_id and existing.to_id == edge.to_id:
                    existing.strength = round(
                        (1 - _ALPHA_BELIEF_UPDATE) * existing.strength
                        + _ALPHA_BELIEF_UPDATE * edge.strength,
                        4,
                    )
                    return
            self.edges.append(edge)

    def add_or_update(self, belief_dict: dict) -> str:
        """Merge a newly extracted belief into the graph.

        If a belief with similar text already exists (fuzzy match), update its
        confidence.  Otherwise add a new node.  Returns the node id.
        """
        text = belief_dict.get("text", "").strip()
        if not text:
            return ""

        # Simple duplicate check: exact lower-case match or ≥ 70% word overlap
        existing_id = self._find_similar(text)
        if existing_id:
            node = self.nodes[existing_id]
            node.update_confidence(float(belief_dict.get("confidence", node.confidence)))
            return existing_id

        node = BeliefNode.new(
            text            = text,
            confidence      = float(belief_dict.get("confidence", 0.5)),
            valence         = belief_dict.get("valence", "neutral"),
            moral_weight    = float(belief_dict.get("moral_weight", 0.0)),
            identity_linked = bool(belief_dict.get("identity_linked", False)),
            temporal_focus  = belief_dict.get("temporal_focus", "timeless"),
            source          = belief_dict.get("source", "inferred"),
        )
        self.add_node(node)
        return node.id

    def remove_stale_beliefs(self, max_age_days: float = 180.0) -> int:
        """Remove beliefs not seen in max_age_days with low confidence."""
        cutoff = time.time() - max_age_days * 86400
        to_remove = [
            nid for nid, n in self.nodes.items()
            if n.last_seen_at < cutoff and n.confidence < 0.25 and not n.identity_linked
        ]
        for nid in to_remove:
            del self.nodes[nid]
            self.edges = [e for e in self.edges
                          if e.from_id != nid and e.to_id != nid]
            self.conditional_edges = [
                ce for ce in self.conditional_edges
                if ce.from_id != nid and ce.to_id != nid
            ]
        return len(to_remove)

    # ── Conditional edge management ───────────────────────────────────────────

    def add_conditional_edge(
        self,
        from_id:        str,
        condition_text: str,
        to_id:          str,
        if_true_delta:  float = +0.3,
        if_false_delta: float = -0.3,
        turn_id:        str   = "",
        session_id:     str   = "",
    ) -> ConditionalEdge:
        """
        Add a conditional dependency: `from_id` belief's confidence depends on
        whether the condition described by `condition_text` (anchored at `to_id`)
        resolves true or false.

        If an unresolved conditional edge between the same pair already exists,
        it is returned unchanged (deduplication).
        """
        existing = next(
            (ce for ce in self.conditional_edges
             if ce.from_id == from_id and ce.to_id == to_id and not ce.is_resolved),
            None,
        )
        if existing:
            return existing
        ce = ConditionalEdge(
            from_id         = from_id,
            condition_text  = condition_text,
            to_id           = to_id,
            if_true_delta   = if_true_delta,
            if_false_delta  = if_false_delta,
            turn_id         = turn_id,
            session_id      = session_id,
        )
        self.conditional_edges.append(ce)
        return ce

    def resolve_condition(
        self,
        to_id:      str,
        resolution: str,
    ) -> list[float]:
        """
        Resolve all unresolved conditional edges that point to `to_id`.

        When a condition node resolves, all contingent beliefs that depended
        on it have their confidence updated.  Resolved edges remain in the list
        (for audit provenance) but are marked is_resolved=True.

        Parameters
        ----------
        to_id      : the condition node that has now resolved
        resolution : "true" | "false"

        Returns
        -------
        list[float] : confidence deltas applied to each contingent belief
        """
        deltas: list[float] = []
        for ce in self.conditional_edges:
            if ce.to_id == to_id and not ce.is_resolved:
                delta = ce.apply_resolution(self, resolution)
                deltas.append(delta)
        return deltas

    def pending_conditionals(self) -> list[ConditionalEdge]:
        """Return all unresolved conditional edges (Schrodinger beliefs)."""
        return [ce for ce in self.conditional_edges if not ce.is_resolved]

    def get_active_nodes(self, top_n: int = 6) -> list["BeliefNode"]:
        """
        Return the top-N most salient belief nodes for use as coupling topic anchors.

        Salience score:
            confidence × recency_weight × (1.5 if identity_linked else 1.0)

        Where recency_weight = 1 / (1 + days_since_last_seen) so recently
        confirmed beliefs rank above stale ones even at equal confidence.

        Used by LLM-driven topic coupling (Exp 22) to replace the static
        TOPIC_CLUSTERS list with patient-specific first-person belief statements.
        Cold-start (empty graph) returns an empty list — caller falls back to
        category-based coupling.
        """
        if not self.nodes:
            return []

        now = time.time()
        def _salience(node: "BeliefNode") -> float:
            days_old = max(0.0, (now - node.last_seen_at) / 86_400)
            recency  = 1.0 / (1.0 + days_old)
            identity_boost = 1.5 if node.identity_linked else 1.0
            return node.confidence * recency * identity_boost

        sorted_nodes = sorted(self.nodes.values(), key=_salience, reverse=True)
        return sorted_nodes[:top_n]

    def low_provenance_beliefs(self) -> list["BeliefNode"]:
        """
        Return beliefs whose extraction provenance is unreliable.

        Unreliable provenance = extracted at obs_credibility < 0.70 AND
        patient_stress > 0.65 (state-dependent distortion likely).

        These should not be treated as foundational or identity_core
        until re-confirmed in a lower-stress, higher-credibility session.
        """
        return [
            n for n in self.nodes.values()
            if n.obs_credibility < 0.70 and n.patient_stress > 0.65
        ]

    # ── FOR1: Memory fade ─────────────────────────────────────────────────────

    _FADE_RATE: float = 0.90   # confidence × 0.90^(gap_days/30) per session gap

    def apply_memory_fade(self, gap_days: float) -> list[str]:
        """FOR1: Decay unconfirmed belief confidence across a session gap.

        Models human memory: beliefs not revisited in the last session naturally
        weaken.  Confidence is multiplied by `_FADE_RATE ^ (gap_days / 30)` for
        each node that has not been updated this session (i.e., its ``session_id``
        does not match ``current_session_id`` if provided, or simply all nodes).

        Beliefs whose confidence drops below 0.15 are demoted to ``confidence=0.15``
        (not deleted — they may resurface in future sessions).

        Returns the list of node IDs that were faded.
        """
        if gap_days <= 0:
            return []
        import math
        factor = self._FADE_RATE ** (gap_days / 30.0)
        faded: list[str] = []
        for nid, node in self.nodes.items():
            if node.confidence > 0.15:
                new_conf = max(0.15, round(node.confidence * factor, 4))
                if new_conf < node.confidence:
                    node.confidence = new_conf
                    faded.append(nid)
        return faded

    # ── Forgiveness mechanics ─────────────────────────────────────────────────

    def apply_forgiveness(
        self,
        forgiver_role: str,
        target_role:   str,
        event_text:    str,
        partial:       bool = False,
    ) -> dict:
        """Model a forgiveness act in the belief graph.

        Forgiveness is NOT the same as reconciliation or trust restoration.
        It is a *unilateral internal shift* in the forgiver's belief about the
        event and the relationship.  This method:

        1. Searches for beliefs with negative valence that reference `event_text`
           or the `target_role` (e.g., "they betrayed me", "they don't care").
        2. Partially reduces their valence (partial forgiveness) or marks them
           with a `forgiven=True` tag in the node metadata.
        3. Adds a new positive-valence belief node representing the forgiveness
           act ("I have chosen to let go of [event]").
        4. If `partial=False`, removes any `target_role` from `no_go_zones`
           in the alliance edge (handled by caller — this method is graph-only).

        Returns a summary dict with nodes affected and the new forgiveness node id.
        """
        affected: list[str] = []
        event_lower = event_text.lower()
        target_lower = target_role.lower()

        for nid, node in self.nodes.items():
            if node.valence < 0:
                if event_lower in node.text.lower() or target_lower in node.text.lower():
                    if partial:
                        # Soften: shift valence toward 0 by 1
                        node.valence = min(0, node.valence + 1)
                        node.confidence = max(0.10, node.confidence * 0.80)
                    else:
                        # Full forgiveness: mark as resolved
                        node.valence = 0
                        node.confidence = max(0.10, node.confidence * 0.60)
                    affected.append(nid)

        # Add a new forgiveness node
        forgiveness_text = (
            f"I have chosen to let go of what happened with {target_role}."
            if not partial else
            f"I am working toward forgiving {target_role} for {event_text}."
        )
        new_id = self.add_or_update({
            "text":       forgiveness_text,
            "confidence": 0.50 if partial else 0.70,
            "valence":    1,
            "identity_linked": False,
            "speaker_role": forgiver_role,
        })

        return {"affected_nodes": affected, "forgiveness_node_id": new_id}

    # ── BG3: Salience & Risk classification ──────────────────────────────────

    def risk_tier(self, node_id: str) -> str:
        """BG3: Classify a belief node into a risk tier.

        identity_core  — identity_linked=True (highest rupture risk)
        foundational   — in_degree ≥ 2 (many things depend on this)
        peripheral     — in_degree 0–1 AND not identity_core (safe to explore)
        actionable     — out_degree=0 AND not identity_core (direct target)
        """
        node = self.nodes.get(node_id)
        if not node:
            return "peripheral"
        if node.identity_linked:
            return "identity_core"
        ind = self.in_degree(node_id)
        outd = self.out_degree(node_id)
        if ind >= 2:
            return "foundational"
        if outd == 0:
            return "actionable"
        return "peripheral"

    def safe_targets(self) -> list[BeliefNode]:
        """BG3: Return nodes that are safe for the companion to explore or challenge."""
        return [
            n for nid, n in self.nodes.items()
            if self.risk_tier(nid) in ("peripheral", "actionable")
        ]

    def risky_targets(self) -> list[BeliefNode]:
        """BG3: Return nodes the companion should treat with extreme care."""
        return [
            n for nid, n in self.nodes.items()
            if self.risk_tier(nid) in ("identity_core", "foundational")
        ]

    def cascade_impact(self, node_id: str, depth: int = 3) -> float:
        """BG3: Estimate the cumulative influence if belief `node_id` shifts.

        Propagates influence through successors up to `depth` hops, weighted
        by edge strength and node confidence.  Returns a scalar [0, 1].
        """
        visited: set[str] = set()
        total_impact = 0.0

        def _traverse(nid: str, remaining: int, weight: float) -> None:
            nonlocal total_impact
            if remaining <= 0 or nid in visited:
                return
            visited.add(nid)
            node = self.nodes.get(nid)
            if not node:
                return
            total_impact += weight * node.confidence
            for e in self.edges:
                if e.from_id == nid:
                    _traverse(e.to_id, remaining - 1, weight * e.strength)

        _traverse(node_id, depth, 1.0)
        return round(min(1.0, total_impact), 4)

    def belief_shift_signal(
        self,
        node_id: str,
        confidence_delta: float,
    ) -> dict[str, float]:
        """BG3: When a belief's confidence changes, return the influence signal
        to adjacent beliefs (used by AllianceGraph.coupling_signal_for_belief_update).

        Returns: {node_id: influence_weight} for all direct successors.
        """
        node = self.nodes.get(node_id)
        if not node:
            return {}
        return {
            e.to_id: round(confidence_delta * e.strength, 4)
            for e in self.edges
            if e.from_id == node_id
        }

    # ── Companion hint generation ─────────────────────────────────────────────

    def prompt_context(
        self,
        max_nodes:      int          = 5,
        current_topic:  str          = "",
        current_action: str          = "",
        stress_index:   float        = 0.5,
        coupling_boosts: dict[str, float] | None = None,
    ) -> str:
        """Generate a belief-aware hint for the companion system prompt.

        Context-aware selection rules (BG4/BG5):

        1. Topic affinity  — if ``current_topic`` is given, beliefs whose
           ``text`` overlaps the topic are ranked higher.

        2. Action-based tier gate  — some actions should only see certain
           belief tiers:
             * reframe / challenge_belief / cognitive_restructuring
                  -> show safe (peripheral/actionable) targets FIRST
             * empathic_reflection / hold_space / normalise_discrepancy
                  -> show identity_core and foundational (what NOT to touch)
             * All others -> balanced view

        3. Stress gate  — at high stress (>0.70) only show the "do-not-touch"
           warnings; omit safe targets (there's no room to explore under crisis).

        4. Contradiction hint  — surfaces any pair of beliefs with an edge
           where ``src.valence * tgt.valence < 0`` (opposing polarity),
           flagging the pair as an internal contradiction for the companion.

        5. coupling_boosts (BG5-COUPLING): dict mapping participant role to a
           [0,1] relevance boost derived from ``coupling_tensor``.  Safe-target
           ranking multiplies each node's base score by
           ``(1 + boost_for_speaker_role)`` so beliefs stated by a
           high-coupling participant (e.g., enmeshed spouse) surface first.
           Caller provides this via AllianceGraph.coupling_weighted_belief_boost().

        6. target_belief_id (BG5/LS2)  — appended as metadata in square
           brackets so the generation layer (Scout) can reference a specific
           belief node in its response, moving beyond generic advice.
        """
        if not self.nodes:
            return ""

        # ── helpers ──────────────────────────────────────────────────────────
        _CHALLENGE_ACTIONS = {
            "reframe", "challenge_belief", "cognitive_restructuring",
            "loss_frame", "probability_reframe", "prescribe_symptom",
            "reverse_validate", "normalise_discrepancy",
        }
        _SAFE_ONLY_ACTIONS = _CHALLENGE_ACTIONS
        _RISKY_FIRST_ACTIONS = {
            "empathic_reflection", "hold_space", "therapeutic_silence",
            "normalise_discrepancy", "seek_probe_consent",
        }

        def _topic_score(node: BeliefNode, topic: str) -> float:
            if not topic:
                return 0.0
            tl = topic.lower()
            return 1.0 if tl in node.text.lower() else 0.0

        def _coupling_boost(node: BeliefNode) -> float:
            if not coupling_boosts:
                return 0.0
            role = getattr(node, "speaker_role", "patient") or "patient"
            return coupling_boosts.get(role, 0.0)

        # ── classify ─────────────────────────────────────────────────────────
        identity     = [n for n in self.risky_targets() if self.risk_tier(n.id) == "identity_core"]
        foundational = [n for n in self.risky_targets() if self.risk_tier(n.id) == "foundational"]
        all_safe     = self.safe_targets()
        pending_cond = self.pending_conditionals()
        low_prov     = self.low_provenance_beliefs()
        low_prov_ids = {n.id for n in low_prov}

        # ── apply action / stress gate on safe targets ────────────────────────
        if stress_index > 0.70:
            # Under crisis: only show warnings, no safe targets
            safe = []
        elif current_action in _RISKY_FIRST_ACTIONS and current_action not in _CHALLENGE_ACTIONS:
            # Empathy actions: safe targets are less relevant; trim to 1
            safe = sorted(all_safe, key=lambda n: (
                -_topic_score(n, current_topic),
                -_coupling_boost(n),
                -n.confidence,
            ))[:1]
        else:
            # Default / challenge actions: topic-weighted sort, up to max_nodes
            safe = sorted(all_safe, key=lambda n: (
                -_topic_score(n, current_topic),
                -_coupling_boost(n),
                -n.confidence,
            ))[:max_nodes]

        # ── find target_belief_id (BG5/LS2) ──────────────────────────────────
        target_belief_id: str | None = None
        if safe and current_action in _CHALLENGE_ACTIONS:
            best = max(safe, key=lambda n: (
                _topic_score(n, current_topic)
                + _coupling_boost(n),
                n.confidence,
            ))
            target_belief_id = best.id

        # ── detect internal contradictions (BG4) ─────────────────────────────
        # Pairs where an edge links two nodes with opposing valence
        contradictions: list[tuple[BeliefNode, BeliefNode]] = []
        for edge in self.edges:
            src = self.nodes.get(edge.from_id)
            tgt = self.nodes.get(edge.to_id)
            if src and tgt and src.valence != 0 and tgt.valence != 0:
                if src.valence * tgt.valence < 0:   # opposing polarity
                    contradictions.append((src, tgt))

        # ── build output ─────────────────────────────────────────────────────
        lines: list[str] = ["[Belief Graph]"]

        if identity:
            lines.append(
                "Identity-core beliefs (do NOT directly challenge — work around or normalise):"
            )
            for n in identity[:3]:
                prov = " [LOW-PROV]" if n.id in low_prov_ids else ""
                lines.append(f'  \u2022 "{n.text}" (conf={n.confidence:.2f}){prov}')

        if foundational:
            lines.append(
                "Foundational beliefs (many downstream dependencies — approach with care):"
            )
            for n in foundational[:3]:
                prov = " [LOW-PROV]" if n.id in low_prov_ids else ""
                lines.append(
                    f'  \u2022 "{n.text}" (conf={n.confidence:.2f}, '
                    f"in_degree={self.in_degree(n.id)}){prov}"
                )

        if safe:
            label = (
                f"Safe targets for this session — topic: {current_topic}"
                if current_topic else
                "Safe targets for this session (peripheral / actionable)"
            )
            lines.append(label + ":")
            for n in safe:
                tier = self.risk_tier(n.id)
                prov = " [LOW-PROV]" if n.id in low_prov_ids else ""
                target_marker = " [TARGET]" if n.id == target_belief_id else ""
                lines.append(
                    f'  \u2022 [{tier}] "{n.text}" '
                    f"(conf={n.confidence:.2f}, valence={n.valence:+d})"
                    f"{prov}{target_marker}"
                )

        if pending_cond:
            lines.append(
                "Conditional beliefs (unresolved — do not treat as established fact):"
            )
            for ce in pending_cond[:3]:
                contingent = self.nodes.get(ce.from_id)
                if contingent:
                    lines.append(
                        f'  \u2022 "{contingent.text}" depends on: {ce.condition_text} '
                        f"(if true: {ce.if_true_delta:+.2f}, if false: {ce.if_false_delta:+.2f}). "
                        f"Help patient explore the condition before acting on this belief."
                    )

        if low_prov:
            uniq = {n.id for n in low_prov}
            if uniq:
                lines.append(
                    f"Low-provenance beliefs ({len(uniq)} extracted under high stress or low "
                    f"credibility) — re-confirm before treating as foundational."
                )

        if contradictions:
            lines.append("Internal contradictions detected (patient holds opposing beliefs):")
            for src, tgt in contradictions[:2]:
                lines.append(
                    f'  \u2022 "{src.text}" [val={src.valence:+d}] '
                    f'<-> "{tgt.text}" [val={tgt.valence:+d}] — '
                    f"explore discrepancy gently (normalise_discrepancy or seek_probe_consent)."
                )

        # BG5/LS2: tell Scout which belief to address in this turn
        if target_belief_id:
            lines.append(f"[target_belief_id: {target_belief_id}]")

        return "\n".join(lines)

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "subject_id":        self.subject_id,
            "nodes":             [n.to_dict() for n in self.nodes.values()],
            "edges":             [e.to_dict() for e in self.edges],
            "conditional_edges": [ce.to_dict() for ce in self.conditional_edges],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BeliefGraph":
        g = cls(subject_id=d.get("subject_id", "unknown"))
        for nd in d.get("nodes", []):
            g.nodes[nd["id"]] = BeliefNode.from_dict(nd)
        for ed in d.get("edges", []):
            g.edges.append(BeliefEdge.from_dict(ed))
        for ced in d.get("conditional_edges", []):
            g.conditional_edges.append(ConditionalEdge.from_dict(ced))
        return g

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _find_similar(self, text: str) -> str:
        """Return an existing node id if text is sufficiently similar, else ''."""
        twords = set(text.lower().split())
        best_id, best_score = "", 0.0
        for nid, node in self.nodes.items():
            nwords = set(node.text.lower().split())
            if not nwords:
                continue
            overlap = len(twords & nwords) / max(len(twords | nwords), 1)
            if overlap > best_score and overlap >= 0.70:
                best_id, best_score = nid, overlap
        return best_id

    def __repr__(self) -> str:
        return (
            f"BeliefGraph(subject={self.subject_id!r}, "
            f"nodes={len(self.nodes)}, edges={len(self.edges)})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# BG2: Belief discovery pipeline
# ─────────────────────────────────────────────────────────────────────────────

def extract_beliefs_from_turn(
    text: str,
    role: str = "patient",
    arm: str = "belief_graph",
    timeout: float = 12.0,
) -> list[dict]:
    """BG2: Call Scout to extract beliefs from a single conversation turn.

    Returns a list of belief dicts (as defined in _DISCOVERY_PROMPT), ready
    for BeliefGraph.add_or_update().  Returns [] on any error.
    """
    try:
        from tensornets.a3c import node_client as _nc  # lazy import
    except ImportError:
        return []

    prompt = _DISCOVERY_PROMPT.format(role=role, text=text[:1500])
    try:
        resp = _nc.llm_call(
            system=_DISCOVERY_SYSTEM,
            prompt=prompt,
            arm=arm,
            timeout=timeout,
            max_tokens=512,
        )
    except Exception:
        return []

    raw = (resp or "").strip()
    # Extract JSON array from the response
    start = raw.find("[")
    end   = raw.rfind("]") + 1
    if start < 0 or end <= start:
        return []
    try:
        beliefs = json.loads(raw[start:end])
        if not isinstance(beliefs, list):
            return []
        return beliefs
    except json.JSONDecodeError:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Persistence helpers
# ─────────────────────────────────────────────────────────────────────────────

_STATE_DIR = Path("state") / "subjects"


def _belief_path(subject_id: str) -> Path:
    return _STATE_DIR / subject_id / "belief_graph.json"


def load_belief_graph(subject_id: str) -> BeliefGraph:
    """Load a BeliefGraph from disk.  Returns an empty graph if file not found."""
    path = _belief_path(subject_id)
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as fh:
                return BeliefGraph.from_dict(json.load(fh))
        except Exception:
            pass
    return BeliefGraph(subject_id=subject_id)


def save_belief_graph(graph: BeliefGraph) -> None:
    """Persist a BeliefGraph to disk."""
    path = _belief_path(graph.subject_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(graph.to_dict(), fh, indent=2)
