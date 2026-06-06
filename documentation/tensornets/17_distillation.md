# tensornets — Distillation Pipeline (FUTURE)

> **Migration record**
> - Original file: `docs/tensornets/TODO_DISTILLATION.md`
> - Migrated: 2026-06-04
> - Changes from original: Vocabulary mismatch solution added; circularity caveat given rigorous treatment; D4 sub-items integrated from root TODO.md notes; backend file status updated (hf_local.py, ec2_remote.py, pipeline.py do not yet exist).
> - Original file preserved at `docs/tensornets/TODO_DISTILLATION.md`.

---

> This track is deferred pending data sourcing decisions.
> The MPS + physiological subspace must be validated first (Phases 2–3 in TODO.md).
>
> **Unblocking questions before starting:**
> 1. What SOPs do we distill? (CMS policies, project prompts, synthetic?) → see Data Sources below
> 2. Which model for distillation? (Mistral 7B local vs Llama 70B EC2 vs Llama 405B EC2)
> 3. How do we validate fidelity without a clinical ground truth?

---

## Data Sources — Decision Required

| Source | Content | Access | Usable Now? |
|---|---|---|---|
| `prompts/` in this project | Empathy, clinical, negotiation, state-tracker SOPs | Already here | **YES — highest priority** |
| `training/simulation/` in this project | Synthetic conversation logs, personas, scenarios | Already here | **YES — see analysis below** |
| CMS billing policies | Revenue cycle rules, billing codes, denial trees | Public domain | Yes, download needed |
| AHA/ACC/NIH clinical guidelines | Treatment protocols | Public domain | Yes, download needed |
| Synthetic SOPs via Bedrock | Generate from guidelines on demand | Self-generated | Yes, with circularity caveat |
| WESAD dataset | HRV + EDA stress/recovery | Free download | P0.7 |
| MIMIC-IV (PhysioNet) | ICU HRV + clinical context | ~1 week approval | P0.8 |

### What the existing project simulation data gives you

The `training/simulation/` directory contains a full synthetic conversation engine:
- **Personas** (`personas.js`): patient archetypes with conditions, personalities, age — directly usable as subject profiles for HRV simulation
- **Scenarios**: multi-turn clinical conversations (billing, diagnosis, medication) — these are your SOP input texts
- **Simulation logs** (SQLite): historical agent↔user exchanges — activation extraction corpus
- **Feedback/scoring** (`simulation_feedback.js`, `simulation_scorer.js`): quality labels — ground truth for benchmarking

**Recommendation**: Run a batch export of simulation logs → use as SOP input texts for distillation.
The project already generates the data. You don't need external clinical data to start.

---

## Track D — Distillation Pipeline

*Start after Phase 2 (MPS core engine) is validated.*

### D1 — HuggingFace Activation Extractor
**File**: `tensornets/distillation/backends/hf_local.py` *(does not yet exist)*

- [ ] **D1.1** Load Mistral 7B via HuggingFace int4 (~4GB, `D:/hf_cache`)
  - Ollama GGUF cannot be used — need separate HF weights
  - Run `ollama show mistral --modelfile` first (P0.5) to confirm
- [ ] **D1.2** Register forward hooks on final N transformer layers
- [ ] **D1.3** Forward pass on sample SOP, verify `M ∈ R^{N × 4096}`
- [ ] **D1.4** Handle tokenization edge cases (Mistral max 8192 tokens)
- [ ] **D1.5** Unit test: 3 SOPs → shape `(seq_len, 4096)`, no NaN/Inf

**Benchmark D1**: Peak VRAM, time-per-token, CPU RAM during extraction.

---

### D2 — Activation Matrix Construction
**File**: `tensornets/distillation/pipeline.py` *(does not yet exist)*

- [ ] **D2.1** `ActivationMatrix` dataclass: `M`, source text, layer, model ID, timestamp
- [ ] **D2.2** Batch extraction: multiple SOPs → list of activation matrices
- [ ] **D2.3** Variable sequence length handling: pad/truncate to `N_max`

**Benchmark D2**: Activation quality across layers (cosine similarity). Which layer is richest for clinical SOPs?

---

### D3 — Truncated SVD
**File**: `tensornets/core/svd.py`

- [ ] **D3.1** Truncated SVD (`torch.linalg.svd`, economy mode)
- [ ] **D3.2** Adaptive rank selection: retain ≥ 99% energy
- [ ] **D3.3** Truncation error: `Error ≤ Σ_{i=k+1}^{N} σᵢ²`
- [ ] **D3.4** Unit test: reconstruct `M_trunc`, Frobenius error < threshold
- [ ] **D3.5** Unit test: verify k from energy criterion

**Benchmark D3**: Plot singular value spectra for 10 project SOPs (from `prompts/`). Rapid drop-off validates the approach.

---

### D4 — MPS Core Tensor Initialization
**File**: `tensornets/core/mps.py` + `tensornets/distillation/pipeline.py` *(pipeline.py does not yet exist)*

