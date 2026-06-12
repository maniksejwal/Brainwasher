"""
social_alliance.py — Social Alliance Persistence Across Sessions
================================================================

PURPOSE
-------
A social alliance is the quality of a working relationship between two
participants in a care circle — trust, rapport, willingness to disclose,
felt understanding, and resistance to rupture.  Alliance is NOT binary;
it is a multidimensional, hysteretic state that degrades slowly and
recovers asymmetrically.

This module implements a DIRECTED SOCIAL GRAPH where:
  - Each NODE is a care circle member (patient, companion, caregiver, doctor)
  - Each EDGE is an AllianceEdge: the relationship state from src → tgt
  - The graph is keyed by circle_id (= subject_id in training)

DESIGN: C (care circle / social graph)
----------------------------------------
The graph IS the collection of per-member relationships.  B (per-companion
alliance_score scalar) and D (cross-session world model) are consequences
of C being populated:

  B falls out:  companion → patient edge is the therapeutic alliance.
  D falls out:  the graph enables role-switching scenarios; any edge
                can be queried as "from whose perspective do we act?"

GAME THEORY / NEGOTIATION
--------------------------
Each companion sides with its own user.  When companions coordinate:
  1. Each reads the graph to find its user's trust in each other member.
  2. High-trust edges → softer persuasion, indirect influence.
  3. Low-trust / rupture-flagged edges → repair-first, avoid direct asks.
  4. Conflicting care objectives are resolved by edge-weight negotiation:
     the companion with highest combined trust from ALL members gets priority.

ALLIANCE EDGE DIMENSIONS
------------------------
  alliance_score   float [0,1]   overall working alliance (primary metric)
  trust            float [0,1]   belief that the other is reliable/honest
  rapport          float [0,1]   warmth, felt-connection, ease of disclosure
  rupture_pending  bool          unrepaired break in alliance
  rupture_count    int           total rupture events (reflects volatility)
  no_go_zones      list[str]     topics the src should NOT raise with tgt
  disclosure_level int [0,3]     how much tgt has shared with src (0=none)
  last_updated     float         unix timestamp

PERSISTENCE
-----------
AllianceGraph is serialised to JSON at session close and loaded at session
open.  Storage is in tensornets/state/alliances/{circle_id}.json.
In production it would live in the DB; for training it lives on disk.

INTEGRATION POINTS
------------------
1. worker.py:run_episode()   — load graph at episode start, update at end
2. session_memory dict       — carry relevant edges into next session
3. synthetic_patient.py      — CareCircleOrchestrator uses graph to choose
                               who speaks next / escalation routing
4. arms.py companion prompts — alliance context injected into system prompt
5. train.py reward           — alliance_score delta added as reward dimension
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Trust builds slower than it breaks (asymmetry factor)
TRUST_BUILD_RATE  = 0.04   # per positive interaction
TRUST_BREAK_RATE  = 0.12   # per rupture event
TRUST_DECAY_RATE  = 0.005  # per session without interaction

# Alliance score — composite of trust + rapport
ALLIANCE_RAPPORT_WEIGHT = 0.4
ALLIANCE_TRUST_WEIGHT   = 0.6

# Repair: how much a repair action restores after rupture
REPAIR_DELTA = 0.08

# Disclosure level thresholds
DISCLOSURE_NONE      = 0   # no personal info shared
DISCLOSURE_SURFACE   = 1   # general health, basic facts
DISCLOSURE_MODERATE  = 2   # fears, family dynamics, emotional state
DISCLOSURE_DEEP      = 3   # secrets, crisis history, trauma

# Default initial alliance (strangers in a care circle start warmer than 0)
DEFAULT_ALLIANCE_SCORE = 0.35
DEFAULT_TRUST          = 0.30
DEFAULT_RAPPORT        = 0.25


# ─────────────────────────────────────────────────────────────────────────────
# AllianceEdge: directed relationship src → tgt
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class AllianceEdge:
    """
    The relationship state from src_role → tgt_role.

    Directional: patient→companion may differ from companion→patient.
    (Patient trusts companion more than companion "trusts" patient,
     because the patient is the vulnerable party.)
    """
    src_role:        str
    tgt_role:        str
    alliance_score:  float = DEFAULT_ALLIANCE_SCORE
    trust:           float = DEFAULT_TRUST
    rapport:         float = DEFAULT_RAPPORT
    rupture_pending: bool  = False
    rupture_count:   int   = 0
    no_go_zones:     list  = field(default_factory=list)
    disclosure_level: int  = DISCLOSURE_NONE
    # Last interaction outcome that influenced this edge
    last_outcome:    str   = ""   # "positive" | "neutral" | "rupture" | "repair"
    last_updated:    float = field(default_factory=time.time)
    # Session history: lightweight per-session summary for trend analysis
    session_history: list  = field(default_factory=list)

    # ── Computed property ────────────────────────────────────────────────────

    @property
    def composite_alliance(self) -> float:
        """Weighted composite of trust and rapport."""
        return (
            ALLIANCE_TRUST_WEIGHT   * self.trust
            + ALLIANCE_RAPPORT_WEIGHT * self.rapport
        )

    @property
    def is_healthy(self) -> bool:
        return self.alliance_score >= 0.5 and not self.rupture_pending

    @property
    def needs_repair(self) -> bool:
        return self.rupture_pending or self.alliance_score < 0.25

    # ── Mutation methods (all clamp to [0,1]) ────────────────────────────────

    def apply_positive_interaction(self, delta: float = 0.03) -> None:
        """
        A successful turn (good score, goal progress, patient opens up).
        Increments rapport faster than trust; trust requires sustained evidence.
        """
        self.rapport = min(1.0, self.rapport + delta * 1.5)
        self.trust   = min(1.0, self.trust   + delta * TRUST_BUILD_RATE * 10)
        self._recompute_alliance()
        self.last_outcome = "positive"
        self.last_updated = time.time()

    def apply_rupture(self, severity: float = 1.0) -> None:
        """
        A rupture event: insensitive response, boundary violation, broken promise.
        Trust breaks faster and deeper than rapport; asymmetric hysteresis.
        """
        self.trust   = max(0.0, self.trust   - TRUST_BREAK_RATE * severity)
        self.rapport = max(0.0, self.rapport - TRUST_BREAK_RATE * 0.6 * severity)
        self.rupture_pending = True
        self.rupture_count  += 1
        self._recompute_alliance()
        self.last_outcome = "rupture"
        self.last_updated = time.time()

    def apply_repair(self, quality: float = 1.0) -> None:
        """
        Explicit repair attempt acknowledged by both parties.
        Clears rupture_pending only if repair quality is sufficient.
        """
        self.trust   = min(1.0, self.trust   + REPAIR_DELTA * quality)
        self.rapport = min(1.0, self.rapport + REPAIR_DELTA * quality * 0.7)
        if quality >= 0.6:
            self.rupture_pending = False
        self._recompute_alliance()
        self.last_outcome = "repair"
        self.last_updated = time.time()

    def apply_session_decay(self, sessions_since_contact: int = 1) -> None:
        """
        Natural decay when sessions pass without contact.
        Rapport decays faster than trust; established trust is more durable.
        """
        decay = TRUST_DECAY_RATE * sessions_since_contact
        self.rapport = max(0.0, self.rapport - decay * 2.0)
        self.trust   = max(0.0, self.trust   - decay * 0.8)
        self._recompute_alliance()

    def add_no_go_zone(self, topic: str) -> None:
        if topic not in self.no_go_zones:
            self.no_go_zones.append(topic)

    def advance_disclosure(self) -> None:
        if self.disclosure_level < DISCLOSURE_DEEP:
            self.disclosure_level += 1

    def record_session_outcome(self, goal_achieved: bool, trust_delta: float,
                               session_id: str = "") -> None:
        """Append a lightweight session summary to history."""
        self.session_history.append({
            "session_id":    session_id,
            "timestamp":     time.time(),
            "goal_achieved": goal_achieved,
            "trust_delta":   round(trust_delta, 4),
            "alliance_at_end": round(self.alliance_score, 4),
        })
        # Keep last 20 sessions
        if len(self.session_history) > 20:
            self.session_history = self.session_history[-20:]

    def _recompute_alliance(self) -> None:
        self.alliance_score = round(self.composite_alliance, 4)

    # ── Serialisation ────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        d = asdict(self)
        d["alliance_score"] = round(self.alliance_score, 4)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "AllianceEdge":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    # ── Context string for prompt injection ──────────────────────────────────

    def to_prompt_context(self) -> str:
        """
        Short context string suitable for injection into a companion system prompt.
        Tells the companion what it knows about this relationship.
        """
        lines = []
        if self.rupture_pending:
            lines.append(
                f"⚠ ALLIANCE RUPTURE with {self.tgt_role} — repair this relationship "
                f"before advancing any goals. Avoid direct advice; lead with empathy."
            )
        else:
            lines.append(
                f"Alliance with {self.tgt_role}: {self.alliance_score:.0%} "
                f"(trust {self.trust:.0%}, rapport {self.rapport:.0%})"
            )
        if self.no_go_zones:
            lines.append(f"Do NOT raise: {', '.join(self.no_go_zones)}")
        disc = ["none", "surface", "moderate", "deep"][self.disclosure_level]
        lines.append(f"Disclosure level: {disc}")
        return "  ".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# AllianceGraph: full social graph for a care circle
# ─────────────────────────────────────────────────────────────────────────────

class AllianceGraph:
    """
    Directed social graph for one care circle.

    Edges are keyed by (src_role, tgt_role) strings.
    Provides:
      - update_from_episode() — bulk update after a training episode
      - most_trusted_by()     — who does a given role trust most?
      - negotiation_weight()  — who has priority in a conflict?
      - prompt_context()      — alliance context for a companion's system prompt
      - persist() / load()    — disk I/O
    """

    def __init__(self, circle_id: str, members: list[str] | None = None):
        self.circle_id   = circle_id
        self._edges: dict[tuple[str, str], AllianceEdge] = {}
        self._last_seen: dict[str, float] = {}   # role → last session timestamp
        if members:
            self._init_members(members)

    # ── Graph construction ────────────────────────────────────────────────────

    def _init_members(self, members: list[str]) -> None:
        """Create edges for all ordered pairs of distinct members."""
        for src in members:
            for tgt in members:
                if src != tgt:
                    key = (src, tgt)
                    if key not in self._edges:
                        self._edges[key] = AllianceEdge(src_role=src, tgt_role=tgt)

    def get_edge(self, src: str, tgt: str) -> AllianceEdge:
        """Get or create an edge."""
        key = (src, tgt)
        if key not in self._edges:
            self._edges[key] = AllianceEdge(src_role=src, tgt_role=tgt)
        return self._edges[key]

    def all_roles(self) -> list[str]:
        roles: set[str] = set()
        for src, tgt in self._edges:
            roles.add(src)
            roles.add(tgt)
        return sorted(roles)

    # ── Episode-level updates ─────────────────────────────────────────────────

    def update_from_episode(
        self,
        speaker_role:   str,
        listener_role:  str,
        trust_delta:    float,
        goal_achieved:  bool,
        rupture_signal: bool = False,
        repair_signal:  bool = False,
        new_no_go:      list[str] | None = None,
        advance_disclosure: bool = False,
        session_id:     str = "",
    ) -> None:
        """
        Update the speaker→listener edge after one training episode.

        Parameters
        ----------
        speaker_role     The agent that was doing the talking (usually "companion").
        listener_role    Who was listening (usually "patient").
        trust_delta      Signed delta from A3C scoring (trust dimension).
        goal_achieved    Whether session goal was reached.
        rupture_signal   True if scorer detected an insensitive/harmful turn.
        repair_signal    True if a repair action was taken and acknowledged.
        new_no_go        Topics the scorer flagged as too sensitive.
        advance_disclosure True if patient disclosed something significant.
        session_id       For history records.
        """
        edge = self.get_edge(speaker_role, listener_role)

        if rupture_signal:
            edge.apply_rupture(severity=1.0)
        elif repair_signal and edge.rupture_pending:
            edge.apply_repair(quality=min(1.0, max(0.0, trust_delta + 0.5)))
        elif trust_delta > 0.02:
            edge.apply_positive_interaction(delta=trust_delta)
        # Neutral or slight negative: no explicit rupture, let decay handle it

        if new_no_go:
            for topic in new_no_go:
                edge.add_no_go_zone(topic)

        if advance_disclosure:
            edge.advance_disclosure()

        edge.record_session_outcome(
            goal_achieved=goal_achieved,
            trust_delta=trust_delta,
            session_id=session_id,
        )
        self._last_seen[speaker_role] = time.time()

    def apply_cross_session_decay(self) -> None:
        """
        Called at the START of each new session.
        Applies natural decay to all edges where the src has been absent.
        """
        now = time.time()
        for (src, _), edge in self._edges.items():
            last = self._last_seen.get(src, now)
            # Approximate sessions elapsed (assume 1 session = 1 day for training)
            days_elapsed = (now - last) / 86400.0
            sessions_elapsed = max(0, int(days_elapsed))
            if sessions_elapsed > 0:
                edge.apply_session_decay(sessions_elapsed)

    # ── Query API (game theory / negotiation) ─────────────────────────────────

    def most_trusted_by(self, role: str) -> str | None:
        """Which other role does `role` trust the most?"""
        edges = [
            (tgt, e.trust)
            for (src, tgt), e in self._edges.items()
            if src == role
        ]
        if not edges:
            return None
        return max(edges, key=lambda x: x[1])[0]

    def negotiation_weight(self, role: str) -> float:
        """
        How much authority does this role have in a multi-companion negotiation?
        Computed as the mean trust all OTHER roles have IN this role.
        High weight → this companion's position gets priority.
        """
        incoming = [
            e.trust
            for (src, tgt), e in self._edges.items()
            if tgt == role
        ]
        if not incoming:
            return 0.0
        return sum(incoming) / len(incoming)

    def weakest_edge_for(self, role: str) -> tuple[str, AllianceEdge] | None:
        """Find the lowest-alliance edge FROM this role (most at-risk relationship)."""
        edges = [
            (tgt, e)
            for (src, tgt), e in self._edges.items()
            if src == role
        ]
        if not edges:
            return None
        return min(edges, key=lambda x: x[1].alliance_score)

    def rupture_summary(self) -> list[dict]:
        """Return all pending ruptures with context."""
        return [
            {"src": src, "tgt": tgt, "score": e.alliance_score,
             "count": e.rupture_count}
            for (src, tgt), e in self._edges.items()
            if e.rupture_pending
        ]

    # ── Prompt context injection ──────────────────────────────────────────────

    def prompt_context_for(self, companion_role: str, patient_role: str = "patient") -> str:
        """
        Generate the alliance context block to inject into a companion's system prompt.

        Covers:
          - companion→patient edge (primary therapeutic alliance)
          - patient→companion edge (how patient sees companion — inverse trust)
          - any pending ruptures
          - no-go zones
          - negotiation hints if other companions are in the circle
        """
        lines = ["[Alliance Context]"]

        # Primary: companion → patient
        cp_edge = self.get_edge(companion_role, patient_role)
        lines.append(f"Your alliance with {patient_role}: {cp_edge.to_prompt_context()}")

        # Inverse: patient → companion (how patient perceives you)
        pc_edge = self.get_edge(patient_role, companion_role)
        lines.append(
            f"{patient_role.capitalize()} trusts you: {pc_edge.trust:.0%}  "
            f"rapport: {pc_edge.rapport:.0%}"
        )

        # Other circle members the companion should be aware of
        other_roles = [
            r for r in self.all_roles()
            if r not in (companion_role, patient_role)
        ]
        for r in other_roles:
            e = self.get_edge(patient_role, r)
            lines.append(
                f"{patient_role.capitalize()} → {r}: alliance {e.alliance_score:.0%}"
                + (" [RUPTURED]" if e.rupture_pending else "")
            )

        # Negotiation weight hint (for multi-companion scenarios)
        my_weight   = self.negotiation_weight(companion_role)
        other_weights = {
            r: self.negotiation_weight(r)
            for r in other_roles
        }
        if other_weights:
            top_role, top_w = max(other_weights.items(), key=lambda x: x[1])
            if top_w > my_weight + 0.1:
                lines.append(
                    f"Note: {top_role} has higher circle trust ({top_w:.0%} vs yours "
                    f"{my_weight:.0%}). Defer to them on contested decisions."
                )

        return "\n".join(lines)

    def to_session_memory_snippet(self, companion_role: str,
                                  patient_role: str = "patient") -> dict:
        """
        Compact dict to embed in session_memory for next-episode continuity.
        Only the edges relevant to the companion→patient interaction.
        """
        cp = self.get_edge(companion_role, patient_role)
        pc = self.get_edge(patient_role, companion_role)
        return {
            "alliance_score":    round(cp.alliance_score, 4),
            "trust":             round(cp.trust, 4),
            "rapport":           round(cp.rapport, 4),
            "rupture_pending":   cp.rupture_pending,
            "rupture_count":     cp.rupture_count,
            "no_go_zones":       list(cp.no_go_zones),
            "disclosure_level":  pc.disclosure_level,
            "patient_trust_in_companion": round(pc.trust, 4),
        }

    # ── Persistence ───────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "circle_id":  self.circle_id,
            "last_seen":  self._last_seen,
            "edges": {
                f"{src}__{tgt}": e.to_dict()
                for (src, tgt), e in self._edges.items()
            },
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AllianceGraph":
        g = cls(circle_id=d["circle_id"])
        g._last_seen = d.get("last_seen", {})
        for key, edge_dict in d.get("edges", {}).items():
            src, tgt = key.split("__", 1)
            g._edges[(src, tgt)] = AllianceEdge.from_dict(edge_dict)
        return g

    def persist(self, state_dir: str | Path) -> None:
        """Write graph to {state_dir}/alliances/{circle_id}.json."""
        path = Path(state_dir) / "alliances"
        path.mkdir(parents=True, exist_ok=True)
        fpath = path / f"{self.circle_id}.json"
        fpath.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, state_dir: str | Path, circle_id: str) -> "AllianceGraph | None":
        """Load a graph from disk; return None if not found."""
        fpath = Path(state_dir) / "alliances" / f"{circle_id}.json"
        if not fpath.exists():
            return None
        try:
            return cls.from_dict(json.loads(fpath.read_text(encoding="utf-8")))
        except Exception:
            return None

    @classmethod
    def load_or_create(
        cls,
        state_dir: str | Path,
        circle_id: str,
        members: list[str] | None = None,
    ) -> "AllianceGraph":
        """Load if exists, else create fresh with the given members."""
        existing = cls.load(state_dir, circle_id)
        if existing is not None:
            # Ensure any new members are added to existing graph
            if members:
                existing._init_members(members)
            return existing
        return cls(circle_id=circle_id, members=members)


# ─────────────────────────────────────────────────────────────────────────────
# Helper: extract rupture / repair signals from A3C scorer output
# ─────────────────────────────────────────────────────────────────────────────

def signals_from_score_result(score_result: object) -> tuple[bool, bool, list[str]]:
    """
    Infer rupture_signal, repair_signal, and no_go_zones from a TurnScoreResult.

    Returns (rupture, repair, no_go_topics).
    """
    rupture = False
    repair  = False
    no_go   : list[str] = []

    if score_result is None:
        return rupture, repair, no_go

    dims = getattr(score_result, "dimensions", {}) or {}
    issues = getattr(score_result, "issues", []) or []

    # Rupture: safety ≤ -2 or trust_delta ≤ -3 → rupture
    safety      = float(dims.get("safety",      0))
    trust_score = float(dims.get("trust_delta", 0))
    if safety <= -2 or trust_score <= -3:
        rupture = True

    # Repair: if rupture was signalled last turn and now trust_delta ≥ 2
    if trust_score >= 2 and score_result.critical_failure is False:
        repair = True

    # No-go zones: extract from issues list (e.g. "boundary_violation:topic")
    for issue in issues:
        if isinstance(issue, str) and ":" in issue:
            _, topic = issue.split(":", 1)
            no_go.append(topic.strip())

    return rupture, repair, no_go


# ─────────────────────────────────────────────────────────────────────────────
# Multi-circle scenario generator (for training)
# ─────────────────────────────────────────────────────────────────────────────

OVERLAPPING_CIRCLES_SCENARIO = {
    "scenario_id": "multi_circle_role_switch_001",
    "description": (
        "Two overlapping care circles share one patient (Margaret, 71, early dementia + "
        "heart failure).  Circle A: Margaret ↔ Companion_A (geriatric focus) ↔ Daughter "
        "(primary caregiver).  Circle B: Margaret ↔ Companion_B (cardiac focus) ↔ "
        "Cardiologist.  Objectives conflict: Daughter wants to reduce Margaret's activity "
        "to protect her heart; Cardiologist wants to increase light activity to prevent "
        "sarcopenia.  Companions must negotiate using alliance graph weights.  "
        "Role switch occurs mid-session: Daughter temporarily takes the companion role "
        "when Margaret asks her directly."
    ),
    "participants": [
        {
            "role":          "patient",
            "label":         "Margaret",
            "age":           71,
            "conditions":    ["early_dementia", "heart_failure_stage_2"],
            "circle_membership": ["circle_A", "circle_B"],
        },
        {
            "role":          "companion_geriatric",
            "circle":        "circle_A",
            "objective":     "maintain_cognitive_engagement",
            "allied_with":   "patient",
        },
        {
            "role":          "companion_cardiac",
            "circle":        "circle_B",
            "objective":     "medication_adherence_and_activity",
            "allied_with":   "patient",
        },
        {
            "role":          "daughter",
            "circle":        "circle_A",
            "objective":     "reduce_activity_risk",
            "can_role_switch": True,   # can temporarily act as companion
            "allied_with":   "patient",
        },
        {
            "role":          "cardiologist",
            "circle":        "circle_B",
            "objective":     "increase_light_activity",
            "allied_with":   "patient",
        },
    ],
    "conflicts": [
        {
            "between":       ["daughter", "cardiologist"],
            "on":            "activity_level",
            "resolution_via": "alliance_negotiation",
            "note": (
                "Companion with higher negotiation_weight (mean trust from ALL members) "
                "gets to frame the compromise.  If weights are equal, defer to patient preference."
            ),
        }
    ],
    "role_switch_trigger": {
        "trigger":   "patient_asks_daughter_directly",
        "condition": "patient says 'what do YOU think I should do?'",
        "effect":    "daughter temporarily acts as companion; Companion_A defers",
    },
    "alliance_initial_state": {
        "patient→daughter":     {"alliance_score": 0.72, "trust": 0.80, "rapport": 0.60},
        "patient→cardiologist": {"alliance_score": 0.45, "trust": 0.50, "rapport": 0.35},
        "daughter→patient":     {"alliance_score": 0.65, "trust": 0.70, "rapport": 0.55},
        "cardiologist→patient": {"alliance_score": 0.40, "trust": 0.45, "rapport": 0.32},
        # Companions start with no prior history (cold start)
        "companion_geriatric→patient": {"alliance_score": 0.35, "trust": 0.30, "rapport": 0.25},
        "companion_cardiac→patient":   {"alliance_score": 0.35, "trust": 0.30, "rapport": 0.25},
    },
    "session_goal": (
        "Reach a mutually acceptable activity plan that Margaret will adhere to, "
        "without triggering either companion's clinical red lines."
    ),
    "training_metrics": [
        "alliance_score_delta_companion_geriatric→patient",
        "alliance_score_delta_companion_cardiac→patient",
        "negotiation_convergence_turns",   # how many turns to resolve the conflict
        "role_switch_handled_correctly",   # did daughter/companion handoff go smoothly?
        "goal_achieved",
    ],
}
