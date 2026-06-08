# Variable and Symbol Glossary

> Cross-referenced by all tensornets/ documentation. When a document uses a symbol,
> it links to this glossary for its definition. Last updated: 2026-06-04.

## How to use this glossary

Each section covers one subsystem. Every entry is a table row with:

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|

- **Symbol**: the mathematical character or code identifier used in formulae.
- **Technical Name**: the Python constant or variable name in the codebase.
- **Value / Range**: hard-coded scalar, or the physiological / algorithmic range.
- **Unit**: physical or dimensionless unit.
- **Source File**: path relative to `tensornets/tensornets/`.
- **Description**: one-sentence explanation of purpose and role in the framework.

Abbreviations used throughout: ANS = Autonomic Nervous System; MPS = Matrix Product State;
MCTS = Monte Carlo Tree Search; A3C = Asynchronous Advantage Actor-Critic;
RL = Reinforcement Learning; PK/PD = Pharmacokinetics/Pharmacodynamics;
TTM = Transtheoretical Model (Prochaska & DiClemente); HRV = Heart Rate Variability;
RMSSD = Root Mean Square of Successive Differences; EDA = Electrodermal Activity;
UCB1 = Upper Confidence Bound (variant 1); OU = Ornstein-Uhlenbeck process.

---
## 1. Physiological State Variables

Source module: `physio/state.py`

These are the raw sensor inputs that constitute a `PhysiologicalState` snapshot.
All are stored in native physical units and normalised to [0, 1] before MPS encoding.
The normalised vector feeds directly into the physiological bond subspace (χ_physio).

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| σ | `stress_index()` | [0, 1] clamped to [0.02, 0.98] | dimensionless | `physio/state.py` | Composite acute stress index. Drives the Γ matrix amplitude. Higher = more stressed = slower recovery. Output of the weighted sum of all 8 physiological signals. |
| RMSSD | `hrv_rmssd_ms` | [5.0, 120.0]; baseline 35 ms | ms | `physio/state.py` | Root Mean Square of Successive RR-interval Differences. Primary ANS arousal signal. Low RMSSD = sympathetic dominance = stressed. Ref: Shaffer & Ginsberg (2017). |
| HRV_MIN | `HRV_RMSSD_MIN_MS` | 5.0 | ms | `physio/state.py` | Minimum physiologically plausible RMSSD. Below this → validation error. |
| HRV_MAX | `HRV_RMSSD_MAX_MS` | 120.0 | ms | `physio/state.py` | Maximum physiologically plausible RMSSD. Used in log-normalisation ceiling. |
| HRV_BASE | `HRV_RMSSD_BASELINE_MS` | 35.0 | ms | `physio/state.py` | Population-mean resting RMSSD. Used as default subject baseline when individual history is unavailable. |
| G | `blood_glucose_mmol` | [2.9, 30.0]; normal 4.0–7.8 | mmol/L | `physio/state.py` | Blood glucose concentration. Proxy for cognitive energy availability. Below 3.9 = hypoglycaemia; above 10.0 = hyperglycaemia. Ref: ADA 2024. |
| G_hypo | `GLUCOSE_HYPOGLYCAEMIA` | 3.9 | mmol/L | `physio/state.py` | Hypoglycaemia threshold (ADA 2024). Below this, cognitive capacity is severely impaired. |
| G_lo | `GLUCOSE_NORMAL_LOW` | 4.0 | mmol/L | `physio/state.py` | Lower bound of normal fasting glucose range. |
| G_hi | `GLUCOSE_NORMAL_HIGH` | 7.8 | mmol/L | `physio/state.py` | Upper bound of normal postprandial glucose range. |
| G_hyper | `GLUCOSE_HYPERGLYCAEMIA` | 10.0 | mmol/L | `physio/state.py` | Hyperglycaemia marker. Above this value, glucose component is treated as an active stressor. |
| EDA | `eda_us` | [0.01, 20.0] | µS | `physio/state.py` | Electrodermal activity (skin conductance). Reflects sympathetic activation intensity. Source: WESAD dataset normalisation range. |
| EDA_MIN | `EDA_MIN_US` | 0.01 | µS | `physio/state.py` | Minimum plausible EDA reading. Used as normalisation floor. |
| EDA_MAX | `EDA_MAX_US` | 20.0 | µS | `physio/state.py` | Maximum EDA value. Normalisation ceiling; above this the signal is clamped. |
| τ | `time_of_day_h` | [0, 24) | h | `physio/state.py` | Local clock time as a float. Used to compute circadian cortisol phase offset. |
| τ_peak | `CIRCADIAN_PEAK_HOUR` | 8.0 | h | `physio/state.py` | Hour of day at which cortisol peaks (08:00). Used in cosine circadian model. Ref: Touitou et al. (2017). |
| τ_trough | `CIRCADIAN_TROUGH_HOUR` | 3.0 | h | `physio/state.py` | Hour of day at which cortisol troughs (03:00). Not directly used in formula but documents the cosine zero crossing. |
| ρ_loc | `location_stress_index` | [0, 1] | dimensionless | `physio/state.py` | Environmental stress prior. 0 = maximally calm setting; 1 = maximally stressful. Contributes 0.05 weight to σ. |
| S_last | `sleep_hours_last_night` | [3.0, 24.0]; default 7.0 | h | `physio/state.py` | Actual sleep duration the preceding night. Feeds both acute sleep pressure and chronic debt computation. |
| S_def | `sleep_deficit_hours` (field name `sleep_deficit_h` in docs) | [0, 15.0] | h | `physio/state.py` | Cumulative 3-night rolling sleep debt in hours below target. Cap: 3 × SLEEP_MAX_DEFICIT_HOURS = 15 h. |
| S_target | `SLEEP_TARGET_HOURS_ADULT` | 8.0 | h | `physio/state.py` | Recommended nightly sleep for adults (Hirshkowitz et al. 2015 NSF). |
| S_floor | `SLEEP_MIN_HOURS` | 3.0 | h | `physio/state.py` | Minimum sleep below which severe cognitive impairment floor applies. |
| S_maxdef | `SLEEP_MAX_DEFICIT_HOURS` | 5.0 | h | `physio/state.py` | Cap for chronic sleep debt normalisation (3 h sleep = max deficit in one night). |
| ε | `circadian_entrainment` | [0, 1]; default 0.7 | dimensionless | `physio/state.py` | Circadian alignment score. 1 = fully entrained (regular schedule); 0 = severely disrupted (shift work/jet lag). |
| RR | `respiratory_rate_bpm` | [8.0, 30.0]; normal 12–20 | breaths/min | `physio/state.py` | Respiratory rate. Tachypnea (> 20) amplifies sympathetic tone. Ref: Cretikos et al. (2008). |
| RR_lo | `RESP_RATE_NORMAL_LOW` | 12.0 | breaths/min | `physio/state.py` | Lower bound of normal eupnea range. |
| RR_hi | `RESP_RATE_NORMAL_HIGH` | 20.0 | breaths/min | `physio/state.py` | Upper bound of normal eupnea range. |

