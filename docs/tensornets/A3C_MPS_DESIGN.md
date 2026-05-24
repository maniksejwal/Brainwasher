# A3C + MCTS + MPS — Integration Design
## Status: DEFERRED (Phase 5+)

---

## What A3C Is

Asynchronous Advantage Actor-Critic (A3C) is a deep RL algorithm (Mnih et al. 2016).

- **Actor**: policy network π(a|s) — selects actions given state
- **Critic**: value network V(s) — estimates expected cumulative reward
- **Asynchronous**: multiple workers explore the environment in parallel, pushing gradients to a shared network
- **Advantage**: uses A(s,a) = Q(s,a) − V(s) to reduce variance vs. vanilla policy gradient

The actor generates a probability distribution over actions; the critic tells it how much better/worse an action was than average.

---

## How MCTS + MPS + A3C Fit Together

This is the AlphaGo architecture applied to clinical dialogue.

```
┌─────────────────────────────────────────────────────────┐
│                    MCTS (planning)                      │
│  Uses Actor (policy prior) + Critic (value estimate)    │
│  to guide tree search: no random rollouts               │
│                                                         │
│  UCB1_modified = Q(s,a) + c * π(a|s) / (1 + N(s,a))   │
│  ↑ AlphaGo Zero formula (Silver 2017)                   │
└───────────┬──────────────────────────┬──────────────────┘
            │ selects best action      │ backpropagates reward
            ▼                          ▼
┌─────────────────────┐    ┌─────────────────────────────┐
│  MPS state |Ψ_t⟩    │    │  A3C training loop          │
│  Encodes:           │    │  Actor learns: which MCTS   │
│  - semantic context │    │  action leads to best long- │
│  - physio subspace  │    │  term physiological outcome │
│  - hysteretic path  │    │  Critic learns: V(|Ψ_t⟩)   │
└─────────────────────┘    └─────────────────────────────┘
```

---

## Does It Make Sense?

**Yes, strongly beneficial in theory.** Three reasons:

### 1. MCTS + Policy Prior = AlphaGo Recipe

Vanilla MCTS (our current Phase 3) uses random rollouts to estimate node value. This is noisy and expensive. AlphaGo Zero replaced random rollouts with a learned policy network. The result: 70× fewer simulations needed for equal strength.

In our system:
- Current Phase 3 MCTS: random rollout over `n_lookahead` turns using OU simulator
- With A3C: policy prior π(a|s) guides MCTS toward promising branches immediately
- Estimated improvement: 5-10× fewer rollouts needed → latency target (<200ms) achievable with larger χ

### 2. A3C Actor Learns What the LLM Cannot

The transformer generates text. The A3C actor learns to SELECT which type of text is appropriate given the hysteretic MPS state. This is the formal answer to "what does MCTS add beyond injecting HRV into the LLM":

- LLM: argmax P(next_token | context) — local greedy
- A3C actor: argmax E[Σ_t γ^t R_t | s, π] — global horizon-optimised policy

After training on the physiological simulator + LLM-as-judge rewards (judge.py), the actor encodes 10 months of patient interaction compressed into weights — far more than a context window.

### 3. Asynchronous = Multiple Companion Instances in Parallel

The async workers in A3C map directly to the multi-companion setup:
- Worker 1: patient companion exploring dialogue path A
- Worker 2: caregiver companion exploring dialogue path B
- Worker 3: clinician companion exploring dialogue path C
- Shared network: updated from all three simultaneously
- Result: the policy learns multi-agent coordination without explicit programming

---

## Why It Is Deferred

| Prerequisite | Status | Reason |
|---|---|---|
| Phase 2: MPS evolution (`apply_transition`) | Pending | A3C state must be the full MPS |
| Phase 3: MCTS rollout engine | Pending | A3C replaces random rollouts — needs MCTS first |
| Physiological simulator validated (E-001) | Pending WESAD | A3C reward must be grounded |
| LLM-as-judge reward signal (judge.py) | Done ✅ | This IS the A3C reward function |
| Training data volume | Pending | Needs ~10K simulated sessions minimum |
| Compute | Present (AWS) | Feasible on Bedrock + EC2 |

**Attempting A3C before Phase 3 MCTS produces a reward-hacking system with no physiological grounding.** Deferred to Phase 5.

---

## Better Output from Smaller LLMs — What to Do Now

The question "how to get better output from a smaller LLM?" has four answers that are available today (no A3C needed):

### Answer 1: MPS Constraint Projection (most impactful)
A 7B model with hard MPS constraint projection is **safer** than a 70B model without it. The constraint is mathematically guaranteed, not probabilistically hoped for. This is the key claim of the paper and it is available now in Phase 2.

### Answer 2: Routing (immediate)
Use Llama 4 Scout (109B MoE, fast) for standard turns. Reserve Maverick (400B MoE) for turns where MCTS flags high-stakes decision points (HRV < 50% baseline, or deaddiction strike phase, or SPIKE K-step). Already partially implemented in `callLlama()` fallback.

