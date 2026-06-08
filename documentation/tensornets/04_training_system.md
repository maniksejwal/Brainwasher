# Training System — A3C Three-Experiment Comparison

> Modules: `tensornets/tensornets/a3c/`  
> Entry point: `python -m tensornets.a3c.train --run-dir runs/run_NNN --episodes N`  
> Design reference: `docs/tensornets/A3C_COMPARISON_DESIGN.md`

---

## Terminology

What the original design called "arms" are **independent training experiments** (independent environments / conditions). Each trains separately on the same scenario distribution and is compared as an experimental condition in a controlled ablation study. The identifier `arm` is retained in DB columns and code for backwards-compatibility with run_008–run_013 data; user-facing text and documentation use **experiment**.

As of run_018, the experiment suite has expanded from the original 3-arm design to **8 experiments** spanning a capability ladder from plain text-physio prompting to hierarchical progressive-widening VOOT tree search. The full taxonomy is defined in `tensornets/tensornets/a3c/arms.py`.

---

## 1. Eight-experiment comparison (run_018+)

The central research question is whether the MPS physiological state layer and the MCTS action selector genuinely improve therapeutic outcomes, and at what capability and cost premium. The expanded set separates **four orthogonal variables**:

| Variable | Off | On |
|---|---|---|
| Physio representation | None (oldschool) | Text summary (physio_llm) or MPS (physio_mps) |
| Action planner | Actor log-bias table | LLM chain-of-thought (cot) or MPS-MCTS tree search (mps_mcts) |
| Inertial dead-band | No | `HysteresisGate` 5-zone state machine (inertial_*) |
| Tree search algorithm | `DialogMCTS` (80 iter) | `HierarchicalPWVOOTMCTS` (150 iter, `hpvoot`) |

### Full experiment index

| Exp | Class | `arm_name` | Capability | LLM calls/turn |
|---|---|---|---|---|
| 0 | `PhysioLLMWorker` | `physio_llm` | Physio text in prompt, actor action selection | 1 (Scout) |
| 1 | `PhysioLLMCoTMCTSWorker` | `physio_llm_cot_mcts` | Exp 0 + Maverick chain-of-thought action selection | 2 (Maverick CoT + Scout) |
| 2 | `PhysioMPSMCTSWorker` | `physio_mps_mcts` | Full HTN: MPS + `DialogMCTS` + M_trunc constraint | 1 (Scout) + MCTS bridge |
| 3 | `InertialPhysioMPSMCTSWorker` | `inertial_physio_mps_mcts` | Exp 2 + `HysteresisGate` 5-zone dead-band | 1 (Scout) + MCTS bridge |
| 4 | `InertialPhysioLLMCoTMCTSWorker` | `inertial_physio_llm_cot_mcts` | Exp 1 + `HysteresisGate` | 2 (Maverick CoT + Scout) |
| 5 | `OldschoolWorker` | `oldschool` | Production Node.js `CompanionCoordinator` via HTTP | 0 Python LLM calls (JS handles) |
| 6 | `InertialHPVOOTPhysioMPSMCTSWorker` | `inertial_hpvoot_physio_mps_mcts` | Exp 3 + `HierarchicalPWVOOTMCTS` (150 iter) + Scout LLM prior | 2 (Scout prior + Scout generation) |
| 7 | `InertialHPVOOTPhysioLLMCoTMCTSWorker` | `inertial_hpvoot_physio_llm_cot_mcts` | Exp 4 + `HierarchicalPWVOOTMCTS`; Maverick CoT ratings reused as PW prior | 2 (Maverick CoT + Scout) |

**Capability order (ascending):** 5 < 0 < 1 < 4 < 2 < 3 < 6 ≈ 7

All experiments share the same Actor/Critic parameter updates (shared learning), run on the same scenario distribution, and are scored by the same LLM judge (Maverick). This isolates the *contribution of each layer* rather than comparing different systems.

### Per-experiment detail

#### Exp 0 — `physio_llm` (text-physio baseline)

The system prompt includes a natural-language physio summary block (stress level, HRV, EDA, sleep pressure, hysteresis trigger history). No MPS, no MCTS. The LLM must infer appropriate strategy purely from this text. Tests: "Does structured physio context in the prompt suffice?"

```
[PHYSIO] stress=0.62 (high) | HRV=22ms | EDA=8μS | sleep_deficit=2h
         archetype=anxious | change_stage=contemplation
         hysteretic trigger: alcohol (w=0.71, 32% extinguished)
```

