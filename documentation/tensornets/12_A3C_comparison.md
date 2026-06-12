# A3C Comparison Design — HTN Framework
*Three-arm trial comparing RL approaches for clinical companion optimisation*

> **Migration record**
> - Original file: `docs/tensornets/A3C_COMPARISON_DESIGN.md`
> - Migrated: 2026-06-04
> - Changes from original: Added statistical power analysis; documented ACTION_TAXONOMY (51 actions) and STRESS_BUCKETS from action_bandit.py; added file paths for B6/F5/G7 items; moved live implementation checklist to 16_experiments.md; added checkpoint serialisation format; added H₀ rejection criteria for each metric.
> - Original file preserved at `docs/tensornets/A3C_COMPARISON_DESIGN.md`.

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

| Item | Reason | File |
|---|---|---|
| **B6** Scout TTFT baseline | Token budget calibration for A3C rollout cost | `tensornets/benchmarks/ttft_baseline.py` |
| **F5** Latency test | Confirm MCTS can run in background without blocking inference | `tensornets/benchmarks/mcts_latency_test.py` |
| **G7** CompanionCoordinator → HTN subspace mapping | Without this, Arm 1 does not flow through the production system | `companions/coordinator.js` → `tensornets/bridge/htn_subspace.py` |


---

## 1. The Three Original Arms (now expanded to 8 experiments)

> **Note:** The original design described three arms (1/2/3 → HTN+MCTS / Oldschool / Physio-prompt).
> These are now Exp 3, Exp 0, and Exp 1 respectively in the 8-experiment design.
> See `A3C_COMPARISON_DESIGN.md` for the full current experiment matrix.

### Exp 3 — PhysioMPS-MCTS / HTN + MCTS (full system)
The complete HTN framework:
- MPS evolves with `apply_transition(H)` at each turn
- DialogMCTS selects best action from `M_trunc`-constrained candidates
- `M_trunc` is computed by SVD-compressing the MCTS rollout path (F3/F4)
- Physiological state includes full Gamma (PK/PD + reactivity + hysteresis)
- V_int shared tensor buffer active (multi-agent awareness)
- All 6-dim HTN judge scores collected per turn

### Exp 0 — Oldschool / Old-school (no HTN, no MCTS)
The production system as it exists today in the JS project, with no tensornets bridge:
- CompanionCoordinator generates response with existing prompts
- No physiological state beyond the empathyHandler's stress label
- No MCTS planning layer — futurePlanningAgent handles strategy
- No MPS constraint on LLM output probabilities
- HTN judge still runs offline to score each turn (same rubric, for fair comparison)

**This is the true baseline.** Not a hardcoded strawman. The production system
as shipped — multi-agent, LLM-generated, with all existing prompt engineering.

**Historical baseline anchor:** All simulation and feedback data generated before
`2026-05-23T23:59:59 IST` is the pre-HTN baseline window. This cutoff is stored in
`htn_benchmark_metadata.baseline_cutoff_ts`. Exp 0 reward distributions must be
compared against `getBaselineStats()` (mean score, episode count) from that window
to verify Exp 0 is internally consistent with the historical pipeline.
The old pipeline produced quality data — the A3C arms compete against this empirical
baseline, not a synthetic one. See `db/queries_benchmarks.js::getBaselineStats()`.

### Exp 1 — PhysioLLM / Physio-in-prompt (no MCTS, no MPS)
The same production system but with physio context injected into every prompt:
- HystereticBaseline state and TriggerHysteresis extinction progress included in system prompt
- Stress label and physio context string included (same as current empathyHandler)
- No MCTS, no M_trunc, no V_int propagation
- No MPS — hysteresis is text, not tensor geometry
- Tests the hypothesis: "can you get most of the benefit just by telling the LLM the physio state?"

**This arm answers the key PhD question:** is MPS+MCTS adding value beyond what
a well-prompted LLM already knows from a physio context string?

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

### Step 3 — Three-way A3C with shared simulator
All Python arms (Exp 1–7) run in the same Python environment.
Exp 0 (oldschool) runs the JS system via HTTP — each A3C step calls the production
CompanionCoordinator via the same CLI/API, then scores the response with the HTN judge.

### ACTION_TAXONOMY (action_bandit.py)

The bandit operates over 51 actions in 8 categories:

| Category | Actions | Stress bucket constraint |
|---|---|---|
| Validate | validate, empathic_reflection, acknowledge_only | Always permitted |
| Redirect | topic_shift, redirect_grief, normalize | Always permitted |
| Challenge | challenge_distortion, introduce_discrepancy | Blocked when σ ≥ 0.65 |
| Provide information | psychoeducation, give_advice, summarize | Blocked when σ ≥ 0.65 |
| Safety | safety_protocol, escalate, flooding_hold | Always permitted (required at σ ≥ 0.85) |
| Deaddiction | craving_surfing, urge_surfing, SPIKE_step | Mode-gated |
| Flooding | flooding_deepen, flooding_hold | Mode-gated (flooding mode only) |
| Administrative | booking_confirm, relay_message, circle_relay | Always permitted |

STRESS_BUCKETS: low (σ < 0.35), moderate (0.35 ≤ σ < 0.65), high (σ ≥ 0.65).
Critical gate (σ ≥ 0.85): only validate, empathic_reflection, safety_protocol, acknowledge_only, escalate, flooding_hold, flooding_deepen, spike_step permitted.

---

## Statistical Power Analysis

The three-experiment comparison is designed to detect a minimum clinically meaningful difference. Using run_013 pilot data as a calibration:

**Primary outcome: goal_achieved% (binary)**

| Parameter | Value | Source |
|---|---|---|
| Observed effect (run_013) | p₁=0.808 vs p₂=0.692 (Δ=11.6 pp) | 06_results.md §2 |
| Target minimum detectable effect | OR ≥ 1.5, Δ ≥ 8 pp | Conservative anchor |
| α (two-tailed) | 0.05 | Pre-registered |
| β (target power) | 0.20 (80% power) | Convention |
| Required n per experiment | **≈ 200** | Two-proportion z-test |

Calculation: n = (z_α/2 + z_β)² · [p̄(1−p̄)·2] / (p₁−p₂)² where p̄ = (p₁+p₂)/2.
At Δ=8pp (p₁=0.76, p₂=0.68), n ≈ 200 per experiment.

**Secondary outcome: stress_auc (continuous)**

| Parameter | Value |
|---|---|
| Expected Cohen's d | 0.3 (small-to-moderate, based on run_013 reward gap) |
| Required n per experiment | ≈ 180 (two-sample t-test) |

**Conclusion**: run_014 will target **n=200 episodes per experiment** (600 total) to achieve 80% power on the primary outcome.

**H₀ rejection criteria per metric:**

| Metric | H₀ | Test | Rejection threshold |
|---|---|---|---|
| goal_achieved% | p₁ = p₂ | Two-proportion z-test | p < 0.05, OR ≥ 1.5 |
| stress_auc | μ₁ = μ₂ | Welch's t-test | p < 0.05, Cohen's d ≥ 0.3 |
| turns_to_goal | μ₁ = μ₂ | Wilcoxon rank-sum | p < 0.05 |
| trust_delta_final | μ₁ = μ₂ | Welch's t-test | p < 0.05 |
| discrepancy_flag rate | π₁ = π₂ | Two-proportion z-test | p < 0.05 |

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
  phd_supervisor_rigour, etc.) through all three arms
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

## Checkpoint Format

Checkpoints are written every N episodes to `tensornets/runs/run_NNN/{arm_name}/checkpoints/`:

**actor_{step}.json:**
```json
{
  "step": 60,
  "arm": "arm_physio_llm_cot_mcts",
  "log_bias": {
    "low": { "validate": 0.02, "challenge_distortion": -0.15, "...": "..." },
    "moderate": { "...": "..." },
    "high": { "...": "..." },
    "flooding_low": { "...": "..." }
  },
  "meta": { "episodes_completed": 60, "mean_reward": 0.583 }
}
```

**critic_{step}.json:**
```json
{
  "step": 60,
  "weights": [0.12, -0.05, 0.31, "..."],
  "feature_names": ["stress_index", "hrv_norm", "eda_norm", "sleep_norm", "goal_coverage", "turn_norm"],
  "meta": { "td0_mse": 0.024 }
}
```

**run_state.json:** episode count, scenario cursor, random seed, git hash.

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

These are the specific claims Exp 3/4/6/7 (HTN+MCTS variants) will test.

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
- Exp 3 (PhysioMPS-MCTS / HTN+MCTS): ~2,500 tokens Scout + ~1,800 tokens Maverick
- Exp 0 (oldschool): ~2,200 tokens Scout
- Exp 1 (PhysioLLM / hysteresis-prompt): ~2,700 tokens Scout (larger context string)
- Exp 2 (PhysioLLM CoT-MCTS): ~2,700 tokens Scout + ~1,800 tokens Maverick
- HTN judge (batch, per episode): ~4,000 tokens Maverick
- Total per 3-arm comparison run (100 episodes each): ~3.3M tokens

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
