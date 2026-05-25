"""
test_bandit.py — Tests for I1–I4: Thompson Sampling bandit warm-up

Run: cd tensornets && python -m pytest tests/test_bandit.py -v
"""
import math
import pytest
from tensornets.a3c.action_bandit import (
    ActionBandit,
    ACTION_TAXONOMY,
    STRESS_BUCKETS,
    BanditTrainingConfig,
    run_bandit_training,
    heuristic_reward,
    stress_bucket_for_hrv,
    train_and_export,
    _beta_sample,
)


class TestI1ActionBandit:
    """I1: Beta posterior per action per stress bucket."""

    def test_initialises_with_uniform_prior(self):
        bandit = ActionBandit()
        for bucket in STRESS_BUCKETS:
            for action in ACTION_TAXONOMY:
                assert bandit.alpha[bucket][action] == 1.0
                assert bandit.beta_[bucket][action] == 1.0
                assert bandit.pulls[bucket][action] == 0

    def test_all_actions_present(self):
        bandit = ActionBandit()
        assert set(bandit.actions) == set(ACTION_TAXONOMY)
        assert len(bandit.actions) == 12

    def test_all_buckets_present(self):
        bandit = ActionBandit()
        assert set(bandit.alpha.keys()) == set(STRESS_BUCKETS.keys())

    def test_update_increments_correctly(self):
        bandit = ActionBandit()
        bandit.update(hrv_ms=50.0, action='validate_emotion', reward=0.8)
        assert bandit.alpha['low']['validate_emotion'] == pytest.approx(1.8, abs=1e-6)
        assert bandit.beta_['low']['validate_emotion'] == pytest.approx(1.2, abs=1e-6)
        assert bandit.pulls['low']['validate_emotion'] == 1

    def test_update_high_stress_bucket(self):
        bandit = ActionBandit()
        bandit.update(hrv_ms=15.0, action='build_alliance', reward=0.9)
        # 15ms → 'high' bucket
        assert bandit.alpha['high']['build_alliance'] == pytest.approx(1.9, abs=1e-6)

    def test_arm_stats_format(self):
        bandit = ActionBandit()
        bandit.update(hrv_ms=35.0, action='invite_reflection', reward=0.6)
        stats = bandit.arm_stats()
        assert 'moderate' in stats
        arm = stats['moderate']['invite_reflection']
        assert 'mean_reward' in arm
        assert 'std' in arm
        assert 'pulls' in arm
        assert arm['pulls'] == 1

    def test_save_and_load(self, tmp_path):
        bandit = ActionBandit()
        bandit.update(hrv_ms=30.0, action='validate_emotion', reward=0.7)
        bandit.episodes = 5
        save_path = tmp_path / "bandit.json"
        bandit.save(save_path)

        loaded = ActionBandit.load(save_path)
        assert loaded.episodes == 5
        assert loaded.alpha['moderate']['validate_emotion'] == pytest.approx(
            bandit.alpha['moderate']['validate_emotion'], abs=1e-6
        )

    def test_export_actor_prior_range(self):
        bandit = ActionBandit()
        prior = bandit.export_actor_prior()
        for bucket in STRESS_BUCKETS:
            assert bucket in prior
            for action in ACTION_TAXONOMY:
                v = prior[bucket][action]
                assert 0.0 <= v <= 1.0, f"Prior out of range for {bucket}/{action}: {v}"

    def test_export_actor_prior_uniform_initially(self):
        bandit = ActionBandit()
        prior = bandit.export_actor_prior()
        for bucket in STRESS_BUCKETS:
            for action in ACTION_TAXONOMY:
                assert prior[bucket][action] == pytest.approx(0.5, abs=1e-6)


class TestI2ThompsonSampling:
    """I2: Thompson Sampling action selection."""

    def test_select_action_returns_valid_action(self):
        bandit = ActionBandit()
        action = bandit.select_action(hrv_ms=40.0)
        assert action in ACTION_TAXONOMY

    def test_select_action_uses_correct_bucket(self):
        bandit = ActionBandit()
        # Heavily bias validate_emotion in 'high' bucket
        for _ in range(30):
            bandit.update(15.0, 'validate_emotion', 0.99)
        for _ in range(30):
            bandit.update(15.0, 'provide_information', 0.01)

        # Over many samples, should mostly select validate_emotion for high stress
        selections = [bandit.select_action(hrv_ms=15.0) for _ in range(200)]
        validate_frac = selections.count('validate_emotion') / len(selections)
        assert validate_frac > 0.5, f"validate_emotion selected {validate_frac:.2%}, expected > 50%"

    def test_select_action_excludes_specified(self):
        bandit = ActionBandit()
        exclude = list(ACTION_TAXONOMY[:-1])  # all except last
        action = bandit.select_action(hrv_ms=35.0, exclude=exclude)
        assert action == ACTION_TAXONOMY[-1]

    def test_select_action_excludes_all_falls_back(self):
        bandit = ActionBandit()
        action = bandit.select_action(hrv_ms=35.0, exclude=list(ACTION_TAXONOMY))
        assert action in ACTION_TAXONOMY  # falls back to full list

    def test_exploration_on_uniform_prior(self):
        """With uniform prior, all actions should appear (exploration is high)."""
        bandit = ActionBandit()
        selections = [bandit.select_action(hrv_ms=38.0) for _ in range(240)]
        unique = set(selections)
        # With 240 samples and 12 actions, all should appear under uniform prior
        assert len(unique) == len(ACTION_TAXONOMY), \
            f"Only {len(unique)}/{len(ACTION_TAXONOMY)} actions selected under uniform prior"

    def test_stress_bucket_routing(self):
        assert stress_bucket_for_hrv(50.0) == 'low'
        assert stress_bucket_for_hrv(35.0) == 'moderate'
        assert stress_bucket_for_hrv(20.0) == 'high'
        assert stress_bucket_for_hrv(25.0) == 'moderate'
        assert stress_bucket_for_hrv(45.0) == 'low'