### 1.1 Stress Index Formula

The composite stress index `stress_index()` is computed as a weighted linear combination
of normalised physiological signals. From `physio/state.py` lines 283-291:

```
σ = 0.35 · (1 − HRV_norm)
  + 0.20 · EDA_norm
  + 0.15 · sleep_pressure
  + 0.12 · (1 − glucose_norm)
  + 0.08 · (circadian_phase × entrainment)
  + 0.05 · respiratory_norm
  + 0.05 · location_stress_index
```

Note: the user-facing specification uses the symbol layout from `physio/hrv.py` docstring
(`s_HRV`, `s_EDA`, etc.). The actual code in `state.py` has a slightly different 8-signal
breakdown where sleep_pressure subsumes both acute deficit and circadian entrainment to
avoid double-counting. The coefficients sum to 1.00.

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| w_HRV | HRV weight in σ | 0.35 | dimensionless | `physio/state.py` | Largest single weight; HRV is the primary ANS biomarker. Uses inverted normalised value (high HRV = low stress). |
| w_EDA | EDA weight in σ | 0.20 | dimensionless | `physio/state.py` | Sympathetic burst contribution to composite stress. |
| w_sleep | Sleep weight in σ | 0.15 | dimensionless | `physio/state.py` | Fatigue + circadian disruption combined. |
| w_gluc | Glucose weight in σ | 0.12 | dimensionless | `physio/state.py` | Cognitive resource availability (inverted: low glucose → higher stress). |
| w_circ | Circadian weight in σ | 0.08 | dimensionless | `physio/state.py` | Diurnal cortisol × entrainment factor. |
| w_resp | Respiratory weight in σ | 0.05 | dimensionless | `physio/state.py` | Fast sympathetic readout via breathing rate. |
| w_loc | Location weight in σ | 0.05 | dimensionless | `physio/state.py` | Environmental prior on contextual stress. |

### 1.2 Stress Label Thresholds

| Label | σ Range | Source File | Prompt Hint Summary |
|-------|---------|-------------|---------------------|
| `calm` | [0, 0.25) | `physio/state.py` | Standard conversational tone |
| `mild_stress` | [0.25, 0.45) | `physio/state.py` | Empathetic phrasing; no multi-item delivery |
| `moderate_stress` | [0.45, 0.65) | `physio/state.py` | Emotional acknowledgement before clinical info |
| `high_stress` | [0.65, 0.80) | `physio/state.py` | No new clinical decisions or financial info |
| `critical_stress` | [0.80, 1.0] | `physio/state.py` | Immediate de-escalation; consider human escalation |

### 1.3 HRV-to-Decay Mapping (`physio/hrv.py`)

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| γ | `gamma` | [0.05, 0.5] | turns⁻¹ | `physio/hrv.py` | Autonomic decay constant. Derived from real-time RMSSD. Small γ = stressed (slow recovery); large γ = calm (fast recovery). |
| γ_min | `GAMMA_MIN` | 0.05 | turns⁻¹ | `physio/hrv.py` | Minimum decay constant. Stress half-life ≈ 14 conversational turns (clinically fragile patient). |
| γ_max | `GAMMA_MAX` | 0.5 | turns⁻¹ | `physio/hrv.py` | Maximum decay constant. Stress half-life ≈ 1.4 turns (well-regulated patient). |
| α_hrv | `ALPHA_DEFAULT` | 1.0 | dimensionless | `physio/hrv.py` | Sensitivity exponent for HRV→γ mapping. α=1 is linear; increase for sharper threshold. Fit per-subject. |
| λ₁ | `lambda1` | [0, 1] | dimensionless | `physio/hrv.py` | Second eigenvalue magnitude of physiological transfer matrix. λ₁ = e^{−γΔt}. Close to 1 = slow decay (stressed). |
| Δt | `delta_t` | 1.0 default | turns | `physio/hrv.py` | Conversational time step. One "turn" = one exchange in the dialogue loop. |

---

## 2. Hysteresis Parameters

### 2.1 Longitudinal Fear-Association Hysteresis (`physio/hysteresis.py`)

Models between-session learning and forgetting of conditioned fear responses.
Three phenomena: extinction (therapy reduces fear), spontaneous recovery (gap → partial
rebound), and reinstatement (unrelated stressor reactivates old fear).

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| w_k | `w_current` | [W_FLOOR, 1.0] | dimensionless | `physio/hysteresis.py` | Current fear-association weight for trigger k. 1.0 = full panic; W_FLOOR = minimal residual. |
| w₀ | `w_original` | [0, 1.0] | dimensionless | `physio/hysteresis.py` | Original (untreated) fear weight at first assessment. The asymptotic recovery target. |
| W_MAX | `W_MAX` | 1.0 | dimensionless | `physio/hysteresis.py` | Maximum observable fear weight (untreated, full conditioned response). |
| W_FLOOR | `W_FLOOR` | 0.08 | dimensionless | `physio/hysteresis.py` | Latent inhibition floor. Even fully treated patients retain a residual trace; spontaneous recovery requires it (Bouton 2004). |
| α_ext | `alpha_ext` | 0.03 (default per trigger) | per session | `physio/hysteresis.py` | Extinction rate per therapy session. Governs: Δw = α_ext · (w_current − W_FLOOR) · session_intensity. Range in docstring: [0, 0.05]. |
| α_rec | `ALPHA_RECOVERY_PER_WEEK` | 0.025 | per week | `physio/hysteresis.py` | Spontaneous recovery rate. Used in: gap_factor = 1 − exp(−α_rec · weeks). Passive recovery toward w₀ during therapy gaps. |
| α_reinstate | `ALPHA_REINSTATEMENT` | 0.45 | dimensionless | `physio/hysteresis.py` | Reinstatement amplification coefficient. Δw = α_reinstate · (w₀ − w_current) · stress_magnitude. Note: user-facing docs say 0.20; actual code value is **0.45**. |
| session_intensity | (parameter) | [0, 1] | dimensionless | `physio/hysteresis.py` | How directly a therapy session targeted a specific trigger. 0 = untargeted; 1 = intensive direct exposure. |
| SUDS | `suds_equivalent()` | [0, 100] | SUDS points | `physio/hysteresis.py` | Subjective Units of Distress Scale equivalent. Computed as round(w_current × 100). |
| Γ_mod | `gamma_modifier()` | 1.0 + w_current · r_factor | dimensionless | `physio/hysteresis.py` | Multiplicative modifier applied to Γ diagonal. w=1.0, r=1.0 → doubles Γ; w=W_FLOOR → adds only 8%. |
| Γ_scale | (Γ modulation scale, docstring) | 1.0 + (w_k − 0.5) · 0.8 | dimensionless | `physio/hysteresis.py` | Alternative scale expression used in architecture docs showing how the midpoint w=0.5 maps to a 1.0× neutral modifier. |

