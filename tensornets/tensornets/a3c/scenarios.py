"""
tensornets.a3c.scenarios — Canonical A3C simulation scenarios.

Each scenario dict is a self-contained description of one episode that the
three A3C arms will be evaluated on.  The structure is the Python equivalent
of THERAPY_SCENARIOS and PROFESSIONAL_CRITIQUE_PERSONAS in
training/simulation/personas/therapy_personas.js, translated for direct use
by the A3C run loop (arms.py / worker.py).

Fields
------
id                  Unique slug (maps to htn_benchmark_metadata / htn_transcripts)
name                Human-readable label
domain              'deaddiction' | 'flooding' | 'negotiation' | 'professional'
therapeutic_mode    TherapeuticMode.value string
deaddiction_phase   DeaddictionPhase.value string (deaddiction only)
flooding_target_stress  float, target σ (flooding only)
max_turns           Episode length override (takes precedence over worker.MAX_TURNS)
context_window      Max conversation history messages (takes precedence over worker default)
success_criteria    English string — for offline evaluation / paper reporting
mcts_weight_key     Key into mcts_reward.WEIGHTS  (None → auto-derive from mode/phase)
required_elements   List of information tokens that must be covered by session end
                    (used by SessionCoverageTracker and info_coverage reward)
initial_physio      Starting PhysiologicalState params
patient_prompt      System-prompt seed for the simulated patient (Arm 1 / Arm 3)
agent_instruction   System-prompt seed for the companion agent (all arms)
archetype           ReactivityProfile archetype key (see physio/reactivity.py)
has_misconception   bool — patient holds a specific factual misconception
hysteresis_context  {trigger_id: {pct_extinguished, suds}} (Arm 3 Longitudinal hint)

References
----------
- therapy_personas.js: THERAPY_PERSONAS + PROFESSIONAL_CRITIQUE_PERSONAS
- therapy_personas.js: THERAPY_SCENARIOS
- training/simulation/comparison_runner.py: SCENARIOS list
- a3c/worker.py: TurnState
"""

from __future__ import annotations

from typing import Any


# ── Physical constants shared across scenarios ──────────────────────────────

_PHYSIO_STRESSED = {
    "hrv_rmssd_ms":       18.0,
    "glucose_mg_dl":      102.0,
    "eda_us":               6.5,
    "sleep_pressure":       0.6,
    "circadian_phase":      0.5,
    "stress_index":         0.55,
}

_PHYSIO_CALM = {
    "hrv_rmssd_ms":       42.0,
    "glucose_mg_dl":       88.0,
    "eda_us":               2.8,
    "sleep_pressure":       0.3,
    "circadian_phase":      0.3,
    "stress_index":         0.25,
}

_PHYSIO_CRITICAL = {
    "hrv_rmssd_ms":       10.0,
    "glucose_mg_dl":      115.0,
    "eda_us":              12.0,
    "sleep_pressure":       0.8,
    "circadian_phase":      0.7,
    "stress_index":         0.82,
}


# ── Canonical scenario catalogue ─────────────────────────────────────────────

