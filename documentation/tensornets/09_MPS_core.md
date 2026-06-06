# MPS Core: Matrix Product States and Non-Hermitian Operators

---

## 1. Why MPS for Physiological History

### The KV Cache Problem

Transformer-style KV caches scale as O(N·d_model) per token and grow unboundedly with conversation length. In a care-circle session, N can reach several hundred turns while each turn carries both semantic tokens **and** an 8-channel physiological vector (heart rate, HRV, SpO₂, respiratory rate, skin conductance, skin temperature, accelerometer magnitude, and a composite stress index). Concatenating these into a flat cache produces:

1. **Quadratic attention cost** in context length.
2. **No natural partition** between semantic content and physiological state — they are entangled in a single dense matrix.
3. **No compression** — every past token remains at full resolution.

### The MPS Solution

A Matrix Product State represents the N-step history as a chain of rank-3 tensors, each of shape `(χ, d, χ)`. The total parameter count is `O(N·d·χ²)`, which is linear in N and controlled by the bond dimension χ. Compression is exact when χ equals the full Schmidt rank, and near-lossless when the SVD energy fraction threshold (≥ 0.95) is met with a truncated χ.

Crucially, the bond space is split:

| Sub-dimension | Size | Role |
|---|---|---|
| χ_semantic | 2 | Contextual/semantic entanglement |
| χ_physio | 2 | Physiological subspace |
| **Total χ** | **4** | MPS_BOND_DIM |

This `bond_dim split` means semantic compression and physiological compression are decoupled: physiological dissipation (Γ) acts only on the χ_physio partition, leaving semantic coherence undisturbed.

---

## 2. Matrix Product State Formalism

### 2.1 Core Tensor Structure

A single MPS site is a **CoreTensor** with shape `(χ, d, χ)`:

```
A^[n]_{α_{n-1}, i_n, α_n}
```

where:
- `α_{n-1}`, `α_n` ∈ {0, …, χ−1} are **bond indices** (χ = 4)
- `i_n` ∈ {0, …, d−1} is the **physical index** (d = 8 physiological features)

The full N-site MPS state is:

```
|Ψ⟩ = Σ_{i_1…i_N}  A^[1]_{α_0,i_1,α_1} · A^[2]_{α_1,i_2,α_2} · … · A^[N]_{α_{N-1},i_N,α_N}  |i_1 … i_N⟩
```

with open boundary conditions (α_0 = α_N = 0, i.e. leftmost and rightmost bonds are dimension-1 dummy indices).

**Parameter count per session:** `N × d × χ² = N × 8 × 16 = 128N` real numbers, versus the KV cache's `N × d_model` (typically N × 512–4096).

### 2.2 State Evolution

Between conversational turns, each site tensor is updated by contracting with the local evolution operator derived from `H_eff`:

```
A^[n]_{new} ← e^{−iH_eff·Δt} ⊗ A^[n]
```

The full system state at time t+1 is:

```
|Ψ_{t+1}⟩ = e^{−iH_eff·Δt} |Ψ_t⟩
```

implemented via `torch.linalg.matrix_exp` on the (d×d) effective Hamiltonian before contracting into each CoreTensor site. Δt = 1 in discrete turn-time units.

### 2.3 Left Canonicalisation (QR)

After each site update, the MPS is brought into **left-canonical form** via QR decomposition sweeping left-to-right:

```
A^[n]  →  reshape to (χ·d, χ)  →  QR  →  Q (left-isometric), R passed right
A^[n]  ←  reshape(Q, (χ, d, χ))
A^[n+1]  ←  R · A^[n+1]
```

Left-canonical form guarantees:

```
Σ_{α_{n-1}, i_n}  A^[n]*_{α_{n-1},i_n,α_n}  A^[n]_{α_{n-1},i_n,α_n'}  =  δ_{α_n, α_n'}
```

This orthogonality condition is required for the SVD truncation in §4.1 to be a proper Schmidt decomposition.

### 2.4 Memory Complexity O(N·d·χ²)

| Quantity | Value | Notes |
|---|---|---|
| Bond dimension χ | 4 | MPS_BOND_DIM |
| Feature dimension d | 8 | physiological signals |
| Parameters per site | d·χ² = 8·16 = 128 | complex floats |
| Parameters for N-site MPS | 128N | linear in context length |
| Equivalent KV cache | N·d_model | typically 512N–4096N |
| Compression ratio | 4×–32× | depending on d_model |

At 100 turns (a typical session), the full MPS fits in ≈ 102 KB (float32). A comparable GPT-2 KV cache would require ≈ 6.4 MB.

---

## 3. The Non-Hermitian Effective Hamiltonian

### 3.1 H_eff = H₀ − iΓ Structure

