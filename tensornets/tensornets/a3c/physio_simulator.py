"""
tensornets.a3c.physio_simulator
================================
Stochastic physiological profile generator for SyntheticParticipant roles.

Rather than hardcoding a single baseline (e.g. hrv_ms=38 everywhere), each
call samples from a per-role, per-context distribution that reflects the
realistic variability of the population we model.

Design rationale
----------------
* Patients in therapeutic/clinical contexts are physiologically stressed.
  Their HRV is suppressed, EDA elevated, sleep deficit non-zero.
* Caregivers carry chronic burden-stress: moderate HRV suppression, higher
  sleep deficit, moderate EDA elevation.
* Clinicians have professional emotional regulation: higher HRV, low EDA,
  minimal sleep deficit during working hours.
* 'family' and 'relative' profiles sit between patient and caregiver.

Distributions chosen
--------------------
HRV (RMSSD, ms):
  Log-normal(μ_log, σ_log) — always positive, right-skewed, matches
  population data (Task Force 1996; Shaffer & Ginsberg 2017).
  Typical healthy adult RMSSD: 20–80 ms, median ~42 ms.

Stress index (0–1):
  Derived from sampled HRV via the monotone mapping used in tensornetsBridge:
    stress = clamp(1 − (hrv − 10) / 60, 0.05, 0.95)
  Plus a scenario-type additive shift sampled from Normal(shift, 0.05).
  Clamped to [0.05, 0.95].

EDA (μS):
  Gamma(shape, scale) — always positive, right-skewed. Resting ~1–5 μS.
  Arousal can push to 20+ μS.

Sleep deficit (hours behind needed sleep):
  Gamma(shape, scale) truncated at 0. Clinicians ~0, caregivers 1–3 h,
  patients 1–2 h with high variance.

Glucose (mg/dL):
  Normal(mean, sd), truncated to [50, 250]. Clinical: 70–100 mg/dL normal,
  HTN patients may have comorbid metabolic syndrome.

Longitudinal dynamics (time-varying, within a session)
-------------------------------------------------------
Call `update_physio(physio, turn_idx, scenario_type)` to advance physio
state across turns. Stress drifts stochastically; HRV is anti-correlated.
EDA spikes on emotionally loaded keywords (injected from the caller).

Usage
-----
    from tensornets.a3c.physio_simulator import PhysioSimulator

    sim = PhysioSimulator(seed=42)          # reproducible for a given ep
    physio = sim.sample(role='patient', scenario_type='crisis')
    # → {"stress_index": 0.71, "hrv_ms": 22, "eda_us": 6.1, ...}

    # Advance state one turn forward (stochastic drift)
    physio = sim.step(physio, emotionally_loaded=True)
"""

from __future__ import annotations

import math
import random
from typing import Literal

__all__ = ["PhysioSimulator", "sample_physio", "step_physio"]

# ---------------------------------------------------------------------------
# Role × Scenario parameter tables
# ---------------------------------------------------------------------------

RoleKey = Literal[
    "patient", "caregiver", "clinician", "doctor",
    "family", "relative", "agent", "unknown",
]

ScenarioTypeKey = Literal[
    "standard", "crisis", "escalation", "hospital",
    "deaddiction", "bereavement", "oncology", "chronic",
    "mental_health", "ethical", "privacy",
]

# HRV log-normal parameters (mu_log, sigma_log) → median = exp(mu_log)
# Derived from population RMSSD data (Shaffer & Ginsberg 2017).
_HRV_LOGNORMAL: dict[RoleKey, tuple[float, float]] = {
    "patient":    (3.35, 0.40),   # median ~28 ms — suppressed, typical chronic patient
    "caregiver":  (3.50, 0.38),   # median ~33 ms — moderate burden
    "clinician":  (3.80, 0.30),   # median ~45 ms — professional regulation
    "doctor":     (3.80, 0.30),   # same as clinician
    "family":     (3.55, 0.40),   # median ~35 ms
    "relative":   (3.55, 0.40),
    "agent":      (3.80, 0.25),   # synthetic / AI — stable
    "unknown":    (3.60, 0.40),   # fallback
}

