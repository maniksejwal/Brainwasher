"""
Tests for tensornets.core.operators and tensornets.core.mps.

Run with: pytest tests/test_core.py -v
"""

import math
import pytest
import torch

from tensornets.physio.state import PhysiologicalState
from tensornets.core.operators import (
    build_H0,
    build_Gamma,
    build_H_eff,
    build_transition_operator,
    apply_operator_to_vector,
    safety_zero_out,
    physiological_norm,
    spectral_gap,
)
from tensornets.core.mps import MatrixProductState, CoreTensor
from datetime import datetime


# ── Fixtures ───────────────────────────────────────────────────────────────────

def stressed_state():
    return PhysiologicalState(
        hrv_rmssd_ms=10.0,
        blood_glucose_mmol=5.5,
        eda_us=12.0,
        time_of_day_h=14.0,
        location_stress_index=0.8,
        timestamp=datetime(2026, 5, 23, 14, 0, 0),
        is_simulated=True,
    )


def calm_state():
    return PhysiologicalState(
        hrv_rmssd_ms=75.0,
        blood_glucose_mmol=5.5,
        eda_us=0.5,
        time_of_day_h=10.0,
        location_stress_index=0.05,
        timestamp=datetime(2026, 5, 23, 10, 0, 0),
        is_simulated=True,
    )


# ── Operator tests ─────────────────────────────────────────────────────────────

class TestBuildH0:

    def test_shape(self):
        H0 = build_H0(16)
        assert H0.shape == (16, 16)

    def test_hermitian(self):
        H0 = build_H0(32)
        diff = (H0 - H0.conj().T).abs().max()
        assert diff < 1e-12, f"H0 not Hermitian: max diff = {diff}"

    def test_dtype_complex(self):
        H0 = build_H0(8)
        assert H0.is_complex()


class TestBuildGamma:

    def test_shape(self):
        Gamma = build_Gamma(8, stressed_state())
        assert Gamma.shape == (8, 8)

    def test_positive_semidefinite(self):
        Gamma = build_Gamma(8, calm_state())
        eigenvalues = torch.linalg.eigvalsh(Gamma.real.double())
        assert (eigenvalues >= -1e-9).all(), f"Gamma not PSD: min eigenvalue = {eigenvalues.min()}"

    def test_stressed_gamma_is_smaller(self):
        """
        Stressed state has lower γ → smaller Γ entries (slower, harder decay).
        Calm state has higher γ → larger Γ entries (faster, easier decay).
        This is correct: Γ represents the dissipation rate, not the stress level.
        """
        G_stressed = build_Gamma(8, stressed_state())
        G_calm     = build_Gamma(8, calm_state())
        norm_stressed = float(torch.linalg.norm(G_stressed, ord="fro").real)
        norm_calm     = float(torch.linalg.norm(G_calm, ord="fro").real)
        assert norm_calm > norm_stressed, (
            f"Expected calm Γ norm ({norm_calm:.4f}) > stressed ({norm_stressed:.4f}). "
            "Higher γ (calm) → faster decay → larger Γ."
        )

    def test_physio_dim_too_small_raises(self):
        with pytest.raises(ValueError, match="physio_dim"):
            build_Gamma(3, calm_state())


class TestBuildHeff:

    def test_shape(self):
        H0    = build_H0(16)
        Gamma = build_Gamma(8, calm_state())
        H_eff = build_H_eff(H0, Gamma)
        assert H_eff.shape == (24, 24)

    def test_block_diagonal_structure(self):
        """Cross-subspace blocks should be zero."""
        H0    = build_H0(16)
        Gamma = build_Gamma(8, calm_state())
        H_eff = build_H_eff(H0, Gamma)
        # Upper-right block (semantic → physio)
        off_block = H_eff[:16, 16:]
        assert off_block.abs().max() < 1e-12
        # Lower-left block (physio → semantic)
        off_block2 = H_eff[16:, :16]
        assert off_block2.abs().max() < 1e-12

    def test_physio_block_has_imaginary_component(self):
        """−iΓ should introduce imaginary entries in the physio block."""
        H0    = build_H0(16)
        Gamma = build_Gamma(8, stressed_state())
        H_eff = build_H_eff(H0, Gamma)
        physio_block = H_eff[16:, 16:]
        assert physio_block.imag.abs().max() > 1e-6


