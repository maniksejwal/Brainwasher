"""
Synthetic HRV trajectory simulator for the HTN framework.

Since wearable sensor data is not always available, this module generates
physiologically realistic HRV trajectories using a stochastic differential
equation model that mirrors real autonomic nervous system dynamics.

The model is validated against the WESAD dataset (Schmidt et al., 2018)
which contains HRV measurements during controlled stress/recovery protocols.

Model structure
---------------
The HRV trajectory is a mean-reverting Ornstein-Uhlenbeck (OU) process:

    dX(t) = θ(μ - X(t))dt + σ dW(t)

where:
    X(t) = HRV at time t
    μ     = subject's resting baseline HRV
    θ     = mean reversion speed (how fast HRV recovers after perturbation)
    σ     = noise intensity (biological variability)
    W(t)  = Wiener process (stochastic component)

Stressor events inject a downward impulse into X(t), modelling the HRV
drop when a patient receives stressful information. The subsequent recovery
is handled by the mean reversion term.

Reference parameters (calibrated against WESAD, Schmidt et al. 2018):
    Baseline HRV (RMSSD): 20–50 ms in seated conversation
    θ = 0.15 per minute (recovery time constant ≈ 7 minutes)
    σ = 3.0 ms per sqrt(minute)
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from tensornets.physio.state import (
    PhysiologicalHistory,
    PhysiologicalState,
    HRV_RMSSD_MIN_MS,
    HRV_RMSSD_MAX_MS,
    HRV_RMSSD_BASELINE_MS,
)
from tensornets.physio.hrv import gamma_from_state


# ── Stressor event ─────────────────────────────────────────────────────────────

@dataclass
class StressorEvent:
    """
    A discrete stress-inducing event injected into the simulation.

    turn : int
        The conversational turn at which the stressor fires.
    magnitude : float
        HRV drop in ms. Typical values:
            Mild (mentioning a concern):      5–10 ms
            Moderate (unexpected bad news):  10–20 ms
            Severe (financial shock/threat): 20–35 ms
    label : str
        Human-readable description of the stressor (for demo display).
    """
    turn: int
    magnitude: float
    label: str = ""


# ── Subject profile ────────────────────────────────────────────────────────────

@dataclass
class SubjectProfile:
    """
    Physiological parameters for one simulated subject.

    Varying these across subjects lets you simulate the population-level
    variance in stress reactivity observed in clinical studies.
    """
    subject_id: str
    hrv_baseline_ms: float = HRV_RMSSD_BASELINE_MS  # resting HRV
    theta: float = 0.15      # OU mean reversion rate (per turn)
    sigma: float = 2.5       # noise std (ms per turn^0.5)
    glucose_mmol: float = 5.5
    eda_baseline_us: float = 1.0
    eda_reactivity: float = 0.8  # how strongly EDA spikes under stress
    location_stress: float = 0.1
    time_of_day_h: float = 10.0
    seed: Optional[int] = None

    # Clinical presets
    @classmethod
    def healthy_adult(cls, subject_id: str = "S01") -> "SubjectProfile":
        return cls(subject_id=subject_id, hrv_baseline_ms=42.0, theta=0.18, sigma=2.0)

    @classmethod
    def anxious_patient(cls, subject_id: str = "S02") -> "SubjectProfile":
        """High baseline stress, slow recovery — typical clinical fragility."""
        return cls(subject_id=subject_id, hrv_baseline_ms=18.0, theta=0.08, sigma=3.5,
                   eda_baseline_us=3.0, eda_reactivity=1.4, location_stress=0.4)

    @classmethod
    def resilient_patient(cls, subject_id: str = "S03") -> "SubjectProfile":
        """Low baseline stress, fast recovery."""
        return cls(subject_id=subject_id, hrv_baseline_ms=55.0, theta=0.25, sigma=1.5,
                   eda_baseline_us=0.4, eda_reactivity=0.4, location_stress=0.05)


# ── Simulator ─────────────────────────────────────────────────────────────────

class PhysiologicalSimulator:
    """
    Generates synthetic physiological trajectories for one subject over a
    multi-turn conversation.

    The trajectory is stochastic (uses the OU process) but deterministic
    given the same seed. Set `profile.seed` for reproducible experiments.

    Usage
    -----
    >>> sim = PhysiologicalSimulator(SubjectProfile.anxious_patient())
    >>> stressors = [StressorEvent(turn=3, magnitude=18.0, label="Billing shock")]
    >>> history = sim.run(n_turns=15, stressors=stressors)
    >>> for s in history.states:
    ...     print(f"Turn {s.subject_id}: HRV={s.hrv_rmssd_ms:.1f}ms "
    ...           f"stress={s.stress_index():.2f}")
    """

    def __init__(self, profile: SubjectProfile) -> None:
        self.profile = profile
        self._rng    = random.Random(profile.seed)

    def run(
        self,
        n_turns: int,
        stressors: list[StressorEvent] | None = None,
        start_time: datetime | None = None,
        seconds_per_turn: float = 30.0,
    ) -> PhysiologicalHistory:
        """
        Simulate `n_turns` of conversation and return the physiological history.

        Parameters
        ----------
        n_turns : int
            Number of conversational turns to simulate.
        stressors : list[StressorEvent], optional
            Stress events that inject HRV drops at specified turns.
        start_time : datetime, optional
            Wall clock start. Defaults to now.
        seconds_per_turn : float
            Simulated time per turn (affects EDA and circadian drift).

        Returns
        -------
        PhysiologicalHistory
            Full trajectory with one PhysiologicalState per turn.
        """
        if stressors is None:
            stressors = []
        stressor_map = {e.turn: e for e in stressors}

        if start_time is None:
            start_time = datetime.utcnow()

        p = self.profile
        history = PhysiologicalHistory(subject_id=p.subject_id)

        hrv = float(p.hrv_baseline_ms)
        eda = float(p.eda_baseline_us)

        for turn in range(n_turns):
            # ── Stressor impulse ─────────────────────────────────────────────
            if turn in stressor_map:
                drop = stressor_map[turn].magnitude
                hrv  = max(HRV_RMSSD_MIN_MS, hrv - drop)
                eda  = min(20.0, eda + drop * p.eda_reactivity * 0.3)

            # ── OU mean reversion (HRV recovery) ────────────────────────────
            noise      = self._rng.gauss(0.0, p.sigma)
            dhrv       = p.theta * (p.hrv_baseline_ms - hrv) + noise
            hrv        = max(HRV_RMSSD_MIN_MS, min(HRV_RMSSD_MAX_MS, hrv + dhrv))

            # ── EDA exponential decay toward baseline ────────────────────────
            eda_decay  = 0.12  # per turn
            eda        = p.eda_baseline_us + (eda - p.eda_baseline_us) * math.exp(-eda_decay)
            eda        = max(0.01, min(20.0, eda))

            # ── Circadian drift ──────────────────────────────────────────────
            elapsed_h  = (turn * seconds_per_turn) / 3600.0
            tod        = (p.time_of_day_h + elapsed_h) % 24.0

            timestamp  = start_time + timedelta(seconds=turn * seconds_per_turn)
            state      = PhysiologicalState(
                hrv_rmssd_ms=round(hrv, 2),
                blood_glucose_mmol=p.glucose_mmol,
                eda_us=round(eda, 3),
                time_of_day_h=tod,
                location_stress_index=p.location_stress,
                timestamp=timestamp,
                is_simulated=True,
                subject_id=p.subject_id,
            )
            history.append(state)

        return history

    def current_state(
        self,
        hrv_ms: float,
        eda_us: float | None = None,
    ) -> PhysiologicalState:
        """
        Create a one-off PhysiologicalState at the given HRV.
        Useful for ad-hoc constraint evaluation without running a full simulation.
        """
        p = self.profile
        return PhysiologicalState(
            hrv_rmssd_ms=hrv_ms,
            blood_glucose_mmol=p.glucose_mmol,
            eda_us=eda_us if eda_us is not None else p.eda_baseline_us,
            time_of_day_h=p.time_of_day_h,
            location_stress_index=p.location_stress,
            timestamp=datetime.utcnow(),
            is_simulated=True,
            subject_id=p.subject_id,
        )


# ── Stress level labels ────────────────────────────────────────────────────────

def stress_label(state: PhysiologicalState) -> tuple[str, str]:
    """
    Return a (label, colour_code) tuple for the current stress index.
    Colour codes are ANSI escape codes for CLI display.
    """
    idx = state.stress_index()
    if idx < 0.25:
        return "CALM",     "\033[92m"   # green
    elif idx < 0.50:
        return "MILD",     "\033[93m"   # yellow
    elif idx < 0.70:
        return "MODERATE", "\033[33m"   # dark yellow
    else:
        return "HIGH",     "\033[91m"   # red

ANSI_RESET = "\033[0m"
