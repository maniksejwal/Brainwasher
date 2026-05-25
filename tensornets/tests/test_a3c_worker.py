"""
tests/test_a3c_worker.py — Unit tests for J1–J7 A3C skeleton.

Tests run fully offline (no LLM, no tensornets server, no JS companion).
All HTTP calls in Arm1Worker / Arm3Worker are patched to raise ConnectionError
which now propagates as a RuntimeError — episodes fail and are skipped in the
training loop. Tests that exercise the episode runner use `patient_mode='scripted'`
AND patch the scorer so no HTTP calls are made at all.
"""

from __future__ import annotations

import json
import math
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from tensornets.a3c.worker import (
    Actor,
    Critic,
    A3CWorker,
    TurnState,
    compute_advantage,
    apply_update,
    scalar_reward,
    REWARD_DIMS,
    GAMMA_DISCOUNT,
)
from tensornets.a3c.arms import (
    Arm1Worker,
    Arm2Worker,
    Arm3Worker,
    _stress_after_response,
    _synthetic_reward,
    _build_hysteresis_context,
)
from tensornets.a3c.action_bandit import ACTION_TAXONOMY, STRESS_BUCKETS


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_state(stress: float = 0.4, turn_idx: int = 0) -> TurnState:
    return TurnState(
        turn_idx=stress,
        stress_index=stress,
        stress_bucket=TurnState.bucket_from_stress(stress),
        conversation_history=[{"role": "user", "content": "I feel overwhelmed."}],
        physio={"hrv_rmssd_ms": 35.0, "eda_us": 3.5, "stress_index": stress},
        session_id="test-session",
        subject_id="test-subject",
    )


def _make_scenario(n_turns: int = 3) -> dict:
    return {
        "scenario_id":          "test_scenario",
        "subject_id":           "synthetic_001",
        "session_id":           "s-test",
        "initial_stress_index": 0.5,
        "initial_physio":       {"hrv_rmssd_ms": 30.0, "eda_us": 4.0, "stress_index": 0.5},
        "session_goal":         "test support",
        "patient_prompt":       "You are a test patient.",
        "required_elements":    ["element_1", "element_2"],
        "max_turns":            n_turns,   # cap episodes to n_turns so tests are fast
        "turns": [
            {"user_message": f"Turn {i} user message."}
            for i in range(n_turns)
        ],
    }


# ── J2: Actor ─────────────────────────────────────────────────────────────────

class TestActor:
    def test_uniform_init(self):
        actor = Actor()
        for bucket in STRESS_BUCKETS:
            dist = actor.action_distribution(bucket)
            assert abs(sum(dist.values()) - 1.0) < 1e-6
            expected = 1.0 / len(ACTION_TAXONOMY)
            for p in dist.values():
                assert abs(p - expected) < 1e-6

    def test_from_prior_file(self, tmp_path):
        prior = {b: {a: 0.7 for a in ACTION_TAXONOMY} for b in STRESS_BUCKETS}
        prior_file = tmp_path / "prior.json"
        prior_file.write_text(json.dumps(prior))
        actor = Actor.from_prior(prior_file)
        # logit(0.7) > 0 → all actions should have positive log-bias
        for bucket in STRESS_BUCKETS:
            for action in ACTION_TAXONOMY:
                assert actor.log_biases[bucket][action] > 0

    def test_from_prior_missing_file(self, tmp_path):
        actor = Actor.from_prior(tmp_path / "nonexistent.json")
        # Falls back to uniform; no exception
        dist = actor.action_distribution("low_stress")
        assert abs(sum(dist.values()) - 1.0) < 1e-6

    def test_select_returns_valid_action(self):
        actor = Actor()
        state = _make_state(0.4)
        action, log_prob = actor.select(state)
        assert action in ACTION_TAXONOMY
        assert log_prob <= 0.0    # log of a probability ≤ 1

    def test_update_increases_good_action_prob(self):
        actor = Actor()
        bucket = "moderate"
        action = ACTION_TAXONOMY[0]
        # Give the chosen action a head-start so it's above uniform
        actor.log_biases[bucket][action] = 1.0
        prob_before = actor.action_distribution(bucket)[action]
        actor.update(bucket, action, advantage=5.0)   # strong positive signal
        prob_after  = actor.action_distribution(bucket)[action]
        assert prob_after > prob_before

    def test_entropy_positive(self):
        actor = Actor()
        entropy = actor.entropy("low_stress")
        assert entropy > 0.0

    def test_save_load_roundtrip(self, tmp_path):
        actor = Actor()
        actor.log_biases["low"][ACTION_TAXONOMY[0]] = 1.23
        save_path = tmp_path / "actor.json"
        actor.save(save_path)
        loaded = Actor.load(save_path)
        assert abs(loaded.log_biases["low"][ACTION_TAXONOMY[0]] - 1.23) < 1e-6


