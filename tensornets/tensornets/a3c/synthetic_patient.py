"""
tensornets.a3c.synthetic_patient — LLM-driven and scripted synthetic conversation participants.

TLDR
----
This is the Python training-time equivalent of training/simulation/synthetic_user.js
+ realistic_conversation.js.  It generates patient/caregiver/doctor utterances inside
the A3C training loop so the agent learns from realistic multi-turn dynamics without
any dependency on a running Node.js process.

Why Python and not just calling the JS version?
------------------------------------------------
The A3C training loop runs in a tight Python process that executes tens of thousands
of turns per run.  Calling Node.js over localhost for every single patient message
would add 1–5 ms latency *per turn* and congest the Node.js event loop during
production.  The Python version is a self-contained training-time tool:

  Node.js synthetic_user.js      ← production training / manual benchmarking
  Python SyntheticParticipant    ← A3C tight training loop (this file)

Both call the same LLM (Scout via the tensornets FastAPI /llm/scout endpoint) so
the response quality is identical — only the call path differs.

What it does
------------
SyntheticParticipant
  One role (patient / caregiver / doctor).  Given a scenario and persona prompt,
  it generates contextually appropriate in-character messages.  Goals advance when
  the agent's response actually covers a required_element (coverage-driven, not
  every-2-turns).  In LLM mode, a failed or empty Scout call raises RuntimeError.
  In scripted mode, canned turns from the scenario are used (offline/test only).

CareCircleOrchestrator
  Wraps multiple SyntheticParticipants.  Selects the next speaker using adaptive
  weighted sampling that mirrors realistic_conversation.js RealisticConversationEngine:
  crisis → doctor first, patient distress → patient, caregiver concern → caregiver,
  otherwise shortfall-weighted random draw.

ConversationState
  Tracks crisis_level, emotional_tension, momentum, and per-role turn counts.

_STAGE_INSTRUCTIONS
  Translates TTM change stages (precontemplation → maintenance) and flooding phases
  into LLM persona instructions so the patient's behaviour is stage-appropriate.
"""

from __future__ import annotations

import json
import logging
import math
import random
from dataclasses import dataclass, field
from typing import Any, Optional

log = logging.getLogger("tensornets.a3c.synthetic_patient")

# FastAPI server URL (same as arms.py)
import os
_TENSORNETS_URL = os.environ.get("TENSORNETS_URL", "http://localhost:8765")


def _http_post(url: str, payload: dict, timeout: float = 15.0) -> dict:
    """Minimal HTTP POST without external dependencies. Retries once on timeout."""
    import json as _json, urllib.request as _req, time as _time
    data = _json.dumps(payload).encode()
    req  = _req.Request(url, data=data, headers={"Content-Type": "application/json"})
    last_exc = None
    for attempt in range(2):
        try:
            with _req.urlopen(req, timeout=timeout) as resp:
                return _json.loads(resp.read())
        except Exception as exc:
            last_exc = exc
            if attempt == 0:
                _time.sleep(1.5)  # brief pause before retry
    raise ConnectionError(f"POST {url} failed: {last_exc}") from last_exc