# Scenario-type HRV shift (additive, in ms — can be negative for acute stress)
# Drawn from Normal(mean_shift, 3.0)
_HRV_SCENARIO_SHIFT: dict[ScenarioTypeKey, float] = {
    "standard":      0.0,
    "crisis":       -12.0,   # acute stress severely suppresses HRV
    "escalation":   -10.0,
    "hospital":      -5.0,
    "deaddiction":   -4.0,   # chronic stress
    "bereavement":   -8.0,
    "oncology":      -6.0,
    "chronic":       -5.0,
    "mental_health": -5.0,
    "ethical":       -2.0,
    "privacy":       -1.0,
}

# EDA Gamma parameters (shape k, scale θ) → mean = k*θ, var = k*θ²
# Resting EDA ~1–5 μS. Crisis can push to 15+ μS.
_EDA_GAMMA: dict[RoleKey, tuple[float, float]] = {
    "patient":   (2.0, 1.8),   # mean ~3.6
    "caregiver": (2.0, 1.5),   # mean ~3.0
    "clinician": (1.5, 1.2),   # mean ~1.8
    "doctor":    (1.5, 1.2),
    "family":    (1.8, 1.5),
    "relative":  (1.8, 1.5),
    "agent":     (1.2, 1.0),
    "unknown":   (1.8, 1.6),
}

_EDA_SCENARIO_MULTIPLIER: dict[ScenarioTypeKey, float] = {
    "standard":      1.0,
    "crisis":        2.5,
    "escalation":    2.0,
    "hospital":      1.5,
    "deaddiction":   1.3,
    "bereavement":   1.8,
    "oncology":      1.5,
    "chronic":       1.3,
    "mental_health": 1.4,
    "ethical":       1.1,
    "privacy":       1.1,
}

# Sleep deficit Gamma parameters (hours behind schedule) — shape, scale
_SLEEP_GAMMA: dict[RoleKey, tuple[float, float]] = {
    "patient":   (1.5, 1.2),   # mean ~1.8 h deficit
    "caregiver": (2.0, 1.3),   # mean ~2.6 h — highest burden
    "clinician": (0.8, 0.8),   # mean ~0.6 h
    "doctor":    (1.0, 0.9),   # mean ~0.9 h — on-call variability
    "family":    (1.2, 1.0),
    "relative":  (1.2, 1.0),
    "agent":     (0.0, 0.0),   # deterministic 0
    "unknown":   (1.0, 1.0),
}

# Glucose Normal parameters (mean, sd) in mg/dL — truncated [50, 250]
_GLUCOSE_NORMAL: dict[RoleKey, tuple[float, float]] = {
    "patient":   (96.0, 12.0),   # slight hyperglycaemia risk
    "caregiver": (88.0,  9.0),
    "clinician": (85.0,  8.0),
    "doctor":    (87.0,  9.0),
    "family":    (88.0, 10.0),
    "relative":  (88.0, 10.0),
    "agent":     (90.0,  5.0),
    "unknown":   (90.0, 12.0),
}

