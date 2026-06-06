# tensornets — Package Reference

> Python package: `tensornets/tensornets/`  
> FastAPI microservice: `tensornets/server.py` (port 8765)  
> Entry point for training: `python -m tensornets.a3c.train`

---

## Package layout

```
tensornets/
├── server.py                    FastAPI microservice (HTTP bridge to Node.js)
└── tensornets/
    ├── core/
    │   ├── mps.py               MatrixProductState — the central state object
    │   ├── operators.py         build_H0, build_Gamma, build_H_eff, build_transition_operator
    │   └── als.py               Alternating Least Squares optimiser (bond update) [planned — not yet implemented; see note below]
    ├── physio/
    │   ├── state.py             PhysiologicalState — 8-signal snapshot → stress index
    │   ├── hysteresis.py        HystereticBaseline — extinction/recovery/reinstatement
    │   ├── reactivity.py        ReactivityProfile — 4 archetypes modifying Γ
    │   ├── pkpd.py              DrugRegimen — PK/PD Γ modifiers for 4 drug classes
    │   └── simulator.py         SubjectProfile — long-run physio simulation
    ├── mcts/
    │   ├── base.py              BaseMCTS / DialogMCTS — UCB1 tree search
    │   ├── modes.py             Mode-specific reward functions
    │   ├── clause_mcts.py       Document clause ordering
    │   └── mcts_scheduling.py   Appointment scheduling
    ├── therapy/
    │   ├── modes.py             TherapeuticMode, DeaddictionPhase, ChangeStage enums
    │   ├── mcts_reward.py       WEIGHTS, GOAL_KEYWORDS, TRUST_BUILD/ERODE, RewardVector
    │   └── frames.py            FRAMES components (Feedback, Responsibility, Advice, ...)
    ├── agents/
    │   ├── shared_tensor_state.py   SharedTensorBuffer — V_int propagation (G3)
    │   ├── inter_agent_comm.py      SharedDialogueState — commitment tracking
    │   ├── session_manager.py       Multi-session persistence
    │   └── privacy_layer.py         InfoClass gate — what companions can share
    └── a3c/
        ├── train.py             Training orchestrator — episode loop, checkpointing
        ├── worker.py            A3CWorker — Actor/Critic, episode runner, reward calc
        ├── arms.py              Arm1/2/3Worker — the three comparison arms
        ├── scorer.py            A3CScorer — LLM judge (Maverick) + heuristic carry
        ├── action_bandit.py     ACTION_TAXONOMY, CALMING_WEIGHT, heuristic reward tables
        ├── synthetic_patient.py SyntheticParticipant, CareCircleOrchestrator
        └── prompt_optimizer.py  PromptOptimizer — rewrites system prompt below threshold
```

---

## core/mps.py — MatrixProductState

The central state object. Represents the patient's joint semantic–physiological state as a chain of tensors (Vidal, 2003; Schollwöck, 2011).

```
MatrixProductState
├── n_tokens        Number of sites in the chain (vocabulary dimension d per site)
├── chi_semantic    Bond dimension for semantic subspace
├── chi_physio      Bond dimension for physiological subspace
└── tensors         List[torch.Tensor], shape (chi_L, d, chi_R) at each site
```

**Key methods:**

| Method | Description |
|---|---|
| `identity_initialized(n_tokens, chi_semantic, chi_physio)` | Cold-start state — uniform entanglement |
| `apply_transition(H_eff)` | Evolve state by one turn under H_eff (Moiseyev, 2011; see `09_MPS_core.md §3` for derivation) |
| `partial_trace_physio()` | Marginalise over physio bond → semantic-only density matrix |
| `energy(H0)` | ⟨ψ\|H0\|ψ⟩ — total system energy |
| `physio_energy(Gamma)` | ⟨ψ\|Γ†Γ\|ψ⟩ — autonomic tension |

**Design note (F3/F4):** The `project_constraint(token_logits, M_trunc)` method is defined but requires the `core/mps.py` SVD bond compression to be stable (E7 test passes — confirmed May 2026). M_trunc from MCTS is currently used to soft-steer the Scout LLM system prompt, not to directly modify logits (Bedrock API does not expose token logits).