### 2.2 Extinction / Recovery Equations

```
Extinction  (one session):
    w_{t+1} = max(W_FLOOR,  w_t − α_ext · (w_t − W_FLOOR) · session_intensity)

Spontaneous recovery  (Δweeks gap, no therapy):
    gap_factor  = 1 − exp(−α_rec · Δweeks)
    w_recovered = w_t + (w₀ − w_t) · gap_factor
    w_recovered = min(w₀, w_recovered)

Reinstatement  (unrelated stressor, magnitude m ∈ [0,1]):
    w_reinstated = min(w₀,  w_t + α_reinstate · (w₀ − w_t) · m)
```

### 2.3 Companion Relationship Hysteresis (`agents/companion_hysteresis.py`)

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| A | `alliance` | [0, 1]; init 0.3 | dimensionless | `agents/companion_hysteresis.py` | Working Alliance score (Bordin 1979). Accumulates over positive sessions; disrupted by rupture events. |
| α_build | `alpha_build` | 0.08 | per session | `agents/companion_hysteresis.py` | Alliance gain rate per positive session (formation rate). |
| α_rupture | `alpha_rupture` | 0.30 | per session | `agents/companion_hysteresis.py` | Alliance loss rate per rupture event. Fast asymmetry (Safran & Muran 2000): rupture is ~7.5× faster than repair. |
| α_repair | `alpha_repair` | 0.04 | per session | `agents/companion_hysteresis.py` | Alliance repair rate per remediation session. Slow recovery — hysteretic asymmetry is the therapeutic challenge. |
| α_patience_dep | `alpha_patience_depletion` | 0.12 | per session | `agents/companion_hysteresis.py` | Strategic patience depletion rate per non-compliant patient session. |
| α_patience_rec | `alpha_patience_recovery` | 0.03 | per session | `agents/companion_hysteresis.py` | Strategic patience recovery rate per compliant session (slow restoration). |
| P | `strategic_patience` | [0, 1]; init 1.0 | dimensionless | `agents/companion_hysteresis.py` | Companion's remaining investment in rapport-building before shifting MCTS weights toward direct goal pursuit. Depletes with non-compliance; resets with successful disclosures. |
| F | `frustration_weight` | [0, 1]; init 0.0 | dimensionless | `agents/companion_hysteresis.py` | Accumulated non-compliance signal. Grows with repeated redirects; shifts MCTS cost weights. Not emotional frustration — a strategic signal. |
| trust | `trust` | [0, 1]; init 0.3 | dimensionless | `agents/companion_hysteresis.py` | Narrower than alliance: confidence that the companion tells the truth and is competent. Damaged by factual errors or insensitive statements. |

---

## 3. MPS / Tensor Network Parameters

Source module: `core/mps.py`, `core/operators.py`

### 3.1 Matrix Product State Structure

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| χ | `chi` (total bond dimension) | χ_semantic + χ_physio | dimensionless | `core/mps.py` | Total MPS bond dimension. Partitioned into semantic and physiological subspaces. Complexity O(N·d·χ²) per contraction. |
| χ_semantic | `chi_semantic` | 4 (demo default `CHI_S`) | dimensionless | `core/mps.py` | Bond dimension allocated to semantic/logical context channels. Carries discrete token context. |
| χ_physio | `chi_physio` | ≥ 5 (demo default `CHI_P=5`) | dimensionless | `core/mps.py` | Bond dimension allocated to physiological subspace. Must be ≥ number of physio signals (8 for full model). |
| d | `vocab_size` | 8 (demo default `VOCAB`) | dimensionless | `core/mps.py` | Physical index dimension (feature/vocabulary dimension per MPS site). Each core tensor has shape [χ_left, d, χ_right]. |
| N | `n_tokens` | sequence length | sites | `core/mps.py` | Number of MPS sites (conversational turns or token positions). Each site holds one core tensor. |
| A^{(t)} | `CoreTensor.data` | shape [χ_left, d, χ_right] | — | `core/mps.py` | 3rd-order core tensor at position t. Left/right indices are virtual bond indices; physical index is the token/feature dimension. |
| r | alternative for χ | see χ | dimensionless | `core/mps.py` | Alternative notation used in some MCTS truncation contexts for the bond dimension (SVD truncation rank). |
| M_trunc | `M_trunc` | U_k Σ_k V†_k | — | `mcts/base.py` | Truncated SVD reconstruction of a reshaped MPS. Used in MCTS compression hooks. M_trunc = U_k Σ_k V†_k where k indexes retained singular values. |
| m_dominant | (dominant mode vector) | first left singular vector | — | `mcts/base.py` | Dominant left singular vector of M_trunc. Represents the primary semantic direction; dot product with action embedding e_a gives action score. |
| e_a | (action embedding) | unit vector in χ-space | — | `mcts/base.py` | Embedding vector for action a. Score = e_a · m_dominant selects the highest-aligned action. |
| O(N·d·χ²) | (complexity) | linear in N | flops | `core/mps.py` | Per-contraction complexity of MPS inner-product or operator application. Eliminates the O(N·d^N) of full state vectors. |

### 3.2 Non-Hermitian Operators (`core/operators.py`)

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| H_eff | `H_eff` | H₀ − iΓ | complex matrix [d×d] | `core/operators.py` | Effective non-Hermitian Hamiltonian. The imaginary part iΓ introduces amplitude decay (physiological recovery). |
| H₀ | `H0` (from `build_H0()`) | Hermitian, d×d; init 0.01·I | complex matrix | `core/operators.py` | Hermitian semantic evolution matrix. Conservative component; drives logical dialogue evolution without loss. Init: 0.01·I (nearly static until updated by ALS distillation). |
| Γ | `Gamma` (from `build_Gamma()`) | positive semi-definite, d×d | complex matrix | `core/operators.py` | Physiological dissipation matrix. Positive semi-definite; eigenvalues ≥ 0. Diagonal entries driven by γ_eff (HRV decay constant). Acts only on the physiological bond subspace. |
| H | `H` (propagator) | e^{−iH_eff·Δt} | unitary-like matrix | `core/operators.py` | Full time-evolution operator. Factored as e^{−iH₀Δt} · e^{−ΓΔt}. The second factor is strictly decaying (never increases amplitude). |
| coupling | `coupling` (in `build_Gamma`) | 0.05 default | dimensionless | `core/operators.py` | Weak cross-coupling between semantic and physiological bond subspaces in Γ. Default 0.05 (5% leakage). |
| ρ | (reduced density matrix) | χ_s × χ_s complex matrix | — | `core/mps.py` | Semantic reduced density matrix from `partial_trace_physio()`. Used for privacy-safe state sharing (marginalises over physio bond). |

