"""
Pharmacokinetics / Pharmacodynamics (PK/PD) models for the HTN framework.

These models answer: given that a patient took drug D at dose X, how does that
drug affect the Γ matrix (autonomic recovery operator) over the next N turns?

The output is a Γ_drug_modifier(t) — a scalar time-series that modulates the
Γ diagonal built by build_Gamma() in core/operators.py.

PK/PD overview
--------------
PK (Pharmacokinetics): how drug concentration changes over time.
    One-compartment: dC/dt = -ke * C          (first-order elimination)
    Two-compartment: adds a shallow "peripheral" compartment that delays peak effect.

PD (Pharmacodynamics): how concentration produces effect.
    E_max model: E(C) = E_max * C / (EC50 + C)
    where E_max = maximum possible effect, EC50 = concentration at half-max effect.

For HRV / Γ, the drug effect translates to:
    gamma_drug_modifier = 1 - E(C_effect)    if drug reduces sympathetic tone
    gamma_drug_modifier = 1 + E(C_effect)    if drug increases sympathetic tone

Drugs modelled
--------------
METOPROLOL    Beta-1 blocker. Reduces heart rate variability loss under stress.
              → raises HRV → increases γ (faster recovery) → REDUCES Γ diagonal.
              Clinical: 25–100mg oral. t½ ≈ 3–7h. Ke0 equilibration ≈ 30min.

SSRI          Selective serotonin reuptake inhibitor (sertraline archetype).
              Two timescales:
                - Fast: serotonin syndrome-like activation (first 1–2 weeks) → INCREASES Γ
                - Slow: receptor downregulation (4–8 weeks) → REDUCES Γ
              Clinical: 50–200mg oral. t½ ≈ 26h.

BENZODIAZEPINE  Short-acting anxiolytic (lorazepam archetype).
              Rapid onset, enhances GABAergic inhibition.
              → strong acute reduction of Γ, but tolerance builds session-by-session.
              Clinical: 0.5–4mg oral. t½ ≈ 10–20h.

NALTREXONE    Opioid receptor antagonist. Used in alcohol/opioid deaddiction.
              Blocks reward signal on substance use → reduces craving HRV response.
              Modelled as a "craving Γ modifier": after substance-use trigger, 
              the Γ spike is attenuated by naltrexone.
              Clinical: 50mg oral daily. t½ ≈ 4–13h.

References
----------
Kleiger et al. (2005). Ann Noninvasive Electrocardiol. (beta-blockers + HRV)
Agelink et al. (2001). Psychopharmacology. (SSRIs + HRV: early activation / late restoration)
Koran & Litt (1988). J Clin Psychopharmacol. (BZD + ANS)
Mason et al. (1999). Alcohol Clin Exp Res. (naltrexone + HRV under cue-exposure)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable


# ── Generic PK/PD base ────────────────────────────────────────────────────────

@dataclass
class OneCptPK:
    """
    One-compartment pharmacokinetics with first-order absorption and elimination.

    Plasma concentration C(t) = F * D / Vd * (ka/(ka-ke)) * (exp(-ke*t) - exp(-ka*t))
    where ka = absorption rate, ke = elimination rate, F = bioavailability, Vd = volume.
    """
    dose_mg:        float
    bioavailability: float      # F (0–1)
    vd_L_per_kg:    float       # apparent volume of distribution
    weight_kg:      float       # subject weight (default 70kg used if missing)
    ka_per_h:       float       # absorption rate constant
    ke_per_h:       float       # elimination rate constant

    def concentration_at(self, t_hours: float) -> float:
        """Plasma concentration at time t (mg/L)."""
        if t_hours < 0:
            return 0.0
        F  = self.bioavailability
        D  = self.dose_mg
        Vd = self.vd_L_per_kg * self.weight_kg
        ka = self.ka_per_h
        ke = self.ke_per_h
        if abs(ka - ke) < 1e-6:
            ke = ke * 1.001   # avoid division by zero
        C = (F * D / Vd) * (ka / (ka - ke)) * (
            math.exp(-ke * t_hours) - math.exp(-ka * t_hours)
        )
        return max(0.0, C)

    def half_life_h(self) -> float:
        return math.log(2) / self.ke_per_h

    def tmax_h(self) -> float:
        return math.log(self.ka_per_h / self.ke_per_h) / (self.ka_per_h - self.ke_per_h)


@dataclass
class EffectSite:
    """
    Effect-site (biophase) compartment. Adds a delay between plasma concentration
    and pharmacological effect using a ke0 equilibration rate.

    dCe/dt = ke0 * (Cp - Ce)
    Approximation for a single step: Ce(t+Δt) = Ce + ke0*Δt*(Cp - Ce)
    """
    ke0_per_h:  float
    ce:         float = 0.0     # current effect-site concentration

    def step(self, cp: float, dt_h: float = 1.0) -> float:
        """Euler step. Returns updated Ce."""
        self.ce = self.ce + self.ke0_per_h * dt_h * (cp - self.ce)
        return self.ce


@dataclass
class EmaxPD:
    """
    E_max pharmacodynamic model: E(Ce) = Emax * Ce / (EC50 + Ce)

    Returns a fractional effect in [0, Emax].
    """
    emax:   float     # maximum effect (0–1 when used as Γ modifier)
    ec50:   float     # concentration at half-max effect (mg/L)
    gamma:  float = 1.0   # Hill coefficient (steepness); 1 = basic E_max

    def effect(self, ce: float) -> float:
        if ce <= 0:
            return 0.0
        return self.emax * (ce ** self.gamma) / (self.ec50 ** self.gamma + ce ** self.gamma)


# ── Individual drug models ─────────────────────────────────────────────────────

class MetoprololModel:
    """
    Metoprolol succinate 50mg oral.

    Effect: beta-1 blockade → reduces sympathetic HRV suppression.
    Net on Γ: REDUCES diagonal (faster recovery, higher HRV).
    modifier = 1 - effect(Ce)   → Γ_eff = Γ_baseline * modifier
    """

    def __init__(self, dose_mg: float = 50.0, weight_kg: float = 70.0):
        self.pk = OneCptPK(
            dose_mg         = dose_mg,
            bioavailability = 0.50,
            vd_L_per_kg     = 4.2,
            weight_kg       = weight_kg,
            ka_per_h        = 1.0,         # tmax ≈ 1h
            ke_per_h        = math.log(2) / 5.0,    # t½ ≈ 5h
        )
        self.ke0    = EffectSite(ke0_per_h=1.5)   # equilibration ≈ 30min
        self.pd     = EmaxPD(emax=0.40, ec50=0.035)  # 40% max Γ reduction

    def gamma_modifier_at(self, t_hours: float) -> float:
        cp = self.pk.concentration_at(t_hours)
        ce = self.ke0.step(cp)
        return 1.0 - self.pd.effect(ce)

    def trajectory(self, duration_h: float = 24.0, step_h: float = 0.5) -> list[dict]:
        self.ke0 = EffectSite(ke0_per_h=1.5)   # reset
        steps = int(duration_h / step_h) + 1
        out   = []
        for i in range(steps):
            t  = i * step_h
            cp = self.pk.concentration_at(t)
            ce = self.ke0.step(cp, step_h)
            out.append({
                "t_h":      round(t, 2),
                "cp_mg_L":  round(cp, 5),
                "ce_mg_L":  round(ce, 5),
                "effect":   round(self.pd.effect(ce), 4),
                "gamma_mod": round(1.0 - self.pd.effect(ce), 4),
            })
        return out


class SSRIModel:
    """
    SSRI archetype (sertraline 50mg daily).

    Two-timescale model:
      - Fast channel (t½ ≈ 7 days): acute serotonergic activation → INCREASES Γ
        (first 1–2 weeks: restlessness, activation, possible anxiety increase)
      - Slow channel (t½ ≈ 42 days): receptor downregulation → REDUCES Γ
        (weeks 4–8: HRV recovery, reduced anxiety)

    Net modifier: 1 + effect_fast(Ce_fast) - effect_slow(Ce_slow)

    References: Agelink et al. (2001); Thayer & Lane (2007).
    """

    def __init__(self, dose_mg: float = 50.0, weight_kg: float = 70.0):
        self.pk = OneCptPK(
            dose_mg         = dose_mg,
            bioavailability = 0.44,
            vd_L_per_kg     = 20.0,
            weight_kg       = weight_kg,
            ka_per_h        = 0.5,
            ke_per_h        = math.log(2) / 26.0,    # t½ ≈ 26h plasma
        )
        # Fast receptor sensitisation compartment (days scale)
        self._fast_level = 0.0
        self._slow_level = 0.0
        self.ke_fast = math.log(2) / (7 * 24)    # 7-day half-life
        self.ke_slow = math.log(2) / (42 * 24)   # 42-day half-life
        self.pd_fast = EmaxPD(emax=0.25, ec50=0.002)   # 25% Γ increase peak
        self.pd_slow = EmaxPD(emax=0.50, ec50=0.003)   # 50% Γ reduction at plateau

    def step_day(self, n_doses: int = 1) -> float:
        """Simulate n_doses doses (one per day). Returns gamma modifier at end."""
        for _ in range(n_doses):
            for dose_hour in range(24):
                t_in_day = dose_hour
                cp = self.pk.concentration_at(t_in_day)
                # Daily dosing accumulation approximation
                # Fast channel: builds over days, saturates ~week 1
                self._fast_level += self.ke_fast * (cp - self._fast_level)
                # Slow channel: builds over weeks, saturates ~week 6
                self._slow_level += self.ke_slow * (cp - self._slow_level)

        modifier = 1.0 + self.pd_fast.effect(self._fast_level) - self.pd_slow.effect(self._slow_level)
        return max(0.5, modifier)

    def trajectory_days(self, n_days: int = 90) -> list[dict]:
        """Return daily Γ modifier over n_days of treatment."""
        self._fast_level = 0.0
        self._slow_level = 0.0
        out = []
        for day in range(n_days):
            modifier = self.step_day(1)
            out.append({
                "day":       day + 1,
                "gamma_mod": round(modifier, 4),
                "fast":      round(self._fast_level, 6),
                "slow":      round(self._slow_level, 6),
                "phase":     "activation" if modifier > 1.0 else "restoration",
            })
        return out


class BenzodiazepineModel:
    """
    Short-acting BZD (lorazepam 1mg oral).

    Fast onset (tmax ≈ 2h), t½ ≈ 12h.
    Strong acute Γ reduction (up to 55%), but tolerance builds across sessions.
    tolerance_factor: starts at 1.0 (full effect), decays with repeated use.

    Tolerance model: ε_t+1 = ε_t * (1 - α_tol)  after each dose.
    """

    TOLERANCE_DECAY = 0.12    # 12% tolerance loss per administration

    def __init__(self, dose_mg: float = 1.0, weight_kg: float = 70.0):
        self.pk = OneCptPK(
            dose_mg         = dose_mg,
            bioavailability = 0.93,
            vd_L_per_kg     = 1.3,
            weight_kg       = weight_kg,
            ka_per_h        = 0.8,
            ke_per_h        = math.log(2) / 12.0,
        )
        self.ke0     = EffectSite(ke0_per_h=2.0)
        self.pd      = EmaxPD(emax=0.55, ec50=0.008, gamma=2.0)  # steep Hill curve
        self.tolerance = 1.0   # decays with repeated doses

    def administer(self):
        """Called each time the drug is taken. Reduces tolerance."""
        self.tolerance *= (1 - self.TOLERANCE_DECAY)

    def gamma_modifier_at(self, t_hours: float) -> float:
        cp = self.pk.concentration_at(t_hours)
        ce = self.ke0.step(cp)
        return 1.0 - self.pd.effect(ce) * self.tolerance

    def trajectory(self, n_doses: int = 5, duration_h: float = 48.0, step_h: float = 1.0) -> list[dict]:
        """Simulate n_doses at 24h intervals, showing tolerance effect."""
        self.ke0      = EffectSite(ke0_per_h=2.0)
        self.tolerance = 1.0
        self.administer()
        out = []
        for i in range(int(duration_h / step_h) + 1):
            t    = i * step_h
            # Re-administer at 24h intervals
            dose_n = int(t / 24)
            if dose_n > 0 and (t % 24 == 0) and dose_n < n_doses:
                self.pk.dose_mg = self.pk.dose_mg   # same dose
                self.administer()
            mod = self.gamma_modifier_at(t)
            out.append({
                "t_h":       round(t, 1),
                "gamma_mod": round(mod, 4),
                "tolerance": round(self.tolerance, 4),
            })
        return out


class NaltrexoneModel:
    """
    Naltrexone 50mg daily for opioid/alcohol deaddiction.

    Primary effect: blocks mu-opioid reward signal.
    On the Γ model: attenuates the Γ *spike* when a substance-related cue is presented.
    Without naltrexone: substance cue → Γ spike → patient stress → possible relapse.
    With naltrexone: the reward signal is blocked → Γ spike is attenuated.

    cue_attenuation(Ce): fraction by which the cue-triggered Γ spike is reduced.
    """

    def __init__(self, dose_mg: float = 50.0, weight_kg: float = 70.0):
        self.pk = OneCptPK(
            dose_mg         = dose_mg,
            bioavailability = 0.05,    # very low oral BA — active 6-beta-naltrexol metabolite
            vd_L_per_kg     = 19.0,
            weight_kg       = weight_kg,
            ka_per_h        = 0.7,
            ke_per_h        = math.log(2) / 10.0,   # t½ ≈ 10h (parent compound)
        )
        # Active metabolite 6β-naltrexol: t½ ≈ 13h, contributes significantly
        self.pk_met = OneCptPK(
            dose_mg         = dose_mg * 0.75,   # metabolite conversion fraction
            bioavailability = 0.10,
            vd_L_per_kg     = 11.0,
            weight_kg       = weight_kg,
            ka_per_h        = 0.5,
            ke_per_h        = math.log(2) / 13.0,
        )
        self.pd = EmaxPD(emax=0.70, ec50=0.0004, gamma=1.5)  # 70% max cue attenuation

    def cue_gamma_attenuation_at(self, t_hours: float) -> float:
        """
        Returns the fraction by which the cue-triggered Γ spike is REDUCED.
        0 = no attenuation (drug worn off); 0.7 = 70% attenuation at peak.
        """
        cp     = self.pk.concentration_at(t_hours)
        cp_met = self.pk_met.concentration_at(t_hours)
        ce     = cp + cp_met * 0.5    # rough equivalence weighting
        return self.pd.effect(ce)

    def trajectory(self, duration_h: float = 48.0, step_h: float = 0.5) -> list[dict]:
        out = []
        for i in range(int(duration_h / step_h) + 1):
            t    = i * step_h
            att  = self.cue_gamma_attenuation_at(t)
            out.append({
                "t_h":          round(t, 2),
                "cue_attenuation": round(att, 4),
                "gamma_mod_on_cue": round(1.0 - att, 4),
            })
        return out


# ── Composite: build_Gamma modifier ──────────────────────────────────────────

@dataclass
class DrugRegimen:
    """
    Describes a subject's current drug regimen.
    Used by build_Gamma() to compute the composite Γ modifier.
    """
    subject_id: str
    weight_kg:  float = 70.0
    drugs: dict[str, dict] = field(default_factory=dict)
    # {drug_name: {dose_mg, t_since_last_dose_h, tolerance_level, ...}}

    def gamma_modifier(self, cue_triggered: bool = False) -> float:
        """
        Compute the composite Γ modifier from all active drugs.

        Modifiers multiply:
            gamma_eff = gamma_hrv * product_of_drug_modifiers
        """
        modifier = 1.0

        if "metoprolol" in self.drugs:
            d = self.drugs["metoprolol"]
            m = MetoprololModel(d.get("dose_mg", 50), self.weight_kg)
            modifier *= m.gamma_modifier_at(d.get("t_h", 3.0))

        if "ssri" in self.drugs:
            d = self.drugs["ssri"]
            m = SSRIModel(d.get("dose_mg", 50), self.weight_kg)
            # Restore internal levels from stored state
            m._fast_level = d.get("fast_level", 0.0)
            m._slow_level = d.get("slow_level", 0.0)
            modifier *= m.step_day(0)   # no new dose — just read current modifier

        if "benzodiazepine" in self.drugs:
            d = self.drugs["benzodiazepine"]
            m = BenzodiazepineModel(d.get("dose_mg", 1.0), self.weight_kg)
            m.tolerance = d.get("tolerance", 1.0)
            modifier *= m.gamma_modifier_at(d.get("t_h", 2.0))

        if "naltrexone" in self.drugs and cue_triggered:
            d = self.drugs["naltrexone"]
            m = NaltrexoneModel(d.get("dose_mg", 50), self.weight_kg)
            modifier *= (1.0 - m.cue_gamma_attenuation_at(d.get("t_h", 2.0)))

        return max(0.3, modifier)   # safety floor: never reduce Γ by more than 70%


# ── Quick demo ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n=== Metoprolol 50mg — 24h Γ modifier ===")
    m = MetoprololModel(50)
    for pt in m.trajectory(24, 2)[:8]:
        print(f"  t={pt['t_h']:5.1f}h  Cp={pt['cp_mg_L']:.5f} mg/L  effect={pt['effect']:.4f}  γ_mod={pt['gamma_mod']:.4f}")

    print("\n=== SSRI 50mg — 90-day trajectory ===")
    s = SSRIModel(50)
    for pt in s.trajectory_days(90)[::14]:
        print(f"  Day {pt['day']:3d}  γ_mod={pt['gamma_mod']:.4f}  phase={pt['phase']}")

    print("\n=== Naltrexone 50mg — cue attenuation ===")
    n = NaltrexoneModel(50)
    for pt in n.trajectory(48, 4)[:8]:
        print(f"  t={pt['t_h']:5.1f}h  attenuation={pt['cue_attenuation']:.4f}  γ_mod_on_cue={pt['gamma_mod_on_cue']:.4f}")
