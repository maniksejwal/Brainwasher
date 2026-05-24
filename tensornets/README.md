# tensornets

**Hysteretic Tensor Negotiation (HTN) Framework**
Research package implementing tensorized neural networks and tensor networks with Monte Carlo Tree Search (MCTS) for non-Markovian, physiologically-aware multi-agent conversational deliberation.

> This package is a standalone research module. It will eventually integrate with the Brainwasher 3 multi-agent framework once the core tensor engine is validated.

---

## The Problem This Solves

Standard LLMs fail in high-stakes clinical conversations for three structural reasons:

1. **Markov assumption** — they treat every turn as independent, ignoring that a patient who just heard bad news is still physiologically stressed even if the topic changed.
2. **Softmax guarantees hallucination** — there is always a non-zero probability ε > 0 of generating an unsafe token, no matter how tight the system prompt.
3. **Quadratic attention cost** — O(N²d) scaling means live conversations with long history become latency-bottlenecked.

HTN replaces the neural reasoning engine with a **tensor manifold** — a geometric space where safety rules are physical walls, not probability penalties.

---

## Core Architecture

The framework is **bipartite**: a logic engine that cannot hallucinate, and a linguistic engine that generates fluent text.

```
┌──────────────────────────────────────────────────────────────────┐
│                    MULTILINEAR LOGIC ENGINE                      │
│                                                                  │
│  ┌─────────────┐    MCTS rollout    ┌──────────────────────┐    │
│  │  MPS State  │ ──────────────────▶│  Strategic Agent     │    │
│  │  |Ψt⟩       │                   │  (high-rank, full χ) │    │
│  │             │                   │  minimizes ∫Γ dt     │    │
│  │  bond dim χ │                   └──────────┬───────────┘    │
│  │  ├─ semantic│                              │ SVD truncation   │
│  │  └─ physio  │                   ┌──────────▼───────────┐    │
│  └─────────────┘                   │  Tactical Agent      │    │
│         ▲                          │  (low-rank, locked)  │    │
│         │  H = e^{-iH_eff·Δt}      │  sub-200ms tokens    │    │
│         │  H_eff = H₀ - iΓ        └──────────────────────┘    │
│         │  (non-Hermitian: stress decays, not oscillates)      │
└─────────┼────────────────────────────────────────────────────────┘
          │ Semantic Blueprint
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                  TENSORIZED LINGUISTIC ENGINE                    │
│  Compressed Llama (TT-decomposed weights, ~80% VRAM reduction)  │
│  Handles fluent output only — logic is already done above       │
└──────────────────────────────────────────────────────────────────┘
```

### Why non-Hermitian?

A Hermitian operator conserves energy — stress would oscillate forever. A patient's autonomic nervous system is an **open dissipative system**: adrenaline decays. We model this with:

```
H_eff = H₀ − iΓ
```

The transition operator `H = e^{-iH_eff·Δt}` expands to:

```
H = e^{-iH₀t} · e^{-Γt}
```

The second factor `e^{-Γt}` is a strict exponential decay. The patient's stress state does not reset when the topic changes — it decays at the physiologically measured rate γ derived from real-time HRV.

### Why MPS instead of attention?

| Property | Transformer Attention | Matrix Product State |
|---|---|---|
| Complexity | O(N²d) | O(Ndχ²) |
| Safety enforcement | Probabilistic (softmax, ε > 0) | Structural (multiply by 0 = impossible) |
| Memory with history | KV cache grows unboundedly | Fixed O(χ²d) per step |
| Update rule | Global backprop (forgetting risk) | Localized ALS (targeted rank-1 update) |
| Interpretability | Attention weights (post-hoc) | SVD spectrum (causal, geometric) |

---

## Physiological Subspace

The virtual bond dimension χ is **explicitly partitioned**:

```
χ_total = χ_semantic + χ_physiological
```

The physiological subspace tracks:

| Signal | Proxy for | Maps to |
|---|---|---|
| HRV (RMSSD) | Acute stress / ANS arousal | γ (autonomic decay constant) → λ₁ = e^{-γΔt} |
| Blood glucose | Energy availability / cognitive load | Amplitude scaling of χ_phys |
| Perspiration (EDA) | Sympathetic activation | Modulates Γ matrix diagonal |
| Time of day | Circadian phase (cortisol baseline) | Offset on H₀ baseline |
| Location | Environmental stress context | Prior on Γ initialization |

The decay rate γ is mapped from real-time HRV to the spectral gap of the physiological transfer matrix:

```
|λ₁| = e^{-γΔt}    where γ = f(RMSSD_current, RMSSD_baseline, context)
```

---

## Initialization: Deterministic Distillation (not training)

HTN has **no training phase**. Agents are initialized by compiling clinical SOPs directly into tensor geometry:

```
1. Pass SOP text through frozen LLM (Llama 3.1 70B)
2. Extract hidden state activations: M ∈ R^{N × d_model}
3. Truncated SVD:  M ≈ U_k Σ_k V_k^T   (k = target bond dim χ)
4. Encode scaled singular vectors as MPS core tensors A^{(t)}
```

This compresses the zero-shot reasoning of a 70B model into the geometry of a tensor network. At runtime, no LLM is involved in reasoning — only in final text generation.

---

## LLM Backend Strategy

| Purpose | Model | Where | d_model |
|---|---|---|---|
| Dev / local iteration (activation extraction) | Mistral 7B (HuggingFace, int4) | D: drive, ~4GB | 4,096 |
| Intermediate distillation | Llama 3.1 70B (HuggingFace) | EC2 `g5.12xlarge` spot (~$20–40/run) | 8,192 |
| Production distillation (paper target) | Llama 3.1 405B (HuggingFace) | EC2 `p4d.24xlarge` spot (~$80–150/run) | 16,384 |
| **Primary linguistic engine** | `mistral.mistral-large-3-675b-instruct` | AWS Bedrock (on-demand, active) | N/A |
| Latency benchmark baseline | `meta.llama4-maverick-17b-instruct-v1:0` | AWS Bedrock (on-demand, active) | N/A |

**Why Bedrock cannot be used for distillation**: Bedrock is an inference API — it returns tokens, not internal layer activations. Activation extraction requires direct model weight access via HuggingFace Transformers with `output_hidden_states=True`. Bedrock models are used only for the Tensorized Linguistic Engine (text generation), never for the distillation pipeline.

**Distillation data sources**:

| Source | Content | Access |
|---|---|---|
| CMS billing policies | Revenue cycle SOPs, denial trees, billing codes | Public domain, freely citable |
| AHA/ACC/NIH clinical guidelines | Treatment protocols, medication rules | Public domain |
| Synthetic SOPs via Bedrock | Scenario-specific clinical rules generated on demand | Self-generated (document circularity mitigation in paper) |
| WESAD dataset | HRV + EDA stress/recovery trajectories | Free academic download |
| MIMIC-IV (PhysioNet) | ICU HRV + clinical context | PhysioNet account (~1 week approval) |

---

## Key Dimensions

| Parameter | Symbol | Value | Notes |
|---|---|---|---|
| Vocabulary size | d | 32,000 | Mistral tokenizer (dev); 128,256 (Llama 3) |
| Bond dimension | χ | 64–256 | Tunable; controls expressivity vs compute |
| Physiological subspace | χ_phys | 16–32 | Subset of χ |
| Distillation rank | k | = χ | Truncated SVD rank |
| d_model (Mistral 7B) | d_model | 4,096 | Hidden state size for local dev |
| d_model (Llama 3.1 70B) | d_model | 8,192 | Hidden state size for prod distillation |
| MPS core tensor shape | A^{(t)} | [χ × d × χ] | Per conversational step |

---

## Benchmarking Targets (Section 5 — to be filled)

Every component is benchmarked. Benchmarks are non-negotiable for PhD-level validation.

