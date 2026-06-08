"""
tensornets.physio.predictive_escalation
========================================
Python counterpart of companions/agents/predictiveEscalationAgent.js.

Computes the Deterioration Risk Index (DRI) from physiological signals and
returns a tier that drives companion escalation behaviour.

Used by:
- FastAPI /physio/predict-escalation  (server.py)
- A3CWorker.score_turn() — injects escalation_tier into TurnState so the
  A3C reward function can reward PROACTIVE escalation rather than only
  reactive escalation.
- scorer.py — new dimension 'escalation_timeliness' measures whether the
  agent escalated at the right DRI tier (not too early, not too late).

DRI Tiers
---------
NO_ACTION            DRI < 0.30
SOFT_CHECKIN         DRI 0.30–0.50
PROACTIVE_SUPPORT    DRI 0.50–0.70
CLINICAL_ALERT       DRI 0.70–0.85
IMMEDIATE_ESCALATION DRI > 0.85
"""

from __future__ import annotations

import math
from typing import Optional

# ── Configuration ──────────────────────────────────────────────────────────────

DRI_THRESHOLDS = {
    "IMMEDIATE_ESCALATION": 0.80,
    "CLINICAL_ALERT":       0.65,
    "PROACTIVE_SUPPORT":    0.45,
    "SOFT_CHECKIN":         0.25,
}

HRV_SLOPE_ALARM    = -0.8   # ms/turn — clinically significant decline
HRV_VELOCITY_ALARM = -3.0   # ms/turn — rapid single-turn drop
MIN_SAMPLES        = 3
TREND_WINDOW       = 8

DRI_WEIGHTS = {
    "hrv_trend":            0.35,
    "hrv_velocity":         0.20,
    "sleep_quality":        0.15,
    "stress_self_report":   0.15,
    "medication_adherence": 0.10,
    "turn_streak":          0.05,
}


# ── Core computation ───────────────────────────────────────────────────────────

def compute_dri(
    hrv_history:              list[float],
    stress_score:             float = 0.0,
    sleep_quality:            float = 1.0,
    medication_adherence:     float = 1.0,
    consecutive_stress_turns: int   = 0,
) -> dict:
    """
    Compute the Deterioration Risk Index.

    Parameters
    ----------
    hrv_history              : recent HRV readings (ms), oldest first
    stress_score             : 0..1 (higher = more stressed)
    sleep_quality            : 0..1 (higher = better sleep)
    medication_adherence     : 0..1 (higher = better adherence)
    consecutive_stress_turns : turns above stress threshold in current episode

    Returns
    -------
    dict with keys: dri, tier, reasons, components
    """
    components: dict[str, float] = {}
    reasons:    list[str]        = []

    # ── HRV trend ──────────────────────────────────────────────────────────────
    hrv_trend_score = 0.0
    if len(hrv_history) >= MIN_SAMPLES:
        window = hrv_history[-TREND_WINDOW:]
        slope  = _linear_slope(window)
        components["hrv_slope"] = round(slope, 3)
        if slope < HRV_SLOPE_ALARM:
            hrv_trend_score = min(1.0, (abs(slope) - abs(HRV_SLOPE_ALARM)) / 3.2)
            reasons.append(f"HRV declining at {slope:.2f}ms/turn")
        elif slope < 0:
            hrv_trend_score = 0.1
    components["hrv_trend"] = round(hrv_trend_score, 3)

    # ── HRV velocity ───────────────────────────────────────────────────────────
    hrv_velocity_score = 0.0
    if len(hrv_history) >= 2:
        velocity = hrv_history[-1] - hrv_history[-2]
        components["hrv_velocity_ms"] = round(velocity, 2)
        if velocity < HRV_VELOCITY_ALARM:
            hrv_velocity_score = min(1.0, abs(velocity) / 8.0)
            reasons.append(f"Rapid HRV drop: {velocity:.1f}ms this turn")
    components["hrv_velocity"] = round(hrv_velocity_score, 3)

    # ── Sleep quality ──────────────────────────────────────────────────────────
    sleep_score = max(0.0, 1.0 - sleep_quality)
    components["sleep_quality"] = round(sleep_score, 3)
    if sleep_score > 0.6:
        reasons.append(f"Poor sleep quality ({sleep_quality*100:.0f}%)")

    # ── Stress self-report ─────────────────────────────────────────────────────
    components["stress_self_report"] = round(stress_score, 3)
    if stress_score > 0.7:
        reasons.append(f"High reported stress ({stress_score*100:.0f}%)")

    # ── Medication adherence ───────────────────────────────────────────────────
    med_score = max(0.0, 1.0 - medication_adherence)
    components["medication_adherence"] = round(med_score, 3)
    if med_score > 0.5:
        reasons.append(f"Low medication adherence ({medication_adherence*100:.0f}%)")

    # ── Consecutive stress turns ───────────────────────────────────────────────
    streak_score = min(1.0, consecutive_stress_turns / 5.0)
    components["turn_streak"] = round(streak_score, 3)
    if consecutive_stress_turns >= 3:
        reasons.append(f"{consecutive_stress_turns} consecutive high-stress turns")

    # ── Composite DRI ──────────────────────────────────────────────────────────
    dri = (
        DRI_WEIGHTS["hrv_trend"]            * hrv_trend_score     +
        DRI_WEIGHTS["hrv_velocity"]         * hrv_velocity_score  +
        DRI_WEIGHTS["sleep_quality"]        * sleep_score         +
        DRI_WEIGHTS["stress_self_report"]   * stress_score        +
        DRI_WEIGHTS["medication_adherence"] * med_score           +
        DRI_WEIGHTS["turn_streak"]          * streak_score
    )
    dri = round(min(1.0, dri), 4)

    return {
        "dri":        dri,
        "tier":       _dri_tier(dri),
        "reasons":    reasons,
        "components": components,
    }


