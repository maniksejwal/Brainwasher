"""
companion_hysteresis.py — Hysteretic State for the Companion Itself
=====================================================================

PURPOSE
-------
Up to now, hysteresis has been applied to the PATIENT's physiological and
psychological state.  But the companion also has a state that evolves
non-linearly:

  - Rapport accumulated over sessions does not reset instantly on one bad session
  - Trust once broken recovers slowly (hysteretic asymmetry)
  - The companion's "strategic patience" depletes when a patient repeatedly
    ignores advice (the opposite of the patient's ruminant archetype)
  - Across multiple users, a shared companion's "burn rate" accumulates

This is COMPANION hysteresis — the memory in the relationship between the
companion and the patient, not just within the patient's physiology.

WHY THIS MATTERS
----------------
1. STRATEGIC PATIENCE DEPLETION
   After 5 sessions of non-compliance, the companion's MCTS cost function
   should START factoring in escalation more seriously. Without hysteresis,
   every session starts identically regardless of history.

2. TRUST ASYMMETRY
   If the companion made a clinical error (wrong information, insensitive
   statement) that damaged trust, the recovery requires MORE reinforcement
   than was needed to build the original trust. This is the hysteretic gap.

   rapport_build: α_form = 0.08/session
   post_damage_rebuild: α_rebuild = 0.04/session (SLOWER than original)
   This is inverted from the habit model — repair is harder than build.

3. SHARED COMPANION ACROSS USERS
   When one companion serves a care circle (patient + caregiver + clinician),
   its aggregate relationship state with each member is tracked separately.
   The caregiver's trust does not bleed into the patient's trust.

4. COMPANION "FRUSTRATION" (GAME-THEORETIC)
   This is not emotional frustration in the human sense.
   It is a strategic signal: after N unproductive sessions, the MCTS
   cost function shifts weight from trust_delta (building the relationship)
   toward goal_progress (making clinical progress regardless of approval).
   This is the formal mechanism for making the companion LESS sycophantic
   over time — it has diminishing marginal investment in approval-seeking.

THEORETICAL BASIS
-----------------
Bordin, E.S. (1979). The generalizability of the psychoanalytic concept of the
  working alliance. Psychotherapy, 16(3), 252-260.
  Working Alliance Inventory (WAI): tasks, goals, bond — all three decay
  differentially after rupture.

Safran, J.D., & Muran, J.C. (2000). Alliance rupture resolution.
  Psychotherapy, 37(3), 286-295.
  Rupture resolution is a hysteretic process: rapid rupture, slow repair.
  The repair trajectory is path-dependent on the rupture cause.

Norcross, J.C. (2011). Psychotherapy relationships that work, 2nd ed.
  Oxford.  Alliance is the strongest predictor of outcome across all
  therapy types (r~0.28).
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AllianceRecord:
    session: int
    event: str    # 'rapport_gain', 'rupture', 'repair', 'non_compliance', 'escalation'
    alliance_before: float
    alliance_after: float
    delta: float = 0.0
    notes: str = ""


@dataclass
class CompanionRelationshipState:
    """
    The companion's relationship state with a single user (patient, caregiver, or clinician).

    alliance: Working Alliance score ∈ [0, 1]  (1 = strong; Bordin 1979)
    trust: narrower construct — confidence that companion tells the truth and is competent
    strategic_patience: how much more investment in rapport the companion will make
                        before shifting MCTS weights toward direct goal pursuit
    frustration_weight: analogous to ruminant grudge_state — accumulated non-compliance

    These feed back into the MCTS cost weights through cost_weight_adjustment().
    """
    user_id: str
    role: str    # 'patient', 'caregiver', 'clinician'

    alliance: float = 0.3           # Starting level (new relationship)
    trust: float = 0.3
    strategic_patience: float = 1.0  # Starts full; depletes with non-compliance
    frustration_weight: float = 0.0  # 0=none; grows with repeated non-compliance

    # Formation rates (Bordin 1979 / Safran 2000)
    alpha_build: float = 0.08        # Alliance gain per positive session
    alpha_rupture: float = 0.30      # Alliance loss per rupture event (fast)
    alpha_repair: float = 0.04       # Alliance repair per repair session (SLOW — hysteresis)
    alpha_patience_depletion: float = 0.12  # Per non-compliant session
    alpha_patience_recovery: float = 0.03   # Per compliant session

    ruptured: bool = False
    rupture_count: int = 0
    session_count: int = 0
    history: list[AllianceRecord] = field(default_factory=list)

    def update_after_session(
        self,
        session: int,
        rapport_gain: float = 0.0,     # Positive event contribution [0,1]
        rupture_event: bool = False,
        repair_attempt: bool = False,
        patient_compliant: bool = True,
    ) -> dict:
        """
        Update alliance and trust after a completed session.
        Returns a dict with updated state and MCTS weight recommendation.
        """
        prev = self.alliance

        if rupture_event:
            # Fast drop — Safran & Muran 2000
            loss = self.alpha_rupture * (1.0 + 0.2 * self.rupture_count)
            self.alliance = max(0.0, self.alliance - loss)
            self.trust = max(0.0, self.trust - loss * 0.8)
            self.ruptured = True
            self.rupture_count += 1
            label = 'rupture'

        elif repair_attempt and self.ruptured:
            # Slow repair — hysteretic asymmetry (Safran 2000)
            gain = self.alpha_repair * rapport_gain
            self.alliance = min(1.0, self.alliance + gain)
            self.trust = min(1.0, self.trust + gain * 0.5)
            if self.alliance > 0.5:
                self.ruptured = False
            label = 'repair'

        else:
            # Normal rapport building
            gain = self.alpha_build * rapport_gain * (1.0 - self.alliance)
            self.alliance = min(1.0, self.alliance + gain)
            self.trust = min(1.0, self.trust + gain * 0.6)
            label = 'rapport_gain'

        # Strategic patience (companion's frustration)
        if not patient_compliant:
            self.frustration_weight = min(
                1.0,
                self.frustration_weight + self.alpha_patience_depletion
            )
            self.strategic_patience = max(
                0.1,
                self.strategic_patience - self.alpha_patience_depletion
            )
        else:
            self.frustration_weight = max(
                0.0,
                self.frustration_weight - self.alpha_patience_recovery
            )
            self.strategic_patience = min(
                1.0,
                self.strategic_patience + self.alpha_patience_recovery
            )

        self.session_count += 1
        delta = self.alliance - prev
        self.history.append(AllianceRecord(
            session=session, event=label,
            alliance_before=prev, alliance_after=self.alliance, delta=delta,
        ))
        return self.cost_weight_adjustment()

    def cost_weight_adjustment(self) -> dict:
        """
        Returns adjusted MCTS cost weights based on current relationship state.

        When alliance is high and patience is full: invest in trust (standard weights).
        When patience depletes: shift toward goal_progress (reduce sycophancy).
        When ruptured: prioritise repair over goal_progress entirely.

        This is the formal mechanism for making the companion LESS sycophantic
        over time, without changing the LLM's generation.
        """
        if self.ruptured:
            return {
                'stress_reduction': 0.5,
                'trust_delta':      0.4,
                'goal_progress':    0.05,
                'info_coverage':    0.05,
                'note': 'RUPTURE MODE: prioritise repair. Suspend clinical goals.',
            }

        # Base weights
        base_goal = 0.2 + 0.4 * (1.0 - self.strategic_patience)
        base_trust = max(0.1, 0.4 * self.strategic_patience)
        base_stress = 1.0 - base_goal - base_trust - 0.05

        return {
            'stress_reduction': round(max(0.0, base_stress), 2),
            'trust_delta':      round(base_trust, 2),
            'goal_progress':    round(base_goal, 2),
            'info_coverage':    0.05,
            'frustration_weight': round(self.frustration_weight, 3),
            'note': (
                'ASSERTIVE MODE: patience depleted; shifting to goal_progress'
                if self.strategic_patience < 0.4
                else 'STANDARD: building alliance'
            ),
        }

    def prompt_hint(self) -> str:
        """
        Returns a companion self-awareness hint for its own LLM system prompt.
        This is the companion reflecting on the relationship state.
        """
        lines = []
        if self.ruptured:
            lines.append(
                f"RELATIONSHIP ALERT: The alliance with {self.user_id} was ruptured. "
                f"Prioritise repair. Do not raise clinical goals this session."
            )
        elif self.strategic_patience < 0.4:
            lines.append(
                f"STRATEGIC PATIENCE LOW ({self.strategic_patience:.2f}): "
                f"{self.user_id} has been non-compliant across multiple sessions. "
                f"This session: be warmer but more direct. "
                f"Avoid open-ended exploration — move toward specific commitments."
            )
        if self.frustration_weight > 0.5:
            lines.append(
                f"Non-compliance pattern detected (weight={self.frustration_weight:.2f}). "
                f"Switch from SUPPORT/REFLECT to DIRECT/DEVELOP skills (EEDDAARRSS)."
            )
        lines.append(
            f"Alliance: {self.alliance:.2f} | Trust: {self.trust:.2f} | "
            f"Sessions: {self.session_count} | Ruptures: {self.rupture_count}"
        )
        return "\n".join(lines)


@dataclass
class CompanionHystereticState:
    """Manages relationship states with all users in a care circle."""
    companion_id: str
    relationships: dict[str, CompanionRelationshipState] = field(default_factory=dict)

    def get_or_create(self, user_id: str, role: str) -> CompanionRelationshipState:
        if user_id not in self.relationships:
            self.relationships[user_id] = CompanionRelationshipState(
                user_id=user_id, role=role
            )
        return self.relationships[user_id]

    def circle_prompt_hint(self) -> str:
        """Aggregate hint for a companion serving a multi-user care circle."""
        lines = [f"COMPANION STATE — {self.companion_id}"]
        for uid, rel in self.relationships.items():
            lines.append(f"\n[{rel.role}: {uid}]")
            lines.append(rel.prompt_hint())
        return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Worked example
# ─────────────────────────────────────────────────────────────────────────────

def worked_example():
    print("=" * 70)
    print("COMPANION HYSTERESIS — Relationship State Demo")
    print("Bordin 1979 / Safran & Muran 2000 / Norcross 2011")
    print("=" * 70)

    companion = CompanionHystereticState(companion_id="patient_companion_001")
    rel = companion.get_or_create("marcus_webb", "patient")

    headers = ("Session", "Event", "Alliance", "Trust", "Patience", "MCTS note")
    print("\n{:<8} {:<24} {:>8} {:>6} {:>8}  {}".format(*headers))
    print("-" * 75)

    def row(s, event, weights):
        print("{:<8} {:<24} {:>8.3f} {:>6.3f} {:>8.3f}  {}".format(
            s, event, rel.alliance, rel.trust,
            rel.strategic_patience, weights.get('note', '')[:35]
        ))

    # 3 rapport-building sessions
    for s in range(1, 4):
        w = rel.update_after_session(s, rapport_gain=0.7, patient_compliant=True)
        row(s, "rapport_gain", w)

    # Session 4: rupture — companion made a poor clinical comment
    w = rel.update_after_session(4, rupture_event=True, patient_compliant=False)
    row(4, "RUPTURE", w)

    # Sessions 5-6: repair attempts
    for s in range(5, 7):
        w = rel.update_after_session(s, rapport_gain=0.8, repair_attempt=True, patient_compliant=True)
        row(s, "repair", w)

    # Sessions 7-10: patient non-compliant (not taking medication)
    for s in range(7, 11):
        w = rel.update_after_session(s, rapport_gain=0.3, patient_compliant=False)
        row(s, "non_compliant", w)

    print("\n" + rel.prompt_hint())

    print("\n--- HYSTERETIC ASYMMETRY ---")
    print(f"After 3 build sessions: alliance={companion.relationships['marcus_webb'].history[2].alliance_after:.3f}")
    print(f"After rupture + 2 repair: alliance={rel.alliance:.3f}")
    print(f"Rupture alpha={rel.alpha_rupture:.2f}  Repair alpha={rel.alpha_repair:.2f}")
    print(f"Asymmetry ratio: {rel.alpha_rupture / rel.alpha_repair:.1f}x harder to repair than damage")


if __name__ == "__main__":
    worked_example()