# Scenario-type glucose shift in mg/dL — sampled from Normal(shift, 5)
_GLUCOSE_SCENARIO_SHIFT: dict[ScenarioTypeKey, float] = {
    "standard":      0.0,
    "crisis":        8.0,   # acute stress → cortisol → glucose spike
    "escalation":    6.0,
    "hospital":      5.0,
    "deaddiction":   3.0,
    "bereavement":   4.0,
    "oncology":     10.0,   # higher if on corticosteroids
    "chronic":       5.0,
    "mental_health": 3.0,
    "ethical":       0.0,
    "privacy":       0.0,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _lognormal(mu_log: float, sigma_log: float, rng: random.Random) -> float:
    """Sample from LogNormal(mu_log, sigma_log)."""
    return math.exp(rng.gauss(mu_log, sigma_log))


def _gamma(shape: float, scale: float, rng: random.Random) -> float:
    """Sample from Gamma(shape, scale) using Marsaglia-Tsang (via stdlib)."""
    if shape <= 0 or scale <= 0:
        return 0.0
    return rng.gammavariate(shape, scale)


def _truncated_normal(mean: float, sd: float, lo: float, hi: float,
                      rng: random.Random) -> float:
    """Sample Normal, reject-until-in-range (safe for tight bounds)."""
    for _ in range(200):
        v = rng.gauss(mean, sd)
        if lo <= v <= hi:
            return v
    return float(max(lo, min(hi, mean)))


def _stress_from_hrv(hrv_ms: float) -> float:
    """
    Monotone stress proxy matching the formula in tensornetsBridge.js:
        stress = clamp(1 − (hrv − 10) / 60, 0.05, 0.95)
    """
    raw = 1.0 - (hrv_ms - 10.0) / 60.0
    return round(max(0.05, min(0.95, raw)), 4)


def _scenario_type_from_id(scenario_id: str) -> ScenarioTypeKey:
    """
    Infer scenario type from scenario_id string heuristics.
    This is a best-effort mapping; callers can override by passing scenario_type.
    """
    sid = (scenario_id or "").lower()
    if any(k in sid for k in ("crisis", "emergency", "overdose", "suicide")):
        return "crisis"
    if any(k in sid for k in ("escalat",)):
        return "escalation"
    if any(k in sid for k in ("ipd", "hospital", "inpatient", "ward")):
        return "hospital"
    if any(k in sid for k in ("deaddiction", "alcohol", "opioid", "substance")):
        return "deaddiction"
    if any(k in sid for k in ("bereave", "grief", "loss", "bereavement")):
        return "bereavement"
    if any(k in sid for k in ("cancer", "oncol", "chemotherapy", "palliative")):
        return "oncology"
    if any(k in sid for k in ("chronic", "htn", "hypertension", "diabetes")):
        return "chronic"
    if any(k in sid for k in ("mental", "depression", "anxiety", "ptsd", "bipolar")):
        return "mental_health"
    if any(k in sid for k in ("ethics", "ethical", "consent", "autonomy")):
        return "ethical"
    if any(k in sid for k in ("privacy", "disclosure", "confidential")):
        return "privacy"
    return "standard"


# ---------------------------------------------------------------------------
# Core class
# ---------------------------------------------------------------------------

class PhysioSimulator:
    """
    Per-episode physiological state sampler with longitudinal step dynamics.

    Parameters
    ----------
    seed : int or None
        If provided, the internal RNG is seeded for reproducibility within
        a single episode.  Pass None for true randomness across episodes.
    """

    def __init__(self, seed: int | None = None) -> None:
        self._rng = random.Random(seed)

    # ── Initial state sampling ───────────────────────────────────────────────

    def sample(
        self,
        role: str = "patient",
        scenario_type: str | None = None,
        scenario_id: str | None = None,
    ) -> dict:
        """
        Sample an initial physiological state vector for one participant.

        Parameters
        ----------
        role          : One of patient / caregiver / clinician / doctor /
                        family / relative / agent / unknown.
        scenario_type : Override for scenario context (see ScenarioTypeKey).
                        If omitted, inferred from scenario_id if provided,
                        else defaults to 'standard'.
        scenario_id   : Scenario string id used for automatic type inference
                        when scenario_type is not given.

        Returns
        -------
        dict with keys: stress_index, hrv_ms, eda_us, sleep_deficit, glucose_mg_dl
        """
        role_key: RoleKey = role if role in _HRV_LOGNORMAL else "unknown"

        if scenario_type is None:
            scenario_type = _scenario_type_from_id(scenario_id or "")
        sc_key: ScenarioTypeKey = (
            scenario_type if scenario_type in _HRV_SCENARIO_SHIFT else "standard"
        )

        # ── HRV ──────────────────────────────────────────────────────────────
        mu_log, sigma_log = _HRV_LOGNORMAL[role_key]
        hrv_base = _lognormal(mu_log, sigma_log, self._rng)
        shift_mean = _HRV_SCENARIO_SHIFT[sc_key]
        hrv_shift = self._rng.gauss(shift_mean, 3.0)
        hrv_ms = round(max(8.0, hrv_base + hrv_shift), 1)

        # ── Stress index (derived from HRV + small jitter) ───────────────────
        stress_base = _stress_from_hrv(hrv_ms)
        stress_jitter = self._rng.gauss(0.0, 0.04)
        stress_index = round(max(0.05, min(0.95, stress_base + stress_jitter)), 4)

        # ── EDA ──────────────────────────────────────────────────────────────
        k_eda, theta_eda = _EDA_GAMMA[role_key]
        eda_base = _gamma(k_eda, theta_eda, self._rng)
        eda_multiplier = _EDA_SCENARIO_MULTIPLIER[sc_key]
        # Add a small Gaussian on the multiplied value for run-to-run variability
        eda_us = round(max(0.5, eda_base * eda_multiplier +
                           self._rng.gauss(0.0, 0.5)), 2)

        # ── Sleep deficit ────────────────────────────────────────────────────
        k_sl, theta_sl = _SLEEP_GAMMA[role_key]
        sleep_deficit = round(max(0.0, _gamma(k_sl, theta_sl, self._rng)), 1)

        # ── Glucose ──────────────────────────────────────────────────────────
        mu_g, sigma_g = _GLUCOSE_NORMAL[role_key]
        shift_g_mean = _GLUCOSE_SCENARIO_SHIFT[sc_key]
        shift_g = self._rng.gauss(shift_g_mean, 5.0)
        glucose_mg_dl = round(
            _truncated_normal(mu_g + shift_g, sigma_g, 50.0, 250.0, self._rng), 1
        )

        return {
            "stress_index":    stress_index,
            "hrv_ms":          hrv_ms,
            "eda_us":          eda_us,
            "sleep_deficit":   sleep_deficit,
            "glucose_mg_dl":   glucose_mg_dl,
            # False = values are population-sampled estimates, not real sensor readings.
            # Production code should check this flag before using physio for MCTS
            # decisions — "no data" is not the same as "normal readings".
            "_sensor_present": False,
        }

    def sample_for_scenario(self, scenario: dict) -> dict:
        """
        Convenience: sample physio for the primary participant of a scenario dict.
        Uses scenario_id for type inference and role from scenario.users[0].role.
        """
        users = scenario.get("users", [{}])
        role = users[0].get("role", "patient") if users else "patient"
        return self.sample(
            role=role,
            scenario_id=scenario.get("scenario_id", ""),
        )

    def sample_all_roles(self, scenario: dict) -> list[dict]:
        """
        Sample a physio dict for every participant in scenario.users[].
        Returns a list parallel to scenario['users'].
        """
        users = scenario.get("users", [{"role": "patient"}])
        result = []
        for user in users:
            role = user.get("role", "unknown")
            result.append(self.sample(
                role=role,
                scenario_id=scenario.get("scenario_id", ""),
            ))
        return result

    # ── Longitudinal step (within-episode dynamics) ──────────────────────────

    def step(self, physio: dict, emotionally_loaded: bool = False,
             social_gamma: float = 0.0) -> dict:
        """
        Advance physiological state by one conversational turn.

        Dynamics:
        - Stress performs a mean-reverting random walk (Ornstein-Uhlenbeck)
          around the current level, with emotionally_loaded boosting volatility.
        - HRV is updated as the inverse of stress to maintain correlation.
        - EDA spikes on emotionally loaded turns.
        - Sleep deficit and glucose drift slowly.

        Parameters
        ----------
        physio           : Current state dict (from prior turn or sample()).
        emotionally_loaded : True if the turn contains distress/crisis keywords.
        social_gamma     : SA2.1 additive modifier from social_Gamma_modifier().
                           Δγ < 0 → alliance buffers stress (faster recovery).
                           Δγ > 0 → rupture/panic amplifies stress reactivity.
                           Passed in by arms that have access to AllianceGraph.

        Returns
        -------
        Updated physio dict (new object, does not mutate input).
        """
        rng = self._rng
        p = dict(physio)

        # Mean-reverting stress (OU process)
        # θ: reversion speed, σ: volatility
        theta = 0.08          # slow reversion — therapeutic sessions are not quick
        sigma_stress = 0.04 if not emotionally_loaded else 0.10
        mean_stress = p.get("stress_index", 0.5)
        long_run_mean = 0.5   # physiological homeostasis

        # SA2.4: apply social_gamma to θ so alliance quality scales reversion speed.
        # Positive social_gamma (rupture) slows recovery; negative (alliance) speeds it.
        effective_theta = max(0.02, theta - social_gamma)

        new_stress = mean_stress + effective_theta * (long_run_mean - mean_stress) + \
                     rng.gauss(0.0, sigma_stress)
        new_stress = round(max(0.05, min(0.95, new_stress)), 4)

        # HRV tracks stress inversely via the same clamp formula
        # Invert: hrv = 10 + (1 - stress) * 60
        new_hrv = round(max(8.0, 10.0 + (1.0 - new_stress) * 60.0 +
                           rng.gauss(0.0, 2.5)), 1)

        # EDA: mean-revert with spike on emotional load
        eda_current = p.get("eda_us", 3.0)
        eda_spike = rng.uniform(1.5, 4.0) if emotionally_loaded else 0.0
        new_eda = round(max(0.5, eda_current * 0.92 + eda_spike +
                            rng.gauss(0.0, 0.3)), 2)

        # Glucose: slow drift ±2 mg/dL per turn (meal/cortisol effects negligible)
        glucose_current = p.get("glucose_mg_dl", 90.0)
        new_glucose = round(
            max(50.0, min(250.0, glucose_current + rng.gauss(0.0, 1.5))), 1
        )

        # Sleep deficit stays constant within a session (updated inter-session)
        return {
            "stress_index":  new_stress,
            "hrv_ms":        new_hrv,
            "eda_us":        new_eda,
            "sleep_deficit": p.get("sleep_deficit", 0.0),
            "glucose_mg_dl": new_glucose,
        }


# ---------------------------------------------------------------------------
# Module-level convenience functions (stateless, fresh RNG each call)
# ---------------------------------------------------------------------------

def sample_physio(
    role: str = "patient",
    scenario_type: str | None = None,
    scenario_id: str | None = None,
    seed: int | None = None,
) -> dict:
    """
    One-shot stateless sampler.  Creates a PhysioSimulator internally.
    Use PhysioSimulator directly when you need longitudinal step() calls.
    """
    return PhysioSimulator(seed=seed).sample(
        role=role,
        scenario_type=scenario_type,
        scenario_id=scenario_id,
    )


def physio_from_narrative(narrative: str, role: str = "patient", scenario_id: str = "") -> dict:
    """
    Derive a plausible physiological profile from a free-text scenario description.

    The narrative is parsed for keyword cues that shift the base distributions
    from PhysioSimulator.  This lets scenario authors write human-readable
    descriptions instead of hand-tuning numeric vectors.

    Examples of recognised cues (case-insensitive):
      sleep  : "sleep-deprived", "5h sleep", "poor sleep"    → elevated sleep_deficit
      stress : "chronic stress", "work stress", "anxious"     → elevated stress_index
      calm   : "calm", "relaxed", "meditative"                → reduced stress_index
      hrv    : "elevated HR", "high resting HR", "bradycardia"→ adjust hrv_ms
      glucose: "diabetic", "hypoglycaemic", "high glucose"    → adjust glucose_mg_dl

    Falls back to standard population sample when no cues are found.
    """
    import re
    n = narrative.lower()

    # Keyword → (field, delta_fraction_of_range)
    CUES: list[tuple[str, str, float]] = [
        # sleep deprivation
        (r"sleep.dep|poor sleep|insomni|5h sleep|4h sleep|6h sleep", "sleep_deficit", +0.4),
        (r"well.rest|good sleep|8h sleep|9h sleep",                   "sleep_deficit", -0.3),
        # stress / anxiety
        (r"chronic stress|high stress|work stress|anxious|overwhelm",  "stress_index",  +0.25),
        (r"calm|relax|at ease|meditat|low stress",                     "stress_index",  -0.25),
        # HRV / heart rate
        (r"elevated hr|high.*heart rate|tachycardia|poor hrv",        "hrv_ms",        -0.3),
        (r"low.*heart rate|bradycardia|athletic|high hrv",            "hrv_ms",        +0.3),
        # EDA / arousal
        (r"sweat|hyperarousal|panic|high arousal",                    "eda_us",        +0.3),
        # glucose
        (r"diabet|hyperglycaem|high.*glucose|high.*sugar",            "glucose_mg_dl", +0.25),
        (r"hypoglycaem|low.*glucose|low.*sugar",                      "glucose_mg_dl", -0.2),
    ]

    # Start from a base sample
    base = PhysioSimulator().sample(role=role, scenario_id=scenario_id)

    RANGES = {
        "stress_index":  (0.05, 0.95),
        "hrv_ms":        (10.0, 80.0),
        "eda_us":        (0.2,  10.0),
        "sleep_deficit": (0.0,  12.0),
        "glucose_mg_dl": (60.0, 200.0),
    }

    import random as _rng
    for pattern, field, delta_frac in CUES:
        if re.search(pattern, n):
            lo, hi = RANGES[field]
            span    = hi - lo
            noise   = _rng.gauss(0, 0.05)           # small stochastic variation
            shift   = span * (delta_frac + noise)
            base[field] = round(
                max(lo, min(hi, base[field] + shift)), 3
            )

    # Recalculate stress_index from hrv_ms if only hrv was shifted
    if re.search(r"elevated hr|high.*heart rate|tachycardia|low.*heart rate|bradycardia|athletic", n):
        hrv    = base["hrv_ms"]
        stress = round(max(0.05, min(0.95, 1.0 - (hrv - 10.0) / 70.0)), 3)
        base["stress_index"] = stress

    base["_physio_narrative"] = narrative   # store for logging / audit
    return base


def step_physio(
    physio: dict,
    emotionally_loaded: bool = False,
    seed: int | None = None,
) -> dict:
    """One-shot stateless step. Creates a fresh simulator per call."""
    return PhysioSimulator(seed=seed).step(physio, emotionally_loaded=emotionally_loaded)


# ─────────────────────────────────────────────────────────────────────────────
# Stress Calibration helpers (SC1 — optimal stress window)
# ─────────────────────────────────────────────────────────────────────────────
# Each (archetype, phase) pair has an optimal stress range [min, max].
# Stress within the window → +bonus (action is possible).
# Stress below minimum → patient is avoidant; motivational nudge warranted.
# Stress above maximum → patient is overwhelmed; de-escalation warranted.
#
# Archetypes: rough TTM-derived patient motivation profiles.
# Phases: broad episode phase labels.

OPTIMAL_STRESS_RANGE: dict[tuple[str, str], tuple[float, float]] = {
    # (archetype, phase) → (min_stress, max_stress)
    # Avoidant: needs some activation to act, but not much
    ("avoidant",        "action_taking"):      (0.35, 0.60),
    ("avoidant",        "contemplation"):      (0.25, 0.50),
    ("avoidant",        "maintenance"):        (0.15, 0.40),
    # Catastrophiser: stress escalates quickly; keep window narrow and low
    ("catastrophiser",  "any"):                (0.10, 0.35),
    # Achiever: high stress is productive; tolerates more
    ("achiever",        "action_taking"):      (0.40, 0.70),
    ("achiever",        "contemplation"):      (0.30, 0.60),
    # Passive: requires significant activation to engage with change
    ("passive",         "action_taking"):      (0.40, 0.65),
    ("passive",         "contemplation"):      (0.30, 0.55),
    # Default fallback — no archetype or phase known
    ("default",         "any"):                (0.20, 0.55),
}


def stress_calibration_bonus(
    stress_index: float,
    archetype: str = "default",
    phase: str = "any",
) -> float:
    """
    SC1: Return a reward modifier based on whether final stress_index falls
    within the optimal window for this archetype / episode phase.

    Returns:
        +0.05  — stress is within the optimal action window (patient can act)
        -0.05  — stress is over-reduced (patient below minimum action threshold)
         0.0   — stress is above max (no penalty here; de-escalation logic handles it)
    """
    key = (archetype, phase)
    lo, hi = OPTIMAL_STRESS_RANGE.get(key) or OPTIMAL_STRESS_RANGE[("default", "any")]
    if stress_index > hi:
        return 0.0      # over-escalated — standard calming reward applies elsewhere
    if stress_index < lo:
        return -0.05    # over-reduced — penalise excessive de-escalation
    return +0.05        # within window — bonus for reaching the action threshold


def inaction_appropriateness_bonus(
    action_taken: str,
    scenario_type: str,
    stress_index: float,
) -> float:
    """
    AS4: Return a reward bonus when an inaction action is used correctly,
    or a penalty when over-used in standard therapeutic contexts.

    Inaction cluster: hold_space, therapeutic_silence, await_readiness,
    pause_and_breathe_together.

    Correct use: grief/shock/breakthrough scenarios OR stress ≥ 0.80.
    Incorrect use: standard scenario at low/moderate stress → penalise.
    """
    _INACTION = {
        "hold_space", "therapeutic_silence",
        "await_readiness", "pause_and_breathe_together",
    }
    if action_taken not in _INACTION:
        return 0.0
    _INACTION_APPROPRIATE_SCENARIOS = {
        "bereavement", "crisis",   # grief and shock
        "witness_grief",           # active grief accompaniment
        "health_deterioration",    # patient health deteriorating mid-session
    }
    if scenario_type in _INACTION_APPROPRIATE_SCENARIOS or stress_index >= 0.80:
        return +0.12   # bonus: restraint is clinically appropriate here
    if stress_index < 0.50:
        return -0.08   # penalty: silence at low stress = disengagement
    return 0.0         # neutral: moderate stress, ambiguous scenario