class TestTransitionOperator:

    def test_semantic_block_is_near_unitary(self):
        """
        The semantic block of H should be approximately unitary
        (norm-preserving), since H₀ is Hermitian.
        """
        H0    = build_H0(8)
        Gamma = build_Gamma(8, calm_state())
        H_eff = build_H_eff(H0, Gamma)
        H     = build_transition_operator(H_eff, delta_t=1.0)

        sem = H[:8, :8]
        identity_approx = sem @ sem.conj().T
        diff = (identity_approx - torch.eye(8, dtype=H.dtype)).abs().max()
        assert diff < 0.01, f"Semantic block not near-unitary: max diff = {diff}"

    def test_physio_block_decays(self):
        """
        Repeated application of H should reduce the norm of a physiological
        state vector — the hallmark of the non-Hermitian dissipation.
        """
        H0    = build_H0(8)
        Gamma = build_Gamma(8, stressed_state())
        H_eff = build_H_eff(H0, Gamma)
        H     = build_transition_operator(H_eff, delta_t=1.0)

        physio_H = H[8:, 8:]
        vec = torch.ones(8, dtype=H.dtype) / math.sqrt(8)

        norms = [float(vec.norm().real)]
        for _ in range(20):
            vec = physio_H @ vec
            norms.append(float(vec.norm().real))

        assert norms[-1] < norms[0], (
            f"Physio norm should decay: initial={norms[0]:.4f}, final={norms[-1]:.4f}"
        )

    def test_calm_decays_faster_than_stressed(self):
        """
        A calm patient (high γ) should have a smaller physio norm after
        10 steps than a stressed patient (low γ).
        """
        H0 = build_H0(8)
        vec = torch.ones(8, dtype=torch.complex128) / math.sqrt(8)

        for state, label in [(calm_state(), "calm"), (stressed_state(), "stressed")]:
            Gamma = build_Gamma(8, state)
            H_eff = build_H_eff(H0, Gamma)
            H     = build_transition_operator(H_eff, delta_t=1.0)
            physio_H = H[8:, 8:]
            v = vec.clone()
            for _ in range(10):
                v = physio_H @ v
            if label == "calm":
                calm_norm = float(v.norm().real)
            else:
                stressed_norm = float(v.norm().real)

        assert calm_norm < stressed_norm, (
            f"Calm should decay more: calm_norm={calm_norm:.4f}, "
            f"stressed_norm={stressed_norm:.4f}"
        )

    def test_hermitian_case_conserves_norm(self):
        """With Γ = 0 (pure Hermitian), the full norm should be conserved."""
        H0    = build_H0(16)
        Gamma = torch.zeros(16, 16, dtype=torch.complex128)
        H_eff = build_H_eff(H0, Gamma)
        H     = build_transition_operator(H_eff, delta_t=1.0)

        vec  = torch.randn(32, dtype=torch.complex128)
        vec /= vec.norm()
        vec2 = H @ vec
        assert vec2.norm().real == pytest.approx(1.0, abs=1e-6)

    def test_safety_zero_out(self):
        H  = torch.ones(8, 8, dtype=torch.complex128)
        H2 = safety_zero_out(H, row_indices=[2, 5])
        assert H2[2, :].abs().max() == 0.0
        assert H2[5, :].abs().max() == 0.0
        assert H2[0, 0].abs() == pytest.approx(1.0)

    def test_safety_zero_out_does_not_mutate(self):
        H  = torch.ones(8, 8, dtype=torch.complex128)
        _  = safety_zero_out(H, row_indices=[0])
        assert H[0, 0].abs() == pytest.approx(1.0)


# ── MPS tests ─────────────────────────────────────────────────────────────────

class TestCoreTensor:

    def test_shape_properties(self):
        data = torch.randn(4, 100, 8, dtype=torch.complex128)
        core = CoreTensor(data, position=0)
        assert core.chi_left == 4
        assert core.d == 100
        assert core.chi_right == 8

    def test_wrong_rank_raises(self):
        with pytest.raises(ValueError, match="3-dimensional"):
            CoreTensor(torch.randn(4, 8), position=0)

    def test_left_normalize_orthogonality(self):
        data = torch.randn(4, 16, 8, dtype=torch.complex128)
        core = CoreTensor(data, position=0)
        norm_core, R = core.left_normalize()

        # Verify: Σ_s A†_s A_s ≈ I
        chi_l, d, chi_r = norm_core.data.shape
        accum = torch.zeros(chi_r, chi_r, dtype=torch.complex128)
        for s in range(d):
            A_s = norm_core.data[:, s, :]  # [chi_l, chi_r]
            accum += A_s.conj().T @ A_s
        identity = torch.eye(chi_r, dtype=torch.complex128)
        diff = (accum - identity).abs().max()
        assert diff < 1e-10, f"Left-normalised core not orthogonal: max diff={diff}"


