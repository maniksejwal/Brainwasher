"""
activity_context.py — Activity-Dependent Physiological Context
===============================================================

PURPOSE
-------
`PhysiologicalState` tracks the raw bio-signals (HRV, EDA, glucose, etc.).
This module adds the CONTEXTUAL modifiers that change how those signals
should be interpreted and how the Γ operator should respond:

  1. POST-EXERCISE STATE — HRV is low post-workout but NOT stress. MCTS must not
     select confrontational actions because of low HRV when the patient just ran.

  2. FOOD / FASTING STATE — Affects PK/PD (drug absorption), glucose trajectory,
     and decision-making quality. A 3-hour food-drug gap is clinically required
     for many medications (SSRIs, certain beta-blockers, thyroid medication).

  3. ILLNESS CONTEXT — Fever, muscle cramps, migraine, GI illness. Each has a
     distinct physiological signature and a different MCTS implication.

  4. CONTEXT TYPE — Holiday vs. work day vs. night shift vs. travel. Location
     stress_index alone is insufficient; a holiday with family stress is different
     from a holiday abroad.

  5. PAIN STATE — Acute vs. chronic pain. Chronic pain suppresses HRV baseline
     independently of acute stress (Forte 2012); MCTS must adjust expectations.

THEORETICAL BASIS
-----------------
Post-exercise HRV:
  Buchheit M (2014). Monitoring training status with HR measures. Front Physiol 5:80.
  HRV is suppressed for 24–48h after high-intensity exercise regardless of stress.
  The "HRV dip" here is autonomic recovery, not distress. Misclassifying it as
  stress would cause MCTS to over-select containment/support actions unnecessarily.

Food-drug interactions:
  Custodio JM et al. (2008). Clinical pharmacology of novel oral targeted therapy.
  Brit J Clin Pharmacol 65(4): 492-507.
  SSRIs: take with food (↓ GI side effects). Thyroid (levothyroxine): fasting only.
  Beta-blockers: preferably consistent timing relative to meals.
  Food reduces rate (not always extent) of absorption; affects ke0 and Cmax.

Pain and HRV:
  Forte G et al. (2012). Pain experience and autonomic modulation.
  Neurosci Biobehav Rev 36(1): 226-234.
  Chronic pain → HRV reduction of 10–20ms independent of acute stress.
  Acute pain → transient HRV dip + EDA spike.

Irritability from headache / illness:
  Peroutka SJ (2004). Migraine and personality. Cephalalgia 24(1): 35-42.
  Migraine reduces emotional regulation capacity (equivalent to LABILE archetype
  during the attack). MCTS should treat active migraine as a reactivity modifier.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Enumerations
# ─────────────────────────────────────────────────────────────────────────────

class ExerciseIntensity(Enum):
    NONE           = "none"
    LIGHT          = "light"    # walking, stretching
    MODERATE       = "moderate" # brisk walk, yoga
    HIGH           = "high"     # running, gym session
    EXHAUSTIVE     = "exhaustive"  # race, max-effort training

class IllnessType(Enum):
    NONE           = "none"
    MILD_HEADACHE  = "mild_headache"
    MIGRAINE       = "migraine"
    MUSCLE_CRAMPS  = "muscle_cramps"
    GI_DISTRESS    = "gi_distress"
    FEVER_LOW      = "fever_low"    # 37.5–38.5°C
    FEVER_HIGH     = "fever_high"   # > 38.5°C
    CHRONIC_PAIN   = "chronic_pain"
    ACUTE_PAIN     = "acute_pain"
    FATIGUE_VIRAL  = "fatigue_viral"  # post-viral fatigue

class ContextType(Enum):
    WORK_DAY       = "work_day"
    HOLIDAY        = "holiday"
    WEEKEND        = "weekend"
    NIGHT_SHIFT    = "night_shift"
    TRAVEL         = "travel"
    MEDICAL_VISIT  = "medical_visit"  # clinic / hospital context
    HOME_EVENING   = "home_evening"

class PainLevel(Enum):
    NONE    = 0
    MILD    = 2    # NRS 1-3
    MODERATE = 5   # NRS 4-6
    SEVERE  = 8    # NRS 7-10


# ─────────────────────────────────────────────────────────────────────────────
# Activity context dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ActivityContext:
    """
    Contextual modifier layer on top of PhysiologicalState.

    This is NOT part of PhysiologicalState to keep the bio-signal layer clean.
    It is injected into the state vector and Γ operator as additional modifiers.

    Parameters
    ----------
    exercise_intensity : ExerciseIntensity
        Most recent exercise intensity.
    hours_since_exercise : float
        Hours elapsed since end of exercise session.
        HRV suppression persists 24-48h post high-intensity (Buchheit 2014).
    food_recency_hours : float
        Hours since last meal.
        Relevant for PK/PD drug absorption timing.
    fasting : bool
        Whether patient is actively fasting (Ramadan, Yom Kippur, intermittent
        fasting protocol, pre-procedure nil-by-mouth).
    illness : IllnessType
        Current illness context.
    illness_severity : float
        Severity ∈ [0, 1] — 0 = resolved, 1 = acute/severe.
    pain_level : PainLevel
        Current pain NRS level.
    pain_type : str
        Brief label ('headache', 'back', 'joint', etc.) for MCTS hint generation.
    context_type : ContextType
        Day type / activity context.
    temperature_celsius : float
        Body temperature. Normal 36.5-37.2°C. Fever > 37.5°C.
    """

    exercise_intensity:   ExerciseIntensity = ExerciseIntensity.NONE
    hours_since_exercise: float = 24.0      # 24h = fully recovered by default

    food_recency_hours: float = 3.0         # 3h since eating = safe for most meds
    fasting: bool = False

    illness:           IllnessType = IllnessType.NONE
    illness_severity:  float       = 0.0

    pain_level:  PainLevel = PainLevel.NONE
    pain_type:   str       = ""
    temperature_celsius: float = 37.0

    context_type: ContextType = ContextType.WORK_DAY

    # ── Γ modifiers ─────────────────────────────────────────────────────────

    def gamma_modifier(self) -> float:
        """
        Multiplicative modifier for the Γ matrix.

        Combines all contextual factors into a single scalar.
        > 1.0 = increased reactivity (patient less resilient)
        < 1.0 = decreased reactivity (patient more resilient / different state)

        The most important effect:
        POST-EXERCISE: HRV is low, but Γ should be LOW (patient is healthy).
        This is the inverse of the stress interpretation.
        """
        mod = 1.0

        # Post-exercise HRV correction (Buchheit 2014)
        # High-intensity exercise suppresses HRV for 24-48h; this is NOT stress
        exercise_gamma = self._exercise_gamma_correction()
        mod *= exercise_gamma

        # Illness
        mod *= self._illness_modifier()

        # Pain
        mod *= self._pain_modifier()

        # Context type
        mod *= self._context_modifier()

        return mod

    def hrv_adjustment_ms(self) -> float:
        """
        Expected delta to add to observed HRV to correct for confounds.

        Post-exercise HRV is artificially low; correcting it prevents MCTS from
        over-interpreting the suppression as clinical distress.

        Returns: signed float in ms (positive = HRV was suppressed by this much)
        """
        adj = 0.0
        # Post-exercise correction
        if self.exercise_intensity == ExerciseIntensity.HIGH:
            if self.hours_since_exercise < 24:
                # Peak suppression at 1h, recovering over 24h
                recovery_ratio = min(1.0, self.hours_since_exercise / 24.0)
                adj += 8.0 * (1.0 - recovery_ratio)
        elif self.exercise_intensity == ExerciseIntensity.EXHAUSTIVE:
            if self.hours_since_exercise < 48:
                recovery_ratio = min(1.0, self.hours_since_exercise / 48.0)
                adj += 15.0 * (1.0 - recovery_ratio)
        # Chronic pain: long-term HRV suppression (Forte 2012: ~10-20ms)
        if self.illness == IllnessType.CHRONIC_PAIN:
            adj += 12.0 * self.illness_severity
        return adj

    def stress_index_adjustment(self) -> float:
        """
        Additive modifier to stress_index().
        Accounts for states that affect decision-making quality without
        directly matching the standard physio stress signature.

        Migraine: high irritability, low tolerance → +stress
        Fever: impaired cognition → +stress
        Fasting: mild cognitive load → slight +stress
        Holiday: generally lower stress → slight −stress
        """
        adj = 0.0
        if self.illness == IllnessType.MIGRAINE:
            adj += 0.25 * self.illness_severity
        elif self.illness == IllnessType.FEVER_HIGH:
            adj += 0.20 * self.illness_severity
        elif self.illness == IllnessType.FEVER_LOW:
            adj += 0.10 * self.illness_severity
        elif self.illness == IllnessType.MUSCLE_CRAMPS:
            adj += 0.08 * self.illness_severity
        elif self.illness == IllnessType.MILD_HEADACHE:
            adj += 0.06 * self.illness_severity
        elif self.illness == IllnessType.CHRONIC_PAIN:
            adj += 0.12 * self.illness_severity
        elif self.illness == IllnessType.ACUTE_PAIN:
            adj += 0.15 * self.illness_severity
        if self.fasting and self.food_recency_hours > 8:
            adj += 0.05  # prolonged fasting cognitive load
        if self.context_type == ContextType.HOLIDAY:
            adj -= 0.05
        elif self.context_type == ContextType.MEDICAL_VISIT:
            adj += 0.10  # clinic context → anticipatory anxiety (Menatti 2019)
        return adj

    def pkpd_food_gate(self, drug_name: str) -> dict:
        """
        Returns whether the food-drug timing requirements are met for common drugs.

        Reference: NHS/BNF food-drug interaction guidance + Custodio 2008.
        """
        h = self.food_recency_hours
        fasting = self.fasting
        rules = {
            'levothyroxine':   {'requires_fasting': True, 'min_gap_h': 0.5,
                                'note': 'Take 30-60min before food; food reduces absorption by 40%'},
            'metoprolol':      {'requires_fasting': False, 'min_gap_h': 0,
                                'note': 'Can be taken with or without food'},
            'atorvastatin':    {'requires_fasting': False, 'min_gap_h': 0,
                                'note': 'Take in evening; food has no clinically meaningful effect'},
            'sertraline':      {'requires_fasting': False, 'min_gap_h': 0,
                                'note': 'Take with food to reduce GI side effects'},
            'naltrexone':      {'requires_fasting': False, 'min_gap_h': 1.0,
                                'note': '1h gap reduces nausea'},
            'diazepam':        {'requires_fasting': False, 'min_gap_h': 0,
                                'note': 'Food delays but does not reduce absorption'},
            'iron_supplement': {'requires_fasting': True, 'min_gap_h': 2.0,
                                'note': 'Take 2h before food; calcium/antacids block absorption'},
            'metformin':       {'requires_fasting': False, 'min_gap_h': 0,
                                'note': 'Take WITH food — reduces GI side effects'},
        }
        rule = rules.get(drug_name.lower(), None)
        if rule is None:
            return {'ok': True, 'note': f'No food-drug interaction data for {drug_name}'}
        if rule['requires_fasting']:
            ok = fasting or h >= rule['min_gap_h']
            return {'ok': ok, 'note': rule['note'],
                    'hours_since_food': h, 'required_gap': rule['min_gap_h']}
        return {'ok': True, 'note': rule['note']}

    def mcts_action_gate(self) -> dict:
        """
        Returns constraints on MCTS action selection based on activity context.
        Integrates with `available_strategies()` from `linguistic/stress_model.py`.
        """
        blocked = []
        warnings = []
        if self.illness in (IllnessType.MIGRAINE, IllnessType.FEVER_HIGH):
            blocked += ['psychoeducation', 'challenger_reframe', 'develop_discrepancy',
                        'direct_confrontation']
            warnings.append(
                f"Patient has {self.illness.value}: complex cognitive tasks blocked. "
                f"Support and simple validation only."
            )
        if self.illness == IllnessType.GI_DISTRESS:
            warnings.append("GI distress: avoid discussing medication if nausea present.")
        if self.context_type == ContextType.MEDICAL_VISIT:
            warnings.append(
                "Medical visit context: patient may have anticipatory anxiety (sigma+0.10). "
                "Lead with normalisation before clinical discussion."
            )
        if self.context_type == ContextType.NIGHT_SHIFT:
            blocked += ['flooding_initiation', 'confrontation']
            warnings.append(
                "Night shift context: circadian disruption + fatigue. "
                "No complex therapeutic work."
            )
        if self.exercise_intensity in (ExerciseIntensity.HIGH, ExerciseIntensity.EXHAUSTIVE):
            if self.hours_since_exercise < 2:
                warnings.append(
                    f"Recent {self.exercise_intensity.value} exercise "
                    f"({self.hours_since_exercise:.1f}h ago). "
                    f"HRV is suppressed by up to {self.hrv_adjustment_ms():.0f}ms — "
                    f"this is NOT stress. Do not over-interpret low HRV.")
        if self.fasting and self.food_recency_hours > 12:
            warnings.append(
                f"Extended fasting ({self.food_recency_hours:.0f}h): "
                f"cognitive load elevated slightly. Avoid complex multi-step instructions."
            )
        return {'blocked_actions': blocked, 'warnings': warnings}

    def prompt_hint(self) -> str:
        """Generate a context hint for injection into the LLM system prompt."""
        lines = []
        ctx = self.mcts_action_gate()
        if ctx['blocked_actions']:
            lines.append(f"BLOCKED ACTIONS (activity context): {', '.join(ctx['blocked_actions'])}")
        for w in ctx['warnings']:
            lines.append(f"CONTEXT NOTE: {w}")
        if self.pain_level != PainLevel.NONE:
            lines.append(
                f"PAIN STATE: {self.pain_type or 'unspecified'} at NRS {self.pain_level.value}/10. "
                f"Irritability threshold is reduced. Prioritise acknowledgement before any clinical goal."
            )
        if self.context_type == ContextType.HOLIDAY:
            lines.append("CONTEXT: Patient is on holiday. Reduced receptivity to health reminders.")
        return "\n".join(lines) if lines else ""

    # ── Private helpers ──────────────────────────────────────────────────────

    def _exercise_gamma_correction(self) -> float:
        """Post-exercise: HRV is suppressed but Γ should NOT be elevated."""
        if self.exercise_intensity == ExerciseIntensity.NONE:
            return 1.0
        intensity_map = {
            ExerciseIntensity.LIGHT:      (0.0, 6.0,  0.95),
            ExerciseIntensity.MODERATE:   (0.0, 12.0, 0.90),
            ExerciseIntensity.HIGH:       (0.0, 24.0, 0.80),
            ExerciseIntensity.EXHAUSTIVE: (0.0, 48.0, 0.70),
        }
        _, recovery_h, min_mod = intensity_map[self.exercise_intensity]
        if self.hours_since_exercise >= recovery_h:
            return 1.0
        ratio = self.hours_since_exercise / recovery_h
        return min_mod + (1.0 - min_mod) * ratio

    def _illness_modifier(self) -> float:
        s = self.illness_severity
        modifiers = {
            IllnessType.NONE:          1.0,
            IllnessType.MILD_HEADACHE: 1.0 + 0.10 * s,
            IllnessType.MIGRAINE:      1.0 + 0.30 * s,
            IllnessType.MUSCLE_CRAMPS: 1.0 + 0.15 * s,
            IllnessType.GI_DISTRESS:   1.0 + 0.12 * s,
            IllnessType.FEVER_LOW:     1.0 + 0.20 * s,
            IllnessType.FEVER_HIGH:    1.0 + 0.40 * s,
            IllnessType.CHRONIC_PAIN:  1.0 + 0.18 * s,  # sustained elevation
            IllnessType.ACUTE_PAIN:    1.0 + 0.25 * s,
            IllnessType.FATIGUE_VIRAL: 1.0 + 0.20 * s,
        }
        return modifiers.get(self.illness, 1.0)

    def _pain_modifier(self) -> float:
        pain_map = {
            PainLevel.NONE:     1.0,
            PainLevel.MILD:     1.08,
            PainLevel.MODERATE: 1.20,
            PainLevel.SEVERE:   1.40,
        }
        return pain_map.get(self.pain_level, 1.0)

    def _context_modifier(self) -> float:
        context_map = {
            ContextType.WORK_DAY:      1.0,
            ContextType.HOLIDAY:       0.88,   # generally lower Γ
            ContextType.WEEKEND:       0.93,
            ContextType.NIGHT_SHIFT:   1.25,   # circadian disruption
            ContextType.TRAVEL:        1.15,   # travel fatigue
            ContextType.MEDICAL_VISIT: 1.20,   # anticipatory anxiety
            ContextType.HOME_EVENING:  0.90,
        }
        return context_map.get(self.context_type, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Worked example
# ─────────────────────────────────────────────────────────────────────────────

def worked_example():
    print("=" * 70)
    print("ACTIVITY CONTEXT WORKED EXAMPLE")
    print("=" * 70)

    cases = [
        ("Post-marathon (3h ago)", ActivityContext(
            exercise_intensity=ExerciseIntensity.EXHAUSTIVE,
            hours_since_exercise=3.0,
            context_type=ContextType.WEEKEND,
        )),
        ("Active migraine at work", ActivityContext(
            illness=IllnessType.MIGRAINE,
            illness_severity=0.8,
            pain_level=PainLevel.SEVERE,
            pain_type="migraine",
            context_type=ContextType.WORK_DAY,
        )),
        ("Holiday, well-rested", ActivityContext(
            context_type=ContextType.HOLIDAY,
            exercise_intensity=ExerciseIntensity.LIGHT,
            hours_since_exercise=6.0,
        )),
        ("Night shift, muscle cramps", ActivityContext(
            context_type=ContextType.NIGHT_SHIFT,
            illness=IllnessType.MUSCLE_CRAMPS,
            illness_severity=0.5,
        )),
        ("Clinic visit, fasting 14h", ActivityContext(
            context_type=ContextType.MEDICAL_VISIT,
            fasting=True,
            food_recency_hours=14.0,
        )),
    ]

    for label, ctx in cases:
        print(f"\n--- {label} ---")
        print(f"  Gamma modifier: {ctx.gamma_modifier():.3f}")
        print(f"  HRV correction: +{ctx.hrv_adjustment_ms():.1f}ms")
        print(f"  sigma adjustment: {ctx.stress_index_adjustment():+.3f}")
        gate = ctx.mcts_action_gate()
        if gate['blocked_actions']:
            print(f"  Blocked: {gate['blocked_actions']}")
        for w in gate['warnings']:
            print(f"  NOTE: {w}")

    print("\n--- Food-drug interaction: levothyroxine, 1h post-meal ---")
    ctx_med = ActivityContext(food_recency_hours=1.0)
    result = ctx_med.pkpd_food_gate('levothyroxine')
    print(f"  OK={result['ok']}  Note: {result['note']}")

    print("\n--- Food-drug interaction: metformin, 30min post-meal ---")
    ctx_med2 = ActivityContext(food_recency_hours=0.5)
    result2 = ctx_med2.pkpd_food_gate('metformin')
    print(f"  OK={result2['ok']}  Note: {result2['note']}")


if __name__ == "__main__":
    worked_example()