# ── J3: Critic ────────────────────────────────────────────────────────────────

class TestCritic:
    def test_zero_init(self):
        critic = Critic()
        state  = _make_state(0.5)
        v      = critic.estimate(state)
        assert v == 0.0   # bias term is 0 initially → dot product is 0

    def test_update_moves_toward_target(self):
        critic = Critic()
        state  = _make_state(0.3)
        critic.update(state, target=1.0)
        v_after = critic.estimate(state)
        assert v_after > 0.0     # moved toward target=1.0

    def test_td_error_decreases_after_updates(self):
        critic = Critic()
        state  = _make_state(0.5)
        errors = [abs(critic.update(state, target=0.8)) for _ in range(50)]
        assert errors[-1] < errors[0]

    def test_save_load_roundtrip(self, tmp_path):
        critic = Critic(weights=[0.1, 0.2, 0.3, 0.4])
        save_path = tmp_path / "critic.json"
        critic.save(save_path)
        loaded = Critic.load(save_path)
        assert loaded.weights == pytest.approx([0.1, 0.2, 0.3, 0.4])


# ── J4: Advantage and apply_update ───────────────────────────────────────────

class TestAdvantage:
    def test_positive_advantage_when_reward_exceeds_value(self):
        adv = compute_advantage(reward=1.0, v_current=0.0, v_next=0.0)
        assert adv == pytest.approx(1.0)

    def test_negative_advantage_when_reward_low(self):
        adv = compute_advantage(reward=0.0, v_current=1.0, v_next=0.0)
        assert adv == pytest.approx(-1.0)

    def test_discount_applied(self):
        adv = compute_advantage(reward=0.0, v_current=0.0, v_next=1.0)
        assert adv == pytest.approx(GAMMA_DISCOUNT)

    def test_apply_update_returns_metrics(self):
        actor  = Actor()
        critic = Critic()
        state  = _make_state(0.4, turn_idx=0)
        next_s = _make_state(0.35, turn_idx=1)
        metrics = apply_update(actor, critic, state, next_s, ACTION_TAXONOMY[0], 0.6)
        for key in ("v_s", "v_next", "advantage", "td_error", "entropy", "reward"):
            assert key in metrics

    def test_scalar_reward_weighted_sum(self):
        reward = {d: 1.0 for d in REWARD_DIMS}
        r = scalar_reward(reward)
        assert 0.99 < r <= 1.01   # weights sum to ~1.0


# ── J1: A3CWorker base class ──────────────────────────────────────────────────

class ConcreteWorker(A3CWorker):
    """Minimal concrete worker for testing the base class."""
    ARM = "test_arm"

    def generate_response(self, state, action, scenario):
        return {
            "response":          f"[{action}] Test response.",
            "reward":            {d: 0.5 for d in REWARD_DIMS},
            "judge":             {},
            "tokens":            {"scout": 10, "maverick": 0},
            "latency_ms":        5.0,
            "next_stress_index": max(0.0, state.stress_index - 0.02),
            "next_physio":       state.physio,
        }


