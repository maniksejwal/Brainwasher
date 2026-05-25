"""
met_framework.py — Motivational Enhancement Therapy (MET) Protocol
===================================================================

PURPOSE
-------
Formalises the MET/MI skills referenced in the existing project prompts into
structures that MCTS and the LLM prompts can use.

This file implements:
  1. OARS — the four core MI micro-skills
  2. EEDDAARRSS — the extended skill set for longer MI sessions
  3. Frames — the five strategic motivational frames
  4. SPIKE protocol — structured bad-news delivery adapted for clinical companions
  5. DeaddictionMCTSProtocol — phases, transitions, and gating for MCTS
  6. FloodingReadiness — criteria that MUST be met before flooding is initiated

THEORETICAL BASIS
-----------------
Miller, W.R. & Rollnick, S. (2013). Motivational Interviewing, 3rd ed. Guilford.
  - OARS (p.62): Open questions, Affirmation, Reflection, Summary.
  - EEDDAARRSS (p.300–350): Extended skill set for complex MI sessions.

Bakal, M., et al. (2023). Digital MI in addiction: systematic review.
  J Subst Abuse Treat, 147, 108723.
  Establishes that structured MI skill tagging improves AI session fidelity.

SPIKE Protocol:
  Rabow, M.W., & McPhee, S.J. (1999). Beyond breaking bad news.
  West J Med, 171(4), 260–263.
  Originally for oncology, adapted here for clinical companion.

Flooding / Prolonged Exposure:
  Foa, E.B., & McLean, C.P. (2016). The efficacy of exposure therapy for
  anxiety-related disorders. Annu Rev Clin Psychol, 12, 1–28.
  - Readiness criteria: therapeutic alliance (WAI > 36), SUDS < 80 at session
    start, no active SI, trained practitioner present.

CLINICAL SAFETY NOTE
--------------------
Flooding / prolonged exposure is contraindicated without a licensed practitioner.
The FloodingReadiness class gates the mode. The system DOES NOT initiate flooding
autonomously — it surfaces the criteria to the practitioner's companion and
requires explicit authorisation.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# 1. OARS micro-skills
# ─────────────────────────────────────────────────────────────────────────────

class OARSSkill(Enum):
    OPEN_QUESTION  = "O"  # Invites elaboration; cannot be answered yes/no
    AFFIRMATION    = "A"  # Recognises strengths and efforts
    REFLECTION     = "R"  # Simple or complex reflection of meaning
    SUMMARY        = "S"  # Collects and transitions

    @classmethod
    def classify(cls, text: str) -> Optional["OARSSkill"]:
        """Heuristic classifier — replace with fine-tuned classifier for production."""
        t = text.lower()
        q_words = ("what", "how", "tell me", "describe", "can you", "when",
                   "why do you", "what does")
        aff_words = ("you managed", "you showed", "that took courage",
                     "i see your strength", "you're working hard",
                     "you already", "you've been")
        ref_words = ("it sounds like", "you feel", "what i hear is",
                     "so for you", "it seems", "you're saying",
                     "if i understand")
        sum_words = ("so to recap", "to summarise", "so we've talked about",
                     "you've mentioned", "pulling together")
        if any(t.startswith(q) for q in q_words) or t.endswith("?"):
            return cls.OPEN_QUESTION
        if any(p in t for p in aff_words):
            return cls.AFFIRMATION
        if any(p in t for p in ref_words):
            return cls.REFLECTION
        if any(p in t for p in sum_words):
            return cls.SUMMARY
        return None


OARS_PROMPT_INJECTION = {
    OARSSkill.OPEN_QUESTION: (
        "Use an open question that begins with 'What', 'How', or 'Tell me about'. "
        "Do not ask a yes/no question. The goal is to invite elaboration."
    ),
    OARSSkill.AFFIRMATION: (
        "Affirm a specific strength or effort the patient has shown. Be concrete. "
        "Avoid generic praise. Reference something they actually said or did."
    ),
    OARSSkill.REFLECTION: (
        "Reflect back the emotional meaning, not just the words. "
        "Use 'It sounds like...', 'You're feeling...', or 'What I hear is...'."
    ),
    OARSSkill.SUMMARY: (
        "Summarise what the patient has shared, connecting themes. "
        "End with a transition: 'What does that mean for you going forward?'"
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# 2. EEDDAARRSS — extended MI skill set (Miller & Rollnick 2013, p.300-350)
# ─────────────────────────────────────────────────────────────────────────────

class EEDDAARRSSSkill(Enum):
    ENGAGE          = "E1"  # Build therapeutic alliance
    ELICIT          = "E2"  # Draw out client's own motivation
    DIRECT          = "D1"  # Provide clear guidance (when asked)
    DEVELOP         = "D2"  # Develop discrepancy between current/desired
    AFFIRM          = "A1"  # Recognise strengths (same as OARS A)
    ADVISE          = "A2"  # Offer advice with permission
    REFLECT         = "R1"  # Reflective listening (same as OARS R)
    REFRAME         = "R2"  # Shift perspective without arguing
    SUMMARISE       = "S1"  # Collect and transition (same as OARS S)
    SUPPORT         = "S2"  # Unconditional positive regard

    @property
    def description(self) -> str:
        return {
            "E1": "Build alliance; don't rush to behaviour change",
            "E2": "Ask 'What makes you think change might be important?'",
            "D1": "Only when client asks; use Ask-Tell-Ask structure",
            "D2": "Highlight gap between values and current behaviour",
            "A1": "Specific genuine affirmation of effort or strength",
            "A2": "Ask permission; 'Would it be okay if I shared something?'",
            "R1": "Simple or complex reflection of words/meaning",
            "R2": "Reframe to generate new meaning, not to correct",
            "S1": "Transition summary linking themes",
            "S2": "Non-judgement; client is accepted regardless of choice",
        }[self.value]


# TTM stage → allowed skill set (gate for MCTS candidate generation)
# Key names mirror ChangeStage enum in therapy/modes.py (Prochaska & DiClemente TTM).
# Old names (rapport/ambivalence/insight/strike) are kept as aliases below for
# backward-compat with any persisted session state that still carries them.
DEADDICTION_PHASE_SKILLS = {
    "precontemplation": [EEDDAARRSSSkill.ENGAGE, EEDDAARRSSSkill.SUPPORT,
                         EEDDAARRSSSkill.AFFIRM, EEDDAARRSSSkill.REFLECT],
    "contemplation":    [EEDDAARRSSSkill.ELICIT, EEDDAARRSSSkill.DEVELOP,
                         EEDDAARRSSSkill.REFRAME, EEDDAARRSSSkill.SUMMARISE,
                         EEDDAARRSSSkill.REFLECT],
    "preparation":      [EEDDAARRSSSkill.ELICIT, EEDDAARRSSSkill.DEVELOP,
                         EEDDAARRSSSkill.REFRAME, EEDDAARRSSSkill.ADVISE,
                         EEDDAARRSSSkill.DIRECT],
    "action":           [EEDDAARRSSSkill.DIRECT, EEDDAARRSSSkill.DEVELOP,
                         EEDDAARRSSSkill.ADVISE, EEDDAARRSSSkill.SUMMARISE],
    "maintenance":      [EEDDAARRSSSkill.AFFIRM, EEDDAARRSSSkill.SUPPORT,
                         EEDDAARRSSSkill.SUMMARISE, EEDDAARRSSSkill.REFLECT],
}
# Backward-compat aliases (old deaddiction phase names → TTM keys)
DEADDICTION_PHASE_SKILLS["rapport"]     = DEADDICTION_PHASE_SKILLS["precontemplation"]
DEADDICTION_PHASE_SKILLS["ambivalence"] = DEADDICTION_PHASE_SKILLS["contemplation"]
DEADDICTION_PHASE_SKILLS["insight"]     = DEADDICTION_PHASE_SKILLS["preparation"]
DEADDICTION_PHASE_SKILLS["strike"]      = DEADDICTION_PHASE_SKILLS["action"]


# ─────────────────────────────────────────────────────────────────────────────
# 3. Motivational Frames (Rollnick et al. 2010)
# ─────────────────────────────────────────────────────────────────────────────

class MotivationalFrame(Enum):
    """Strategic framing applied to a response to increase change talk."""
    IMPORTANCE   = "importance"    # Why does change matter to this person?
    CONFIDENCE   = "confidence"    # Can they do it?
    READINESS    = "readiness"     # Are they ready now?
    VALUES       = "values"        # Connects change to core personal values
    CONSEQUENCES = "consequences"  # Highlights the cost of not changing

    @property
    def prompt_hint(self) -> str:
        return {
            "importance": (
                "Frame the response to surface why this change matters to the "
                "patient specifically. Use their own words from earlier. "
                "Do NOT tell them it should matter."
            ),
            "confidence": (
                "Focus on past successes and existing strengths that suggest "
                "the patient can succeed. Use past examples they mentioned."
            ),
            "readiness": (
                "Gently explore whether now is the right time. "
                "Acknowledge competing priorities. Do NOT push."
            ),
            "values": (
                "Connect the behaviour change to something the patient said they "
                "care about: family, health, future self, identity."
            ),
            "consequences": (
                "Briefly highlight the realistic cost of not changing, using "
                "information they provided. Use once only. Do not lecture."
            ),
        }[self.value]


# ─────────────────────────────────────────────────────────────────────────────
# 4. SPIKE Protocol (Rabow & McPhee 1999) — bad-news delivery
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SPIKEStep:
    step: str
    question: str
    action: str
    physiological_gate: str  # min HRV requirement as a string label


SPIKE_PROTOCOL = [
    SPIKEStep(
        step="Setting",
        question="Is the environment appropriate for serious information?",
        action="Ensure privacy. Confirm no distractions. Sit at same level.",
        physiological_gate="mild_stress_or_below",   # HRV >= 60% baseline
    ),
    SPIKEStep(
        step="Perception",
        question="What does the patient already know or believe?",
        action="Ask first: 'What have you been told about your situation?'",
        physiological_gate="mild_stress_or_below",
    ),
    SPIKEStep(
        step="Invitation",
        question="How much does the patient want to know right now?",
        action=(
            "'Would it be okay if I shared what we know? "
            "You can tell me to stop at any time.'"
        ),
        physiological_gate="mild_stress_or_below",
    ),
    SPIKEStep(
        step="Knowledge",
        question="Deliver the information clearly, in small chunks.",
        action=(
            "One piece at a time. Pause. Check understanding. "
            "Avoid jargon. Use patient's language."
        ),
        physiological_gate="moderate_or_below",   # HRV >= 50% baseline
    ),
    SPIKEStep(
        step="Empathy",
        question="What emotion is the patient experiencing right now?",
        action=(
            "Name and validate the emotion. "
            "'This is a lot to take in. How are you feeling right now?'"
        ),
        physiological_gate="any",
    ),
    SPIKEStep(
        step="Strategy/Summary",
        question="What are the next steps?",
        action=(
            "Only proceed to planning when HRV is recovering. "
            "Summarise. Offer a written summary. Schedule follow-up."
        ),
        physiological_gate="mild_stress_or_below",
    ),
]

SPIKE_HRV_GATES = {
    "any":                   0.0,   # ratio of current/baseline
    "moderate_or_below":     0.5,
    "mild_stress_or_below":  0.7,
}

def spike_current_step(current_hrv: float, baseline_hrv: float,
                       steps_completed: int) -> SPIKEStep:
    """
    Returns the appropriate SPIKE step given physiological state.
    If the patient is too stressed for the current step, hold at Empathy.
    """
    ratio = current_hrv / max(1.0, baseline_hrv)
    target = SPIKE_PROTOCOL[min(steps_completed, len(SPIKE_PROTOCOL) - 1)]
    gate = SPIKE_HRV_GATES[target.physiological_gate]
    if ratio >= gate:
        return target
    # Too stressed for the target step — hold at Empathy
    return SPIKE_PROTOCOL[4]  # Empathy step


# ─────────────────────────────────────────────────────────────────────────────
# 5. Flooding readiness gating
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FloodingReadinessResult:
    authorised: bool
    blocking_reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    readiness_score: float = 0.0  # 0-1; 1 = fully ready


def assess_flooding_readiness(
    current_hrv_ms: float,
    baseline_hrv_ms: float,
    suds_score: int,                   # Subjective Units of Distress Scale 0-100
    session_count: int,                # Number of prior sessions in this protocol
    practitioner_present: bool,        # Must be True — hard gate
    therapeutic_alliance_wai: float,   # Working Alliance Inventory score (0-60)
    active_suicidal_ideation: bool,
    benzodiazepine_active: bool,       # BZD blunts habituation (Foa 2016)
    alcohol_last_24h: bool,
) -> FloodingReadinessResult:
    """
    Gate function for initiating flooding / prolonged exposure.

    Based on:
    - Foa & McLean (2016) efficacy of exposure therapy
    - Craske et al. (2014) maximising inhibitory learning in exposure
    - APA clinical guidelines for PTSD (2017)

    The system CANNOT initiate flooding autonomously.
    practitioner_present=True is a hard requirement.
    """
    blocks = []
    warnings = []
    score_components = []

    # HARD REQUIREMENTS (unoverridable)
    if not practitioner_present:
        blocks.append(
            "HARD BLOCK: Licensed practitioner not confirmed present. "
            "Flooding requires direct clinical supervision (Foa & McLean 2016)."
        )
    if active_suicidal_ideation:
        blocks.append(
            "HARD BLOCK: Active SI reported. Flooding is contraindicated. "
            "Activate crisis protocol immediately."
        )

    # PHYSIOLOGICAL GATES
    hrv_ratio = current_hrv_ms / max(1.0, baseline_hrv_ms)
    if hrv_ratio < 0.7:
        blocks.append(
            f"HRV at {hrv_ratio:.0%} of baseline ({current_hrv_ms:.0f}ms). "
            f"Minimum 70% required. Patient in sympathetic dominance; "
            f"habituation is impaired at this arousal level (Craske 2014)."
        )
    else:
        score_components.append(hrv_ratio)

    if suds_score > 80:
        blocks.append(
            f"SUDS={suds_score}. Maximum 80 for session start. "
            f"Initiate grounding first. Re-assess in 15 min."
        )
    else:
        score_components.append(1.0 - suds_score / 100.0)

    # ALLIANCE
    if therapeutic_alliance_wai < 36:
        blocks.append(
            f"Therapeutic alliance (WAI={therapeutic_alliance_wai:.0f}) below threshold 36. "
            f"Patients leave flooding with insufficient alliance (Foa 2016)."
        )
    else:
        score_components.append(min(1.0, therapeutic_alliance_wai / 60.0))

    # SESSION HISTORY
    if session_count < 3:
        blocks.append(
            f"Only {session_count} prior sessions. Minimum 3 sessions of "
            f"psychoeducation and treatment rationale before exposure (PE manual, Foa 2007)."
        )
    else:
        score_components.append(min(1.0, session_count / 10.0))

    # PHARMACOLOGICAL
    if benzodiazepine_active:
        warnings.append(
            "Active benzodiazepine: inhibitory learning may be blunted "
            "(Foa 2016; Otto et al. 2010). Consider timing around trough."
        )
    if alcohol_last_24h:
        warnings.append(
            "Alcohol in last 24h: GABAergic effect impairs habituation. "
            "Recommend postponing exposure."
        )

    readiness = float(sum(score_components) / max(1, len(score_components)))
    authorised = len(blocks) == 0

    return FloodingReadinessResult(
        authorised=authorised,
        blocking_reasons=blocks,
        warnings=warnings,
        readiness_score=readiness if authorised else 0.0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 6. What MCTS contributes to flooding (not the authorisation — the timing)
# ─────────────────────────────────────────────────────────────────────────────

"""
MCTS ROLE IN FLOODING (once practitioner has authorised)
---------------------------------------------------------

