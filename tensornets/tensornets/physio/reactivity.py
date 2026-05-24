"""
Individual Reactivity Profiles for the HTN framework.

The four archetypes the user identified map onto distinct neurobiological
and psychological profiles. Each is characterised by four parameters that
directly modify the Γ matrix (autonomic recovery operator):

┌────────────────────┬──────────────┬────────────┬────────────┬─────────────┐
│ Archetype          │ threshold    │ gain       │ lability   │ rumination  │
│                    │ (activation) │ (amplitude)│ (speed)    │ (decay)     │
├────────────────────┼──────────────┼────────────┼────────────┼─────────────┤
│ HYPERSENSITIVE     │ low (0.15)   │ high (1.8) │ medium     │ medium      │
│ "goes crazy at     │              │            │            │             │
│  slightest trigger"│              │            │            │             │
├────────────────────┼──────────────┼────────────┼────────────┼─────────────┤
│ STOIC              │ high (0.60)  │ low (0.7)  │ slow       │ low         │
│ "calm even in      │              │            │            │             │
│  high stress"      │              │            │            │             │
├────────────────────┼──────────────┼────────────┼────────────┼─────────────┤
│ LABILE             │ medium (0.35)│ high (1.6) │ very fast  │ very low    │
│ "explodes, then    │              │            │            │             │
│  quickly agrees"   │              │            │            │             │
├────────────────────┼──────────────┼────────────┼────────────┼─────────────┤
│ RUMINANT           │ low-med(0.25)│ medium(1.1)│ slow onset │ very high   │
│ "holds grudge      │              │            │            │             │
│  even when calm"   │              │            │            │             │
└────────────────────┴──────────────┴────────────┴────────────┴─────────────┘

Parameters and their meaning in the HTN framework
-------------------------------------------------
threshold  : The stress_index level below which the system does NOT activate.
             Below threshold, Γ = Γ_baseline (normal recovery).
             Above threshold, the gain and decay parameters take over.
             Maps to: the *non-linearity* in H_eff — the imaginary part of H_eff
             creates a bifurcation at the threshold level.

gain       : Multiplier on Γ at and above threshold.
             Γ_eff = Γ_baseline * gain when stress_index >= threshold.
             HYPERSENSITIVE: gain 1.8 → Γ 80% larger → recovery 80% slower.
             STOIC: gain 0.7 → Γ 30% smaller → even under stress, recovers fast.

lability   : Rate at which stress rises toward the gain plateau.
             High lability = rapid escalation (explosive archetype).
             Formally: α_rise in the sigmoidal transfer function.
             E(σ) = gain / (1 + exp(-α_rise * (σ - threshold)))

rumination : Rate at which Γ decays back to baseline after stressor removal.
             High rumination = slow decay even when σ is back at baseline.
             Implements a second "grudge" state variable R_t:
             dR/dt = -α_ruminant * R_t + β_ruminant * Γ_spike
             Γ_total = Γ_eff + R_t (rumination adds to current recovery burden)

Non-Hermitian connection
------------------------
In H_eff = H₀ - iΓ, the Γ matrix captures decay (loss of coherence).
- threshold → bifurcation point in the non-linear extension of H_eff
- gain → scales Im(H_eff) above threshold
- lability → controls the *imaginary* eigenvalue growth rate
- rumination → adds a persistent imaginary eigenvalue component (slow mode)

A ruminant patient has an H_eff with two imaginary timescales:
  - Fast: current stress (decays at γ_hrv)
  - Slow: accumulated "grudge state" (decays at γ_ruminant << γ_hrv)

This maps to a two-band MPS: one bond for fast dynamics, one for slow.

References
----------
- Barlow (2002). Anxiety and Its Disorders. (threshold / sensitization)
- Gross (1998). Emotion regulation in adulthood. (lability / regulation)
- Nolen-Hoeksema (1991). Rumination and depression. J Abnorm Psychol.
- Thayer & Lane (2000). A model of neurovisceral integration. J Psychosom Res.
  (vagal tone / threshold connection to HRV)
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass, field
from typing import Optional


# ── Archetype enum ─────────────────────────────────────────────────────────────

class ReactivityArchetype(str, enum.Enum):
    HYPERSENSITIVE = "hypersensitive"   # low threshold, high gain
    STOIC          = "stoic"            # high threshold, low gain
    LABILE         = "labile"           # fast rise AND fast decay
    RUMINANT       = "ruminant"         # medium gain but very slow decay


# ── Per-subject reactivity profile ────────────────────────────────────────────

@dataclass
class ReactivityProfile:
    """
    Subject-level trait parameters that modify the Γ operator.

    These are *stable traits*, not states — they do not change turn-by-turn.
    They do change slowly over long therapy (months), modelled separately by
    phys/hysteresis.py.

    Fields
    ------
    subject_id        : str
    archetype         : ReactivityArchetype (informational; params are the ground truth)
    threshold         : float  — stress_index at which gain activates (0–1)
    gain              : float  — Γ multiplier above threshold
    alpha_rise        : float  — lability: rate of sigmoidal rise (default 10)
    gamma_ruminant    : float  — grudge decay rate (per turn); 0 = no rumination
    beta_ruminant     : float  — how much of each Γ spike feeds into grudge state
    hrv_baseline_adj  : float  — personal HRV baseline offset (ms, signed)
                                 (stoic may have higher resting HRV than population mean)
    """
    subject_id:        str
    archetype:         ReactivityArchetype = ReactivityArchetype.STOIC
    threshold:         float = 0.40
    gain:              float = 1.0
    alpha_rise:        float = 10.0
    gamma_ruminant:    float = 0.0       # turns⁻¹; 0 = no rumination
    beta_ruminant:     float = 0.0       # fraction of Γ spike captured as grudge
    hrv_baseline_adj:  float = 0.0       # ms; added to population baseline (35ms)

    # Runtime state — changes per turn
    _ruminant_state:   float = field(default=0.0, repr=False, compare=False)

    @staticmethod
    def from_archetype(subject_id: str, archetype: ReactivityArchetype) -> "ReactivityProfile":
        """Create a profile from one of the four canonical archetypes."""
        params = _ARCHETYPE_PARAMS[archetype]
        return ReactivityProfile(subject_id=subject_id, archetype=archetype, **params)

    def gamma_modifier(self, stress_index: float) -> float:
        """
        Compute the Γ multiplier for the current stress level.

        Uses a sigmoid to model the gradual onset above threshold.
        γ_eff = baseline * (gain_sigmoid(σ) + ruminant_state_contribution)
        """
        # Sigmoidal gain above threshold
        s    = stress_index - self.threshold
        g    = 1.0 + (self.gain - 1.0) / (1.0 + math.exp(-self.alpha_rise * s))
        # Ruminant state adds extra Γ regardless of current stress
        r    = self._ruminant_state
        return max(0.3, g + r)

    def update_ruminant_state(self, stress_index: float) -> float:
        """
        Update the grudge state after one turn.
        Call AFTER computing the current turn's Γ modifier.

        Input: current *stress_index* (not γ_mod) — so the grudge state is driven
        by external stress only, not by its own feedback (prevents runaway).

        R_t+1 = R_t * (1 - γ_ruminant) + β_ruminant * stress_above_threshold
        stress_above_threshold = max(0, σ - threshold), clamped to [0, 1].
        Returns the new ruminant state (saturates at 2.0).
        """
        excess = max(0.0, min(1.0, stress_index - self.threshold))
        new_r  = self._ruminant_state * (1.0 - self.gamma_ruminant) + self.beta_ruminant * excess
        self._ruminant_state = min(2.0, max(0.0, new_r))
        return self._ruminant_state

    def effective_hrv_baseline(self, population_baseline_ms: float = 35.0) -> float:
        """Personal resting HRV baseline, accounting for trait adjustment."""
        return max(8.0, population_baseline_ms + self.hrv_baseline_adj)

    def stress_label_override(self, stress_index: float) -> Optional[str]:
        """
        Produce an override stress label for the LLM prompt when the
        archetype implies a different *behavioural* response than the raw stress
        index suggests.

        For example: a RUMINANT patient with stress_index=0.2 (technically 'calm')
        may still be holding a grudge from a previous session — the LLM should know.
        A STOIC patient with stress_index=0.65 may not show external symptoms.
        """
        if self.archetype == ReactivityArchetype.RUMINANT and self._ruminant_state > 0.2:
            return f"ruminant_active (grudge_state={self._ruminant_state:.2f})"
        if self.archetype == ReactivityArchetype.STOIC and stress_index > 0.55:
            return f"stoic_masked_stress (external presentation likely calm)"
        if self.archetype == ReactivityArchetype.LABILE and stress_index > self.threshold:
            return f"labile_escalating (expect rapid peak then rapid resolution)"
        if self.archetype == ReactivityArchetype.HYPERSENSITIVE and stress_index > 0.15:
            return f"hypersensitive_activated (even mild stimuli are distressing)"
        return None


# ── Canonical archetype parameters ────────────────────────────────────────────

_ARCHETYPE_PARAMS: dict[ReactivityArchetype, dict] = {

    ReactivityArchetype.HYPERSENSITIVE: {
        # Low threshold: activates at slight provocation
        # High gain: large Γ when activated → recovery is slow
        # Medium lability: not explosive, but sustained
        # Low-medium rumination: remembers stressors but doesn't chronically hold
        "threshold":        0.15,
        "gain":             1.80,
        "alpha_rise":       12.0,
        "gamma_ruminant":   0.06,
        "beta_ruminant":    0.10,
        "hrv_baseline_adj": -8.0,   # lower resting HRV than average (anxious nervous system)
    },

    ReactivityArchetype.STOIC: {
        # High threshold: large stressors required for activation
        # Low gain: even when activated, Γ is only slightly elevated
        # Slow lability: gradual onset of stress response
        # Very low rumination: recovers quickly and completely
        "threshold":        0.60,
        "gain":             0.70,
        "alpha_rise":       5.0,
        "gamma_ruminant":   0.01,
        "beta_ruminant":    0.02,
        "hrv_baseline_adj": +12.0,  # higher resting HRV (well-regulated ANS)
    },

    ReactivityArchetype.LABILE: {
        # Medium threshold
        # High gain: strong peak response
        # Very high lability (alpha_rise=25): extremely fast escalation AND fast resolution
        # Very low rumination: once calmed, truly calm — no grudge
        "threshold":        0.35,
        "gain":             1.60,
        "alpha_rise":       25.0,
        "gamma_ruminant":   0.02,
        "beta_ruminant":    0.01,
        "hrv_baseline_adj": +3.0,
    },

    ReactivityArchetype.RUMINANT: {
        # Low-medium threshold
        # Medium gain: stress response not extreme at peak
        # Slow lability (alpha_rise=4): gradual escalation
        # VERY high rumination: grudge state persists for many turns/sessions
        "threshold":        0.25,
        "gain":             1.15,
        "alpha_rise":       4.0,
        "gamma_ruminant":   0.025,  # decays only 2.5% per turn → very persistent
        "beta_ruminant":    0.35,   # 35% of each Γ spike is captured as grudge
        "hrv_baseline_adj": -4.0,
    },
}


# ── Population distribution for sampling ─────────────────────────────────────

# Approximate population prevalence (clinical population, not general)
ARCHETYPE_PRIOR = {
    ReactivityArchetype.HYPERSENSITIVE: 0.30,
    ReactivityArchetype.STOIC:          0.20,
    ReactivityArchetype.LABILE:         0.25,
    ReactivityArchetype.RUMINANT:       0.25,
}


def sample_profile(
    subject_id: str,
    archetype: Optional[ReactivityArchetype] = None,
    noise: float = 0.1,
) -> ReactivityProfile:
    """
    Create a profile, optionally perturbing canonical parameters with Gaussian noise.
    This models individual variation within each archetype.

    noise: standard deviation as fraction of each parameter value.
    """
    import random
    if archetype is None:
        archetypes = list(ARCHETYPE_PRIOR.keys())
        weights    = list(ARCHETYPE_PRIOR.values())
        archetype  = random.choices(archetypes, weights=weights)[0]

    p = ReactivityProfile.from_archetype(subject_id, archetype)

    if noise > 0:
        def perturb(v, lo, hi):
            return max(lo, min(hi, v * (1 + random.gauss(0, noise))))
        p.threshold      = perturb(p.threshold,      0.05, 0.95)
        p.gain           = perturb(p.gain,            0.3,  3.0)
        p.gamma_ruminant = perturb(p.gamma_ruminant,  0.0,  0.5)
        p.beta_ruminant  = perturb(p.beta_ruminant,   0.0,  0.8)
        p.hrv_baseline_adj = p.hrv_baseline_adj + random.gauss(0, 4.0)

    return p


# ── MCTS cost function adaptation ─────────────────────────────────────────────

def mcts_archetype_hint(profile: ReactivityProfile, stress_index: float) -> str:
    """
    Returns a strategic hint for the MCTS agent tailored to the subject's reactivity.
    Injected into the LLM system prompt alongside the physio hint.
    """
    label = profile.stress_label_override(stress_index)
    base  = f"Subject reactivity: {profile.archetype.value}"

    if profile.archetype == ReactivityArchetype.HYPERSENSITIVE:
        return (
            f"{base}. Any confrontational language or new clinical information "
            f"risks triggering a stress cascade. Use very gradual information delivery. "
            f"Current threshold: {profile.threshold:.2f}."
            + (f" STATUS: {label}" if label else "")
        )
    if profile.archetype == ReactivityArchetype.STOIC:
        return (
            f"{base}. This patient does not show distress externally. Do not "
            f"interpret absence of complaint as absence of stress. Standard "
            f"de-escalation may feel condescending — prefer direct, factual framing."
            + (f" STATUS: {label}" if label else "")
        )
    if profile.archetype == ReactivityArchetype.LABILE:
        return (
            f"{base}. Expect rapid escalation followed by equally rapid resolution. "
            f"Do not over-de-escalate or extend soothing — this can delay the natural "
            f"resolution. Acknowledge briefly, then move to content."
            + (f" STATUS: {label}" if label else "")
        )
    if profile.archetype == ReactivityArchetype.RUMINANT:
        rstate = profile._ruminant_state
        return (
            f"{base}. This patient holds unresolved emotional states across sessions. "
            f"Current grudge state: {rstate:.3f}. Address unresolved grievances "
            f"BEFORE introducing new information. Closure is prerequisite to compliance."
            + (f" STATUS: {label}" if label else "")
        )
    return base


# ── Quick demo ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import numpy as np

    stress_levels = [0.1, 0.2, 0.35, 0.5, 0.65, 0.80]
    print("\nΓ modifier by archetype at various stress levels")
    print(f"{'Stress':>8}  " + "  ".join(f"{a.value:>16}" for a in ReactivityArchetype))
    print("-" * 90)
    profiles = {a: ReactivityProfile.from_archetype(f"demo_{a.value}", a) for a in ReactivityArchetype}
    for s in stress_levels:
        mods = {a: f"{p.gamma_modifier(s):.4f}" for a, p in profiles.items()}
        print(f"{s:>8.2f}  " + "  ".join(f"{mods[a]:>16}" for a in ReactivityArchetype))

    print("\nRuminant grudge accumulation (5 turns of stress_index=0.7, then calm):")
    r = ReactivityProfile.from_archetype("test", ReactivityArchetype.RUMINANT)
    for t in range(1, 11):
        si = 0.7 if t <= 5 else 0.1
        mod = r.gamma_modifier(si)
        r.update_ruminant_state(si)
        label = r.stress_label_override(si) or "normal"
        print(f"  Turn {t:2d} σ={si}  γ_mod={mod:.4f}  grudge={r._ruminant_state:.4f}  [{label}]")
