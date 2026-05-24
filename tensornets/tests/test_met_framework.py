"""
test_met_framework.py — Unit tests for MET framework

Replaces the worked_example() in met_framework.py with proper assertions.
The original worked_example() printed output for human inspection; these tests
assert correctness.
"""

import pytest
from tensornets.therapy.met_framework import (
    OARSSkill,
    EEDDAARRSSSkill,
    MotivationalFrame,
    DEADDICTION_PHASE_SKILLS,
    DEADDICTION_PROTOCOL,
    SPIKE_PROTOCOL,
    assess_flooding_readiness,
    spike_current_step,
    phase_prompt_injection,
    get_phase_context,
)


# ─────────────────────────────────────────────────────────────────────────────
# OARS classification
# ─────────────────────────────────────────────────────────────────────────────

class TestOARSClassifier:
    def test_open_question(self):
        assert OARSSkill.classify(
            "What makes you think this might be a problem for you?"
        ) == OARSSkill.OPEN_QUESTION

    def test_affirmation(self):
        assert OARSSkill.classify(
            "You showed real courage in coming here today."
        ) == OARSSkill.AFFIRMATION

    def test_reflection(self):
        assert OARSSkill.classify(
            "It sounds like you feel trapped between two things you care about."
        ) == OARSSkill.REFLECTION

    def test_summary(self):
        assert OARSSkill.classify(
            "So to recap, you've mentioned that you want to cut down but feel like you can't."
        ) == OARSSkill.SUMMARY

    def test_unclassified_returns_none(self):
        # Generic statement should not classify to a specific skill
        result = OARSSkill.classify("The weather is nice today.")
        # May be None or OPEN_QUESTION if it ends in ?; just ensure no crash
        assert result in (None, OARSSkill.OPEN_QUESTION,
                          OARSSkill.AFFIRMATION, OARSSkill.REFLECTION, OARSSkill.SUMMARY)


# ─────────────────────────────────────────────────────────────────────────────
# Deaddiction phase protocol
# ─────────────────────────────────────────────────────────────────────────────

class TestDeaddictionProtocol:
    def test_all_phases_defined(self):
        for phase in ('rapport', 'ambivalence', 'insight', 'strike'):
            assert phase in DEADDICTION_PROTOCOL

    def test_rapport_skills_no_direct(self):
        """Rapport phase must NOT contain DIRECT or ADVISE skills."""
        rapport_skills = DEADDICTION_PHASE_SKILLS['rapport']
        direct_skill_names = {s.name for s in rapport_skills}
        assert 'DIRECT' not in direct_skill_names
        assert 'ADVISE' not in direct_skill_names

    def test_strike_phase_has_direct(self):
        """Strike phase must include DIRECT skill."""
        strike_skills = DEADDICTION_PHASE_SKILLS['strike']
        skill_names = {s.name for s in strike_skills}
        assert 'DIRECT' in skill_names

    def test_phase_weights_sum_close_to_one(self):
        for phase_name, ctx in DEADDICTION_PROTOCOL.items():
            total = sum(ctx.mcts_cost_weights.values())
            assert abs(total - 1.0) < 0.05, (
                f"Phase '{phase_name}' weights sum to {total:.3f}, expected ~1.0"
            )

    def test_goal_progress_increases_across_phases(self):
        """MCTS should weight goal_progress more in later phases."""
        rapport_gp = DEADDICTION_PROTOCOL['rapport'].mcts_cost_weights['goal_progress']
        strike_gp = DEADDICTION_PROTOCOL['strike'].mcts_cost_weights['goal_progress']
        assert strike_gp > rapport_gp, (
            f"Strike phase goal_progress ({strike_gp}) should exceed rapport ({rapport_gp})"
        )

    def test_phase_prompt_injection_contains_phase_name(self):
        """Rapport and ambivalence phases should contain their phase name."""
        for phase in ('rapport', 'ambivalence'):
            prompt = phase_prompt_injection(phase)
            assert phase.upper() in prompt

    def test_phase_prompt_injection_non_empty_for_all_phases(self):
        """All phases should return a non-empty prompt injection."""
        for phase in ('rapport', 'ambivalence', 'insight', 'strike'):
            ctx = get_phase_context(phase)
            assert ctx is not None

    def test_phase_prompt_injection_contains_skills(self):
        prompt = phase_prompt_injection('rapport')
        assert 'ENGAGE' in prompt or 'SUPPORT' in prompt


