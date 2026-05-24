"""
Tests for tensornets.physio.state and tensornets.physio.hrv.

Run with: pytest tests/test_physio.py -v
"""

import math
import pytest
from datetime import datetime, timedelta

from tensornets.physio.state import (
    PhysiologicalState,
    PhysiologicalHistory,
    HRV_RMSSD_BASELINE_MS,
    HRV_RMSSD_MIN_MS,
    HRV_RMSSD_MAX_MS,
)
from tensornets.physio.hrv import (
    hrv_to_gamma,
    gamma_to_lambda1,
    stress_half_life_turns,
    decay_amplitude_after_n_turns,
    gamma_from_state,
    estimate_baseline_from_history,
    GAMMA_MIN,
    GAMMA_MAX,
)


# ── Fixtures ───────────────────────────────────────────────────────────────────

def make_state(
    hrv=35.0, glucose=5.5, eda=1.0, hour=10.0, loc=0.1,
    sleep_hours=7.0, sleep_deficit=1.0, entrainment=0.7, rr=15.0,
):
    return PhysiologicalState(
        hrv_rmssd_ms=hrv,
        blood_glucose_mmol=glucose,
        eda_us=eda,
        time_of_day_h=hour,
        location_stress_index=loc,
        sleep_hours_last_night=sleep_hours,
        sleep_deficit_hours=sleep_deficit,
        circadian_entrainment=entrainment,
        respiratory_rate_bpm=rr,
        timestamp=datetime(2026, 5, 23, 10, 0, 0),
        is_simulated=True,
    )


# ── PhysiologicalState tests ───────────────────────────────────────────────────

class TestPhysiologicalState:

    def test_valid_baseline_state(self):
        s = make_state()
        assert s.hrv_rmssd_ms == 35.0
        assert s.is_simulated is True

    def test_hrv_normalized_baseline_is_midrange(self):
        s = make_state(hrv=HRV_RMSSD_BASELINE_MS)
        n = s.hrv_normalized()
        assert 0.0 < n < 1.0

    def test_hrv_normalized_order(self):
        """Higher HRV → higher normalised value (calmer)."""
        low_hrv  = make_state(hrv=10.0)
        high_hrv = make_state(hrv=80.0)
        assert high_hrv.hrv_normalized() > low_hrv.hrv_normalized()

    def test_hrv_normalized_bounds(self):
        s_min = make_state(hrv=HRV_RMSSD_MIN_MS)
        s_max = make_state(hrv=HRV_RMSSD_MAX_MS)
        assert 0.0 <= s_min.hrv_normalized() <= 1.0
        assert 0.0 <= s_max.hrv_normalized() <= 1.0

    def test_glucose_normalized_optimal_range(self):
        s = make_state(glucose=5.5)
        assert s.glucose_normalized() > 0.5

    def test_eda_normalized_bounds(self):
        s_low  = make_state(eda=0.01)
        s_high = make_state(eda=20.0)
        assert 0.0 <= s_low.eda_normalized() <= 1.0
        assert 0.0 <= s_high.eda_normalized() <= 1.0

    def test_eda_normalized_direction(self):
        """Higher EDA (more sympathetic activation) → higher value."""
        calm    = make_state(eda=0.5)
        aroused = make_state(eda=15.0)
        assert aroused.eda_normalized() > calm.eda_normalized()

    def test_circadian_phase_peak_at_8am(self):
        morning = make_state(hour=8.0)
        assert morning.circadian_phase() == pytest.approx(1.0, abs=1e-6)

    def test_circadian_phase_trough_at_night(self):
        night   = make_state(hour=20.0)
        morning = make_state(hour=8.0)
        assert morning.circadian_phase() > night.circadian_phase()

    def test_stress_index_bounds(self):
        for hrv in [10.0, 35.0, 80.0]:
            for eda in [0.5, 5.0, 15.0]:
                s = make_state(hrv=hrv, eda=eda)
                idx = s.stress_index()
                assert 0.0 <= idx <= 1.0, f"stress_index={idx} out of bounds"

    def test_stress_index_stressed_gt_calm(self):
        stressed = make_state(hrv=10.0, eda=15.0, loc=0.9)
        calm     = make_state(hrv=80.0, eda=0.2, loc=0.0)
        assert stressed.stress_index() > calm.stress_index()

    def test_to_vector_length(self):
        s = make_state()
        v = s.to_vector()
        assert len(v) == 8, f"to_vector should return 8 signals, got {len(v)}"
        assert all(0.0 <= x <= 1.0 for x in v)

    def test_validation_hrv_out_of_range(self):
        with pytest.raises(ValueError, match="hrv_rmssd_ms"):
            make_state(hrv=200.0)

    def test_validation_negative_hrv(self):
        with pytest.raises(ValueError):
            make_state(hrv=-1.0)

    def test_validation_time_out_of_range(self):
        with pytest.raises(ValueError, match="time_of_day_h"):
            make_state(hour=25.0)

    def test_validation_location_out_of_range(self):
        with pytest.raises(ValueError, match="location_stress_index"):
            make_state(loc=1.5)

    def test_repr(self):
        s = make_state()
        r = repr(s)
        assert "PhysiologicalState" in r
        assert "stress=" in r


