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
| run_013 | **Complete** | First clean 200-episode run. All three experiments functional. See `05_results.md` |
| run_014 | Pending | Will include V_int, ReactivityProfile, M_trunc, genuine_metrics |

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
