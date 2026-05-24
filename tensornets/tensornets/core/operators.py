"""
Non-Hermitian transition operators for the HTN framework.

The core equation (paper Section 4.2):

    H_eff = H₀ − iΓ

    H = e^{−i H_eff Δt}
      = e^{−i H₀ Δt} · e^{−Γ Δt}

H₀  — Hermitian component: conservative semantic/logical dialogue evolution
Γ   — Anti-Hermitian component: dissipation matrix (physiological calming)

Because Γ has non-negative eigenvalues and enters with a minus sign via the
imaginary unit, e^{−Γt} is a strict exponential decay. The physiological
subspace amplitude decays monotonically — the patient cannot become more
stressed than their current amplitude without an external stressor event.

The physiological bond subspace and semantic subspace are structurally
partitioned within the full bond dimension. Γ acts only on the physiological
indices; H₀ acts only on the semantic indices (with optional weak coupling).

Implementation note
-------------------
We use torch.linalg.matrix_exp throughout. This is numerically stable for
complex Hermitian and near-Hermitian matrices of the sizes used here (dim ≤ 512).
Do NOT use the Euler approximation e^A ≈ I + A for Δt > 0.1 — it violates
the norm-decay guarantee for the non-Hermitian case.
"""

from __future__ import annotations

import torch
import torch.linalg

from tensornets.physio.state import PhysiologicalState
from tensornets.physio.hrv import gamma_from_state


# ── Operator construction ──────────────────────────────────────────────────────

def build_H0(
    semantic_dim: int,
    dtype: torch.dtype = torch.complex128,
    device: torch.device | str = "cpu",
) -> torch.Tensor:
    """
    Build the Hermitian semantic evolution matrix H₀.

    Initially set to the identity scaled by a small constant so the semantic
    subspace evolves slowly (nearly static). Once the MPS is initialized via
    distillation, H₀ will be updated via ALS to encode the clinical dialogue
    logic. Until then, identity is the mathematically safe default: it
    preserves the semantic state without distorting it.

    Shape: [semantic_dim, semantic_dim], complex.

    Hermiticity guarantee: H₀ = (H₀ + H₀†) / 2 is enforced on every update.
    """
    H0 = torch.eye(semantic_dim, dtype=dtype, device=device) * 0.01
    # Enforce Hermiticity explicitly (belt-and-suspenders)
    H0 = (H0 + H0.conj().T) / 2.0
    return H0


def build_Gamma(
    physio_dim: int,
    state: PhysiologicalState,
    baseline_ms: float | None = None,
    coupling: float = 0.05,
    dtype: torch.dtype = torch.complex128,
    device: torch.device | str = "cpu",
) -> torch.Tensor:
    """
    Build the dissipation matrix Γ from the current physiological state.

    Structure
    ---------
    Γ is a real symmetric positive-semidefinite matrix of shape
    [physio_dim, physio_dim]. Its eigenvalues are the per-channel decay rates.

    Diagonal entries: derived from the γ scalar (HRV + EDA + location), scaled
    across the physio_dim channels according to the 5 physiological signals.

    Off-diagonal entries: small coupling terms (controlled by `coupling`)
    that allow cross-signal effects — e.g., high EDA amplifying glucose decay.
    These keep Γ positive semi-definite while capturing co-activation.

    Parameters
    ----------
    physio_dim : int
        Size of the physiological subspace in the MPS bond dimension.
        Must be ≥ 5 (one channel per physiological signal).
    state : PhysiologicalState
        Current physiological measurement.
    baseline_ms : float, optional
        Subject HRV baseline for γ computation.
    coupling : float
        Off-diagonal coupling strength. Default 0.05 (weak but non-zero).
    """
    if physio_dim < 5:
        raise ValueError(
            f"physio_dim must be ≥ 5 (one channel per signal), got {physio_dim}"
        )

    gamma = gamma_from_state(state, baseline_ms=baseline_ms)
    vec = state.to_vector()  # 5 normalised signals

    # Diagonal: each physio channel decays at γ scaled by its signal amplitude.
    # Channels beyond 5 copy the composite stress_index to fill the dimension.
    diag_vals = torch.zeros(physio_dim, dtype=torch.float64)
    for i in range(physio_dim):
        if i < 5:
            diag_vals[i] = gamma * (0.5 + 0.5 * vec[i])
        else:
            diag_vals[i] = gamma * (0.5 + 0.5 * state.stress_index())

    Gamma = torch.diag(diag_vals).to(dtype=dtype, device=device)

    # Off-diagonal coupling: symmetric, small positive terms
    if coupling > 0.0 and physio_dim > 1:
        stress = state.stress_index()
        for i in range(min(5, physio_dim)):
            for j in range(i + 1, min(5, physio_dim)):
                val = coupling * gamma * stress * float(vec[i] * vec[j])
                Gamma[i, j] += val
                Gamma[j, i] += val

    # Guarantee positive semi-definiteness via eigenvalue floor
    Gamma = _make_psd(Gamma)
    return Gamma