class TestPhysiologicalHistory:

    def _make_history(self):
        h = PhysiologicalHistory(subject_id="test_001")
        t0 = datetime(2026, 5, 23, 9, 0, 0)
        for i in range(10):
            s = make_state(hrv=30.0 + i * 2.0)
            s.timestamp = t0 + timedelta(minutes=i * 5)
            h.append(s)
        return h

    def test_append_and_len(self):
        h = self._make_history()
        assert len(h) == 10

    def test_stress_trajectory_length(self):
        h = self._make_history()
        traj = h.stress_trajectory()
        assert len(traj) == 10
        assert all(0.0 <= x <= 1.0 for x in traj)

    def test_hrv_trajectory_length(self):
        h = self._make_history()
        traj = h.hrv_trajectory()
        assert len(traj) == 10

    def test_duration_seconds(self):
        h = self._make_history()
        # 9 intervals × 5 minutes = 45 minutes = 2700 seconds
        assert h.duration_seconds() == pytest.approx(2700.0)

    def test_out_of_order_append_raises(self):
        h = PhysiologicalHistory(subject_id="test")
        t0 = datetime(2026, 5, 23, 10, 0, 0)
        s1 = make_state(); s1.timestamp = t0
        s2 = make_state(); s2.timestamp = t0 - timedelta(seconds=1)
        h.append(s1)
        with pytest.raises(ValueError):
            h.append(s2)


# ── HRV → γ tests ─────────────────────────────────────────────────────────────