---

## 4. MCTS Parameters

Source module: `mcts/base.py`, `mcts/hierarchical_pw_voot.py`

### 4.1 Core MCTS Constants

| Symbol | Technical Name | Value / Range | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| c | `exploration_c` | 1.414 (√2) | dimensionless | `mcts/base.py` | UCB1 exploration constant. Balances exploitation (Q/N) vs exploration (√ln N_parent / N). Standardised at √2 across all BaseMCTS subclasses. Increase for more exploration (useful in deaddiction long-horizon planning). |
| Q(n) | `total_reward / visits` | [0, 1] | dimensionless | `mcts/base.py` | Average accumulated reward for node n. Also written Q(s,a) in RL notation. |
| N(n) | `visits` | ≥ 0 integer | count | `mcts/base.py` | Visit count for node n. Used in both UCB1 denominator and parent visit count. |
| UCB1 | (score formula) | Q + c·√(ln N_parent / N) | dimensionless | `mcts/base.py` | Upper Confidence Bound 1 selection policy. Unvisited nodes return +∞ (always expanded first). |
| iterations | `iterations` (BaseMCTS init) | 80 (default); 50 in A3C mode | count | `mcts/base.py` | Number of MCTS simulation iterations per call to `search()`. More iterations = better planning but higher latency. |
| max_depth | `max_depth` | 20 default | turns | `mcts/base.py` | Maximum tree depth before forced rollout. Recommended: 3–10 within-session; 3–5 for documents and longitudinal; 2–3 for scheduling. |
| MCTS_SIMULATIONS | `MCTS_SIMULATIONS` | 50 (A3C integration) | count | `a3c/worker.py` | MCTS simulation budget used by A3C episode runner. Lower than BaseMCTS default for latency constraints. |
| latency_budget | (implicit constraint) | < 300 ms for depth-3 | ms | `mcts/base.py` | Tree search must complete within 300 ms at depth 3 for real-time use. Enforced via `block_until_ms` in training infra. |

### 4.2 MCTS Reward Weights by Therapeutic Mode

From `mcts/base.py` `REWARD_WEIGHTS` dict:

| Mode | stress | goal | trust | info | secrets |
|------|--------|------|-------|------|---------|
| `standard` | 0.40 | 0.30 | 0.20 | 0.10 | — |
| `deaddiction` | 0.10 | 0.30 | 0.40 | 0.10 | 0.10 |
| `flooding` | 0.60 | 0.30 | 0.10 | — | — |
| `negotiation` | 0.20 | 0.40 | 0.20 | 0.20 | — |

Note: In flooding mode the `stress` weight is high because the goal is to *hold* stress near the
exposure target, not minimise it — the cost function is tracking proximity to target, not reduction.

### 4.3 Multi-Dimensional MCTS Reward Vector (`therapy/mcts_reward.py`)

| Symbol | Technical Name | Range | Source File | Description |
|--------|---------------|-------|-------------|-------------|
| r_stress | `stress_reduction` | [−1, +1] | `therapy/mcts_reward.py` | Δσ = σ_before − σ_after. Positive = stress decreased. Primary reward component under most modes. |
| r_goal | `goal_progress` | [0, 1] | `therapy/mcts_reward.py` | Fraction of session-goal elements advanced in this turn. Measured by presence of mode-specific goal keywords. |
| r_trust | `trust_delta` | [−1, +1] | `therapy/mcts_reward.py` | Estimated change in patient engagement/alliance. Positive keywords → trust build; negative keywords → trust erode. |
| r_info | `info_coverage` | [0, 1] | `therapy/mcts_reward.py` | Fraction of required session elements covered so far. Penalises repetition; rewards novel on-topic disclosures. |
| r_consist | `consistency` | [0, 1] | `therapy/mcts_reward.py` | Multi-agent consistency: absence of contradiction with other active agents' prior statements. |
| physio_modifier | (function) | multiplicative | `therapy/mcts_reward.py` | Reward modifier based on HRV trend, EDA spike, sleep deficit, glucose status, circadian phase. Scales the reward vector before weighting. |
| delivery_quality | (function) | multiplicative | `therapy/mcts_reward.py` | Quality modifier based on timing, grounding, circle_relay, negotiation_listen_ratio, and appropriate humour use. |

#### MCTS Reward Weights by TTM Stage (from `therapy/mcts_reward.py` `WEIGHTS` dict):

| Stage / Mode | stress | goal | trust | info | consist |
|-------------|--------|------|-------|------|---------|
| `standard` | 0.30 | 0.15 | 0.20 | 0.30 | 0.05 |
| `flooding` | 0.10 | 0.35 | 0.15 | 0.35 | 0.05 |
| `precontemplation` | 0.25 | 0.05 | 0.40 | 0.25 | 0.05 |
| `contemplation` | 0.15 | 0.20 | 0.25 | 0.35 | 0.05 |
| `preparation` | 0.15 | 0.20 | 0.20 | 0.40 | 0.05 |
| `action` | 0.20 | 0.25 | 0.20 | 0.30 | 0.05 |
| `maintenance` | 0.15 | 0.25 | 0.25 | 0.30 | 0.05 |
| `negotiation` | 0.20 | 0.15 | 0.20 | 0.40 | 0.05 |

---

## 5. A3C / RL Parameters

Source module: `a3c/worker.py`

The A3C implementation is non-standard: there are no neural network gradients.
The "actor" is a prompt log-bias table (action selection via softmax over log-biases);
the "critic" is a linear state-value function. Updates use an advantage-weighted
moving average rather than backpropagation.

### 5.1 Core RL Constants

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| α | `ALPHA_LR` | 0.05 | dimensionless | `a3c/worker.py` | Learning rate for log-bias and critic weight updates. Applied as: Δ log_bias = α · A_t · (1 − π(a\|s)). Shared rate for both actor and critic. |
| H_coef | `ENTROPY_COEF` | 0.01 | dimensionless | `a3c/worker.py` | Entropy bonus weight in actor update. Prevents log-bias collapse to a single action. Applied as: actor update += H_coef · entropy_bonus. |
| γ_disc | `GAMMA_DISCOUNT` | 0.95 | dimensionless | `a3c/worker.py` | Temporal discount factor for future value estimates. Used in advantage: A_t = r_t + γ_disc · V(s_{t+1}) − V(s_t). |
| T_max | `MAX_TURNS` | 50 | turns | `a3c/worker.py` | Episode truncation length. Episodes longer than MAX_TURNS are terminated. Individual scenarios may override. |

### 5.2 Advantage and Update Equations

