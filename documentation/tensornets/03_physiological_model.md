# Physiological State Model and Hysteresis

> Module: `tensornets/physio/`  
> Key classes: `PhysiologicalState`, `HystereticBaseline`, `ReactivityProfile`, `DrugRegimen`

---

## 1. Motivation

Standard AI health companions treat physiological state as metadata — a tag attached to a turn ("patient is stressed"). The HTN framework treats physiological state as the **primary constraint** on what the companion is allowed to do.

The distinction matters clinically. Consider two scenarios:

- **Scenario A**: Patient HRV is 18ms (acute stress). The companion should not attempt psychoeducation or challenge distortions. It should validate and ground.
- **Scenario B**: Patient HRV is 55ms (calm, post-exercise). The companion can introduce discrepancy, offer information, or negotiate.

The same words — "have you considered that your drinking is affecting your relationship?" — are therapeutic in Scenario B and clinically harmful in Scenario A. No amount of prompt engineering resolves this without a real-time physio model.

---

## 2. The physiological state vector

`PhysiologicalState` converts eight biological signals into a scalar **stress index** ∈ [0,1].

### Signal inventory

| Signal | Unit | Population range | Weight | Rationale |
|---|---|---|---|---|
| HRV (RMSSD) | ms | 20–80 | **0.35** | Strongest autonomic stress marker (Kleiger et al., 2005) |
| Electrodermal activity | μS | 0.5–20 | 0.20 | Sympathetic arousal (Boucsein, 2012) |
| Sleep deficit | hours | 0–8 | 0.15 | Cognitive load, emotional dysregulation (Walker, 2017) |
| Circadian phase | 0–23h | — | 0.10 | Cortisol rhythm (Czeisler, 1999) |
| Blood glucose | mmol/L | 3.5–10 | 0.10 | Ego depletion, self-control capacity (Inzlicht & Schmeichel, 2012) |
| Location stress index | [0,1] | — | 0.05 | Context (e.g., at a bar vs. at home) |
| Recent exercise | minutes | 0–90 | **−0.03** | Protective factor — reduces stress index |
| Caffeine load | mg | 0–600 | 0.02 | Mild sympathomimetic |

Signals are normalised to [0,1] within their population range and combined:

```python
stress_index = Σ(weight_i * normalised_signal_i)
```

The resulting scalar is clamped to [0.02, 0.98] to avoid hard decision boundaries.

### Stress buckets

For the bandit/Actor component, the stress index is discretised into three buckets:

| Bucket | Range | Interpretation |
|---|---|---|
| `low` | [0, 0.35) | Patient is calm and receptive |
| `moderate` | [0.35, 0.65) | Manageable tension |
| `high` | [0.65, 1.0] | Elevated arousal — restrict to grounding actions |

A critical gate applies when `stress_index >= 0.85`: only `validate`, `empathic_reflection`, `safety_protocol`, `acknowledge_only`, `escalate`, `flooding_hold`, `flooding_deepen`, and `spike_step` (in flooding mode) are permitted.

---

## 3. Hysteretic baseline: extinction learning

### 3.1 The clinical problem

When a patient undergoes cognitive-behavioural therapy or addiction counselling, they learn to suppress their conditioned response (craving, avoidance, compulsion) through **extinction** — repeated exposure without reinforcement. But extinction does not erase the original conditioned response. It creates a **second memory** that *competes* with the first.

This means:
- A patient who has successfully abstained for three months can relapse to full craving strength on a single cue exposure (reinstatement).
- A patient's fear response can return to near-full strength weeks after treatment ends even without any cue exposure (spontaneous recovery).
- Context matters: extinction learned in the therapist's office does not fully generalise to the patient's home or workplace.

### 3.2 Implementation

`HystereticBaseline` tracks a **fear weight** w_k(t) ∈ [0,1] for each of N triggers.

**Extinction (per exposure):**
```
w_k(t+1) = w_k(t) · λ_extinct + Δw_k(t)
```
where Δw_k is negative (inhibitory association strength update, Rescorla-Wagner style).

**Spontaneous recovery (between sessions):**
```
w_k ← max(W_FLOOR, w_k · (1 − α_rec · Δweeks))
```
Applied when a session opens after a gap. The floor `W_FLOOR = 0.08` represents **latent inhibition** — the conditioned response never fully extinguishes at the biological level (Bouton, 2002).

**Reinstatement:**
```
w_k ← min(1.0, w_k + α_reinstate · (1 − w_k))
```
Triggered when the patient's message contains cues matching the trigger's vocabulary (e.g., "I had a drink last night" for the `alcohol` trigger).

### 3.3 Triggers modelled

| Category | Triggers |
|---|---|
| Substance | `alcohol`, `nicotine`, `opioids`, `cocaine` |
| Behavioural | `gambling`, `food`, `screen`, `exercise` |
| Psychological | `social_anxiety`, `ptsd`, `generalised_anxiety`, `low_mood` |
| Physical | `chronic_pain` |

### 3.4 Integration with the Γ operator

`modulate_gamma(Gamma, trigger)` scales the diagonal of the Γ matrix:

```python
scale = 1.0 + (w_k - 0.5) * 0.8   # w=1.0 → scale=1.4, w=0.0 → scale=0.6
Gamma_modulated = Gamma * scale
```

A patient with high fear weight for a trigger has an *elevated* Γ — their nervous system is less able to recover from a stressful interaction around that trigger. The companion should approach those topics cautiously.

---

## 4. Deviation from the original PDS

The product design specification (`Tensor_nets.pdf`, §3.4) described the following architecture:

| Feature | PDS specification | Current implementation | Status |
|---|---|---|---|
| Γ integration | Continuous ODE over real-time wearable data | Discrete per-turn update | **Simplified** — wearables not yet integrated |
| Hysteresis triggers | Vocabulary-matched + physiological threshold | Vocabulary-matched only | **Partial** — physiological threshold deferred |
| Γ modulation | Full tensor rotation (unitary on physio bond subspace) | Diagonal scaling only | **Simplified** — full rotation pending bond compression stability |
| Fear weight learning | Updated from session outcomes via RL | Hard-coded Rescorla-Wagner parameters | **Partial** — RL-learned parameters deferred to Phase 5 |
| Wearable integration | Real-time HRV from BLE device | Inferred from conversation context or test fixtures | **Pending** — Phase 6 |
| Spontaneous recovery | Continuous time | Weekly granularity | **Acceptable** — session gap rarely < 1 week in practice |

The simplifications are intentional for the current research phase. The discrete per-turn model is mathematically tractable, measurable, and sufficient to test the core hypothesis.

---

## 5. ReactivityProfile — individual trait modifiers

`ReactivityProfile` applies on top of the hysteretic baseline to model **stable individual differences** in physiological reactivity.

### The Γ modifier formula

```python
activation = sigmoid(alpha_rise · (stress_index − threshold)) · gain
gamma_modifier = 1.0 + activation + ruminant_state
```

where `ruminant_state` is a slow-decaying accumulator that captures rumination (the tendency for psychological distress to persist after the stressor is removed).

### Archetype parameters

| Archetype | Threshold | Gain | Alpha-rise | Ruminant γ | Ruminant β | HRV baseline adj |
|---|---|---|---|---|---|---|
| HYPERSENSITIVE | 0.20 | 1.80 | 15.0 | 0.10 | 0.40 | −5 ms |
| STOIC | 0.60 | 0.60 | 5.0 | 0.0 | 0.0 | +8 ms |
| LABILE | 0.30 | 1.40 | 20.0 | 0.05 | 0.20 | 0 ms |
| RUMINANT | 0.35 | 1.20 | 8.0 | 0.20 | 0.60 | −3 ms |

The `hrv_baseline_adj` shifts the population-mean HRV baseline (35ms) for this individual — stoic patients have naturally higher resting HRV.

### Integration in training

In `arms.py`, `_stress_after_response(current_stress, action, archetype, drug_regimen)` applies the profile's modifier to the per-turn stress delta:

```python
delta = -(CALMING_WEIGHT[action] - 0.5) * 2.0 * DELTA_SCALE  # base delta
delta *= reactivity_profile.gamma_modifier(current_stress)     # archetype scaling
delta *= drug_regimen.gamma_modifier(cue_triggered)             # drug scaling
next_stress = clamp(current_stress + delta, 0.0, 1.0)
```

---

## 6. DrugRegimen — PK/PD Γ modifiers

The pharmacological layer models how a patient's current medication affects their physiological recovery capacity.

### Model types

**One-compartment PK (metoprolol, benzodiazepine):**
```
C(t) = (dose · F / Vd) · e^{−ke·t}   [mg/L]
E(C) = Emax · Cⁿ / (EC50ⁿ + Cⁿ)     [effect fraction]
```

**Two-compartment / two-timescale (SSRI):**
The SSRI model captures the well-known biphasic HRV effect: early serotonin activation (Γ↑, first 1–2 weeks) followed by receptor downregulation and HRV restoration (Γ↓, weeks 4–8). Each channel accumulates separately.

**Naltrexone (cue-attenuation):**
Specifically attenuates the Γ spike triggered by substance-use cues. Only active when `cue_triggered=True`.

### Safety floor

`DrugRegimen.gamma_modifier()` is floored at 0.30 — no drug combination can reduce the patient's autonomic tone by more than 70%. This prevents the model from predicting that a heavily medicated patient is "immune" to stress.

---

## 7. Key references

| Reference | Section |
|---|---|
| Bouton, M.E. (2002). Context, ambiguity, and unlearning. *Biological Psychiatry*, 52(10), 976–986. | Extinction, spontaneous recovery, reinstatement |
| Rescorla, R.A. & Wagner, A.R. (1972). A theory of Pavlovian conditioning. *Classical Conditioning II*. | Fear weight update rule |
| Maren, S. (2001). Neurobiology of Pavlovian fear conditioning. *Annual Review of Neuroscience*, 24. | Latent inhibition, W_FLOOR |
| Kleiger, R.E. et al. (2005). Heart rate variability. *Ann. Noninvasive Electrocardiol.*, 10(1), 88–101. | HRV weight, Metoprolol model |
| Agelink, M.W. et al. (2001). Autonomic neurocardiac function in patients with major depression and effects of antidepressive treatment with nefazodone and paroxetine. *J. Affective Disorders*, 62. | SSRI PK/PD model |
| Boucsein, W. (2012). *Electrodermal Activity* (2nd ed.). Springer. | EDA signal weight |
| Walker, M. (2017). *Why We Sleep*. Penguin. | Sleep deficit weight |
| Inzlicht, M. & Schmeichel, B.J. (2012). What is ego depletion? *Perspectives on Psychological Science*, 7(5). | Glucose / cognitive control link |
| Czeisler, C.A. (1999). Sleep deficiency and the biological clock. *JAMA*, 281(24). | Circadian weight |
| Koran, L.M. & Litt, I.F. (1988). Benzodiazepines and the ANS. *J. Clin. Psychopharmacol.*, 8(5). | BZD PK/PD model |
| Mason, B.J. et al. (1999). Naltrexone and HRV under cue exposure. *Alcohol Clin. Exp. Res.*, 23(10). | Naltrexone model |