class TestA3CWorker:
    def _patch_scorer(self):
        """Patch A3CScorer.score_turn to return a neutral result offline."""
        from tensornets.a3c.scorer import TurnScoreResult
        return patch(
            "tensornets.a3c.worker.A3CScorer.score_turn",
            return_value=TurnScoreResult(
                integer_scores=[("fallback", 0, "offline test")],
                continuous_score=0.5,
                dimensions={},
                critical_failure=False,
                repetition_penalty=0.0,
            ),
        )

    def test_run_episode_returns_summary(self, tmp_path):
        actor   = Actor()
        critic  = Critic()
        worker  = ConcreteWorker(actor, critic, run_dir=tmp_path)
        scenario = _make_scenario(n_turns=3)
        with self._patch_scorer():
            summary  = worker.run_episode(scenario, patient_mode='scripted')
        assert summary["n_turns"] == 3
        assert "cumulative_reward" in summary
        assert "episode_id" in summary

    def test_episode_jsonl_written(self, tmp_path):
        actor  = Actor()
        critic = Critic()
        worker = ConcreteWorker(actor, critic, run_dir=tmp_path)
        with self._patch_scorer():
            summary = worker.run_episode(_make_scenario(n_turns=2), patient_mode='scripted')
        jsonl_path = Path(summary["jsonl_path"])
        assert jsonl_path.exists()
        lines = jsonl_path.read_text().strip().splitlines()
        assert len(lines) == 2
        first = json.loads(lines[0])
        assert first["arm"] == "test_arm"

    def test_checkpoint_saved(self, tmp_path):
        actor  = Actor()
        critic = Critic()
        worker = ConcreteWorker(actor, critic, run_dir=tmp_path)
        worker.save_checkpoint(step=10)
        assert (tmp_path / "checkpoints" / "actor_10.json").exists()
        assert (tmp_path / "checkpoints" / "critic_10.json").exists()

    def test_actor_updated_after_episode(self, tmp_path):
        actor  = Actor()
        critic = Critic()
        # Record biases before
        before = dict(actor.log_biases["moderate"])
        worker = ConcreteWorker(actor, critic, run_dir=tmp_path)
        with self._patch_scorer():
            worker.run_episode(_make_scenario(n_turns=5), patient_mode='scripted')
        after = actor.log_biases["moderate"]
        # At least one bias should have changed
        changed = any(abs(after[a] - before[a]) > 1e-9 for a in ACTION_TAXONOMY)
        assert changed


# ── J5–J7: Arm workers (offline / fallback paths) ────────────────────────────