class TestMatrixProductState:

    def test_init_and_repr(self):
        mps = MatrixProductState(chi_semantic=8, chi_physio=4, vocab_size=100)
        assert mps.chi == 12
        assert "chi=12" in repr(mps)

    def test_identity_initialized_shape(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=5, chi_semantic=8, chi_physio=4, vocab_size=50
        )
        assert len(mps) == 5
        assert mps.cores[0].chi_left == 1       # open boundary
        assert mps.cores[-1].chi_right == 1     # open boundary
        assert mps.cores[2].chi_left == 12      # interior core

    def test_token_amplitudes_shape(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=3, chi_semantic=4, chi_physio=2, vocab_size=32
        )
        amps = mps.token_amplitudes()
        assert amps.shape == (32,)

    def test_token_probabilities_sum_to_one(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=3, chi_semantic=4, chi_physio=2, vocab_size=32
        )
        probs = mps.token_probabilities()
        assert probs.sum() == pytest.approx(1.0, abs=1e-6)
        assert (probs >= 0).all()

    def test_block_token_sets_probability_to_zero(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=50
        )
        token_id = 7
        mps.block_token(token_id)
        probs = mps.token_probabilities()
        assert probs[token_id].item() == pytest.approx(0.0, abs=1e-12), (
            f"Blocked token still has probability {probs[token_id].item()}"
        )

    def test_block_token_other_probabilities_unaffected(self):
        """Blocking one token should not zero out all others."""
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=50
        )
        mps.block_token(5)
        probs = mps.token_probabilities()
        assert probs.sum() > 0.0

    def test_block_token_conditional_high_stress(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=50
        )
        applied = mps.block_token_conditional(
            token_id=10,
            physio_state=stressed_state(),
            stress_threshold=0.5,
        )
        assert applied is True
        probs = mps.token_probabilities()
        assert probs[10].item() == pytest.approx(0.0, abs=1e-12)

    def test_block_token_conditional_low_stress_does_not_block(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=50
        )
        probs_before = mps.token_probabilities().clone()
        applied = mps.block_token_conditional(
            token_id=10,
            physio_state=calm_state(),
            stress_threshold=0.9,  # calm state's stress_index well below this
        )
        assert applied is False

    def test_sem_phys_slice_partition(self):
        mps = MatrixProductState(chi_semantic=8, chi_physio=4, vocab_size=32)
        sem_indices  = list(range(*mps.sem_slice.indices(mps.chi)))
        phys_indices = list(range(*mps.phys_slice.indices(mps.chi)))
        assert len(sem_indices) == 8
        assert len(phys_indices) == 4
        assert set(sem_indices).isdisjoint(set(phys_indices))
        assert sorted(sem_indices + phys_indices) == list(range(mps.chi))

    def test_bond_mismatch_raises(self):
        mps = MatrixProductState(chi_semantic=4, chi_physio=2, vocab_size=20)
        good_core = CoreTensor(torch.randn(1, 20, 6, dtype=torch.complex128), position=0)
        mps.append_core(good_core)
        bad_core  = CoreTensor(torch.randn(4, 20, 6, dtype=torch.complex128), position=1)
        with pytest.raises(ValueError, match="Bond dimension mismatch"):
            mps.append_core(bad_core)

    def test_project_constraint_all_probs_valid(self):
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=20
        )
        logits = torch.randn(20)
        p_safe = mps.project_constraint(logits)
        assert p_safe.shape == (20,)
        assert (p_safe >= 0).all()
        assert p_safe.sum() == pytest.approx(1.0, abs=1e-6)

    def test_project_constraint_blocked_token_stays_zero(self):
        """
        project_constraint with an explicit constraint_matrix that zeros out
        token 3 must give exactly 0 probability for that token, even when the
        LLM assigns it a higher logit than other tokens.
        """
        vocab = 20
        mps = MatrixProductState.identity_initialized(
            n_tokens=2, chi_semantic=4, chi_physio=2, vocab_size=vocab
        )
        # Build an explicit constraint matrix: identity with row 3 zeroed
        constraint = torch.eye(vocab, dtype=torch.complex128)
        constraint[3, :] = 0.0

        # Realistic logit spread: token 3 slightly preferred (not astronomically so)
        logits = torch.zeros(vocab)
        logits[3] = 2.0   # token 3 has highest logit
        logits[0] = 1.5
        logits[1] = 1.0

        p_safe = mps.project_constraint(logits, constraint_matrix=constraint)
        assert p_safe[3].item() == pytest.approx(0.0, abs=1e-12), (
            "Blocked token should have exactly 0 probability even with highest LLM logit"
        )
        assert p_safe.sum() == pytest.approx(1.0, abs=1e-6)
        assert p_safe[0].item() > 0.0  # other tokens still reachable