def score_info_gain(
    agent_response: str,
    conversation_history: list[dict],
    session_goals: list[str],
    timeout: float = 8.0,
) -> dict:
    """
    LLM-powered information gain scorer.

    Evaluates the agent response on two dimensions that keyword matching cannot:

    1. **Novelty** — did the response surface information not present in prior
       turns? New disclosures, perspectives or clarifications score high.
       Repetition of already-covered content scores low.

    2. **Relevance** — is the information clinically or therapeutically
       pertinent to the session goals?  Off-topic social filler scores low.

    Returns
    -------
    dict with keys:
        novelty   : float [0, 1]  — how new is the information?
        relevance : float [0, 1]  — how pertinent to the session goals?
        gain      : float [0, 1]  — composite (0.6 * novelty + 0.4 * relevance)
        covered   : list[str]     — goals from session_goals the response addresses
        rationale : str           — one-sentence LLM justification

    Raises
    ------
    RuntimeError  if the LLM call fails or returns unparseable output.
    ConnectionError  if the Scout endpoint is unreachable.
    """
    import json as _json

    hist_snippet = "\n".join(
        f"{m['role'].upper()}: {m['content'][:120]}"
        for m in conversation_history[-4:]
    )
    goals_str = "; ".join(session_goals) if session_goals else "general therapeutic engagement"

    system_prompt = (
        "You are an information-quality evaluator for a therapeutic AI system.\n"
        "You receive a conversation snippet and an agent response. "
        "Score the response on two dimensions (each 0.0–1.0):\n\n"
        "NOVELTY: Does the response surface information NOT already present in the "
        "conversation history? 1.0 = entirely new insight or disclosure; 0.0 = pure repetition.\n\n"
        "RELEVANCE: Is the response clinically/therapeutically pertinent to the session goals? "
        "1.0 = directly addresses a goal; 0.0 = off-topic filler.\n\n"
        "Also list which session goals (if any) the response meaningfully addresses.\n\n"
        "Respond in JSON only:\n"
        '{"novelty": <float>, "relevance": <float>, "covered": [<goal strings>], "rationale": "<one sentence>"}'
    )
    user_prompt = (
        f"SESSION GOALS: {goals_str}\n\n"
        f"CONVERSATION HISTORY:\n{hist_snippet}\n\n"
        f"AGENT RESPONSE TO EVALUATE:\n{agent_response}"
    )

    resp = _http_post(
        f"{_TENSORNETS_URL}/llm/scout",
        {"system": system_prompt, "prompt": user_prompt, "max_tokens": 120},
        timeout=timeout,
    )
    raw = resp.get("text", "").strip()
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
        raw = raw.rstrip("`").strip()
    if not raw:
        raise RuntimeError("score_info_gain: Scout returned empty response")
    data = _json.loads(raw)   # raises json.JSONDecodeError if output is malformed
    novelty   = max(0.0, min(1.0, float(data["novelty"])))
    relevance = max(0.0, min(1.0, float(data["relevance"])))
    covered   = [g for g in (data.get("covered") or []) if isinstance(g, str)]
    gain      = round(0.6 * novelty + 0.4 * relevance, 4)
    return {
        "novelty":   round(novelty, 4),
        "relevance": round(relevance, 4),
        "gain":      gain,
        "covered":   covered,
        "rationale": str(data.get("rationale", ""))[:200],
    }


# ── Conversation context state (mirrors realistic_conversation.js) ────────────

@dataclass
class ConversationState:
    """
    Captures the emergent dynamics of a multi-turn conversation.
    Mirrors realistic_conversation.js ConversationState.
    """
    momentum:            str   = "patient_led"   # patient_led | caregiver_led | doctor_led | crisis_mode
    crisis_level:        int   = 0               # 0–3
    emotional_tension:   float = 0.0             # 0–5
    patient_needs_help:  bool  = False
    caregiver_concerned: bool  = False
    doctor_asked:        bool  = False
    last_speaker_role:   str   = "patient"
    role_turn_counts:    dict  = field(default_factory=lambda: {
        "patient": 0, "caregiver": 0, "doctor": 0,
    })

    def update_from_message(self, content: str, role: str) -> None:
        """Update state based on a new message. Called for every turn."""
        c = content.lower()
        if role in ("patient", "user"):
            self.patient_needs_help = any(
                kw in c for kw in ("struggling", "confused", "worried", "pain", "difficult", "help")
            )
            self.caregiver_concerned = any(
                kw in c for kw in ("concerned", "update", "progress", "symptoms", "complications")
            )
            self.doctor_asked = any(
                kw in c for kw in ("doctor", "clinical", "treatment", "recommendation")
            )
            if any(kw in c for kw in ("emergency", "urgent", "critical", "crisis")):
                self.crisis_level = 3
                self.momentum     = "crisis_mode"
            elif any(kw in c for kw in ("frustrated", "angry", "upset")):
                self.emotional_tension = min(5.0, self.emotional_tension + 2.0)
            elif any(kw in c for kw in ("thank", "appreciate", "better", "improving")):
                self.emotional_tension = max(0.0, self.emotional_tension - 1.0)
            else:
                self.crisis_level = max(0, self.crisis_level - 1)

        if self.crisis_level >= 3:
            self.momentum = "crisis_mode"
        elif self.caregiver_concerned and not self.doctor_asked:
            self.momentum = "caregiver_led"
        elif self.doctor_asked:
            self.momentum = "doctor_led"
        elif self.patient_needs_help:
            self.momentum = "patient_led"

        # Track how many turns each role has spoken
        norm = _normalise_role(role)
        self.role_turn_counts[norm] = self.role_turn_counts.get(norm, 0) + 1
        self.last_speaker_role = norm


def _normalise_role(role: str) -> str:
    r = role.lower()
    if "patient" in r:       return "patient"
    if "caregiver" in r or "family" in r: return "caregiver"
    if "doctor" in r or "physician" in r: return "doctor"
    return "patient"


