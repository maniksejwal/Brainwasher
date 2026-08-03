# A3C Comparison Design — Physiologically-Grounded MCTS Framework
*Eight-experiment trial comparing RL approaches for clinical companion optimisation*

> **Note (2026-06-09):** The original 3-arm framing has been superseded by the actual experiment
> matrix in `tensornets/tensornets/a3c/arms.py`. All 8 experiments accumulated episodes across
> runs 023–027 (May–June 2026).

> **Honesty note (2026-08-03):** Several architectural claims in earlier versions of this document
> were overstated or inaccurate. This version corrects them. Key corrections:
>
> 1. **No MPS performed in A3C.** The Actor and Critic networks are JSON dictionaries updated by
>    log-bias EWA — not tensor networks. MPS compression is implemented in `tensornets/core/mps.py`
>    and is called by the `/physio` endpoint for physiological state history, but the A3C *policy
>    update* uses no tensor contraction.
>
> 2. **MCTS is standard flat MCTS, not a novel algorithm.** HPVOOT clusters actions into tiers for
>    sample efficiency, but the underlying search is UCB1/UCB-V. The term "HTN" (Hysteretic Tensor
>    Negotiation) was a project nickname; what was actually built is physiologically-conditioned
>    action-space MCTS used for prompt engineering (injecting `[MCTS GUIDANCE]` into the LLM prompt).
>    The MPS and MCTS components exist and function, but they are not as deeply coupled as the name
>    implies.
>
> 3. **VOOT in HPVOOT is not true VOOT.** The implementation uses UCB-V (variance-aware UCB) at the
>    cluster level, which is not the same as the Variable-Order Option Trees algorithm from the
>    options framework literature. The "VOOT" label was borrowed loosely.
>
> 4. **Exp 1–7 vs Exp 0 mismatch.** Exp 0 (Oldschool JS) runs the full production CompanionCoordinator
>    pipeline with TensorRAG, session facts, longitudinal hints, privacy guard, and care circle
>    coordination. Exp 1–7 (Python arms) use a minimal Scout prompt with only physio context string.
>    The reward function is identical across all arms, so Exp 0's advantage partly reflects richer
>    generation inputs, not purely policy quality. This is a confound, not a clean ablation.
>
> 5. **DPO arms (1p–7p) did not improve Exp 1–7 meaningfully.** Despite DPO context enrichment,
>    Python arms 1–7 showed poor goal rates (6–11%) throughout training. The primary bottleneck is
>    the generation prompt gap vs JS, not the A3C policy.
>
> 6. **Social coupling (Vint) is currently static parameters.** The `V_ij` coupling weights in
>    `SharedTensorBuffer` are initialised from fixed priors and are not updated during live sessions.
>    Propagation works (if patient A's HRV drops, companion B receives a delta), but the coupling
>    strength itself does not adapt. Dynamic co-regulation (e.g., anxious husband causing wife panic)
>    is not implemented.

---

## 0. What needs to be done before A3C starts

### Blocking (must complete first)

| Item | Why it blocks A3C | File |
|---|---|---|
| **E7** 10-turn integration test | A3C trains against the MPS environment; if MPS transitions are wrong, the policy learns noise | `core/mps.py` |
| **F3** SVD compress MCTS path → `M_trunc` | Arm 1 (HTN+MCTS) uses `M_trunc` projection; without it, Arm 1 is equivalent to Arm 2 | `mcts/base.py` + `core/mps.py` |
| **F4** Tactical agent with `M_trunc` constraint | Same reason — Arm 1 needs the constraint projection to actually differ from Arm 2 | `linguistic/bedrock.py` |
| **C5.4** `DrugRegimen` → `build_Gamma()` | Physiological state is wrong without PK/PD wiring; A3C learns on wrong physio | `physio/pkpd.py` → `core/operators.py` |
| **C6.1** `ReactivityProfile` → `gamma_from_state()` | Individual reactivity profiles are required for fair A3C comparison | `physio/reactivity.py` → `physio/hrv.py` |
| **C7.1** `HystereticBaseline` → `TriggerHysteresis.gamma_modifier()` | Arm 1 explicitly models hysteresis; without integration, Arm 3 (hysteresis-in-prompt) and Arm 1 test the same thing | `physio/hysteresis.py` → `core/operators.py` |

### Not blocking but should be done first

| Item | Reason |
|---|---|
| **B6** Scout TTFT baseline | Token budget calibration for A3C rollout cost |
| **F5** Latency test | Confirm MCTS can run in background without blocking inference |
| **G7** CompanionCoordinator → HTN subspace mapping | Without this, Arm 1 does not flow through the production system |

---

## 1. The Eight Experiments

The experiment matrix is defined in `tensornets/tensornets/a3c/arms.py`.
Capability order (ascending): **0 < 1 < 2 < 5 < 3 < 4 < 6/7**, with Exp 6/7 as
HP+VOOT+PW variants of Exp 4/5 (outcome still under evaluation).

### Exp 1 — PhysioLLM (`physio_llm`)
Physio state as natural-language text in the system prompt. No MCTS, no dead-band.
The simplest Python arm — establishes the floor for physio-augmented generation.
- PhysiologicalState 8-channel context string in every system prompt
- Actor.select() for action selection (log-bias softmax, no tree search)
- Formerly called "Arm 3 / hysteresis-prompt" in the original 3-arm design

**Answers:** "Does physio text in the prompt improve over the production JS baseline?"

### Exp 2 — PhysioLLM CoT-MCTS (`physio_llm_cot_mcts`)
Exp 1 + Maverick chain-of-thought over all 51 ACTION_TAXONOMY candidates.
LLM-as-planner; the cost baseline for Exp 3.
- Two LLM calls per turn: Maverick CoT (action selection) + Scout (generation)
- No MPS tree search; reasoning is entirely in language space
- CHOSEN_ACTION parsed from structured CoT output

**Answers:** "Can an LLM reason its way to MPS-MCTS action quality? At what cost?"

### Exp 3 — PhysioMPS-MCTS (`physio_mps_mcts`)
Full HTN + Matrix Product State MCTS via tensornets bridge. The original "Arm 1".
- POST /mcts/best-action for action + M_trunc constraint
- M_trunc dominant vector soft-steers Scout token generation (F3/F4)
- PhysioHistory append per turn (tracks longitudinal physio trajectory)
- Falls back to Actor.select() if MCTS bridge is unavailable

**Answers:** "Does structured tensor-geometry planning beat CoT planning (Exp 2)?"

### Exp 4 — Inertial PhysioMPS-MCTS (`inertial_physio_mps_mcts`)
Exp 3 + HysteresisGate 5-zone dead-band. Most capable flat-MCTS experiment.
- Zone and streak injected into MCTS physio payload and system prompt
- Strategy locked to the sustained stress tier, not the instantaneous reading
- stress_bucket overridden by zone_name — prevents flip-flopping under noise
- No fallbacks; ValueError if stress_index ∉ [0,1]

**Answers:** "Does inertial zone locking improve over raw stress-index MCTS (Exp 3)?"

### Exp 5 — Inertial PhysioLLM CoT (`inertial_physio_llm_cot_mcts`)
Exp 2 + HysteresisGate. CoT-MCTS with inertial zone awareness.
- Zone name and streak injected into Maverick CoT prompt as `{zone_ctx}`
- LLM reasons about sustained physiological state, not instantaneous stress_index
- Combines linguistic planning (Exp 2) with physiological inertia (Exp 4)

**Answers:** "Does zone-awareness improve CoT planning the same way it improves MPS-MCTS?"

### Exp 0 — Oldschool (`oldschool`) — **True Baseline**
Production Node.js CompanionCoordinator via HTTP. No physio, no MCTS.
- Posts to /api/benchmark/message; reads actual JS companion response
- Reward computed with same _synthetic_reward function as all other arms
- Actor/Critic update disabled — this arm is observed, not trained
- Includes caregiverOptimizer, consentManager, historyAnalyzer, future_plans

**Historical baseline anchor:** All data before `2026-05-23T23:59:59 IST` is the
pre-HTN window. Exp 0 must be internally consistent with `getBaselineStats()`.

**Answers:** "What is the empirical ceiling of prompt-engineering-only clinical companions?"

### Exp 6 — Inertial HPVOOT MPS (`inertial_hpvoot_physio_mps_mcts`)
Exp 4 + HP+VOOT+PW tree search (150 iter, 20 depth).
- Hierarchical Partitioning: 6 semantic action clusters; VOOT bandit at cluster level
- Progressive Widening: actions admitted one-at-a-time in LLM-prior rank order
- Scout prior scores all HP actions before tree search (seeding PW expansion order)
- Zone-to-cluster affinity boosts (e.g. zone 4 → de_escalate +0.40)

**Answers:** "Does structured cluster-level planning improve over flat MCTS (Exp 4)?"

### Exp 7 — Inertial HPVOOT CoT (`inertial_hpvoot_physio_llm_cot_mcts`)
Exp 5 + HP+VOOT+PW. Maverick CoT ratings recycled as PW prior at zero extra LLM cost.
- RATINGS section extracted from CoT output; mapped to HP action prior scores
- Same MCTS call as Exp 6 (mcts_mode=hpvoot, 150 iter, depth 20)
- CoT action and MCTS action both logged (cot_action vs mcts_action)

**Answers:** "Can CoT reasoning provide a free lunch as the HPVOOT prior?"

---

## 1a. Current Benchmark Results (last 100 episodes per arm, 2026-06-09)

| Exp | ARM | N (total) | Mean ± SD | Goal % | Stress AUC |
|---|---|---|---|---|---|
| 0 | oldschool | 1832 | 7.89 ± 4.29 | 9.0% | 0.722 |
| 1 | physio_llm | 2961 | 9.16 ± 4.87 | 8.0% | 0.741 |
| 2 | physio_llm_cot_mcts | 1645 | 8.43 ± 4.62 | 11.0% | 0.769 |
| 3 | physio_mps_mcts | 2861 | 8.23 ± 4.49 | **19.0%** | 0.711 |
| 4 | inertial_physio_mps_mcts | 826 | 8.40 ± 4.35 | 15.0% | 0.711 |
| 5 | inertial_physio_llm_cot | 771 | 9.10 ± 5.10 | 11.0% | **0.782** |
| 6 | inertial_hpvoot_mps | 822 | 8.21 ± 4.44 | 9.0% | 0.770 |
| 7 | inertial_hpvoot_cot | 655 | 8.04 ± 4.15 | 12.0% | 0.780 |

**Notable observations:**
- Exp 3 has highest goal rate (19%) but lower stress AUC than Exp 5 — MPS is goal-efficient
  but may be stress-aggressive; inertia (Exp 4) softens this at a goal cost (-4pp)
- Exp 6 goal rate (9%) is worse than Exp 4 (15%) — HPVOOT is **not yet converging** (see §10)
- All arms show downward goal rate trend — see §10 for diagnosis

---

## 2. Environment

Environment: POMDP-H (see `docs/tensornets/RL_ENVIRONMENT.md`)

**State space**: PhysiologicalState (8 channels) + ConversationHistory (last K turns) + HystereticBaseline + CompanionHysteresis
**Action space**: DialogMCTS action taxonomy (action_selector.js)
**Reward**: Multi-dimensional (stress, trust_delta, goal_progress, info_coverage, consistency)
  - Aggregated via weighted sum for A3C value function
  - All 6 dimensions stored separately for HTN judge analysis

**Known flaw (documented in RL_ENVIRONMENT.md Section 5.3):**
The OU simulator parameters are priors, not WESAD-fitted. This means all three
A3C arms train against the same approximate model — the comparison is still
valid (same simulator = same noise), but absolute performance claims require
real-wearable validation. This is fine for a PhD comparison.

---

## 3. A3C Algorithm

A3C (Asynchronous Advantage Actor-Critic, Mnih et al. 2016):
- **Actor**: selects action from action taxonomy given state
  - Scout (fast, low-cost) for rollout action selection
  - Prompt = action_selector.js prompt + PhysioState context string
- **Critic**: estimates V(s) — expected cumulative reward from state s
  - Maverick for value estimation (higher quality, run once per turn, not per rollout)
- **Advantage**: A(s,a) = r + γV(s') - V(s)
  - This is the "discrepancy leverage" — high advantage = DiscrepancyAudit flag zone
- **Async workers**: N parallel simulated conversations with synthetic personas
  - Each worker runs one of the 3 arms
  - Workers share the same global actor/critic parameters

**Model routing** (per your instruction):
- Rollout / action selection: **Scout** (fast, cheap, bulk volume)
- Value estimation / feedback scoring / prompt iteration: **Maverick** (quality)
- HTN judge offline batch: **Llama 3.1 405B** (if available) or Maverick (fallback)
- Nothing bigger than Maverick in the loop

---

## 4. Leveraging Multi-Arm Bandits and Thompson Sampling

The existing project likely has multi-arm bandit logic (check `companions/agents/` or `training/`).
Before implementing A3C from scratch, the following sequence is safer:

### Step 1 — Contextual Bandit (pre-A3C)
Treat each action in the action_selector.js taxonomy as an arm.
Reward = HTN judge score at the next turn (delayed one step).
Use Thompson Sampling on Beta posteriors per arm per physio-stress bucket.

This is fast to implement, interpretable, and provides prior experience that
warms up the A3C policy initialisation. It answers: "which actions are best at
each stress level?" without requiring full RL.

### Step 2 — A3C on top of bandit policy
Initialise the A3C actor from the Thompson Sampling policy:
- Convert bandit probabilities P(arm | stress_bucket) → softmax actor initialisation
- This avoids the cold-start problem where A3C wastes exploration on obviously bad actions

### Step 3 — Multi-arm A3C with shared simulator
All Python arms (Exp 1–7) run in the same Python environment.
Exp 0 (oldschool) runs the JS system via HTTP — each A3C step calls the production
CompanionCoordinator via the same CLI/API, then scores the response with the HTN judge.

---

## 5. Comparison Metrics

For every episode across all three arms, collect and store:

### Primary metrics (per episode)
| Metric | Source | Description |
|---|---|---|
| cumulative_reward | MCTS reward weights | Weighted sum of 6 dimensions |
| stress_auc | PhysioState trajectory | Area under HRV curve (higher = better) |
| goal_achieved | SessionManager | Binary: did the session achieve its goal? |
| turns_to_goal | SessionManager | Efficiency: fewer turns = better |
| trust_delta_final | CompanionHysteresis | Alliance at session end |

### Secondary metrics (per turn, for HTN judge analysis)
| Metric | Source |
|---|---|
| clinical_accuracy | HTN judge dimension 1 |
| empathy_score | HTN judge dimension 2 |
| safety_compliance | HTN judge dimension 3 |
| goal_progress | HTN judge dimension 4 |
| strategy_coherence | HTN judge dimension 5 |
| linguistic_stress | stress_model.py |
| discrepancy_flag | DiscrepancyAudit (JS scorer vs HTN judge divergence) |

### Learning metrics (per training iteration)
| Metric | Description |
|---|---|
| actor_loss | Policy gradient loss (lower = more stable) |
| critic_loss | Value estimation loss |
| advantage_mean | Mean A(s,a) — should be near 0 if critic is calibrated |
| advantage_std | Spread — high variance = high uncertainty = more exploration needed |
| entropy | Action distribution entropy — should decrease as policy converges |
| token_count | Total tokens consumed per episode (cost efficiency) |
| latency_ms | Wall time per turn |

### Qualitative comparison (same dialog graphs across all 8 arms)
- Run the same 10 canonical scenarios (billing denial, deaddiction strike, flooding,
  phd_supervisor_rigour, etc.) through all arms
- Record full dialogue for HTN judge batch scoring
- Produce side-by-side transcript comparison (same user input, different arm responses)

---

## 6. Logging and Storage

Every run stores:

```
tensornets/
  training/
    runs/
      {arm}_{timestamp}/
        config.json           # hyperparams, model IDs, random seed
        episodes/
          episode_{n}.jsonl   # per-turn: state, action, reward, physio, judge scores
        checkpoints/
          actor_{step}.pt     # A3C actor weights
          critic_{step}.pt
        metrics/
          learning_curves.json  # reward, loss per step
          final_comparison.md   # cross-arm summary table
        logs/
          {worker_id}.log       # async worker logs
```

`episodes/*.jsonl` format per line:
```json
{
  "turn": 3, "arm": "htn_mcts",
  "state": {"hrv_ms": 28.3, "stress_label": "moderate_stress", ...},
  "action": "REFLECT_FEELING",
  "response": "It sounds like that situation was really frustrating...",
  "reward": {"stress": 0.6, "trust": 0.3, "goal": 0.4, ...},
  "judge": {"clinical_accuracy": 0.8, "empathy": 0.9, ...},
  "discrepancy": null,
  "tokens": {"scout": 245, "maverick": 180},
  "latency_ms": 187
}
```

All logs are retained permanently — they are PhD research data.

---

## 7. Checking the Old Learning Method

The existing project has:
- `training/simulation/` — synthetic user personas and scenarios
- `futurePlanningAgent.js` — LLM-generated future task scheduling
- `historyAnalyzer.js` — conversation history analysis for context
- `patientOptimizer.js` — response quality optimisation

**Is the old method still valid?**

Yes, as Exp 0 (oldschool). The old learning method is:
1. Generate response via LLM with prompt engineering
2. Get user feedback (implicit via HRV, explicit via rating)
3. Update future_plans table with lessons learned
4. Use history_analyzer to detect repetition / topic drift
5. patientOptimizer adjusts next response

This is a **rule-based + reactive** approach, not gradient-based RL. It is correct
for a baseline, because it represents the state of the art for prompt-engineering-only
clinical companions.

**What it cannot do (testable via A3C comparison):**
- It cannot optimise for long-horizon outcomes (weeks of interactions)
- It cannot trade short-term comfort for long-term behaviour change
- It cannot coordinate strategy across multiple companions in a circle
- It cannot exploit physiological predictors to pre-empt stress responses

These are the specific claims A3C Exp 6/7 (HPVOOT) will test.
Now operationalised as Exp 3 (physio_mps_mcts) vs Exp 0 (oldschool).

---

## 10. HPVOOT Regression Diagnosis (2026-06-09)

### Observed problem
Exp 6 (inertial_hpvoot_mps) goal rate is 9%, down from Exp 3 (inertial_physio_mps_mcts) at 15%.
Goal rates are drifting down across all arms. Critical failure rate appears to be rising.

### Root cause analysis

**1. Scout prior quality for HPVOOT**
`_fetch_prior_scores()` asks Scout to rate all HP actions 0.0–1.0 in a single call.
With 30+ actions in one prompt and no conversation context beyond stress and zone,
Scout tends to return near-uniform scores (~0.5 ± 0.1), effectively randomising
PW expansion order. The zone-to-cluster affinity then cannot override the bad prior
because VOOT variance bonuses dominate early exploration.
**Fix:** Pass the last 2 patient turns + session goal into the prior prompt so Scout
has the context to discriminate between actions meaningfully.

**2. HP cluster count mismatch**
The ACTION_TAXONOMY in `action_bandit.py` has 51 actions. `ACTION_CLUSTERS` covers
approximately 45 of them across 6 clusters. Actions not in any cluster are never
admitted by PW. If the optimal action for a given state is in an uncovered action,
HPVOOT can never select it, but Exp 2/3 (flat MCTS) can.
**Fix:** Audit ACTION_CLUSTERS coverage against full ACTION_TAXONOMY. Add missing
actions to appropriate clusters.

**3. VOOT variance bonus too aggressive**
`VOOT_C_VAR = 0.8` means the variance bonus dominates Q_mean when a cluster has
few visits. With 150 iterations over 6 clusters, each cluster gets ~25 visits.
At n=25, variance bonus ≈ 0.8 × √(σ²/25). If σ² ≈ 0.1 (typical), that's +0.16
added to every cluster's score — comparable to the Q_mean difference between a good
and bad cluster. This drives over-exploration at the cluster level.
**Fix:** Reduce `VOOT_C_VAR` from 0.8 to 0.4 for episodes >50 per arm (after initial
exploration). Or anneal it per episode count.

**4. Warm-start decay too aggressive after 800 episodes**
`WARM_START_DECAY = 0.75` was designed for early training. After 800+ episodes per
HPVOOT arm, the cluster Q statistics have converged to useful priors, but each episode
decays them 25% and re-expands with 3 minimum synthetic visits. This causes the
warm-start to degrade rather than accelerate convergence at this scale.
**Fix:** Reduce `WARM_START_DECAY` from 0.75 to 0.90 once total arm episodes > 500.

**5. Goal rate metric divergence**
The overall downward goal rate trend across all arms (not just HPVOOT) suggests the
scenario corpus may have shifted toward harder scenarios as the curriculum scheduler
promotes recovery/dormant scenarios into the active pool. The goal rate denominator
is getting harder — not necessarily the arms getting worse.
**Fix:** Stratify goal rate by curriculum pool (success / recovery / dormant)
in the benchmark dashboard to separate scenario difficulty from arm quality.

### Immediate actions
- [ ] **L1** Audit `ACTION_CLUSTERS` vs `ACTION_TAXONOMY` coverage gap
- [ ] **L2** Add session context (last 2 turns + goal) to `_fetch_prior_scores` prompt
- [ ] **L3** Reduce `VOOT_C_VAR` to 0.4; anneal toward 0.2 after 500 arm episodes
- [ ] **L4** Adaptive `WARM_START_DECAY`: 0.75 → 0.90 after 500 episodes
- [ ] **L5** Stratified goal rate in dashboard (pool-level breakdown)

---

## 8. Token Efficiency

| Task | Model | Justification |
|---|---|---|
| Rollout action selection | Scout | 60k context, fast, cheap. One call per turn per worker. |
| Value estimation (critic) | Maverick | One call per turn, not per rollout step. |
| HTN judge (real-time) | Maverick | Per-turn scoring during simulation. |
| HTN judge (batch) | 405B or Maverick | Offline, once per episode. |
| Prompt iteration / DPO | Maverick | Policy improvement loop, not in real time. |
| Exp 0 (oldschool / production JS) | Scout via bedrock.js | Same as production — no change. |

**Expected token budget per 10-turn episode:**
- Exp 1 (PhysioLLM): ~2,700 tokens Scout (larger context string)
- Exp 2 (PhysioLLM CoT-MCTS): ~2,700 tokens Scout + ~1,800 tokens Maverick
- Exp 3 (PhysioMPS-MCTS / HTN+MCTS): ~2,500 tokens Scout + ~1,800 tokens Maverick
- Exp 0 (oldschool): ~2,200 tokens Scout
- HTN judge (batch, per episode): ~4,000 tokens Maverick
- Total per 8-arm comparison run (100 episodes each): ~3.3M tokens

At Bedrock pricing (Scout ~$0.17/1M, Maverick ~$0.40/1M):
  Estimated cost per full comparison run: ~$0.60–0.90 USD (very manageable).

---

## 9. Implementation Order

```
Week 1 — Unblock (prerequisites)
  [x] E7: 10-turn MPS integration test
  [ ] C5.4: DrugRegimen -> build_Gamma()
  [ ] C6.1: ReactivityProfile -> gamma_from_state()
  [ ] C7.1: HystereticBaseline -> Gamma modifier

Week 2 — Thompson Sampling bandit (pre-A3C warm-up)
  [ ] I1: ActionBandit class (Beta posterior per arm per stress bucket)
  [ ] I2: Thompson Sampling action selection
  [ ] I3: Bandit training loop (100 episodes, Scout inference)
  [ ] I4: Bandit results → actor initialisation weights

Week 3 — A3C skeleton
  [ ] J1: A3CWorker base class (episode runner, reward accumulator)
  [ ] J2: Actor network (Scout prompt template = policy head)
  [ ] J3: Critic network (Maverick value estimate)
  [ ] J4: Advantage computation + gradient update
  [ ] J5: Exp 3 worker (PhysioMPS-MCTS / HTN+MCTS)
  [ ] J6: Exp 0 worker (oldschool / production JS via HTTP)
  [ ] J7: Exp 1 worker (PhysioLLM / hysteresis-in-prompt)

Week 4 — Full comparison run + analysis
  [ ] K1: 3-arm parallel run (100 episodes each)
  [ ] K2: Learning curve plots
  [ ] K3: Per-scenario transcript comparison
  [ ] K4: Statistical analysis (Wilcoxon + effect size)
  [ ] K5: EXPERIMENTS.md entry
```
