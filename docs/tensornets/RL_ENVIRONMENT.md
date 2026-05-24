# RL Environment Specification — HTN Framework
## Status: AUTHORITATIVE — read before writing any MCTS/training code

---

## 1. The Problem With "Environment" Here

Most RL papers have a clean environment (game, simulator, physics engine).
Ours does not.  The environment is:

  - A **human** (with private physiological state we cannot directly observe)
  - Across **multiple turns** (Markovian assumption is violated — hysteresis)
  - With **multiple agents** acting simultaneously (MCTS must coordinate)
  - Against **no ground truth** reward during training (only offline judge feedback)

This is a **Partially Observable Markov Decision Process with Hysteresis** (POMDP-H).

The standard POMDP notation: (S, A, O, T, Ω, R, γ)
Our extensions: S is hysteretic (path-dependent), O is noisy proxy signals.

---

## 2. State Space  S

### 2.1 Observable proxy state  ô_t  (what the system actually sees)

| Signal | Source | Granularity | Notes |
|---|---|---|---|
| HRV RMSSD | Wearable / simulated OU | Per turn (real) / synthetic | Partial obs — simulated during training |
| Blood glucose | CGM / wearable / simulated | Per turn | Noisy; 15-min lag on CGM |
| EDA | Wearable / simulated | Per turn | |
| Respiratory rate | Wearable / simulated | Per turn | |
| Sleep deficit | Self-report / wearable | Daily | Proxy available from conversation timing |
| Circadian phase | Derived from time of day | Per turn | |
| Location stress | GPS category / self-report | Per turn | Holiday vs work day distinction |
| Activity state | Accelerometer / self-report | Per turn | **New — see Section 6** |
| Food recency | Self-report | Per session | Needed for PK/PD food-drug interactions |
| Illness flag | Self-report | Per session | Headache, muscle cramps, fever |

### 2.2 Hidden true state  s_t  (never directly observed)

- True cortisol level
- True sympathetic/parasympathetic balance
- True emotional state (affect, not just HRV proxy)
- Conscious intent (is the patient lying about pain?)
- Hysteretic path history (w_t, h_t) — inferred, not observed

### 2.3 Hysteretic state augmentation  h_t

The standard POMDP state is Markovian: s_{t+1} depends only on s_t, a_t.
Ours is NOT.  We augment with:

```
s_aug_t = (ô_t, w_t, h_t, grudge_t, alliance_t, phase_t, session_count)
```

Where:
- `w_t` = fear weight vector (per trigger) — from `hysteresis.py`
- `h_t` = habit strength vector (per behaviour) — from `habit_hysteresis.py`
- `grudge_t` = ruminant accumulation state — from `reactivity.py`
- `alliance_t` = companion relationship state — from `companion_hysteresis.py`
- `phase_t` = deaddiction phase (rapport/ambivalence/insight/strike)
- `session_count` = total sessions completed

This is the state that MCTS rollouts simulate.

---

## 3. Action Space  A

### 3.1 Micro-actions (single-turn, what MCTS selects)

These map directly to the diagram you created:

| Category | Actions |
|---|---|
| **Information** | give_facts, psychoeducation, summarise, give_multiple_options |
| **Elicitation** | open_question (5W), specific_question, probing_question, socratic_probe |
| **Empathy** | empathic_reflection, affirmation, validate_emotion |
| **Challenge** | challenger_reframe, develop_discrepancy, loss_frame, direct_confrontation |
| **Distraction** | change_topic, introduce_new_angle, topic_from_stack |
| **Support** | unconditional_positive_regard, normalisation, containment |
| **Technique** | motivational_frame, spike_step, oars_summary, flooding_hold, flooding_deepen |
| **Meta** | acknowledge_only, end_conversation, escalate_to_clinician |

**MCTS selects one micro-action per turn.** This IS the action space.
The LLM then generates text that executes the selected action.
This is EXACTLY what the diagram represents.

### 3.2 Macro-actions (multi-turn strategic goals)

MCTS with lookahead > 1 can select sequences:
```
[open_question → affirmation → develop_discrepancy → oars_summary]
```
This is a macro-action.  The MCTS tree depth controls the lookahead horizon.

### 3.3 Recommended MCTS depth per context

