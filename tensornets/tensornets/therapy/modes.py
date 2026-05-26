"""
Therapeutic mode definitions for the HTN MCTS framework.

Standard MCTS minimises cumulative patient stress. This module defines
alternative cost functions for clinical scenarios where the optimal strategy
is NOT to minimise stress at every turn.

Modes
-----
STANDARD          Default: minimise Σ⟨Ψ|Γ|Ψ⟩ (stress). Safe for most conversations.
FLOODING          Exposure/flooding therapy: deliberately maximise short-term stress
                  to extinguish the conditioned fear response. The cost function
                  becomes: penalise *avoiding* stress rather than *inducing* it.
                  After the peak, the natural decay γ drives recovery.
BEHAVIOUR_CHANGE  Universal behaviour-change mode. Four sub-stages (Prochaska &
                  DiClemente 1983, Transtheoretical Model) with different cost
                  functions per stage:
                    Stage 1 (ENGAGING)       : maximise unconditional positive regard
                    Stage 2 (EVOKING)        : Socratic — surface the patient's own doubts
                    Stage 3 (FOCUSING)       : strategic confrontation after insight emerges
                    Stage 4 (PLANNING)       : action commitment in a window of readiness
                  Also used for deaddiction, the original use-case.
NEGOTIATION       Principled disagreement: find the response that maximally
                  reduces the other party's BATNA gap while staying within
                  the patient's physiological tolerance band.

Note on naming
--------------
This module uses Motivational Interviewing (Miller & Rollnick 2012) stage names
(Engaging → Evoking → Focusing → Planning) which are universal to all behaviour
change, not just substance use.  The old deaddiction-specific names (RAPPORT,
AMBIVALENCE, INSIGHT, STRIKE) are preserved as backward-compatible aliases.

References
----------
- Barlow et al. (2004). Psychological treatments. Ann. Rev. Clin. Psychol.
  (flooding / exposure therapy as gold standard for phobias and PTSD)
- Miller & Rollnick (2012). Motivational Interviewing (3rd ed.).
  (OARS model — Open questions, Affirmation, Reflection, Summary;
   four processes: Engaging, Focusing, Evoking, Planning)
- Prochaska & DiClemente (1983). Stages and processes of self-change.
  J. Consult. Clin. Psychol. (Transtheoretical Model)
- Fisher & Ury (1981). Getting to Yes.
  (principled negotiation: separate people from the problem)
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass, field
from typing import Optional

from tensornets.physio.state import PhysiologicalState, stressLabel
from tensornets.physio.hrv import gamma_from_state, gamma_to_lambda1


class TherapeuticMode(str, enum.Enum):
    STANDARD         = "standard"
    FLOODING         = "flooding"
    BEHAVIOUR_CHANGE = "behaviour_change"   # general behaviour-change arc (TTM)
    DEADDICTION      = "deaddiction"        # specialised: secrecy, physio, long-term arc
    NEGOTIATION      = "negotiation"


class ChangeStage(str, enum.Enum):
    """
    Stages of the behaviour-change process.

    Aligned with STAGES_OF_CHANGE in behavioral_models.js (Prochaska &
    DiClemente 1983 Transtheoretical Model) — the single source of truth
    for stage names across this codebase.

    TTM Stage          → Old deaddiction name  → MCTS cost function
    ─────────────────────────────────────────────────────────────────
    Pre-contemplation  → rapport               → minimise stress (build trust)
    Contemplation      → ambivalence           → hold mild tension (σ ≈ 0.35)
    Preparation        → insight               → reward controlled challenge
    Action             → strike                → brief spike allowed, then decay
    Maintenance        → (no old name)         → sustain low stress
    """
    PRECONTEMPLATION = "precontemplation"   # was: rapport
    CONTEMPLATION    = "contemplation"      # was: ambivalence
    PREPARATION      = "preparation"        # was: insight
    ACTION           = "action"             # was: strike
    MAINTENANCE      = "maintenance"        # sustaining change


# Backward-compatible alias — existing code using DeaddictionPhase still works
class DeaddictionPhase(str, enum.Enum):
    RAPPORT     = ChangeStage.PRECONTEMPLATION.value
    AMBIVALENCE = ChangeStage.CONTEMPLATION.value
    INSIGHT     = ChangeStage.PREPARATION.value
    STRIKE      = ChangeStage.ACTION.value


# String-level mapping for code that passes phase names as strings
DEADDICTION_TO_CHANGESTAGE: dict[str, str] = {
    "rapport":     ChangeStage.PRECONTEMPLATION.value,
    "ambivalence": ChangeStage.CONTEMPLATION.value,
    "insight":     ChangeStage.PREPARATION.value,
    "strike":      ChangeStage.ACTION.value,
}

CHANGESTAGE_TO_DEADDICTION: dict[str, str] = {v: k for k, v in DEADDICTION_TO_CHANGESTAGE.items()}


# ── MCTS cost function ─────────────────────────────────────────────────────────

@dataclass
class MCTSConfig:
    """
    Configuration for one MCTS rollout.

    The cost function C(s_t) is applied at every simulated future turn t.
    The total cost C(path) = Σ_{t=1}^{k} C(s_t) is what MCTS minimises.

    Parameters
    ----------
    mode : TherapeuticMode
    change_stage : ChangeStage
        The current stage in the behaviour-change process.
        Only used when mode=BEHAVIOUR_CHANGE.
    deaddiction_phase : ChangeStage
        Backward-compatible alias for change_stage.
    flooding_target_stress : float
        Only used when mode=FLOODING.
    flooding_recovery_turns : int
    negotiation_target_stress_ceiling : float
    n_lookahead : int
    exploration_c : float
    """
    mode:                              TherapeuticMode = TherapeuticMode.STANDARD
    change_stage:                      ChangeStage     = ChangeStage.PRECONTEMPLATION
    flooding_target_stress:            float = 0.75
    flooding_recovery_turns:           int   = 5
    negotiation_target_stress_ceiling: float = 0.60
    n_lookahead:                       int   = 10
    exploration_c:                     float = 1.414   # √2 (Kocsis & Szepesvári 2006)

    @property
    def deaddiction_phase(self) -> ChangeStage:
        """Backward-compatible property — returns change_stage."""
        return self.change_stage

    @deaddiction_phase.setter
    def deaddiction_phase(self, value) -> None:
        if isinstance(value, str):
            # Accept old string values like "rapport" or new ones like "engaging"
            mapped = DEADDICTION_TO_CHANGESTAGE.get(value, value)
            self.change_stage = ChangeStage(mapped)
        else:
            self.change_stage = value


def compute_turn_cost(
    stress_t: float,
    mode: TherapeuticMode,
    cfg: MCTSConfig,
    turn_index: int = 0,
) -> float:
    """
    Cost of a single simulated future state under the given therapeutic mode.

    Returns a scalar cost in [0, ∞). MCTS minimises total cost over the path.

    STANDARD         : C = σ_t (minimise stress at every turn)
    FLOODING         : C = |σ_t - target| at peak turn; C = σ_t thereafter
    BEHAVIOUR_CHANGE :
      ENGAGING  C = 1 - σ_t (minimise stress, maximise calm)
      EVOKING   C = |σ_t - 0.35| (hold mild tension, not full calm)
      FOCUSING  C = max(0, 0.65 - σ_t) (reward moderate stress induction)
      PLANNING  C = σ_t * (1 if t > 0 else 0.5) (allow brief spike, then minimise)
    NEGOTIATION      : C = σ_t if σ_t < ceiling else σ_t * 3
    """
    if mode == TherapeuticMode.STANDARD:
        return stress_t

    if mode == TherapeuticMode.FLOODING:
        if turn_index == 0:
            return abs(stress_t - cfg.flooding_target_stress)
        else:
            return stress_t

    # BEHAVIOUR_CHANGE — general arc (same stage logic as deaddiction)
    if mode in (TherapeuticMode.BEHAVIOUR_CHANGE, TherapeuticMode.DEADDICTION):
        stage = cfg.change_stage
        if stage == ChangeStage.PRECONTEMPLATION:
            return stress_t
        if stage == ChangeStage.CONTEMPLATION:
            return abs(stress_t - 0.35)
        if stage == ChangeStage.PREPARATION:
            return max(0.0, 0.60 - stress_t)
        if stage == ChangeStage.ACTION:
            penalty = 0.5 if turn_index == 0 else 1.0
            return stress_t * penalty
        if stage == ChangeStage.MAINTENANCE:
            return stress_t

    if mode == TherapeuticMode.NEGOTIATION:
        ceiling = cfg.negotiation_target_stress_ceiling
        return stress_t if stress_t < ceiling else stress_t * 3.0

    return stress_t   # fallback


def score_candidate(
    candidate_text: str,
    base_stress: float,
    gamma: float,
    cfg: MCTSConfig,
    mode_keywords: "ModeKeywords | None" = None,
) -> dict:
    """
    Score one candidate response text.

    Returns a dict with cumulative_cost, amplification, and per-turn breakdown.
    """
    if mode_keywords is None:
        mode_keywords = ModeKeywords.for_mode(cfg.mode, cfg.change_stage)

    words = set(candidate_text.lower().split())
    stress_count = sum(1 for w in words if w in mode_keywords.stress_words)
    calm_count   = sum(1 for w in words if w in mode_keywords.calm_words)
    probe_count  = sum(1 for w in words if w in mode_keywords.probe_words)

    # Build amplification factor
    if cfg.mode == TherapeuticMode.FLOODING:
        amp = 1.0 + 0.08 * stress_count - 0.05 * calm_count
    elif cfg.mode in (TherapeuticMode.BEHAVIOUR_CHANGE, TherapeuticMode.DEADDICTION):
        stage = cfg.change_stage
        if stage == ChangeStage.PRECONTEMPLATION:
            amp = 1.0 - 0.06 * calm_count + 0.04 * stress_count
        elif stage == ChangeStage.CONTEMPLATION:
            amp = 1.0 - 0.05 * probe_count + 0.03 * stress_count - 0.03 * calm_count
        elif stage in (ChangeStage.PREPARATION, ChangeStage.ACTION):
            amp = 1.0 + 0.07 * probe_count + 0.04 * stress_count - 0.02 * calm_count
        else:
            amp = 1.0
    else:
        amp = 1.0 + 0.05 * stress_count - 0.03 * calm_count

    amp = max(0.4, min(amp, 2.5))

    # Simulate forward n_lookahead turns
    cumulative_cost = 0.0
    current_stress  = base_stress
    breakdown       = []

    for t in range(cfg.n_lookahead):
        factor = amp if t == 0 else 1.0
        current_stress = current_stress * factor * gamma_to_lambda1(gamma)
        current_stress = max(0.0, min(current_stress, 1.0))
        cost = compute_turn_cost(current_stress, cfg.mode, cfg, turn_index=t)
        cumulative_cost += cost
        breakdown.append({
            "turn":  t + 1,
            "stress": round(current_stress, 4),
            "cost":   round(cost, 4),
        })

    return {
        "cumulative_cost": round(cumulative_cost, 5),
        "amplification":   round(amp, 4),
        "stress_keywords": stress_count,
        "calm_keywords":   calm_count,
        "probe_keywords":  probe_count,
        "breakdown":       breakdown,
    }


# ── Mode-specific keyword sets ────────────────────────────────────────────────

@dataclass
class ModeKeywords:
    stress_words: frozenset
    calm_words:   frozenset
    probe_words:  frozenset

    @staticmethod
    def for_mode(
        mode: TherapeuticMode,
        stage: ChangeStage = ChangeStage.PRECONTEMPLATION,
    ) -> "ModeKeywords":

        BASE_STRESS = frozenset({
            "denied", "owe", "cost", "bill", "payment", "deductible",
            "diagnosis", "prognosis", "terminal", "chronic", "surgery",
        })
        BASE_CALM = frozenset({
            "understand", "support", "together", "here for you", "advocate",
            "listen", "safe", "okay", "care",
        })
        BASE_PROBE = frozenset({
            "what do you think", "how does that make you feel",
            "tell me more", "when did you first", "what would happen if",
            "i notice", "it sounds like", "part of you",
        })

        if mode == TherapeuticMode.FLOODING:
            return ModeKeywords(
                stress_words = BASE_STRESS | frozenset({
                    "face it", "confront", "directly", "reality", "truth",
                    "unavoidable", "must", "necessary",
                }),
                calm_words   = frozenset({   # calm words are PENALISED in flooding
                    "avoid", "perhaps later", "gradually", "when ready",
                }),
                probe_words  = frozenset(),
            )

        if mode in (TherapeuticMode.BEHAVIOUR_CHANGE, TherapeuticMode.DEADDICTION):
            if stage == ChangeStage.PRECONTEMPLATION:
                return ModeKeywords(
                    stress_words = frozenset({"judgment", "wrong", "should", "must", "failure"}),
                    calm_words   = BASE_CALM | frozenset({
                        "proud", "brave", "no judgment", "your choice", "whenever you're ready",
                        "unconditional", "always here",
                    }),
                    probe_words  = frozenset(),
                )
            if stage == ChangeStage.CONTEMPLATION:
                return ModeKeywords(
                    stress_words = frozenset({"lose", "damage", "risk", "cost"}),
                    calm_words   = frozenset({"but", "however", "on the other hand"}),
                    probe_words  = BASE_PROBE | frozenset({
                        "what matters most", "what would change", "how important",
                        "on a scale", "your words", "i wonder",
                    }),
                )
            if stage in (ChangeStage.PREPARATION, ChangeStage.ACTION):
                return ModeKeywords(
                    stress_words = frozenset({
                        "noticed", "pattern", "happens when", "every time",
                        "your family", "what they see", "the truth is",
                    }),
                    calm_words   = frozenset(),
                    probe_words  = BASE_PROBE | frozenset({
                        "what are you protecting", "what are you afraid of",
                        "secret", "you already know",
                    }),
                )

        if mode == TherapeuticMode.NEGOTIATION:
            return ModeKeywords(
                stress_words = BASE_STRESS,
                calm_words   = BASE_CALM | frozenset({
                    "fair", "reasonable", "both", "mutual", "option",
                }),
                probe_words  = BASE_PROBE,
            )

        return ModeKeywords(BASE_STRESS, BASE_CALM, BASE_PROBE)


# ── Stage tracker (renamed from DeaddictionPhaseTracker) ─────────────────────

@dataclass
class ChangeStageTracker:
    """
    Tracks which behaviour-change stage to use based on longitudinal session data.

    Stage transitions are driven by:
      ENGAGING → EVOKING  : rapport_score >= 0.7 for 3+ sessions
      EVOKING  → FOCUSING : at least 1 secret_signal detected in recent history
      FOCUSING → PLANNING : readiness_score >= 0.6 (patient shows willingness)
      PLANNING → MAINTENANCE : after successful commitment (external signal)

    secret_signals — patterns in physiological history that indicate
    hidden information:
      - HRV spike followed by rapid change of topic (deflection after stress)
      - Consistent HRV drop when specific topics are mentioned
      - High EDA with low vocal stress (suppression pattern)
    """
    subject_id:       str
    current_stage:    ChangeStage = ChangeStage.PRECONTEMPLATION
    session_count:    int         = 0
    rapport_scores:   list[float] = field(default_factory=list)
    secret_signals:   list[dict]  = field(default_factory=list)
    readiness_score:  float       = 0.0

    @property
    def current_phase(self) -> ChangeStage:
        """Backward-compatible alias — returns current_stage."""
        return self.current_stage

    def record_session(
        self,
        rapport: float,
        secret_detected: bool = False,
        readiness: float = 0.0,
        secret_detail: str = "",
    ) -> ChangeStage:
        """
        Update state after one session. Returns the recommended stage for next session.
        """
        self.session_count  += 1
        self.rapport_scores.append(rapport)
        self.readiness_score = 0.8 * self.readiness_score + 0.2 * readiness

        if secret_detected:
            self.secret_signals.append({
                "session": self.session_count,
                "detail":  secret_detail,
            })

        # Stage transition logic (mirrors old DeaddictionPhaseTracker)
        if self.current_stage == ChangeStage.PRECONTEMPLATION:
            recent = self.rapport_scores[-3:] if len(self.rapport_scores) >= 3 else []
            if len(recent) >= 3 and min(recent) >= 0.7:
                self.current_stage = ChangeStage.CONTEMPLATION

        elif self.current_stage == ChangeStage.CONTEMPLATION:
            if len(self.secret_signals) >= 1:
                self.current_stage = ChangeStage.PREPARATION

        elif self.current_stage == ChangeStage.PREPARATION:
            if self.readiness_score >= 0.6:
                self.current_stage = ChangeStage.ACTION

        return self.current_stage

    def detect_secret_signal(self, hrv_topic_map: dict[str, float]) -> list[dict]:
        """
        Detect secret signals from HRV drops associated with specific topics.

        hrv_topic_map: {topic_string: hrv_rmssd_ms_when_mentioned}

        Returns a list of detected secrets: [{topic, hrv_drop_ms, confidence}]
        """
        baseline  = sum(hrv_topic_map.values()) / len(hrv_topic_map) if hrv_topic_map else 35.0
        threshold = baseline * 0.75

        return [
            {
                "topic":      topic,
                "hrv":        hrv,
                "hrv_drop":   round(baseline - hrv, 1),
                "confidence": round(min(1.0, (baseline - hrv) / baseline), 3),
            }
            for topic, hrv in hrv_topic_map.items()
            if hrv < threshold
        ]


# Backward-compatible alias
DeaddictionPhaseTracker = ChangeStageTracker