The practitioner authorises flooding.
MCTS manages the within-session exposure trajectory.

A flooding session has three sub-phases:
  1. CALIBRATE:  Identify the SUDS target (e.g., 70-80 on a 100-scale).
                 MCTS selects the hierarchy entry point.

  2. HOLD:       Maintain exposure — prevent premature reassurance.
                 MCTS penalises avoidance candidates heavily.
                 Available_strategies() narrows options as SUDS rises.

  3. HABITUATE:  Monitor for SUDS decline (natural habituation signal).
                 When HRV recovers and SUDS drops spontaneously, MCTS
                 recognises the habituation signal and allows a brief
                 consolidation response.

  4. GENERALISE: Plan the next exposure step up the fear hierarchy.
                 MCTS uses the hysteresis model to predict how much
                 extinction generalises to the next trigger (Bouton 2004:
                 generalisation decays with stimulus dissimilarity).

The key MCTS advantage here is the HOLD phase:
  An LLM prompted to "maintain exposure" will drift toward reassurance
  in 3-4 turns because its training distribution overwhelmingly represents
  empathic/comforting text. MCTS forces the system to hold by making
  premature reassurance a cost of infinity (hard constraint).

Experiment: E-006b measures this directly.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Deaddiction MCTS protocol (OARS + EEDDAARRSS + frames integrated)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DeaddictionPhaseContext:
    phase: str
    allowed_skills: list[EEDDAARRSSSkill]
    allowed_frames: list[MotivationalFrame]
    mcts_cost_weights: dict  # {dimension: weight} for RewardVector
    transition_signals: list[str]