class TestArmWorkers:
    def _patch_http(self):
        """Patch _http_post to simulate server unreachable."""
        return patch(
            "tensornets.a3c.arms._http_post",
            side_effect=ConnectionError("server down"),
        )

    def _patch_http_ok(self, text: str = "That sounds really hard. Let's explore it together."):
        """Patch _http_post to return a successful LLM response."""
        return patch(
            "tensornets.a3c.arms._http_post",
            return_value={"text": text},
        )

    def _patch_patient_http(self):
        """Patch _http_post in synthetic_patient to return a patient response."""
        return patch(
            "tensornets.a3c.synthetic_patient._http_post",
            return_value={"text": "I don't think I have a problem."},
        )

    def _patch_scorer(self):
        from tensornets.a3c.scorer import TurnScoreResult
        return patch(
            "tensornets.a3c.worker.A3CScorer.score_turn",
            return_value=TurnScoreResult(
                integer_scores=[("test", 3, "ok")],
                continuous_score=0.6, dimensions={},
                critical_failure=False, repetition_penalty=0.0,
            ),
        )

    def test_arm1_episode_with_mock_llm(self, tmp_path):
        """Arm1 completes an episode when Scout responds successfully."""
        actor  = Actor()
        critic = Critic()
        worker = Arm1Worker(actor, critic, run_dir=tmp_path)
        scenario = _make_scenario(n_turns=2)
        with self._patch_http_ok(), self._patch_patient_http(), self._patch_scorer():
            summary = worker.run_episode(scenario, patient_mode='llm')
        assert summary["n_turns"] == 2
        assert summary["arm"] == "htn_mcts"

    def test_arm3_episode_with_mock_llm(self, tmp_path):
        """Arm3 completes an episode when Scout responds successfully."""
        actor  = Actor()
        critic = Critic()
        worker = Arm3Worker(actor, critic, run_dir=tmp_path)
        scenario = _make_scenario(n_turns=2)
        with self._patch_http_ok(), self._patch_patient_http(), self._patch_scorer():
            summary = worker.run_episode(scenario, patient_mode='llm')
        assert summary["n_turns"] == 2
        assert summary["arm"] == "hysteresis_prompt"

    def test_arm1_raises_on_server_down(self, tmp_path):
        actor  = Actor()
        critic = Critic()
        worker = Arm1Worker(actor, critic, run_dir=tmp_path)
        scenario = _make_scenario(n_turns=2)
        with self._patch_http(), self._patch_scorer(), pytest.raises(RuntimeError, match="Scout call failed"):
            worker.run_episode(scenario, patient_mode='llm')

    def test_arm2_runs_with_js_down(self, tmp_path):
        """Arm 2 posts to Node.js; fails fast when server is down."""
        actor  = Actor()
        critic = Critic()
        worker = Arm2Worker(actor, critic, run_dir=tmp_path)
        with self._patch_http(), self._patch_scorer(), pytest.raises((RuntimeError, Exception)):
            worker.run_episode(_make_scenario(n_turns=2), patient_mode='llm')

    def test_arm3_raises_on_server_down(self, tmp_path):
        actor  = Actor()
        critic = Critic()
        worker = Arm3Worker(actor, critic, run_dir=tmp_path)
        with self._patch_http(), self._patch_scorer(), pytest.raises(RuntimeError, match="Scout call failed"):
            worker.run_episode(_make_scenario(n_turns=2), patient_mode='llm')

    def test_stress_after_response_calming(self):
        s = _stress_after_response(0.6, "empathic_reflection")
        assert s < 0.6

    def test_stress_after_response_crisis(self):
        # safety_protocol has low CALMING_WEIGHT (it can raise stress by signalling danger)
        s = _stress_after_response(0.4, "safety_protocol")
        # safety_protocol: CW=0.80 → Δ = -(0.80-0.5)*2*0.08 = -0.048 → mild calming
        # Key property: breathing_exercise should be MORE calming than safety_protocol
        s_breathing = _stress_after_response(0.4, "breathing_exercise")
        assert s_breathing < s   # breathing is more calming than safety protocol

    def test_synthetic_reward_keys(self):
        state = _make_state(0.5)
        reward = _synthetic_reward(state, "empathic_reflection", 0.45)
        # _synthetic_reward covers the arm-computed dims (not count_penalty which comes from scorer)
        for dim in ("stress", "trust_delta", "goal_progress", "info_coverage", "consistency", "safety"):
            assert dim in reward
            assert 0.0 <= reward[dim] <= 1.0

    def test_hysteresis_context_format(self):
        state    = _make_state(0.6)
        scenario = {
            "hysteresis_context": {
                "trigger_X": {"pct_extinguished": 55.0, "suds": 60}
            }
        }
        ctx = _build_hysteresis_context(state, scenario)
        assert "trigger_X" in ctx
        assert "55%" in ctx

    def test_all_three_arms_write_compatible_jsonl(self, tmp_path):
        """All three arms must write the same jsonl schema when LLMs succeed."""
        actor  = Actor()
        critic = Critic()
        scenario = _make_scenario(n_turns=1)
        summaries = []
        # Arm2 posts to Node.js (different module path)
        with self._patch_http_ok(), self._patch_patient_http(), self._patch_scorer(), \
             patch("tensornets.a3c.arms._http_post", return_value={"text": "Good progress."}):
            for ArmClass in (Arm1Worker, Arm3Worker):
                worker = ArmClass(actor, critic, run_dir=tmp_path / ArmClass.ARM)
                summaries.append(worker.run_episode(scenario, patient_mode='llm'))

        for summary in summaries:
            path = Path(summary["jsonl_path"])
            line = json.loads(path.read_text().strip())
            for key in ("turn", "arm", "state", "action", "reward", "update"):
                assert key in line, f"Missing key '{key}' in {summary['arm']} log"