#### Exp 1 — `physio_llm_cot_mcts` (LLM-as-planner baseline)

Same physio prompt as Exp 0, but action selection is replaced by a **Maverick chain-of-thought call** that evaluates all 51 `ACTION_TAXONOMY` candidates and returns `CHOSEN_ACTION` + `CONFIDENCE` + `REASONING`. Scout then generates the companion response. Two LLM calls per turn. Cost and capability baseline for Exp 2: answers "Can an LLM reason its way to the same action quality as a structured planner?"

#### Exp 2 — `physio_mps_mcts` (full HTN treatment, formerly `htn_mcts`)

Full HTN stack: Actor selects candidate action → `POST /mcts/best-action` refines via `DialogMCTS` (80 iterations, depth 20) → `POST /physio/history/append` updates MPS state → Scout generation with M_trunc constraint injection. On MCTS bridge failure, degrades to Exp 0 behaviour for that turn (flagged in episode log).

**M_trunc constraint injection (F3/F4):** The top 3 actions from the MCTS dominant singular vector are appended to the Scout system prompt as `[MCTS GUIDANCE]`. This soft-steers generation without requiring logit access to the Bedrock API.

#### Exp 3 — `inertial_physio_mps_mcts` (most capable baseline-free experiment)

Extends Exp 2 with a **`HysteresisGate` 5-zone dead-band state machine**. The gate prevents strategy flip-flopping by locking the stress bucket to a zone (CALM / MILD / MODERATE / ELEVATED / CRITICAL) until the stress index has persisted in the new zone for a minimum streak. Zone and streak are injected into the MCTS payload and the system prompt, so the MPS tree search is aware of sustained stress tiers rather than instantaneous readings.

#### Exp 4 — `inertial_physio_llm_cot_mcts`

Exp 1 + `HysteresisGate`. CoT-MCTS with inertial zone awareness. The zone context is injected into the Maverick CoT prompt: `"Physiological zone (inertial): ELEVATED (sustained for 4 turns, stable)."` Answers: "Does inertial context help the LLM planner more than the MPS-MCTS planner?"

#### Exp 5 — `oldschool` (production JS companion)

Posts each turn to `Node.js /api/benchmark/message` — the same endpoint used in production. The full `CompanionCoordinator` stack executes: action selector, FRAMES, empathy handler, hysteresis (JS version), etc. Zero Python LLM calls; reward is deferred and back-filled from `htn_benchmark_turns` after the episode. This experiment IS the production system — it is not a frozen baseline but an active teacher for the shared A3C policy.

#### Exp 6 — `inertial_hpvoot_physio_mps_mcts` (HP+VOOT+PW treatment)

Extends Exp 3 by upgrading `DialogMCTS` (80 iter) to **`HierarchicalPWVOOTMCTS`** (150 iter, depth 20, `mcts_mode=hpvoot`). An additional Scout call fetches a numeric prior score over all HP actions before tree search, seeding the progressive-widening expansion order with contextual relevance. Two LLM calls per turn total (Scout prior + Scout generation). Tests whether hierarchical action clustering + VOOT + PW adds measurable value over flat MCTS.

#### Exp 7 — `inertial_hpvoot_physio_llm_cot_mcts` (HP+VOOT+PW + CoT)

Extends Exp 4 with HP+VOOT+PW. The Maverick CoT response already includes per-action ratings (0–10); these are parsed and reused as the PW prior at **zero additional LLM cost**. Turn flow: (1) Maverick CoT rates all actions + selects `CHOSEN_ACTION`; (2) extracted ratings → `llm_prior_scores` for HP+VOOT+PW; (3) `POST /mcts/best-action mcts_mode=hpvoot`; (4) Scout generates using MCTS-final action. Total: 2 LLM calls/turn (same as Exp 4).

---

## 2. The POMDP-H formulation

The training environment is a **Partially Observable Markov Decision Process with Hysteresis** (POMDP-H):