The evolution operator is the matrix exponential of a **non-Hermitian effective Hamiltonian** (`core/operators.py`):

```
H_eff  =  H₀  −  i·Γ
```

| Component | Type | Shape | Source |
|---|---|---|---|
| H₀ | Hermitian (H₀† = H₀) | d×d = 8×8 | Constructed from conversation context embedding |
| Γ | Positive semi-definite (Γ ≽ 0) | d×d = 8×8 | Principal component of dominant stress signal |
| H_eff | Non-Hermitian | d×d = 8×8 | H₀ − iΓ |

H₀ encodes the **semantic oscillation** of the conversation state — how the agent's internal representation rotates in physiological feature space as new dialogue context arrives. Γ encodes **physiological dissipation** — the rate at which stressed physiological signals decay toward baseline.

### 3.2 Physical Interpretation of the Imaginary Term

In quantum mechanics, a non-Hermitian Hamiltonian H = H₀ − iΓ arises in **open quantum systems**: the imaginary part describes coupling to an environment (here, physiological stress) that removes probability amplitude (norm) from the system.

In the tensornets context this has a direct care-circle interpretation:

- **Norm decay** `⟨Ψ|Ψ⟩ < 1` after evolution signals that physiological stress is consuming agent "bandwidth" — the agent is less available to engage fully with semantic content.
- **Γ principal component** is the dominant stress signal (e.g. HRV suppression under acute anxiety), so the dissipation is physiologically grounded rather than a generic penalty.
- **Re-normalisation** after each step is intentional: the post-normalised state encodes the *conditional* distribution given survival (Γ has not catastrophically dissipated the state), analogous to quantum jump trajectories.

### 3.3 Eigenvalue Spectrum and Hysteresis Cycles

The eigenvalues of H_eff are complex:

```
λ_eff  =  λ_real  −  i·λ_imag
```

| Eigenvalue component | Role |
|---|---|
| Re(λ_eff) = λ_real | Oscillation frequency in feature space |
| −Im(λ_eff) = λ_imag | Dissipation rate (must be ≥ 0 for Γ ≽ 0) |

The **spectral gap** Δλ_imag between the least-dissipated and most-dissipated eigenmodes determines how quickly the state collapses onto the low-stress subspace. When Γ is large (acute physiological distress), the gap is wide and the state decoheres rapidly; when Γ ≈ 0 (physiological rest), H_eff ≈ H₀ and the evolution is approximately unitary.

**Hysteresis cycles** appear in the companion_hysteresis module: the rupture path (α = 0.30) and repair path (α = 0.04) trace out non-reversible loops in (λ_real, λ_imag) space, consistent with the asymmetry observed by Safran & Muran (2000) in therapeutic alliance dynamics.

### 3.4 Construction from Physiological State

1. **H₀ construction**: the conversation context embedding (a d-dimensional vector) is outer-producted with itself and symmetrised: `H₀ = (v·vᵀ + vᵀ·v) / 2‖v‖²`.
2. **Γ construction**: the 8-channel physiological reading is PCA-projected to its dominant direction `u₁`; then `Γ = γ · u₁ · u₁ᵀ` where γ is the explained variance of the first principal component. This guarantees Γ ≽ 0 by construction.
3. **H_eff assembly**: `H_eff = H₀ - 1j * Γ` (complex 8×8 tensor).
4. **Evolution**: `U = torch.linalg.matrix_exp(-1j * H_eff * dt)`.

---

## 4. SVD Truncation and Action Scoring

### 4.1 M_trunc Computation

After left-canonicalisation, the rightmost bond matrix M (shape χ×χ) is formed by contracting adjacent CoreTensors. SVD is applied:

```
M  =  U · Σ · V†
```

Truncation retains the top k singular values satisfying the **energy fraction criterion**:

```
Σ_{j=1}^{k} σ_j²  /  Σ_{j=1}^{χ} σ_j²  ≥  0.95
```

The truncated approximation is:

```
M_trunc  =  U_k · Σ_k · V†_k
```

with rank k ≤ χ = 4. This is the standard DMRG truncation (White 1992).

### 4.2 Action Embedding e_a

The **dominant singular vector** m_dominant = U_k[:, 0] (left singular vector of largest σ) summarises the current physiological-semantic state as a d-dimensional vector. Action scores are computed via the `token_amplitudes()` method:

```
score(a)  =  e_a · m_dominant
```

where e_a ∈ ℝ^d is the **action embedding** for action a (loaded from the action embedding table). The highest-scoring action is the greedy MPS recommendation; the full score vector feeds into the MCTS prior (see `05_mcts.md`).

### 4.3 Degenerate Case Handling

