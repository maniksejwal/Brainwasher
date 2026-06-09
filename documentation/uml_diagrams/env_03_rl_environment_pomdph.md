# Environment Diagram 3 — RL Environment (POMDP-H)

> **View:** Process / Scenario View — the training environment as a
> formal dynamical system.  
> **Purpose:** Shows the POMDP-H state space, the observation and action
> interfaces, the reward function decomposition, and how the A3C workers
> interact with it.

## State Space — HysteresisGate Zones

```mermaid
stateDiagram-v2
    direction LR

    [*] --> Zone2_Medium : initial state\n(stress_index ~ 0.3)

    Zone0_VeryLow : Zone 0 — Very Low Stress\nstress_index in [0, 0.20]\nHRV high · EDA low\nGamma_physio minimal
    Zone1_Low : Zone 1 — Low Stress\nstress_index in (0.20, 0.40]\nHRV moderate\nGamma_physio low
    Zone2_Medium : Zone 2 — Medium Stress\nstress_index in (0.40, 0.60]\nBaseline state\nGamma_physio moderate
    Zone3_High : Zone 3 — High Stress\nstress_index in (0.60, 0.85]\nHRV low · EDA elevated\nGamma_physio high\nMCTS blocks advice actions
    Zone4_VeryHigh : Zone 4 — Crisis\nstress_index in (0.85, 1.0]\nHRV very low\nEscalation triggered\nOnly safety_protocol allowed

    Zone0_VeryLow --> Zone1_Low : stress rises above 0.20
    Zone1_Low --> Zone0_VeryLow : stress falls below 0.15 (hysteresis gap)
    Zone1_Low --> Zone2_Medium : stress rises above 0.40
    Zone2_Medium --> Zone1_Low : stress falls below 0.35 (hysteresis gap)
    Zone2_Medium --> Zone3_High : stress rises above 0.60
    Zone3_High --> Zone2_Medium : stress falls below 0.55 (hysteresis gap)
    Zone3_High --> Zone4_VeryHigh : stress rises above 0.85
    Zone4_VeryHigh --> Zone3_High : stress falls below 0.80 (hysteresis gap)
    Zone4_VeryHigh --> [*] : episode terminates\n(2-strike or max turns)
```

> **Hysteresis property:** Entry threshold > exit threshold for each zone
> boundary. A patient who reaches Zone 3 requires a larger stress reduction
> to leave it than was needed to enter — modelling psychological inertia
> (Bouton, 2004; Foa & Kozak, 1986).

## POMDP-H Formal Structure

```mermaid
graph LR
    subgraph state_space [State Space S]
        PhysioState["Physiological state\ns = (hrv_ms, eda_us,\nsleep_deficit,\nglucose_mg_dl,\nstress_index)"]
        MPSState["MPS history\n|ψ⟩ over T=10 turns\nbond dim χ=4"]
        HystState["HysteresisGate zone\nZone 0–4\nasymmetric thresholds"]
        TherState["Therapeutic state\n(phase, alliance,\ninfo_coverage,\nreadiness_stage)"]
    end

    subgraph obs_space [Observation Space Ω]
        Utterance["Patient utterance text\n(Scout LLM generates)"]
        IntentFeats["Extracted features\nintent · facts · empathy\n(inputUnderstanding)"]
    end

    subgraph action_space [Action Space A — 22 actions]
        ActionsCore["Core MI actions\nreflect · validate · probe\nacknowledge · affirm\nsummarise"]
        ActionsClin["Clinical actions\nprovide_info · suggest_resource\nsafety_protocol\nescalate"]
        ActionsNav["Navigational\nchange_topic · topic_from_stack\nsurface_intervention\ndefer_intervention"]
        ActionsAdv["Advanced MI\ndevelop_discrepancy\nreframe · explore_ambivalence\nhighlight_strength"]
    end

    subgraph reward [Reward r_t]
        R1["r_progress\n= Δinfo_coverage × 1.5"]
        R2["r_stress\n= -stress_index × 0.3"]
        R3["r_trust\n= Δtrust × 0.5"]
        RGoal["goal_progress ∈ [0,1]\n(Maverick LLM judge\nindependent of MCTS)"]
    end

    subgraph transition [Transition T]
        OUProcess["HRV: OU process\ndX = θ(μ-X)dt + σdW\nθ=0.3, μ=38ms, σ=5ms"]
        GammaDecay["Γ matrix update\n6 components\nΓ_physio + Γ_habit\n+ Γ_pkpd + Γ_reactivity\n+ Γ_fear + Γ_companion"]
        MPSUpdate["MPS truncation\nSVD, keep χ=4\nsingular values"]
    end

    Utterance --> IntentFeats
    IntentFeats --> state_space
    state_space --> obs_space
    state_space --> action_space
    action_space --> reward
    state_space --> transition
    transition --> state_space
```

## A3C Worker — Environment Interface

```mermaid
sequenceDiagram
    participant Worker as A3C Worker\n(arms.py)
    participant Env as Episode Environment\n(worker.py)
    participant FastAPI as FastAPI :8765\n(server.py)
    participant Scout as Scout LLM\n(AWS Bedrock)
    participant Maverick as Maverick LLM\n(LLM-as-judge)

    Worker->>Env: reset() → initial_obs (scenario, archetype)
    loop Each turn t
        Env->>FastAPI: POST /mcts_action { physio_state, mps_state }
        FastAPI-->>Env: { action, stress_index, mcts_value }
        Env->>Scout: generate response (action guidance in prompt)
        Scout-->>Env: companion utterance text
        Env->>Scout: generate patient reply
        Scout-->>Env: patient utterance text
        Env->>Maverick: score response (goal_progress, trust_delta)
        Maverick-->>Env: { goal_progress, trust_delta, safety_ok }
        Env-->>Worker: obs_t+1, reward_t, done, info
        Worker->>Worker: accumulate gradient
    end
    Worker->>FastAPI: POST /update_weights { actor_grad, critic_grad }
    FastAPI-->>Worker: { checkpoint_saved: true }
```

## Stress Gate — Action Availability by Zone

| Zone | stress_index | Blocked actions | Rationale |
|------|-------------|-----------------|-----------|
| 0–1 | 0–0.40 | none | Full action space available |
| 2 | 0.40–0.60 | none | Baseline; mild caution |
| 3 | 0.60–0.85 | `provide_info`, `develop_discrepancy` | High stress → advice/challenge contraindicated |
| 4 | 0.85–1.0 | all except `safety_protocol`, `escalate`, `validate` | Crisis mode; only de-escalation actions |

## Episode termination conditions

| Condition | Mechanism |
|-----------|-----------|
| Goal achieved | `goal_progress ≥ 0.75` (Maverick judge) |
| 2-strike | Two consecutive turns with safety concern flag |
| Max turns | `MAX_TURNS = 20` (configurable per scenario) |
| Stress ceiling | Stress reaches Zone 4 and stays there for 3 turns |
