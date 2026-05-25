"""
Physiological state representation for the HTN framework.

The physiological subspace of the MPS bond dimension is driven by this state.
All signals are normalized to [0, 1] before being encoded into the tensor.

Signal inventory (8 dimensions → chi_physio >= 8):
  1. HRV (RMSSD)           — acute ANS arousal / stress
  2. Blood glucose          — cognitive energy availability
  3. EDA                    — sympathetic activation intensity
  4. Circadian phase        — diurnal cortisol cycle (derived from time_of_day_h)
  5. Location stress index  — environmental prior
  6. Sleep deficit          — cumulative sleep debt (hours below target)
  7. Circadian entrainment  — how well-aligned the subject is to their own rhythm
  8. Respiratory rate       — fast-acting autonomic indicator

Measuring sleep deficit in practice
------------------------------------
Without a wearable: ask the patient. "How many hours did you sleep last night?
And in the 2 nights before that?" → compute rolling 3-night deficit.
With a wearable (Garmin, Fitbit, Apple Watch, Oura): sync their sleep API.
Proxy signal (no sensor at all): if conversation is at 08:00 and HRV is
low AND EDA is high, a sleep-deprived pattern is statistically likely.
We encode this as `sleep_hours_last_night` and derive deficit from subject
target (default 8h for adults, 9h for under-25s).

References
----------
- Shaffer & Ginsberg (2017). HRV metrics. Front. Public Health 5:258.
- ADA (2024). Standards of Medical Care in Diabetes. Diabetes Care 47(Suppl 1).
- Lim & Dinges (2010). Sleep deprivation and vigilant attention. Ann. NY Acad. Sci.
- Touitou et al. (2017). Disruption of adolescents' circadian clock. J. Physiol. Paris.
- Berntson et al. (1997). Autonomic nervous system. Psychophysiology 34:623-648.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ── Reference ranges (clinical literature) ────────────────────────────────────

# HRV (RMSSD): Shaffer & Ginsberg (2017)
HRV_RMSSD_MIN_MS      = 5.0
HRV_RMSSD_MAX_MS      = 120.0
HRV_RMSSD_BASELINE_MS = 35.0

# Blood glucose (mmol/L): ADA 2024
GLUCOSE_HYPOGLYCAEMIA  = 3.9
GLUCOSE_NORMAL_LOW     = 4.0
GLUCOSE_NORMAL_HIGH    = 7.8
GLUCOSE_HYPERGLYCAEMIA = 10.0

# EDA (µS): WESAD dataset
EDA_MIN_US = 0.01
EDA_MAX_US = 20.0

# Circadian: cortisol peaks ~08:00, troughs ~02:00–04:00 (Touitou 2017)
CIRCADIAN_PEAK_HOUR   = 8.0
CIRCADIAN_TROUGH_HOUR = 3.0

# Sleep: Hirshkowitz et al. (2015) NSF recommendations
SLEEP_TARGET_HOURS_ADULT = 8.0
SLEEP_MIN_HOURS          = 3.0   # below this → severe impairment floor
SLEEP_MAX_DEFICIT_HOURS  = 5.0   # cap for normalization (3h sleep = max deficit)

# Respiratory rate (breaths/min): Cretikos et al. (2008), normal 12–20
RESP_RATE_MIN = 8.0
RESP_RATE_MAX = 30.0
RESP_RATE_NORMAL_LOW  = 12.0
RESP_RATE_NORMAL_HIGH = 20.0


@dataclass
class PhysiologicalState:
    """
    A single snapshot of a user's physiological and contextual state.

    All raw signals are stored at native units. Call `.to_vector()` to get
    the normalized [0, 1] vector encoded into the MPS physio subspace.

    Parameters
    ----------
    hrv_rmssd_ms : float
        Root mean square of successive RR-interval differences (ms).
        Proxy for acute ANS arousal / stress. Lower = more stressed.
    blood_glucose_mmol : float
        Blood glucose concentration (mmol/L).
        Proxy for cognitive energy availability.
    eda_us : float
        Electrodermal activity (skin conductance) in microsiemens.
        Proxy for sympathetic activation intensity.
    time_of_day_h : float
        Local clock time as a float in [0, 24).
        Used to compute circadian cortisol phase offset.
    location_stress_index : float
        Contextual prior on environmental stress, in [0, 1].
        0 = maximally calm, 1 = maximally stressful.
    sleep_hours_last_night : float
        Actual sleep duration last night in hours.
        Normal adult target: 8h. Anything below 6h contributes stress.
        Measurement options:
          - Wearable API (Garmin/Fitbit/Oura/Apple Health)
          - Self-report at session start ("How did you sleep?")
          - Proxy: if not available, use subject's population mean (default 7h)
    sleep_deficit_hours : float
        Cumulative sleep debt over the past 3 nights (hours below target).
        0 = no deficit. Cap at SLEEP_MAX_DEFICIT_HOURS for normalization.
        Derived: sum(max(0, target - actual) for last 3 nights).
        This separates a single bad night from chronic sleep deprivation.
    circadian_entrainment : float
        How well-aligned the subject is to their own chronotype, in [0, 1].
        1 = fully entrained (consistent sleep/wake times, good zeitgeber).
        0 = severely disrupted (shift work, jet lag, irregular schedule).
        Estimated from:
          - Variance of reported wake times across past 7 days
          - Social jet lag metric (weekday vs weekend sleep phase difference)
          - Proxy when unavailable: assume 0.7 (mild modern schedule drift)
    respiratory_rate_bpm : float
        Breathing rate in breaths per minute (12–20 normal).
        Rapid breathing (tachypnea, > 20) amplifies sympathetic tone.
        Slow breathing (< 12) may indicate sedation or over-relaxation.
        Measured by: wearable, clinical pulse oximeter, or video-based
        respiratory rate estimation (if camera available).
    timestamp : datetime
        Wall-clock time of measurement.
    is_simulated : bool
        True if synthetically generated (simulator or WESAD).
    subject_id : str, optional
        Anonymised subject identifier for multi-subject benchmarking.
    """

    hrv_rmssd_ms:          float
    blood_glucose_mmol:    float
    eda_us:                float
    time_of_day_h:         float
    location_stress_index: float

    # New signals — default to typical resting values so existing code compiles
    sleep_hours_last_night: float = 7.0
    sleep_deficit_hours:    float = 1.0
    circadian_entrainment:  float = 0.7
    respiratory_rate_bpm:   float = 15.0

    timestamp:    datetime       = field(default_factory=datetime.utcnow)
    is_simulated: bool           = True
    subject_id:   Optional[str]  = None

    # ── Validation ─────────────────────────────────────────────────────────────

    def __post_init__(self) -> None:
        if not (HRV_RMSSD_MIN_MS <= self.hrv_rmssd_ms <= HRV_RMSSD_MAX_MS):
            raise ValueError(
                f"hrv_rmssd_ms={self.hrv_rmssd_ms} outside physiological range "
                f"[{HRV_RMSSD_MIN_MS}, {HRV_RMSSD_MAX_MS}] ms"
            )
        if not (GLUCOSE_HYPOGLYCAEMIA - 1.0 <= self.blood_glucose_mmol <= 30.0):
            raise ValueError(
                f"blood_glucose_mmol={self.blood_glucose_mmol} outside plausible range"
            )
        if not (EDA_MIN_US <= self.eda_us <= EDA_MAX_US):
            raise ValueError(
                f"eda_us={self.eda_us} outside plausible range [{EDA_MIN_US}, {EDA_MAX_US}] µS"
            )
        if not (0.0 <= self.time_of_day_h < 24.0):
            raise ValueError(f"time_of_day_h={self.time_of_day_h} must be in [0, 24)")
        if not (0.0 <= self.location_stress_index <= 1.0):
            raise ValueError(f"location_stress_index must be in [0, 1]")
        if not (SLEEP_MIN_HOURS <= self.sleep_hours_last_night <= 24.0):
            raise ValueError(
                f"sleep_hours_last_night={self.sleep_hours_last_night} outside "
                f"[{SLEEP_MIN_HOURS}, 24]"
            )
        if not (0.0 <= self.sleep_deficit_hours <= SLEEP_MAX_DEFICIT_HOURS * 3):
            raise ValueError(f"sleep_deficit_hours must be in [0, {SLEEP_MAX_DEFICIT_HOURS * 3}]")
        if not (0.0 <= self.circadian_entrainment <= 1.0):
            raise ValueError(f"circadian_entrainment must be in [0, 1]")
        if not (RESP_RATE_MIN <= self.respiratory_rate_bpm <= RESP_RATE_MAX):
            raise ValueError(
                f"respiratory_rate_bpm={self.respiratory_rate_bpm} outside "
                f"[{RESP_RATE_MIN}, {RESP_RATE_MAX}]"
            )

    # ── Normalisation ──────────────────────────────────────────────────────────

    def hrv_normalized(self) -> float:
        """HRV normalized to [0, 1] where 1 = maximally calm (log-scale)."""
        log_val = math.log(max(self.hrv_rmssd_ms, HRV_RMSSD_MIN_MS))
        log_min = math.log(HRV_RMSSD_MIN_MS)
        log_max = math.log(HRV_RMSSD_MAX_MS)
        return (log_val - log_min) / (log_max - log_min)

    def glucose_normalized(self) -> float:
        """Glucose normalized to [0, 1] where 1 = optimal range (bell-shaped)."""
        g   = self.blood_glucose_mmol
        mid = (GLUCOSE_NORMAL_LOW + GLUCOSE_NORMAL_HIGH) / 2.0
        width = (GLUCOSE_NORMAL_HIGH - GLUCOSE_NORMAL_LOW) / 2.0
        return max(0.0, 1.0 - abs(g - mid) / (width * 2.0))

    def eda_normalized(self) -> float:
        """EDA normalized to [0, 1] where 0 = calm, 1 = high sympathetic activation."""
        return (self.eda_us - EDA_MIN_US) / (EDA_MAX_US - EDA_MIN_US)

    def circadian_phase(self) -> float:
        """
        Circadian cortisol phase in [0, 1] where 1 = cortisol peak (08:00).
        Models the diurnal cortisol curve as a cosine with period 24h.

        This is independent of whether the subject is entrained — it gives the
        population-average cortisol level at this time of day. Use
        `circadian_entrainment` to scale how much this phase actually affects
        the subject (a shift worker may not have a cortisol peak at 08:00).
        """
        phase_rad = 2 * math.pi * (self.time_of_day_h - CIRCADIAN_PEAK_HOUR) / 24.0
        return (1.0 + math.cos(phase_rad)) / 2.0

    def sleep_pressure(self) -> float:
        """
        Combined sleep-driven stress signal in [0, 1].

        Combines acute deficit (last night) with chronic debt (3-night rolling)
        and modulates by circadian entrainment. A well-entrained person handles
        a single bad night better than a chronically disrupted person.

        Formula:
          acute  = max(0, target - last_night) / target
          chronic = min(deficit, 3 * target) / (3 * SLEEP_MAX_DEFICIT)
          pressure = (0.6 * acute + 0.4 * chronic) * (2.0 - entrainment)
          clamped to [0, 1]

        The (2.0 - entrainment) multiplier means:
          - Fully entrained (1.0): multiplier = 1.0 — normal effect
          - Zero entrainment (0.0): multiplier = 2.0 — dysregulated, every sleep
            deficit hits harder because the homeostatic system is already impaired
        """
        acute   = max(0.0, SLEEP_TARGET_HOURS_ADULT - self.sleep_hours_last_night) / SLEEP_TARGET_HOURS_ADULT
        chronic = min(self.sleep_deficit_hours, SLEEP_MAX_DEFICIT_HOURS) / SLEEP_MAX_DEFICIT_HOURS
        raw     = 0.6 * acute + 0.4 * chronic
        modulated = raw * (2.0 - self.circadian_entrainment)
        return min(1.0, max(0.0, modulated))

    def respiratory_normalized(self) -> float:
        """
        Respiratory rate normalized to [0, 1] where 0 = calm, 1 = stressed.

        Tachypnea (> 20 bpm) → high stress. Eupnea (12–20) → low.
        Bradypnea (< 12) is rare awake; treated as mild sedation (low stress).
        """
        rr = self.respiratory_rate_bpm
        if RESP_RATE_NORMAL_LOW <= rr <= RESP_RATE_NORMAL_HIGH:
            return 0.0
        if rr > RESP_RATE_NORMAL_HIGH:
            return min(1.0, (rr - RESP_RATE_NORMAL_HIGH) / (RESP_RATE_MAX - RESP_RATE_NORMAL_HIGH))
        # Bradypnea: very slight signal (< 0.15)
        return max(0.0, 0.15 * (RESP_RATE_NORMAL_LOW - rr) / (RESP_RATE_NORMAL_LOW - RESP_RATE_MIN))

    def stress_index(self) -> float:
        """
        Composite acute stress index in [0, 1].

        Drives the Γ matrix amplitude in the non-Hermitian operator.
        Higher = more stressed = slower recovery = larger |λ₁|.

        Weights (8 signals → 1 scalar):
          HRV (inverted)           : 0.35  — primary ANS signal
          EDA                      : 0.20  — sympathetic burst
          Sleep pressure           : 0.15  — cumulative fatigue + chronodisruption
          Glucose (inverted)       : 0.12  — cognitive resource availability
          Circadian (modulated)    : 0.08  — diurnal cortisol × entrainment
          Respiratory rate         : 0.05  — fast sympathetic readout
          Location                 : 0.05  — environmental prior

        Note: Weights sum to 1.00. Sleep pressure subsumes both acute deficit
        and circadian entrainment into a single modulated signal to avoid
        double-counting the circadian component.
        """
        circadian_modulated = self.circadian_phase() * self.circadian_entrainment
        return (
            0.35 * (1.0 - self.hrv_normalized())
            + 0.20 * self.eda_normalized()
            + 0.15 * self.sleep_pressure()
            + 0.12 * (1.0 - self.glucose_normalized())
            + 0.08 * circadian_modulated
            + 0.05 * self.respiratory_normalized()
            + 0.05 * self.location_stress_index
        )

    def to_vector(self) -> list[float]:
        """
        8-dimensional normalized feature vector for encoding into the MPS
        physiological subspace. All values in [0, 1].

        Order matches chi_physio index layout:
          [0] hrv_norm           — ANS arousal
          [1] glucose_norm       — cognitive energy
          [2] eda_norm           — sympathetic activation
          [3] circadian_phase    — diurnal cortisol (population average)
          [4] location_stress    — environmental prior
          [5] sleep_pressure     — fatigue + chronodisruption
          [6] entrainment        — circadian alignment (1 = well-aligned)
          [7] respiratory_norm   — breathing rate stress signal
        """
        return [
            self.hrv_normalized(),
            self.glucose_normalized(),
            self.eda_normalized(),
            self.circadian_phase(),
            self.location_stress_index,
            self.sleep_pressure(),
            self.circadian_entrainment,
            self.respiratory_normalized(),
        ]

    def __repr__(self) -> str:
        return (
            f"PhysiologicalState("
            f"hrv={self.hrv_rmssd_ms:.1f}ms, "
            f"glucose={self.blood_glucose_mmol:.1f}mmol/L, "
            f"eda={self.eda_us:.2f}µS, "
            f"sleep={self.sleep_hours_last_night:.1f}h(def={self.sleep_deficit_hours:.1f}h), "
            f"rr={self.respiratory_rate_bpm:.0f}bpm, "
            f"stress={self.stress_index():.3f})"
        )


@dataclass
class PhysiologicalHistory:
    """
    Time-ordered sequence of PhysiologicalState snapshots for one subject.

    This is the 'biological memory' record — the sequence that drives
    eigenvalue decay estimation and hysteresis duration calculation.
    """

    subject_id: str
    states: list[PhysiologicalState] = field(default_factory=list)

    def append(self, state: PhysiologicalState) -> None:
        if self.states and state.timestamp <= self.states[-1].timestamp:
            raise ValueError("States must be appended in chronological order.")
        self.states.append(state)

    def stress_trajectory(self) -> list[float]:
        """Stress index over time as a list."""
        return [s.stress_index() for s in self.states]

    def hrv_trajectory(self) -> list[float]:
        return [s.hrv_rmssd_ms for s in self.states]

    def sleep_pressure_trajectory(self) -> list[float]:
        return [s.sleep_pressure() for s in self.states]

    def duration_seconds(self) -> float:
        if len(self.states) < 2:
            return 0.0
        return (self.states[-1].timestamp - self.states[0].timestamp).total_seconds()

    @staticmethod
    def compute_sleep_deficit(
        sleep_nights: list[float],
        target_hours: float = SLEEP_TARGET_HOURS_ADULT,
    ) -> float:
        """
        Compute the rolling sleep deficit from a list of nightly sleep hours.

        Use the last 3 nights only (acute chronic debt window).
        Returns cumulative deficit in hours, capped at 3 × SLEEP_MAX_DEFICIT.

        Example:
            history.compute_sleep_deficit([6.0, 5.5, 7.0])
            → max(0, 8-6) + max(0, 8-5.5) + max(0, 8-7) = 2 + 2.5 + 1 = 5.5h
        """
        nights = sleep_nights[-3:]
        deficit = sum(max(0.0, target_hours - h) for h in nights)
        return min(deficit, SLEEP_MAX_DEFICIT_HOURS * 3)

    def __len__(self) -> int:
        return len(self.states)

    # ── Persistence ─────────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        """Serialise to a plain dict suitable for json.dump."""
        return {
            "subject_id": self.subject_id,
            "states": [
                {
                    "hrv_rmssd_ms":           s.hrv_rmssd_ms,
                    "blood_glucose_mmol":     s.blood_glucose_mmol,
                    "eda_us":                 s.eda_us,
                    "time_of_day_h":          s.time_of_day_h,
                    "location_stress_index":  s.location_stress_index,
                    "sleep_hours_last_night": s.sleep_hours_last_night,
                    "sleep_deficit_hours":    s.sleep_deficit_hours,
                    "circadian_entrainment":  s.circadian_entrainment,
                    "respiratory_rate_bpm":   s.respiratory_rate_bpm,
                    "timestamp":              s.timestamp.isoformat(),
                    "is_simulated":           s.is_simulated,
                    "subject_id":             s.subject_id,
                }
                for s in self.states
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PhysiologicalHistory":
        """Deserialise from the dict produced by to_dict()."""
        hist = cls(subject_id=data["subject_id"])
        for row in data.get("states", []):
            state = PhysiologicalState(
                hrv_rmssd_ms=row["hrv_rmssd_ms"],
                blood_glucose_mmol=row["blood_glucose_mmol"],
                eda_us=row["eda_us"],
                time_of_day_h=row["time_of_day_h"],
                location_stress_index=row["location_stress_index"],
                sleep_hours_last_night=row.get("sleep_hours_last_night", 7.0),
                sleep_deficit_hours=row.get("sleep_deficit_hours", 1.0),
                circadian_entrainment=row.get("circadian_entrainment", 0.7),
                respiratory_rate_bpm=row.get("respiratory_rate_bpm", 15.0),
                timestamp=datetime.fromisoformat(row["timestamp"]),
                is_simulated=row.get("is_simulated", True),
                subject_id=row.get("subject_id"),
            )
            # Bypass chronological guard: states loaded from disk are already sorted
            hist.states.append(state)
        return hist

    def save(self, path: str) -> None:
        """Serialise history to *path* as JSON (atomic write via temp file)."""
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, ensure_ascii=False)
        os.replace(tmp, path)

    @classmethod
    def load(cls, path: str) -> "PhysiologicalHistory":
        """Load a previously saved history from *path*."""
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))


# ── Stress label (mirrors companions/physio/state.js) ─────────────────────────

def stressLabel(idx: float) -> dict:
    """
    Convert a numeric stress_index to a human-readable label and prompt hint.
    Mirrors the JS implementation exactly so both sides produce identical output.
    """
    if idx < 0.25:
        return {
            "label": "calm",
            "promptHint": "The patient appears calm and receptive. Standard conversational tone is appropriate.",
        }
    if idx < 0.45:
        return {
            "label": "mild_stress",
            "promptHint": "Mild stress detected. Use empathetic phrasing; avoid delivering multiple pieces of information at once.",
        }
    if idx < 0.65:
        return {
            "label": "moderate_stress",
            "promptHint": "Moderate stress. Prioritise emotional acknowledgement before any clinical or financial information. Keep sentences short.",
        }
    if idx < 0.80:
        return {
            "label": "high_stress",
            "promptHint": "High physiological stress. Do NOT introduce new clinical decisions, billing disputes, or out-of-pocket costs. Focus on stabilisation.",
        }
    return {
        "label": "critical_stress",
        "promptHint": "Critical stress level. Immediate de-escalation required. Consider escalation to a human clinician. No new information.",
    }


# ── Module-level convenience wrappers (keep server.py import simple) ──────────

def stress_index(state: "PhysiologicalState") -> float:
    """Module-level wrapper around PhysiologicalState.stress_index()."""
    return state.stress_index()


def to_vector(state: "PhysiologicalState") -> list:
    """Module-level wrapper around PhysiologicalState.to_vector()."""
    return state.to_vector()
