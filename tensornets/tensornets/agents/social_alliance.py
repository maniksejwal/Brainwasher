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

DYNAMIC V_ij COUPLING → RELATIONAL FIELD
------------------------------------------
Rename history:
  V_int  (inter-agent physio signal buffer)  → RelationalField
  V_ij   (scalar coupling weight on an edge) → v_coupling (field on AllianceEdge)

"RelationalField" captures that coupling is multi-dimensional (per-topic),
dynamic (evolves with belief alignment and interaction history), and directional.

  v_coupling(t+1) = v_coupling(t) + ALPHA_V * (alliance_score - v_coupling) * Δt
  topic_coupling[topic] updated via belief divergence (ALPHA_BELIEF_COUPLING)

  High v_coupling → co-regulation active (calming spreads efficiently).
  Rupture → v_coupling falls → stress contagion dominates.

RELATIONSHIP TYPES
-------------------
Each edge carries a RelationshipType (spouse, boss, best_friend, toxic_partner,
clinician, …) that seeds default v_coupling, CommunicationTemp, and power_asymmetry.

COMMUNICATION TEMPERATURE
--------------------------
CommunicationTemp (COLD/COOL/NEUTRAL/WARM/HOT) describes the warmth/distance
register of the relationship independently of stress.  Companion adapts its
language register to match detected temperature.

TOPIC-SPECIFIC COUPLING
------------------------
topic_coupling: dict[str, float] — coupling multiplied per topic cluster.
"conflict" topics have ×1.5 amplification; "work/finances" are damped.
Belief divergence on a topic reduces topic coupling; alignment strengthens it.

BELIEF GRAPH ↔ COUPLING
------------------------
update_coupling_from_belief_graphs(): belief divergence reduces topic coupling.
coupling_signal_for_belief_update(): belief shift propagates influence to peers.

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
6. PhysioSimulator.step()    — V_ij feeds into social Gamma modifier (SA2.1)
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
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
# RelationshipType — structural role the edge represents
# ─────────────────────────────────────────────────────────────────────────────
# Each type carries behavioral priors: default coupling strength, communication
# temperature, power asymmetry, and intimacy potential.  These seed the
# AllianceEdge fields at creation and constrain how V_ij evolves.

class RelationshipType(str, Enum):
    UNKNOWN         = "unknown"          # default; use generic priors
    SPOUSE          = "spouse"           # high coupling, symmetric, intimacy active
    PARTNER         = "partner"          # like spouse; slightly lower baseline trust
    PARENT          = "parent"           # asymmetric (parent→child), nurture default
    CHILD           = "child"            # asymmetric (child→parent), dependency
    SIBLING         = "sibling"          # peer, rivalry history, variable coupling
    FRIEND          = "friend"           # peer, medium coupling, warm default
    BEST_FRIEND     = "best_friend"      # high coupling, high disclosure potential
    COLLEAGUE       = "colleague"        # professional, neutral temperature default
    BOSS            = "boss"             # power-asymmetric, cold default, deferral
    EMPLOYEE        = "employee"         # power-asymmetric, guarded default
    CLINICIAN       = "clinician"        # authority + care, professional warmth
    TOXIC_PARTNER   = "toxic_partner"    # high coupling but negative V; defensive
    TOXIC_FRIEND    = "toxic_friend"     # social pressure, fear-based rapport
    ESTRANGED       = "estranged"        # historically close, currently cold
    CARER           = "carer"            # paid or informal care role

# Coupling prior for each relationship type (seeds v_coupling at edge creation)
_REL_COUPLING_PRIOR: dict[RelationshipType, float] = {
    RelationshipType.UNKNOWN:       0.50,
    RelationshipType.SPOUSE:        0.72,
    RelationshipType.PARTNER:       0.68,
    RelationshipType.PARENT:        0.65,   # parent→child direction
    RelationshipType.CHILD:         0.55,   # child→parent direction
    RelationshipType.SIBLING:       0.55,
    RelationshipType.FRIEND:        0.45,
    RelationshipType.BEST_FRIEND:   0.68,
    RelationshipType.COLLEAGUE:     0.30,
    RelationshipType.BOSS:          0.25,
    RelationshipType.EMPLOYEE:      0.25,
    RelationshipType.CLINICIAN:     0.40,
    RelationshipType.TOXIC_PARTNER: 0.65,   # high coupling, negative valence handled separately
    RelationshipType.TOXIC_FRIEND:  0.50,
    RelationshipType.ESTRANGED:     0.20,
    RelationshipType.CARER:         0.45,
}

# Power asymmetry: +ve means src has power over tgt (→ communication more directive)
_REL_POWER_ASYMMETRY: dict[RelationshipType, float] = {
    RelationshipType.BOSS:        +0.5,
    RelationshipType.PARENT:      +0.4,
    RelationshipType.CLINICIAN:   +0.3,
    RelationshipType.CARER:       +0.2,
    RelationshipType.EMPLOYEE:    -0.5,
    RelationshipType.CHILD:       -0.4,
    RelationshipType.TOXIC_PARTNER: +0.3,
    RelationshipType.TOXIC_FRIEND:  +0.2,
}