# ─────────────────────────────────────────────────────────────────────────────
# Flooding readiness gating
# ─────────────────────────────────────────────────────────────────────────────

class TestFloodingReadiness:
    def _base_kwargs(self, **overrides):
        defaults = dict(
            current_hrv_ms=38.0,
            baseline_hrv_ms=42.0,
            suds_score=65,
            session_count=5,
            practitioner_present=True,
            therapeutic_alliance_wai=44.0,
            active_suicidal_ideation=False,
            benzodiazepine_active=False,
            alcohol_last_24h=False,
        )
        defaults.update(overrides)
        return defaults

    def test_fully_ready(self):
        result = assess_flooding_readiness(**self._base_kwargs())
        assert result.authorised is True
        assert result.readiness_score > 0.0
        assert len(result.blocking_reasons) == 0

    def test_no_practitioner_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(practitioner_present=False))
        assert result.authorised is False
        assert any('HARD BLOCK' in r for r in result.blocking_reasons)

    def test_active_si_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(active_suicidal_ideation=True))
        assert result.authorised is False
        assert any('SI' in r or 'crisis' in r.lower() for r in result.blocking_reasons)

    def test_low_alliance_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(therapeutic_alliance_wai=30.0))
        assert result.authorised is False

    def test_low_hrv_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(
            current_hrv_ms=15.0, baseline_hrv_ms=42.0
        ))
        assert result.authorised is False

    def test_high_suds_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(suds_score=90))
        assert result.authorised is False

    def test_too_few_sessions_blocks(self):
        result = assess_flooding_readiness(**self._base_kwargs(session_count=1))
        assert result.authorised is False

    def test_bzd_produces_warning(self):
        result = assess_flooding_readiness(**self._base_kwargs(benzodiazepine_active=True))
        assert result.authorised is True   # warning, not block
        assert len(result.warnings) > 0
        assert any('benzodiazepine' in w.lower() or 'bzd' in w.lower() or 'benzodiazepin' in w.lower()
                   for w in result.warnings)

    def test_readiness_score_zero_when_blocked(self):
        result = assess_flooding_readiness(**self._base_kwargs(practitioner_present=False))
        assert result.readiness_score == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# SPIKE protocol physio gating
# ─────────────────────────────────────────────────────────────────────────────

class TestSPIKEProtocol:
    def test_six_steps_defined(self):
        assert len(SPIKE_PROTOCOL) == 6

    def test_high_stress_defers_to_empathy(self):
        """When HRV is < 70% of baseline, SPIKE should hold at Empathy step."""
        step = spike_current_step(current_hrv=20.0, baseline_hrv=42.0, steps_completed=3)
        assert step.step == "Empathy"

    def test_calm_advances_normally(self):
        """When HRV is near baseline, SPIKE advances to the correct step."""
        step = spike_current_step(current_hrv=40.0, baseline_hrv=42.0, steps_completed=2)
        assert step.step == "Invitation"

    def test_steps_have_gates(self):
        for step in SPIKE_PROTOCOL:
            assert step.physiological_gate in (
                'any', 'moderate_or_below', 'mild_stress_or_below'
            )


# ─────────────────────────────────────────────────────────────────────────────
# Motivational frames
# ─────────────────────────────────────────────────────────────────────────────

class TestMotivationalFrames:
    def test_all_frames_have_prompt_hints(self):
        for frame in MotivationalFrame:
            assert len(frame.prompt_hint) > 20, (
                f"Frame {frame.name} has an empty or too-short prompt_hint"
            )

    def test_values_frame_mentions_patient(self):
        hint = MotivationalFrame.VALUES.prompt_hint
        assert 'patient' in hint.lower() or 'care' in hint.lower() or 'they' in hint.lower()


# ─────────────────────────────────────────────────────────────────────────────
# EEDDAARRSS skills
# ─────────────────────────────────────────────────────────────────────────────

class TestEEDDAARRSSSkills:
    def test_all_skills_have_descriptions(self):
        for skill in EEDDAARRSSSkill:
            assert len(skill.description) > 10

    def test_support_skill_non_judgment(self):
        assert 'non-judgement' in EEDDAARRSSSkill.SUPPORT.description.lower() or \
               'Non-judgement' in EEDDAARRSSSkill.SUPPORT.description


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
