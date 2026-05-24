"""
HRV-to-decay-constant mapping for the HTN physiological subspace.

The central equation this module implements:

    |λ₁| = e^{-γΔt}

where γ is the autonomic decay constant derived from real-time HRV (RMSSD),
and λ₁ is the second eigenvalue of the physiological transfer matrix.

When the MPS transitions under the non-Hermitian operator H = e^{-iH_eff·Δt},
the physiological bond dimension decays at rate γ. A small γ (stressed patient,
low HRV) means the stress state persists for many conversational turns.
A large γ (calm patient, high HRV) means the state recovers quickly.

References
----------
- Shaffer & Ginsberg (2017). An Overview of Heart Rate Variability Metrics.
  Front. Public Health 5:258.
- Task Force of ESC/NASPE (1996). Heart rate variability: standards of
  measurement. Circulation 93(5):1043-65.
- Kim et al. (2018). Stress and Heart Rate Variability. Psychiatry Investig.
"""

from __future__ import annotations

import math
from typing import Optional

from tensornets.physio.state import (
    HRV_RMSSD_BASELINE_MS,
    HRV_RMSSD_MAX_MS,
    HRV_RMSSD_MIN_MS,
    PhysiologicalHistory,
    PhysiologicalState,
)


# ── Decay constant bounds ──────────────────────────────────────────────────────
# γ_min: very stressed / clinically fragile patient — stress decays extremely slowly
# γ_max: calm / well-regulated patient — stress decays within 1–2 turns
GAMMA_MIN = 0.05   # stress half-life ≈ 14 conversational turns (clinically fragile)
GAMMA_MAX = 0.5    # stress half-life ≈ 1.4 conversational turns (well-regulated)

# Sensitivity exponent α: how sharply γ responds to HRV changes.
# α = 1.0 → linear. α > 1 → sharp threshold. Start at 1.0, fit per-subject later.
ALPHA_DEFAULT = 1.0


def hrv_to_gamma(
    hrv_rmssd_ms: float,
    baseline_ms: float = HRV_RMSSD_BASELINE_MS,
    alpha: float = ALPHA_DEFAULT,
    gamma_min: float = GAMMA_MIN,
    gamma_max: float = GAMMA_MAX,
) -> float:
    """
    Map RMSSD heart rate variability to the autonomic decay constant γ.

    Formula
    -------
        γ = γ_min + (γ_max - γ_min) · (RMSSD_current / RMSSD_baseline)^α

    The ratio RMSSD_current / RMSSD_baseline captures deviation from the
    subject's own baseline, which is more clinically meaningful than using
    population norms. When the ratio equals 1 (at baseline), γ sits at
    γ_min + (γ_max - γ_min) · 1^α = γ_max — i.e., normal recovery speed.
    When RMSSD drops to zero (extreme stress), γ → γ_min.

    Parameters
    ----------
    hrv_rmssd_ms : float
        Current RMSSD in milliseconds.
    baseline_ms : float
        Subject's resting baseline RMSSD in milliseconds.
        Defaults to the population mean (35 ms).
    alpha : float
        Sensitivity exponent. Start at 1.0; estimate per-subject from WESAD.
    gamma_min : float
        Minimum decay constant (slowest recovery, highest fragility).
    gamma_max : float
        Maximum decay constant (fastest recovery, lowest fragility).

    Returns
    -------
    float
        γ in turns⁻¹ (where one 'turn' is one conversational step Δt).
    """
    hrv_clamped = max(HRV_RMSSD_MIN_MS, min(hrv_rmssd_ms, HRV_RMSSD_MAX_MS))
    ratio = hrv_clamped / max(baseline_ms, 1.0)
    ratio_clamped = max(0.0, min(ratio, 2.0))  # cap at 2× baseline, not max/min ratio
    gamma = gamma_min + (gamma_max - gamma_min) * (ratio_clamped ** alpha)
    return float(gamma)


def gamma_to_lambda1(gamma: float, delta_t: float = 1.0) -> float:
    """
    Compute the magnitude of the second eigenvalue of the physiological
    transfer matrix from the decay constant γ.

    From the paper (Section 4.3):
        |λ₁| = e^{-γΔt}

    The spectral gap |λ₀| - |λ₁| determines how quickly the physiological
    bond dimension decays toward its ground (homeostatic) state.
    |λ₀| = 1 by normalisation.

    Parameters
    ----------
    gamma : float
        Autonomic decay constant in turns⁻¹.
    delta_t : float
        Conversational time step. Default 1 turn.

    Returns
    -------
    float
        |λ₁| in [0, 1]. Close to 1 → slow decay (stressed).
                         Close to 0 → fast decay (calm / recovering quickly).
    """
    return math.exp(-gamma * delta_t)