class TestHRVToGamma:

    def test_stressed_gives_low_gamma(self):
        """Low HRV (stressed) → low γ → slow recovery."""
        gamma_stressed = hrv_to_gamma(10.0, baseline_ms=35.0)
        gamma_calm     = hrv_to_gamma(70.0, baseline_ms=35.0)
        assert gamma_stressed < gamma_calm

    def test_gamma_within_bounds(self):
        for hrv in [HRV_RMSSD_MIN_MS, 20.0, 35.0, 70.0, HRV_RMSSD_MAX_MS]:
            g = hrv_to_gamma(hrv)
            assert GAMMA_MIN <= g <= GAMMA_MAX * 5, f"gamma={g} for hrv={hrv}"

    def test_at_baseline_gamma_equals_max(self):
        """At baseline HRV, ratio=1, so γ should equal γ_max (fastest recovery)."""
        g = hrv_to_gamma(HRV_RMSSD_BASELINE_MS, baseline_ms=HRV_RMSSD_BASELINE_MS)
        assert g == pytest.approx(GAMMA_MAX, rel=0.01)

    def test_gamma_to_lambda1_range(self):
        for hrv in [10.0, 35.0, 70.0]:
            g = hrv_to_gamma(hrv)
            l1 = gamma_to_lambda1(g)
            assert 0.0 <= l1 <= 1.0, f"|λ₁|={l1} out of [0,1]"

    def test_lambda1_stressed_close_to_one(self):
        """Stressed: |λ₁| > 0.8 → stress persists across multiple turns."""
        g  = hrv_to_gamma(8.0, baseline_ms=35.0)  # very stressed
        l1 = gamma_to_lambda1(g, delta_t=1.0)
        assert l1 > 0.8, f"Expected |λ₁| > 0.8 for stressed state, got {l1}"

    def test_lambda1_calm_away_from_one(self):
        """Calm: |λ₁| < 0.8 → stress recovers quickly."""
        g  = hrv_to_gamma(90.0, baseline_ms=35.0)
        l1 = gamma_to_lambda1(g, delta_t=1.0)
        assert l1 < 0.8, f"Expected |λ₁| < 0.8 for calm state, got {l1}"

    def test_stress_half_life_stressed_is_long(self):
        g = hrv_to_gamma(8.0, baseline_ms=35.0)
        hl = stress_half_life_turns(g)
        assert hl > 3.0, f"Half-life for stressed state should be > 3 turns, got {hl}"

    def test_stress_half_life_calm_is_short(self):
        g = hrv_to_gamma(90.0, baseline_ms=35.0)
        hl = stress_half_life_turns(g)
        assert hl < 5.0, f"Half-life for calm state should be < 5 turns, got {hl}"

    def test_decay_amplitude_decreases_monotonically(self):
        g = hrv_to_gamma(20.0, baseline_ms=35.0)
        amplitudes = [decay_amplitude_after_n_turns(1.0, g, n) for n in range(20)]
        for i in range(1, len(amplitudes)):
            assert amplitudes[i] <= amplitudes[i - 1] + 1e-12

    def test_decay_amplitude_zero_at_t0(self):
        g = hrv_to_gamma(35.0)
        assert decay_amplitude_after_n_turns(1.0, g, 0) == pytest.approx(1.0)

    def test_gamma_from_state_eda_suppresses_recovery(self):
        """High EDA should reduce γ compared to low EDA (same HRV)."""
        calm_eda  = make_state(hrv=40.0, eda=0.1)
        high_eda  = make_state(hrv=40.0, eda=18.0)
        g_calm  = gamma_from_state(calm_eda)
        g_high  = gamma_from_state(high_eda)
        assert g_calm > g_high

    def test_estimate_baseline_insufficient_history(self):
        h = PhysiologicalHistory(subject_id="test")
        baseline = estimate_baseline_from_history(h)
        assert baseline == HRV_RMSSD_BASELINE_MS

    def test_estimate_baseline_from_history(self):
        h = PhysiologicalHistory(subject_id="test")
        t0 = datetime(2026, 5, 23, 9, 0, 0)
        hrv_values = [20.0, 25.0, 30.0, 70.0, 75.0, 80.0, 85.0, 90.0]
        for i, hrv in enumerate(hrv_values):
            s = make_state(hrv=hrv)
            s.timestamp = t0 + timedelta(minutes=i)
            h.append(s)
        baseline = estimate_baseline_from_history(h)
        assert baseline >= 70.0

    def test_gamma_from_state_sleep_suppresses_recovery(self):
        """Sleep-deprived patient should have lower γ than rested patient."""
        rested    = make_state(hrv=40.0, sleep_hours=8.0, sleep_deficit=0.0)
        deprived  = make_state(hrv=40.0, sleep_hours=3.0, sleep_deficit=5.0)
        g_rested   = gamma_from_state(rested)
        g_deprived = gamma_from_state(deprived)
        assert g_rested > g_deprived, (
            f"Rested γ={g_rested:.4f} should be > sleep-deprived γ={g_deprived:.4f}"
        )