> **Note:** `core/als.py` is planned but not yet implemented. The ALS (Alternating Least Squares) optimiser will provide gradient-free MPS parameter updates. See `09_MPS_core.md §7`.

---

## physio/state.py — PhysiologicalState

A dataclass that converts a raw 8-signal physio snapshot into a scalar stress index. This is the per-turn input to the MPS layer.

**Signals and weights:**

| Signal | Field | Weight | Range | Source |
|---|---|---|---|---|
| HRV (RMSSD) | `hrv_rmssd_ms` | 0.35 | 20–80 ms | Kleiger et al. (2005) |
| Blood glucose | `blood_glucose_mmol` | 0.10 | 3.5–10 mmol/L | Inzlicht & Schmeichel (2012) |
| Electrodermal activity | `eda_us` | 0.20 | 0.5–20 μS | Boucsein (2012) |
| Sleep deficit | `sleep_deficit_hours` | 0.15 | 0–8 h | Walker (2017) |
| Circadian phase | `time_of_day_h` | 0.10 | 0–23 h | Czeisler (1999) |
| Location stress | `location_stress_index` | 0.05 | 0–1 | HTN internal |
| Recent exercise | `recent_exercise_min` | −0.03 | 0–90 min | Ratey & Hagerman (2008) |
| Caffeine load | `caffeine_mg` | 0.02 | 0–600 mg | Smith (2002) |

`stress_index()` returns a scalar ∈ [0,1]. Values are normalised to population ranges and combined with a weighted sum.

---

## physio/hysteresis.py — HystereticBaseline

Models **extinction learning** — the core psychological insight that distinguishes HTN from other AI companion systems.

### Mathematical structure

A subject's fear/craving response to trigger `k` is governed by:

```
w_k(t+1) = w_k(t) · λ_extinct + Δw_k                   # in-session extinction (Rescorla & Wagner, 1972; Bouton, 2004)
w_k ← max(W_FLOOR, w_k · (1 - α_rec · Δweeks))         # between-session spontaneous recovery
w_k ← min(1.0, w_k + α_reinstate · (1 - w_k))           # on reinstatement cue
```

**Constants:**

| Constant | Value | Meaning |
|---|---|---|
| `W_FLOOR` | 0.08 | Fear never fully extinguishes (latent inhibition) |
| `LAMBDA_EXTINCT` | 0.85 | Per-exposure extinction rate |
| `ALPHA_RECOVERY_PER_WEEK` | 0.025 | Spontaneous recovery speed |
| `ALPHA_REINSTATEMENT` | 0.45 | Reinstatement acceleration |

### Triggers modelled

Alcohol, nicotine, opioids, cocaine, gambling, food, social anxiety, PTSD, generalised anxiety, low mood, chronic pain, and behavioural (screen, exercise) triggers.

### HystereticBaseline API

| Method | Description |
|---|---|
| `expose(trigger, intensity)` | Apply one extinction exposure |
| `recover(weeks_elapsed)` | Apply spontaneous recovery decay |
| `reinstate(trigger)` | Simulate reinstatement event |
| `modulate_gamma(Gamma, trigger)` | Scale Γ diagonal by fear weight for this trigger |
| `to_dict() / from_dict()` | Serialise for session persistence |

### Deviation from original PDS

The original design (PDS / `Tensor_nets.pdf`) envisioned hysteresis as a continuous ODE integrated over real-time physiological measurements. The current implementation is **discretised per turn** (one extinction step per companion turn) and **per session** (spontaneous recovery applied at session open/close). Real-time continuous integration is deferred pending wearable sensor integration (Phase 6+).

The Γ modulation is also simplified: `modulate_gamma` scales only the diagonal of Γ rather than performing a full tensor rotation. This is a conservative approximation that ensures numerical stability.

---

## physio/reactivity.py — ReactivityProfile

Each patient has a stable **reactivity archetype** — a trait-level modifier on how strongly interventions affect their stress trajectory.

**Four archetypes:**