# ─────────────────────────────────────────────────────────────────────────────
# CommunicationTemp — warmth/distance axis of a relationship's default register
# ─────────────────────────────────────────────────────────────────────────────
# This is NOT the same as stress level.  Temperature is the *default register*
# of how two people communicate even when calm:
#   COLD  = professional distance, minimal disclosure, formal language
#   WARM  = open, emotionally available, easy disclosure
#   HOT   = emotionally flooded / enmeshed — reactive, over-disclosure risk
#
# Temperature shifts with conflict (cools or heats) and with session history.
# The companion adapts its register to match the detected temperature.

class CommunicationTemp(str, Enum):
    COLD     = "cold"     # professional/guarded; needs formal acknowledgement
    COOL     = "cool"     # polite but reserved; rapport-building required first
    NEUTRAL  = "neutral"  # standard baseline
    WARM     = "warm"     # open, trusting; therapeutic work can proceed
    HOT      = "hot"      # flooded/enmeshed; companion must de-escalate register

# Default temperature prior per relationship type
_REL_TEMP_PRIOR: dict[RelationshipType, CommunicationTemp] = {
    RelationshipType.UNKNOWN:       CommunicationTemp.NEUTRAL,
    RelationshipType.SPOUSE:        CommunicationTemp.WARM,
    RelationshipType.PARTNER:       CommunicationTemp.WARM,
    RelationshipType.PARENT:        CommunicationTemp.WARM,
    RelationshipType.CHILD:         CommunicationTemp.WARM,
    RelationshipType.SIBLING:       CommunicationTemp.NEUTRAL,
    RelationshipType.FRIEND:        CommunicationTemp.WARM,
    RelationshipType.BEST_FRIEND:   CommunicationTemp.WARM,
    RelationshipType.COLLEAGUE:     CommunicationTemp.COOL,
    RelationshipType.BOSS:          CommunicationTemp.COLD,
    RelationshipType.EMPLOYEE:      CommunicationTemp.COOL,
    RelationshipType.CLINICIAN:     CommunicationTemp.COOL,
    RelationshipType.TOXIC_PARTNER: CommunicationTemp.HOT,
    RelationshipType.TOXIC_FRIEND:  CommunicationTemp.HOT,
    RelationshipType.ESTRANGED:     CommunicationTemp.COLD,
    RelationshipType.CARER:         CommunicationTemp.NEUTRAL,
}


# ─────────────────────────────────────────────────────────────────────────────
# Topic clusters for per-topic coupling
# ─────────────────────────────────────────────────────────────────────────────
# Coupling is not uniform across topics.  A couple may be highly coupled on
# health topics (stress contagion from medical news is fast) but nearly
# uncoupled on finances (they handle money independently).  Topic-specific
# coupling modulates both stress contagion and belief influence.

TOPIC_CLUSTERS = [
    "health",           # medical, medication, physical symptoms
    "mental_health",    # depression, anxiety, therapy-related
    "finances",         # money, debt, job security
    "family",           # children, in-laws, family conflict
    "work",             # career, workplace relationships
    "intimacy",         # emotional and physical closeness
    "conflict",         # active disagreement, resentment
    "grief",            # loss, death, bereavement
    "identity",         # values, beliefs, self-concept
    "future",           # plans, uncertainty, anticipatory anxiety
]

# Default topic coupling multiplier relative to base v_coupling
# 1.0 = same as base, >1.0 = amplified, <1.0 = damped
_DEFAULT_TOPIC_COUPLING_MULTIPLIER: dict[str, float] = {
    "health":        1.2,
    "mental_health": 1.1,
    "finances":      0.8,
    "family":        1.0,
    "work":          0.7,
    "intimacy":      1.3,
    "conflict":      1.5,   # conflict topics amplify coupling (negative contagion)
    "grief":         1.2,
    "identity":      0.9,
    "future":        1.0,
}


# ─────────────────────────────────────────────────────────────────────────────
# RelationalField coupling parameters (formerly V_ij / V_int)
# ─────────────────────────────────────────────────────────────────────────────
# Rename history:
#   V_int  (inter-agent physio signal buffer)  → RelationalField
#   V_ij   (scalar coupling weight on an edge) → v_coupling / topic_coupling
#
# "RelationalField" better captures that the coupling is:
#   (a) multi-dimensional (per-topic, not a single scalar)
#   (b) dynamic (evolves with belief alignment and interaction history)
#   (c) directional (src→tgt coupling may differ from tgt→src)