| Context | Recommended depth | Reason |
|---|---|---|
| Standard conversation | 3 turns | Balance between cost and quality |
| Deaddiction (rapport phase) | 5 turns | Long-horizon trust building |
| Flooding hold | 2 turns | Real-time arousal management |
| SPIKE protocol | 6 turns (one per step) | Protocol has fixed structure |
| Crisis | 1 turn (greedy) | Latency > optimality |
| Document negotiation | 8-10 turns | Full clause ordering matters |

---

## 4. Reward Function  R

### 4.1 Immediate reward components

| Component | Signal | Weight |
|---|---|---|
| Stress reduction | Δ HRV after turn (simulated or real) | 0.3 |
| Trust delta | Change in alliance score | 0.25 |
| Goal progress | Advance toward session goal | 0.25 |
| Information coverage | New clinical facts elicited | 0.1 |
| Cross-agent consistency | No contradiction with other companions | 0.1 |

**These are the RewardVector weights from `mcts_reward.py`.**

### 4.2 Delayed / offline reward

From `training/judge.py` (LLM-as-judge with Llama 405B):
- Clinical Accuracy
- Empathy Calibration
- Goal Progress
- Safety Compliance
- Persona Consistency
- Physio Alignment

These are generated OFFLINE after session completion.
They feed the A3C training loop (Phase 5, deferred).

### 4.3 Human feedback (HITL)

From the existing `/score` command in the project.
Currently unconnected to the HTN reward function.
**Connection needed**: map HITL scores → reward signal for tensornets.

### 4.4 What is NOT a valid reward signal

- LLM confidence scores (not calibrated to physiological outcome)
- Conversation length (longer ≠ better)
- User message sentiment alone (sentiment ≠ clinical outcome)
- Immediate approval (sycophancy problem — this is the thing we are trying to avoid)

---

## 5. Transition Model  T

### 5.1 Within-session transitions (OU simulator)

```
σ_{t+1} = σ_t + θ(μ - σ_t)Δt + ξ·ε_t   [Ornstein-Uhlenbeck]
```

Parameters set by `SubjectProfile` in `physio/simulator.py`.
This is the training environment for the MCTS rollout.

**Key flaw to address (OQ-2):** we do not yet know whether the OU parameters match
real HRV trajectories.  Validation against WESAD data (E-001) is the calibration step.
Until then, MCTS is trained on an approximate simulator.

### 5.2 Between-session transitions (hysteretic)

```
w_t+1 = w_t · exp(-α_ext · session_intensity)  [fear extinction]
h_t+1 = h_t + α_form · (1 - h_t) · reinforcement  [habit formation]
alliance_{t+1} = alliance_t + α_build · rapport_gain  [companion alliance]
```

These are updated after each session, not each turn.
They represent the longitudinal MCTS state.

### 5.3 Transition model flaws (honest accounting)

| Flaw | Impact | Mitigation |
|---|---|---|
| OU parameters are priors, not fitted | MCTS optimises for wrong trajectory | Calibrate against WESAD (E-001) |
| Linguistic stress model uses rule weights, not fitted | Candidate scoring is approximate | Train stress estimator (E-008) |
| No pharmacokinetic food interaction model yet | PK/PD timing inaccurate | Add food_recency to state (Section 6) |
| Social transition (V_int) is a fixed prior matrix | Inter-agent coupling may be wrong | Learn V_int from session data (Phase 4) |

---

## 6. MCTS Instances — Should They Be Merged?

### Current situation (fragmented)

| Instance | File | State used | Reward | Depth |
|---|---|---|---|---|
| Clinical dialogue MCTS | `therapy/comparison_runner.py` | `PhysiologicalState` + mode | `RewardVector` (5-dim) | 4 turns |
| Document clause MCTS | `documents/clause_mcts.py` | `stress_sigma` + clause deps | acceptance_prob + σ | beam search |
| Scheduling MCTS | `scheduling/mcts_scheduling.py` | `SchedulingContext` | slot cost | greedy |
| Companion MCTS (JS) | `CompanionCoordinator.js` | `physio_state` (JS) | stress_projected | 1 turn (argmin) |

### Should they merge?

**Partially.** They share the same underlying state representation and reward philosophy but have different action spaces:

- **Dialogue MCTS** operates in `A = {micro-actions}` space
- **Document MCTS** operates in `A = {clause_orderings}` space
- **Scheduling MCTS** operates in `A = {time_slots}` space

They should share:
- `PhysiologicalState` + `s_aug_t` as the common state object
- `RewardVector` as the common reward container
- `SubjectProfile` + `PhysiologicalSimulator` as the rollout engine
- UCB1 selection and backpropagation code (shared MCTS base class)

They should NOT share:
- Action enumeration (different per task)
- Terminal condition detection
- Rollout candidate generation (dialogue vs. clause vs. slot)

**Recommendation**: extract a `BaseMCTS` class that the three instances inherit.
This is `tensornets/mcts/base.py` — pending in Phase 3.

### Longitudinal MCTS

Currently MCTS plans within a single session (depth = N turns).
Longitudinal MCTS plans across sessions (depth = M sessions).

```
Longitudinal action: "Which deaddiction phase to target next session?"
Longitudinal state: LongitudinalState (session_count, rapport_score, secrets, w_t, h_t)
Longitudinal reward: readiness_score delta across sessions
```

This is the `LongitudinalState` in `therapy/longitudinal.py` used as the MCTS state.
**Not yet implemented as an MCTS** — it currently only records sessions and detects secrets.
Adding longitudinal MCTS to `therapy/longitudinal.py` is a Phase 3 extension.

---

## 7. Observation Model  Ω (what the agent actually receives)

The agent does not see `s_t` directly.  It receives:
1. **User text message** — natural language, noisy, strategically distorted
2. **Physio signals** — if wearable present (real data); if not, estimated from conversation
3. **System-injected context** — conversation history, care circle state, escalations
4. **MPS bond state** — compressed history (Phase 2+)
5. **Longitudinal hints** — `getLongitudinalPromptHint()` (between-session memory)

### The flaw you identified

The physio signals during training are SIMULATED.  The simulator does not yet match
real signal statistics.  This means:

- MCTS trains on a simulator that says "if you use a confrontational response at σ=0.4, σ will drop to 0.35"
- In reality, σ might rise to 0.6 for a ruminant patient
- The trained policy is only as good as the simulator

**This is the most important known flaw in the system.**

Mitigation path:
1. E-001 (validate OU against WESAD)
2. E-008 (train linguistic stress estimator on real data)
3. Use real wearable data in production → close the loop

---

## 8. When to Distract vs. Support

This is a MCTS selection problem, not a heuristic rule problem.
The MCTS cost function handles it, but here is the explicit logic:

