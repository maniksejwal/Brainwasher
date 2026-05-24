"""
Hysteretic Tensor Negotiation — Hysteresis Layer

The Ornstein-Uhlenbeck process in physio/simulator.py models within-session
stress dynamics: how HRV recovers turn-by-turn after a stressor.

This module adds the orthogonal dimension: between-session, longitudinal
changes to the *baseline* itself — the resting state the OU process reverts to.

The key insight is that the baseline is NOT fixed. It has memory.

Three phenomena require separate models:

1. EXTINCTION LEARNING (therapy → improvement)
   Repeated non-reinforced exposure to a conditioned stimulus (CS) reduces
   the conditioned response (CR). After 1 month of exposure therapy,
   trigger X no longer elicits a panic attack — only mild anxiety.
   Model: exponential decay of the fear association weight w_CS.
   Reference: Rescorla-Wagner (1972).

2. SPONTANEOUS RECOVERY (time → partial reversal)
   After a gap in therapy, the extinguished fear association partially
   rebounds. The extinction memory and the original fear memory compete.
   After 6 months without exposure, trigger X causes moderate anxiety again.
   Model: fear weight recovers toward its original value at a slow rate.
   Reference: Pavlov (1927), Bouton (2004).

3. REINSTATEMENT (new stress → reactivation of old fear)
   An unrelated stressor Y can reinstate a previously extinguished fear.
   Stress hormones (cortisol, CRF) during the stressor activate the
   amygdala's original fear circuit, bypassing extinction inhibition.
   After trigger Y causes significant stress, trigger X causes panic again.
   Model: cumulative stress exposure resets w_CS toward original value.
   Reference: Ressler & Mayberg (2007); Bouton et al. (2006).

Mathematical structure
----------------------
Let w₀ be the original fear association weight (patient-specific).
Let w_t be the current weight after therapy.

Extinction step (each therapy session):
    w_t+1 = w_t - α_ext * (w_t - w_floor) * session_intensity
    where α_ext ∈ [0, 0.05]  (slow learning, stable)
    and   w_floor ∈ [0.05, 0.2] (never fully extinguished — latent inhibition)

Spontaneous recovery (each week without exposure):
    w_t+Δweeks = w_t + α_rec * (w₀ - w_t) * Δweeks
    where α_rec ∈ [0.01, 0.05] (slow passive recovery)

Reinstatement (unrelated high-stress event):
    w_after = w_t + α_rein * (w₀ - w_t) * stress_event_magnitude
    where α_rein ∈ [0.2, 0.8]  (fast, catastrophic)

The fear weight w_t modulates the Γ matrix diagonal:
    Γ_diag = γ_baseline * (1 + w_t * reactivity_factor)

This means a patient with high w_t (not extinguished) has a slow-recovering
γ (high Γ), consistent with the non-Hermitian framework.

The "ability to do nothing" (watchful waiting)
----------------------------------------------
The therapist can also choose NOT to act.  In the MPS framework, the
identity operator U = I represents "do nothing." For a patient in early
extinction, NOT acting (no new stressor, no therapy) simply allows
spontaneous recovery to run at its natural rate α_rec.

The MCTS cost function can explicitly score "watchful waiting" as a
candidate — it has no stress amplification keyword, and the OU process
reverts naturally.  In deaddiction, this corresponds to a session where
the therapist listens without confronting — the silence does work by not
re-triggering the fear circuit.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Optional


# ── Constants ─────────────────────────────────────────────────────────────────

# Maximum observable fear weight (original, untreated)
W_MAX = 1.0

# Minimum achievable fear weight with extinction (latent inhibition floor)
# Even fully treated patients retain a trace — spontaneous recovery requires it.
W_FLOOR = 0.08

# Spontaneous recovery rate per week (fraction of gap between w_t and w₀)
ALPHA_RECOVERY_PER_WEEK = 0.025

# Reinstatement amplification coefficient
ALPHA_REINSTATEMENT = 0.45


# ── Hysteretic baseline per trigger ──────────────────────────────────────────

@dataclass
class TriggerHysteresis:
    """
    Longitudinal extinction/recovery model for one fear-conditioned trigger.

    Fields
    ------
    trigger_id   : str     — unique identifier (topic name, stimulus label)
    w_original   : float   — fear weight at first assessment (0–1)
    w_current    : float   — fear weight now (after therapy, recovery)
    alpha_ext    : float   — extinction rate per session
    w_floor      : float   — minimum achievable weight (latent inhibition)
    last_exposure: float   — unix timestamp of last therapy session targeting this trigger
    history      : list    — log of (timestamp, event, w_before, w_after)
    """
    trigger_id:      str
    w_original:      float  = 1.0
    w_current:       float  = 1.0
    alpha_ext:       float  = 0.03
    w_floor:         float  = W_FLOOR
    last_exposure:   float  = field(default_factory=time.time)
    history:         list   = field(default_factory=list)

    def apply_extinction(self, session_intensity: float = 1.0) -> float:
        """
        One exposure therapy session targeting this trigger.

        session_intensity in [0, 1]: how directly the session engaged this trigger.
        Returns the new w_current.
        """
        w_before    = self.w_current
        delta       = self.alpha_ext * (self.w_current - self.w_floor) * session_intensity
        self.w_current  = max(self.w_floor, self.w_current - delta)
        self.last_exposure = time.time()
        self.history.append({
            "event": "extinction", "w_before": round(w_before, 4),
            "w_after": round(self.w_current, 4), "ts": self.last_exposure,
        })
        return self.w_current

    def apply_spontaneous_recovery(self, weeks_elapsed: float) -> float:
        """
        Passive recovery over a time gap (no therapy, no exposure).
        Called when a session_gap > 1 week is detected.

        Returns the new w_current.
        """
        if weeks_elapsed <= 0:
            return self.w_current
        w_before      = self.w_current
        gap_factor    = 1 - math.exp(-ALPHA_RECOVERY_PER_WEEK * weeks_elapsed)
        self.w_current = self.w_current + (self.w_original - self.w_current) * gap_factor
        self.w_current = min(self.w_original, self.w_current)
        self.history.append({
            "event": "spontaneous_recovery", "weeks": round(weeks_elapsed, 1),
            "w_before": round(w_before, 4), "w_after": round(self.w_current, 4),
            "ts": time.time(),
        })
        return self.w_current

    def apply_reinstatement(self, unrelated_stress_magnitude: float) -> float:
        """
        Reinstatement by an unrelated high-stress event.

        unrelated_stress_magnitude in [0, 1]: severity of the unrelated stressor
        (e.g. bereavement = 0.9, minor argument = 0.2).

        Even a fully extinguished trigger can be fully reinstated by a severe
        unrelated stressor — this is the clinically critical "resurgence" scenario.
        Returns the new w_current.
        """
        if unrelated_stress_magnitude <= 0:
            return self.w_current
        w_before = self.w_current
        delta    = ALPHA_REINSTATEMENT * (self.w_original - self.w_current) * unrelated_stress_magnitude
        self.w_current = min(self.w_original, self.w_current + delta)
        self.history.append({
            "event": "reinstatement", "stressor_magnitude": round(unrelated_stress_magnitude, 3),
            "w_before": round(w_before, 4), "w_after": round(self.w_current, 4),
            "ts": time.time(),
        })
        return self.w_current

    def gamma_modifier(self, reactivity_factor: float = 1.0) -> float:
        """
        Returns a multiplicative modifier for Γ's diagonal based on current
        fear association weight.

        gamma_eff = gamma_hrv * (1 + w_current * reactivity_factor)

        A fully loaded trigger (w=1, reactivity=1) doubles the Γ diagonal,
        meaning recovery is twice as slow as physiological HRV alone predicts.
        A fully extinguished trigger (w=0.08) adds only 8% — negligible.
        """
        return 1.0 + self.w_current * reactivity_factor

    def suds_equivalent(self) -> int:
        """
        Convert fear weight to the Subjective Units of Distress Scale (SUDS, 0–100).
        w=1.0 → SUDS ~100; w=0.08 → SUDS ~8.
        """
        return round(self.w_current * 100)


# ── Subject-level hysteretic baseline ────────────────────────────────────────

@dataclass
class HystereticBaseline:
    """
    Container for all trigger-specific hysteresis models for one subject.

    This is the longitudinal complement to PhysiologicalState: where
    PhysiologicalState captures within-session dynamics, HystereticBaseline
    captures between-session learning and forgetting.

    The two work together:
        γ_eff = gamma_from_state(physio_state) * hysteretic_baseline.gamma_modifier(trigger_id)
    """
    subject_id: str
    reactivity_factor: float = 1.0   # subject-level modifier (see ReactivityProfile)
    triggers: dict[str, TriggerHysteresis] = field(default_factory=dict)

    def add_trigger(
        self,
        trigger_id: str,
        initial_fear: float = 1.0,
        alpha_ext: float = 0.03,
        w_floor: float = W_FLOOR,
    ) -> TriggerHysteresis:
        """Register a new fear-conditioned trigger for this subject."""
        th = TriggerHysteresis(
            trigger_id  = trigger_id,
            w_original  = initial_fear,
            w_current   = initial_fear,
            alpha_ext   = alpha_ext,
            w_floor     = w_floor,
        )
        self.triggers[trigger_id] = th
        return th

    def therapy_session(
        self,
        targeted_triggers: dict[str, float],    # {trigger_id: session_intensity}
        weeks_since_last: float = 1.0,
        unrelated_stressor_magnitude: float = 0.0,
    ) -> dict[str, dict]:
        """
        Process one therapy session.

        1. Apply spontaneous recovery for all triggers (time gap since last session).
        2. If there was an unrelated stressor, apply reinstatement first.
        3. Apply extinction only to targeted triggers.

        Returns a summary of changes: {trigger_id: {w_before, w_after, event}}
        """
        summary = {}

        for tid, th in self.triggers.items():
            w_before = th.w_current

            # Step 1: spontaneous recovery (time gap)
            if weeks_since_last > 0:
                th.apply_spontaneous_recovery(weeks_since_last)

            # Step 2: reinstatement from unrelated stressor
            if unrelated_stressor_magnitude > 0:
                th.apply_reinstatement(unrelated_stressor_magnitude)

            # Step 3: extinction (only for targeted triggers)
            intensity = targeted_triggers.get(tid, 0.0)
            if intensity > 0:
                th.apply_extinction(intensity)

            summary[tid] = {
                "w_before": round(w_before, 4),
                "w_after":  round(th.w_current, 4),
                "w_original": round(th.w_original, 4),
                "suds":     th.suds_equivalent(),
                "delta":    round(th.w_current - w_before, 4),
            }

        return summary

    def gamma_modifier(self, trigger_id: Optional[str] = None) -> float:
        """
        Modifier for Γ diagonal.

        If trigger_id given, returns the modifier for that specific trigger.
        If None, returns the maximum modifier across all active triggers
        (conservative: use the worst-case active fear association).
        """
        if trigger_id and trigger_id in self.triggers:
            return self.triggers[trigger_id].gamma_modifier(self.reactivity_factor)
        if not self.triggers:
            return 1.0
        return max(th.gamma_modifier(self.reactivity_factor) for th in self.triggers.values())

    def current_fear_map(self) -> dict[str, dict]:
        """
        Return current SUDS and fear weight for all triggers.
        Useful for injecting into longitudinal_prompt_hint().
        """
        return {
            tid: {
                "w_current":  round(th.w_current, 4),
                "w_original": round(th.w_original, 4),
                "suds":       th.suds_equivalent(),
                "pct_extinguished": round(100 * (1 - (th.w_current - th.w_floor) /
                                           max(th.w_original - th.w_floor, 1e-6)), 1),
            }
            for tid, th in self.triggers.items()
        }


# ── Worked example for the paper ─────────────────────────────────────────────

def worked_example():
    """
    Reproduce the clinical narrative in the user query:
      - Trigger X causes a panic attack today.
      - After 1 month of weekly therapy → manageable anxiety only.
      - 6-month gap in therapy.
      - Random trigger Y (unrelated stressor) → resurgence; X causes panic again.

    Prints a timestep-by-timestep table.
    """
    print("\nHysteresis Worked Example")
    print("=" * 60)

    subject = HystereticBaseline(subject_id="example_001", reactivity_factor=1.2)
    subject.add_trigger("X", initial_fear=1.0, alpha_ext=0.04)

    print(f"\nInitial state:  Trigger X SUDS = {subject.triggers['X'].suds_equivalent()}  (panic attack expected)")

    # Month 1: 4 weekly therapy sessions targeting trigger X
    print("\n--- Month 1: Weekly exposure therapy ---")
    for week in range(1, 5):
        summary = subject.therapy_session(
            targeted_triggers={"X": 0.9},   # direct, intensive exposure
            weeks_since_last=1.0,
        )
        s = summary["X"]
        print(f"  Week {week}: SUDS {round(s['w_before']*100)} → {subject.triggers['X'].suds_equivalent()}"
              f"  (Δw = {s['delta']:+.4f})")

    print(f"\nAfter 1 month:  Trigger X SUDS = {subject.triggers['X'].suds_equivalent()}  (manageable anxiety)")
    print(f"  γ modifier: {subject.gamma_modifier('X'):.3f}  (Γ is {subject.gamma_modifier('X'):.2f}x baseline)")

    # Months 2–7: 6-month gap — no therapy
    print("\n--- Months 2–7: No therapy (6-month gap) ---")
    summary = subject.therapy_session(
        targeted_triggers={},
        weeks_since_last=26.0,       # 6 months ≈ 26 weeks
    )
    s = summary["X"]
    print(f"  6-month gap: SUDS {round(s['w_before']*100)} → {subject.triggers['X'].suds_equivalent()}")
    print(f"  Spontaneous recovery: w_current = {subject.triggers['X'].w_current:.4f}")

    # Month 8: Unrelated trigger Y (e.g. bereavement) — magnitude 0.7
    print("\n--- Month 8: Trigger Y (unrelated stressor, magnitude 0.7) ---")
    subject.add_trigger("Y", initial_fear=0.0)   # Y was never conditioned
    summary = subject.therapy_session(
        targeted_triggers={},
        weeks_since_last=0.0,
        unrelated_stressor_magnitude=0.7,
    )
    sx = summary["X"]
    print(f"  Trigger X: SUDS {round(sx['w_before']*100)} → {subject.triggers['X'].suds_equivalent()}"
          f"  (reinstatement!)")
    print(f"\nFinal state:  Trigger X SUDS = {subject.triggers['X'].suds_equivalent()}  (panic attack again)")
    print(f"  γ modifier: {subject.gamma_modifier('X'):.3f}  (Γ nearly as large as initial)")

    print(f"\nFear map: {subject.current_fear_map()}")
    print("=" * 60)


if __name__ == "__main__":
    worked_example()