# ── Single participant ────────────────────────────────────────────────────────

class SyntheticParticipant:
    """
    One synthetic conversation participant (patient, caregiver, or doctor).

    LLM mode
    --------
    Builds a prompt from:
      - persona.prompt_template  (who you are)
      - current_goal             (what you're trying to accomplish this turn)
      - conversation_history     (last 4 exchanges)
      - agent_response           (what the agent just said)
      - change_stage             (current TTM stage — shapes urgency of disclosure)

    Then calls Scout via /llm/scout on the tensornets FastAPI server.

    Scripted mode
    -------------
    Returns canned messages from scenario['scripted_turns'] if present,
    otherwise generates a minimal "I feel [goal]" placeholder.

    Goal advancement
    ----------------
    Goals (required_elements) advance when the agent's response text actually
    covers the current element.  This makes patient-side complexity react to
    clinical progress rather than firing on a fixed timer.
    """

    def __init__(
        self,
        role:            str,
        persona_prompt:  str,
        goals:           list[str],
        mode:            str = "llm",
        scripted_turns:  list[str] | None = None,
        change_stage:    str = "precontemplation",
        archetype:       str = "standard",
        initial_physio:  dict | None = None,
    ) -> None:
        self.role            = role
        self.persona_prompt  = persona_prompt
        self.goals           = goals or ["general engagement"]
        self.mode            = mode
        self.scripted_turns  = scripted_turns or []
        self.change_stage    = change_stage
        self.archetype       = archetype
        # Per-participant physiological state — used by V_int / SharedTensorBuffer
        # and exposed to the hysteresis arm's physio-context builder.
        self.physio: dict    = initial_physio or {}

        self.current_goal_idx   = 0
        self.covered_elements:  set[str] = set()
        self.conversation_history: list[dict] = []
        self.turn_count          = 0

    # ── Public API ──────────────────────────────────────────────────────────

    def generate_message(
        self,
        agent_response:       str,
        turn_idx:             int,
        covered_elements:     set[str] | None = None,
        conversation_context: "ConversationState | None" = None,
    ) -> str:
        """
        Generate the participant's message for this turn.

        Updates covered_elements (from passed set) and advances the goal pointer.
        Coverage itself is only updated by score_and_advance() (LLM-driven).
        """
        if covered_elements is not None:
            self.covered_elements = covered_elements
        self._advance_goal_pointer()

        self.turn_count = turn_idx
        msg = (
            self._llm_message(agent_response, turn_idx, conversation_context)
            if self.mode == "llm"
            else self._scripted_message(turn_idx)
        )
        self.conversation_history.append({"role": "assistant", "content": agent_response})
        self.conversation_history.append({"role": "user",      "content": msg})
        return msg

    def record_agent_response(self, response: str) -> None:
        """Record the agent response without generating a patient message."""
        self.conversation_history.append({"role": "assistant", "content": response})

    @property
    def current_goal(self) -> str:
        if not self.goals:
            return "general engagement"
        return self.goals[min(self.current_goal_idx, len(self.goals) - 1)]

    @property
    def coverage_fraction(self) -> float:
        return len(self.covered_elements) / max(1, len(self.goals))

    # ── Internal ────────────────────────────────────────────────────────────

    def score_and_advance(
        self,
        agent_response: str,
        turn_idx: int,
    ) -> dict:
        """
        Score the agent response for information gain (novelty + relevance) using
        the LLM-powered scorer, update covered elements from the result, and
        advance the goal pointer.

        Returns the raw score_info_gain dict so worker.py can use novelty/gain
        in the reward without an extra LLM call.

        Raises
        ------
        Propagates any exception from score_info_gain (ConnectionError, RuntimeError,
        json.JSONDecodeError) — callers should handle or let the episode abort.
        """
        result = score_info_gain(
            agent_response       = agent_response,
            conversation_history = self.conversation_history,
            session_goals        = self.goals,
        )
        for g in result.get("covered", []):
            self.covered_elements.add(g.lower())
        self._advance_goal_pointer()
        return result

    def _try_advance_goal(self, agent_response: str) -> None:
        """
        Advance the goal pointer to the first uncovered element.

        Coverage is determined exclusively by the LLM-scored covered_elements
        set (populated by score_and_advance).  Keyword matching was removed
        because string-presence is an unreliable proxy for clinical progress
        and incentivises the agent to parrot goal keywords rather than deliver
        actual therapeutic value.

        This method is safe to call even when score_and_advance has not yet
        been called — it simply leaves the pointer at index 0.
        """
        self._advance_goal_pointer()

    def _advance_goal_pointer(self) -> None:
        """Advance current_goal_idx to the first goal not yet in covered_elements."""
        for i, el in enumerate(self.goals):
            if el.lower() not in self.covered_elements:
                self.current_goal_idx = i
                return
        # All covered — stay on last
        self.current_goal_idx = len(self.goals) - 1

    def _llm_message(
        self,
        agent_response: str,
        turn_idx:       int,
        ctx:            "ConversationState | None",
    ) -> str:
        """Generate message by calling Scout via the tensornets FastAPI server."""
        history_text = "\n".join(
            f"{m['role'].upper()}: {m['content'][:120]}"
            for m in self.conversation_history[-4:]
        )
        stage_note = _STAGE_INSTRUCTIONS.get(self.change_stage, "")
        ctx_note   = ""
        if ctx:
            ctx_note = (
                f"Conversation momentum: {ctx.momentum}. "
                f"Emotional tension: {ctx.emotional_tension:.1f}/5. "
                f"Crisis level: {ctx.crisis_level}/3."
            )

        system_prompt = (
            f"{self.persona_prompt}\n\n"
            f"You are now in the '{self.change_stage}' stage of change. {stage_note}\n"
            f"Your CURRENT GOAL this turn: demonstrate or mention something related to '{self.current_goal}'.\n"
            f"Archetype: {self.archetype}. Let this shape HOW you say things (tone, resistance level).\n"
            f"{ctx_note}"
        )
        # Allow several turns of information discovery before forcing disclosure.
        # In precontemplation, 4–6 turns of deflection is realistic and useful for training.
        # After turn 4, if no clinical content has been surfaced, nudge the patient to disclose.
        disclosure_instruction = ""
        if turn_idx >= 4 and not self.covered_elements:
            disclosure_instruction = (
                "\n\nIMPORTANT: You have been deflecting for several turns. This turn, mention — even briefly "
                "and reluctantly — the real reason you are in this session (your health concern, "
                "the event that brought you here, or a worry your companion/doctor has expressed). "
                "You can still be resistant, but you must surface the presenting issue."
            )
        user_prompt = (
            f"Conversation history:\n{history_text}\n\n"
            f"AGENT (last response): {agent_response}\n\n"
            f"YOUR TURN (1–3 sentences, in character, first-person, realistic):{disclosure_instruction}"
        )

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": user_prompt, "max_tokens": 150},
                timeout=15.0,
            )
            msg = resp.get("text", "").strip()
            if not msg:
                raise ValueError("Empty response from /llm/scout")
            return msg
        except Exception as exc:
            raise RuntimeError(f"SyntheticParticipant LLM call failed: {exc}") from exc


    def _scripted_message(self, turn_idx: int) -> str:
        """Return a scripted turn message (pre-written or generated from goal)."""
        if self.scripted_turns and turn_idx < len(self.scripted_turns):
            return self.scripted_turns[turn_idx]
        return f"I'm not sure about {self.current_goal}. Can you help me understand?"