def _dri_tier(dri: float) -> str:
    for tier, threshold in DRI_THRESHOLDS.items():
        if dri >= threshold:
            return tier
    return "NO_ACTION"


def _linear_slope(vals: list[float]) -> float:
    n = len(vals)
    if n < 2:
        return 0.0
    xs = list(range(n))
    xm = (n - 1) / 2.0
    ym = sum(vals) / n
    num = sum((xs[i] - xm) * (vals[i] - ym) for i in range(n))
    den = sum((xs[i] - xm) ** 2 for i in range(n))
    return num / den if den else 0.0


# ── Quick smoke test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    from dataclasses import dataclass

    cases = [
        ("Healthy baseline",         [52,54,50,53,55,51],    0.20, 0.80, 1.0, 0, "NO_ACTION"),
        ("Gradual HRV decline",      [48,45,42,38,35,31,28,24], 0.55, 0.50, 1.0, 2, "PROACTIVE_SUPPORT"),
        ("Rapid HRV crash",          [45,44,43,41,28],        0.80, 0.40, 1.0, 4, "CLINICAL_ALERT"),
        ("Multi-signal crisis",      [40,36,32,28,24,20,18,14], 0.85, 0.15, 0.20, 5, "IMMEDIATE_ESCALATION"),
        ("Borderline soft check-in", [42,40,38,36,35],         0.45, 0.55, 1.0, 1, "SOFT_CHECKIN"),
        ("Recovery trajectory",      [15,18,21,25,28,31],     0.30, 0.65, 1.0, 0, "NO_ACTION"),
    ]

    print("Predictive Escalation Smoke Test\n" + "=" * 50)
    all_pass = True
    for name, hrv, stress, sleep, meds, streak, expected in cases:
        r    = compute_dri(hrv, stress, sleep, meds, streak)
        ok   = r["tier"] == expected
        mark = "PASS" if ok else "FAIL"
        all_pass = all_pass and ok
        print(f"{mark} {name}")
        print(f"  DRI={r['dri']:.4f}  tier={r['tier']}  expected={expected}")
        if not ok or r["reasons"]:
            print(f"  reasons={r['reasons']}")
    print("\n" + ("ALL PASSED" if all_pass else "SOME FAILED"))