- [ ] **D4.3** Initialize MPS cores from SVD output (U_k Σ_k → core tensors)
- [ ] **D4.6** Unit test: MPS from synthetic activation matrix, verify shape + normalization

**Benchmark D4**: MPS init time vs N. Confirm O(Ndχ²).

---

### D5 — Serialization
**File**: `tensornets/core/mps.py`

- [ ] **D5.1** `MPS.save(path)` using `safetensors`
- [ ] **D5.2** `MPS.load(path)` with metadata validation
- [ ] **D5.3** S3 upload/download for EC2 jobs
- [ ] **D5.4** Round-trip test

---

### D6 — Distillation Fidelity Validation
**File**: `tensornets/benchmarks/distillation_fidelity.py`

- [ ] **D6.1** Fidelity metric: cosine similarity (LLM embeddings vs MPS-reconstructed vectors)
- [ ] **D6.2** Forward pass through MPS → semantic probability distribution
- [ ] **D6.3** 20 SOPs: mean + std cosine similarity
- [ ] **D6.4** Plot: singular value spectra, retained energy vs k, fidelity vs k — **Figures 1–2 of paper**
- [ ] **D6.5** Regression test: fidelity ≥ 0.90 at k=64

**Target**: cosine similarity > 0.95 at k=128.

---

### D7 — Scale to EC2 (70B → 405B)
**File**: `tensornets/distillation/backends/ec2_remote.py` *(does not yet exist)*

The paper names Llama 405B as the compiler (Section 2.2.2).

- [ ] **D7.1** EC2 spot launcher (parameterized: 70B on g5.12xlarge ~$20–40/run, 405B on p4d.24xlarge ~$120/run)
- [ ] **D7.2** Model-agnostic extraction job script
- [ ] **D7.3** S3 parameterization
- [ ] **D7.4** Cost estimator
- [ ] **D7.5** 70B distillation on 5 project SOPs → fidelity vs Mistral 7B
- [ ] **D7.6** 405B distillation on same 5 SOPs → fidelity vs 70B
- [ ] **D7.7** 3-way fidelity curve (7B / 70B / 405B at χ=64 and χ=128) — **publishable figure**

> Llama 405B not yet active on Bedrock account — request access (P0.6) before D7.6.

---

## Benchmarks (Section 5 — distillation-dependent)

- [ ] **H2** Safety violation rate: 500 adversarial prompts per system (needs distilled MPS)
- [ ] **H6** Catastrophic forgetting: update one policy via ALS, re-run 100 tests

---

## Open Questions

1. **Which layer to distill from?** D2.3 ablation answers this.

2. **Circularity mitigation**: See rigorous treatment below.

3. **Vocabulary mismatch**: See solution below.

---

### Vocabulary mismatch (Mistral 32K vs Llama 128K)

The Mistral 7B tokeniser has a vocabulary of 32K tokens; Llama 3.1 405B has 128K. When extracting activation matrices from Mistral for distillation into a Llama-compatible MPS initialisation:

**Problem**: Token embeddings in Mistral and Llama index different vocabularies. Direct activation transfer is invalid.

**Proposed solution**: Use the intersection vocabulary (~28K tokens shared at the BPE level) and project activations from the Mistral embedding space into the Llama embedding space via a learned linear projection P ∈ ℝ^{d_llama × d_mistral}. Train P on the intersection vocabulary with L2 loss. This is equivalent to the "embedding alignment" step in cross-lingual transfer learning (Conneau et al. 2020).

Alternative: Use a model-agnostic intermediate representation (e.g., normalised word2vec embeddings) as the MPS initialisation basis, independent of the tokeniser.

---

### Circularity caveat: synthetic data → LLM → distillation

The distillation pipeline (Track D) uses synthetic conversation data generated by the same Bedrock LLM family (Scout/Maverick) that the distilled model aims to approximate. This creates a potential circularity:

1. Training data is generated by LLM X
2. MPS is distilled from LLM X's activations
3. The distilled MPS is evaluated on LLM X's outputs

**Why this is not fatal for the PhD claim**: The claim is not that the distilled MPS matches LLM X perfectly. The claim is that the HTN framework's physiological constraints, once encoded in the MPS, improve clinical safety regardless of which LLM generates the tokens. The distillation step is a *weight initialisation* — it seeds the MPS with plausible clinical dialogue representations. The A3C training loop then fine-tunes those weights using reward signals (judge.py) that are independent of the generative LLM.

**Mitigation**:
- D6 fidelity validation uses held-out MIMIC-IV clinical notes (real patient data, not synthetic) as a ground-truth test set
- D7 scale-up uses 405B for distillation but evaluates against 7B Mistral — a different model family provides partial independence
- The final PhD evaluation compares HTN-distilled vs. undistilled MPS, not HTN-distilled vs. LLM X