# ── Stage-of-change instructions (TTM / Prochaska & DiClemente 1983) ─────────

_STAGE_INSTRUCTIONS: dict[str, str] = {
    "precontemplation": (
        "You do NOT think you have a problem. Deflect clinical concerns with humour or minimisation. "
        "If pressed, change the subject."
    ),
    "contemplation": (
        "You are beginning to wonder if something needs to change, but you are ambivalent. "
        "Occasionally let something vulnerable slip, then pull back."
    ),
    "preparation": (
        "You are starting to accept that change is needed. You are cautiously open to information "
        "and planning, but still have doubts."
    ),
    "action": (
        "You are actively trying to change. You want specific, concrete guidance. "
        "You may still experience setbacks and need support."
    ),
    "maintenance": (
        "You have made the change and are working to sustain it. "
        "You may worry about relapse. Celebrate progress, flag triggers."
    ),
    # Flooding therapy — not TTM, uses its own stage instruction
    "flooding_exposure": (
        "You are in a flooding session. You are highly anxious about the stimulus. "
        "You will try to escape, change subject, or say you feel unwell. "
        "Your anxiety should peak in 6–8 turns then naturally decay IF you stay with the stimulus."
    ),
}


# ── Care circle orchestrator ──────────────────────────────────────────────────

# Role target speaking proportions (mirrors realistic_conversation.js roleTargets)
_DEFAULT_ROLE_TARGETS: dict[str, float] = {
    "patient":   0.55,
    "caregiver": 0.30,
    "doctor":    0.10,
}