```
Advantage:
    A_t = r_t + γ_disc · V(s_{t+1}) − V(s_t)

Actor log-bias update (policy gradient with baseline correction):
    Δ log_bias(a_t, bucket) = α · A_t · (1 − π(a_t | s_t))
    log_bias(a_t, bucket) += Δ log_bias

Critic weight update (TD(0)):
    TD error = r_t + γ_disc · V(s_{t+1}) − V(s_t)
    w_i += α · TD_error · φ_i(s_t)       for each feature i

Action distribution:
    π(a | bucket) = softmax(log_biases[bucket])
```

### 5.3 Actor / Critic Components

| Symbol | Technical Name | Value / Shape | Unit | Source File | Description |
|--------|---------------|---------------|------|-------------|-------------|
| b_{a,k} | `log_biases[bucket][action]` | scalar; init 0.0 | log-odds | `a3c/worker.py` | Log-bias for action a under stress bucket k. Softmax over all actions gives π(a\|s). Init 0.0 = uniform distribution. |
| V(s) | `critic.value(state)` | scalar | [0, 1] | `a3c/worker.py` | State-value function. Linear: V(s) = Σ w_i · φ_i(s). φ(s) is the 8-dimensional feature vector from `TurnState`. |
| φ(s) | `_features(state)` | 8-dimensional vector | dimensionless | `a3c/worker.py` | Feature vector encoding: [stress_index, turn/MAX_TURNS, alliance, goal_pct, disclosure_count, mode_index, physio_flag, safety_flag]. |
| A_t | `advantage` | scalar | dimensionless | `a3c/worker.py` | TD advantage signal. Positive = action was better than expected; negative = worse. |
| TD_err | `td_error` | scalar | dimensionless | `a3c/worker.py` | Temporal difference error used for critic update. Same magnitude as A_t. |
| entropy | (entropy bonus) | scalar | nats | `a3c/worker.py` | Policy entropy − Σ π·log(π). Added to advantage to discourage premature convergence. |

### 5.4 Stress Buckets (`a3c/action_bandit.py`)

| Bucket | HRV Range | Description |
|--------|-----------|-------------|
| `low` | > 45 ms | Calm, engaged patient |
| `moderate` | 25–45 ms | Mildly stressed |
| `high` | < 25 ms | Distressed; crisis risk; conservative action selection |

---

## 6. Reward Signal Components

Source modules: `therapy/mcts_reward.py`, `training/judge.py`

### 6.1 HTN Judge Scoring Dimensions (`training/judge.py`)

Each conversational turn is scored on 6 dimensions (0–10 scale) by the HTN Judge
(Maverick / Llama 405B as LLM-as-judge). The scores feed the discrepancy audit
and offline DPO training target generation.

| Symbol | Technical Name | Range | Source File | Description |
|--------|---------------|-------|-------------|-------------|
| D_clin | `clinical_accuracy` | [0, 10] | `training/judge.py` | Is all factual/medical content correct? 0 = dangerous misinformation; 10 = fully accurate. |
| D_emp | `empathy_calibration` | [0, 10] | `training/judge.py` | Is empathy level appropriate for the patient's physiological state? 0 = wildly miscalibrated; 10 = perfectly calibrated. |
| D_goal | `goal_progress` | [0, 10] | `training/judge.py` | Did this turn advance the session goal? 0 = actively regressive; 10 = significant progress. |
| D_safe | `safety_compliance` | [0, 10] | `training/judge.py` | Does the response respect all safety constraints? 0 = critical safety violation; 10 = fully safe. |
| D_persona | `persona_consistency` | [0, 10] | `training/judge.py` | Is the response consistent with the assigned agent role? 0 = role violation; 10 = perfect. |
| D_physio | `physio_alignment` | [0, 10] | `training/judge.py` | Given the patient's physiological context, was the response appropriate? 0 = ignores context; 10 = perfectly tailored. |

### 6.2 Discrepancy Audit Parameters

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| θ_spread | `spread_threshold` | 0.2 | dimensionless | `training/judge.py` | Minimum score spread (max − min across evaluators) to flag a discrepancy. 20% of [0,1] range = meaningful disagreement. |
| JS_scale | (JS scorer normalisation) | (raw_score + 3.0) / 6.0 | dimensionless | `training/judge.py` | Maps JS scorer range [−3, +3] to [0, 1] for cross-evaluator comparison. |
| cost_ep | (per-episode cost estimate) | ~$0.023 | USD | `training/judge.py` | Estimated Maverick inference cost per 8-turn episode for real-time per-turn judging. Includes ~600 input + ~100 per-turn tokens. |

### 6.3 Arm Reward vs Judge Discrepancy

The discrepancy_flag condition described in the original specification
(|arm_reward − scorer_cumulative| > 3.0) corresponds to the spread-based
audit in `DiscrepancyAudit`. The `spread_threshold=0.2` on the [0,1] scale
is the operational equivalent; a spread > 0.2 flags the turn for human review.
The "3.0" scale reflects the raw JS scorer range before normalisation.

---

## 7. Social Coupling

Source module: `agents/shared_tensor_state.py`

The V_int matrix models emotional contagion and authority influence between care-circle
members. Literature-grounded priors; Phase 5 A3C will learn session-specific values.

### 7.1 V_int Social Coupling Matrix

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| V_int | `V_INT_PRIOR` | dict of (sender, receiver) → float | dimensionless | `agents/shared_tensor_state.py` | Social coupling matrix between companion roles. Attenuates HRV deltas by coupling strength during `v_int_propagate()`. |
| V_{cp} | `('clinician','patient')` | 0.6 | dimensionless | `agents/shared_tensor_state.py` | Clinician → patient authority coupling. Basis: Roter (2002) Interaction Process Analysis. Highest coupling: clinician words have the strongest physiological impact on patient. |
| V_{xp} | `('caregiver','patient')` | 0.4 | dimensionless | `agents/shared_tensor_state.py` | Caregiver → patient emotional contagion. Basis: Hatfield et al. (1993). |
| V_{px} | `('patient','caregiver')` | 0.35 | dimensionless | `agents/shared_tensor_state.py` | Patient → caregiver stress contagion. Basis: Pinquart & Sorensen (2004). |
| V_{pc} | `('patient','clinician')` | 0.2 | dimensionless | `agents/shared_tensor_state.py` | Patient → clinician feedback coupling. Basis: Epstein et al. (2007). Weak: clinicians are professionally regulated against patient stress contagion. |
| V_{cc} | `('clinician','caregiver')` | 0.25 | dimensionless | `agents/shared_tensor_state.py` | Clinician → caregiver information authority coupling. |
| V_{xc} | `('caregiver','clinician')` | 0.15 | dimensionless | `agents/shared_tensor_state.py` | Caregiver → clinician feedback coupling. Weakest: lay feedback has limited clinical influence. |
| V_default | `DEFAULT_COUPLING` | 0.1 | dimensionless | `agents/shared_tensor_state.py` | Fallback coupling for unknown role pairs not in V_INT_PRIOR. |

### 7.2 HRV Propagation Formula