When two singular values are near-degenerate (|σ_1 − σ_2| < ε = 1e-6), the dominant singular vector is not uniquely defined. The `token_amplitudes()` method handles this by:

1. Detecting degeneracy via `torch.isclose(sigma[0], sigma[1], atol=1e-6)`.
2. Forming an averaged embedding: `m_dominant = (U[:, 0] + U[:, 1]) / √2`.
3. Flagging the action score as low-confidence (entropy regularisation weight doubled in MCTS).

---

## 5. Social Coupling (V_int)

Inter-agent state propagation is controlled by the coupling matrix V_int, loaded from `V_INT_PRIOR` in `agents/shared_tensor_state.py`. The values encode asymmetric social influence:

| Source agent | Target agent | Coupling value |
|---|---|---|
| clinician | patient | 0.6 |
| caregiver | patient | 0.4 |
| patient | clinician | 0.2 |
| patient | caregiver | 0.35 |
| clinician | caregiver | 0.25 |
| caregiver | clinician | 0.15 |

The propagation rule at each turn is:

```
|Ψ_target⟩  ←  |Ψ_target⟩  +  v_{source→target} · |Ψ_source⟩
```

followed by re-normalisation. The asymmetric values reflect the care-circle's **principal hierarchy**: clinicians have the strongest downstream influence on patients (0.6), while patients have minimal influence on clinicians (0.2), consistent with the directed nature of therapeutic relationships.

The coupling matrix is applied after MPS evolution in `SharedTensorBuffer.v_int_propagate()` and before MCTS rollout, so the multi-agent hint reflects the current inter-agent entanglement state.

---

## 6. Comparison with KV Cache

| Dimension | MPS (tensornets) | KV Cache (transformer) |
|---|---|---|
| **Memory scaling** | O(N·d·χ²) = O(128N) | O(N·d_model·layers) = O(512N–32768N) |
| **Compression** | SVD-adaptive, energy-threshold | None (exact retention) |
| **Interpretability** | Bond spectrum = Schmidt decomposition of history | Opaque attention keys/values |
| **Physio partitioning** | Explicit χ_semantic / χ_physio split | None |
| **Non-Hermitian dynamics** | H_eff encodes dissipation directly | No dissipation model |
| **Cross-agent sharing** | V_int coupling matrix | None (per-session only) |
| **Context window** | Unlimited (MPS grows linearly) | Hard context limit (4K–128K tokens) |
| **Gradient flow** | Through torch.linalg.matrix_exp | Through softmax attention |

The key advantage is not raw performance but **structural alignment** with the care-circle problem: physiological signals are first-class citizens of the state representation rather than auxiliary inputs.

---

## 7. Pending: ALS Optimiser

**`als.py` does not yet exist.** It is planned for Phase 4.

**What ALS would do:** Alternating Least Squares (ALS) is the standard algorithm for fitting a Matrix Product State to observed data without backpropagation. The algorithm sweeps through sites 1…N and N…1, at each site solving a linear least-squares problem for that site's CoreTensor while holding all others fixed. This is analogous to the DMRG two-site update.

**Why it is needed:** The current implementation updates CoreTensors via gradient descent through `torch.linalg.matrix_exp`, which is differentiable but can suffer from vanishing/exploding gradients in long chains (N > 50). ALS would provide:

1. **Guaranteed convergence** per sweep (each site update is a convex least-squares problem).
2. **No backprop through the chain** — each site is updated locally.
3. **Compatibility with the QR canonicalisation sweeps** already implemented.

**Phase 4 integration point:** ALS will replace the current gradient-based site update in `core/mps.py:MPSLayer.update_sites()` and will require the bond environment tensors (left/right transfer matrices) to be pre-computed and cached.

---

## 8. References

- **Vidal, G. (2003).** Efficient Classical Simulation of Slightly Entangled Quantum Computations. *Physical Review Letters*, 91(14), 147902. — foundational MPS/TEBD algorithm.
- **Schollwöck, U. (2011).** The density-matrix renormalization group in the age of matrix product states. *Annals of Physics*, 326(1), 96–192. — comprehensive MPS formalism reference.
- **White, S. R. (1992).** Density matrix formulation for quantum renormalization groups. *Physical Review Letters*, 69(19), 2863. — original DMRG / SVD truncation.
- **Oseledets, I. V. (2011).** Tensor-Train Decomposition. *SIAM Journal on Scientific Computing*, 33(5), 2295–2317. — TT decomposition as generalisation of MPS to arbitrary tensors; directly applicable to the CoreTensor chain.
- **Daley, A. J. (2014).** Quantum trajectories and open many-body quantum systems. *Advances in Physics*, 63(2), 77–149. — non-Hermitian effective Hamiltonians and quantum jump trajectories.