def build_H_eff(
    H0: torch.Tensor,
    Gamma: torch.Tensor,
) -> torch.Tensor:
    """
    Assemble the effective Hamiltonian H_eff = H₀ − iΓ.

    H₀ and Γ operate on different subspaces (semantic vs physiological).
    This function embeds them into a block-diagonal structure:

        H_eff = diag(H₀_block, Γ_block)

    The imaginary unit is applied to Γ here so that the caller works with
    real-valued H₀ and Γ and the complex arithmetic is localised.

    Parameters
    ----------
    H0 : Tensor[semantic_dim, semantic_dim]
        Hermitian semantic component.
    Gamma : Tensor[physio_dim, physio_dim]
        Positive-semidefinite dissipation matrix.

    Returns
    -------
    Tensor[total_dim, total_dim]
        Complex effective Hamiltonian, where total_dim = semantic_dim + physio_dim.
    """
    sem_dim   = H0.shape[0]
    phys_dim  = Gamma.shape[0]
    total_dim = sem_dim + phys_dim
    dtype     = torch.complex128
    device    = H0.device

    H_eff = torch.zeros(total_dim, total_dim, dtype=dtype, device=device)
    H_eff[:sem_dim, :sem_dim]     = H0.to(dtype)
    # −iΓ: multiply real Γ by −i
    H_eff[sem_dim:, sem_dim:]     = -1j * Gamma.to(dtype)
    return H_eff


def build_transition_operator(
    H_eff: torch.Tensor,
    delta_t: float = 1.0,
) -> torch.Tensor:
    """
    Compute the transition operator H = e^{−i H_eff Δt}.

    Uses torch.linalg.matrix_exp on the anti-Hermitian argument (−i H_eff Δt).
    This is the exact matrix exponential — no Euler or Padé approximation.

    For the semantic block:   e^{−i H₀ Δt} is unitary (norm-preserving).
    For the physio block:     e^{−Γ Δt} has singular values ≤ 1 (norm-decaying).

    Parameters
    ----------
    H_eff : Tensor[d, d]
        Effective Hamiltonian, complex.
    delta_t : float
        Conversational time step in turns. Default 1.0.

    Returns
    -------
    Tensor[d, d]
        Complex transition operator H.
    """
    exponent = -1j * H_eff * delta_t
    return torch.linalg.matrix_exp(exponent)


def apply_operator_to_vector(
    H: torch.Tensor,
    state_vec: torch.Tensor,
) -> torch.Tensor:
    """
    Apply the transition operator to a state vector: |Ψ_{t+1}⟩ = H |Ψ_t⟩.

    Parameters
    ----------
    H : Tensor[d, d]
        Transition operator.
    state_vec : Tensor[d] or Tensor[d, 1]
        State vector in the bond dimension space.

    Returns
    -------
    Tensor[d] or Tensor[d, 1]
        Evolved state vector.
    """
    if state_vec.dim() == 1:
        return H @ state_vec
    return H @ state_vec


def safety_zero_out(
    operator: torch.Tensor,
    row_indices: list[int],
    col_indices: list[int] | None = None,
) -> torch.Tensor:
    """
    Enforce a hard safety boundary by zeroing specific operator entries.

    From the paper: "if an output violates a safety boundary, the matrix
    multiplication equals zero. The mathematical path to generate it no
    longer exists."

    This is the tensor-algebraic equivalent of severing a dialogue branch.
    The operator returned is a modified copy — the original is not mutated.

    Parameters
    ----------
    operator : Tensor[d, d]
        Transition operator or core tensor matrix slice.
    row_indices : list[int]
        Row indices to zero out (physical/semantic vocabulary indices).
    col_indices : list[int], optional
        Column indices to zero out. If None, zeros the entire rows.

    Returns
    -------
    Tensor[d, d]
        New operator with specified entries set to exactly 0+0j.
    """
    out = operator.clone()
    if col_indices is None:
        out[row_indices, :] = 0.0
    else:
        for r in row_indices:
            for c in col_indices:
                out[r, c] = 0.0
    return out


# ── Diagnostics ────────────────────────────────────────────────────────────────

def physiological_norm(
    H: torch.Tensor,
    physio_slice: slice,
) -> float:
    """
    Compute the Frobenius norm of the physiological block of a transition
    operator. Used to verify that the decay is happening as expected.

    A value close to the initial norm → stress persisting (small γ).
    A value close to 0 → stress has decayed (large γ or many turns).
    """
    block = H[physio_slice, physio_slice]
    return float(torch.linalg.norm(block, ord="fro").real)


def spectral_gap(H: torch.Tensor) -> float:
    """
    Compute the spectral gap |λ₀| − |λ₁| of the operator.

    The spectral gap controls the speed of decay. A large gap means the
    excited (stressed) state decays quickly. A small gap means hysteresis
    is long-lasting.

    Uses torch.linalg.eigvals (returns all eigenvalues, not just Hermitian).
    """
    eigenvalues = torch.linalg.eigvals(H)
    magnitudes  = eigenvalues.abs().sort(descending=True).values
    if magnitudes.numel() < 2:
        return 0.0
    return float((magnitudes[0] - magnitudes[1]).item())


# ── Internal helpers ───────────────────────────────────────────────────────────

def _make_psd(M: torch.Tensor, floor: float = 1e-9) -> torch.Tensor:
    """
    Project a symmetric matrix onto the positive-semidefinite cone by
    clamping any negative eigenvalues to `floor`.
    """
    M_sym = (M + M.conj().T) / 2.0
    eigenvalues, eigenvectors = torch.linalg.eigh(M_sym.real.double())
    eigenvalues = eigenvalues.clamp(min=floor)
    return (eigenvectors @ torch.diag(eigenvalues) @ eigenvectors.T).to(M.dtype)
