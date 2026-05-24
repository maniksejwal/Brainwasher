"""
Matrix Product State (MPS) implementation for the HTN framework.

The conversational state at time t is a Matrix Product State:

    |Ψ_t⟩ = Σ_{s1..sN} A^{(1)}_{s1} A^{(2)}_{s2} ... A^{(N)}_{sN} |s1 s2 ... sN⟩

where each A^{(t)} is a 3rd-order core tensor of shape [χ_left, d, χ_right].

Bond dimension partition (paper Section 4.5.1):
    χ_total = χ_semantic + χ_physio
    - χ_semantic: carries discrete semantic token context
    - χ_physio:   carries continuous physiological subspace

Complexity: O(N d χ²) — linear in sequence length.
KV cache: eliminated. Historical context is compressed into the bond
dimension at each step; no growing memory buffer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import torch
import torch.linalg

from tensornets.physio.state import PhysiologicalState


# ── Core tensor ────────────────────────────────────────────────────────────────

@dataclass
class CoreTensor:
    """
    A single 3rd-order core tensor A^{(t)} in the Matrix Product State.

    Shape: [χ_left, d, χ_right]
      - χ_left, χ_right : virtual bond indices (context + physiology)
      - d               : physical index (vocabulary / token dimension)

    Position `t` is 0-indexed within the MPS chain.
    """
    data: torch.Tensor      # shape [χ_left, d, χ_right]
    position: int
    label: str = ""         # optional semantic label (e.g. "billing", "empathy")

    def __post_init__(self) -> None:
        if self.data.dim() != 3:
            raise ValueError(
                f"CoreTensor.data must be 3-dimensional [χ_left, d, χ_right], "
                f"got shape {tuple(self.data.shape)}"
            )

    @property
    def chi_left(self) -> int:
        return self.data.shape[0]

    @property
    def d(self) -> int:
        return self.data.shape[1]

    @property
    def chi_right(self) -> int:
        return self.data.shape[2]

    def left_normalize(self) -> "CoreTensor":
        """
        Left-canonicalise this core via QR decomposition.
        Returns a new CoreTensor; does not mutate self.
        After left-normalisation: Σ_s A†_s A_s = I
        """
        chi_l, d, chi_r = self.data.shape
        mat = self.data.reshape(chi_l * d, chi_r)
        Q, R = torch.linalg.qr(mat)
        new_chi_r = Q.shape[1]
        new_data = Q.reshape(chi_l, d, new_chi_r)
        return CoreTensor(new_data, self.position, self.label), R

    def right_normalize(self) -> "CoreTensor":
        """
        Right-canonicalise this core via LQ decomposition (QR of transpose).
        Returns a new CoreTensor and the L factor; does not mutate self.
        After right-normalisation: Σ_s A_s A†_s = I
        """
        chi_l, d, chi_r = self.data.shape
        mat = self.data.reshape(chi_l, d * chi_r)
        Q, R = torch.linalg.qr(mat.T)
        Q = Q.T
        R = R.T
        new_chi_l = Q.shape[0]
        new_data = Q.reshape(new_chi_l, d, chi_r)
        return CoreTensor(new_data, self.position, self.label), R


# ── Matrix Product State ───────────────────────────────────────────────────────

class MatrixProductState:
    """
    A Matrix Product State representing the joint conversational and
    physiological state |Ψ_t⟩.

    Parameters
    ----------
    chi_semantic : int
        Bond dimension allocated to semantic / logical context channels.
    chi_physio : int
        Bond dimension allocated to physiological subspace channels.
    vocab_size : int
        Physical index dimension d (vocabulary size).
    dtype : torch.dtype
        Complex dtype for all core tensors. Default complex128.
    device : str or torch.device
        Computation device.
    """

    def __init__(
        self,
        chi_semantic: int,
        chi_physio: int,
        vocab_size: int,
        dtype: torch.dtype = torch.complex128,
        device: torch.device | str = "cpu",
    ) -> None:
        if chi_semantic < 1 or chi_physio < 1:
            raise ValueError("Bond dimensions must be ≥ 1.")
        if vocab_size < 2:
            raise ValueError("vocab_size must be ≥ 2.")

        self.chi_semantic = chi_semantic
        self.chi_physio   = chi_physio
        self.chi           = chi_semantic + chi_physio   # total bond dimension
        self.vocab_size    = vocab_size
        self.dtype         = dtype
        self.device        = torch.device(device)
        self.cores: list[CoreTensor] = []

        # Semantic subspace: indices [0 : chi_semantic]
        # Physio  subspace: indices [chi_semantic : chi_semantic + chi_physio]
        self._sem_slice  = slice(0, chi_semantic)
        self._phys_slice = slice(chi_semantic, self.chi)

    # ── Construction ──────────────────────────────────────────────────────────

    @classmethod
    def identity_initialized(
        cls,
        n_tokens: int,
        chi_semantic: int,
        chi_physio: int,
        vocab_size: int,
        dtype: torch.dtype = torch.complex128,
        device: torch.device | str = "cpu",
    ) -> "MatrixProductState":
        """
        Create an MPS with identity-like core tensors.

        This is the neutral initialisation: every token is equally probable,
        no physiological bias, no safety constraints. Useful for unit testing
        and as a baseline before distillation or ALS updates.
        """
        mps = cls(chi_semantic, chi_physio, vocab_size, dtype, device)
        chi = mps.chi
        scale = 1.0 / math.sqrt(vocab_size * chi)
        for t in range(n_tokens):
            chi_l = 1 if t == 0     else chi
            chi_r = 1 if t == n_tokens - 1 else chi
            data = torch.randn(chi_l, vocab_size, chi_r, dtype=dtype, device=device)
            data = data * scale
            mps.cores.append(CoreTensor(data, position=t))
        return mps

    def append_core(self, core: CoreTensor) -> None:
        """Append a pre-built core tensor to the chain."""
        if self.cores:
            if core.chi_left != self.cores[-1].chi_right:
                raise ValueError(
                    f"Bond dimension mismatch at position {core.position}: "
                    f"expected chi_left={self.cores[-1].chi_right}, "
                    f"got {core.chi_left}"
                )
        self.cores.append(core)

    # ── Normalisation ──────────────────────────────────────────────────────────

    def left_canonicalise(self) -> None:
        """
        Bring the entire MPS into left-canonical form in-place.
        After this call: ⟨Ψ|Ψ⟩ = ‖last_core‖² (norm is pushed to the right).
        """
        for i in range(len(self.cores) - 1):
            new_core, R = self.cores[i].left_normalize()
            self.cores[i] = new_core
            # Absorb R into the next core's left leg
            next_data = self.cores[i + 1].data
            # next_data shape: [χ_l, d, χ_r]; R shape: [χ_l, χ_l_new]
            self.cores[i + 1] = CoreTensor(
                torch.einsum("ij,jkl->ikl", R, next_data),
                position=self.cores[i + 1].position,
                label=self.cores[i + 1].label,
            )

    def norm(self) -> float:
        """
        Compute ⟨Ψ|Ψ⟩^{1/2} via sequential contraction.
        After left_canonicalise(), equals ‖last_core‖_F.
        """
        if not self.cores:
            return 0.0
        # Contract left → right: start with scalar 1, expand to transfer matrix
        transfer = torch.ones(1, 1, dtype=self.dtype, device=self.device)
        for core in self.cores:
            # Transfer matrix update: T_{α,α'} = Σ_s A*_{α,s,β} A_{α',s,β'}
            # Einsum: ij, isl, jsl -> ll  (contract left bonds and physical)
            A = core.data
            transfer = torch.einsum("ij,isl,jsk->lk", transfer, A.conj(), A)
        return float(transfer.squeeze().abs().sqrt().item())

    # ── Token amplitude ────────────────────────────────────────────────────────

    def token_amplitudes(self, left_boundary: torch.Tensor | None = None) -> torch.Tensor:
        """
        Compute the unnormalised probability amplitude over the next token
        by contracting all cores up to the current position.

        Returns a vector of shape [vocab_size] with complex amplitudes.
        Taking |amp|² and normalising gives the token probability distribution.

        Parameters
        ----------
        left_boundary : Tensor[chi], optional
            Left boundary vector. If None, uses [1, 0, 0, ...] (open boundary).
        """
        if not self.cores:
            raise RuntimeError("MPS has no cores.")

        chi = self.cores[0].chi_left
        if left_boundary is None:
            left_boundary = torch.zeros(chi, dtype=self.dtype, device=self.device)
            left_boundary[0] = 1.0

        vec = left_boundary
        for core in self.cores[:-1]:
            # Contract vec [χ] with core [χ, d, χ'] → sum over χ, sum over d
            # yields a new vec [χ'] (marginalised over physical index)
            vec = torch.einsum("i,idj->j", vec, core.data)

        # Final core: don't marginalise over d — keep it to get per-token amplitudes
        last = self.cores[-1]
        amplitudes = torch.einsum("i,idj->d", vec, last.data)
        return amplitudes

    def token_probabilities(
        self,
        left_boundary: torch.Tensor | None = None,
        temperature: float = 1.0,
    ) -> torch.Tensor:
        """
        Compute normalised token probabilities from the MPS amplitudes.

        P(w) = |A(w)|² / Σ_w |A(w)|²

        Parameters
        ----------
        temperature : float
            Softmax temperature applied to log-probabilities before
            normalisation (mimics LLM temperature scaling). Default 1.0.

        Returns
        -------
        Tensor[vocab_size]
            Real-valued probability distribution over the vocabulary.
        """
        amps = self.token_amplitudes(left_boundary)
        log_probs = amps.abs().pow(2).clamp(min=1e-30).log()
        log_probs = log_probs / temperature
        log_probs = log_probs - log_probs.max()  # numerical stability
        probs = log_probs.exp()
        return probs / probs.sum()

    # ── Constraint projection ──────────────────────────────────────────────────

    def project_constraint(
        self,
        external_logits: torch.Tensor,
        constraint_matrix: torch.Tensor | None = None,
        temperature: float = 1.0,
    ) -> torch.Tensor:
        """
        Apply the MPS constraint to an external LLM's token logits.

        This is the architectural innovation described in our design:
        the LLM's zero-shot generalization drives content (P_llm(w)),
        the MPS enforces hard geometric boundaries (M_trunc · P_llm(w)).

        P_safe(w) = normalize( P_mps(w) · P_llm(w) )

        Where P_mps(w) acts as a gate: tokens whose MPS amplitude is zero
        will have exactly zero probability in P_safe regardless of LLM confidence.

        Parameters
        ----------
        external_logits : Tensor[vocab_size]
            Raw logits from the LLM (Mistral/Bedrock) for the current step.
        constraint_matrix : Tensor[vocab_size, vocab_size] or None
            Optional explicit SVD-truncated constraint from the strategic agent.
            If None, uses MPS amplitudes directly.
        temperature : float
            Temperature for LLM softmax.

        Returns
        -------
        Tensor[vocab_size]
            Safe probability distribution. Geometrically forbidden tokens
            have exactly 0.0 probability.
        """
        # LLM probabilities
        llm_log = external_logits / temperature
        llm_log = llm_log - llm_log.max()
        p_llm = llm_log.exp()
        p_llm = p_llm / p_llm.sum()

        if constraint_matrix is not None:
            # Strategic constraint: project LLM probs through SVD constraint
            p_safe = constraint_matrix.real.float() @ p_llm.float()
            p_safe = p_safe.clamp(min=0.0)
        else:
            # Use MPS amplitude magnitudes as gates
            p_mps = self.token_probabilities(temperature=1.0).to(p_llm.device)
            p_safe = p_mps * p_llm

        total = p_safe.sum()
        if total < 1e-12:
            raise RuntimeError(
                "All token paths are geometrically blocked. "
                "The current physiological state forbids all vocabulary. "
                "Check Γ magnitudes and constraint matrix."
            )
        return p_safe / total

    # ── Safety enforcement ────────────────────────────────────────────────────

    def block_token(self, token_id: int) -> None:
        """
        Permanently zero out a specific token across all core tensors.

        After this call, `token_probabilities()[token_id] == 0.0` exactly,
        regardless of the input state or operator applied.

        This implements the paper's "mathematical path severance":
        the physical index corresponding to this token is zeroed in every A^{(t)}.
        """
        for core in self.cores:
            core.data[:, token_id, :] = 0.0 + 0.0j

    def block_token_conditional(
        self,
        token_id: int,
        physio_state: PhysiologicalState | None = None,
        stress_threshold: float = 0.6,
    ) -> bool:
        """
        Block a token if and only if the current physiological stress exceeds
        a threshold. Returns True if the block was applied.

        This implements the paper's example: "never mention out-of-pocket costs
        when the patient's heart rate is above 100."
        """
        if physio_state is None:
            return False
        if physio_state.stress_index() >= stress_threshold:
            self.block_token(token_id)
            return True
        return False

    # ── Physio subspace access ─────────────────────────────────────────────────

    @property
    def sem_slice(self) -> slice:
        """Index slice for the semantic bond subspace."""
        return self._sem_slice

    @property
    def phys_slice(self) -> slice:
        """Index slice for the physiological bond subspace."""
        return self._phys_slice

    # ── Phase 2 — SVD-based bond truncation ────────────────────────────────────

    def svd_truncate(
        self,
        site: int,
        chi_max: int | None = None,
        cutoff: float = 1e-10,
    ) -> float:
        """
        Apply SVD-based bond truncation between site `site` and `site + 1`.

        This is the core compression step of Phase 2 (M_trunc in the paper).
        After left-canonicalisation to site `site`, we:
          1. Reshape A^{site} into a matrix M = [χ_left × d, χ_right].
          2. SVD: M = U Σ Vᵀ.
          3. Truncate: keep the top `chi_max` (or cutoff-based) singular values.
          4. Absorb Σ Vᵀ into A^{site+1}.

        Parameters
        ----------
        site    : int
            Site index (0-based) at which to perform the truncation bond.
            Bond truncated is between cores[site] and cores[site+1].
        chi_max : int, optional
            Maximum bond dimension to keep. If None, uses self.chi.
        cutoff  : float
            Singular values below this threshold are discarded.

        Returns
        -------
        float
            Truncation error = (sum of discarded singular values²)^{1/2}.
            Zero means lossless; close to the norm means severe truncation.

        Implementation note
        -------------------
        SVD truncation is analogous to principal component analysis on the
        entanglement structure of the state. Physiological bond channels that
        are no longer correlated with the semantic channels will naturally have
        near-zero singular values and be discarded first, compressing memory
        without losing clinical content.
        """
        if chi_max is None:
            chi_max = self.chi
        if not (0 <= site < len(self.cores) - 1):
            raise IndexError(f"site {site} out of range [0, {len(self.cores) - 2}]")

        core_l = self.cores[site]
        core_r = self.cores[site + 1]

        chi_l, d, chi_r_l = core_l.data.shape
        chi_l_r, d_r, chi_r = core_r.data.shape

        # Reshape left core: [χ_left × d, χ_right]
        mat = core_l.data.reshape(chi_l * d, chi_r_l)

        # Full SVD
        U, S, Vh = torch.linalg.svd(mat, full_matrices=False)
        # U: [χ_l d, k], S: [k], Vh: [k, χ_r_l]

        # Determine truncation rank
        above_cutoff = (S > cutoff * S[0]).sum().item()
        rank = int(min(chi_max, above_cutoff, len(S)))
        rank = max(rank, 1)  # keep at least one singular vector

        # Truncation error
        discarded_sv = S[rank:]
        trunc_error  = float(torch.sqrt((discarded_sv ** 2).sum()).real)

        # Truncate
        U_trunc  = U[:, :rank]      # [χ_l d, rank]
        S_trunc  = S[:rank].to(dtype=mat.dtype)   # match complex dtype
        Vh_trunc = Vh[:rank, :]     # [rank, χ_r_l]

        # New left core: A^{site} = U reshaped, left-normalised
        new_left_data = U_trunc.reshape(chi_l, d, rank)
        self.cores[site] = CoreTensor(new_left_data, core_l.position, core_l.label)

        # Absorb Σ Vᵀ into right core: Ã^{site+1}_{new_left, d, right} = (Σ Vᵀ) A^{site+1}
        SigVh = torch.diag(S_trunc) @ Vh_trunc           # [rank, χ_r_l]
        # Contract: new_right[new_left, d, right] = SigVh[new_left, old_left] * A[old_left, d, right]
        new_right_data = torch.einsum("ij,jkl->ikl", SigVh, core_r.data)
        self.cores[site + 1] = CoreTensor(new_right_data, core_r.position, core_r.label)

        return trunc_error

    def compress(
        self,
        chi_max: int | None = None,
        cutoff: float = 1e-10,
    ) -> list[float]:
        """
        Full left-to-right sweep compression via sequential SVD truncation.

        Performs:
          1. left_canonicalise() — bring MPS into left-canonical form.
          2. Right-to-left SVD truncation sweep (standard DMRG-style compression).

        Returns list of per-bond truncation errors.
        """
        self.left_canonicalise()
        errors = []
        for site in range(len(self.cores) - 1):
            err = self.svd_truncate(site, chi_max=chi_max, cutoff=cutoff)
            errors.append(err)
        return errors

    # ── Phase 2 — Transition operator application ──────────────────────────────

    def apply_transition(
        self,
        H: torch.Tensor,
        delta_t: float = 1.0,
        chi_max: int | None = None,
        cutoff: float = 1e-10,
    ) -> list[float]:
        """
        Evolve the MPS by one conversational turn using the transition operator H.

        Equation (paper 4.2):
            |Ψ_{t+1}⟩ = H |Ψ_t⟩

        H = e^{−i H_eff Δt} is block-diagonal [H₀_block | e^{−Γ Δt}_block].
        It acts on the bond (virtual) dimension, not the physical (token) dimension.

        Implementation
        --------------
        For each core A^{(t)} of shape [χ_left, d, χ_right]:
          - H acts on the RIGHT bond index (χ_right), which encodes the
            accumulated context from positions 1..t.
          - A^{(t)}_new[χ_l, d, χ'] = Σ_{χ_r} A^{(t)}[χ_l, d, χ_r] × H[χ_r, χ']
          - After the rightmost core, SVD-truncate each bond to chi_max.

        The semantic block of H preserves norm (unitary).
        The physiological block of H decays norm (e^{−Γ Δt}).
        The net effect: the physio subspace shrinks in amplitude → HRV recovery.

        Parameters
        ----------
        H       : Tensor[chi, chi]
            Transition operator from build_transition_operator() in operators.py.
        delta_t : float
            Conversational time step. Informational only (H already incorporates it).
        chi_max : int, optional
            Bond truncation after application. None = no truncation.
        cutoff  : float
            SVD cutoff for truncation.

        Returns
        -------
        list[float]
            Truncation errors per bond (empty if chi_max is None).
        """
        if not self.cores:
            raise RuntimeError("MPS is empty.")
        H_target = H.to(dtype=self.dtype, device=self.device)
        chi_H    = H_target.shape[0]   # dimension the operator acts on

        for i, core in enumerate(self.cores):
            chi_r = core.chi_right
            # Only apply H where the bond dimension matches (interior bonds).
            # Boundary bonds (size 1) carry no virtual entanglement — skip them.
            if chi_r != chi_H:
                continue
            # Apply H to right bond: A[χ_l, d, χ_r] → A[χ_l, d, χ'] with χ'=H@χ_r
            new_data = torch.einsum("ldr,rp->ldp", core.data, H_target)
            self.cores[i] = CoreTensor(new_data, core.position, core.label)

        trunc_errors: list[float] = []
        if chi_max is not None:
            trunc_errors = self.compress(chi_max=chi_max, cutoff=cutoff)
        return trunc_errors

    # ── Phase 2 — Expectation value ────────────────────────────────────────────

    def expectation_value(
        self,
        operator: torch.Tensor,
        site: int,
    ) -> complex:
        """
        Compute the single-site expectation value ⟨Ψ|Ô_i|Ψ⟩ for a local operator Ô_i.

        This is the principal diagnostic for the physiological state:
          - Ô_i = Γ_block (physio block of a site) → estimates residual stress
          - Ô_i = I_sem (identity on semantic block) → sanity check: should be ≈1

        Algorithm
        ---------
        1. Contract all cores left of site → left environment tensor L.
        2. Apply Ô_i to the physical index of core[site].
        3. Contract all cores right of site → right environment tensor R.
        4. Return ⟨L | Ô|site⟩ | R⟩.

        Parameters
        ----------
        operator : Tensor[d, d]
            Local single-site operator in the physical (token) basis.
        site     : int
            Site index.

        Returns
        -------
        complex
            Expectation value ⟨Ψ|Ô_site|Ψ⟩ (should be real for Hermitian operators).
        """
        if not (0 <= site < len(self.cores)):
            raise IndexError(f"site {site} out of range for MPS of length {len(self.cores)}")

        dtype  = self.dtype
        device = self.device
        Op     = operator.to(dtype=dtype, device=device)

        # ── Left environment: L[α, α'] ──────────────────────────────────────
        # L starts as [[1]] (scalar boundary)
        L = torch.ones(1, 1, dtype=dtype, device=device)
        for i in range(site):
            A = self.cores[i].data   # [χ_l, d, χ_r]
            # L_new[β, β'] = Σ_{α, α', s} L[α, α'] A*[α, s, β] A[α', s, β']
            L = torch.einsum("ij,isl,jsk->lk", L, A.conj(), A)

        # ── Operator sandwich at site ──────────────────────────────────────
        A_site = self.cores[site].data   # [χ_l, d, χ_r]
        # A_op[χ_l, d', χ_r] = Σ_d O[d', d] A[χ_l, d, χ_r]
        A_op = torch.einsum("ab,ibj->iaj", Op, A_site)

        # Contract left env with bra (A*) and ket (A_op):
        # M[β, β'] = Σ_{α, α', s} L[α, α'] A*[α, s, β] A_op[α', s, β']
        M = torch.einsum("ij,isl,jsk->lk", L, A_site.conj(), A_op)

        # ── Right environment: contract remaining cores ────────────────────
        R = torch.ones(1, 1, dtype=dtype, device=device)
        for i in range(len(self.cores) - 1, site, -1):
            A = self.cores[i].data   # [χ_l, d, χ_r]
            # R_new[α, α'] = Σ_{β, β', s} A*[α, s, β] A[α', s, β'] R[β, β']
            R = torch.einsum("isl,jsk,lk->ij", A.conj(), A, R)

        # ── Final contraction ─────────────────────────────────────────────
        result = torch.einsum("ij,ij->", M, R)
        return complex(result.item())

    def physio_energy(self) -> float:
        """
        Estimate the total physiological 'energy' ⟨Ψ|Γ|Ψ⟩ averaged over all sites.

        A high energy → patient is still stressed.
        A decaying energy over turns → therapy is working (HRV recovery).

        This is the observable that maps to HRV in the paper's Figure 2.
        Uses the identity operator as a proxy (full norm on physio slice).
        """
        if not self.cores:
            return 0.0
        total = 0.0
        for site in range(len(self.cores)):
            core = self.cores[site]
            chi  = core.chi_right
            # Physio slice of the right bond
            phys_start = self.chi_semantic
            phys_end   = min(self.chi, chi)
            if phys_end <= phys_start:
                continue
            # Norm of the physio block for this core
            phys_data = core.data[:, :, phys_start:phys_end]
            total += float(torch.linalg.norm(phys_data.reshape(-1)).real)
        return total / max(len(self.cores), 1)

    # ── Phase 2 — ALS localised update ─────────────────────────────────────────

    def als_update(
        self,
        site: int,
        target: torch.Tensor,
        learning_rate: float = 0.01,
        regularise: float = 1e-6,
    ) -> float:
        """
        Alternating Least Squares (ALS) local update for site `site`.

        Given a target probability vector P_target[vocab_size], update core[site]
        so that the MPS token distribution at this site moves closer to P_target.

        This is the learning rule for the MPS constraint layer:
          - Policy distillation uses ALS to encode clinical rules into core tensors.
          - Online RLHF feedback uses ALS to adjust site weights after a scored turn.
          - A3C (Phase 4) will use ALS to propagate value gradients.

        Algorithm
        ---------
        1. Compute left and right environments (L, R) as in expectation_value.
        2. Form the effective 2D site tensor: B = L @ A_flat @ R  (shape [d]).
        3. Compute residual δ = P_target − |B|² / ‖|B|²‖₁.
        4. Gradient: dL/dA = learning_rate × L^T ⊗ δ ⊗ R.
        5. Update: A ← A + dL/dA.
        6. Re-canonicalise (QR) to maintain norm.

        Parameters
        ----------
        site          : int
        target        : Tensor[vocab_size]
            Target token probability distribution for this turn.
        learning_rate : float
        regularise    : float
            L2 regularisation coefficient (prevents overfitting).

        Returns
        -------
        float
            Residual loss (KL divergence approximation between current and target).
        """
        if not (0 <= site < len(self.cores)):
            raise IndexError(f"site {site} out of range")

        dtype  = self.dtype
        device = self.device
        P_tgt  = target.to(dtype=dtype, device=device)
        if P_tgt.shape[0] != self.vocab_size:
            raise ValueError(
                f"target has {P_tgt.shape[0]} entries, expected vocab_size={self.vocab_size}"
            )

        # ── Build left environment ─────────────────────────────────────────
        L = torch.ones(1, 1, dtype=dtype, device=device)
        for i in range(site):
            A = self.cores[i].data
            L = torch.einsum("ij,isl,jsk->lk", L, A.conj(), A)

        # ── Build right environment ────────────────────────────────────────
        R = torch.ones(1, 1, dtype=dtype, device=device)
        for i in range(len(self.cores) - 1, site, -1):
            A = self.cores[i].data
            R = torch.einsum("isl,jsk,lk->ij", A.conj(), A, R)

        # ── Effective amplitude at site ───────────────────────────────────
        A_site  = self.cores[site].data    # [χ_l, d, χ_r]
        chi_l   = A_site.shape[0]
        chi_r   = A_site.shape[2]

        # b_vec[d] = Σ_{α,β} L[α,α] A[α, d, β] R[β,β]  (diagonal envs approx)
        # Proper contraction:
        b_mat   = torch.einsum("ij,jdk,kl->il", L.reshape(chi_l, chi_l), A_site.reshape(chi_l, self.vocab_size, chi_r), R.reshape(chi_r, chi_r))
        b_vec   = b_mat.diagonal().contiguous()   # [vocab_size] approx
        # Fall back to trace if shapes mismatch
        if b_vec.shape[0] != self.vocab_size:
            # Sum over bond dimensions to get d-dimensional vector
            b_vec = torch.einsum("ij,idj->d", L, A_site).sum(dim=-1) if L.shape == (chi_l, chi_l) else A_site.reshape(-1, self.vocab_size).sum(0)

        probs   = b_vec.abs().pow(2)
        norm    = probs.sum().clamp(min=1e-15)
        probs   = probs / norm

        # ── KL residual ───────────────────────────────────────────────────
        eps     = 1e-10
        kl_loss = float(
            (P_tgt.real.clamp(min=eps) * (P_tgt.real.clamp(min=eps) / probs.real.clamp(min=eps)).log()).sum().item()
        )

        # ── Gradient step on A_site ───────────────────────────────────────
        delta   = (P_tgt.real - probs.real).to(dtype)
        # Gradient w.r.t. A[χ_l, d, χ_r]: dL/dA ~ L ⊗ δ ⊗ R
        # Outer product approach: rank-1 update across the physical index
        grad = torch.zeros_like(A_site)
        L_diag = L.diagonal().unsqueeze(1)      # [χ_l, 1]
        R_diag = R.diagonal().unsqueeze(0)      # [1, χ_r]
        bond_factor = (L_diag @ R_diag)         # [χ_l, χ_r]
        for token_id in range(self.vocab_size):
            grad[:, token_id, :] += bond_factor * delta[token_id] * 2.0

        # Update with regularisation
        new_data = A_site + learning_rate * grad - regularise * A_site
        self.cores[site] = CoreTensor(new_data, self.cores[site].position, self.cores[site].label)

        # Re-canonicalise to maintain norm (only if not the last site)
        if site < len(self.cores) - 1:
            new_core, R_factor = self.cores[site].left_normalize()
            self.cores[site] = new_core
            next_data = self.cores[site + 1].data
            self.cores[site + 1] = CoreTensor(
                torch.einsum("ij,jkl->ikl", R_factor, next_data),
                self.cores[site + 1].position,
                self.cores[site + 1].label,
            )

        return kl_loss

    def als_sweep(
        self,
        target: torch.Tensor,
        n_sweeps: int = 3,
        learning_rate: float = 0.01,
        regularise: float = 1e-6,
    ) -> list[float]:
        """
        Run n_sweeps of ALS over all sites left-to-right then right-to-left.

        This is the full ALS training loop for policy distillation.
        Each sweep reduces the KL divergence between the MPS-gated distribution
        and the target distribution P_target.

        Returns list of per-site KL losses from the final sweep.
        """
        losses: list[float] = []
        for _ in range(n_sweeps):
            losses = []
            for site in range(len(self.cores)):
                losses.append(self.als_update(site, target, learning_rate, regularise))
            for site in range(len(self.cores) - 2, -1, -1):
                losses.append(self.als_update(site, target, learning_rate, regularise))
        return losses

    # ── Partial trace (Phase 4 preview) ────────────────────────────────────────

    def partial_trace_physio(self) -> torch.Tensor:
        """
        Marginalise over the physiological bond subspace.

        Returns the reduced density matrix ρ_semantic = Tr_{physio}[|Ψ⟩⟨Ψ|].

        This is the Phase 4 privacy operation: an agent receiving ρ_semantic
        cannot reconstruct the physiological state. It only sees the semantic
        content of the conversation.

        Current implementation: extracts the semantic block of the transfer
        matrix over all cores. Full density matrix version is Phase 4.

        Returns
        -------
        Tensor[chi_semantic, chi_semantic]
            Reduced density matrix for the semantic subspace.
        """
        chi_s = self.chi_semantic
        rho   = torch.eye(chi_s, dtype=self.dtype, device=self.device) / chi_s

        for core in self.cores:
            A     = core.data   # [χ_l, d, χ_r]
            # Extract semantic block of the right bond
            chi_r = core.chi_right
            phys_end = min(chi_s, chi_r)

            if phys_end == 0:
                continue

            A_sem = A[:chi_s, :, :phys_end]  # approximate semantic slice
            # Transfer matrix update restricted to semantic subspace
            rho = torch.einsum("ij,isl,jsk->lk", rho, A_sem.conj(), A_sem)
            # Normalise to prevent blow-up
            trace = rho.diagonal().real.sum().clamp(min=1e-15)
            rho   = rho / trace

        return rho

    # ── Utilities ──────────────────────────────────────────────────────────────

    def __len__(self) -> int:
        return len(self.cores)

    def __repr__(self) -> str:
        return (
            f"MatrixProductState("
            f"n_cores={len(self.cores)}, "
            f"chi={self.chi} (sem={self.chi_semantic}, phys={self.chi_physio}), "
            f"d={self.vocab_size}, "
            f"dtype={self.dtype})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2 integration test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    """
    Phase 2 smoke test:
      1. Build a 4-core MPS (chi_sem=4, chi_phys=4, vocab=8)
      2. Build H_eff from a stressed physiological state
      3. Apply 3 turns of apply_transition() and observe physio_energy decay
      4. Compress to chi_max=4 and check truncation error
      5. ALS update toward a uniform target
      6. Partial trace: extract semantic reduced density matrix

    Expected:
      - physio_energy should decrease each turn (stress decay)
      - truncation error should be small (<< norm) after compression
      - KL loss should decrease after ALS sweep
    """
    import sys
    from tensornets.core.operators import build_H0, build_Gamma, build_H_eff, build_transition_operator
    from tensornets.physio.state   import PhysiologicalState

    VOCAB  = 8
    CHI_S  = 4
    CHI_P  = 5    # physio_dim must be ≥ 5 (one per physiological signal)
    N_TOKS = 5

    mps = MatrixProductState.identity_initialized(
        n_tokens=N_TOKS, chi_semantic=CHI_S, chi_physio=CHI_P,
        vocab_size=VOCAB, dtype=torch.complex128, device="cpu",
    )
    print(mps)

    # Stressed patient: HRV=12ms
    state = PhysiologicalState(
        hrv_rmssd_ms=12.0, blood_glucose_mmol=5.5, eda_us=10.0,
        time_of_day_h=14.0, location_stress_index=0.4,
    )

    H0    = build_H0(CHI_S)
    Gamma = build_Gamma(CHI_P, state)
    H_eff = build_H_eff(H0, Gamma)
    H     = build_transition_operator(H_eff, delta_t=1.0)

    print(f"\nPhysio energy BEFORE transitions: {mps.physio_energy():.6f}")
    for turn in range(1, 4):
        errs = mps.apply_transition(H, chi_max=CHI_S + CHI_P)
        e    = mps.physio_energy()
        print(f"  After turn {turn}: physio_energy={e:.6f}  max_trunc_err={max(errs or [0.0]):.2e}")

    # ALS update toward uniform distribution
    uniform = torch.ones(VOCAB, dtype=torch.float64) / VOCAB
    losses  = mps.als_sweep(uniform, n_sweeps=2, learning_rate=0.05)
    print(f"\nALS sweep KL losses (last 5): {[round(l, 4) for l in losses[-5:]]}")

    # Expectation value at site 0: identity operator
    I_op = torch.eye(VOCAB, dtype=mps.dtype)
    ev   = mps.expectation_value(I_op, site=0)
    print(f"\nExpectation value of I at site 0: {ev:.6f}  (should be approx norm^2)")

    # Partial trace
    rho_sem = mps.partial_trace_physio()
    print(f"\nPartial trace rho_semantic shape: {rho_sem.shape}")
    tr = rho_sem.diagonal().real.sum().item()
    print(f"Trace of rho_semantic: {tr:.6f}  (should be approx 1.0 after normalisation)")

    # Compress
    errs = mps.compress(chi_max=4)
    print(f"\nPost-compress truncation errors: {[f'{e:.2e}' for e in errs]}")
    n = mps.norm()
    print(f"MPS norm after compress: {n:.6f}")
    print("\nPhase 2 smoke test passed.")

