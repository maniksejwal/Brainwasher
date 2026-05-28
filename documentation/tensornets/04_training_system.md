# Training System — A3C Three-Experiment Comparison

> Modules: `tensornets/tensornets/a3c/`  
> Entry point: `python -m tensornets.a3c.train --run-dir runs/run_NNN --episodes N`  
> Design reference: `docs/tensornets/A3C_COMPARISON_DESIGN.md`

---

## Terminology

What the original design called "arms" are three **independent training experiments** (independent environments / conditions). Each trains separately on the same scenario distribution and is compared as an experimental condition in a controlled ablation study. The identifier `arm` is retained in DB columns and code for backwards-compatibility with run_008–run_013 data; user-facing text and documentation use **experiment**.

| Code id | Experiment name | Role |
|---|---|---|
| `htn_mcts` | Experiment 1 | Treatment — full HTN + MCTS stack |
| `oldschool` | Experiment 2 | Baseline — production JS companion |
| `hysteresis_prompt` | Experiment 3 | Baseline — text-serialised physio, no MPS |

---

## 1. Why a three-experiment comparison?

The central research question is whether the MPS physiological state layer and the MCTS action selector genuinely improve therapeutic outcomes — or whether a well-prompted LLM achieves similar results with far less complexity.

The three-experiment design is a controlled ablation:

| Experiment | Name | What it uses | What it does NOT use |
|---|---|---|---|
| **Exp 1** | `htn_mcts` | MCTS + MPS + V_int + M_trunc + ReactivityProfile + DrugRegimen + Scout | Direct JS production path |
| **Exp 2** | `oldschool` | The production Node.js CompanionCoordinator (full JS system) | A3C Actor/Critic, MPS |
| **Exp 3** | `hysteresis_prompt` | Scout LLM with physio state serialised as text in the prompt | MCTS, MPS, V_int, ReactivityProfile |

All three experiments share the same Actor/Critic parameter updates (shared learning), run on the same scenario distribution, and are scored by the same LLM judge (Maverick). This isolates the *contribution of each layer* rather than comparing different systems.

---

## 2. The POMDP-H formulation

The training environment is a **Partially Observable Markov Decision Process with Hysteresis** (POMDP-H):

- **State** s: the patient's full internal state (MPS + hysteretic baseline + reactivity + drug state) — *partially observed* by the companion
- **Observation** o: conversation history + physiological snapshot + coverage fraction
- **Action** a: one of 41 actions from ACTION_TAXONOMY
- **Reward** r: multi-dimensional vector from LLM judge + physio heuristics
- **Transition** P(s'|s,a): governed by the physio model + synthetic patient LLM
- **Horizon** T: up to MAX_TURNS = 50 per episode (scenario-specific max_turns may be lower)

The "H" in POMDP-H refers to the hysteretic component: the state transition is non-Markovian because the patient's fear weight carries memory across sessions.

---

## 3. The three experiments in detail

### Experiment 1 — htn_mcts (treatment)

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

M_trunc injection (F3/F4): the top 3 actions from the MCTS dominant singular vector are appended to the Scout system prompt as `[MCTS GUIDANCE]`. This soft-steers generation without requiring logit access.

### Experiment 2 — oldschool (production baseline)

Posts each turn to the Node.js `/api/benchmark/message` endpoint — the same endpoint used in production. The full CompanionCoordinator stack executes: action selector, FRAMES, empathy handler, hysteresis (JS version), etc.

The A3C Actor/Critic observes the production system's action choices and reward, so the shared policy learns from the production system's decisions. This is intentional: Experiment 2 is not a frozen baseline — it is a teacher.

Experiment 2 frequently hits the `billing_denial_mcts_demo` and `flooding_social_anxiety` scenarios with 2-strike failures, consistent with the production system not being optimised for those clinical edge cases.

### Experiment 3 — hysteresis_prompt (text-physio baseline)

The companion prompt includes a physio summary block:

```
[PHYSIO] stress=0.62 (high) | HRV=22ms | EDA=8μS | sleep_deficit=2h
         archetype=anxious | change_stage=contemplation
         hysteretic trigger: alcohol (w=0.71)
```

No MPS computation. The LLM must infer appropriate strategy purely from this text. This experiment tests whether the MPS/MCTS layer adds value beyond giving the LLM more structured context.

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
| `pester_penalty` | `min(0.3, max(0, (redirect_streak - 1) × 0.10))` | Penalise repeating clinical pushes after patient redirect |
| `rapport_bonus` | +0.07 if patient redirected AND companion engaged personally | Reward person-first responses |
| `physio_modifier` | HRV trend + EDA spike + sleep deficit + glucose + circadian | Reward physiologically-appropriate actions |
| `delivery_quality` | timing + grounding + circle relay + negotiation listen ratio + humor | Reward contextually well-delivered information |

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
| run_013 | **Complete** | First clean 200-episode run. All three experiments functional. See `05_results.md` |
| run_014 | Pending | Will include V_int, ReactivityProfile, M_trunc, genuine_metrics |