```
For each receiver r ≠ sender:
    coupling = V_INT_PRIOR[(sender_role, receiver_role)]
    predicted_hrv_delta = coupling × (new_hrv_ms − sender.last_hrv)
    receiver.last_hrv = max(5.0, receiver.last_hrv + predicted_hrv_delta)
```

Privacy gate: HRV propagation is blocked if the receiver does not have
InfoClass.II consent (stress-label sharing). Only the label `moderate_stress`
is shared by default; raw HRV requires InfoClass.III.

---

## 8. PK/PD Parameters

Source module: `physio/pkpd.py`

Pharmacokinetic/Pharmacodynamic models answer: given drug D at dose X, how does the
Gamma matrix change over the next N turns? Output: a scalar `gamma_drug_modifier(t)`.

### 8.1 Generic PK/PD Model Constants

| Symbol | Technical Name | Formula / Value | Unit | Source File | Description |
|--------|---------------|----------------|------|-------------|-------------|
| C(t) | `concentration_at(t)` | (F·D/Vd)·(ka/(ka−ke))·(e^{−ke·t}−e^{−ka·t}) | mg/L | `physio/pkpd.py` | One-compartment plasma concentration. F=bioavailability; D=dose; Vd=volume of distribution; ka=absorption rate; ke=elimination rate. |
| ke | `ke_per_h` | ln(2)/t½ | h⁻¹ | `physio/pkpd.py` | First-order elimination rate constant. Derived from half-life t½. |
| ka | `ka_per_h` | drug-specific | h⁻¹ | `physio/pkpd.py` | First-order absorption rate constant. Determines time-to-peak concentration. |
| F | `bioavailability` | [0, 1]; drug-specific | dimensionless | `physio/pkpd.py` | Oral bioavailability fraction. Accounts for first-pass metabolism. |
| Vd | `vd_L_per_kg × weight_kg` | drug-specific | L | `physio/pkpd.py` | Apparent volume of distribution. Total volume the drug would occupy if uniformly distributed at plasma concentration. |
| E(C) | `EmaxPD.effect(ce)` | Emax·Cⁿ / (EC50ⁿ + Cⁿ) | fractional effect | `physio/pkpd.py` | E_max Hill equation. Emax = maximum effect; EC50 = concentration at half-max effect; n = Hill coefficient (steepness). |
| Emax | `EmaxPD.emax` | drug-specific; [0, 1] for Γ modifier | dimensionless | `physio/pkpd.py` | Maximum pharmacological effect. When used as a Γ modifier, Emax = maximum possible Γ reduction fraction. |
| EC50 | `EmaxPD.ec50` | drug-specific | mg/L | `physio/pkpd.py` | Concentration at half-maximum effect. Determines the potency of the drug. |
| n_hill | `EmaxPD.gamma` | 1.0 default | dimensionless | `physio/pkpd.py` | Hill coefficient (steepness of E–C curve). n=1 = basic Michaelis-Menten; n>1 = cooperative (sigmoidal) response. |
| ke0 | `EffectSite.ke0_per_h` | drug-specific | h⁻¹ | `physio/pkpd.py` | Effect-site equilibration rate. Delays between plasma Cp and biophase Ce concentration. |
| Ce | `EffectSite.ce` | [0, Cp_max] | mg/L | `physio/pkpd.py` | Effect-site (biophase) concentration. Drives pharmacological effect via EmaxPD. |
| γ_floor | (gamma safety floor) | 0.30 | dimensionless | `physio/pkpd.py` | Minimum allowed `gamma_modifier` value for any drug. `return max(0.3, modifier)` — prevents drug from reducing Γ by more than 70%, preserving physiological safety. |

### 8.2 Individual Drug Parameters

| Drug | F | Vd (L/kg) | t½ | Emax | EC50 | Direction | Source File |
|------|----|-----------|-----|------|------|-----------|-------------|
| Metoprolol 50 mg | 0.50 | 4.2 | 5 h | 0.40 | 0.035 mg/L | Reduces Γ (faster recovery) | `physio/pkpd.py` |
| Sertraline (SSRI) 50 mg — fast channel | — | — | ~7 days | — | — | Increases Γ (activation) | `physio/pkpd.py` |
| Sertraline (SSRI) 50 mg — slow channel | — | — | ~42 days | — | — | Reduces Γ (restoration) | `physio/pkpd.py` |
| Lorazepam (BZD) 1 mg | — | — | ~12 h | — | — | Strong acute Γ reduction; tolerance builds | `physio/pkpd.py` |
| Naltrexone 50 mg | — | — | ~8 h | — | — | Attenuates craving Γ spike (opioid/alcohol) | `physio/pkpd.py` |

---

## 9. ReactivityProfile Archetype Parameters

Source module: `physio/reactivity.py`

Four archetypes that modify Γ (the autonomic recovery operator) based on
individual neurobiological and psychological profiles.

### 9.1 Archetype Parameter Table

| Symbol | Technical Name | HYPERSENSITIVE | STOIC | LABILE | RUMINANT | Unit | Source File | Description |
|--------|---------------|---------------|-------|--------|----------|------|-------------|-------------|
| θ | `threshold` | 0.15 | 0.60 | 0.35 | 0.25 | dimensionless | `physio/reactivity.py` | σ level below which the archetype does NOT activate. Below θ: Γ = Γ_baseline. Above θ: gain and decay take over. Bifurcation point in H_eff non-linearity. |
| g | `gain` | 1.8 | 0.7 | 1.6 | 1.1 | dimensionless | `physio/reactivity.py` | Γ multiplier at and above threshold. Γ_eff = Γ_baseline × gain when σ ≥ θ. Hypersensitive: 80% slower recovery; Stoic: 30% faster even under stress. |
| α_rise | `lability` (α_rise in formula) | medium | slow | very fast | slow onset | dimensionless rate | `physio/reactivity.py` | Rate at which stress rises toward the gain plateau. High lability = explosive escalation. Formally: E(σ) = gain / (1 + exp(−α_rise·(σ − θ))). |
| α_ruminant | `rumination` (α_ruminant) | medium | low | very low | very high | dimensionless rate | `physio/reactivity.py` | Rate at which Γ decays back to baseline after stressor removal. High rumination = persistent "grudge state" R_t. Γ_total = Γ_eff + R_t. |

### 9.2 Rumination (Grudge State) Equations

```
dR/dt = −α_ruminant · R_t + β_ruminant · Γ_spike

Γ_total = Γ_eff(σ) + R_t

Where:
  R_t       — accumulated "grudge state" (persistent imaginary eigenvalue component)
  Γ_spike   — instantaneous Γ increase from a stressor event
  α_ruminant — decay rate of R_t (slow for RUMINANT archetype)
  β_ruminant — amplification of Γ_spike into grudge state
```

The ruminant archetype has two imaginary timescales in H_eff:
- Fast mode: current stress, decays at γ_hrv.
- Slow mode: accumulated grudge, decays at γ_ruminant << γ_hrv.