| Benchmark | Baseline | HTN Target | Metric |
|---|---|---|---|
| Safety violation rate | LLM + system prompt | 0.00% (hard geometric boundary) | % unsafe tokens generated |
| Latency (TTFT) | Llama 70B direct | < 200ms | ms |
| Memory footprint | Llama 70B (140GB) | < 2GB active | GB VRAM |
| Physiological trajectory accuracy | N/A (no baseline has this) | RMSE vs clinical HRV ground truth | RMSE |
| Catastrophic forgetting | LoRA fine-tune | 0% interference on frozen tensors | % regression on prior tests |
| Distillation fidelity | Direct LLM output | > 0.95 cosine similarity | Cosine sim |
| MCTS rollout latency | Beam search (neural) | < 500ms per decision | ms |

---

## Repository Structure (target)

```
tensornets/
├── README.md
├── TODO.md
├── pyproject.toml
├── tensornets/
│   ├── __init__.py
│   ├── core/
│   │   ├── mps.py              # Matrix Product State implementation
│   │   ├── operators.py        # Non-Hermitian transition operators
│   │   └── svd.py              # Truncated SVD, ALS optimization
│   ├── physio/
│   │   ├── state.py            # Physiological state vector
│   │   ├── hrv.py              # HRV → γ mapping, decay constants
│   │   ├── pkpd.py             # Pharmacokinetic/pharmacodynamic models
│   │   └── simulator.py        # Monte Carlo physiological trajectory sim
│   ├── distillation/
│   │   ├── extractor.py        # LLM hidden state activation extraction
│   │   ├── pipeline.py         # SOP text → tensor cores (full pipeline)
│   │   └── backends/
│   │       ├── hf_local.py     # HuggingFace local (Mistral 7B dev)
│   │       └── ec2_remote.py   # EC2 spot job launcher for 70B distillation
│   ├── mcts/
│   │   ├── strategic.py        # High-rank strategic agent + MCTS rollout
│   │   ├── tactical.py         # Low-rank tactical agent, SVD-locked
│   │   └── tree.py             # MCTS tree data structures
│   ├── agents/
│   │   ├── htn_agent.py        # Full HTN agent (logic + linguistic)
│   │   ├── shared_buffer.py    # Shared tensor state buffer
│   │   └── inspector.py        # Semantic State Inspector (debug)
│   ├── linguistic/
│   │   ├── bedrock.py          # Bedrock Llama inference client
│   │   └── tensorized_llm.py   # TT-decomposed weight compression
│   └── benchmarks/
│       ├── safety.py
│       ├── latency.py
│       ├── memory.py
│       ├── physio_accuracy.py
│       └── forgetting.py
└── tests/
    ├── test_mps.py
    ├── test_operators.py
    ├── test_distillation.py
    ├── test_physio.py
    └── test_mcts.py
```

---

## Development Path

```
Track D (top priority)          Track B + C (parallel)
─────────────────────────────   ──────────────────────────────────
D1: HF activation extractor     B1: Abstract LLM client
D2: Activation matrix M         B2: Mistral 7B local adapter
D3: Truncated SVD               C1: Physiological state vector
D4: MPS core initialization     C2: HRV → γ mapping
D5: Tensor core serialization   C3: Non-Hermitian operator
D6: Fidelity validation         C4: Physiological trajectory sim
D7: Distillation benchmarks     C5: PK/PD hysteresis models
D8: Scale to EC2 70B            B3: EC2 spot job + S3 integration
         │                               │
         └──────────────┬────────────────┘
                        ▼
              Phase 2: MPS Core Engine
              (B + C + D converge here)
                        │
                        ▼
              Phase 3: MCTS + Dual Agent
                        │
                        ▼
              Phase 4: Brainwasher 3 Integration
```

---

## References

- Sejwal, M. (2026). *Hysteretic Tensor Networks for Non-Markovian Multi-Agent Conversational Deliberation in Clinical Workflows.* (`Tensor_nets.pdf`)
- Vidal, G. (2003). Efficient Classical Simulation of Slightly Entangled Quantum Computations. *PRL.*
- White, S. R. (1992). Density matrix formulation for quantum renormalization groups. *PRL.* (DMRG basis for ALS)
- Novikov et al. (2015). Tensorizing Neural Networks. *NIPS.*
- Oseledets (2011). Tensor-Train Decomposition. *SIAM J. Sci. Comput.*
