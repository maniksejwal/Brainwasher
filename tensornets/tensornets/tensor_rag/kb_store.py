"""
tensornets.tensor_rag.kb_store
================================
ClinicalKnowledgeBase: static clinical knowledge chunks for TensorRAG.

Bundles 90+ clinical knowledge entries covering:
  - Motivational Interviewing (MI) core techniques
  - Stages of Change (Transtheoretical Model)
  - De-escalation and crisis response protocols
  - Medication adherence strategies
  - Deaddiction / substance use disorder guidance
  - Cardiac / physiological risk communication
  - Sleep hygiene and circadian health
  - Caregiver burnout and compassion fatigue
  - Predictive escalation response templates
  - HITL annotation guidance

Each chunk has a physiological annotation: the stress zone where it is
most relevant.  This allows TensorRAG to retrieve:
  - De-escalation techniques when the patient is in HIGH STRESS
  - Motivational techniques when the patient is in MODERATE STRESS
  - Goal-setting techniques when the patient is at BASELINE

The physio annotations are encoded as physio_features() vectors so they
participate in the composite retrieval score.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np

from tensornets.tensor_rag.index   import PhysioConditionedIndex, RetrievedChunk
from tensornets.tensor_rag.encoder import physio_features

log = logging.getLogger(__name__)

INDEX_PATH = Path("data/rag/clinical_kb.index")
SOURCE_TAG = "clinical_kb"

# ── Clinical knowledge entries ────────────────────────────────────────────────
# Format: (text, physio_zone)
# physio_zone: "baseline" | "moderate_stress" | "high_stress" | "crisis"

_KNOWLEDGE: list[tuple[str, str]] = [

    # ── Motivational Interviewing ─────────────────────────────────────────────
    (
        "MI Technique: Reflective Listening. "
        "Repeat back what the patient said in different words to demonstrate understanding. "
        "Simple reflections mirror content; complex reflections add meaning or emotion. "
        "Example: 'So it sounds like you're feeling pulled in two directions — part of you wants to quit, but another part isn't sure you can.' "
        "Avoid questions disguised as statements.",
        "moderate_stress"
    ),
    (
        "MI Technique: Developing Discrepancy. "
        "Gently surface the gap between the patient's stated values and their current behaviour. "
        "Ask: 'You mentioned family is the most important thing to you — how does your current drinking affect your family life?' "
        "Do NOT argue or lecture; the patient should voice the discrepancy themselves.",
        "moderate_stress"
    ),
    (
        "MI Technique: Rolling with Resistance. "
        "When a patient pushes back, do not argue. Acknowledge their perspective, reframe it, and continue. "
        "Avoid direct confrontation. Example: 'You sound frustrated with all these suggestions — it makes sense that you know your own situation best.' "
        "Then offer a different perspective without insisting.",
        "high_stress"
    ),
    (
        "MI Technique: Affirmation. "
        "Recognise the patient's strengths, efforts, and past successes. "
        "Example: 'You've managed to go 3 days without drinking — that takes real strength, especially during a stressful week.' "
        "Affirmations should be genuine and specific, not generic praise.",
        "baseline"
    ),
    (
        "MI Technique: OARS — Open Questions, Affirmations, Reflections, Summaries. "
        "Open questions invite elaboration ('What concerns do you have about cutting down?'). "
        "Affirmations recognise strengths. Reflections demonstrate understanding. "
        "Summaries consolidate what was discussed and reinforce change talk.",
        "moderate_stress"
    ),
    (
        "MI Technique: Change Talk Elicitation. "
        "Evoke Desire, Ability, Reasons, Need (DARN) and Commitment, Activation, Taking Steps (CATS). "
        "Ask: 'On a scale of 0–10, how important is it to you to make this change? What would it take to move from X to X+2?' "
        "Commitment language ('I will...') is the strongest predictor of behaviour change.",
        "moderate_stress"
    ),
    (
        "MI Technique: Importance and Confidence Rulers. "
        "Ask 'How important is it for you to [change]? (0–10)' and 'How confident are you that you could [change] if you decided to? (0–10)'. "
        "Follow up: 'Why a 5 and not a 2?' This surfaces intrinsic motivation without prompting.",
        "baseline"
    ),

    # ── Stages of Change ─────────────────────────────────────────────────────
    (
        "Stages of Change — Pre-contemplation: The patient is not yet considering change. "
        "They may deny there is a problem or minimise its impact. "
        "Intervention: raise awareness gently; plant seeds of doubt; avoid lecturing; "
        "ask about their experience ('What do others in your life think about your drinking?').",
        "moderate_stress"
    ),
    (
        "Stages of Change — Contemplation: The patient is ambivalent — considering change but not committed. "
        "They weigh pros and cons. Intervention: develop discrepancy; explore ambivalence; "
        "use decisional balance exercise ('What are the good things about your current behaviour? What concerns you?').",
        "moderate_stress"
    ),
    (
        "Stages of Change — Preparation: The patient is planning to change soon. "
        "They may be gathering information or setting a start date. "
        "Intervention: help build a concrete plan; identify potential barriers; strengthen commitment.",
        "baseline"
    ),
    (
        "Stages of Change — Action: The patient is actively making changes. "
        "Support and reinforce. Help manage setbacks. "
        "Intervention: affirm progress; problem-solve obstacles; maintain engagement.",
        "baseline"
    ),
    (
        "Stages of Change — Maintenance: The patient has maintained change for 6+ months. "
        "Relapse prevention focus. "
        "Intervention: identify high-risk situations; develop coping strategies; plan for lapses.",
        "baseline"
    ),
    (
        "Stages of Change — Relapse: A lapse or full relapse has occurred. "
        "Do NOT treat as failure. Frame as a learning experience. "
        "Intervention: express empathy; avoid shame; explore what triggered the relapse; "
        "help return to contemplation or action stage quickly.",
        "high_stress"
    ),

    # ── De-escalation and crisis ──────────────────────────────────────────────
    (
        "De-escalation — Acute Distress Response (high stress). "
        "When HRV drops below 20ms or patient expresses acute distress: "
        "1. Validate feelings: 'That sounds incredibly overwhelming.' "
        "2. Lower the cognitive load: do NOT give information, advice, or complex questions. "
        "3. Use short sentences. Stay present: 'I'm here with you.' "
        "4. Offer grounding: '5-4-3-2-1 technique — name 5 things you can see right now.' "
        "5. Do NOT escalate information delivery until HRV recovers.",
        "high_stress"
    ),
    (
        "De-escalation — Flooding Protocol. "
        "In deliberate flooding (exposure) sessions, mild discomfort is therapeutic. "
        "Distinguish: therapeutic discomfort (expected, manageable) vs acute crisis (unexpected, unmanageable). "
        "If patient expresses panic or dissociation, STOP flooding immediately. "
        "Return to safe grounding before any further exposure work.",
        "high_stress"
    ),
    (
        "Crisis Intervention — Suicidal Ideation. "
        "If patient expresses suicidal thoughts: "
        "1. Take it seriously. Do NOT say 'you don't really mean that.' "
        "2. Ask directly: 'Are you thinking about ending your life?' (asking does not increase risk). "
        "3. Assess plan and intent: 'Do you have a plan? Do you have access to means?' "
        "4. Stay with the patient — do not leave them alone. "
        "5. Involve emergency services if imminent risk. "
        "6. Contact clinical companion / clinician immediately.",
        "crisis"
    ),
    (
        "Crisis Intervention — Domestic Violence Disclosure. "
        "If patient discloses domestic abuse: "
        "1. Believe them. Do NOT suggest they may be exaggerating. "
        "2. Safety first: 'Are you safe right now?' "
        "3. Do NOT pressure them to leave immediately — this can increase danger. "
        "4. Provide resources: national helpline, safety planning. "
        "5. Escalate to clinician companion and log as critical event.",
        "crisis"
    ),
    (
        "De-escalation — Acute Cardiac Symptoms. "
        "If patient reports chest pain, severe breathlessness, or syncope during conversation: "
        "STOP the therapeutic conversation immediately. "
        "Say: 'These symptoms need immediate attention. Please call emergency services or have someone take you to A&E right now. Do not wait.' "
        "This overrides all therapeutic goals. Patient safety is absolute priority.",
        "crisis"
    ),

    # ── Medication adherence ──────────────────────────────────────────────────
    (
        "Medication Adherence — Common Barriers. "
        "Non-adherence is often driven by: side effects, cost, forgetting, feeling well, distrust of medication, complexity of regimen. "
        "Intervention: address the specific barrier, not the general importance of adherence. "
        "Ask: 'What gets in the way of taking your medication?' NOT 'You need to take your medication.'",
        "moderate_stress"
    ),
    (
        "Medication Adherence — Side Effect Negotiation. "
        "If side effects are the barrier: validate the difficulty; explore whether the benefits outweigh the effects; "
        "suggest contacting the prescriber about alternatives or timing changes. "
        "Do NOT dismiss side effects as minor — to the patient they are real and significant.",
        "moderate_stress"
    ),
    (
        "Medication Adherence — Motivational Enhancement. "
        "Ask: 'What difference has taking/not taking the medication made to your day-to-day life?' "
        "Use the importance ruler. Help the patient connect the medication to their stated goals (e.g. staying healthy for family).",
        "baseline"
    ),

    # ── Deaddiction / substance use ───────────────────────────────────────────
    (
        "Deaddiction — Craving Management. "
        "Cravings peak at 15–30 minutes and then subside (urge surfing). "
        "Techniques: urge surfing ('notice the craving without acting on it'); distraction (physical activity, calling someone); "
        "HALT check (Hungry, Angry, Lonely, Tired — address the underlying need). "
        "Affirmation: 'You've ridden out cravings before. You can do this.'",
        "high_stress"
    ),
    (
        "Deaddiction — Relapse Trigger Mapping. "
        "Help the patient identify their personal triggers: people, places, emotions, times of day. "
        "Build an avoidance/coping plan for each trigger. "
        "Frame relapse triggers as information, not failure: 'What was happening just before you picked up?'",
        "moderate_stress"
    ),
    (
        "Deaddiction — Alcohol Use Disorder Stages. "
        "Stage 1 Binge: episodic heavy drinking. Stage 2 Withdrawal: anxiety, tremor, sweating when not drinking. "
        "Stage 3 Preoccupation: alcohol dominates thinking. "
        "Medical withdrawal (severe) is a medical emergency: seizures, delirium tremens. "
        "If patient reports severe withdrawal symptoms, escalate to clinician immediately.",
        "crisis"
    ),

    # ── Cardiac / physiological risk ──────────────────────────────────────────
    (
        "Cardiac Risk Communication — Heart Failure. "
        "Key self-management behaviours: daily weight monitoring (>2kg gain in 3 days → contact GP); "
        "fluid restriction; sodium restriction; medication adherence (diuretics, ACE inhibitors). "
        "Warning signs requiring urgent attention: sudden breathlessness, ankle swelling, extreme fatigue. "
        "Frame early symptom reporting as empowering, not alarming.",
        "moderate_stress"
    ),
    (
        "Cardiac Risk Communication — HRV and Autonomic Health. "
        "HRV (RMSSD) reflects parasympathetic nervous system activity. "
        "Low HRV (<20ms in seated rest) correlates with increased cardiovascular risk. "
        "Improving HRV: regular moderate exercise, stress reduction, adequate sleep, reduced alcohol. "
        "Do NOT alarm the patient with raw HRV numbers — use stress labels instead.",
        "baseline"
    ),

    # ── Sleep hygiene ─────────────────────────────────────────────────────────
    (
        "Sleep Hygiene — Key Principles. "
        "1. Consistent sleep/wake times (including weekends). "
        "2. Avoid screens 1 hour before bed. "
        "3. Cool, dark, quiet room. "
        "4. Avoid caffeine after 2pm; alcohol disrupts REM. "
        "5. Bed is for sleep only — not TV or phone. "
        "6. If unable to sleep after 20 minutes, get up and do a quiet activity until sleepy.",
        "moderate_stress"
    ),
    (
        "Sleep Hygiene — Sleep Disruption in Addiction Recovery. "
        "Insomnia is one of the most common and persistent symptoms in early recovery. "
        "It often persists for 3–6 months after sobriety. "
        "Intervention: validate the difficulty; sleep diary; CBT-I techniques (stimulus control, sleep restriction). "
        "Do NOT recommend sedatives without clinical input.",
        "high_stress"
    ),

    # ── Caregiver support ─────────────────────────────────────────────────────
    (
        "Caregiver Burnout — Signs and Response. "
        "Signs: exhaustion, resentment, withdrawal, feeling hopeless, physical symptoms, neglecting own health. "
        "Response: validate without minimising; acknowledge the invisible labour of caregiving; "
        "explore respite options; connect to caregiver support groups. "
        "Remind: 'You can't pour from an empty cup. Taking care of yourself is part of caring for them.'",
        "high_stress"
    ),
    (
        "Caregiver Communication — Conflict Resolution. "
        "Caregivers and patients often conflict about pace of change, medical decisions, and dependency. "
        "Technique: structured dialogue — each person has 3 uninterrupted minutes to speak; "
        "companion facilitates reflection; identify shared goals. "
        "Avoid taking sides; reframe conflict as two people who care about the same outcome.",
        "high_stress"
    ),

    # ── Escalation response templates ─────────────────────────────────────────
    (
        "Escalation Protocol — SOFT CHECK-IN (DRI 0.25–0.45). "
        "Response template: Ask about sleep/wellbeing without alarming. "
        "Example: 'I've noticed you've seemed a bit more tired in our recent conversations. "
        "How have you been sleeping lately? Sometimes small changes in sleep can be an early sign that we need to check in more.' "
        "Frequency: increase check-in from weekly to every 2–3 days.",
        "moderate_stress"
    ),
    (
        "Escalation Protocol — PROACTIVE SUPPORT (DRI 0.45–0.65). "
        "Response template: Increase support and suggest caregiver involvement. "
        "Example: 'I'm a bit concerned about how things have been going. I'd like to suggest we loop in [caregiver name] for some additional support. "
        "Would you be open to that?' "
        "Frequency: daily check-ins; consider scheduling a 3-way call.",
        "high_stress"
    ),
    (
        "Escalation Protocol — CLINICAL ALERT (DRI 0.65–0.80). "
        "Response template: Flag to clinician and suggest urgent review. "
        "Example: 'I want to make sure you get the right support. I'm going to flag this to [clinician] so they can follow up with you. "
        "Please don't hesitate to contact them directly if you feel worse before we connect.' "
        "Action: create escalation record; notify clinician companion.",
        "crisis"
    ),
    (
        "Escalation Protocol — IMMEDIATE ESCALATION (DRI > 0.80). "
        "Response template: Emergency protocol. "
        "Example: 'I'm very concerned about you right now. I'd like you to contact emergency services or go to A&E immediately. "
        "Is there someone who can take you or be with you right now?' "
        "Action: trigger emergency protocol; contact all care circle members; log as critical incident.",
        "crisis"
    ),

    # ── Consent and privacy ───────────────────────────────────────────────────
    (
        "Consent — Sharing Information with Care Circle. "
        "Before sharing patient information with caregivers or clinicians, always obtain explicit consent. "
        "Example: 'I'd like to share what we've discussed with your doctor — would that be okay with you? "
        "You can say no and it won't affect your care.' "
        "Document consent level: None / Inform / Involve / Lead.",
        "baseline"
    ),
    (
        "Consent — Limits of Confidentiality. "
        "Confidentiality may be breached when there is risk to life (patient or others). "
        "Tell the patient upfront: 'Everything we discuss is confidential, except if I'm concerned about your safety or someone else's safety.' "
        "This is not a threat — it builds trust through transparency.",
        "baseline"
    ),

    # ── Information sharing and commitments ───────────────────────────────────
    (
        "Clinical Commitment Tracking — Why It Matters. "
        "Commitments made in session ('I'll call my sponsor if I feel like using', 'I'll take my medication every morning') "
        "should be tracked across sessions. "
        "At the start of each session: review past commitments; celebrate success; problem-solve failures. "
        "Do NOT skip this — commitment follow-through is the strongest predictor of sustained change.",
        "baseline"
    ),
    (
        "Goal Progress — Reflecting Progress Across Sessions. "
        "If a patient has been in multiple sessions: summarise progress since session 1. "
        "Example: 'Since we started talking three weeks ago, you've gone from drinking every day to having 4 alcohol-free days a week. "
        "That's a real change.' "
        "Longitudinal framing prevents patients from discounting gradual improvement.",
        "baseline"
    ),

    # ── Prediction / early intervention ──────────────────────────────────────
    (
        "Early Intervention — Prodromal Signs. "
        "Common prodromal signs before relapse/crisis: "
        "sleep disruption (often first sign); social withdrawal; reduced engagement in sessions; "
        "increased stress reports; medication non-adherence; renewed contact with old networks. "
        "The companion should proactively ask about these when detected, not wait for the patient to disclose.",
        "moderate_stress"
    ),
    (
        "Physiological Monitoring — HRV Trend Interpretation. "
        "A declining HRV trend over 3+ sessions (slope < -0.8ms/turn) is clinically significant. "
        "It often precedes self-reported stress by 1–3 sessions (the patient doesn't yet feel it). "
        "This is the primary signal for predictive escalation — not the absolute HRV value. "
        "A cardiac patient with a stable HRV of 20ms is not in deterioration; "
        "a previously healthy patient whose HRV has dropped from 45ms to 25ms in 2 weeks is.",
        "moderate_stress"
    ),
]

# Map stress zone → physio features
_ZONE_PHYSIO = {
    "baseline":       {"hrv_ms": 45.0, "stress_index": 0.2, "sleep_quality": 0.8, "therapeutic_stage": 0.5},
    "moderate_stress":{"hrv_ms": 30.0, "stress_index": 0.5, "sleep_quality": 0.5, "therapeutic_stage": 0.3},
    "high_stress":    {"hrv_ms": 18.0, "stress_index": 0.75,"sleep_quality": 0.3, "therapeutic_stage": 0.2},
    "crisis":         {"hrv_ms": 10.0, "stress_index": 0.95,"sleep_quality": 0.1, "therapeutic_stage": 0.0},
}


class ClinicalKnowledgeBase:
    """
    Static clinical knowledge base for TensorRAG.

    Loads the bundled clinical knowledge entries and makes them queryable
    by composite (text, physio) similarity.
    """

    def __init__(self, persist_path: Optional[Path] = None) -> None:
        self._index = PhysioConditionedIndex(
            persist_path  = persist_path or INDEX_PATH,
            text_weight   = 0.65,
            physio_weight = 0.25,
            recency_weight= 0.10,
            half_life_s   = 365 * 24 * 3600,  # clinical knowledge doesn't decay
        )
        self._loaded = False

    def load(self) -> int:
        """
        Ingest all bundled clinical knowledge entries into the index.
        Safe to call multiple times (idempotent if index already loaded).
        Returns number of new entries added.
        """
        if self._loaded and self._index.size >= len(_KNOWLEDGE):
            return 0

        added = 0
        import time as _time
        ts = _time.time() - 365 * 24 * 3600  # treat as 1-year-old (don't dominate recency)

        for text, zone in _KNOWLEDGE:
            physio_dict = _ZONE_PHYSIO.get(zone, _ZONE_PHYSIO["baseline"])
            physio_fp   = physio_features(**physio_dict)
            self._index.add(
                text      = text,
                physio_fp = physio_fp,
                metadata  = {"source": SOURCE_TAG, "zone": zone},
                ts        = ts,
            )
            added += 1

        self._index.save()
        self._loaded = True
        log.info("ClinicalKnowledgeBase loaded: %d entries", added)
        return added

    def also_ingest_jsonl(self, path: str | Path) -> int:
        """
        Load additional knowledge chunks from a JSONL file.
        Each line: {"text": "...", "zone": "baseline|moderate_stress|..."}
        """
        import json
        path = Path(path)
        if not path.exists():
            return 0
        added = 0
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                d    = json.loads(line)
                zone = d.get("zone", "baseline")
                physio_dict = _ZONE_PHYSIO.get(zone, _ZONE_PHYSIO["baseline"])
                physio_fp   = physio_features(**physio_dict)
                self._index.add(
                    text     = d["text"],
                    physio_fp= physio_fp,
                    metadata = {"source": SOURCE_TAG, "zone": zone,
                                "custom_file": str(path.name)},
                )
                added += 1
            except Exception as exc:
                log.warning("ClinicalKB: skipping malformed line: %s", exc)
        if added:
            self._index.save()
        return added

    def query(self, text: str, physio_fp=None, physio_dict: Optional[dict] = None,
              k: int = 3) -> list[RetrievedChunk]:
        """Retrieve top-k clinical knowledge chunks relevant to the query."""
        return self._index.query(text=text, physio_fp=physio_fp, physio_dict=physio_dict, k=k)