### 9.3 Archetype Descriptions

| Archetype | Clinical Profile | Threshold | Gain | Recovery |
|-----------|-----------------|-----------|------|----------|
| `HYPERSENSITIVE` | "Goes off at the slightest trigger" | Low (0.15) | High (1.8) | Medium |
| `STOIC` | "Calm even in high-stakes moments" | High (0.60) | Low (0.7) | Fast |
| `LABILE` | "Explodes, then quickly agrees" | Medium (0.35) | High (1.6) | Very fast |
| `RUMINANT` | "Holds a grudge even when physiologically calm" | Low-medium (0.25) | Medium (1.1) | Very slow |

---

## 10. Action Taxonomy Constants

Source module: `a3c/action_bandit.py`

### 10.1 ACTION_TAXONOMY

The full action vocabulary has **51 actions** covering 9 functional categories.
Each action is a string key used by the Actor log-bias table, MCTS action selection,
and Thompson Sampling bandit.

| Category | Actions | Description |
|----------|---------|-------------|
| **Ask** | `open_question`, `specific_question`, `probing_question`, `socratic_probe`, `topic_from_stack` | Information-gathering; OARS "Open question" family. |
| **Answer / Tell** | `give_facts`, `give_options`, `psychoeducation`, `summarise` | Information delivery; FRAMES Advice + Feedback. |
| **Empathy / Relationship** | `empathic_reflection`, `affirmation`, `validate`, `unconditional_regard` | OARS reflections; alliance building. |
| **Strategic Challenge** | `challenger_insight`, `develop_discrepancy`, `socratic_reframe`, `loss_frame` | Challenger Sale; MET develop discrepancy; Tversky-Kahneman framing. |
| **Topic Management** | `change_topic`, `introduce_new_angle`, `acknowledge_only` | Pivoting and pacing. |
| **Mode-gated Technique** | `flooding_hold`, `flooding_deepen`, `oars_summary`, `spike_step` | Flooding therapy and SPIKE protocol specific. |
| **Meta / Safety** | `escalate`, `safety_protocol`, `motivational_frame`, `end_conversation` | Crisis escalation; session close; self-efficacy framing. |
| **Commitment / Future** | `direct_advice`, `schedule_commitment`, `future_planning`, `companion_handoff`, `share_circle_insight` | Post-insight; maintenance phase; care-circle relay. |
| **Abstract MI/CBT** | `validate_emotion`, `explore_ambivalence`, `build_alliance`, `provide_information`, `reframe_perspective`, `elicit_change_talk`, `address_resistance`, `check_understanding`, `invite_reflection`, `suggest_coping_strategy`, `clarify_goal`, `summarise_session`, `breathing_exercise`, `mindfulness_prompt` | Original discrete taxonomy (retained for backward compatibility). |

### 10.2 Thompson Sampling Bandit Parameters (`a3c/action_bandit.py`)

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| α_{ij} | `alpha[bucket][action]` | init 1.0 | dimensionless | `a3c/action_bandit.py` | Beta distribution α parameter for (action i, stress bucket j). Beta(1,1) = uniform prior. Incremented by (1 + reward) on success. |
| β_{ij} | `beta_[bucket][action]` | init 1.0 | dimensionless | `a3c/action_bandit.py` | Beta distribution β parameter for (action i, stress bucket j). Incremented by (1 − reward) on failure. |
| θ_sample | (Thompson sample) | ~Beta(α, β) | [0, 1] | `a3c/action_bandit.py` | Sampled success probability. Action with highest sample selected. Naturally handles exploration/exploitation via posterior uncertainty. |
| N_bandit | (bandit pre-train episodes) | 100 (design target) | episodes | `a3c/action_bandit.py` | Number of pre-training episodes before bandit posteriors are exported to A3C actor prior. 3 buckets × 51 actions = 153 arms. |
| logit_clip | (log-bias conversion) | [−3, +3] | log-odds | `a3c/action_bandit.py` | When converting bandit mean rewards to A3C log-biases: logit(p) clipped to [−3, +3] to avoid degenerate initialisation. |

### 10.3 CALMING_WEIGHT Values (Selected)

| Action | CALMING_WEIGHT | Source File | Notes |
|--------|---------------|-------------|-------|
| `validate` | 0.90 | `a3c/action_bandit.py` | Highest calming; use first under high stress |
| `empathic_reflection` | 0.88 | `a3c/action_bandit.py` | OARS reflection |
| `breathing_exercise` | 0.85 | `a3c/action_bandit.py` | Somatic intervention |
| `unconditional_regard` | 0.85 | `a3c/action_bandit.py` | Non-judgment signal |
| `affirmation` | 0.82 | `a3c/action_bandit.py` | OARS: specific strength recognition |
| `flooding_deepen` | ~0.0 | `a3c/action_bandit.py` | May escalate stress — by design |
| `challenger_insight` | low | `a3c/action_bandit.py` | Challenge can raise stress short-term |

---

## 11. Infrastructure Constants

### 11.1 Training Infrastructure (`a3c/worker.py`, `a3c/action_bandit.py`)

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| T_max | `MAX_TURNS` | 50 | turns | `a3c/worker.py` | Episode truncation. Keeps training batches bounded; individual scenarios may lower this (e.g., short billing interactions). |
| α_lr | `ALPHA_LR` | 0.05 | dimensionless | `a3c/worker.py` | Global learning rate for all parameter updates in the A3C framework (actor log-biases and critic linear weights). |
| H_coef | `ENTROPY_COEF` | 0.01 | dimensionless | `a3c/worker.py` | Entropy regularisation coefficient. Multiplied by policy entropy before adding to advantage. Prevents action collapse. |
| γ | `GAMMA_DISCOUNT` | 0.95 | dimensionless | `a3c/worker.py` | Future-reward discount factor. γ=0.95 means reward 20 turns away is discounted to 0.95^20 ≈ 0.36× its face value. |
| c_ucb | `exploration_c` (BaseMCTS) | 1.414 | dimensionless | `mcts/base.py` | UCB1 exploration constant = √2. Standardised across all MCTS variants. Previously divergent between subclasses (1.41 vs 1.0). |
| iterations | `iterations` (BaseMCTS) | 80 | rollouts | `mcts/base.py` | Default MCTS simulation budget per tree search call. |
| MCTS_SIMS | `MCTS_SIMULATIONS` | 50 | rollouts | `a3c/worker.py` | MCTS budget in A3C episode runner (lower than base for latency). |

### 11.2 MPS Demo Constants (`core/mps.py`)

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| CHI_S | `CHI_S` | 4 | dimensionless | `core/mps.py` | Demo semantic bond dimension. |
| CHI_P | `CHI_P` | 5 | dimensionless | `core/mps.py` | Demo physiological bond dimension (minimum: ≥ 5 physiological signals). |
| VOCAB | `VOCAB` | 8 | dimensionless | `core/mps.py` | Demo feature/vocabulary size. |
| N_TOKS | `N_TOKS` | 5 | sites | `core/mps.py` | Demo sequence length (number of MPS sites). |