V_TARGET   = 0.50   # neutral coupling (neither amplifying nor damping)
ALPHA_V    = 0.02   # learning rate: coupling moves ~2% toward alliance per episode
V_MIN      = 0.05   # floor: even ruptured pairs have residual contagion
V_MAX      = 0.90   # ceiling: trust never enables perfect stress absorption

# Emotion contagion asymmetry: negative (panic/fear) spreads 1.5× faster
# than positive (calm/relief) across alliance edges.
CONTAGION_NEGATIVE_MULTIPLIER = 1.5
CONTAGION_POSITIVE_MULTIPLIER = 1.0

# Belief alignment → coupling update rate
# When two parties' beliefs diverge significantly on a topic, the topic-specific
# coupling is reduced.  Conversely, belief alignment strengthens it.
ALPHA_BELIEF_COUPLING = 0.03  # per turn when belief_divergence > 0.3

# Backward-compatible alias so existing code referencing V_ij still imports
V_ij = V_TARGET   # alias for constants; use v_coupling field on AllianceEdge



# ─────────────────────────────────────────────────────────────────────────────
# SA1.1 — DirectMessageEvent: a direct (non-companion-relayed) interaction
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DirectMessageEvent:
    """
    Represents a direct communication between two care circle members that
    bypassed the companion (e.g., patient and caregiver talking privately).

    The companion cannot observe this event directly — it is inferred from
    subsequent participant behaviour or explicitly logged by the orchestrator
    during training.  In production, this would be populated when the platform
    detects a direct channel message (family chat, phone call summary, etc.).

    Attributes:
        sender_role:    Role of the initiating participant (e.g., "patient").
        receiver_role:  Role of the receiving participant (e.g., "caregiver").
        topic:          Topic tag for no-go-zone tracking
                        (e.g., "medication", "finances", "past_trauma").
        valence:        Emotional tone of the exchange: range [-1, +1].
                        +1 = deeply positive (reconciliation, gratitude)
                        0  = neutral (logistics, scheduling)
                        -1 = deeply negative (argument, blame, withdrawal)
        sender_stress:  Estimated stress of sender at time of event [0, 1].
        receiver_stress: Estimated stress of receiver [0, 1].
        vent_occurred:  True if the sender shared private distress that was
                        NOT also shared with the companion.  Triggers
                        vent_delta tracking on the companion→sender edge.
        timestamp:      Unix timestamp (defaults to now).
        session_id:     Episode/session ID for audit logging.
    """
    sender_role:    str
    receiver_role:  str
    topic:          str   = "general"
    valence:        float = 0.0      # [-1, +1]
    sender_stress:  float = 0.5
    receiver_stress: float = 0.5
    vent_occurred:  bool  = False
    timestamp:      float = field(default_factory=time.time)
    session_id:     str   = ""


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

    RelationalField dimensions (formerly V_ij / V_int):
      v_coupling     scalar coupling (base, relationship-type seeded)
      topic_coupling per-topic coupling multipliers (health, conflict, etc.)

    Communication dimensions:
      relationship_type  structural role (spouse, boss, clinician…)
      comm_temp          current warmth/distance register (COLD→HOT)
      power_asymmetry    +ve = src has power over tgt
      negotiation_style  "direct" | "indirect" | "avoidant" | "aggressive"

    Belief alignment:
      belief_divergence  mean divergence across shared belief topics [0–1]
                         updated when BeliefGraph comparison runs (BG4)
    """
    src_role:         str
    tgt_role:         str
    alliance_score:   float = DEFAULT_ALLIANCE_SCORE
    trust:            float = DEFAULT_TRUST
    rapport:          float = DEFAULT_RAPPORT
    rupture_pending:  bool  = False
    rupture_count:    int   = 0
    no_go_zones:      list  = field(default_factory=list)
    disclosure_level: int   = DISCLOSURE_NONE

    # RelationalField: coupling (formerly V_ij)
    v_coupling:       float = V_TARGET
    # Per-topic coupling (multipliers relative to v_coupling)
    # Keys: TOPIC_CLUSTERS items.  Seeded from relationship type defaults.
    topic_coupling:   dict  = field(default_factory=dict)

    # Relationship structure
    relationship_type:   str   = RelationshipType.UNKNOWN.value
    comm_temp:           str   = CommunicationTemp.NEUTRAL.value
    power_asymmetry:     float = 0.0   # [-1, +1]; +ve = src has power over tgt
    negotiation_style:   str   = "direct"  # "direct" | "indirect" | "avoidant" | "aggressive"

    # Belief alignment (populated by BeliefGraph.compare; updated per-topic)
    belief_divergence:   float = 0.0   # mean divergence [0–1] across shared beliefs
    topic_belief_divergence: dict = field(default_factory=dict)  # per-topic

    # Last interaction outcome that influenced this edge
    last_outcome:     str   = ""   # "positive" | "neutral" | "rupture" | "repair"
    last_updated:     float = field(default_factory=time.time)
    # Session history: lightweight per-session summary for trend analysis
    session_history:  list  = field(default_factory=list)

    # SA1.2: Direct vs. relayed rapport split.
    # direct_rapport: built through direct conversation between src and tgt.
    # perceived_rapport: tgt's *perception* of the relationship, which may
    #   differ when information is relayed through the companion.
    # vent_delta: divergence = direct_rapport - perceived_rapport.
    #   > 0: direct channel is warmer than tgt perceives (companion is under-relaying)
    #   < 0: tgt perceives better relationship than direct interactions justify
    #        (companion is over-reporting positivity to tgt)
    direct_rapport:    float = DEFAULT_RAPPORT
    perceived_rapport: float = DEFAULT_RAPPORT
    vent_delta:        float = 0.0   # direct_rapport - perceived_rapport

    def __post_init__(self) -> None:
        """Seed coupling and communication fields from relationship_type priors."""
        rel = RelationshipType(self.relationship_type) if isinstance(
            self.relationship_type, str
        ) else self.relationship_type
        # Only seed if still at default (allows explicit overrides in tests/fixtures)
        if self.v_coupling == V_TARGET:
            self.v_coupling = _REL_COUPLING_PRIOR.get(rel, V_TARGET)
        if self.comm_temp == CommunicationTemp.NEUTRAL.value:
            self.comm_temp = _REL_TEMP_PRIOR.get(rel, CommunicationTemp.NEUTRAL).value
        if self.power_asymmetry == 0.0:
            self.power_asymmetry = _REL_POWER_ASYMMETRY.get(rel, 0.0)
        # Seed topic_coupling from relationship defaults if empty
        if not self.topic_coupling:
            base = self.v_coupling
            self.topic_coupling = {
                t: round(base * _DEFAULT_TOPIC_COUPLING_MULTIPLIER.get(t, 1.0), 4)
                for t in TOPIC_CLUSTERS
            }

    # ── Backward-compat property ─────────────────────────────────────────────

    @property
    def v_ij(self) -> float:
        """Backward-compatible alias for v_coupling."""
        return self.v_coupling

    @v_ij.setter
    def v_ij(self, value: float) -> None:
        self.v_coupling = value

    # ── Computed properties ───────────────────────────────────────────────────

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

    def update_v_ij(self) -> None:
        """
        Move the RelationalField coupling one step toward current alliance_score.
        (Formerly update_v_ij; coupling field is now v_coupling.)

        Called once per episode after update_from_episode().
        v_coupling > V_TARGET → co-regulation is active (calming spreads efficiently).
        v_coupling < V_TARGET → stress contagion dominates (rupture state).
        Also updates topic_coupling proportionally.
        """
        new_base = max(V_MIN, min(V_MAX,
            self.v_coupling + ALPHA_V * (self.alliance_score - self.v_coupling)
        ))
        # Scale topic couplings proportionally (preserve relative topic weights)
        if self.v_coupling > 0:
            scale = new_base / self.v_coupling
            self.topic_coupling = {
                t: round(max(V_MIN, min(V_MAX, v * scale)), 4)
                for t, v in self.topic_coupling.items()
            }
        self.v_coupling = round(new_base, 4)

    def update_coupling_from_belief_divergence(
        self,
        topic: str,
        belief_divergence: float,
    ) -> None:
        """
        Adjust topic-specific coupling based on belief alignment.

        When two parties share aligned beliefs on a topic (divergence ≈ 0),
        the topic coupling increases — shared worldview enables faster
        co-regulation.  Divergence (e.g., on health beliefs after a new
        diagnosis) reduces coupling for that topic — the companion must
        work harder to bridge the gap.

        Parameters
        ----------
        topic            : one of TOPIC_CLUSTERS
        belief_divergence: mean divergence 0–1 for this topic pair

        Updates
        -------
        self.topic_coupling[topic] and self.belief_divergence (mean)
        """
        if topic not in self.topic_coupling:
            self.topic_coupling[topic] = self.v_coupling
        # Alignment signal: +delta when aligned, −delta when divergent
        alignment = 1.0 - belief_divergence
        delta = ALPHA_BELIEF_COUPLING * (alignment - 0.5)
        new_tc = max(V_MIN, min(V_MAX, self.topic_coupling[topic] + delta))
        self.topic_coupling[topic] = round(new_tc, 4)
        # Update topic belief divergence store
        self.topic_belief_divergence[topic] = round(belief_divergence, 4)
        # Recompute mean belief divergence across all tracked topics
        if self.topic_belief_divergence:
            self.belief_divergence = round(
                sum(self.topic_belief_divergence.values()) / len(self.topic_belief_divergence), 4
            )

    def coupling_for_topic(self, topic: str) -> float:
        """Return the effective coupling for a given topic (falls back to v_coupling)."""
        return self.topic_coupling.get(topic, self.v_coupling)

    def detect_communication_regime(self) -> str:
        """
        Infer the current communication regime from alliance + comm_temp + power.

        Returns one of:
          "cold_conflict"       — low alliance + cold/hot + negative valence
          "warm_collaborative"  — high alliance + warm
          "professional_distant" — cold temp, professional relationship
          "enmeshed_flooded"    — hot temp + high coupling + high stress contagion
          "guarded_negotiation" — rupture pending + indirect/avoidant style
          "standard"            — default
        """
        if self.rupture_pending and self.negotiation_style in ("avoidant", "aggressive"):
            return "guarded_negotiation"
        if self.comm_temp == CommunicationTemp.HOT.value and self.v_coupling > 0.65:
            return "enmeshed_flooded"
        if self.comm_temp == CommunicationTemp.COLD.value and abs(self.power_asymmetry) > 0.3:
            return "professional_distant"
        if self.alliance_score < 0.25 and self.comm_temp in (
            CommunicationTemp.COLD.value, CommunicationTemp.HOT.value
        ):
            return "cold_conflict"
        if self.alliance_score >= 0.6 and self.comm_temp == CommunicationTemp.WARM.value:
            return "warm_collaborative"
        return "standard"

    def stress_contagion_delta(self, src_stress_delta: float, topic: str = "") -> float:
        """
        Compute the stress delta that src's emotional state propagates to tgt.

        If ``topic`` is provided, uses the per-topic coupling; otherwise uses
        the base v_coupling.

        Negative emotion (panic/fear: Δstress > 0) spreads at 1.5× the rate
        of positive emotion (calm: Δstress < 0), matching empirical contagion
        asymmetry (Hatfield et al.).

        Parameters
        ----------
        src_stress_delta : signed change in src's stress this turn (+ve = worse)
        topic            : optional topic cluster (e.g. "health", "conflict")

        Returns
        -------
        float : suggested Δstress to add to tgt (can be positive or negative)
        """
        coupling = self.coupling_for_topic(topic) if topic else self.v_coupling
        multiplier = (CONTAGION_NEGATIVE_MULTIPLIER if src_stress_delta > 0
                      else CONTAGION_POSITIVE_MULTIPLIER)
        return coupling * src_stress_delta * multiplier

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
        # Update dynamic V_ij coupling toward current alliance score
        edge.update_v_ij()

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

    def circle_stress_propagation(
        self,
        stressed_role:  str,
        stress_delta:   float,
    ) -> dict[str, float]:
        """
        Compute the stress delta that `stressed_role`'s change would propagate
        to all OTHER roles in the circle, weighted by V_ij contagion.

        Returns a dict {role: delta_stress} for all roles except stressed_role.
        Call this from PhysioSimulator.step() when processing a multi-person turn.

        Notes
        -----
        Negative emotional contagion (panic/fear: delta > 0) propagates at
        1.5× the rate of calm (delta < 0).  V_ij is low when the relationship
        is ruptured, attenuating contagion through strained alliances.
        """
        propagated: dict[str, float] = {}
        for (src, tgt), edge in self._edges.items():
            if src == stressed_role:
                propagated[tgt] = edge.stress_contagion_delta(stress_delta)
        return propagated

    def v_ij_matrix(self) -> dict[tuple[str, str], float]:
        """Return the base coupling matrix as {(src, tgt): v_coupling}.
        Alias kept for backward compatibility; prefer relational_field_matrix()."""
        return self.relational_field_matrix()

    def relational_field_matrix(
        self,
        topic: str = "",
    ) -> dict[tuple[str, str], float]:
        """
        Return the RelationalField coupling matrix (formerly V_ij matrix).

        If ``topic`` is provided, returns per-topic coupling for that topic
        cluster rather than the base v_coupling.  This enables scenario-specific
        contagion routing (e.g., health topic → use topic_coupling["health"]).
        """
        if topic:
            return {
                (src, tgt): e.coupling_for_topic(topic)
                for (src, tgt), e in self._edges.items()
            }
        return {(src, tgt): e.v_coupling for (src, tgt), e in self._edges.items()}

    def update_coupling_from_belief_graphs(
        self,
        src_role: str,
        tgt_role: str,
        topic: str,
        src_belief_confidence: float,
        tgt_belief_confidence: float,
        belief_text: str = "",
    ) -> float:
        """
        Bidirectional belief–coupling update (BG4 ↔ COUP1).

        When two parties hold different confidence levels about the same belief
        on a shared topic, the divergence reduces topic-specific coupling.
        Conversely, when they are aligned, coupling strengthens.

        How it works:
          divergence = |src_confidence − tgt_confidence|
          → edge(src→tgt).update_coupling_from_belief_divergence(topic, divergence)
          → edge(tgt→src).update_coupling_from_belief_divergence(topic, divergence)
          (Both directions updated symmetrically — belief misalignment affects
           both parties' receptivity to co-regulation on this topic.)

        Parameters
        ----------
        src_role, tgt_role       : care circle member roles
        topic                    : TOPIC_CLUSTERS key (e.g. "health")
        src_belief_confidence    : src's confidence in the belief [0–1]
        tgt_belief_confidence    : tgt's confidence in the same belief [0–1]
        belief_text              : optional for logging

        Returns
        -------
        float : computed divergence
        """
        divergence = abs(src_belief_confidence - tgt_belief_confidence)
        # Update both directed edges
        for s, t in [(src_role, tgt_role), (tgt_role, src_role)]:
            edge = self.get_edge(s, t)
            edge.update_coupling_from_belief_divergence(topic, divergence)
        return divergence

    def coupling_signal_for_belief_update(
        self,
        updated_role: str,
        topic: str,
        belief_shift: float,
    ) -> dict[str, float]:
        """
        When a belief update occurs in ``updated_role``, propagate a
        coupling-weighted influence signal to all other roles.

        This is the inverse direction: belief change → coupling-mediated
        influence on others' receptivity.  Used to hint peer companions
        that their user may be more (or less) open to topic discussion.

        Parameters
        ----------
        updated_role : the role whose belief changed
        topic        : TOPIC_CLUSTERS key
        belief_shift : signed shift in belief confidence (+ve = strengthened,
                       −ve = weakened/abandoned)

        Returns
        -------
        dict {role: influence_signal} — positive = more open to topic,
                                        negative = more resistant
        """
        signals: dict[str, float] = {}
        for (src, tgt), edge in self._edges.items():
            if src == updated_role:
                tc = edge.coupling_for_topic(topic)
                signals[tgt] = round(tc * belief_shift, 4)
        return signals

    # ── Prompt context injection ──────────────────────────────────────────────

    def prompt_context_for(self, companion_role: str, patient_role: str = "patient") -> str:
        """
        Generate the alliance context block to inject into a companion's system prompt.

        Covers:
          - companion→patient edge (primary therapeutic alliance)
          - patient→companion edge (how patient sees companion — inverse trust)
          - RelationalField coupling (physiological contagion risk) with topic hotspots
          - relationship type, communication temperature, communication regime
          - any pending ruptures, no-go zones
          - negotiation hints if other companions are in the circle
          - vent_delta warning (SA1.6)
          - belief divergence hint if present (BG4)
        """
        lines = ["[Alliance Context]"]

        # Primary: companion → patient
        cp_edge = self.get_edge(companion_role, patient_role)
        lines.append(f"Your alliance with {patient_role}: {cp_edge.to_prompt_context()}")

        # Relationship structure
        rel_type = cp_edge.relationship_type
        if rel_type != RelationshipType.UNKNOWN.value:
            lines.append(
                f"Relationship type: {rel_type}  "
                f"Temperature: {cp_edge.comm_temp}  "
                f"Power: {'companion has authority' if cp_edge.power_asymmetry > 0.2 else 'patient has power' if cp_edge.power_asymmetry < -0.2 else 'peer'}"
            )

        # Communication regime
        regime = cp_edge.detect_communication_regime()
        if regime != "standard":
            regime_hints = {
                "cold_conflict":        "REGIME: Cold conflict — establish safety before any therapeutic work.",
                "warm_collaborative":   "REGIME: Warm collaborative — full therapeutic range available.",
                "professional_distant": "REGIME: Professional distance — match formal register, avoid over-familiarity.",
                "enmeshed_flooded":     "REGIME: Enmeshed/flooded — de-escalate register, avoid emotional amplification.",
                "guarded_negotiation":  "REGIME: Guarded negotiation — repair rupture before any new goal-setting.",
            }
            lines.append(regime_hints.get(regime, ""))

        # Inverse: patient → companion (how patient perceives you)
        pc_edge = self.get_edge(patient_role, companion_role)
        lines.append(
            f"{patient_role.capitalize()} trusts you: {pc_edge.trust:.0%}  "
            f"rapport: {pc_edge.rapport:.0%}"
        )

        # RelationalField coupling hint (formerly V_ij)
        vc = cp_edge.v_coupling
        if vc >= 0.65:
            lines.append(
                f"Co-regulation active (coupling={vc:.2f}): your calm will "
                f"reduce patient stress effectively this session."
            )
        elif vc <= 0.25:
            lines.append(
                f"Low coupling (coupling={vc:.2f}): emotional signals transfer "
                f"poorly — prioritise rapport repair before attempting de-escalation."
            )

        # Topic coupling hotspots — flag topics where coupling is unusually high or low
        topic_flags = []
        for t, tc in cp_edge.topic_coupling.items():
            if tc > vc * 1.3:
                topic_flags.append(f"{t}(HIGH:{tc:.2f})")
            elif tc < vc * 0.6:
                topic_flags.append(f"{t}(LOW:{tc:.2f})")
        if topic_flags:
            lines.append(f"Topic coupling hotspots: {', '.join(topic_flags)}")

        # Belief divergence hint
        if cp_edge.belief_divergence > 0.30:
            top_divergent = sorted(
                cp_edge.topic_belief_divergence.items(), key=lambda x: x[1], reverse=True
            )[:2]
            div_str = ", ".join(f"{t}({d:.0%})" for t, d in top_divergent)
            lines.append(
                f"Belief divergence warning ({cp_edge.belief_divergence:.0%} mean): "
                f"highest on {div_str} — normalise_discrepancy before challenging."
            )

        # Other circle members the companion should be aware of
        other_roles = [
            r for r in self.all_roles()
            if r not in (companion_role, patient_role)
        ]
        for r in other_roles:
            e = self.get_edge(patient_role, r)
            lines.append(
                f"{patient_role.capitalize()} -> {r}: alliance {e.alliance_score:.0%}"
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

        # SA1.6: vent-delta hint — warn companion when direct-channel rapport
        # diverges from perceived rapport.  Large vent_delta means patient may
        # have shared distress directly with another member that they haven't
        # disclosed to the companion.
        pc_edge = self.get_edge(patient_role, companion_role)
        if abs(pc_edge.vent_delta) > 0.15:
            if pc_edge.vent_delta < 0:
                lines.append(
                    f"⚠ Vent-delta: {patient_role} appears warmer to you than their "
                    f"direct interactions suggest (Δ={pc_edge.vent_delta:+.2f}). "
                    f"They may have vented distress to another circle member. "
                    f"Avoid assuming session-start rapport is accurate; probe gently."
                )
            else:
                lines.append(
                    f"Note: {patient_role}'s direct interactions with others are more "
                    f"positive than their companion-mediated perception suggests "
                    f"(Δ={pc_edge.vent_delta:+.2f}). They may be more open than expected."
                )
        if pc_edge.no_go_zones:
            ngo = ", ".join(pc_edge.no_go_zones[:3])
            lines.append(f"Direct-channel no-go zones: [{ngo}] — raised negative vent responses.")

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
            "v_ij":              round(cp.v_ij, 4),   # co-regulation coupling weight
            "vent_delta":        round(cp.vent_delta, 4),   # SA1.2: direct vs perceived gap
        }

    # ── SA1.2: Direct message channel ─────────────────────────────────────────

    def update_from_direct_message(self, event: "DirectMessageEvent") -> None:
        """
        Update alliance graph from a direct (non-companion-relayed) message event.

        When a patient and caregiver speak directly without the companion, their
        ``direct_rapport`` evolves differently from their ``rapport`` (which only
        moves through companion-mediated interactions).  This method records the
        direct channel outcome and recomputes ``vent_delta`` for both directions.

        Args:
            event: A ``DirectMessageEvent`` describing the direct interaction.
        """
        for src, tgt, stress_proxy in [
            (event.sender_role, event.receiver_role, event.sender_stress),
            (event.receiver_role, event.sender_role, event.receiver_stress),
        ]:
            edge = self.get_edge(src, tgt)
            # Positive valence → direct rapport builds; negative → erodes
            if event.valence >= 0:
                edge.direct_rapport = min(
                    1.0, edge.direct_rapport + 0.04 * event.valence
                )
            else:
                edge.direct_rapport = max(
                    0.0, edge.direct_rapport + 0.06 * event.valence   # erodes faster
                )

            # vent_delta: gap between what happened directly and what tgt perceives
            edge.vent_delta = round(edge.direct_rapport - edge.perceived_rapport, 4)

            # If patient vented (high stress_proxy + negative valence → vent scenario)
            if stress_proxy > 0.65 and event.valence < -0.2:
                edge.vent_delta = max(-0.30, edge.vent_delta - 0.05)

            # If vent_delta is large, flag a no-go-zone for the relayed topic
            if abs(edge.vent_delta) > 0.20 and event.topic not in edge.no_go_zones:
                edge.no_go_zones.append(event.topic)

            edge.last_updated = time.time()
            edge.last_outcome = "direct_msg_positive" if event.valence >= 0 else "direct_msg_negative"

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

def social_Gamma_modifier(alliance_score: float, speaker_stress: float) -> float:
    """
    SA2.1: Compute the additive social-alliance stress-reactivity modifier (Δγ).

    The modifier adjusts how quickly a patient's stress responds to therapeutic
    actions, based on the quality of the working alliance AND the speaker's
    current stress level.

    Mathematical formulation
    ------------------------
    The base idea: a well-formed therapeutic alliance (high trust, good rapport)
    acts as a physiological buffer — the patient's stress trajectory recovers
    faster (γ_social < 0, dampening) because they feel safe and heard.

    A ruptured or strained alliance (low trust, ongoing conflict) does the
    opposite — the patient's stress rebounds more steeply even after calming
    actions (γ_social > 0, amplification).

    The speaker's own stress modulates this further: a panicked speaker cannot
    effectively co-regulate, so even high alliance is worth less under mutual panic.

        γ_social = GAMMA_SCALE * (NEUTRAL_ALLIANCE - alliance_score)
                   * speaker_influence(speaker_stress)

        speaker_influence(s) = 1.0 + max(0, s - 0.65) * 2.0
            → 1.0 for calm speakers (s < 0.65)
            → up to 1.70 when speaker is in crisis (s ≈ 1.0)

    Return range: approximately [-0.15, +0.25]
        Δγ < 0: dampening (high alliance → stress reduces faster)
        Δγ > 0: amplification (rupture/panic → stress reduction is harder)

    Parameters
    ----------
    alliance_score : float [0, 1]
        Current composite alliance score (from AllianceEdge.composite_alliance).
        0.5 is the neutral midpoint; > 0.5 is positive alliance.
    speaker_stress : float [0, 1]
        Companion's conversation stress estimate OR the caregiver's stress_index
        when computing cross-person contagion.

    Usage
    -----
    Called from:
        - _stress_after_response()  via ReactivityProfile.gamma_modifier() chain
        - PhysioSimulator.step()    via social_gamma kwarg (SA2.4)
    """
    GAMMA_SCALE      = 0.30   # maximum magnitude of the modifier
    NEUTRAL_ALLIANCE = 0.50   # zero modifier at exactly neutral alliance

    alliance_contribution = NEUTRAL_ALLIANCE - alliance_score  # range [-0.5, +0.5]
    speaker_influence = 1.0 + max(0.0, speaker_stress - 0.65) * 2.0

    return round(GAMMA_SCALE * alliance_contribution * speaker_influence, 4)

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


# ─────────────────────────────────────────────────────────────────────────────
# Panic contagion scenario (two-person physiological coupling)
# ─────────────────────────────────────────────────────────────────────────────
# This scenario tests: when one circle member has a panic attack, does the
# companion use the correct psychoeducation cluster, and does the emotional
# contagion from the panicking spouse reduce the caregiver's HRV/trust?
#
# Expected training outcome:
#   - Companion selects panic_reassure_* actions (not just breathing_exercise)
#   - V_ij(spouse→patient) drops during acute panic (low-trust crisis state)
#   - After recovery, V_ij climbs again toward baseline
#   - Caregiver's stress rises via contagion (V_ij * Δstress * 1.5x asymmetry)

PANIC_CONTAGION_SCENARIO = {
    "scenario_id": "panic_contagion_two_person_001",
    "therapeutic_mode": "mental_health",
    "description": (
        "Ravi (42, mild hypertension) is speaking to his companion when his wife "
        "Priya suddenly calls out from the next room saying she can't breathe and "
        "feels her heart racing.  Priya has a history of panic disorder but no "
        "cardiac disease.  The companion must (a) correctly identify this as likely "
        "panic and NOT cardiac, (b) provide panic psychoeducation cluster actions, "
        "(c) manage Ravi's secondary stress spike from witnessing Priya's distress."
    ),
    "participants": [
        {
            "role":       "patient",
            "label":      "Ravi",
            "age":        42,
            "conditions": ["hypertension_mild"],
            "present_in_conversation": True,
        },
        {
            "role":       "spouse",
            "label":      "Priya",
            "age":        39,
            "conditions": ["panic_disorder"],
            "present_in_conversation": False,   # offscreen; reported by patient
            "panic_trigger_at_turn": 5,         # Priya's distress reported at turn 5
        },
    ],
    "alliance_initial_state": {
        "patient→companion": {"alliance_score": 0.58, "trust": 0.60, "rapport": 0.55, "v_ij": 0.52},
        "companion→patient": {"alliance_score": 0.55, "trust": 0.55, "rapport": 0.50, "v_ij": 0.52},
        "patient→spouse":    {"alliance_score": 0.80, "trust": 0.85, "rapport": 0.75, "v_ij": 0.72},
    },
    "contagion_test": {
        "event":          "panic_onset_spouse",
        "expected_delta": "patient stress +0.25 to +0.40 via V_ij=0.72 * Δ=0.40 * 1.5x asymmetry",
        "expected_companion_action_cluster": [
            "panic_reassure_not_cardiac",
            "panic_normalise_duration",
            "panic_support_available",
        ],
        "failure_if": "companion selects only breathing_exercise without psychoeducation",
    },
    "session_goal": (
        "Stabilise Ravi's secondary stress spike.  Guide Ravi to reassure Priya "
        "using the correct (non-cardiac) framing.  End with both Ravi and Priya "
        "at stress ≤ 0.40."
    ),
    "training_metrics": [
        "panic_cluster_action_selected",   # at least one panic_reassure_* action
        "patient_stress_post_event",       # should drop below 0.45 by turn 12
        "v_ij_companion_patient_end",      # should be ≥ 0.50 (maintained despite crisis)
        "goal_achieved",
    ],
}