### Support the current topic when:
- `info_coverage` is low (patient hasn't shared important clinical facts yet)
- `trust_delta` is negative (shifting topic when trust is damaged signals avoidance)
- `phase_t` = rapport (staying in the patient's frame builds alliance)
- HRV is recovering (patient is capable of engaging)
- The topic is a gateway trigger for deaddiction work

### Distract (change topic) when:
- `σ > available_strategies.threshold` (patient is too stressed for current topic)
- `info_coverage` is saturated (all relevant facts collected on this topic)
- Repetition is detected (N ≥ 2 of same exchange)
- `phase_t` = ambivalence and topic produces sustained confrontation (→ change_topic + reintroduce later)
- **The Challenger Sale condition**: stress was deliberately elevated (flooding/challenge) AND the system detects σ has peaked → now deliver the solution. The "distraction" is actually a transition to the resolution phase.

**Implementation**: `available_strategies()` in `linguistic/stress_model.py` gates
the available action set. When HRV < 50% baseline, `psychoeducation` and `challenger_reframe`
are gated out — only containment, support, and grounding are allowed.
This IS the distract-vs-support decision, made automatically.

---

## 9. The Diagram vs. The Prompt — Assessment

The diagram is a **decision tree** for action selection.
The `unified_prompt.js` is a **text instruction** for action selection.

**The prompt is better than the diagram for these reasons:**

1. The diagram is a static tree traversal — it always follows the same path given the same inputs. It does not have a planning horizon.
2. The prompt encodes the same heuristics but adds: contextual weighting, conversational history awareness, strategic planning across turns ("you can plan ahead across multiple turns"), and tone adaptation.
3. The diagram lacks the physiological state integration — it does not know the patient's HRV.

**The diagram is better for this reason:**
1. It is explicit, testable, and auditable. The prompt may follow similar logic but you cannot verify it.
2. It maps cleanly to the MCTS action space in Section 3.

**The correct integration**: the diagram defines the **MCTS action enum** (Section 3.1). The prompt handles **action execution** (given that MCTS selected `open_question`, what exactly should the LLM say?). They are complementary, not redundant.

**What needs to change**: the `companion_patient_optimizer` prompt should receive the MCTS-selected action as an explicit input:

```
SELECTED_ACTION: {{MCTS_ACTION}}   ← new field
MCTS_RATIONALE: {{MCTS_RATIONALE}} ← new field
```

The LLM then executes that action rather than choosing one itself.
This separates planning (MCTS) from execution (LLM) cleanly.

---

## 10. Phase Terminology Clarification

There are THREE independent "phase" systems in this codebase:

| System | Values | File | Meaning |
|---|---|---|---|
| **Project phases** | Phase 0–5 | `TODO.md` | Development milestones for tensornets |
| **Deaddiction phases** | rapport / ambivalence / insight / strike | `therapy/met_framework.py` | MI session progression for a patient |
| **SPIKE protocol steps** | Setting / Perception / Invitation / Knowledge / Empathy / Strategy | `therapy/met_framework.py` | Within-session bad-news delivery sequence |

When this document says "Phase 3" it means the **project phase** (MCTS engine implementation).
When `met_framework.py` says "phase" it means the **deaddiction phase**.

### Project Phase 3 — What Is Pending

| Item | Status | Blocking |
|---|---|---|
| F1: `MCTSNode` dataclass | Not started | Phase 2 (MPS bond truncation) must complete first |
| F2: Strategic agent UCB1 selection | Not started | F1 |
| F3: SVD compress path → `M_trunc` | Not started | F2 |
| F4: Tactical agent + `project_constraint()` wiring | Not started | F3 |
| F5: Latency test <200ms | Not started | F4 |
| BaseMCTS extraction (consolidation) | Not started | Can start now — no Phase 2 dependency |
| Longitudinal MCTS | Not started | `LongitudinalState` exists; needs MCTS wrapper |

---

## 11. Social Hysteresis — Implementation Status

### What is implemented

The `SharedDialogueState` in `agents/inter_agent_comm.py` provides:
- Commitment propagation (anti-contradiction)
- V_int HRV prediction propagation (when user 1's companion says something stressful,
  user 2's companion receives the predicted HRV update before its next turn)
- Escalation routing

**Yes — if user 1's HRV changes significantly, their companion calls `agentCommit()`
with `delta_hrv_ms`, and V_int propagates this to all other companions before
their next response generation.**

### What is NOT yet implemented

- Social hysteresis per se: the V_int coupling matrix is currently static (fixed priors).
  A dominant clinician companion should accumulate higher V_int weight over time.
- The MPS partial trace (G2 operation) — this is Phase 4.
- Negotiation MCTS across agents (multi-agent MCTS rollouts that simulate other agents' moves).

---

## 12. Python judge vs. JS judge

| Aspect | Python (`training/judge.py`) | JS (via `tensornetsBridge.js` + Bedrock) |
|---|---|---|
| When to use | Offline batch evaluation of full sessions | Online, per-turn candidate scoring |
| Model | Llama 405B (expensive, powerful) | Llama 4 Scout / Maverick (fast) |
| Output | Full 6-dimension rubric + counterfactual | Scalar stress score + rank |
| Latency | Minutes per session | <3 seconds per turn |
| Use case | Generate DPO/RLHF training data | Real-time MCTS candidate selection |
| Bottleneck | 405B is not yet enabled on Bedrock console | Requires Python server running |

**Use Python judge for**: training data generation, A3C reward signal, weekly quality audits.  
**Use JS bridge for**: live MCTS scoring, per-turn physiological decisions.

---

## 13. Demo code vs. Tests

**`worked_example()` functions in Python modules should become pytest tests.**

Rule: any `worked_example()` / `if __name__ == '__main__'` block that asserts
correctness (not just prints) belongs in `tests/`.

Functions that only print output for human inspection can stay as `__main__` blocks
but should be clearly labelled `# development demo only`.

`met_framework.py` `worked_example()` currently only prints — it is a demo, not a test.
It should be moved to `tests/test_met_framework.py` with assertions added.