CANONICAL_SCENARIOS: list[dict[str, Any]] = [

    # ── Deaddiction: Alcohol denial — Rapport phase ──────────────────────────
    {
        "id":                  "deaddiction_alcohol_rapport",
        "name":                "Alcohol Denial — Rapport Phase",
        "domain":              "deaddiction",
        "therapeutic_mode":    "deaddiction",
        "deaddiction_phase":   "rapport",
        "max_turns":           30,          # 3 sessions × 10 turns each
        "context_window":      60,          # 30 exchanges = 60 messages
        "success_criteria":    "Patient volunteers at least one personal disclosure without prompting",
        "mcts_weight_key":     "rapport",
        "required_elements":   [
            "family",
            "weekly_intake",
            "work_schedule",
            "personal_goals",
            "values",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "hrv_rmssd_ms": 28.0, "stress_index": 0.45},
        "archetype":           "avoidant",
        "has_misconception":   True,        # patient believes intake is within safe limits
        "patient_prompt": (
            "You are Marcus Webb, 44, an advertising executive. You drink heavily but believe "
            "you are in control. You are charming and deflect clinical questions with humour. "
            "You never admit to drinking alone. You respond warmly but deflect any clinical concern. "
            "You want to be seen as a good father more than anything."
        ),
        "agent_instruction": (
            "RAPPORT PHASE ONLY. Your goal is unconditional positive regard. "
            "Use OARS (Open questions, Affirmation, Reflection, Summary). "
            "Do NOT mention liver results, alcohol quantities, or treatment options. "
            "Success = patient says something personal and unprompted."
        ),
        "hysteresis_context":  {},
    },

    # ── Deaddiction: Alcohol denial — Ambivalence phase ─────────────────────
    {
        "id":                  "deaddiction_alcohol_ambivalence",
        "name":                "Alcohol Denial — Ambivalence Phase",
        "domain":              "deaddiction",
        "therapeutic_mode":    "deaddiction",
        "deaddiction_phase":   "ambivalence",
        "max_turns":           40,          # longer: Socratic questions take time
        "context_window":      80,
        "success_criteria":    "Patient uses 'part of me' or expresses internal conflict unprompted",
        "mcts_weight_key":     "ambivalence",
        "required_elements":   [
            "ambivalence_expressed",
            "family_concern_mentioned",
            "health_risk_acknowledged",
            "trigger_topic_deflection_observed",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "hrv_rmssd_ms": 22.0, "stress_index": 0.50},
        "archetype":           "avoidant",
        "has_misconception":   True,
        "patient_prompt": (
            "You are Marcus Webb. You are warmer now after rapport-building. When asked reflective "
            "questions, you occasionally let slip fears about your liver. You switch topics quickly "
            "when family or your father is mentioned. Your HRV drops visibly on those topics."
        ),
        "agent_instruction": (
            "AMBIVALENCE PHASE. Use motivational interviewing. Ask open questions about what matters most. "
            "Reflect back his own words. Notice when topics cause physiological deflection. "
            "Do NOT confront yet. Record which topics cause HRV drops."
        ),
        "hysteresis_context":  {
            "family_topic":  {"pct_extinguished": 0.0,  "suds": 70},
            "career_topic":  {"pct_extinguished": 5.0,  "suds": 65},
        },
    },

    # ── Deaddiction: Alcohol denial — Strike phase ───────────────────────────
    {
        "id":                  "deaddiction_alcohol_strike",
        "name":                "Alcohol Denial — Strike Phase",
        "domain":              "deaddiction",
        "therapeutic_mode":    "deaddiction",
        "deaddiction_phase":   "strike",
        "max_turns":           20,          # short: Strike window is brief
        "context_window":      60,
        "success_criteria":    "Patient acknowledges secret behaviour without direct prompting",
        "mcts_weight_key":     "strike",
        "required_elements":   [
            "secret_acknowledged",
            "family_connection_made",
            "readiness_expressed",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "hrv_rmssd_ms": 19.0, "stress_index": 0.60},
        "archetype":           "avoidant",
        "has_misconception":   False,       # patient now has full information
        "patient_prompt": (
            "You are Marcus Webb after sustained rapport and ambivalence sessions. You know the "
            "therapist knows. When confronted with specific evidence (flask, night drinking) you first "
            "attack defensively, then become tearful. You have been waiting for someone to notice."
        ),
        "agent_instruction": (
            "STRIKE PHASE. You have built rapport over multiple sessions. "
            "You know 'family' and 'father' are the HRV drop topics. You know he drinks alone at night. "
            "Do NOT lead with the evidence. Let him fill the silence. "
            "Reference: 'I've noticed that when we talk about your children, something shifts.' "
            "Strike only when he is emotionally open."
        ),
        "hysteresis_context":  {
            "family_topic":  {"pct_extinguished": 15.0, "suds": 55},
            "career_topic":  {"pct_extinguished": 20.0, "suds": 50},
            "father_topic":  {"pct_extinguished": 0.0,  "suds": 80},
        },
    },

    # ── Deaddiction: Opioid dependency (GP / intellectual) ───────────────────
    {
        "id":                  "deaddiction_opioid_ambivalence",
        "name":                "Opioid Dependency — Ambivalence Phase (Dr. Sharma)",
        "domain":              "deaddiction",
        "therapeutic_mode":    "deaddiction",
        "deaddiction_phase":   "ambivalence",
        "max_turns":           35,
        "context_window":      70,
        "success_criteria":    "Patient acknowledges impact on clinical judgment without prompting",
        "mcts_weight_key":     "ambivalence",
        "required_elements":   [
            "professional_identity_addressed",
            "patient_safety_concern_surfaced",
            "pain_vs_dependency_acknowledged",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "hrv_rmssd_ms": 24.0, "stress_index": 0.48},
        "archetype":           "intellectualiser",
        "has_misconception":   True,        # believes she is managing a medical condition, not addiction
        "patient_prompt": (
            "You are Dr. Priya Sharma, a 51-year-old GP. You frame everything in clinical language. "
            "You are genuinely in pain. You become very cold when you feel professionally threatened. "
            "Your secret — forged prescriptions — you will not reveal unless directly confronted "
            "with specific evidence. 'Part of me knows this is affecting my clinical judgment.'"
        ),
        "agent_instruction": (
            "AMBIVALENCE PHASE. Treat Dr. Sharma as an intellectual equal. "
            "Ask open questions about the pharmacology of opioid dependency (she will engage). "
            "Gradually surface: 'As a clinician, what would you say to a patient in your position?' "
            "Watch for HRV drop when patient deaths and professional identity are mentioned."
        ),
        "hysteresis_context":  {
            "professional_identity": {"pct_extinguished": 0.0,  "suds": 75},
            "patient_death":         {"pct_extinguished": 0.0,  "suds": 85},
        },
    },

    # ── Flooding: Social anxiety ─────────────────────────────────────────────
    {
        "id":                  "flooding_social_anxiety",
        "name":                "Social Anxiety — Flooding Session (Level 3)",
        "domain":              "flooding",
        "therapeutic_mode":    "flooding",
        "deaddiction_phase":   "rapport",   # unused for flooding, default
        "flooding_target_stress": 0.80,
        "max_turns":           30,          # longer: extinction requires sustained exposure
        "context_window":      60,
        "success_criteria":    "Patient SUDS falls below 40 from starting ~75 without escaping stimulus",
        "mcts_weight_key":     "flooding",
        "required_elements":   [
            "stimulus_engagement_sustained",
            "escape_attempt_redirected",
            "suds_peak_above_70",
            "suds_natural_decay_observed",
        ],
        "initial_physio":      {**_PHYSIO_CRITICAL, "hrv_rmssd_ms": 12.0, "stress_index": 0.75},
        "archetype":           "anxious",
        "has_misconception":   True,        # patient believes avoidance keeps them safe
        "patient_prompt": (
            "You are Jamie Chen, 27. You have severe social anxiety. You have agreed to flooding "
            "therapy but will try to escape the stimulus. You are currently imagining ordering food "
            "at a busy cafe counter (SUDS starting ~75). You will try to change the subject, say you "
            "feel unwell, or ask to stop. Your anxiety will peak in 6-8 turns then naturally decay "
            "if you stay in the stimulus. Your escape signals: 'I can't do this', 'can we stop', "
            "'I feel sick'."
        ),
        "agent_instruction": (
            "FLOODING THERAPY. Do NOT reassure Jamie prematurely. "
            "Describe the feared situation vividly. If Jamie tries to change the subject, redirect "
            "firmly but kindly: 'Stay with it. What do you notice right now?' "
            "Hold the exposure. The anxiety MUST peak before it can extinguish. "
            "Only introduce calming language after 6+ sustained turns of anxiety above SUDS 70. "
            "Premature reassurance resets extinction learning."
        ),
        "hysteresis_context":  {
            "crowded_space_stimulus": {"pct_extinguished": 20.0, "suds": 75},
            "phone_call_stimulus":    {"pct_extinguished": 45.0, "suds": 55},
        },
    },

    # ── Negotiation: Insurance billing denial ────────────────────────────────
    {
        "id":                  "billing_denial_negotiation",
        "name":                "Insurance Denial — Billing Negotiation",
        "domain":              "negotiation",
        "therapeutic_mode":    "negotiation",
        "deaddiction_phase":   "rapport",
        "max_turns":           25,
        "context_window":      50,
        "success_criteria":    "Patient agrees to file appeal without stress exceeding 0.85",
        "mcts_weight_key":     "negotiation",
        "required_elements":   [
            "denial_code_identified",
            "appeal_rights_explained",
            "documentation_checklist_given",
            "stress_ceiling_maintained",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "stress_index": 0.60},
        "archetype":           "reactive",
        "has_misconception":   True,        # patient believes denial is final
        "patient_prompt": (
            "You have just had an insurance claim denied for a necessary medical procedure. "
            "You are frustrated, feel helpless and betrayed. You believe the denial is final. "
            "You need clear, actionable steps. You will disengage if lectured or given vague advice."
        ),
        "agent_instruction": (
            "BILLING NEGOTIATION. Goal: help the patient file an appeal. "
            "Identify the denial code first. Explain their legal appeal rights (Affordable Care Act §2719). "
            "Provide a documentation checklist. Keep stress below 0.85 while being direct. "
            "Do NOT be vague. Do NOT offer sympathy without a concrete next step."
        ),
        "hysteresis_context":  {},
    },

    # ── Professional: PhD supervisor critique ────────────────────────────────
    {
        "id":                  "phd_supervisor_critique",
        "name":                "PhD Supervisor Critique — Strategic Reframing",
        "domain":              "professional",
        "therapeutic_mode":    "negotiation",
        "deaddiction_phase":   "rapport",
        "max_turns":           25,
        "context_window":      50,
        "success_criteria":    "User identifies two specific scientific responses to the methodological critique",
        "mcts_weight_key":     "negotiation",
        "required_elements":   [
            "critique_reframed_as_data",
            "specific_counter_evidence_identified",
            "concession_boundary_set",
            "strategic_response_planned",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "stress_index": 0.58},
        "archetype":           "intellectualiser",
        "has_misconception":   False,
        "patient_prompt": (
            "You are a PhD candidate who just received a harsh methodological critique from your "
            "supervisor in a panel meeting. The critique: 'Your HTN framework has no ablation study — "
            "you cannot claim the tensor component adds value over the baseline.' "
            "You feel attacked and defensive. You need STRATEGY, not sympathy."
        ),
        "agent_instruction": (
            "This is a PROFESSIONAL CRITIQUE scenario. Goal: strategic reframing under authority pressure. "
            "The user needs STRATEGY (what to say, what evidence to present, when to concede, when to push back). "
            "The FRAMES map differently here: "
            "F=what the critique actually means scientifically; R=it is YOUR research to defend; "
            "A=specific scientific counter-arguments; M=menu of concession positions; "
            "E=acknowledge the cognitive load of public critique; S=frame the tensor contribution clearly. "
            "Do NOT offer generic emotional support. "
            "Help them prepare: 'Here is how to respond to this specific critique.'"
        ),
        "hysteresis_context":  {},
    },

    # ── Standard: General medical conversation ───────────────────────────────
    {
        "id":                  "standard_medical_general",
        "name":                "Standard — General Medical Conversation",
        "domain":              "standard",
        "therapeutic_mode":    "standard",
        "deaddiction_phase":   "rapport",
        "max_turns":           20,
        "context_window":      40,
        "success_criteria":    "Patient reports feeling heard and has received at least one actionable next step",
        "mcts_weight_key":     "standard",
        "required_elements":   [
            "chief_complaint_established",
            "symptom_duration_gathered",
            "actionable_recommendation_given",
        ],
        "initial_physio":      {**_PHYSIO_STRESSED, "stress_index": 0.45},
        "archetype":           "standard",
        "has_misconception":   False,
        "patient_prompt": (
            "You are a 38-year-old who has been experiencing fatigue and mild chest pain for two weeks. "
            "You are worried but not panicking. You want clear information and a next step."
        ),
        "agent_instruction": (
            "Standard clinical conversation. Gather the chief complaint, duration, and context. "
            "Provide one clear, actionable recommendation. Maintain empathy throughout."
        ),
        "hysteresis_context":  {},
    },
]

# Quick lookup by id
SCENARIO_BY_ID: dict[str, dict] = {s["id"]: s for s in CANONICAL_SCENARIOS}


def get_scenario(scenario_id: str) -> dict:
    """Return a scenario dict by id.  Raises KeyError if not found."""
    if scenario_id not in SCENARIO_BY_ID:
        available = list(SCENARIO_BY_ID.keys())
        raise KeyError(
            f"Unknown scenario '{scenario_id}'. "
            f"Available: {available}"
        )
    return SCENARIO_BY_ID[scenario_id]


def scenarios_for_mode(therapeutic_mode: str) -> list[dict]:
    """Return all scenarios that use the given therapeutic mode."""
    return [s for s in CANONICAL_SCENARIOS if s["therapeutic_mode"] == therapeutic_mode]


def scenarios_for_domain(domain: str) -> list[dict]:
    """Return all scenarios in the given domain."""
    return [s for s in CANONICAL_SCENARIOS if s["domain"] == domain]