def stress_half_life_turns(gamma: float, delta_t: float = 1.0) -> float:
    """
    Number of conversational turns for the stress amplitude to halve.

    From |λ₁|^n = 0.5  →  n = ln(0.5) / ln(|λ₁|) = ln(2) / (γ Δt)

    This is the human-readable summary of the decay rate — useful for
    debugging and for the Semantic State Inspector.
    """
    lambda1 = gamma_to_lambda1(gamma, delta_t)
    if lambda1 >= 1.0 - 1e-9:
        return float("inf")
    return math.log(2.0) / (-math.log(lambda1))


def estimate_baseline_from_history(history: PhysiologicalHistory) -> float:
    """
    Estimate a subject-specific HRV baseline from their historical record.

    Uses the median of the lowest-stress quartile of recorded RMSSD values
    (i.e., their calmest moments), following the clinical convention of
    estimating 'true resting HRV' from the best available measurements.

    Falls back to the population mean if fewer than 4 states are available.
    """
    if len(history) < 4:
        return HRV_RMSSD_BASELINE_MS
    hrv_values = sorted(history.hrv_trajectory())
    # Take the median of the bottom quartile (most relaxed readings)
    calm_cutoff = len(hrv_values) * 3 // 4
    calm_readings = hrv_values[calm_cutoff:]
    return calm_readings[len(calm_readings) // 2]


def decay_amplitude_after_n_turns(
    initial_amplitude: float,
    gamma: float,
    n_turns: int,
    delta_t: float = 1.0,
) -> float:
    """
    Compute the remaining stress amplitude after n conversational turns.

    Uses the analytic decay formula:
        A(n) = A₀ · |λ₁|^n = A₀ · e^{-γ Δt n}

    Parameters
    ----------
    initial_amplitude : float
        Stress amplitude at turn 0, in [0, 1].
    gamma : float
        Autonomic decay constant.
    n_turns : int
        Number of turns elapsed.
    delta_t : float
        Duration of each turn.

    Returns
    -------
    float
        Remaining stress amplitude in [0, 1].
    """
    return initial_amplitude * math.exp(-gamma * delta_t * n_turns)


def gamma_from_state(
    state: PhysiologicalState,
    baseline_ms: Optional[float] = None,
    alpha: float = ALPHA_DEFAULT,
    reactivity_profile=None,   # C6.1: ReactivityProfile | None
    drug_regimen=None,          # C5.4: DrugRegimen | None
    hysteretic_baseline=None,   # C7.1: HystereticBaseline | None
    active_trigger_id: Optional[str] = None,
) -> float:
    """
    Derive γ from a full PhysiologicalState, incorporating all available signals.

    The base HRV-derived γ is modulated by:
      - EDA (sympathetic co-activation): slows recovery by up to 10%
      - Sleep pressure: slows recovery by up to 20% (Irwin et al. 2016)
      - Location prior: slows recovery by up to 5%

    Optional modifier layers (C5.4 / C6.1 / C7.1):
      - drug_regimen.gamma_modifier(): PK/PD time-dependent drug effect
      - reactivity_profile.gamma_modifier(stress_index): archetype scaling
      - hysteretic_baseline.gamma_modifier(trigger_id): extinction state

    Note: when calling build_Gamma() directly, pass the modifiers there —
    they will be applied after gamma_from_state to avoid double application.
    """
    if baseline_ms is None:
        baseline_ms = HRV_RMSSD_BASELINE_MS

    gamma_hrv = hrv_to_gamma(state.hrv_rmssd_ms, baseline_ms, alpha)

    eda_suppression      = 0.10 * state.eda_normalized()
    sleep_suppression    = 0.20 * state.sleep_pressure()
    location_suppression = 0.05 * state.location_stress_index

    gamma = gamma_hrv * (1.0 - eda_suppression - sleep_suppression - location_suppression)
    gamma = max(GAMMA_MIN, gamma)

    # Optional modifier layers (C5.4 / C6.1 / C7.1) — applied when build_Gamma is NOT used
    if drug_regimen is not None:
        try:
            gamma *= drug_regimen.gamma_modifier()
        except Exception:
            pass

    if reactivity_profile is not None:
        try:
            gamma *= reactivity_profile.gamma_modifier(state.stress_index())
        except Exception:
            pass

    if hysteretic_baseline is not None:
        try:
            gamma *= hysteretic_baseline.gamma_modifier(trigger_id=active_trigger_id)
        except Exception:
            pass

    return max(GAMMA_MIN, gamma)
