"""
Scheduling MCTS for the HTN framework.

The CompanionCoordinator handles immediate dialogue. But the companions also
manage scheduling: follow-up appointments, medication refills, therapy sessions,
procedure pre-authorizations. Each of these has a physiological readiness
dimension that standard calendar-based scheduling ignores.

Key insight: the *right time* to schedule a stressful event is when the patient's
predicted physiological state will be at its most receptive — NOT simply the
earliest available slot.

Factors in the scheduling cost function
----------------------------------------
1. PREDICTED PHYSIOLOGICAL STATE at appointment time
   - Uses OU trajectory forecast from simulator.py
   - Incorporates hysteresis: if the patient just completed intensive therapy,
     their baseline has shifted — a week-later slot may be better than tomorrow.

2. PHARMACOLOGICAL READINESS
   - From pkpd.py: is the patient's medication at therapeutic levels?
   - Metoprolol: avoid peak cardiac stress procedures 8h post-dose (trough)
   - SSRI: avoid psychotherapy during activation phase (week 1-2)
   - Benzodiazepine: never schedule cognitive-demand tasks during peak sedation

3. CIRCADIAN TIMING
   - From state.py: circadian_phase + circadian_entrainment
   - Cortisol peaks 30-60min after waking → most alert, most stress-tolerant
   - Evening: autonomic recovery mode → avoid aversive procedures

4. HYSTERETIC MEMORY
   - After a panic attack or relapse, the hysteretic baseline is elevated.
   - Schedule exposure therapy sessions at intervals that allow partial recovery.
   - Never stack high-intensity sessions back-to-back.

5. MULTI-AGENT COORDINATION
   - Billing team wants to schedule the appeal call immediately.
   - Clinical team wants a follow-up after the next lab results (5 days).
   - Therapy team needs 1 week between sessions for extinction consolidation.
   - MCTS finds the slot that satisfies all constraints.

This module provides a cost-scored slot ranker. Full MCTS (tree search over
sequences of appointments) is Phase 4 work; this implements Phase 1 (greedy
single-appointment scoring).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional


# ── Appointment types and their physiological requirements ────────────────────

@dataclass
class AppointmentType:
    """
    A type of appointment with its physiological requirements.

    Fields
    ------
    name                    : str   — display name
    stress_load             : float — how much stress this appointment induces [0,1]
    min_physio_readiness    : float — minimum stress_index threshold to proceed
                                      (appointments are cancelled / rescheduled if patient
                                       arrives above this stress level)
    ideal_circadian_hour    : float — hour of day when patient performs best [0,24]
    circadian_window_h      : float — acceptable window around ideal_hour
    min_days_from_last_session : float — minimum gap from last therapy session
                                         (extinction consolidation)
    avoid_medication_trough : bool  — avoid scheduling when medication is at trough
    cognitive_demand        : float — [0,1]; high = avoid BZD sedation window
    """
    name:                         str
    stress_load:                  float = 0.3
    min_physio_readiness:         float = 0.60   # proceed only if stress < this
    ideal_circadian_hour:         float = 10.0
    circadian_window_h:           float = 4.0
    min_days_from_last_session:   float = 1.0
    avoid_medication_trough:      bool  = False
    cognitive_demand:             float = 0.5


APPOINTMENT_TYPES: dict[str, AppointmentType] = {
    "billing_call": AppointmentType(
        name                      = "Insurance Appeal Call",
        stress_load               = 0.50,
        min_physio_readiness      = 0.55,
        ideal_circadian_hour      = 10.0,
        circadian_window_h        = 6.0,
        min_days_from_last_session= 0.5,
        avoid_medication_trough   = False,
        cognitive_demand          = 0.4,
    ),
    "psychotherapy": AppointmentType(
        name                      = "Psychotherapy Session",
        stress_load               = 0.40,
        min_physio_readiness      = 0.65,
        ideal_circadian_hour      = 9.0,
        circadian_window_h        = 4.0,
        min_days_from_last_session= 7.0,   # extinction consolidation
        avoid_medication_trough   = False,
        cognitive_demand          = 0.8,
    ),
    "flooding_session": AppointmentType(
        name                      = "Flooding/Exposure Session",
        stress_load               = 0.85,
        min_physio_readiness      = 0.70,   # patient must be calm enough to START
        ideal_circadian_hour      = 10.0,
        circadian_window_h        = 3.0,
        min_days_from_last_session= 7.0,
        avoid_medication_trough   = True,
        cognitive_demand          = 0.5,
    ),
    "medical_procedure": AppointmentType(
        name                      = "Invasive Medical Procedure",
        stress_load               = 0.70,
        min_physio_readiness      = 0.60,
        ideal_circadian_hour      = 8.0,
        circadian_window_h        = 4.0,
        min_days_from_last_session= 1.0,
        avoid_medication_trough   = True,
        cognitive_demand          = 0.3,
    ),
    "medication_review": AppointmentType(
        name                      = "Medication Review",
        stress_load               = 0.20,
        min_physio_readiness      = 0.80,
        ideal_circadian_hour      = 11.0,
        circadian_window_h        = 8.0,
        min_days_from_last_session= 0.0,
        avoid_medication_trough   = False,
        cognitive_demand          = 0.5,
    ),
    "deaddiction_session": AppointmentType(
        name                      = "Addiction Counselling",
        stress_load               = 0.45,
        min_physio_readiness      = 0.65,
        ideal_circadian_hour      = 10.0,
        circadian_window_h        = 5.0,
        min_days_from_last_session= 7.0,
        avoid_medication_trough   = False,
        cognitive_demand          = 0.6,
    ),
}


# ── Subject scheduling context ────────────────────────────────────────────────

@dataclass
class SchedulingContext:
    """
    Everything the scheduling MCTS needs to know about the subject.
    """
    subject_id:              str
    current_stress_index:    float         = 0.4
    current_hrv_ms:          float         = 30.0
    gamma:                   float         = 0.15      # from gamma_from_state
    hysteresis_w_max:        float         = 0.5       # current max trigger fear weight
    last_session_date:       Optional[datetime] = None
    last_session_type:       str           = ""
    ssri_day:                int           = 0         # days since SSRI started (0=not on it)
    bzd_last_dose_h:         float         = 48.0      # hours since last BZD dose
    metoprolol_last_dose_h:  float         = 8.0       # hours since last metoprolol dose
    # Preferred days/hours
    preferred_days:          list[int]     = field(default_factory=lambda: [0,1,2,3,4])  # Mon-Fri
    preferred_hour_start:    float         = 8.0
    preferred_hour_end:      float         = 18.0


# ── Slot scoring ──────────────────────────────────────────────────────────────

@dataclass
class AppointmentSlot:
    """A candidate appointment slot with its cost score."""
    dt:             datetime
    appt_type:      str
    cost:           float = 0.0
    feasible:       bool  = True
    reasons:        list[str] = field(default_factory=list)
    predicted_stress: float = 0.0

    def __lt__(self, other):
        return self.cost < other.cost


def score_slot(
    slot_dt: datetime,
    appt_type_key: str,
    ctx: SchedulingContext,
    now: Optional[datetime] = None,
) -> AppointmentSlot:
    """
    Score one candidate appointment slot.

    Returns an AppointmentSlot with cost in [0, ∞). Lower = better.
    Infeasible slots have cost = ∞ and feasible = False.

    Cost components (each in [0, 1], weighted):
      W1=0.35  physiological_stress at appointment time
      W2=0.25  circadian_mismatch
      W3=0.20  medication_readiness penalty
      W4=0.10  session_gap_penalty
      W5=0.10  hysteresis_load
    """
    if now is None:
        now = datetime.now()

    appt = APPOINTMENT_TYPES.get(appt_type_key)
    if not appt:
        return AppointmentSlot(slot_dt, appt_type_key, cost=float("inf"), feasible=False,
                               reasons=["Unknown appointment type"])

    reasons    = []
    infeasible = False

    # ── Days until appointment ────────────────────────────────────────────────
    days_until = max(0.0, (slot_dt - now).total_seconds() / 86400.0)
    hours_until = days_until * 24

    # ── 1. Predict physiological state at appointment time ────────────────────
    # OU decay: σ_{t+N} ≈ σ_0 × e^{−γ × N_turns}
    # 1 turn ≈ 5 minutes conversation; 1 day ≈ ~24h of passive recovery
    # Between sessions: σ decays toward baseline at γ per turn
    turns_equivalent = days_until * (24 / 0.5)   # approx turns per day at 0.5h/turn
    pred_stress = ctx.current_stress_index * math.exp(-ctx.gamma * min(turns_equivalent, 30))
    # Hysteresis load prevents full recovery for high fear-weight patients
    min_achievable = ctx.hysteresis_w_max * 0.3
    pred_stress = max(min_achievable, pred_stress)

    if pred_stress > appt.min_physio_readiness:
        reasons.append(f"predicted_stress={pred_stress:.3f} exceeds readiness threshold {appt.min_physio_readiness}")
        infeasible = True

    physio_cost = pred_stress

    # ── 2. Circadian mismatch ─────────────────────────────────────────────────
    slot_hour    = slot_dt.hour + slot_dt.minute / 60.0
    hour_diff    = abs(slot_hour - appt.ideal_circadian_hour)
    if hour_diff > 12:
        hour_diff = 24 - hour_diff   # wrap around
    circ_cost = min(1.0, hour_diff / (appt.circadian_window_h * 2))
    if slot_hour < ctx.preferred_hour_start or slot_hour > ctx.preferred_hour_end:
        reasons.append(f"outside preferred hours ({ctx.preferred_hour_start:.0f}h–{ctx.preferred_hour_end:.0f}h)")
        circ_cost = min(1.0, circ_cost + 0.4)

    # ── 3. Medication readiness ───────────────────────────────────────────────
    med_cost = 0.0
    if appt.avoid_medication_trough and ctx.metoprolol_last_dose_h > 0:
        # Trough is ~8-10h post-dose; peak is ~2-4h post-dose
        dose_h_at_appt = ctx.metoprolol_last_dose_h + hours_until
        dose_h_cycle   = dose_h_at_appt % 24.0   # daily dosing
        if 7.0 <= dose_h_cycle <= 11.0:   # trough window
            med_cost += 0.4
            reasons.append("metoprolol at trough — cardiac stress risk")

    if appt.cognitive_demand > 0.6 and ctx.bzd_last_dose_h < 6.0:
        # BZD sedation window
        med_cost += 0.5
        reasons.append("benzodiazepine peak sedation — cognitive demand impaired")
        infeasible = True

    if ctx.ssri_day > 0 and ctx.ssri_day < 14 and appt_type_key == "psychotherapy":
        med_cost += 0.3
        reasons.append(f"SSRI activation phase (day {ctx.ssri_day}/14) — avoid intensive psychotherapy")

    # ── 4. Session gap penalty ────────────────────────────────────────────────
    gap_cost = 0.0
    if ctx.last_session_date and appt_type_key == ctx.last_session_type:
        days_since_last = (slot_dt - ctx.last_session_date).days
        if days_since_last < appt.min_days_from_last_session:
            gap_cost = 1.0
            reasons.append(f"too soon after last session ({days_since_last}d < {appt.min_days_from_last_session}d)")
            infeasible = True
        else:
            gap_cost = max(0.0, 1.0 - days_since_last / (appt.min_days_from_last_session * 3))

    # ── 5. Hysteresis load ────────────────────────────────────────────────────
    hyst_cost = min(1.0, ctx.hysteresis_w_max * appt.stress_load)

    # ── Composite cost ────────────────────────────────────────────────────────
    cost = (
        0.35 * physio_cost
        + 0.25 * circ_cost
        + 0.20 * med_cost
        + 0.10 * gap_cost
        + 0.10 * hyst_cost
    )

    return AppointmentSlot(
        dt               = slot_dt,
        appt_type        = appt.name,
        cost             = cost if not infeasible else float("inf"),
        feasible         = not infeasible,
        reasons          = reasons,
        predicted_stress = round(pred_stress, 4),
    )


def rank_slots(
    appt_type_key: str,
    ctx: SchedulingContext,
    candidate_datetimes: list[datetime],
    now: Optional[datetime] = None,
) -> list[AppointmentSlot]:
    """
    Score and rank candidate slots for one appointment type.
    Returns slots sorted by cost (lowest first).
    """
    slots = [score_slot(dt, appt_type_key, ctx, now) for dt in candidate_datetimes]
    return sorted(slots, key=lambda s: s.cost)


def generate_candidate_slots(
    start: datetime,
    n_days: int = 14,
    hour_step_h: float = 2.0,
    preferred_days: list[int] | None = None,
) -> list[datetime]:
    """
    Generate a grid of candidate slots over the next n_days.
    preferred_days: ISO weekday numbers (0=Mon, 6=Sun).
    """
    if preferred_days is None:
        preferred_days = [0, 1, 2, 3, 4]
    slots = []
    current = start.replace(minute=0, second=0, microsecond=0)
    end     = start + timedelta(days=n_days)
    while current < end:
        if current.weekday() in preferred_days and current > start:
            slots.append(current)
        current += timedelta(hours=hour_step_h)
    return slots


# ── Quick demo ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    now = datetime(2026, 5, 26, 9, 0)   # Monday morning
    ctx = SchedulingContext(
        subject_id           = "marcus_001",
        current_stress_index = 0.62,
        current_hrv_ms       = 16.0,
        gamma                = 0.12,
        hysteresis_w_max     = 0.75,
        last_session_date    = datetime(2026, 5, 20),
        last_session_type    = "psychotherapy",
        ssri_day             = 0,
        bzd_last_dose_h      = 72.0,
        metoprolol_last_dose_h = 3.0,
    )

    for appt_key in ["psychotherapy", "billing_call", "flooding_session"]:
        candidates = generate_candidate_slots(now, n_days=14, preferred_days=[0,1,2,3,4])
        ranked     = rank_slots(appt_key, ctx, candidates, now)
        feasible   = [s for s in ranked if s.feasible]

        appt_name  = APPOINTMENT_TYPES[appt_key].name
        print(f"\n{'='*60}")
        print(f"{appt_name}")
        print(f"{'='*60}")
        if feasible:
            print("  Top 3 recommended slots:")
            for slot in feasible[:3]:
                print(f"    {slot.dt.strftime('%a %Y-%m-%d %H:%M')}  cost={slot.cost:.4f}  "
                      f"predicted_stress={slot.predicted_stress:.3f}"
                      + (f"  [{'; '.join(slot.reasons)}]" if slot.reasons else ""))
        else:
            print("  No feasible slots in next 14 days.")
            print(f"  Closest infeasible: {ranked[0].dt.strftime('%a %Y-%m-%d %H:%M')}  reasons: {ranked[0].reasons}")