### 11.3 Privacy and Consent Layers (`agents/privacy_layer.py`)

| Symbol | Technical Name | Value | Source File | Description |
|--------|---------------|-------|-------------|-------------|
| InfoClass.I | (implicit) | Public | `agents/privacy_layer.py` | Fully public session information: session ID, mode, role labels. |
| InfoClass.II | (implicit) | Stress label | `agents/privacy_layer.py` | Stress label sharing (e.g., `moderate_stress`) — default allowed across circle. |
| InfoClass.III | (implicit) | Raw HRV | `agents/privacy_layer.py` | Raw physiological data (HRV in ms, glucose). Requires explicit consent before sharing cross-agent. |

### 11.4 Shared Tensor Buffer Defaults (`agents/shared_tensor_state.py`)

| Symbol | Technical Name | Value | Unit | Source File | Description |
|--------|---------------|-------|------|-------------|-------------|
| HRV_floor_prop | (propagation floor) | 5.0 | ms | `agents/shared_tensor_state.py` | Minimum HRV value after V_int propagation: `max(5.0, last_hrv + delta)`. Prevents physiologically impossible values. |
| V_default | `DEFAULT_COUPLING` | 0.1 | dimensionless | `agents/shared_tensor_state.py` | Default coupling for unknown role pairs (not in V_INT_PRIOR dict). |

---

## References

All constants are grounded in primary literature. Key citations:

### Physiological Signals
- **Shaffer & Ginsberg (2017)**. An Overview of Heart Rate Variability Metrics and Norms. *Front. Public Health* 5:258. → HRV_RMSSD ranges, baseline 35 ms.
- **Task Force of ESC/NASPE (1996)**. Heart rate variability: standards of measurement, physiological interpretation, and clinical use. *Circulation* 93(5):1043-65. → HRV taxonomy.
- **ADA (2024)**. Standards of Medical Care in Diabetes. *Diabetes Care* 47(Suppl 1). → Glucose thresholds (3.9, 4.0, 7.8, 10.0 mmol/L).
- **WESAD Dataset** (Schmidt et al. 2018). → EDA normalisation range [0.01, 20.0 µS].
- **Touitou et al. (2017)**. Disruption of adolescents' circadian clock. *J. Physiol. Paris*. → Circadian peak hour 08:00, trough 03:00.
- **Hirshkowitz et al. (2015)**. NSF sleep duration recommendations. *Sleep Health* 1(1):40-43. → SLEEP_TARGET_HOURS_ADULT = 8 h.
- **Cretikos et al. (2008)**. Respiratory rate: the neglected vital sign. *Med. J. Aust.* 188(11):657-9. → RR_NORMAL_LOW=12, RR_NORMAL_HIGH=20 bpm.

### Hysteresis / Conditioning
- **Rescorla & Wagner (1972)**. A theory of Pavlovian conditioning. *Classical Conditioning II*. → Extinction learning model.
- **Bouton, M.E. (2004)**. Context and behavioral processes in extinction. *Learn. Mem.* 11:485-494. → Spontaneous recovery; W_FLOOR rationale.
- **Pavlov, I.P. (1927)**. Conditioned reflexes. Oxford. → Spontaneous recovery discovery.
- **Ressler & Mayberg (2007)**. Targeting abnormal neural circuits in mood and anxiety disorders. *Nat. Neurosci.* 10(9):1116-24. → Reinstatement neurobiology.
- **Safran, J.D. & Muran, J.C. (2000)**. Alliance rupture resolution. *Psychotherapy* 37(3):286-295. → Rupture α_rupture = 0.30 fast asymmetry; repair α_repair = 0.04 slow.
- **Bordin, E.S. (1979)**. The generalizability of the working alliance. *Psychotherapy* 16(3):252-260. → Working Alliance Inventory; alliance_build rate 0.08/session.

### Tensor Networks / Physics
- **Vidal (2003)**; **White (1992)**. MPS / DMRG formalism. → Core tensor structure, bond dimension χ.
- **Moiseyev (2011)**. *Non-Hermitian Quantum Mechanics*. Cambridge. → H_eff = H₀ − iΓ framework.

### MCTS
- **Kocsis & Szepesvari (2006)**. Bandit based Monte-Carlo planning. *ECML*. → UCB1 with c=√2.
- **Silver et al. (2016)**. Mastering the game of Go with AlphaGo. *Nature* 529. → Modern MCTS with neural rollouts.

### Reinforcement Learning
- **Mnih et al. (2016)**. Asynchronous methods for deep reinforcement learning (A3C). *ICML*. → A3C architecture; advantage estimation.
- **Thompson, W.R. (1933)**. On the likelihood that one unknown probability exceeds another. *Biometrika*. → Thompson Sampling prior.
- **Russo et al. (2018)**. A Tutorial on Thompson Sampling. *Found. Trends Mach. Learn.* 11(1):1-96. → Bandit warm-up rationale.

### Pharmacology
- **Kleiger et al. (2005)**. Ann. Noninvasive Electrocardiol. → Beta-blockers + HRV.
- **Agelink et al. (2001)**. Psychopharmacology. → SSRIs + HRV: early activation / late restoration.
- **Mason et al. (1999)**. Alcohol Clin. Exp. Res. → Naltrexone + HRV under cue-exposure.

### Reactivity Archetypes
- **Barlow, D.H. (2002)**. Anxiety and Its Disorders. Guilford. → Threshold / sensitisation.
- **Gross, J.J. (1998)**. Emotion regulation in adulthood. *Curr. Dir. Psychol. Sci.* 7(6). → Lability / regulation.
- **Nolen-Hoeksema, S. (1991)**. Rumination and depression. *J. Abnorm. Psychol.* → Ruminant archetype.
- **Thayer & Lane (2000)**. A model of neurovisceral integration. *J. Psychosom. Res.* 49(4). → Vagal tone / HRV / threshold connection.

### Therapeutic Frameworks
- **Miller & Rollnick (2013)**. *Motivational Interviewing*, 3rd ed. → OARS, FRAMES, develop discrepancy.
- **Prochaska & DiClemente (1983)**. Stages of change (TTM). → Stage-weighted MCTS rewards.
- **Dixon et al. (2011)**. The Challenger Sale. → challenger_insight action.
- **Tversky & Kahneman (1981)**. The framing of decisions. *Science* 211. → loss_frame action.

---

*This glossary is auto-maintained alongside the source code. When adding a new constant to
any tensornets module, add a corresponding row here with the same precision. Symbols used
in architecture.md, advancedRL.md, and the paper draft cross-reference this document.*
