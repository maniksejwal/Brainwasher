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
DEADDICTION       Long-form motivational approach. Four sub-phases with
                  different cost functions per phase:
                    Phase 1 (RAPPORT)     : maximise unconditional positive regard
                    Phase 2 (AMBIVALENCE) : Socratic — surface the patient's own doubts
                    Phase 3 (INSIGHT)     : strategic confrontation after secret detection
                    Phase 4 (STRIKE)      : direct truth delivery in a window of readiness
NEGOTIATION       Principled disagreement: find the response that maximally
                  reduces the other party's BATNA gap while staying within
                  the patient's physiological tolerance band.

References
----------
- Barlow et al. (2004). Psychological treatments. Ann. Rev. Clin. Psychol.
  (flooding / exposure therapy as gold standard for phobias and PTSD)
- Miller & Rollnick (2012). Motivational Interviewing (3rd ed.).
  (deaddiction: OARS model — Open questions, Affirmation, Reflection, Summary)
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
    STANDARD     = "standard"
    FLOODING     = "flooding"
    DEADDICTION  = "deaddiction"
    NEGOTIATION  = "negotiation"


class DeaddictionPhase(str, enum.Enum):
    RAPPORT     = "rapport"      # build trust; no confrontation
    AMBIVALENCE = "ambivalence"  # surface internal conflict through questions
    INSIGHT     = "insight"      # confront gently after secrets emerge
    STRIKE      = "strike"       # direct truth; patient is ready


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
    deaddiction_phase : DeaddictionPhase
        Only used when mode=DEADDICTION.
    flooding_target_stress : float
        Only used when mode=FLOODING.
        The target peak stress level. Responses that push stress toward
        this level are rewarded. Responses that avoid it are penalised.
    flooding_recovery_turns : int
        After the flooding peak, how many turns should recovery take.
        A shorter expected recovery rewards bolder flooding choices.
    negotiation_target_stress_ceiling : float
        Only used when mode=NEGOTIATION.
        Responses that push patient stress above this ceiling are penalised
        even if they advance the negotiation goal.
    n_lookahead : int
        MCTS rollout depth. Default 3 turns.
    exploration_c : float
        UCB1 exploration constant. Higher = more exploration.
    """
    mode: TherapeuticMode = TherapeuticMode.STANDARD
    deaddiction_phase: DeaddictionPhase = DeaddictionPhase.RAPPORT
    flooding_target_stress: float = 0.75
    flooding_recovery_turns: int = 5
    negotiation_target_stress_ceiling: float = 0.60
    n_lookahead: int = 3
    exploration_c: float = 1.414   # √2 (Kocsis & Szepesvári 2006)


def compute_turn_cost(
    stress_t: float,
    mode: TherapeuticMode,
    cfg: MCTSConfig,
    turn_index: int = 0,
) -> float:
    """
    Cost of a single simulated future state under the given therapeutic mode.

    Returns a scalar cost in [0, ∞). MCTS minimises total cost over the path.

    STANDARD   : C = σ_t (minimise stress at every turn)
    FLOODING   : C = |σ_t - target| at peak turn; C = σ_t thereafter
                 (penalise both overshooting and undershooting the target)
    DEADDICTION:
      RAPPORT     C = 1 - σ_t (minimise stress, maximise calm)
      AMBIVALENCE C = |σ_t - 0.35| (hold mild tension, not full calm)
      INSIGHT     C = max(0, 0.65 - σ_t) (reward moderate stress induction)
      STRIKE      C = σ_t * (1 if t > 0 else 0.5) (allow brief spike, then minimise)
    NEGOTIATION : C = σ_t if σ_t < ceiling else σ_t * 3 (hard penalty over ceiling)
    """
    if mode == TherapeuticMode.STANDARD:
        return stress_t

    if mode == TherapeuticMode.FLOODING:
        if turn_index == 0:
            # First turn: reward hitting the target stress level
            return abs(stress_t - cfg.flooding_target_stress)
        else:
            # Subsequent turns: we want fast recovery
            return stress_t

    if mode == TherapeuticMode.DEADDICTION:
        phase = cfg.deaddiction_phase
        if phase == DeaddictionPhase.RAPPORT:
            return stress_t                              # minimise stress — build trust
        if phase == DeaddictionPhase.AMBIVALENCE:
            return abs(stress_t - 0.35)                  # hold mild productive tension
        if phase == DeaddictionPhase.INSIGHT:
            return max(0.0, 0.60 - stress_t)             # reward controlled challenge
        if phase == DeaddictionPhase.STRIKE:
            penalty = 0.5 if turn_index == 0 else 1.0
            return stress_t * penalty                    # brief spike allowed, then decay

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
        mode_keywords = ModeKeywords.for_mode(cfg.mode, cfg.deaddiction_phase)

    words = set(candidate_text.lower().split())
    stress_count = sum(1 for w in words if w in mode_keywords.stress_words)
    calm_count   = sum(1 for w in words if w in mode_keywords.calm_words)
    probe_count  = sum(1 for w in words if w in mode_keywords.probe_words)

    # Build amplification factor
    if cfg.mode == TherapeuticMode.FLOODING:
        # For flooding: challenge keywords LOWER the cost (we WANT stress)
        amp = 1.0 + 0.08 * stress_count - 0.05 * calm_count
    elif cfg.mode == TherapeuticMode.DEADDICTION:
        phase = cfg.deaddiction_phase
        if phase == DeaddictionPhase.RAPPORT:
            amp = 1.0 - 0.06 * calm_count + 0.04 * stress_count
        elif phase == DeaddictionPhase.AMBIVALENCE:
            # Probe questions are rewarded; direct confrontation is not
            amp = 1.0 - 0.05 * probe_count + 0.03 * stress_count - 0.03 * calm_count
        elif phase in (DeaddictionPhase.INSIGHT, DeaddictionPhase.STRIKE):
            # Confrontation words raise stress (intended)
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
            "turn":           t + 1,
            "stress":         round(current_stress, 4),
            "cost":           round(cost, 4),
        })

    return {
        "cumulative_cost":  round(cumulative_cost, 5),
        "amplification":    round(amp, 4),
        "stress_keywords":  stress_count,
        "calm_keywords":    calm_count,
        "probe_keywords":   probe_count,
        "breakdown":        breakdown,
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
        phase: DeaddictionPhase = DeaddictionPhase.RAPPORT,
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

        if mode == TherapeuticMode.DEADDICTION:
            if phase == DeaddictionPhase.RAPPORT:
                return ModeKeywords(
                    stress_words = frozenset({"judgment", "wrong", "should", "must", "failure"}),
                    calm_words   = BASE_CALM | frozenset({
                        "proud", "brave", "no judgment", "your choice", "whenever you're ready",
                        "unconditional", "always here",
                    }),
                    probe_words  = frozenset(),
                )
            if phase == DeaddictionPhase.AMBIVALENCE:
                return ModeKeywords(
                    stress_words = frozenset({"lose", "damage", "risk", "cost"}),
                    calm_words   = frozenset({"but", "however", "on the other hand"}),
                    probe_words  = BASE_PROBE | frozenset({
                        "what matters most", "what would change", "how important",
                        "on a scale", "your words", "i wonder",
                    }),
                )
            if phase in (DeaddictionPhase.INSIGHT, DeaddictionPhase.STRIKE):
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


# ── Phase transition detector ─────────────────────────────────────────────────

@dataclass
class DeaddictionPhaseTracker:
    """
    Tracks which deaddiction phase to use based on longitudinal session data.

    Phase transitions are driven by:
      RAPPORT → AMBIVALENCE : rapport_score >= 0.7 for 3+ sessions
      AMBIVALENCE → INSIGHT : at least 1 secret_signal detected in recent history
      INSIGHT → STRIKE      : subject explicitly acknowledges ambivalence (readiness score)

    secret_signals — patterns in physiological history that indicate
    hidden information:
      - HRV spike followed by rapid change of topic (deflection after stress)
      - Consistent HRV drop when specific topics are mentioned
      - High EDA with low vocal stress (suppression pattern)
    """
    subject_id:       str
    current_phase:    DeaddictionPhase = DeaddictionPhase.RAPPORT
    session_count:    int = 0
    rapport_scores:   list[float] = field(default_factory=list)
    secret_signals:   list[dict]  = field(default_factory=list)
    readiness_score:  float = 0.0

    def record_session(
        self,
        rapport: float,
        secret_detected: bool = False,
        readiness: float = 0.0,
        secret_detail: str = "",
    ) -> DeaddictionPhase:
        """
        Update state after one session. Returns the recommended phase for next session.
        """
        self.session_count  += 1
        self.rapport_scores.append(rapport)
        self.readiness_score = 0.8 * self.readiness_score + 0.2 * readiness

        if secret_detected:
            self.secret_signals.append({
                "session": self.session_count,
                "detail":  secret_detail,
            })

        # Phase transition logic
        if self.current_phase == DeaddictionPhase.RAPPORT:
            recent_rapport = self.rapport_scores[-3:] if len(self.rapport_scores) >= 3 else []
            if len(recent_rapport) >= 3 and min(recent_rapport) >= 0.7:
                self.current_phase = DeaddictionPhase.AMBIVALENCE

        elif self.current_phase == DeaddictionPhase.AMBIVALENCE:
            if len(self.secret_signals) >= 1:
                self.current_phase = DeaddictionPhase.INSIGHT

        elif self.current_phase == DeaddictionPhase.INSIGHT:
            if self.readiness_score >= 0.6:
                self.current_phase = DeaddictionPhase.STRIKE

        return self.current_phase

    def detect_secret_signal(self, hrv_topic_map: dict[str, float]) -> list[dict]:
        """
        Detect secret signals from HRV drops associated with specific topics.

        hrv_topic_map: {topic_string: hrv_rmssd_ms_when_mentioned}
        baseline_hrv:  subject's resting HRV

        Returns a list of detected secrets: [{topic, hrv_drop_ms, confidence}]
        """
        baseline  = sum(hrv_topic_map.values()) / len(hrv_topic_map) if hrv_topic_map else 35.0
        threshold = baseline * 0.75   # >25% drop from mean = suspicious

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