class CareCircleOrchestrator:
    """
    Manages a multi-participant care circle conversation.

    Mirrors ConversationRunner + RealisticConversationEngine for A3C episodes.

    Usage
    -----
    >>> orch = CareCircleOrchestrator.from_scenario(scenario, mode='llm')
    >>> for turn in episode_turns:
    ...     participant, message, ctx = orch.next_turn(agent_response, turn_idx, covered)
    ...     # participant.role tells you who spoke; message is what they said

    Speaker selection
    -----------------
    1. Crisis mode (crisis_level ≥ 3) → doctor (if present), else patient
    2. Patient explicitly needs help  → patient
    3. Caregiver concerned, no doctor asked → caregiver
    4. Doctor asked for by name        → doctor
    5. Otherwise: adaptive weighted random draw respecting role_targets and shortfall
    """

    def __init__(
        self,
        participants:  list[SyntheticParticipant],
        role_targets:  dict[str, float] | None = None,
        rng_seed:      int | None = None,
    ) -> None:
        self.participants  = participants
        self.role_targets  = role_targets or dict(_DEFAULT_ROLE_TARGETS)
        self._state        = ConversationState()
        self._rng          = random.Random(rng_seed)

        # Adjust targets based on which roles are actually present
        roles_present = {_normalise_role(p.role) for p in participants}
        if "caregiver" not in roles_present:
            self.role_targets["patient"] = self.role_targets.get("patient", 0.55) + 0.15
            self.role_targets["caregiver"] = 0.0
        if "doctor" not in roles_present:
            self.role_targets["patient"]   = self.role_targets.get("patient", 0.70) + 0.10
            self.role_targets["caregiver"] = self.role_targets.get("caregiver", 0.30) + 0.05
            self.role_targets["doctor"]    = 0.0
        # Normalise
        total = sum(self.role_targets.values()) or 1.0
        self.role_targets = {k: v / total for k, v in self.role_targets.items()}

    # ── Factory ─────────────────────────────────────────────────────────────

    @classmethod
    def from_scenario(
        cls,
        scenario:  dict,
        mode:      str = "llm",
        rng_seed:  int | None = None,
    ) -> "CareCircleOrchestrator":
        """
        Build an Orchestrator from a CANONICAL_SCENARIOS entry.

        The scenario dict should contain 'users' (list of {role, personaKey})
        and optionally 'patient_prompt', 'caregiver_prompt', 'doctor_prompt'.

        For single-patient scenarios, creates exactly one participant.
        Per-participant physio is sampled from role/context-aware distributions
        unless the user dict already carries an 'initial_physio' override.
        """
        from tensornets.a3c.physio_simulator import PhysioSimulator  # lazy import
        physio_sim = PhysioSimulator(seed=rng_seed)

        users = scenario.get("users") or [{"role": "patient"}]
        participants = []
        for u in users:
            role           = u.get("role", "patient")
            norm_role      = _normalise_role(role)
            prompt_key     = f"{norm_role}_prompt"
            persona_prompt = scenario.get(prompt_key)
            if not persona_prompt:
                # Fall back to patient_prompt only for actual patient roles.
                # For caregiver/relative/doctor, log a warning — they need their own prompt.
                if norm_role == "patient":
                    persona_prompt = scenario.get("patient_prompt", "")
                else:
                    import logging as _log
                    _log.getLogger(__name__).warning(
                        "Scenario '%s' has no '%s' — role will have no persona. "
                        "Add a '%s' key to the scenario definition.",
                        scenario.get("scenario_id", "?"), prompt_key, prompt_key,
                    )
                    persona_prompt = (
                        f"You are a {role} in this care circle. "
                        f"Respond naturally in character based on the scenario context."
                    )
            change_stage   = scenario.get("deaddiction_phase", "precontemplation")
            # Map old deaddiction_phase names to TTM names
            change_stage   = _MAP_PHASE_TO_TTM.get(change_stage, change_stage)

            # Per-participant physio: honour explicit override in user dict,
            # otherwise sample from a role × scenario-type distribution.
            participant_physio = u.get("initial_physio") or physio_sim.sample(
                role=role,
                scenario_id=scenario.get("scenario_id", ""),
            )

            p = SyntheticParticipant(
                role           = role,
                persona_prompt = persona_prompt,
                goals          = scenario.get("required_elements", []),
                mode           = mode,
                scripted_turns = scenario.get(f"{_normalise_role(role)}_scripted_turns"),
                change_stage   = change_stage,
                archetype      = scenario.get("archetype", "standard"),
                initial_physio = participant_physio,
            )
            participants.append(p)

        return cls(participants, rng_seed=rng_seed)

    # ── Main entry point ─────────────────────────────────────────────────────

    def next_turn(
        self,
        agent_response:   str,
        turn_idx:         int,
        covered_elements: set[str] | None = None,
    ) -> tuple["SyntheticParticipant", str, ConversationState]:
        """
        Select next speaker, generate their message, update conversation state.

        Returns (participant, message_text, updated_conversation_state).
        """
        # Update conversation state from agent response
        self._state.update_from_message(agent_response, role="agent")

        # Select who speaks next
        speaker = self._select_speaker(turn_idx)

        # Generate message
        msg = speaker.generate_message(
            agent_response   = agent_response,
            turn_idx         = turn_idx,
            covered_elements = covered_elements,
            conversation_context = self._state,
        )

        # Update state from the patient's new message
        self._state.update_from_message(msg, role=speaker.role)

        return speaker, msg, self._state

    @property
    def primary_patient(self) -> SyntheticParticipant:
        """Return the patient participant (primary subject of care)."""
        for p in self.participants:
            if _normalise_role(p.role) == "patient":
                return p
        return self.participants[0]

    @property
    def coverage_fraction(self) -> float:
        """Coverage across all required elements from the primary patient."""
        return self.primary_patient.coverage_fraction

    @property
    def covered_elements(self) -> set[str]:
        return self.primary_patient.covered_elements

    # ── Speaker selection ────────────────────────────────────────────────────

    def _select_speaker(self, turn_idx: int) -> SyntheticParticipant:
        """Mirror realistic_conversation.js _selectSpeakerByContext."""
        s = self._state
        by_role: dict[str, list[SyntheticParticipant]] = {}
        for p in self.participants:
            by_role.setdefault(_normalise_role(p.role), []).append(p)

        doctors    = by_role.get("doctor",    [])
        caregivers = by_role.get("caregiver", [])
        patient    = by_role.get("patient",   [self.participants[0]])[0]

        # 1. Crisis → doctor first
        if s.momentum == "crisis_mode" and doctors:
            return doctors[0]

        # 2. First turn always patient
        if turn_idx == 0:
            return patient

        # 3. Patient distress → patient
        if s.patient_needs_help and s.momentum == "patient_led":
            return patient

        # 4. Caregiver concern → caregiver
        if s.caregiver_concerned and not s.doctor_asked and caregivers:
            return caregivers[0]

        # 5. Doctor asked → doctor
        if s.doctor_asked and doctors:
            return doctors[0]

        # 6. Adaptive weighted draw (shortfall-weighted, anti-repetition)
        return self._weighted_draw()

    def _weighted_draw(self) -> SyntheticParticipant:
        """
        Weighted random draw with adaptive shortfall correction.
        Mirrors _computeAdaptiveWeights in realistic_conversation.js.
        """
        counts     = self._state.role_turn_counts
        total_turns = max(1, sum(counts.values()))
        weights: list[float] = []

        for p in self.participants:
            role    = _normalise_role(p.role)
            target  = self.role_targets.get(role, 0.1)
            actual  = counts.get(role, 0) / total_turns
            shortfall = max(target - actual, 0.0)
            w = target + shortfall * 1.5

            if role == "doctor":
                w *= 0.35
            # Discount same role speaking twice in a row
            if self._state.last_speaker_role == role:
                w *= 0.8 if role == "patient" else 0.25

            weights.append(max(w, 0.05))

        total = sum(weights) or 1.0
        r = self._rng.random() * total
        cum = 0.0
        for p, w in zip(self.participants, weights):
            cum += w
            if r <= cum:
                return p
        return self.participants[0]


# ── Phase name → TTM stage mapping ───────────────────────────────────────────

_MAP_PHASE_TO_TTM: dict[str, str] = {
    "rapport":          "precontemplation",
    "ambivalence":      "contemplation",
    "insight":          "preparation",
    "strike":           "action",
    "flooding":         "flooding_exposure",
    "negotiation":      "contemplation",   # billing: patient contemplating appeal
    "standard":         "contemplation",
    # pass-through for codes already using TTM names
    "precontemplation": "precontemplation",
    "contemplation":    "contemplation",
    "preparation":      "preparation",
    "action":           "action",
    "maintenance":      "maintenance",
}