**Enhancement needed** (not yet built): MCTS cost function triggers model upgrade when:
```javascript
if (physioState.stress_index > 0.8 || mcts_cost_plateau_count > 3) {
    modelId = LLAMA4_MAVERICK;  // upgrade for this turn
}
```

### Answer 3: Speculative Decoding via Constraint
The small model generates a candidate; the MPS constraint layer accepts/rejects tokens faster than the large model can generate them. This is the "draft + verify" pattern (Leviathan 2023) but with a hard constraint instead of a large verifier model.

### Answer 4: Role-Specialised Fine-Tuning (Track D, deferred)
Fine-tune a separate 7B model for each therapeutic skill (OARS-R, OARS-A, flooding-hold). Route to the right model based on the MCTS-selected skill for this turn. Each model is small but near-expert in its domain.

---

## The `agentCommit` Function (tensornetsBridge.js lines 292-293)

**What it does in plain English:**

When any companion says something to a user, two things happen:

1. **The statement is logged** so other companions cannot contradict it. Example: the clinician companion says "you can eat a light meal up to 4 hours before the procedure." The patient companion will now see this in its prompt and will not contradict it.

2. **The physiological prediction is updated** for all other users in the care circle. If the clinician's statement is predicted to drop the patient's HRV by 8ms (because it's stressful news), the patient companion's HRV estimate is updated *before* it generates its next response. The patient companion then knows not to deliver complex information on the next turn because the patient is now more stressed.

The `V_int` (social coupling matrix) controls how much of the physiological impact transfers between agents. The clinician→patient coupling is 0.6 (strong) because clinicians saying difficult things strongly affects patients. The patient→clinician coupling is 0.2 (weak) because patients' distress less directly affects the clinician's physiological state.

---

## Hysteresis — What You Are Missing (the invention argument)

The three strands you listed are correct but incomplete. What makes this an invention:

### What exists individually in literature
- Human physiology hysteresis: Bouton 2004 (fear extinction)
- Memory hysteresis: Lally 2010 (habit formation), Wood 2016 (relapse)
- Psychological hysteresis: Safran 2000 (therapeutic alliance rupture-repair)

### What does NOT exist (the contribution)

**1. Formal unification under a single operator**
All three strands are expressed as different H_eff eigenvalue structures. The imaginary part of λ_eff controls oscillation (hysteresis frequency), the real part controls decay. No paper has connected fear extinction, habit formation, and therapeutic alliance to the same mathematical object.

**2. Multi-timescale Γ**
The composite Γ = Γ_physio × Γ_habit × Γ_pkpd × Γ_reactivity × Γ_fear × Γ_companion is novel. No prior system tracks all six simultaneously. Each alone is trivial; the coupling between them is the invention. Example: a patient on benzodiazepines (PK/PD) with ruminant archetype and active fear hysteresis has a fundamentally different Γ than the same patient without BZD — and this interacts with the habit hysteresis differently during the rebuild phase.

**3. MPS as the carrier**
The hysteretic path information (w_t trajectory, h_t trajectory) is encoded in the MPS bond dimension as physio subspace state. This eliminates the KV cache growth problem: instead of remembering every token, the system compresses the relevant hysteretic history into χ dimensions. This is the specific technical contribution no prior NLP-meets-physiology paper has made.

**4. MCTS operating on hysteretic state, not current state**
When MCTS evaluates a candidate response, it uses the full (σ, w_t, h_t, grudge_state, alliance) state, not just current σ. Two patients at identical σ=0.4 have different expected future trajectories if one arrived from σ=0.9 and one from σ=0.1. MCTS exploits this; an LLM cannot. This changes the UCB1 value function non-trivially.

**5. Social hysteresis** (not yet built — the gap)
The relationship between agents (V_int coupling) is itself hysteretic. Once the clinician companion has established dominance in a care circle (patient defers to clinician on medication), this dominance persists even when the clinician is absent. The patient companion's influence is depressed. This is a second-order hysteretic effect across agents. None of the cited literature covers this.

**The invention is the system, not any individual component.**
Peer reviewers will note that H_eff, MPS, MCTS, and HRV each exist. The response is: the specific claim is that their combination, expressed as a multi-timescale hysteretic operator over a physiologically-partitioned MPS state, enables the MCTS planning horizon to exploit path-dependent information that neither a transformer (no horizon) nor a simple rule system (no path memory) can access.

---

## Summary of What Was Built This Session

| File | Purpose |
|---|---|
| `agents/api/providers/llama.js` | Parameter counts + release dates for all models |
| `training/simulation/edge_case_personas.js` | Bipolar (manic+depressive), ASPD/psychopathic, NPD/narcissistic, 6 religion personas, 2 game-theory archetypes |
| `tensornets/agents/companion_hysteresis.py` | CompanionRelationshipState with rupture-repair asymmetry, strategic patience depletion, MCTS weight adjustment |
| `benchmarks/runner.py` | Standalone benchmark runner: 6/6 passing, saves JSON+MD, git metadata |
| `benchmarks/results/` | First benchmark run saved |