| Archetype | Threshold | Gain | Rise | Decay | Clinical profile |
|---|---|---|---|---|---|
| `HYPERSENSITIVE` | 0.20 | 1.8 | Fast | Slow | Anxiety disorders, high trauma load |
| `STOIC` | 0.60 | 0.6 | Slow | Fast | Alexithymia, avoidant attachment |
| `LABILE` | 0.30 | 1.4 | Fast | Fast | Borderline features, rapid cycling |
| `RUMINANT` | 0.35 | 1.2 | Medium | Very slow | OCD, depression, perseverative worry |

`gamma_modifier(stress_index)` returns a multiplier applied to the Δ-stress from each companion action. A HYPERSENSITIVE patient reacts more strongly to both calming and stressful actions; a STOIC patient requires more sustained effort to shift.

**Mapping from JS archetype names** (used in `TurnState.archetype`):

| JS name | Python archetype |
|---|---|
| `anxious` | `HYPERSENSITIVE` |
| `reactive` | `LABILE` |
| `avoidant` | `STOIC` |
| `intellectualiser` | `RUMINANT` |
| `standard` | None (no modifier) |

---

## physio/pkpd.py — DrugRegimen

PK/PD models for four drug classes that modify the Γ operator.

| Drug | Model | Effect on Γ | Clinical reference |
|---|---|---|---|
| **Metoprolol** | One-compartment, E_max | Reduces Γ (beta-1 blockade → higher HRV) | Kleiger et al. (2005) |
| **SSRI** | Two-timescale: fast activation / slow restoration | First 1–2 weeks: Γ↑ (activation); weeks 4–8: Γ↓ (restoration) | Agelink et al. (2001) |
| **Benzodiazepine** | One-compartment + tolerance decay | Strong acute Γ↓, diminishing with repeated doses | Koran & Litt (1988) |
| **Naltrexone** | Cue-triggered attenuation model | Attenuates Γ spike on substance-cue exposure | Mason et al. (1999) |

`DrugRegimen.gamma_modifier(cue_triggered)` returns a composite scalar multiplier applied to Δ-stress. The `cue_triggered` flag activates the naltrexone attenuation path (relevant for `spike_step` and `direct_advice` actions when the patient has a substance-use history).

---

## agents/shared_tensor_state.py — SharedTensorBuffer

Manages the G3 component: **V_int HRV propagation** across the care circle.

```
SharedTensorBuffer(agents: list[{agent_id, role}])
  ├── put_mps(agent_id, mps, hrv_ms)       Update one agent's slot
  ├── v_int_propagate(sender_id, hrv_ms)   Propagate HRV delta via V_int matrix
  ├── get_hrv_summary()                    {agent_id: {role, hrv_ms, stress_label}}
  └── consistency_hint()                   Text hint for action_selector.js prompt
```

The `consistency_hint()` output is a brief string like:
```
[CIRCLE PHYSIO] caregiver: moderate_stress (HRV 28ms). 
companion should not escalate complexity this turn.
```

This is injected into `known_context` in `TurnState` before the companion generates a response.

---

## a3c/worker.py — A3CWorker

The episode runner. One `A3CWorker` per arm per training session.

**Actor**: Softmax over `ACTION_TAXONOMY` conditioned on `(stress_bucket, therapeutic_mode)`. Log-biases stored as plain Python dicts — no neural network engine required. A3C update rule follows (Mnih et al., 2016). Mode-conditioned compound keys `"{mode}_{bucket}"` allow mode-specific policies to develop while remaining backward-compatible with older checkpoints.

**Critic**: Linear value function over a 7-feature vector: `[stress_index, turn_progress, history_len_norm, info_coverage, repetition, mode_idx, bias]`. Updated via TD(0) with GAMMA_DISCOUNT=0.95.

**Per-turn reward composition:**

```
r = scalar_reward(reward_dict)
    − pester_penalty        (companion pushes clinical topic after patient redirect)
    + rapport_bonus         (companion engages patient's personal topic)
    + physio_modifier       (HRV trend, EDA spike, sleep deficit, glucose, circadian)
    + delivery_quality      (timing, grounding, circle relay, negotiation listen ratio, humor)
```