class TestI3BanditTrainingLoop:
    """I3: Bandit training loop correctness and convergence."""

    def test_training_runs_to_completion(self):
        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=20, n_turns_per_ep=5, seed=0)
        log = run_bandit_training(bandit, heuristic_reward, config)
        assert len(log['episodes']) == 20
        assert bandit.episodes == 20

    def test_training_log_format(self):
        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=5, n_turns_per_ep=3, seed=1)
        log = run_bandit_training(bandit, heuristic_reward, config)
        for ep in log['episodes']:
            assert 'episode' in ep
            assert 'mean_reward' in ep
            assert 'actions' in ep
            assert 0.0 <= ep['mean_reward'] <= 1.0
            assert len(ep['actions']) == 3

    def test_high_stress_action_emerges(self):
        """
        After 100 episodes, validate_emotion and suggest_coping_strategy should
        dominate in the high-stress bucket (per heuristic reward table priors).
        """
        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=100, n_turns_per_ep=10, seed=42)
        log = run_bandit_training(bandit, heuristic_reward, config)

        prior = log['actor_prior']
        high_validate = prior['high']['validate_emotion']
        high_info = prior['high']['provide_information']

        assert high_validate > high_info, (
            f"validate_emotion ({high_validate:.4f}) should dominate provide_information "
            f"({high_info:.4f}) in high-stress bucket"
        )

    def test_low_stress_provides_information_ranks_well(self):
        """
        In the low-stress bucket, provide_information should be competitive
        (patient is calm, can absorb psychoeducation).
        """
        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=100, n_turns_per_ep=10, seed=99)
        run_bandit_training(bandit, heuristic_reward, config)

        prior = bandit.export_actor_prior()
        low_info = prior['low']['provide_information']

        # Should be above 0.55 (the heuristic table value for low-stress info)
        assert low_info > 0.55, (
            f"provide_information prior in low bucket is {low_info:.4f}, expected > 0.55"
        )

    def test_pulls_accumulate(self):
        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=10, n_turns_per_ep=5, seed=7)
        run_bandit_training(bandit, heuristic_reward, config)
        total_pulls = sum(
            bandit.pulls[b][a]
            for b in STRESS_BUCKETS
            for a in ACTION_TAXONOMY
        )
        assert total_pulls == 10 * 5, f"Expected 50 pulls, got {total_pulls}"

    def test_rewards_clamped_to_unit_interval(self):
        """Even if reward_fn returns out-of-range, update must clamp."""
        def bad_reward(action, hrv_ms, turn):
            return 5.0  # out of range

        bandit = ActionBandit()
        config = BanditTrainingConfig(n_episodes=5, n_turns_per_ep=2, seed=3)
        log = run_bandit_training(bandit, bad_reward, config)
        for ep in log['episodes']:
            assert ep['mean_reward'] <= 1.0


class TestI4ActorPriorExport:
    """I4: Export bandit weights for A3C actor initialisation."""

    def test_prior_shape_matches_taxonomy(self):
        bandit, log = train_and_export(n_episodes=20, verbose=False)
        prior = log['actor_prior']
        assert set(prior.keys()) == set(STRESS_BUCKETS.keys())
        for bucket in prior:
            assert set(prior[bucket].keys()) == set(ACTION_TAXONOMY)

    def test_prior_is_informative_after_training(self):
        """After training, prior values should not all be 0.5 (should have diverged)."""
        bandit, log = train_and_export(n_episodes=100, verbose=False)
        prior = log['actor_prior']
        all_values = [
            prior[b][a]
            for b in STRESS_BUCKETS
            for a in ACTION_TAXONOMY
        ]
        std = math.sqrt(
            sum((v - 0.5) ** 2 for v in all_values) / len(all_values)
        )
        assert std > 0.01, f"Prior is too flat after training (std={std:.4f}), expected > 0.01"

    def test_prior_save_to_file(self, tmp_path):
        bandit, log = train_and_export(
            n_episodes=10,
            output_path=tmp_path / "bandit_state.json",
            verbose=False,
        )
        assert (tmp_path / "bandit_state.json").exists()
        assert (tmp_path / "bandit_state_actor_prior.json").exists()

    def test_beta_sample_range(self):
        """Beta sample must be in [0, 1] for all valid inputs."""
        for alpha in [0.1, 1.0, 5.0, 100.0]:
            for beta in [0.1, 1.0, 5.0, 100.0]:
                samples = [_beta_sample(alpha, beta) for _ in range(100)]
                assert all(0.0 <= s <= 1.0 for s in samples), \
                    f"Beta sample out of range for alpha={alpha}, beta={beta}"

    def test_beta_sample_mean_approx_alpha_over_alpha_plus_beta(self):
        """Beta(alpha, beta) mean should be approximately alpha / (alpha + beta)."""
        alpha, beta = 3.0, 7.0
        expected_mean = alpha / (alpha + beta)
        samples = [_beta_sample(alpha, beta) for _ in range(5000)]
        actual_mean = sum(samples) / len(samples)
        assert abs(actual_mean - expected_mean) < 0.02, \
            f"Beta sample mean {actual_mean:.4f} differs from expected {expected_mean:.4f}"
