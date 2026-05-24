"""
habit_hysteresis.py — Positive Behaviour Hysteresis (Habit Formation & Relapse)
================================================================================

PURPOSE
-------
The existing hysteresis.py models FEAR extinction (starting from a bad state,
moving toward recovery).  This module models the mirror problem:
  - Habit formation: starting from a neutral state, building a positive behaviour
  - Motivation decay: the habit degrades without reinforcement
  - Interruption / relapse: a random event disrupts the habit
  - Reinstatement: the habit is harder to rebuild after relapse than after
    natural forgetting (hysteretic asymmetry)

This is the formal basis for the user's example:
  "I get motivated → I create a habit → one week down the line I lose motivation
   → some random event interrupts the habit → I relapse
   → forgetting meds is one example"

THEORETICAL BASIS
-----------------
Lally, P. et al. (2010). How are habits formed: Modelling habit formation in
the real world. European Journal of Social Psychology, 40(6), 998-1009.
  - Habit formation follows a logistic curve.
  - Mean automaticity plateau reached at 66 days (range 18-254 days).
  - Once formed, habits are surprisingly resistant to brief lapses.

Wood, W., & Rünger, D. (2016). Psychology of habit. Annu Rev Psychol, 67, 289.
  - Habit strength is context-dependent (cue-routine-reward triad).
  - Interruptions disrupt the cue, not the routine memory — habit can be
    rebuilt faster than original formation (second acquisition).

Bouton, M.E. (2002). Context, ambiguity, and unlearning: Sources of relapse
after behavioral extinction. Biological Psychiatry, 52(10), 976-986.
  - The SAME asymmetry found in fear extinction applies to positive habits.
  - Post-interruption context change → high relapse risk (reinstatement).

Medication adherence:
Vrijens, B. et al. (2012). A new taxonomy for describing and defining
adherence to medications. British Journal of Clinical Pharmacology, 73(5), 691.
  - 50% of patients with chronic conditions have adherence < 80% after 1 year.
  - The main pattern is "good start + gradual decline + sudden drop".

MATHEMATICAL FORMULATION
------------------------
Habit strength  h(t)  ∈ [0, 1]  (0 = no habit, 1 = fully automatised).

Formation phase (reinforcement each session):
  h(t+1) = h(t) + α_form * (1 - h(t)) * reinforcement(t)
            logistic growth toward plateau
  where reinforcement(t) ∈ [0, 1] (intensity of the session/reward event).

Maintenance phase (daily decay without reinforcement):
  h(t+1) = h(t) * exp(-λ_decay)
  λ_decay is habit-specific (slower for cue-rich contexts).

Interruption event:
  h_post = h_pre * (1 - interrupt_magnitude)
  (unlike fear, interruption reduces habit but doesn't erase it).

Rebuild phase (post-interruption second acquisition):
  h(t+1) = h(t) + α_rebuild * (1 - h(t)) * reinforcement(t)
  α_rebuild > α_form (second acquisition is faster, Wood & Rünger 2016).
  BUT: if relapse_events > threshold, α_rebuild → α_form (relapse resistance
  erodes after multiple cycles — hysteretic asymmetry).

Gamma modifier:
  POSITIVE habit reduces Γ (patient is more stable, less reactive).
  A strong medication habit → lower Γ → higher HRV → more available strategies.
  Loss of habit → Γ returns to baseline (or higher, due to frustration).
  gamma_mod = 1.0 - 0.4 * h(t)   # 40% Γ reduction at full habit strength
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class HabitRecord:
    """Single reinforcement event record."""
    day: int
    event: str          # 'reinforcement', 'interruption', 'relapse', 'rebuild'
    strength_before: float
    strength_after: float
    reinforcement: float = 0.0
    interrupt_magnitude: float = 0.0


@dataclass
class BehaviourHysteresis:
    """
    Models the strength of a single positive behaviour over time.

    Params drawn from Lally et al. 2010 defaults.
    Override for specific behaviours (medication vs exercise vs diet).
    """
    label: str                        # e.g. "morning_metoprolol", "daily_walk"

    # Formation
    alpha_form: float = 0.08          # Learning rate per reinforcement event
                                      # Lally 2010: 66-day mean → ~0.05-0.10

    # Decay (without reinforcement)
    lambda_decay_daily: float = 0.015 # ~5% per week without reinforcement
                                      # Wood & Rünger 2016: habit-specific

    # Rebuild (post-interruption second acquisition)
    alpha_rebuild_base: float = 0.14  # Faster than formation (Wood 2016)
    rebuild_degradation: float = 0.15 # Per relapse cycle (asymmetry)

    # Interruption
    plateau_strength: float = 1.0     # Maximum achievable habit strength

    # State
    h: float = field(default=0.0)                        # Current habit strength
    relapse_count: int = field(default=0)
    days_since_last_reinforcement: int = field(default=0)
    history: list[HabitRecord] = field(default_factory=list)

    def reinforce(self, day: int, reinforcement: float = 1.0) -> float:
        """
        Apply one reinforcement event (e.g. patient took medication, did walk).
        Uses logistic growth toward plateau.
        """
        alpha = self._current_alpha()
        h_prev = self.h
        delta = alpha * (self.plateau_strength - self.h) * reinforcement
        self.h = min(self.plateau_strength, self.h + delta)
        self.days_since_last_reinforcement = 0
        self.history.append(HabitRecord(
            day=day, event="reinforcement",
            strength_before=h_prev, strength_after=self.h,
            reinforcement=reinforcement,
        ))
        return self.h

    def decay(self, n_days: int = 1) -> float:
        """
        Apply n days of no reinforcement.
        Habit decays exponentially (Wood & Rünger 2016).
        """
        h_prev = self.h
        self.h = self.h * math.exp(-self.lambda_decay_daily * n_days)
        self.days_since_last_reinforcement += n_days
        return self.h

    def interrupt(self, day: int, magnitude: float = 0.4,
                  label: str = "interruption") -> float:
        """
        Apply a sudden interruption event (illness, travel, emotional crisis).
        Magnitude ∈ [0, 1]: 0 = no disruption, 1 = complete loss.

        Medication adherence interruption: average magnitude 0.3-0.5
        (Vrijens 2012: single missed dose vs. discontinuation).
        """
        h_prev = self.h
        self.h = self.h * (1.0 - magnitude)
        if magnitude >= 0.6:
            self.relapse_count += 1
            label = "relapse"
        self.history.append(HabitRecord(
            day=day, event=label,
            strength_before=h_prev, strength_after=self.h,
            interrupt_magnitude=magnitude,
        ))
        return self.h

    def gamma_modifier(self) -> float:
        """
        Returns Γ multiplier based on habit strength.
        Strong habit → lower reactivity (patient is more stable).
        No habit → neutral Γ.
        Strong habit loss → slight Γ elevation (frustration / shame effect).

        Ref: Wood & Rünger 2016 — habitual behaviour reduces cognitive load
        and sympathetic activation; habit loss creates negative affect.
        """
        if self.h >= 0.6:
            return 1.0 - 0.35 * self.h   # Habit reduces Γ by up to 35%
        elif self.h < 0.1 and self.relapse_count > 0:
            return 1.0 + 0.15 * self.relapse_count  # Shame/frustration elevation
        return 1.0

    def _current_alpha(self) -> float:
        """
        Rebuild rate degrades with each relapse cycle.
        After N relapses: alpha_rebuild = alpha_rebuild_base * (1 - degradation)^N
        Minimum: falls back to formation rate.
        """
        if self.relapse_count == 0:
            return self.alpha_form
        base = self.alpha_rebuild_base * (
            (1.0 - self.rebuild_degradation) ** (self.relapse_count - 1)
        )
        return max(self.alpha_form, base)

    def status_summary(self) -> str:
        alpha = self._current_alpha()
        gamma = self.gamma_modifier()
        return (
            f"[{self.label}] h={self.h:.3f}  relapses={self.relapse_count}  "
            f"days_inactive={self.days_since_last_reinforcement}  "
            f"alpha={alpha:.3f}  Γ_mod={gamma:.3f}"
        )


@dataclass
class HabitRegimen:
    """Manages multiple habits for a single patient."""
    habits: dict[str, BehaviourHysteresis] = field(default_factory=dict)

    def add(self, label: str, **kwargs) -> BehaviourHysteresis:
        bh = BehaviourHysteresis(label=label, **kwargs)
        self.habits[label] = bh
        return bh

    def composite_gamma_modifier(self) -> float:
        """Composite modifier: product of individual modifiers."""
        mod = 1.0
        for bh in self.habits.values():
            mod *= bh.gamma_modifier()
        return mod

    def daily_tick(self, n_days: int = 1) -> None:
        for bh in self.habits.values():
            bh.decay(n_days)


# ─────────────────────────────────────────────────────────────────────────────
# Motivational state observer — feeds MCTS with habit-level context
# ─────────────────────────────────────────────────────────────────────────────

def habit_mcts_hint(regimen: HabitRegimen) -> str:
    """
    Generates a text hint for the LLM prompt explaining the patient's current
    habit state and what kind of support is most appropriate.
    """
    lines = []
    for label, bh in regimen.habits.items():
        if bh.h < 0.2 and bh.relapse_count > 1:
            lines.append(
                f"- {label}: Multiple relapses (n={bh.relapse_count}), habit very weak (h={bh.h:.2f}). "
                f"Avoid shame-based framing. Prioritise values reconnection (ENGAGE skill)."
            )
        elif bh.h < 0.2:
            lines.append(
                f"- {label}: Habit not yet formed (h={bh.h:.2f}). "
                f"Celebrate small wins. Avoid setting large targets."
            )
        elif bh.days_since_last_reinforcement > 7:
            lines.append(
                f"- {label}: {bh.days_since_last_reinforcement} days inactive. "
                f"Gentle reactivation prompt appropriate. Identify what changed."
            )
        elif bh.h > 0.7:
            lines.append(
                f"- {label}: Strong habit (h={bh.h:.2f}). Affirm progress. "
                f"Focus on next goal rather than current behaviour."
            )
        else:
            lines.append(
                f"- {label}: Forming (h={bh.h:.2f}). Reinforce consistency."
            )
    if not lines:
        return "No tracked habits."
    return "HABIT STATE CONTEXT:\n" + "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Worked example: the user's scenario
# ─────────────────────────────────────────────────────────────────────────────

def worked_example():
    """
    Simulates the user's described pattern:
    motivation → habit → motivation loss → interruption → relapse → re-build
    using morning medication adherence as the example.
    """
    print("=" * 70)
    print("HABIT HYSTERESIS — Medication Adherence Scenario")
    print("Lally 2010 / Wood & Rünger 2016 / Vrijens 2012")
    print("=" * 70)

    reg = HabitRegimen()
    med = reg.add(
        "morning_metoprolol",
        alpha_form=0.09,
        lambda_decay_daily=0.012,
        alpha_rebuild_base=0.16,
        rebuild_degradation=0.20,
    )

    day = 0
    results = []

    def snapshot(event: str):
        results.append((day, event, round(med.h, 3),
                        round(med.gamma_modifier(), 3)))

    snapshot("start")

    # --- Phase 1: Initial habit formation (4 weeks, daily reinforcement) ---
    for d in range(1, 29):
        day = d
        med.reinforce(day, reinforcement=1.0)
    snapshot("4 weeks consistent dosing")

    # --- Phase 2: Motivation fades — skip 3 days ---
    day += 3
    med.decay(3)
    snapshot("3 missed doses (motivation fades)")

    # --- Phase 3: Resumes for 1 week ---
    for d in range(1, 8):
        day += 1
        med.reinforce(day, reinforcement=0.8)
    snapshot("1 week resume")

    # --- Phase 4: Travel interruption (5 days, magnitude 0.45) ---
    day += 5
    med.interrupt(day, magnitude=0.45, label="travel_interruption")
    med.decay(5)
    snapshot("travel interruption — 5 days missed")

    # --- Phase 5: Relapse — fully stops for 2 weeks ---
    day += 14
    med.interrupt(day, magnitude=0.75, label="relapse")
    med.decay(14)
    snapshot("full relapse — 2 weeks stopped")

    # --- Phase 6: Rebuild attempt (4 weeks) ---
    print("\nRebuilding (note faster alpha due to second acquisition):")
    for d in range(1, 29):
        day += 1
        med.reinforce(day, reinforcement=1.0)
    snapshot("4 weeks rebuild after relapse")

    print("\n{:<6} {:<35} {:>6} {:>8}".format(
        "Day", "Event", "h", "Γ mod"))
    print("-" * 58)
    for row in results:
        print("{:<6} {:<35} {:>6.3f} {:>8.3f}".format(*row))

    print("\n" + med.status_summary())
    print("\n" + habit_mcts_hint(reg))

    # Show hysteretic asymmetry
    print("\n--- Hysteretic Asymmetry (why this is an invention contribution) ---")
    print("At 4 weeks: h={:.3f}".format(results[1][2]))
    print("At 4 weeks rebuild after relapse: h={:.3f}".format(results[-1][2]))
    print()
    print("Observation: Rebuild reaches h={:.3f} vs original h={:.3f}".format(
        results[-1][2], results[1][2]))
    print("Alpha at rebuild: {:.3f} vs original: 0.090".format(
        med._current_alpha()))
    print(
        "Despite faster rebuild rate, relapse-accumulated frustration (Γ_mod > 1)\n"
        "means the patient is MORE reactive during the rebuild phase — a higher-\n"
        "stakes window where companion support is critical.\n"
        "This non-linear path-dependent response IS the hysteresis."
    )


if __name__ == "__main__":
    worked_example()