**Reward dimensions** (from LLM scorer + arm heuristics):

| Dimension | Source | Weight |
|---|---|---|
| `stress` | arm heuristic (physio model) | Mode-dependent |
| `trust_delta` | LLM scorer | 0.20 |
| `goal_progress` | LLM scorer | 0.25 |
| `info_coverage` | orchestrator coverage fraction | 0.15 |
| `consistency` | action repeat penalty | 0.10 |
| `safety` | LLM scorer critical gate | 0.30 |
| `count_penalty` | repetition penalty | −variable |

**Episode summary** (written to `run_manifest` and DB):
```json
{
  "genuine_metrics": {
    "change_stage_delta": int,          // TTM stage advancement (heuristic)
    "stress_auc": float,                // mean(1 - stress_index) per turn
    "turns_to_goal": int | null,        // first turn where info_coverage >= 0.75
    "goal_achieved": bool,
    "discrepancy_flag": bool,           // arm reward diverges > 3.0 from scorer
    "trust_delta_final": float,
    "vint_active": bool,
    "commitment_count": int,
    "clinical_commitments": int
  }
}
```

---

## server.py — FastAPI microservice

Exposes the Python layer to Node.js over HTTP. Port 8765.

**Key endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness check |
| `/mcts/best-action` | POST | Run DialogMCTS, return best action + M_trunc |
| `/physio/history/append` | POST | Append physio snapshot to subject history |
| `/llm/scout` | POST | Call Llama 4 Scout (fast generation) |
| `/llm/maverick` | POST | Call Llama 4 Maverick (deep reasoning / judge) |
| `/session/open` | POST | Open SharedTensorBuffer for a session |
| `/session/tensor/update` | POST | Update one agent's HRV + propagate V_int |
| `/session/tensor/summary` | POST | Get HRV summary + consistency hint |
| `/session/close` | POST | Close session, persist state |
| `/benchmark/run/create` | POST | Create A3C training run record in DB |
| `/benchmark/episode/create` | POST | Create episode record |
| `/benchmark/turn` | POST | Append turn record |

All endpoints retry with exponential backoff on Bedrock 429/503 responses.

---

## References

| Reference | Section |
|---|---|
| Moiseyev, N. (2011). *Non-Hermitian Quantum Mechanics*. Cambridge University Press. | H_eff non-Hermitian operator (`apply_transition`) |
| Vidal, G. (2003). Efficient classical simulation of slightly entangled quantum computations. *Physical Review Letters*, 91, 147902. | MPS tensor network representation (core/mps.py) |
| Schollwöck, U. (2011). The density-matrix renormalization group in the age of matrix product states. *Annals of Physics*, 326, 96–192. | MPS formalism, bond dimension (core/mps.py) |
| Rescorla, R.A. & Wagner, A.R. (1972). A theory of Pavlovian conditioning: Variations in the effectiveness of reinforcement and non-reinforcement. In Black & Prokasy (Eds.), *Classical Conditioning II*, Appleton-Century-Crofts, 64–99. | Fear weight update rule (physio/hysteresis.py) |
| Bouton, M.E. (2004). Context and behavioral processes in extinction. *Learning & Memory*, 11, 485–494. | Hysteresis extinction/recovery model (physio/hysteresis.py) |
| Mnih, V. et al. (2016). Asynchronous methods for deep reinforcement learning. *ICML 2016*, arXiv:1602.01783. | A3C actor-critic update (a3c/worker.py) |
| Holford, N.H.G. & Sheiner, L.B. (1981). Understanding the dose-effect relationship: Clinical application of pharmacokinetic-pharmacodynamic models. *Clinical Pharmacokinetics*, 6, 429–453. | E_max Hill equation (physio/pkpd.py) |
| Kleiger, R.E. et al. (2005). Heart rate variability: Measurement and clinical utility. *Annals of Noninvasive Electrocardiology*, 10(1), 88–101. | HRV signal weight and Metoprolol reference (physio/state.py, physio/pkpd.py) |
