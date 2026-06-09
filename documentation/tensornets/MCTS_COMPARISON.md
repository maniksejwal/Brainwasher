# MCTS in Brainwasher 3 vs HTN Framework

## What the main project already does (no MCTS)

The existing system is a **reactive pipeline**:

```
User message
    → CompanionCoordinator (empathy, clinical, RCM agents)
    → Bedrock / Ollama LLM call
    → Response emitted
```

There is no lookahead. Every agent responds to the current turn only. The
`SimulationDriver` runs full conversations but produces a single trajectory — it
doesn't explore alternatives or rank candidate paths. The scoring (`llm_scorer.js`,
`simulation_scorer.js`) happens *after the fact*, not as a planning signal.

---

## What HTN-MCTS adds

The HTN framework adds a **dual-timescale lookahead layer** on top of the same
LLM calls:

```
User message
    → Strategic agent (high-rank MCTS over MPS states)
         Explores N candidate response sequences
         Evaluates each by: C = Σ ⟨Ψ_t|Γ|Ψ_t⟩  (accumulated stress)
         Chooses the path with minimum cumulative stress
         Extracts constraint matrix M_trunc via SVD of optimal path
    → Tactical agent (Bedrock LLM) guided by M_trunc
         P_safe(w) = normalize( M_trunc · P_llm(w) )
    → Response emitted — geometrically guaranteed to stay on the safe path
```

The **MPS state |Ψ_t⟩** is the shared memory. Unlike the existing system where
each agent only sees the last N messages, the MPS compresses the full history into
the bond dimension — O(Ndχ²) memory vs O(Nd) for a KV cache.

---

## Comparison table

| Dimension | Main project (current) | HTN-MCTS (new) |
|---|---|---|
| **Lookahead** | None — reactive | MCTS over MPS states (depth k, width w) |
| **Memory** | Last N messages (sliding window) | MPS bond dimension — O(Ndχ²) compressed history |
| **Safety** | Prompt-based ("never say X") | Geometric — forbidden tokens have amplitude 0 in M_trunc |
| **Physio-awareness** | None | Γ matrix driven by HRV, EDA, sleep, respiration |
| **Agent coordination** | Events + shared DB | Partial trace on |Ψ⟩ — agents read subspaces, not full state |
| **Benchmarkable claim** | "The agent responds empathetically" | "Safety violation rate = 0.0% at χ=64 under adversarial prompts" |

---

## How to show the comparison visually

The dialog graph infrastructure built in this session makes this concrete.
The comparison works as follows:

### Step 1: Create a ground-truth graph
Define a dialog graph for a known clinical scenario (e.g. "billing denial dispute
with a stressed patient"). The expert path is the optimal sequence of nodes.

### Step 2: Run two simulations against the same scenario

```bash
# Baseline: existing system, no MCTS, no physio-awareness
node tests/simulation/run_simulation_llama.js  # config.USE_LLAMA_FOR_ALL = true, mcts_used = false

# HTN: same scenario, MCTS active, constraint projection on
# (once Phase 3 is implemented)
node tensornets/demo.py --scenario billing_denial --mcts
```

Both runs are imported into the dialog graph via:
```
POST /api/cli/export-dialog-graphs
Body: { graphId: "billing_denial_v1", limit: 1 }
```

### Step 3: Visualise the comparison

```javascript
import { mountDialogGraphViewer } from './gui/ui/dialogGraphViewer.js';
const viewer = mountDialogGraphViewer('dg-container', 'billing_denial_v1');
// Then:
viewer.loadCompare('baseline_run_id', 'mcts_run_id');
```

The GUI renders three overlaid paths on the same graph:
- **Indigo** — expert (gold standard)
- **Orange** — baseline (no MCTS)
- **Teal** — HTN-MCTS

Divergences from the expert path are flagged (`diverged_from_expert = 1` in the DB).

### Step 4: Quantify the comparison (Section 5 of paper)

| Metric | Baseline | HTN-MCTS |
|---|---|---|
| Expert path adherence (% turns on expert path) | ? | ? |
| Safety violation rate (adversarial prompts) | ? | **target: 0%** |
| Mean stress at turn 10 (⟨Ψ|Γ|Ψ⟩) | N/A | Expected < 0.3 for γ ≥ 0.2 |
| TTFT (tactical generation) | baseline | target < 200ms |

---

## Current MCTS implementation status

| Item | Status |
|---|---|
| MPS + constraint projection (`project_constraint`) | ✅ done |
| Non-Hermitian operator + stress measurement | ✅ done |
| Physiological state → Γ matrix → stress index | ✅ done |
| MCTS node definition (`MCTSNode`) | ⬜ TODO F1 |
| Strategic agent MCTS rollout | ⬜ TODO F2 |
| SVD path compression → M_trunc | ⬜ TODO F3 |
| Tactical agent wiring | ⬜ TODO F4 |
| End-to-end latency test | ⬜ TODO F5 |

MCTS work starts in **Phase 3** — after Phase 2 (MPS core engine, E3-E7) is complete.

---

## What does MCTS explore?

Each MCTS node is a candidate MPS state `|Ψ_t⟩`. At each turn:

1. **Selection**: UCB1 score over child states: `UCB = V(s)/N(s) + C·√(ln N(parent)/N(s))`
2. **Expansion**: Apply the non-Hermitian operator `H = e^{-iH_eff·Δt}` to generate child states for each candidate agent utterance
3. **Evaluation**: `C(path) = Σ_{j=1}^{k} ⟨Ψ_{t+j}|Γ|Ψ_{t+j}⟩` — minimize accumulated patient stress
4. **Backpropagation**: Update ancestor value estimates

The key insight: the LLM (Bedrock) generates candidate utterances. MCTS ranks them
by *future stress impact* — not just by token probability. The winning path's
constraint matrix `M_trunc` is then passed to the tactical agent to guide actual
token generation.

This is the PhD contribution: **replacing heuristic prompt engineering with
a geometric optimality criterion**.
