"""
session_manager.py — Multi-Session State Manager
=================================================

PURPOSE
-------
A "session" in this system = one continuous online episode of a user
interacting with their companion.  Sessions are bounded by login/logout,
not by conversation topics.

This module manages:
  1. SESSION LIFECYCLE — open, tick (per turn), close
  2. BETWEEN-SESSION STATE — persisting PhysiologicalState, hysteretic models,
     MCTS action history across sessions
  3. LONGITUDINAL MCTS — selecting the best therapeutic phase/strategy for the
     NEXT session based on accumulated history
  4. MULTI-SESSION SIMULATION — running N sessions programmatically for training

WHAT "MULTI-SESSION" MEANS HERE
--------------------------------
Single-session MCTS:
  - Plans within ONE continuous login episode
  - State: (physio_t, w_t, h_t, alliance_t, phase_t) at current turn
  - Depth: 3-10 turns

Multi-session (Longitudinal) MCTS:
  - Plans ACROSS login episodes (weeks/months)
  - State: LongitudinalState (session_count, rapport_scores, secrets, w_t_avg, h_t)
  - Action space: which deaddiction phase to target; when to introduce flooding;
    when to increase directness
  - Depth: 3-5 sessions ahead
  - Reward: readiness_score delta, alliance trend, goal_progress accumulation

The two are nested: longitudinal MCTS decides macro-strategy;
within-session MCTS executes the micro-actions.

COMPARISON WITH JS IMPLEMENTATION
----------------------------------
The JS system (CompanionCoordinator.js) manages per-session context but does NOT
persist physiological state between sessions. Each login starts fresh from DB.
This module provides the Python side of that persistence, callable via FastAPI.

PRIVACY NOTE
------------
All session state is keyed by subject_id (anonymised).
No PII is stored in this module — only physiological signals and behavioural scores.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from tensornets.physio.state import PhysiologicalState
from tensornets.physio.hysteresis import TriggerHysteresis
from tensornets.physio.habit_hysteresis import BehaviourHysteresis
from tensornets.agents.companion_hysteresis import CompanionRelationshipState
from tensornets.therapy.longitudinal import LongitudinalState, load_state, save_state


# ─────────────────────────────────────────────────────────────────────────────
# Session record (single login episode)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class TurnRecord:
    turn: int
    action_taken: str
    physio_stress: float
    reward_scalar: float
    llm_model: str = ""
    timestamp: float = field(default_factory=time.time)


@dataclass
class SessionRecord:
    session_id: str
    subject_id: str
    start_time: float
    end_time: Optional[float] = None
    therapeutic_mode: str = "standard"
    deaddiction_phase: str = "precontemplation"
    turns: list[TurnRecord] = field(default_factory=list)
    final_stress: float = 0.5
    peak_stress: float = 0.5
    rapport_score: float = 0.0
    secret_detected: bool = False
    secret_detail: str = ""
    topic_hrv_map: dict = field(default_factory=dict)
    session_goal: str = ""
    goal_achieved: bool = False
    companion_rupture: bool = False
    notes: str = ""

    @property
    def duration_minutes(self) -> float:
        if self.end_time:
            return (self.end_time - self.start_time) / 60.0
        return 0.0

    @property
    def n_turns(self) -> int:
        return len(self.turns)

    @property
    def mean_reward(self) -> float:
        if not self.turns:
            return 0.0
        return sum(t.reward_scalar for t in self.turns) / len(self.turns)


# ─────────────────────────────────────────────────────────────────────────────
# Between-session persistent state
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SubjectPersistentState:
    """
    Everything that survives across login episodes.
    This is serialised to disk and loaded at each session start.
    """
    subject_id: str
    last_seen: float = field(default_factory=time.time)
    session_count: int = 0

    # Physiological baseline (updated after each session)
    hrv_baseline_ms: float = 35.0
    hrv_rolling_3session_avg: float = 35.0

    # Fear hysteresis (per trigger)
    trigger_states: dict = field(default_factory=dict)  # trigger_id → {w_current, w_original}

    # Habit hysteresis (per behaviour)
    habit_states: dict = field(default_factory=dict)   # habit_label → {h, relapse_count}

    # Companion relationship
    alliance: float = 0.3
    trust: float = 0.3
    strategic_patience: float = 1.0
    rupture_count: int = 0

    # Therapeutic progress
    deaddiction_phase: str = "precontemplation"
    rapport_scores: list = field(default_factory=list)
    readiness_score: float = 0.0
    secrets: list = field(default_factory=list)

    # Work-life preference (user-declared or inferred)
    contact_preference: dict = field(default_factory=lambda: {
        'allow_late_night': False,       # 3am calls
        'work_life_mixed': True,         # true = willing to discuss work in personal sessions
        'quiet_hours_start': 22,         # 22:00
        'quiet_hours_end': 8,            # 08:00
        'preferred_session_length_min': 15,
        'max_sessions_per_week': 5,
    })

    history: list[dict] = field(default_factory=list)  # lightweight session summaries


class SessionManager:
    """
    Manages the full lifecycle of a subject's sessions.

    Usage (FastAPI endpoint):
        manager = SessionManager(state_dir="tensornets/state")
        session = manager.open_session(subject_id, therapeutic_mode, deaddiction_phase)
        # ... turns ...
        manager.record_turn(session, turn_record)
        manager.close_session(session, rapport_score=0.6, goal_achieved=True)
    """

    def __init__(self, state_dir: str = "state"):
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._active: dict[str, SessionRecord] = {}

    def open_session(
        self,
        subject_id: str,
        therapeutic_mode: str = "standard",
        deaddiction_phase: str = "precontemplation",
        session_goal: str = "",
    ) -> SessionRecord:
        """
        Called when the user comes online.
        Loads the persistent state, checks contact preferences,
        and creates a new SessionRecord.
        """
        state = self._load_or_create(subject_id)

        # Contact preference check
        pref = state.contact_preference
        current_hour = time.localtime().tm_hour
        quiet = pref.get('quiet_hours_start', 22)
        wake = pref.get('quiet_hours_end', 8)
        in_quiet = (quiet <= current_hour or current_hour < wake)
        if in_quiet and not pref.get('allow_late_night', False):
            # Still create session but flag it
            session_goal = session_goal or "QUIET_HOURS: brief check-in only"

        import uuid
        session_id = str(uuid.uuid4())[:8]
        session = SessionRecord(
            session_id=session_id,
            subject_id=subject_id,
            start_time=time.time(),
            therapeutic_mode=therapeutic_mode,
            deaddiction_phase=deaddiction_phase or state.deaddiction_phase,
            session_goal=session_goal,
        )
        self._active[subject_id] = session
        return session

    def record_turn(self, session: SessionRecord, turn: TurnRecord) -> None:
        session.turns.append(turn)
        session.peak_stress = max(session.peak_stress, turn.physio_stress)

    def close_session(
        self,
        session: SessionRecord,
        final_stress: float,
        rapport_score: float = 0.0,
        secret_detected: bool = False,
        secret_detail: str = "",
        topic_hrv_map: dict | None = None,
        goal_achieved: bool = False,
    ) -> SubjectPersistentState:
        """
        Called when the user goes offline.
        Updates all persistent state: alliance, hysteresis, phase progression.
        Returns the updated persistent state.
        """
        session.end_time = time.time()
        session.final_stress = final_stress
        session.rapport_score = rapport_score
        session.secret_detected = secret_detected
        session.secret_detail = secret_detail
        session.topic_hrv_map = topic_hrv_map or {}
        session.goal_achieved = goal_achieved

        state = self._load_or_create(session.subject_id)
        state.session_count += 1
        state.last_seen = time.time()
        state.rapport_scores.append(rapport_score)
        if goal_achieved:
            state.readiness_score = min(1.0, state.readiness_score + 0.05)

        # Update alliance from this session
        rel = self._get_companion_rel(state)
        weights = rel.update_after_session(
            session=state.session_count,
            rapport_gain=rapport_score,
            rupture_event=session.companion_rupture,
            patient_compliant=goal_achieved or rapport_score > 0.5,
        )
        state.alliance = rel.alliance
        state.trust = rel.trust
        state.strategic_patience = rel.strategic_patience
        state.rupture_count = rel.rupture_count

        # Phase progression
        state.deaddiction_phase = self._maybe_advance_phase(state, session)

        # Habit hysteresis tick (time passed since last session)
        days_since = (state.last_seen - time.time()) / 86400.0
        # (Days will be 0 on first close; real elapsed tracked by last_seen update)

        if secret_detected:
            state.secrets.append({'detail': secret_detail, 'session': state.session_count})

        # Rolling HRV baseline
        state.hrv_rolling_3session_avg = (
            0.7 * state.hrv_rolling_3session_avg
            + 0.3 * (35.0 - final_stress * 15.0)  # approximate
        )

        # Store lightweight summary
        state.history.append({
            'session': state.session_count,
            'mode': session.therapeutic_mode,
            'phase': session.deaddiction_phase,
            'n_turns': session.n_turns,
            'mean_reward': round(session.mean_reward, 3),
            'rapport': round(rapport_score, 3),
            'goal_achieved': goal_achieved,
        })
        # Keep only last 20 summaries
        state.history = state.history[-20:]

        self._save(state)
        self._active.pop(session.subject_id, None)
        return state

    def longitudinal_mcts_hint(self, subject_id: str) -> dict:
        """
        Lightweight longitudinal MCTS: based on session history, recommend
        the optimal deaddiction phase and strategy for the NEXT session.

        This is a greedy 1-step lookahead (not a full tree search) because
        the between-session action space is small (5 phases × 3 modes).

        Returns: {
            recommended_phase: str,
            recommended_mode: str,
            rationale: str,
            readiness_score: float,
            sessions_until_ready_for_flooding: int|None,
        }
        """
        state = self._load_or_create(subject_id)
        if state.session_count < 3:
            return {
                'recommended_phase': 'rapport',
                'recommended_mode': 'standard',
                'rationale': f'Only {state.session_count} sessions completed. Build alliance first.',
                'readiness_score': state.readiness_score,
                'sessions_until_ready_for_flooding': None,
            }

        # Trend analysis
        recent = state.rapport_scores[-3:] if len(state.rapport_scores) >= 3 else state.rapport_scores
        rapport_trend = (recent[-1] - recent[0]) / max(1, len(recent) - 1) if len(recent) > 1 else 0.0

        # Phase recommendation
        phase = state.deaddiction_phase
        if phase == 'rapport' and state.alliance > 0.55 and rapport_trend > 0:
            phase = 'ambivalence'
            rationale = f'Alliance strong ({state.alliance:.2f}), trend positive. Advance to ambivalence.'
        elif phase == 'ambivalence' and state.readiness_score > 0.3 and state.secrets:
            phase = 'insight'
            rationale = 'Secrets detected, readiness building. Advance to insight.'
        elif phase == 'insight' and state.readiness_score > 0.6:
            phase = 'strike'
            rationale = f'Readiness {state.readiness_score:.2f} — ready for direct challenge.'
        else:
            rationale = (
                f'Continue {phase}. Alliance={state.alliance:.2f}, '
                f'readiness={state.readiness_score:.2f}, '
                f'rapport_trend={rapport_trend:+.2f}/session.'
            )

        # Flooding readiness estimate
        flooding_ready = (
            state.alliance > 0.6
            and state.readiness_score > 0.4
            and state.session_count >= 5
        )
        sessions_until_flooding = None
        if not flooding_ready:
            sessions_needed = max(0, 5 - state.session_count)
            alliance_gap = max(0, 0.6 - state.alliance) / 0.04  # ~0.04/session gain
            sessions_until_flooding = max(sessions_needed, int(alliance_gap))

        return {
            'recommended_phase': phase,
            'recommended_mode': 'deaddiction' if 'deaddiction' in state.deaddiction_phase else 'standard',
            'rationale': rationale,
            'readiness_score': round(state.readiness_score, 3),
            'alliance': round(state.alliance, 3),
            'session_count': state.session_count,
            'sessions_until_ready_for_flooding': sessions_until_flooding,
            'contact_preference': state.contact_preference,
        }

    def check_contact_permission(self, subject_id: str) -> dict:
        """
        Checks whether it is appropriate to contact the user right now.
        Call before initiating any proactive outreach.
        """
        state = self._load_or_create(subject_id)
        pref = state.contact_preference
        hour = time.localtime().tm_hour
        quiet_start = pref.get('quiet_hours_start', 22)
        quiet_end = pref.get('quiet_hours_end', 8)
        in_quiet = (hour >= quiet_start or hour < quiet_end)

        if in_quiet and not pref.get('allow_late_night', False):
            return {
                'permitted': False,
                'reason': f'Quiet hours ({quiet_start}:00–{quiet_end}:00). User has not opted in to late contact.',
                'next_permitted_hour': quiet_end,
            }
        return {
            'permitted': True,
            'reason': 'Within preferred contact window.',
        }

    # ── Private helpers ──────────────────────────────────────────────────────

    def _path(self, subject_id: str) -> Path:
        return self.state_dir / f"{subject_id}.json"

    def _load_or_create(self, subject_id: str) -> SubjectPersistentState:
        p = self._path(subject_id)
        if p.exists():
            data = json.loads(p.read_text())
            return SubjectPersistentState(**{k: v for k, v in data.items()
                                             if k in SubjectPersistentState.__dataclass_fields__})
        return SubjectPersistentState(subject_id=subject_id)

    def _save(self, state: SubjectPersistentState) -> None:
        p = self._path(state.subject_id)
        p.write_text(json.dumps(asdict(state), indent=2))

    def _get_companion_rel(self, state: SubjectPersistentState) -> CompanionRelationshipState:
        rel = CompanionRelationshipState(user_id=state.subject_id, role='patient')
        rel.alliance = state.alliance
        rel.trust = state.trust
        rel.strategic_patience = state.strategic_patience
        rel.rupture_count = state.rupture_count
        rel.session_count = state.session_count
        return rel

    def _maybe_advance_phase(
        self, state: SubjectPersistentState, session: SessionRecord
    ) -> str:
        """Simple rule-based phase gate — will be replaced by longitudinal MCTS."""
        phase = state.deaddiction_phase
        if phase == 'rapport' and state.alliance >= 0.55 and len(state.rapport_scores) >= 3:
            return 'ambivalence'
        if phase == 'ambivalence' and state.readiness_score >= 0.3 and state.secrets:
            return 'insight'
        if phase == 'insight' and state.readiness_score >= 0.6:
            return 'strike'
        return phase


# ─────────────────────────────────────────────────────────────────────────────
# Multi-session simulation runner (for training data generation)
# ─────────────────────────────────────────────────────────────────────────────

def simulate_multi_session(
    subject_id: str,
    n_sessions: int,
    persona_stress_baseline: float = 0.5,
    therapeutic_mode: str = "deaddiction",
    seed: int = 42,
    state_dir: str = "state/sim",
) -> list[dict]:
    """
    Runs N simulated sessions for a subject and returns session summaries.

    Used for:
    1. Training data generation (LLM-as-judge can evaluate each session)
    2. Longitudinal MCTS validation (does the phase advance at the right rate?)
    3. Alliance hysteresis trajectory visualisation

    Each simulated session:
    - Generates random rapport_score from beta distribution centred on persona
    - Simulates occasional rupture events (5% probability)
    - Simulates goal achievement based on phase and stress

    This is NOT a full LLM simulation — it is a structural scaffolding for
    validating the longitudinal models. Full LLM simulation uses ConversationRunner.js.
    """
    import random
    random.seed(seed)

    manager = SessionManager(state_dir=state_dir)
    summaries = []

    for i in range(n_sessions):
        # Simulate session quality (higher in later sessions as alliance builds)
        state = manager._load_or_create(subject_id)
        expected_rapport = 0.3 + 0.05 * state.session_count * (1 - persona_stress_baseline)
        rapport = min(0.95, max(0.05, random.gauss(expected_rapport, 0.1)))
        rupture = random.random() < 0.05
        goal_achieved = rapport > 0.5 and random.random() < 0.4
        final_stress = persona_stress_baseline * (1 - 0.02 * state.session_count)
        final_stress = max(0.1, min(0.9, final_stress + random.gauss(0, 0.05)))

        session = manager.open_session(
            subject_id,
            therapeutic_mode=therapeutic_mode,
            deaddiction_phase=state.deaddiction_phase,
        )
        session.companion_rupture = rupture

        # Simulate 5-8 turns
        n_turns = random.randint(5, 8)
        for t in range(n_turns):
            turn_stress = final_stress + random.gauss(0, 0.05)
            manager.record_turn(session, TurnRecord(
                turn=t, action_taken='simulated', physio_stress=turn_stress,
                reward_scalar=rapport * (1 - turn_stress),
            ))

        updated = manager.close_session(
            session, final_stress=final_stress,
            rapport_score=rapport, goal_achieved=goal_achieved,
        )

        hint = manager.longitudinal_mcts_hint(subject_id)
        summaries.append({
            'session': i + 1,
            'phase': session.deaddiction_phase,
            'rapport': round(rapport, 3),
            'final_stress': round(final_stress, 3),
            'rupture': rupture,
            'goal_achieved': goal_achieved,
            'alliance': round(updated.alliance, 3),
            'recommended_next_phase': hint['recommended_phase'],
            'readiness': round(hint['readiness_score'], 3),
        })

    return summaries


if __name__ == "__main__":
    import shutil
    # Clean up demo state
    shutil.rmtree("state/sim", ignore_errors=True)

    print("=" * 65)
    print("MULTI-SESSION SIMULATION — 10 deaddiction sessions")
    print("=" * 65)
    results = simulate_multi_session(
        subject_id="demo_marcus",
        n_sessions=10,
        persona_stress_baseline=0.6,
        therapeutic_mode="deaddiction",
    )
    print(f"\n{'S':>3} {'Phase':<12} {'Rapport':>7} {'Stress':>7} "
          f"{'Alliance':>8} {'Next phase':<14} {'Ready':>6}")
    print("-" * 65)
    for r in results:
        rupture_flag = " !" if r['rupture'] else "  "
        print(f"{r['session']:>3}{rupture_flag} {r['phase']:<12} {r['rapport']:>7.3f} "
              f"{r['final_stress']:>7.3f} {r['alliance']:>8.3f} "
              f"{r['recommended_next_phase']:<14} {r['readiness']:>6.3f}")

    shutil.rmtree("state/sim", ignore_errors=True)
    print("\nDone. State cleaned up.")