DEADDICTION_PROTOCOL = {
    "precontemplation": DeaddictionPhaseContext(
        phase="precontemplation",
        allowed_skills=DEADDICTION_PHASE_SKILLS["precontemplation"],
        allowed_frames=[MotivationalFrame.VALUES, MotivationalFrame.CONFIDENCE],
        mcts_cost_weights={
            "stress_reduction": 0.5,
            "trust_delta":      0.4,
            "goal_progress":    0.1,   # low — don't push for behaviour change yet
        },
        transition_signals=[
            "patient voluntarily mentions problem",
            "patient asks about change",
            "rapport_score > 0.7",
        ],
    ),
    "contemplation": DeaddictionPhaseContext(
        phase="contemplation",
        allowed_skills=DEADDICTION_PHASE_SKILLS["contemplation"],
        allowed_frames=[
            MotivationalFrame.IMPORTANCE, MotivationalFrame.VALUES,
            MotivationalFrame.CONSEQUENCES,
        ],
        mcts_cost_weights={
            "stress_reduction": 0.3,
            "trust_delta":      0.3,
            "goal_progress":    0.3,
            "info_coverage":    0.1,
        },
        transition_signals=[
            "patient expresses change_talk ≥ 3 turns",
            "patient acknowledges discrepancy",
            "ambivalence_score < 0.3",
        ],
    ),
    "preparation": DeaddictionPhaseContext(
        phase="preparation",
        allowed_skills=DEADDICTION_PHASE_SKILLS["preparation"],
        allowed_frames=[
            MotivationalFrame.IMPORTANCE, MotivationalFrame.READINESS,
            MotivationalFrame.CONSEQUENCES,
        ],
        mcts_cost_weights={
            "stress_reduction": 0.2,
            "trust_delta":      0.2,
            "goal_progress":    0.5,
            "info_coverage":    0.1,
        },
        transition_signals=[
            "secret detected (HRV suppression on specific topic)",
            "patient asks direct question about their problem",
            "readiness_ruler ≥ 7/10",
        ],
    ),
    "action": DeaddictionPhaseContext(
        phase="action",
        allowed_skills=DEADDICTION_PHASE_SKILLS["action"],
        allowed_frames=[
            MotivationalFrame.CONSEQUENCES, MotivationalFrame.READINESS,
        ],
        mcts_cost_weights={
            "stress_reduction": 0.1,
            "trust_delta":      0.1,
            "goal_progress":    0.7,
            "info_coverage":    0.1,
        },
        transition_signals=[
            "patient agrees to change plan",
            "session ends",
        ],
    ),
    "maintenance": DeaddictionPhaseContext(
        phase="maintenance",
        allowed_skills=DEADDICTION_PHASE_SKILLS["maintenance"],
        allowed_frames=[
            MotivationalFrame.CONFIDENCE, MotivationalFrame.VALUES,
        ],
        mcts_cost_weights={
            "stress_reduction": 0.2,
            "trust_delta":      0.3,
            "goal_progress":    0.4,
            "info_coverage":    0.1,
        },
        transition_signals=[
            "sustained behaviour change ≥ 6 months",
            "patient reports no craving events",
        ],
    ),
}