- **State** s: the patient's full internal state (MPS + hysteretic baseline + reactivity + drug state) — *partially observed* by the companion
- **Observation** o: conversation history + physiological snapshot + coverage fraction
- **Action** a: one of 51 actions from `ACTION_TAXONOMY`
- **Reward** r: multi-dimensional vector from LLM judge + physio heuristics
- **Transition** P(s'|s,a): governed by the physio model + synthetic patient LLM
- **Horizon** T: up to `MAX_TURNS = 50` per episode (scenario-specific `max_turns` may be lower)

The "H" in POMDP-H refers to the hysteretic component: the state transition is non-Markovian because the patient's fear weight carries memory across sessions. Experiments 3 and 4 add a second layer of hysteresis via `HysteresisGate` — the **action-selection policy** itself is inertial, not just the state.

---

## 3. The experiments in detail

See **§1** above for the full per-experiment detail. This section documents the key reward and state differences between the experiment families.

```
per-turn flow:
1. Actor selects action a ~ π(·|stress_bucket, therapeutic_mode)
2. POST /mcts/best-action → DialogMCTS refines action, returns M_trunc
3. POST /physio/history/append → update physio history
4. _call_scout(state, action, scenario, m_trunc)
   → inject MCTS guidance from M_trunc dominant vector into system prompt
   → POST /llm/scout → generate companion response
5. _stress_after_response(stress, action, archetype, drug_regimen)
   → apply ReactivityProfile.gamma_modifier()
   → apply DrugRegimen.gamma_modifier()
6. _synthetic_reward() → experiment reward dimensions
7. Scorer (even turns) or heuristic carry (odd turns)
8. A3C update: Actor log-bias adjustment + Critic TD(0)
```

### 3.1 Physio representation family (Exp 0, 1, 4, 7 — text-physio)


The physio summary is serialised as a natural-language block (`_build_hysteresis_context()`). The function differentiates three `physio_source` modes:

- `"sensor"` — real wearable data; full numeric values shown
- `"simulated"` — scenario-derived estimates; labelled "estimated from scenario"
- `"none"` — no wearable; only conversation-inferred stress bucket shown

A stress discrepancy signal is computed: `Δ = physio_stress − conversation_stress`. Positive Δ (physio stressed, conversation calm) flags **possible masking**; negative Δ flags **possible outburst**.

### 3.2 MPS-MCTS family (Exp 2, 3, 6)

Uses the tensornets FastAPI bridge for two calls per turn:
1. `POST /physio/history/append` — appends physio snapshot to MPS history
2. `POST /mcts/best-action` — returns `best_action` + `M_trunc` matrix

`mcts_mode` parameter controls tree search algorithm:
- `"dialog"` (default) — `DialogMCTS`, 80 iterations, depth 20
- `"hpvoot"` (Exp 6, 7) — `HierarchicalPWVOOTMCTS`, 150 iterations, depth 20; requires `llm_prior_scores` list

On MCTS bridge failure, Exp 2 degrades to text-physio (Exp 0) behaviour for that turn; `reward["safety"]` is clamped to ≤ 0.8 to flag the fallback.

### 3.3 HysteresisGate (Exp 3, 4, 6, 7 — inertial experiments)

`HysteresisGate` maintains a 5-zone state machine:

| Zone | `stress_index` range | Name |
|---|---|---|
| 0 | [0.00, 0.20) | CALM |
| 1 | [0.20, 0.40) | MILD |
| 2 | [0.40, 0.60) | MODERATE |
| 3 | [0.60, 0.80) | ELEVATED |
| 4 | [0.80, 1.00] | CRITICAL |

The gate locks the zone until the stress index has left it for a minimum streak count. `zone_changed` is `True` on the turn of a zone transition. The locked zone overrides `state.stress_bucket`, so both the MCTS planner and the Scout prompt see the sustained zone rather than the instantaneous reading.

### 3.4 Oldschool (Exp 5 — production JS companion)

Posts to `Node.js /api/benchmark/message`. The A3C Actor/Critic observes the production system's action choices and reward, so the **shared policy learns from the production system's decisions** — Exp 5 is a teacher, not a frozen baseline. Reward is deferred and back-filled from `htn_benchmark_turns` after the episode. `deferred_reward=True` in the episode JSONL flags turns where the reward placeholder has not yet been filled.

---

## 4. Reward signal

### 4.1 LLM judge (A3CScorer)

The `A3CScorer` calls Llama 4 Maverick on every even turn (turns 0, 2, 4, ...) to score the companion's response on 7 integer dimensions:

| Dimension | Range | Weight | Meaning |
|---|---|---|---|
| `trust_delta` | −2 to +2 | 0.20 | Alliance change this turn |
| `goal_progress` | −2 to +2 | 0.25 | Clinical goal advancement |
| `info_gathering` | −2 to +2 | 0.05 | Patient disclosure elicited |
| `generic_response` | −2 to 0 | 0.10 | Penalty for boilerplate |
| `consistency` | −2 to +2 | 0.10 | Logical/thematic consistency |
| `safety` | −2 to +2 | 0.30 | Safety and appropriateness |
| `urgency` | −2 to +2 | — | Used only for 2-strike termination |

A `critical_failure` is flagged when `safety ≤ -2` OR `urgency ≤ -2`. Two consecutive critical failures terminate the episode.

Grace period: turns 0–2 only count strikes for `urgency ≤ -2` (true safety signals). Generic responses and denial in early turns are clinically expected and are not penalised as strikes.

On odd turns, the previous score result is carried with a heuristic nudge:
- Action in high-value group → `continuous_score += 0.03`
- Patient distress cue detected → `continuous_score -= 0.05`

### 4.2 Reward modifiers (worker.py)

Applied on top of the base scalar reward:

| Modifier | Formula | Purpose |
|---|---|---|
| `pester_penalty` | `min(0.3, max(0, (redirect_streak − 1) × 0.10))` | Penalise repeated clinical pushes after patient redirect |
| `rapport_bonus` | `+0.07 if patient_redirected AND companion_engaged_personally` | Reward person-first responses |
| `physio_modifier` | See below | Reward physiologically-appropriate action timing |
| `delivery_quality` | See below | Reward contextually well-delivered information |

**physio_modifier** — computed from the current `PhysiologicalState` snapshot at the time of response:

\[
\text{physio\_modifier} = w_{HRV} \cdot \Delta_{HRV} + w_{EDA} \cdot \mathbb{1}[EDA\_spike] + w_{sleep} \cdot \text{deficit\_penalty} + w_{gluc} \cdot \text{glucose\_penalty} + w_{circ} \cdot \text{circadian\_penalty}
\]

where each component rewards responses that are appropriate given the patient's physiological state (e.g., grounding actions when HRV is low are rewarded positively; psychoeducation when HRV is low is penalised). Weights are the same as the stress index weights (0.35, 0.20, 0.15, 0.10, 0.10).

**delivery_quality** — computed from the action taxonomy and context:

\[
\text{delivery\_quality} = w_t \cdot \text{timing\_score} + w_g \cdot \text{grounding\_score} + w_r \cdot \text{relay\_score} + w_n \cdot \text{negotiation\_listen\_ratio} + w_h \cdot \text{humor\_appropriateness}
\]

- `timing_score`: +0.05 if MCTS recommended this action and it was delivered on the MCTS-recommended turn; −0.03 if delivered against MCTS guidance
- `grounding_score`: +0.04 if action is a grounding/validation type and stress_index > 0.65
- `relay_score`: +0.03 if cross-circle relay was used appropriately (escalation context)
- `negotiation_listen_ratio`: ratio of patient words to companion words in the last 4 turns; reward approaches 0.03 as ratio approaches 2:1 (patient speaking more)
- `humor_appropriateness`: +0.02 if `humor` action selected AND stress_index < 0.45 (appropriate); −0.02 if stress_index > 0.65 (inappropriate)

Source: `tensornets/tensornets/a3c/worker.py`, `_compute_physio_modifier()` and `_compute_delivery_quality()`.

Total: `r = scalar_reward(reward_dict) − pester_penalty + rapport_bonus + physio_modifier + delivery_quality`

### 4.3 Genuine progress metrics

These are computed per episode and stored in `genuine_metrics`. They are **methodologically independent** of the action-selection heuristics and serve as the primary comparison basis between arms:

| Metric | Description | Why it matters |
|---|---|---|
| `change_stage_delta` | Heuristic TTM stage advancement (coverage ≥ 80% + mean stress ≤ 50%) | Captures clinical outcome, not just reward |
| `stress_auc` | mean(1 − stress_index) over all turns | Measures sustained calm — a therapeutic aim in itself |
| `turns_to_goal` | First turn where info_coverage ≥ 0.75 | Efficiency — did the companion get there quickly? |
| `goal_achieved` | turns_to_goal is not None | Binary success flag |
| `discrepancy_flag` | \|experiment_reward − scorer_cumulative\| > 3.0 | Flags experiment reward circularity |
| `trust_delta_final` | Accumulated trust_delta from LLM scorer | Long-run alliance quality |

---

## 5. Synthetic patient

`SyntheticParticipant` simulates the patient's side of the conversation. It is an LLM (Scout) driven by a persona prompt that encodes:

- Clinical background (diagnosis, history, current medications)
- Behaviour change stage (`change_stage` from TTM)
- Archetype (how they communicate under stress)
- Active triggers and craving intensity
- Explicit role constraints (`You are the CAREGIVER. You do NOT have a drinking problem.`)

For multi-user scenarios, `CareCircleOrchestrator` manages speaker selection and provides each participant with their correct persona prompt. A fallback log-warning is issued if a scenario is missing a role-specific prompt rather than silently collapsing all roles to the patient prompt.

### Nudge logic

If the patient has not disclosed any clinical content by turn 4, the synthetic patient receives a hidden nudge to allow some disclosure. Without this, pre-contemplation patients can deflect indefinitely, making the episode uninformative.

---

## 6. Scenario distribution

Training scenarios span 4 clinical domains and 2 business domains:

| Category | Scenarios |
|---|---|
| Deaddiction | `deaddiction_alcohol_rapport`, `..._ambivalence`, `..._insight`, `..._strike` |
| Flooding | `flooding_social_anxiety`, `flooding_social_anxiety_flooding` |
| Multi-user / care circle | `family_care_circle_coordination`, `multi_agent_relapse_prevention` |
| General clinical | `depression_passive_suicidality`, `angina_lifestyle_resistance` |
| Business negotiation | `billing_denial_mcts_demo`, `negotiation_undefined`, `finance_roi_justification` |

Scenarios include `therapeutic_mode`, `deaddiction_phase`, `initial_physio`, `session_goal`, `archetype`, optional `drug_regimen`, and role-specific persona prompts.

---

## 7. Checkpointing and resume

Checkpoints are written every N episodes (default `--checkpoint-every 5`). Each checkpoint saves:

- `actor_{step}.json` — log-bias dict per stress bucket (and mode-conditioned compound keys)
- `critic_{step}.json` — linear weight vector
- `run_state.json` — episode count, scenario cursor, random state

A run can be resumed with `--resume runs/run_NNN` — the training loop reloads the latest checkpoint and continues from where it left off.

---

## 8. Thompson Sampling warm-up (Phase 3)

Before A3C updates begin (episodes 0–4 per arm), actions are sampled via **Thompson Sampling** over the action bandit priors (`bandit_actor_prior.json`). This avoids the cold-start collapse where a uniform policy selects mediocre actions repeatedly in the first few turns, causing early 2-strike terminations that prevent any learning signal.

### Prior distribution

Each action `a` in each stress bucket `b` is initialised with a Beta distribution prior:

\[
\text{Prior}(a, b) = \text{Beta}(\alpha_0, \beta_0)
\]

where \( \alpha_0 = 1 + n_{a,b}^{+} \) and \( \beta_0 = 1 + n_{a,b}^{-} \), loaded from `bandit_actor_prior.json`. Cold-start uses \( \alpha_0 = \beta_0 = 1 \) (uniform prior = no preference). 

At each turn, a sample \( \theta_{a,b} \sim \text{Beta}(\alpha_{a,b}, \beta_{a,b}) \) is drawn for each eligible action, and the action with the highest sample is selected:

\[
a^* = \arg\max_{a \in A_{eligible}(b)} \theta_{a,b}
\]

where \( A_{eligible}(b) \) is the set of actions not blocked by the current stress gate (see §3 for the blocking rules).

After the A3C warm-up, the actor policy \( \pi(a|k) = \text{softmax}(b_{a,k}) \) (log-bias table, key \( k = \text{stress\_bucket} \times \text{therapeutic\_mode} \)) takes over. The bandit posterior is not discarded — it continues to be updated alongside the actor and serves as a regularisation anchor against catastrophic forgetting (Kirkpatrick et al., 2017).

Source: `tensornets/tensornets/a3c/action_bandit.py`, `ActionBandit` class.

---

## 9. Run naming convention

| Run | Status | Notes |
|---|---|---|
| run_001 to run_007 | Legacy / exploratory | No episode data — config/scaffold runs only |
| run_008 | Partial (50 eps) | Pre-port-fix, pre-genuine-metrics |
| run_009 | Partial (158 eps) | 2-strike grace period not yet implemented — early termination excess |
| run_010 | Failed (port 8765) | 3 episodes only — 150 consecutive connection-refused errors |
| run_011 | Partial | Scorer JSON parse errors, no episode files |
| run_012 | Failed (port 8765) | Same as run_010 — 200 episodes, 0 successful |
| run_013 | **Complete** | First clean 200-episode run. Original 3-arm design. See `06_results.md` |
| run_014–run_017 | Pending / exploratory | V_int, ReactivityProfile, M_trunc, genuine_metrics integration |
| run_018 | **Active** | 8-experiment expanded design (`arms.py`). Episodes accumulating across all 8 arm directories |

### run_018 arm directory structure

```
tensornets/runs/run_018/
├── arm_physio_llm/                    ← Exp 0  (~221 episodes)
├── arm_physio_llm_cot_mcts/           ← Exp 1  (~222 episodes, checkpoints at ep 60+)
├── arm_physio_mps_mcts/               ← Exp 2  (~200 episodes, checkpoints at ep 50+)
├── arm_inertial_physio_mps_mcts/      ← Exp 3  (~206 episodes)
├── arm_inertial_physio_llm_cot_mcts/  ← Exp 4  (~203 episodes)
├── arm_oldschool/                     ← Exp 5  (~151 episodes)
├── arm_inertial_hpvoot_physio_mps_mcts/     ← Exp 6  (~207 episodes)
└── arm_inertial_hpvoot_physio_llm_cot_mcts/ ← Exp 7  (~93 episodes)
```

Each arm directory contains:
- `episodes/episode_<uuid>.jsonl` — one file per completed episode; each line is one `EpisodeTurn` record
- `checkpoints/actor_<N>.json` — Actor log-bias dict at episode N: `{stress_bucket: {action_name: log_bias}}`; buckets are plain (`"low"`) or mode-compound (`"standard_low"`, `"flooding_moderate"`)
- `checkpoints/critic_<N>.json` — `{"weights": [float × 7]}` for features `(stress_index, turn_progress, history_len_norm, info_coverage, repetition, mode_idx, bias)`
- `checkpoints/run_state.json` — `{last_completed_episode, ep_count, successful_eps, db_run_id, last_session_memory, active_prompt, last_improved_at}`

> **Note:** `tmp_arms.py` (project root, untracked) is a 16-line diagnostic script that imports all 8 arm classes and prints their names. It is not a training entry-point and contains no new logic — safe to ignore or delete.

---

## 10. Human-in-the-Loop (HITL) feedback integration

The current A3C reward signal is fully automated (LLM-as-judge). HITL feedback is architecturally prepared but not yet wired end-to-end.

### Current state

| Component | Status | Location |
|---|---|---|
| `training/feedback/annotator.js` | **Built** — processes scored episodes | `training/feedback/annotator.js` |
| `/api/training/episodes/{id}/score` endpoint | **Built** — accepts human score | `routes/training.js` |
| HTN Judge offline batch | **Built** — Llama 405B batch judge | `training/judge.py` |
| HITL → A3C weight update | **Missing** — connection not yet wired | Pending |

### Planned HITL integration path

When HITL feedback is wired:

1. A clinician reviews flagged episodes (episodes where `discrepancy_flag=True` or `safety ≤ −1`)
2. The clinician scores each turn via the annotation UI (`/api/training/episodes/{id}/score`)
3. `annotator.js` stores the human score alongside the automated score in the DB
4. A `trust_weighted_score` is computed: \( r_{trust} = (1 − w_{hitl}) \cdot r_{auto} + w_{hitl} \cdot r_{human} \), where \( w_{hitl} \) begins at 0.3 and increases as annotation volume grows
5. The trust-weighted score replaces `continuous_score` in the A3C advantage computation for the flagged episode
6. The actor log-biases and critic weights are retroactively updated via offline advantage re-computation

This is architecturally equivalent to the DPO (Direct Preference Optimisation) reward signal used in RLHF pipelines, adapted for the log-bias actor representation.

### The `DiscrepancyAudit` bridge

`training/judge.py` exports `DiscrepancyAudit`, which runs all three judges (JS scorer, Maverick, 405B) on the same episode and computes cross-evaluator agreement. Episodes with low inter-judge agreement are flagged for HITL review. This is the mechanism by which the 405B offline judge identifies turns that the real-time Maverick judge may have misjudged under latency pressure.