def get_phase_context(phase: str) -> DeaddictionPhaseContext:
    return DEADDICTION_PROTOCOL.get(phase, DEADDICTION_PROTOCOL["precontemplation"])

def phase_prompt_injection(phase: str) -> str:
    ctx = get_phase_context(phase)
    skill_desc = "\n".join(
        f"  - {s.name}: {s.description}" for s in ctx.allowed_skills
    )
    frame_hints = "\n".join(
        f"  - {f.name}: {f.prompt_hint}" for f in ctx.allowed_frames
    )
    return (
        f"THERAPEUTIC PHASE: {phase.upper()}\n\n"
        f"ALLOWED SKILLS for this phase (do not use skills from other phases):\n"
        f"{skill_desc}\n\n"
        f"MOTIVATIONAL FRAMES available:\n"
        f"{frame_hints}\n\n"
        f"MCTS priority: "
        + ", ".join(
            f"{k}={v}" for k, v in ctx.mcts_cost_weights.items()
        )
        + "\n\nDo NOT confront, argue, or directly contradict the patient in this phase."
        if phase in ("precontemplation", "contemplation")
        else ""
    )


# ─────────────────────────────────────────────────────────────────────────────
# Demo
# ─────────────────────────────────────────────────────────────────────────────

def worked_example():
    print("=" * 70)
    print("MET FRAMEWORK DEMO")
    print("=" * 70)

    # OARS classification
    print("\n--- OARS Classification ---")
    lines = [
        "What makes you think this might be a problem for you?",
        "You showed real courage in coming here today.",
        "It sounds like you feel trapped between two things you care about.",
        "So to recap, you've mentioned that you want to cut down but feel like you can't.",
    ]
    for line in lines:
        skill = OARSSkill.classify(line)
        print(f"  [{skill.name if skill else 'UNKNOWN'}] {line}")

    # Flooding readiness
    print("\n--- Flooding Readiness Assessment ---")
    result = assess_flooding_readiness(
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
    print(f"  Authorised: {result.authorised}")
    print(f"  Readiness score: {result.readiness_score:.2f}")
    for w in result.warnings:
        print(f"  WARNING: {w}")
    for b in result.blocking_reasons:
        print(f"  BLOCKED: {b}")

    # Deaddiction phase prompt
    print("\n--- Deaddiction Phase Injection (rapport) ---")
    print(phase_prompt_injection("precontemplation")[:500])

    # SPIKE
    print("\n--- SPIKE current step (HRV=28, baseline=40, step 3) ---")
    step = spike_current_step(28.0, 40.0, 3)
    print(f"  Step: {step.step} | Action: {step.action}")


if __name__ == "__main__":
    worked_example()
