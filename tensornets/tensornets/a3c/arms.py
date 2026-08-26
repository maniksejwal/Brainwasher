"""
tensornets.a3c.arms -- Eight independent A3C training experiments.

Experiment index
----------------
Exp 0  OldschoolWorker                (oldschool)
       Production Node.js CompanionCoordinator via HTTP. No physio. True baseline.
       Formerly: OldschoolWorker / oldschool.

Exp 1  PhysioLLMWorker                (physio_llm)
       Physio state as natural-language text in system prompt. No MCTS, no dead-band.
       Formerly: PhysioLLMWorker / hysteresis_prompt.

Exp 2  PhysioLLMCoTMCTSWorker         (physio_llm_cot_mcts)
       Same physio prompt as Exp 1, but action selection via Maverick chain-of-thought
       over all 51 ACTION_TAXONOMY candidates. LLM-as-planner; cost baseline for Exp 3.

Exp 3  PhysioMPSMCTSWorker            (physio_mps_mcts)
       Full HTN + Matrix Product State MCTS via tensornets bridge.
       M_trunc constraint steers Scout token generation.
       Formerly: PhysioMPSMCTSWorker / htn_mcts.

Exp 4  InertialPhysioMPSMCTSWorker    (inertial_physio_mps_mcts)
       Exp 3 + HysteresisGate 5-zone dead-band. Zone and streak injected into
       MCTS payload and system prompt. Most capable baseline-free experiment.

Exp 5  InertialPhysioLLMCoTMCTSWorker (inertial_physio_llm_cot_mcts)
       Exp 2 + HysteresisGate. CoT-MCTS with inertial zone awareness.

Exp 6  InertialHPVOOTPhysioMPSMCTSWorker    (inertial_hpvoot_physio_mps_mcts)
       Exp 4 + HierarchicalPWVOOTMCTS (150 iter, depth 20) + Scout LLM prior.

Exp 7  InertialHPVOOTPhysioLLMCoTMCTSWorker (inertial_hpvoot_physio_llm_cot_mcts)
       Exp 5 + HierarchicalPWVOOTMCTS; Maverick CoT ratings reused as PW prior.

Capability order (ascending): 0 < 1 < 2 < 5 < 3 < 4 < 6/7  (Exp 6/7 are HPVOOT variants of 4/5)

Exception policy
----------------
No silent fallbacks in Exp 1-5. Failures raise RuntimeError or ValueError so the
episode is recorded as failed and bugs are immediately surfaced.

All experiments write the same EpisodeTurn jsonl schema for cross-experiment comparison.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

# ── ARM_REGISTRY: populated by train.py so shadow mode can find loaded actors ──
# Maps arm_name → {"actor": <ActorNet>, "critic": <CriticNet>}
_ARM_REGISTRY: dict[str, dict] = {}

from tensornets.a3c.worker import (
    A3CWorker,
    REWARD_DIMS,
    TurnState,
    _build_reactivity_profile,   # C6.1: ReactivityProfile wiring
    progressive_lookahead,       # progressive MCTS depth by episode count
    drift_physio_for_gap,        # MCTS6: inter-session physio decay
)
from tensornets.therapy.mcts_reward import (
    WEIGHTS as MCTS_WEIGHTS,
    TRUST_BUILD,
    TRUST_ERODE,
    score_candidate_multidim,
)
from tensornets.therapy.modes import TherapeuticMode, DeaddictionPhase, ChangeStage

log = logging.getLogger("tensornets.a3c.arms")

# ── Client imports ────────────────────────────────────────────────────────────
# All HTTP calls to Node.js are routed through node_client.  Calls to the
# tensornets FastAPI server (LLM, MCTS, physio) stay inline here since they
# are tightly coupled to arm-specific request schemas.
from tensornets.a3c.node_client import (  # noqa: E402
    http_post as _http_post,
    NODE_URL        as _COMPANION_URL,
    TENSORNETS_URL  as _TENSORNETS_URL,
    send_benchmark_message as _node_benchmark_message,
)

# ── Physio key normalizer ─────────────────────────────────────────────────────
# Internal physio dicts use simulation-friendly keys (hrv_ms, glucose_mg_dl,
# sleep_deficit) while the FastAPI PhysioStateIn model uses clinical names.
# This adapter runs before any call to /physio/* endpoints.
def _physio_to_api(physio: dict, *, physio_source: str = "simulated",
                   subject_id: str | None = None) -> dict:
    """Map internal physio keys → PhysioStateIn field names."""
    glucose_raw = physio.get("blood_glucose_mmol") or (
        physio.get("glucose_mg_dl", 90.0) / 18.016
    )
    sleep_deficit = physio.get("sleep_deficit_hours") or physio.get("sleep_deficit", 1.0)
    return {
        "hrv_rmssd_ms":          physio.get("hrv_rmssd_ms") or physio.get("hrv_ms", 35.0),
        "blood_glucose_mmol":    round(float(glucose_raw), 2),
        "eda_us":                physio.get("eda_us", 2.0),
        "time_of_day_h":         physio.get("time_of_day_h", 12.0),
        "location_stress_index": physio.get("location_stress_index",
                                            physio.get("stress_index", 0.4)),
        "sleep_hours_last_night": physio.get("sleep_hours_last_night",
                                             max(0.0, 8.0 - float(sleep_deficit))),
        "sleep_deficit_hours":   float(sleep_deficit),
        "is_simulated":          physio_source != "sensor",
        "subject_id":            subject_id,
    }


# ── Environment defaults ──────────────────────────────────────────────────────
_BEDROCK_REGION  = os.environ.get("AWS_REGION", "us-east-1")

# Scout (fast) for action selection; Maverick for value / judge
_SCOUT_MODEL   = "us.meta.llama4-scout-17b-instruct-v1:0"
_MAVERICK_MODEL = "us.meta.llama4-maverick-17b-instruct-v1:0"

# ── Goal-progress reward tiers ────────────────────────────────────────────────
# Named constants so any change is explicit and tracked.
# Values express the *per-turn* goal_progress reward [0, 1].
#
# Design rationale:
#   ADVANCING   — companion delivered substantive clinical or therapeutic value
#   QUESTIONING — eliciting new information; necessary but not yet delivering
#   HOLDING     — empathy/validation; required for trust but not progressing goal
#   SOCIAL      — rapport, chit-chat, light banter; positive because early-stage
#                 trust-building IS therapeutic value, and the Socratic method
#                 requires knowing the patient before advising them
#   OTHER       — deflection, unclear, or off-topic — gentle penalty
_GOAL_R_ADVANCING   = 0.75
_GOAL_R_QUESTIONING = 0.55
_GOAL_R_HOLDING     = 0.45
_GOAL_R_SOCIAL      = 0.40   # small positive: rapport is not zero-value
_GOAL_R_OTHER       = 0.30   # below neutral: unexplained tangents cost something




# ── Exp 3: PhysioMPSMCTSWorker — physio_mps_mcts ─────────────────────────────

class PhysioMPSMCTSWorker(A3CWorker):
    """
    Exp 3: Full HTN + MCTS arm.

    Each turn:
    1. POST /mcts/best_action to get the MCTS-selected action + M_trunc.
    2. POST /physio/history/append with the updated physio state.
    3. Apply M_trunc constraint projection to Scout token logits
       (via project_constraint — F4).
    4. Call Scout to generate the companion response.
    5. Score reward from the physio trajectory delta.

    Fallback behaviour
    ------------------
    If the tensornets server is unreachable, falls back to actor.select()
    for action and plain Scout generation (degrades to Exp 1 behaviour for
    that turn only).  Fallback turns are flagged in the log.
    """

    ARM = "physio_mps_mcts"

    # Default system prompt template.  Updated by PromptOptimizer when improvement
    # threshold is not met.  Template vars: {action}, {stress_index}, {stress_bucket}.
    _DEFAULT_SYSTEM_PROMPT = (
        "You are a clinical companion. Current action strategy: {action}. "
        "Patient stress level: {stress_index:.2f} ({stress_bucket}). "
        "Respond with one empathetic, concise message (2–3 sentences)."
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt: str = self._DEFAULT_SYSTEM_PROMPT

    def update_system_prompt(self, new_prompt: str) -> None:
        """Replace the active system prompt template (called by PromptOptimizer)."""
        self._system_prompt = new_prompt

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        t_start  = time.perf_counter()
        fallback = False
        m_trunc  = None
        scout_tokens = 0

        # Exp 3 ideally requires real physiological state for MCTS.
        # Two valid states:
        #   sensor_present=True  → real / authored physio → full MCTS pipeline
        #   sensor_present=False → sampled estimates      → skip MCTS & physio
        #                          history; use actor action only (graceful degrade)
        # An *empty* physio dict is still an error — the scenario loader must always
        # supply at least sampled values so the LLM prompt has context.
        physio = state.physio or {}
        if not physio:
            raise ValueError(
                f"PhysioMPSMCTSWorker (physio_mps_mcts): scenario '{scenario.get('scenario_id', '?')}' "
                f"has no physiological state (state.physio is empty). "
                f"Add initial_physio to the scenario in routes/training.js or the "
                f"scenario source file. Do not use silent defaults — invented physio "
                f"degrades MCTS quality and produces meaningless training gradients."
            )

        # physio_source determines how physio is presented to MCTS:
        #   "sensor"    → real measurements     → pass as-is
        #   "simulated" → scenario-derived      → pass as-is (MCTS treats as ground truth)
        #   "none"      → no wearable           → pass sentinel values so MCTS can
        #                                          interpolate from history or use prior
        # We never skip MCTS entirely — unknown physio is a valid MCTS input state.
        physio_source = getattr(state, "physio_source", "sensor")

        # Build the physio state for MCTS.  For "none", replace every numeric field
        # with -1 (the agreed sentinel for "unknown") and add physio_unknown=True.
        # The MCTS bridge can then use a population prior or interpolate from history.
        if physio_source == "none":
            mcts_physio = {
                "stress_index":    -1.0,
                "hrv_ms":          -1.0,
                "eda_us":          -1.0,
                "sleep_deficit":   -1.0,
                "glucose_mg_dl":   -1.0,
                "physio_unknown":  True,
                # Include conversation-inferred stress bucket as a soft signal
                "stress_bucket":   state.stress_bucket,
                # Conversation stress estimate (updated from scorer each turn)
                "conversation_stress": getattr(state, "conversation_stress", 0.5),
                # Delta is undefined when physio is unknown
                "stress_discrepancy":  None,
            }
        else:
            conv_stress  = getattr(state, "conversation_stress", 0.5)
            discrepancy  = round(state.stress_index - conv_stress, 4)
            mcts_physio  = {
                **physio,
                # Conversation-inferred estimate alongside sensor/simulated values
                "conversation_stress": conv_stress,
                # Δ = physio_stress − conversation_stress
                # +ve → physio stressed but conversation calm → possible masking
                # −ve → conversation stressed but physio calm → emotional outburst
                "stress_discrepancy":  discrepancy,
                "physio_source":       physio_source,
            }

        # Step 1: MCTS best action + M_trunc from tensornets bridge
        try:
            mcts_resp = _http_post(
                f"{_TENSORNETS_URL}/mcts/best-action",
                {
                    "physio_state":      mcts_physio,
                    "candidate_actions": [action],
                    "mode":              state.therapeutic_mode or "standard",
                    "depth":             progressive_lookahead(scenario.get("_arm_ep_count", 0), session_boundary=getattr(state, "session_boundary", False)),
                },
                timeout=5.0,
            )
            action  = mcts_resp.get("best_action", action)
            m_trunc = mcts_resp.get("M_trunc")
        except Exception as exc:
            log.warning("Arm1: MCTS call failed (%s), falling back to actor action", exc)
            fallback = True

        # Step 2: physio history append — skip for "none" (nothing real to record)
        if physio_source != "none":
            try:
                _http_post(
                    f"{_TENSORNETS_URL}/physio/history/append",
                    _physio_to_api(physio, physio_source=physio_source,
                                   subject_id=state.subject_id),
                    timeout=3.0,
                )
            except Exception as append_exc:
                log.warning("Arm1: physio/history/append failed (non-fatal): %s", append_exc)

        # Step 3 + 4: generate response (Scout, with M_trunc if available)
        scout_result  = self._call_scout(state, action, scenario, m_trunc=m_trunc)
        response_text = scout_result["text"]
        scout_tokens  = {"scout_in": scout_result["tokens_in"], "scout_out": scout_result["tokens_out"]}

        # Step 5: synthetic reward from stress delta (with real-time conversation correction)
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        # Arm1: degrade safety score if MCTS fell back to actor-only (bridge was down)
        if fallback:
            reward["safety"] = min(reward["safety"], 0.8)

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        return {
            "response":           response_text,
            "reward":             reward,
            "judge":              {},    # filled offline by HTN judge batch run
            "tokens":             scout_tokens,
            "latency_ms":         round(latency_ms, 1),
            "next_stress_index":  next_stress,
            "next_physio":        {**state.physio, "stress_index": next_stress},
            "action_taken":       action,
            "frames_component":   None,   # MCTS supplies this when bridge is live
            "info_coverage":      reward["info_coverage"],  # LLM-scored; drives next-turn state
            "repetition_detected":False,
            "discrepancy":        None,
            "arm1_fallback":      fallback,
        }

    def _call_scout(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        m_trunc=None,
    ) -> str:
        """
        Generate a response via Scout (Bedrock).  Returns the response text.

        F3/F4 — M_trunc constraint injection:
        If M_trunc is available (shape n_vocab × k from SVD of MCTS path), extract
        the top-weighted actions from the dominant singular vector (column 0) and
        inject them as explicit guidance into the system prompt.  This soft-steers
        the companion toward actions in the MCTS high-value subspace without
        requiring direct logit manipulation (which Bedrock API doesn't expose).
        """
        # ── F3/F4: extract top MCTS actions from M_trunc dominant vector ─────
        mcts_constraint_str = ""
        if m_trunc is not None:
            try:
                # m_trunc is list[list[float]], shape (n_vocab, k)
                # Extract the dominant component (column 0)
                dominant = [row[0] for row in m_trunc if row]
                # The MCTS /best-action returns candidate_actions sorted the same way
                # as the action_vocab in _build_M_trunc — we use ACTION_TAXONOMY as fallback
                from tensornets.a3c.action_bandit import ACTION_TAXONOMY
                vocab = ACTION_TAXONOMY[:len(dominant)]  # list[str], not dict
                # Pair each action with its dominant-vector weight and take top 3
                weighted = sorted(
                    zip(vocab, dominant), key=lambda x: abs(x[1]), reverse=True
                )
                top_actions = [a for a, _ in weighted[:3] if abs(_) > 0.05]
                if top_actions:
                    mcts_constraint_str = (
                        "\n[MCTS GUIDANCE] High-value action subspace for this state: "
                        + ", ".join(top_actions) +
                        ". Bias your response toward these strategy types."
                    )
            except Exception as m_exc:
                # M_trunc injection is a soft hint — log and continue without it
                log.warning("Arm1: M_trunc constraint injection failed: %s", m_exc)

        system_prompt = _safe_fmt(
            self._system_prompt,
            action=action,
            stress_index=state.stress_index,
            stress_bucket=state.stress_bucket,
            hysteresis_ctx="",
        )

        # Append M_trunc constraint to system prompt if available
        if mcts_constraint_str:
            system_prompt = system_prompt + mcts_constraint_str

        history_text = "\n".join(
            f"{t['role'].upper()}: {t['content']}"
            for t in state.conversation_history[-6:]
        )
        user_msg = _last_user_message(state)
        prompt = f"{history_text}\nUSER: {user_msg}\nASSISTANT:"

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256, "arm": self.ARM},
                timeout=20.0,
            )
            text = resp.get("text", "").strip()
            if not text:
                raise ValueError("Empty response from /llm/scout")
            # Return text + real token counts from the backend.
            # If the backend does not expose usage, raise — we need real counts for cost tracking.
            usage = resp.get("usage", {})
            tokens_in  = usage.get("input_tokens",  0)
            tokens_out = usage.get("output_tokens", 0)
            return {"text": text, "tokens_in": tokens_in, "tokens_out": tokens_out}
        except Exception as exc:
            raise RuntimeError(f"PhysioMPSMCTSWorker: Scout call failed: {exc}") from exc


# ── Exp 0: OldschoolWorker — oldschool ───────────────────────────────────────

class OldschoolWorker(A3CWorker):
    """
    Exp 0: Old-school production JS arm.

    Posts to the Node.js CompanionCoordinator API endpoint.
    Reward is *deferred*: the JS system stores its own scores in
    htn_benchmark_turns.  This worker records a placeholder reward of 0
    and the episode summary is back-filled by the K1 comparison runner after
    querying getBaselineStats().

    This matches the design doc: Exp 0 IS the production system.
    We do not modify it — we only observe its output and score it offline.
    """

    ARM = "oldschool"

    # Oldschool episodes are slower than Python arms because every turn requires
    # a real HTTP round-trip to the Node.js CompanionCoordinator.  The rebalancer
    # uses RELATIVE_SPEED to avoid penalising this arm for falling behind in
    # episode count — it is expected to produce fewer episodes per hour.
    # Values: 1.0 = baseline (physio_llm), 0.5 = ~2× slower, 0.25 = ~4× slower.
    RELATIVE_SPEED = 0.5

    def update_system_prompt(self, new_prompt: str) -> None:
        """No-op: Exp 0 (oldschool) uses the Node.js production companion; prompt lives in Node.js."""

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        t_start = time.perf_counter()
        user_msg = _last_user_message(state)

        deferred = True
        try:
            resp = _node_benchmark_message(
                message    = user_msg,
                circle_id  = scenario.get("circle_id", "benchmark_circle"),
                user_id    = state.subject_id,
                session_id = state.session_id,
                arm        = self.ARM,
                timeout    = 90.0,
            )
            response_text = resp.get("response", resp.get("message", "")).strip()
            if not response_text:
                raise ValueError("Empty response from JS companion")
            deferred = False
        except Exception as exc:
            raise RuntimeError(f"Arm2: JS companion call failed: {exc}") from exc

        latency_ms = (time.perf_counter() - t_start) * 1000.0

        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
            alliance_score=getattr(state, "alliance_score", 0.5),
            speaker_stress=getattr(state, "companion_stress", 0.5),
            physio_available=getattr(state, "physio_available", True),
            conversation_stress=getattr(state, "conversation_stress", 0.5),
        )

        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        # Arm2: no safety override — _synthetic_reward handles the safety_protocol gate

        return {
            "response":          response_text,
            "reward":            reward,
            "judge":             {},
            "tokens":            {"scout": 0, "maverick": 0},
            "latency_ms":        round(latency_ms, 1),
            "next_stress_index": next_stress,
            "next_physio":       {**state.physio, "stress_index": next_stress},
            "action_taken":      action,
            "frames_component":  None,
            "info_coverage":     reward["info_coverage"],  # LLM-scored; drives next-turn state
            "repetition_detected": False,
            "discrepancy":       None,
            "deferred_reward":   deferred,
        }


# ── Exp 1: PhysioLLMWorker — physio_llm ──────────────────────────────────────

class PhysioLLMWorker(A3CWorker):
    """
    Exp 1: Physio-in-prompt arm.

    Same as Exp 0 (production JS), but the system prompt is augmented with
    the full hysteresis context string:
      - PhysiologicalState summary (stress, HRV, EDA, sleep pressure)
      - HystereticBaseline extinction progress per trigger
      - Longitudinal hint (same format as the JS longitudinalHint)

    No MPS, no MCTS, no M_trunc projection.  Purely text-based physio context.

    This arm tests: "can you get most of the HTN benefit just by telling the
    LLM the physio state in natural language?" (A3C_COMPARISON_DESIGN §1 Exp 1)
    """

    ARM = "physio_llm"

    # System prompt template — mirrors the JS PROMPT_ACTION_SELECTOR context structure.
    # Template vars (all optional via _safe_fmt):
    #   {hysteresis_ctx}    — physio + HRV + hysteresis context block
    #   {action}            — selected action type
    #   {stress_bucket}     — low/medium/high/critical
    #   {therapeutic_mode}  — standard/flooding/deaddiction/negotiation
    #   {session_goal}      — current session goal string
    #   {turns_completed}   — int: turns done this session
    #   {info_coverage}     — float 0–1
    #   {last_action}       — previous action taken
    #   {repetition_flag}   — "true"/"false"
    #   {longitudinal_hint} — cross-session memory block (empty on first session)
    #   {known_context}     — patient facts from facts_v2 / known context RAG block
    #   {available_actions} — comma-separated list of actions available at this stress level
    _DEFAULT_SYSTEM_PROMPT = (
        "You are a clinical companion.\n\n"
        "PHYSIOLOGICAL CONTEXT:\n{hysteresis_ctx}\n\n"
        "SESSION CONTEXT:\n"
        "- Therapeutic mode: {therapeutic_mode}\n"
        "- Session goal: {session_goal}\n"
        "- Turns completed: {turns_completed}\n"
        "- Info collected: {info_coverage}\n"
        "- Last action: {last_action}\n"
        "- Repetition detected: {repetition_flag}\n"
        "{longitudinal_hint}"
        "{known_context}\n\n"
        "SELECTED ACTION: {action}\n"
        "Available at current stress: {available_actions}\n\n"
        "Respond with one empathetic, concise message (2–3 sentences)."
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._system_prompt: str = self._DEFAULT_SYSTEM_PROMPT

    def update_system_prompt(self, new_prompt: str) -> None:
        """Replace the active system prompt template (called by PromptOptimizer)."""
        self._system_prompt = new_prompt

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        t_start = time.perf_counter()
        user_msg = _last_user_message(state)

        hysteresis_ctx   = _build_hysteresis_context(state, scenario)
        longitudinal     = _build_longitudinal_hint(state)
        known_ctx        = _build_known_context_block(state)
        available, _     = _build_available_actions(state)

        system_prompt = _safe_fmt(
            self._system_prompt,
            hysteresis_ctx    = hysteresis_ctx,
            action            = action,
            stress_index      = state.stress_index,
            stress_bucket     = state.stress_bucket,
            therapeutic_mode  = state.therapeutic_mode or "standard",
            session_goal      = scenario.get("session_goal", state.session_goal or ""),
            turns_completed   = state.turn_count,
            info_coverage     = f"{state.info_coverage:.0%}",
            last_action       = state.last_action or "none",
            repetition_flag   = "true" if state.repetition_detected else "false",
            longitudinal_hint = longitudinal,
            known_context     = known_ctx,
            available_actions = available,
        )
        history_text = "\n".join(
            f"{t['role'].upper()}: {t['content']}"
            for t in state.conversation_history[-6:]
        )
        prompt = f"{history_text}\nUSER: {user_msg}\nASSISTANT:"

        response_text = ""
        scout_tokens  = {}
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256, "arm": self.ARM},
                timeout=20.0,
            )
            response_text = resp.get("text", "").strip()
            if not response_text:
                raise ValueError("Empty response from /llm/scout")
            usage = resp.get("usage", {})
            scout_tokens = {
                "scout_in":  usage.get("input_tokens",  0),
                "scout_out": usage.get("output_tokens", 0),
            }
        except Exception as exc:
            raise RuntimeError(f"PhysioLLMWorker: Scout call failed: {exc}") from exc

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        # Exp 1: no safety override — same unconditional floor as Exp 2/3 via _synthetic_reward

        return {
            "response":          response_text,
            "reward":            reward,
            "judge":             {},
            "tokens":            scout_tokens,
            "latency_ms":        round(latency_ms, 1),
            "next_stress_index": next_stress,
            "next_physio":       {**state.physio, "stress_index": next_stress},
            "action_taken":      action,
            "frames_component":  None,
            "info_coverage":     reward["info_coverage"],  # LLM-scored; drives next-turn state
            "repetition_detected": False,
            "discrepancy":       None,
        }


# ── Shared utilities ──────────────────────────────────────────────────────────

import math as _math

# ── No-physio (no-watch) constants ────────────────────────────────────────────
# When a patient is not wearing a wearable, physio-based signals (HRV, EDA,
# hysteresis_zone) are unavailable.  The system falls back to conversation_stress
# (scorer-inferred estimate) and widens MCTS exploration to account for uncertainty.

_NO_PHYSIO_STRESS_BLEND = 0.8   # weight on conversation_stress when physio unavailable
_NO_PHYSIO_C_BOOST      = 0.4   # added to MCTS exploration_c (wider exploration)
_NO_PHYSIO_NEUTRAL_HRV  = 55.0  # neutral HRV to use in place of measured value
_NO_PHYSIO_NEUTRAL_EDA  = 3.0   # neutral EDA
_NO_PHYSIO_NEUTRAL_ZONE = None  # hysteresis_zone left unknown (disables zone bonus)


def _effective_physio_state(state: "TurnState") -> dict:
    """
    Return the physio dict to use for MCTS, with graceful no-watch degradation.

    When physio is available: return state.physio unchanged.
    When physio is unavailable: return a neutral physio dict whose stress_index
    is blended from conversation_stress (80%) and the last known physio stress (20%).
    All sensor fields (HRV, EDA, hysteresis_zone) are set to neutral values so
    MCTS zone-matching bonuses don't fire on stale data.

    This ensures the system always has a usable physio-like dict regardless of
    whether a wearable is present.
    """
    if getattr(state, "physio_available", True):
        return state.physio

    conv_stress   = getattr(state, "conversation_stress", 0.5)
    last_physio_s = state.physio.get("stress_index", 0.5)
    blended_stress = round(
        _NO_PHYSIO_STRESS_BLEND * conv_stress
        + (1.0 - _NO_PHYSIO_STRESS_BLEND) * last_physio_s,
        4,
    )
    return {
        "stress_index":   blended_stress,
        "hrv_ms":         _NO_PHYSIO_NEUTRAL_HRV,
        "eda_us":         _NO_PHYSIO_NEUTRAL_EDA,
        "sleep_deficit":  state.physio.get("sleep_deficit", 0.0),
        "glucose_mg_dl":  state.physio.get("glucose_mg_dl", 90.0),
        # hysteresis_zone intentionally absent — disables zone-matching bonuses
    }

def _temporal_gamma(session_gap_days: float, gamma_base: float = 0.85, tau: float = 5.0) -> float:
    """
    MCTS6: Scale HPVOOT inertia γ by the inter-session time gap.

    γ_eff = γ_base × exp(−gap_days / τ)

    Within-session (gap=0): γ_eff = γ_base  → full inertia (strategy doesn't flip)
    After 5 days (tau):     γ_eff ≈ 0.31    → low inertia (patient may have changed)
    After 2 weeks:          γ_eff ≈ 0.06    → near-zero (treat as new patient context)

    The MCTS bridge uses γ_eff as the UCB exploration-vs-exploitation balance:
    low γ_eff → more exploration (consider more actions) because inertia is weak.
    """
    if session_gap_days <= 0:
        return gamma_base
    return round(gamma_base * _math.exp(-session_gap_days / tau), 4)


def _session_boundary_gate(action: str, session_boundary: bool) -> bool:
    """
    MCTS6: Return True if this action should be suppressed at session boundary.

    Deep therapeutic actions (flooding, socratic challenge, discrepancy) are
    counter-productive on the first turn of a session — rapport must be
    re-established first.  The gate is a one-turn suppression only
    (session_boundary=True exclusively on the first turn of a new session).
    """
    if not session_boundary:
        return False
    _SUPPRESS_AT_BOUNDARY = {
        "flooding_deepen", "flooding_hold",
        "socratic_probe", "socratic_reframe",
        "develop_discrepancy", "loss_frame", "direct_confrontation",
        "challenger_insight",
        "seek_probe_consent",      # too soon — patient hasn't re-established rapport
        "normalise_discrepancy",   # no contradiction context available on first turn yet
    }
    return action in _SUPPRESS_AT_BOUNDARY

def _stress_after_response(
    current_stress: float,
    action: str,
    archetype: str = "standard",
    drug_regimen_dict: "dict | None" = None,
    conversation_correction: float = 0.0,
    alliance_score: float = 0.5,
    speaker_stress: float = 0.5,
    physio_available: bool = True,
    conversation_stress: float = 0.5,
) -> float:
    """
    Continuous stress transition using CALMING_WEIGHT per action.

    Replaces the old discrete bucket approach.  Each action has a CALMING_WEIGHT
    in [0,1] (defined in action_bandit.py).  The stress delta is:

        Δσ = -(CALMING_WEIGHT[action] - 0.5) × DELTA_SCALE

    So: CW > 0.5 → stress falls, CW < 0.5 → stress rises (flooding / challenge).
    The OU target is 0 (natural decay when no action is taken).

    C6.1 — ReactivityProfile modifier:
    If an archetype is specified, the profile's gamma_modifier() scales the
    calming/challenging delta. A HYPERSENSITIVE patient reacts more strongly
    to both calming and stressful actions; a STOIC patient reacts less.

    C5.4 — DrugRegimen modifier:
    If drug_regimen_dict is provided, the composite PK/PD Γ modifier from
    DrugRegimen.gamma_modifier() is applied. Beta-blockers dampen stress rise;
    benzodiazepines reduce Γ sharply; naltrexone attenuates craving Γ spikes.

    SA2.1 — social_Gamma_modifier:
    Alliance quality and speaker stress modulate the effective reversion speed θ.
    High alliance (alliance_score > 0.5): calming actions are more effective.
    Rupture (alliance_score < 0.5) or panicked speaker: stress is harder to reduce.
    See social_alliance.social_Gamma_modifier() for the full formulation.

    conversation_correction:
    A real-time discrepancy signal derived from the scorer's assessment of the
    patient's actual response vs. the expected response for the chosen action.
    Positive = patient more stressed/resistant than expected (push up σ).
    Negative = patient calmer/more accepting than expected (pull σ down).
    This captures "the patient didn't accept the fact we expected" and forces
    MCTS to update its model of the patient's state before the next action.
    Max magnitude is capped at ±0.05 per turn to prevent instability.

    Falls back to 0.5 (neutral, zero delta) for unknown actions.

    No-watch (physio_available=False):
    When the patient is not wearing a wearable, current_stress is replaced with a
    blend of conversation_stress (80%) and the caller-supplied current_stress (20%).
    The conversation_correction magnitude is also widened by 1.5× to compensate for
    the missing physio signal, giving language cues more weight.
    """
    # ── No-watch blending ─────────────────────────────────────────────────────
    if not physio_available:
        current_stress = round(
            _NO_PHYSIO_STRESS_BLEND * conversation_stress
            + (1.0 - _NO_PHYSIO_STRESS_BLEND) * current_stress,
            4,
        )
        conversation_correction *= 1.5   # language cues carry more weight

    try:
        from tensornets.a3c.action_bandit import CALMING_WEIGHT
    except ImportError:
        CALMING_WEIGHT = {}

    DELTA_SCALE = 0.08   # maximum per-turn stress change (±4% at CW extremes)
    cw    = CALMING_WEIGHT.get(action, 0.5)
    delta = -(cw - 0.5) * 2.0 * DELTA_SCALE

    # ── SA2.1: social alliance modifier ──────────────────────────────────────
    # The alliance modifier adjusts the effective reversion speed, not the
    # action delta directly. High alliance → faster recovery (subtract from delta
    # on calming actions). Rupture/panic → slower recovery (add to delta).
    try:
        from tensornets.agents.social_alliance import social_Gamma_modifier
        social_mod = social_Gamma_modifier(alliance_score, speaker_stress)
        # social_mod < 0 (high alliance): calming is more effective.
        #   Adding social_mod * abs(delta) to a negative delta makes it more negative.
        # social_mod > 0 (rupture/panic): calming is less effective.
        #   Adding positive social_mod * abs(delta) to a negative delta pushes it toward 0.
        # Scale by 0.5 so the social modifier is secondary to the action CW.
        delta += social_mod * 0.5 * abs(delta)
    except ImportError:
        pass  # social_alliance module not available — no-op
    profile = _build_reactivity_profile("_arm_tmp", archetype)
    if profile is not None:
        # gamma_modifier returns a multiplier > 1 for reactive types (amplifies delta)
        # and < 1 for stoic types (dampens delta). Use current_stress as input.
        try:
            modifier = profile.gamma_modifier(current_stress)
            delta *= modifier
        except Exception as rp_exc:
            raise RuntimeError(
                f"ReactivityProfile.gamma_modifier failed for archetype '{archetype}': {rp_exc}"
            ) from rp_exc

    # ── C5.4: apply DrugRegimen PK/PD Γ modifier ────────────────────────────
    # Drug modifier is applied to the raw delta magnitude. A beta-blocker
    # (modifier < 1) dampens both calming and stress-rise effects — the patient
    # is pharmacologically buffered. A BZD sharply reduces Γ (modifier << 1).
    # A cue-triggered naltrexone damps the craving stress spike specifically.
    if drug_regimen_dict:
        try:
            from tensornets.physio.pkpd import DrugRegimen
            dr = DrugRegimen(
                subject_id = "_arm_tmp",
                drugs      = drug_regimen_dict,
            )
            cue_triggered = (action in ("spike_step", "direct_advice"))
            drug_mod = dr.gamma_modifier(cue_triggered=cue_triggered)
            delta *= drug_mod
        except ImportError as imp_exc:
            raise ImportError(
                f"tensornets.physio.pkpd.DrugRegimen not available — "
                f"install the pkpd module or remove drug_regimen from scenario: {imp_exc}"
            ) from imp_exc
        except Exception as dr_exc:
            raise RuntimeError(f"DrugRegimen.gamma_modifier failed: {dr_exc}") from dr_exc

    # Apply conversation correction — capped at ±0.05 to prevent instability.
    # This is the discrepancy signal: patient responded differently than the
    # action model predicted.  Positive = more resistant, negative = more accepting.
    correction = max(-0.05, min(0.05, conversation_correction))
    return max(0.0, min(1.0, current_stress + delta + correction))


def _synthetic_reward(
    state: TurnState,
    action: str,
    next_stress: float,
    response_text: str = "",
) -> dict[str, float]:
    """
    Mode-conditional multi-dimensional reward using mcts_reward.py WEIGHTS.

    The key insight is that *the same stress increase can be a reward or a
    penalty depending on the therapeutic mode*:

    - STANDARD / NEGOTIATION / RAPPORT: stress reduction is rewarded.
    - FLOODING                         : stress increase toward target is rewarded.
    - DEADDICTION (AMBIVALENCE)        : mild productive tension (σ ~ 0.35) is rewarded.
    - DEADDICTION (INSIGHT / STRIKE)   : controlled confrontation is rewarded.

    Dimensions align with REWARD_DIMS and REWARD_WEIGHTS in worker.py.
    """
    mode_str  = state.therapeutic_mode or "standard"
    phase_str = state.deaddiction_phase or "precontemplation"

    # therapeutic_mode must be a valid Python TherapeuticMode value.
    # Normalisation from JS category labels happens in routes/training.js
    # (normalisePythonMode) before scenarios reach Python.  If an invalid
    # value arrives here, the scenario source needs to be fixed — no silent
    # fallback.
    try:
        mode  = TherapeuticMode(mode_str)
        # For FLOODING mode the deaddiction_phase carries a flooding-specific
        # sub-stage (flooding_exposure, flooding_peak, flooding_recovery) rather
        # than a TTM ChangeStage value.  Skip the ChangeStage parse entirely;
        # _synthetic_reward branches on the raw flooding_subphase string below.
        if mode == TherapeuticMode.FLOODING:
            phase = ChangeStage.PRECONTEMPLATION   # nominal; not used in flooding branch
        else:
            from tensornets.therapy.modes import DEADDICTION_TO_CHANGESTAGE
            phase_str_mapped = DEADDICTION_TO_CHANGESTAGE.get(phase_str, phase_str)
            phase = ChangeStage(phase_str_mapped)
    except ValueError as ve:
        raise ValueError(
            f"_synthetic_reward: invalid therapeutic_mode='{mode_str}' or "
            f"deaddiction_phase='{phase_str}' in scenario. "
            f"Valid modes: {sorted(m.value for m in TherapeuticMode)}. "
            f"Fix normalisePythonMode() in routes/training.js. Error: {ve}"
        ) from ve

    # ── Dimension 1: Mode-conditional stress reward ───────────────────────────
    stress_delta = state.stress_index - next_stress  # positive = stress went down

    # Extract flooding sub-phase from deaddiction_phase when in flooding mode
    flooding_subphase = state.deaddiction_phase if mode == TherapeuticMode.FLOODING else ""

    if mode == TherapeuticMode.FLOODING:
        target = getattr(state, "flooding_target_stress", 0.80)
        if flooding_subphase == "flooding_peak":
            # At peak: maintain high stress, penalise escape (premature stress drop)
            if next_stress >= target - 0.05:
                stress_r = 1.0
            else:
                stress_r = max(0.0, 1.0 - (target - next_stress) * 4.0)   # hard fall-off
        elif flooding_subphase == "flooding_recovery":
            # Recovery: reward declining stress — patient is processing, not escaping
            stress_r = max(0.0, min(1.0, 0.5 + stress_delta * 4.0))
        else:
            # General exposure: reward proximity to flooding target
            stress_r = max(0.0, 1.0 - abs(next_stress - target) * 2.0)
    elif state.deaddiction_phase == "relapse":
        # Relapse: heavily reward de-escalation; penalise any confrontation
        stress_r = max(0.0, min(1.0, 0.5 + stress_delta * 6.0))
    elif state.deaddiction_phase == "termination":
        # Termination / closing: reward low stress and session coherence
        stress_r = max(0.0, 1.0 - next_stress * 1.5)
    elif mode in (TherapeuticMode.DEADDICTION, TherapeuticMode.BEHAVIOUR_CHANGE) and phase == ChangeStage.CONTEMPLATION:
        # Hold mild productive tension around σ = 0.35
        stress_r = max(0.0, 1.0 - abs(next_stress - 0.35) * 3.0)
    elif mode in (TherapeuticMode.DEADDICTION, TherapeuticMode.BEHAVIOUR_CHANGE) and phase in (
        ChangeStage.PREPARATION, ChangeStage.ACTION
    ):
        # Reward if stress is above 0.40 (controlled confrontation zone)
        stress_r = min(1.0, next_stress / 0.70)
    else:
        # Standard / engaging / negotiation / mental_health / professional_critique:
        # reward stress reduction
        stress_r = max(0.0, min(1.0, 0.5 + stress_delta * 5.0))

    # ── CRITICAL stress gate enforcement ─────────────────────────────────────
    # Mirrors action_selector.js rule #1 and #2.
    # Panic psychoeducation cluster is explicitly allowed at critical stress —
    # these are the medically correct responses to acute panic, not generic calming.
    from tensornets.a3c.action_bandit import ACTION_INTENT_GROUP  # lazy; cached after first call
    _critical_allowed = {
        "validate", "empathic_reflection", "safety_protocol", "acknowledge_only",
        "escalate", "flooding_hold", "flooding_deepen", "spike_step",
        # Panic cluster — only correct actions for zone 4 / acute distress
        "panic_reassure_not_cardiac", "panic_reassure_not_hypoxic",
        "panic_normalise_duration",   "panic_grounding_54321",
        "panic_support_available",    "panic_safety_assess_faint",
        # Social coordination — mobilising help IS valid at critical stress
        "request_presence", "call_for_help",
        # Distraction is conditionally allowed at CRITICAL — only for rumination spirals,
        # not when the patient expresses cardiac fear or acute medical symptoms.
        # The reward penalty is NOT applied here; context-sensitivity is the LLM's job.
        # We do NOT blanket-permit distraction at CRITICAL to avoid rewarding it
        # over the panic cluster when panic language is present.
    }
    # At CRITICAL stress: if a distraction action is chosen instead of panic cluster,
    # apply a smaller reward penalty — it's not as wrong as challenging_insight, but
    # it's not the right first choice when cardiac/panic language is present.
    _distraction_at_critical = {
        a for a in ACTION_INTENT_GROUP
        if ACTION_INTENT_GROUP.get(a) == "distraction"
    }
    if state.stress_index >= 0.85 and action in _distraction_at_critical:
        # Penalty only when panic cluster would have been more appropriate.
        # Proxy: the response text contains language from the panic domain.
        # Derived from what panic actions address — no hardcoded word list.
        _panic_actions = {
            a for a in ACTION_INTENT_GROUP
            if ACTION_INTENT_GROUP.get(a) == "panic"
        }
        # If any panic action was available (stress is critical) AND the response
        # itself contains words that suggest the patient needed reassurance, penalise.
        if _panic_actions:
            # Low-cost check: does the response use words that indicate the patient
            # expressed cardiac/breathing distress (as opposed to rumination)?
            # We derive this from the response, not a hardcoded medical dictionary.
            words = set((response_text or "").lower().split())
            cardiac_tokens = {"heart", "cardiac", "chest", "suffocating", "breath",
                              "dying", "oxygen", "fainting", "collapse", "emergency"}
            if words & cardiac_tokens:
                stress_r = max(0.0, stress_r - 0.20)
    if state.stress_index >= 0.85 and action not in _critical_allowed and action not in _distraction_at_critical:
        stress_r = max(0.0, stress_r - 0.40)   # hard penalty for violating CRITICAL gate

    # ── Panic cluster: extra stress reward when zone ≥ 4 ─────────────────────
    # These actions are specifically designed for acute panic — reward them
    # generously when stress is critical to reinforce correct action selection.
    _panic_actions = {
        "panic_reassure_not_cardiac", "panic_reassure_not_hypoxic",
        "panic_normalise_duration",   "panic_grounding_54321",
        "panic_support_available",    "panic_safety_assess_faint",
    }
    if action in _panic_actions and state.stress_index >= 0.80:
        # Bonus: these are the RIGHT actions here; other arms that select
        # generic "breathing_exercise" at zone 4 will score lower.
        stress_r = min(1.0, stress_r + 0.20)

    # ── Emergency group: big bonus when acute-emergency keywords detected ──────
    # emergency_mobilise / witness_grief / safety_exit_protocol are only correct
    # when the patient describes a life-threatening event.  Reward them if the
    # response text contains acute-emergency signals; penalise them otherwise
    # (they are catastrophising if applied to non-emergencies).
    _emergency_actions = {
        a for a in ACTION_INTENT_GROUP
        if ACTION_INTENT_GROUP.get(a) == "emergency"
    }
    if action in _emergency_actions:
        words = set((response_text or "").lower().split())
        acute_tokens = {
            "stroke", "heart attack", "angina", "cardiac",
            "accident", "bleeding", "unconscious", "not breathing",
            "dead", "died", "death", "suicide", "threatening",
            "fight", "weapon", "knife", "gun", "attacking",
        }
        if words & acute_tokens:
            stress_r = min(1.0, stress_r + 0.30)
        else:
            stress_r = max(0.0, stress_r - 0.25)  # applied without cause

    # ── MCTS6: session boundary reward gating ─────────────────────────────────
    # goal_reassess on the first turn of a new session is correct behaviour —
    # reward it.  Deep therapeutic actions at boundary get a penalty because
    # rapport has not been re-established.
    if getattr(state, "session_boundary", False):
        if action == "goal_reassess":
            stress_r = min(1.0, stress_r + 0.15)
        elif _session_boundary_gate(action, session_boundary=True):
            stress_r = max(0.0, stress_r - 0.20)

    # ── CONSIST1: consistency / truth-seeking reward gating ───────────────────
    # seek_probe_consent before a retroactive probe = correct trauma-informed
    # practice; reward when stress is low (safe to revisit).  If used while
    # stress is HIGH, it's poor timing — apply a small penalty.
    # normalise_discrepancy used when conversation_correction is negative
    # (patient responded less than expected) suggests they felt pushed or
    # challenged — normalising is the right de-escalation; reward it.
    if action == "seek_probe_consent":
        if state.stress_index < 0.45:
            stress_r = min(1.0, stress_r + 0.10)   # correct: low stress, safe probe
        else:
            stress_r = max(0.0, stress_r - 0.10)   # wrong timing — patient not ready
    if action == "normalise_discrepancy":
        # Reward when patient appears defensive (stress rising) — this is exactly
        # when normalisation matters most.
        if state.stress_index > 0.45:
            stress_r = min(1.0, stress_r + 0.12)
        else:
            stress_r = min(1.0, stress_r + 0.05)   # small reward in calm states too

    # ── Dimension 2: Goal progress ────────────────────────────────────────────
    # NOTE: keyword scan removed. It was circular — any response containing
    # clinical keywords scored high regardless of clinical quality.
    # The LLM scorer (A3CScorer) evaluates goal_progress independently via
    # scorer_reward_dims["goal_progress"] in worker.py.
    #
    # Here we use only the action-taxonomy signal (which IS independently
    # grounded — advancing actions earn a bonus; questioning/probing actions
    # earn a smaller bonus (they move the conversation but don't deliver value);
    # holding actions are neutral; pure social/deflection penalises.
    #
    # IMPORTANT: goal_r measures the INCREMENTAL contribution of this action
    # to goal progress — it is a per-turn delta, NOT an absolute state.
    # Using absolute info_coverage here would cause reward leakage: actions
    # early in a session that prime info coverage would inflate goal_r for
    # all subsequent turns regardless of what those turns actually do.
    advancing = {
        "psychoeducation", "motivational_frame", "develop_discrepancy",
        "give_options", "summarise", "challenger_insight", "give_facts",
        "oars_summary", "loss_frame", "socratic_reframe",
        "share_circle_insight", "direct_advice", "future_planning",
        "surface_intervention",   # surfacing a cross-circle concern advances goals
        "schedule_commitment",    # commitment advances behavioural goal
        # Panic cluster contributes to safety goal when stress is critical
        "panic_reassure_not_cardiac", "panic_reassure_not_hypoxic",
        "panic_normalise_duration",
    }
    # Questioning actions surface information but don't deliver value by themselves.
    questioning = {
        "probing_question", "specific_question", "clarify_goal",
        "elicit_change_talk", "explore_ambivalence",
    }
    holding = {"validate", "empathic_reflection", "unconditional_regard", "acknowledge_only"}
    # Social/rapport actions — earn trust that makes the patient receptive.
    # Must match ACTION_TAXONOMY in action_bandit.py exactly.
    social = {
        "affirmation",          # OARS: genuine strength recognition
        "validate",             # normalise experience
        "unconditional_regard", # non-judgment signal
        "build_alliance",       # therapeutic alliance reinforcement
        "companion_handoff",    # session brief (end-of-session rapport)
        "end_conversation",     # natural close (positive closure = rapport value)
    }
    # Distraction / panic grounding: neutral for goal progress (they interrupt
    # rumination but don't advance the session goal themselves).
    distraction_or_grounding = {
        "distraction_technique", "humour_deflection", "curiosity_pivot",
        "panic_grounding_54321", "panic_support_available",
        "breathing_exercise", "mindfulness_prompt",
        "check_on_caregiver",   # shifts focus; neutral for primary session goal
    }
    # Social coordination that does advance goals (mobilising help, coordinating care)
    # is counted as advancing.
    _social_advancing = {
        "coordinate_care",      # multi-party care plan = real goal progress
        "request_presence",     # summoning support is a concrete positive step
        "call_for_help",        # same
        "delegate_to_human",    # clear handoff = goal progress (appropriate referral)
        "schedule_future_interaction",  # concrete future plan = goal progress (session extends)
        "coordinate_companion_handoff", # cross-session coordination = care continuity
    }
    # Social actions that hold or protect without advancing
    _social_holding = {
        "confidentiality_hold", # necessary protective action; neutral for goal
        "normalise_role",       # boundary clarity; neutral
        "mediate_conflict",     # can advance relationship goals but not session content goal
    }
    # De-escalation cluster: derived from intent group, not hardcoded list
    _deescalate = {
        a for a in ACTION_INTENT_GROUP
        if ACTION_INTENT_GROUP.get(a) == "deescalate"
    }
    if action in advancing or action in _social_advancing:
        goal_r = _GOAL_R_ADVANCING
    elif action in questioning:
        goal_r = _GOAL_R_QUESTIONING
    elif action in holding or action in distraction_or_grounding or action in _social_holding:
        goal_r = _GOAL_R_HOLDING
    elif action in _deescalate:
        # De-escalation actions hold goal progress at HIGH stress — they protect
        # the therapeutic relationship, enabling future goal progress.
        # At HIGH/CRITICAL stress they are the CORRECT choice and earn a bonus.
        goal_r = _GOAL_R_HOLDING
        if state.stress_index >= 0.65:
            # Bonus: choosing de-escalation over advancing at high stress is correct.
            goal_r = min(1.0, goal_r + 0.15)
    elif action in social:
        goal_r = _GOAL_R_SOCIAL
    else:
        goal_r = _GOAL_R_OTHER

    # ── Dimension 3: Trust delta ──────────────────────────────────────────────
    words_lower = response_text.lower() if response_text else ""
    if words_lower:
        build_hits = sum(1 for kw in TRUST_BUILD if kw in words_lower)
        erode_hits = sum(1 for kw in TRUST_ERODE if kw in words_lower)
        trust_raw  = (build_hits - 2 * erode_hits) / max(1, build_hits + erode_hits + 1)
        trust_r    = max(0.0, min(1.0, 0.5 + trust_raw * 0.5))
    elif state.repetition_detected:
        trust_r    = 0.35
    else:
        trust_r    = 0.60 if stress_delta >= 0 else 0.40

    # ── Dimension 4: Info coverage ────────────────────────────────────────────
    # Uses the LLM-scored info gain (novelty × 0.6 + relevance × 0.4) injected
    # by worker.py as state._orchestrator_coverage.
    # Additionally, a novelty discovery bonus rewards the agent for surfacing
    # information the patient has not yet disclosed — the "fresh/rare info"
    # signal the user expects.  This is the single strongest driver of
    # information-exchange quality: the agent should ask questions and frame
    # responses that elicit new disclosures, not recycle what it already knows.
    #
    # Bonus tiers (additive to gain, capped at 1.0 total):
    #   novelty ≥ 0.80 → +0.20  (highly novel: patient revealed something new)
    #   novelty ≥ 0.55 → +0.10  (moderately new)
    #   novelty <  0.30 → −0.10 (repetition — agent cycling through known content)
    orchestrator_coverage = getattr(state, "_orchestrator_coverage", None)
    base_gain = orchestrator_coverage if orchestrator_coverage is not None else 0.5

    novelty_score = getattr(state, "_info_novelty", None)
    if novelty_score is not None:
        if novelty_score >= 0.80:
            novelty_bonus = 0.20
        elif novelty_score >= 0.55:
            novelty_bonus = 0.10
        else:
            novelty_bonus = -0.10 if novelty_score < 0.30 else 0.0
    else:
        novelty_bonus = 0.0

    info_r = max(0.0, min(1.0, base_gain + novelty_bonus))

    # ── Dimension 5: Multi-agent consistency ─────────────────────────────────
    if action == state.last_action and not state.repetition_detected and state.turn_count > 1:
        consistency_r = 0.4   # repeating same action without reason
    else:
        consistency_r = 0.8

    # ── Compose via mode weights ─────────────────────────────────────────────
    weight_key = phase.value if mode in (TherapeuticMode.DEADDICTION, TherapeuticMode.BEHAVIOUR_CHANGE) else mode_str
    # Map new stage names to old MCTS_WEIGHTS keys
    from tensornets.therapy.modes import CHANGESTAGE_TO_DEADDICTION
    weight_key = CHANGESTAGE_TO_DEADDICTION.get(weight_key, weight_key)
    weights    = MCTS_WEIGHTS.get(weight_key, MCTS_WEIGHTS["standard"])
    # weights = [stress_reduction, goal_progress, trust_delta, info_coverage, consistency]
    # Normalise trust from [0,1] to [-1,+1] for the RewardVector's shift
    composite  = (
        weights[0] * stress_r
        + weights[1] * goal_r
        + weights[2] * trust_r          # already [0,1] here (shifted from [-1,+1])
        + weights[3] * info_r
        + weights[4] * consistency_r
    )

    safety_r = 0.2 if action == "safety_protocol" and state.stress_index < 0.50 else 1.0

    return {
        "stress":        round(stress_r, 4),
        "trust_delta":   round(trust_r, 4),
        "goal_progress": round(goal_r, 4),
        "info_coverage": round(info_r, 4),
        "consistency":   round(consistency_r, 4),
        "safety":        round(safety_r, 4),
        # Convenience scalar for logging
        "_composite":    round(composite, 4),
    }


def _last_user_message(state: TurnState) -> str:
    """
    Extract the most recent user message from conversation_history.
    Used by all arms instead of indexing into the now-removed scenario['turns'] list.
    """
    for msg in reversed(state.conversation_history):
        if msg.get("role") == "user":
            return msg.get("content", "[no message]")
    return "[no message]"


def _safe_fmt(template: str, **kwargs) -> str:
    """Format *template* with *kwargs*, filling any missing keys with ''."""
    import string
    keys = {fn for _, fn, _, _ in string.Formatter().parse(template) if fn is not None}
    for k in keys:
        kwargs.setdefault(k, "")
    return template.format(**kwargs)


def _build_longitudinal_hint(state: "TurnState") -> str:
    """
    Build the {{LONGITUDINAL_HINT}} block injected into the action selector prompt.

    Mirrors JS getLongitudinalHint() in companions/utils/promptLoader.js.
    Pulls from state.longitudinal_hint (already populated by worker.py from
    the prior session summary), state.session_memory, and state.future_plans_summary.

    Returns empty string if no cross-session data is available (first session).
    """
    parts: list[str] = []

    hint = (getattr(state, "longitudinal_hint", None) or "").strip()
    if hint:
        parts.append(f"[Prior session] {hint}")

    mem = getattr(state, "session_memory", None) or {}
    if isinstance(mem, dict) and mem:
        session_num  = mem.get("session_number", "")
        last_outcome = mem.get("last_session_outcome", "")
        flagged      = mem.get("flagged_topics", [])
        goal_prog    = mem.get("goal_progress", "")
        alliance     = mem.get("alliance_score", "")

        if session_num:
            parts.append(f"Session: {session_num}")
        if last_outcome:
            parts.append(f"Last outcome: {last_outcome}")
        if goal_prog:
            parts.append(f"Goal progress: {goal_prog}")
        if alliance:
            parts.append(f"Alliance: {alliance}")
        if flagged:
            topics = ", ".join(flagged) if isinstance(flagged, list) else str(flagged)
            parts.append(f"Flagged topics (handle carefully): {topics}")

    fp = (getattr(state, "future_plans_summary", None) or "").strip()
    if fp:
        parts.append(f"[Scheduled] {fp}")

    if not parts:
        return ""
    return "\n[Longitudinal context]\n" + "\n".join(parts)


def _build_available_actions(state: "TurnState") -> tuple[str, str]:
    """
    Compute the available and blocked action lists for the current stress level.

    Mirrors JS CompanionCoordinator's action gate logic — derives everything
    from ACTION_INTENT_GROUP and CALMING_WEIGHT; no hardcoded lists.

    Returns
    -------
    available : str   — comma-separated allowed actions for current stress
    blocked   : str   — comma-separated blocked actions for current stress
    """
    from tensornets.a3c.action_bandit import (
        ACTION_TAXONOMY, ACTION_INTENT_GROUP, CALMING_WEIGHT,
    )

    stress = state.stress_index

    # Groups that are always available regardless of stress
    _always = {"safety", "meta", "deescalate"}

    # At CRITICAL stress (≥ 0.85): only safety + panic + deescalate + validate
    _critical_groups = {"safety", "panic", "deescalate", "validate", "meta"}
    # At HIGH stress (≥ 0.65): add empathy, coping, distraction (non-medical)
    _high_groups     = _critical_groups | {"coping", "distraction", "summarise"}
    # At MODERATE (≥ 0.40): also allow ask, inform, explore
    _moderate_groups = _high_groups | {"ask", "inform", "explore", "direction"}
    # At LOW (<0.40): all groups available
    _low_groups      = set(ACTION_INTENT_GROUP.values())

    if stress >= 0.85:
        allowed_groups = _critical_groups
    elif stress >= 0.65:
        allowed_groups = _high_groups
    elif stress >= 0.40:
        allowed_groups = _moderate_groups
    else:
        allowed_groups = _low_groups

    available = [a for a in ACTION_TAXONOMY if ACTION_INTENT_GROUP.get(a) in allowed_groups]
    blocked   = [a for a in ACTION_TAXONOMY if a not in available]

    # MCTS6: at session boundary, suppress deep therapeutic actions and elevate
    # goal_reassess to the front of the available list.
    if getattr(state, "session_boundary", False):
        _boundary_suppress = {
            "flooding_deepen", "flooding_hold",
            "socratic_probe", "socratic_reframe",
            "develop_discrepancy", "loss_frame", "direct_confrontation",
            "challenger_insight",
        }
        available = [a for a in available if a not in _boundary_suppress]
        blocked   = list(set(blocked) | _boundary_suppress)
        # Promote goal_reassess and summarise_session to front
        for front_action in ("summarise_session", "goal_reassess"):
            if front_action in available:
                available.remove(front_action)
                available.insert(0, front_action)

    return ", ".join(available), ", ".join(blocked)


def _build_known_context_block(state: "TurnState") -> str:
    """
    Return the {{KNOWN_CONTEXT}} block for injection into the action selector.

    In JS this is populated via facts_v2 retrieval before the action selector call.
    Here we use whatever is already in state.known_context (populated by worker.py
    from the session_memory / AllianceGraph injection at episode start).
    """
    ctx = (getattr(state, "known_context", None) or "").strip()
    if not ctx:
        return ""
    return f"\n[Known patient context]\n{ctx}"


    """
    Build the natural-language physio + hysteresis context string for Exp 1 (PhysioLLM).

    Mirrors the format of longitudinalHint from companions/utils/promptLoader.js.

    physio_source controls how much detail is shown:
      "sensor"    → full numeric values (real measurements)
      "simulated" → numeric values labelled as "estimated" (scenario-derived)
      "none"      → stress bucket only; no numeric values injected into prompt
    """
    physio_source = getattr(state, "physio_source", "sensor")
    stress_label  = _stress_label(state.stress_index)
    conv_stress   = getattr(state, "conversation_stress", 0.5)
    conv_label    = _stress_label(conv_stress)

    if physio_source == "none":
        # No wearable — show only conversation-inferred signal
        lines = [
            f"- Stress level (conversation cues): {conv_label} (no wearable data)",
        ]
    else:
        physio = state.physio or {}
        qualifier = {
            "sensor":     "",
            "simulated":  " (estimated from scenario)",
            "population": " (population estimate)",
        }.get(physio_source, "")
        hrv   = physio.get("hrv_ms") or physio.get("hrv_rmssd_ms") or physio.get("hrv", "N/A")
        eda   = physio.get("eda_us") or physio.get("eda", "N/A")
        sleep = physio.get("sleep_pressure") or physio.get("sleep_deficit") or physio.get("sleep", "N/A")

        # Compute and narrate the discrepancy between physio and conversation signals
        discrepancy = state.stress_index - conv_stress
        if abs(discrepancy) < 0.08:
            disc_note = "physio and conversation signals agree"
        elif discrepancy > 0:
            disc_note = f"⚠ physio ({state.stress_index:.2f}) > conversation ({conv_stress:.2f}) — possible masking"
        else:
            disc_note = f"⚠ conversation ({conv_stress:.2f}) > physio ({state.stress_index:.2f}) — possible outburst"

        lines = [
            f"- Stress level (wearable): {stress_label} (index={state.stress_index:.2f}){qualifier}",
            f"- Stress level (conversation): {conv_label} (index={conv_stress:.2f})",
            f"- Signal alignment: {disc_note}",
            f"- HRV RMSSD: {hrv} ms{qualifier}",
            f"- EDA: {eda} µS{qualifier}",
            f"- Sleep pressure: {sleep}{qualifier}",
        ]

    hysteresis = scenario.get("hysteresis_context", {})
    if hysteresis:
        lines.append("Longitudinal trigger history:")
        for trigger_id, info in hysteresis.items():
            pct  = info.get("pct_extinguished", 0)
            suds = info.get("suds", "N/A")
            lines.append(f"  - {trigger_id}: {pct:.0f}% extinguished (SUDS={suds})")
    return "\n".join(lines)


def _stress_label(stress_index: float) -> str:
    if stress_index < 0.35:
        return "low stress"
    if stress_index < 0.65:
        return "moderate stress"
    return "high stress"


# ── Exp 2: PhysioLLMCoTMCTSWorker -- physio_llm_cot_mcts ─────────────────────

class PhysioLLMCoTMCTSWorker(PhysioLLMWorker):
    """
    Exp 2: Physio-in-prompt + Maverick chain-of-thought action selection.

    Differs from Exp 1 (PhysioLLMWorker) in one way:
      Instead of using actor.select() to pick the action, a Maverick LLM call
      evaluates ALL 51 ACTION_TAXONOMY candidates and returns the top-ranked
      action with a justification chain (CoT).

    This arm is a deliberate cost/capability baseline for Exp 3 (PhysioMPSMCTSWorker):
      - CoT call uses Maverick (more expensive than Scout)
      - Every turn has 2 LLM calls: CoT (Maverick) + generation (Scout)
      - No MPS tree search; reasoning is done entirely in language space

    The purpose is to answer: "Can an LLM reason its way to the same action
    quality as a structured MPS-MCTS planner, and at what cost premium?"

    No fallbacks. If the CoT call fails, RuntimeError propagates to train.py
    which records the episode as failed and moves on.
    """

    ARM = "physio_llm_cot_mcts"

    # CoT prompt template.  Variables: {physio_ctx}, {actions_list}, {scenario_goal},
    # {last_patient_message}, {zone_ctx} (empty string for this class).
    _COT_PROMPT_TEMPLATE = (
        "You are a clinical AI planner choosing the best therapeutic action.\n\n"
        "Physiological context:\n{physio_ctx}\n\n"
        "{zone_ctx}"
        "Session goal: {scenario_goal}\n"
        "Therapeutic mode: {therapeutic_mode}  |  Stress: {stress_bucket}\n"
        "Turns completed: {turns_completed}  |  Info coverage: {info_coverage}\n"
        "Last action: {last_action}  |  Repetition: {repetition_flag}\n"
        "{longitudinal_hint}"
        "{known_context}"
        "Last patient message: {last_patient_message}\n\n"
        "Available actions at this stress level (choose exactly one):\n{actions_list}\n\n"
        "Reason step-by-step (3-5 sentences), then output your final answer as:\n"
        "CHOSEN_ACTION: <action_name>\n"
        "CONFIDENCE: <0.0-1.0>\n"
        "REASONING: <one sentence summary>"
    )

    def _run_cot_action_selection(
        self,
        state: TurnState,
        scenario: dict,
    ) -> tuple[str, dict]:
        """
        Use Scout to select the best action via CoT, with full session context.

        Uses _build_available_actions() to restrict the action list to stress-appropriate
        choices — matches JS PROMPT_ACTION_SELECTOR gate logic.
        """
        from tensornets.a3c.action_bandit import ACTION_TAXONOMY

        physio_ctx      = _build_hysteresis_context(state, scenario)
        longitudinal    = _build_longitudinal_hint(state)
        known_ctx       = _build_known_context_block(state)
        available, _    = _build_available_actions(state)

        # Restrict to stress-gated actions only (mirrors JS AVAILABLE_ACTIONS)
        available_set      = set(available.split(", ")) if available else set(ACTION_TAXONOMY)
        available_taxonomy = [a for a in ACTION_TAXONOMY if a in available_set] or list(ACTION_TAXONOMY)

        actions_list     = "\n".join(
            f"  {i+1:2d}. {name}" for i, name in enumerate(available_taxonomy)
        )
        last_patient_msg = _last_user_message(state)

        zone_ctx = ""  # overridden by InertialPhysioLLMCoTMCTSWorker

        prompt = self._COT_PROMPT_TEMPLATE.format(
            physio_ctx         = physio_ctx,
            zone_ctx           = zone_ctx,
            scenario_goal      = scenario.get("session_goal", ""),
            therapeutic_mode   = state.therapeutic_mode or "standard",
            stress_bucket      = state.stress_bucket,
            turns_completed    = state.turn_count,
            info_coverage      = f"{state.info_coverage:.0%}",
            last_action        = state.last_action or "none",
            repetition_flag    = "true" if state.repetition_detected else "false",
            longitudinal_hint  = longitudinal,
            known_context      = known_ctx,
            last_patient_message = last_patient_msg,
            actions_list       = actions_list,
        )

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": "You are a clinical AI planner.", "prompt": prompt,
                 "max_tokens": 512, "arm": self.ARM},
                timeout=40.0,
            )
        except Exception as exc:
            raise RuntimeError(
                f"{self.__class__.__name__}: Scout CoT call failed: {exc}. "
                f"Check that the tensornets FastAPI server is running on {_TENSORNETS_URL}."
            ) from exc

        text = resp.get("text", "").strip()
        if not text:
            raise RuntimeError(
                f"{self.__class__.__name__}: Scout returned empty CoT response."
            )

        chosen_action = None
        for line in text.splitlines():
            if line.strip().startswith("CHOSEN_ACTION:"):
                candidate = line.split(":", 1)[1].strip()
                if candidate in ACTION_TAXONOMY:
                    chosen_action = candidate
                    break

        if chosen_action is None:
            raise RuntimeError(
                f"{self.__class__.__name__}: CoT response did not contain a valid "
                f"CHOSEN_ACTION from ACTION_TAXONOMY.\nRaw response:\n{text[:400]}"
            )

        tokens_in  = resp.get("usage", {}).get("input_tokens",  0)
        tokens_out = resp.get("usage", {}).get("output_tokens", 0)
        latency_ms = resp.get("latency_ms", 0.0)

        return chosen_action, {
            "cot_text":       text,
            "tokens_in":      tokens_in,
            "tokens_out":     tokens_out,
            "latency_ms":     latency_ms,
        }

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        """
        Override: replace actor.select() with Maverick CoT, then call Scout for generation.

        The `action` argument from the caller (actor.select() output) is discarded;
        CoT selects its own action from the full taxonomy.
        """
        t_start = time.perf_counter()

        # ── Step 1: CoT action selection (Maverick) ───────────────────────────
        chosen_action, cot_meta = self._run_cot_action_selection(state, scenario)

        # ── Step 2: Scout generation (same as PhysioLLMWorker) ───────────────
        # Temporarily override action to the CoT-selected one
        result = super().generate_response(
            state,
            chosen_action,        # CoT overrides actor.select()
            scenario,
            conversation_correction=conversation_correction,
        )

        # ── Step 3: Accumulate CoT token and cost metadata ────────────────────
        existing_scout_tokens = result.get("tokens", {}).get("scout", 0)

        result["tokens"] = {
            "scout":           existing_scout_tokens + cot_meta["tokens_in"] + cot_meta["tokens_out"],
            "maverick":        0,
            "maverick_in":     0,
            "maverick_out":    0,
        }
        result["latency_ms"] = round((time.perf_counter() - t_start) * 1000.0, 1)
        result["llm_calls"]  = 2     # CoT call + Scout generation
        result["cot_action"] = chosen_action
        result["cot_reasoning"] = cot_meta.get("cot_text", "")[:200]   # truncate for log
        return result


# ── Exp 4: InertialPhysioMPSMCTSWorker -- inertial_physio_mps_mcts ───────────

class InertialPhysioMPSMCTSWorker(PhysioMPSMCTSWorker):
    """
    Exp 4: Full MPS-MCTS + HysteresisGate 5-zone dead-band.

    Extends PhysioMPSMCTSWorker by adding a HysteresisGate that prevents strategy
    flip-flopping.  The gate's zone and streak are injected into:
      1. The MCTS payload (physio_state.hysteresis_zone, physio_state.hysteresis_streak)
         so the MPS tree search is aware of the sustained stress tier.
      2. The system prompt (via stress_bucket override) so the Scout generation
         reflects the locked zone rather than the instantaneous stress_index.

    The gate is created fresh at episode start (caller must call reset_gate() before
    each episode, or use a new worker instance per episode).

    No fallbacks. If HysteresisGate raises ValueError (invalid stress_index), the
    episode fails. This enforces that stress_index is always in [0, 1].
    """

    ARM = "inertial_physio_mps_mcts"

    _DEFAULT_SYSTEM_PROMPT = (
        "You are a clinical companion. Current action strategy: {action}. "
        "Patient stress: {stress_index:.2f} (zone: {stress_bucket}). "
        "{hysteresis_ctx}"
        "Respond with one empathetic, concise message (2-3 sentences)."
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._gate: "HysteresisGate | None" = None

    def reset_gate(self) -> None:
        """Create a fresh HysteresisGate for a new episode."""
        from tensornets.a3c.hysteresis_gate import HysteresisGate
        self._gate = HysteresisGate()

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        from tensornets.a3c.hysteresis_gate import HysteresisGate

        # Gate must be initialised — create lazily if caller forgot to call reset_gate()
        if self._gate is None:
            self._gate = HysteresisGate()

        # Advance the gate — raises ValueError if stress_index outside [0, 1]
        zone, zone_changed = self._gate.update(state.stress_index)
        zone_name   = self._gate.zone_name
        zone_streak = self._gate.streak

        # ── Inject zone into MCTS physio payload ──────────────────────────────
        # We achieve this by temporarily enriching state.physio before the
        # parent's generate_response reads it for the MCTS call.
        enriched_physio = dict(state.physio or {})
        enriched_physio["hysteresis_zone"]   = zone
        enriched_physio["hysteresis_zone_name"] = zone_name
        enriched_physio["hysteresis_streak"] = zone_streak
        enriched_physio["zone_changed"]      = zone_changed

        # Build a transient state copy with enriched physio and zone-locked stress_bucket
        from dataclasses import replace
        enriched_state = replace(
            state,
            physio        = enriched_physio,
            stress_bucket = zone_name,   # override bucket with locked zone name
        )

        result = super().generate_response(
            enriched_state,
            action,
            scenario,
            conversation_correction=conversation_correction,
        )

        # Attach gate metadata for logging and DB
        result["hysteresis_zone"]    = zone
        result["hysteresis_zone_name"] = zone_name
        result["hysteresis_streak"]  = zone_streak
        result["hysteresis_changed"] = zone_changed
        result["hysteresis_gate"]    = self._gate.to_dict()
        return result


# ── Exp 5: InertialPhysioLLMCoTMCTSWorker -- inertial_physio_llm_cot_mcts ────

class InertialPhysioLLMCoTMCTSWorker(PhysioLLMCoTMCTSWorker):
    """
    Exp 5: CoT-MCTS action selection + HysteresisGate 5-zone dead-band.

    Combines the CoT planner from PhysioLLMCoTMCTSWorker with the inertial
    dead-band state machine from InertialPhysioMPSMCTSWorker.

    The zone and streak are injected into the CoT prompt so the Maverick
    planner reasons about the sustained physiological state, not just the
    instantaneous stress_index.
    """

    ARM = "inertial_physio_llm_cot_mcts"

    # Override CoT template to include zone context
    _COT_PROMPT_TEMPLATE = (
        "You are a clinical AI planner choosing the best therapeutic action.\n\n"
        "Physiological context:\n{physio_ctx}\n\n"
        "{zone_ctx}"
        "Session goal: {scenario_goal}\n"
        "Last patient message: {last_patient_message}\n\n"
        "Available actions (choose exactly one):\n{actions_list}\n\n"
        "Reason step-by-step (3-5 sentences), then output your final answer as:\n"
        "CHOSEN_ACTION: <action_name>\n"
        "CONFIDENCE: <0.0-1.0>\n"
        "REASONING: <one sentence summary>"
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._gate: "HysteresisGate | None" = None

    def reset_gate(self) -> None:
        """Create a fresh HysteresisGate for a new episode."""
        from tensornets.a3c.hysteresis_gate import HysteresisGate
        self._gate = HysteresisGate()

    def _run_cot_action_selection(
        self,
        state: TurnState,
        scenario: dict,
    ) -> tuple[str, dict]:
        """Override to inject zone context into the CoT prompt."""
        from tensornets.a3c.action_bandit import ACTION_TAXONOMY
        from tensornets.a3c.hysteresis_gate import HysteresisGate

        if self._gate is None:
            self._gate = HysteresisGate()

        zone, zone_changed = self._gate.update(state.stress_index)
        zone_name   = self._gate.zone_name
        zone_streak = self._gate.streak

        zone_ctx = (
            f"Physiological zone (inertial): {zone_name} "
            f"(sustained for {zone_streak} turn(s), "
            f"{'JUST CHANGED' if zone_changed else 'stable'}).\n"
            f"Consider this zone stability when selecting an action.\n\n"
        )

        physio_ctx   = _build_hysteresis_context(state, scenario)
        actions_list = "\n".join(
            f"  {i+1:2d}. {name}" for i, name in enumerate(ACTION_TAXONOMY)
        )
        last_patient_msg = _last_user_message(state)

        prompt = self._COT_PROMPT_TEMPLATE.format(
            physio_ctx=physio_ctx,
            zone_ctx=zone_ctx,
            scenario_goal=scenario.get("session_goal", ""),
            last_patient_message=last_patient_msg,
            actions_list=actions_list,
        )

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": "You are a clinical AI planner.", "prompt": prompt, "max_tokens": 512},
                timeout=40.0,
            )
        except Exception as exc:
            raise RuntimeError(
                f"InertialPhysioLLMCoTMCTSWorker: Maverick CoT call failed: {exc}. "
                f"Check that the tensornets FastAPI server is running on {_TENSORNETS_URL}."
            ) from exc

        text = resp.get("text", "").strip()
        if not text:
            raise RuntimeError(
                "InertialPhysioLLMCoTMCTSWorker: Maverick returned empty CoT response."
            )

        chosen_action = None
        for line in text.splitlines():
            if line.strip().startswith("CHOSEN_ACTION:"):
                candidate = line.split(":", 1)[1].strip()
                if candidate in ACTION_TAXONOMY:
                    chosen_action = candidate
                    break

        if chosen_action is None:
            raise RuntimeError(
                f"InertialPhysioLLMCoTMCTSWorker: CoT response did not contain a valid "
                f"CHOSEN_ACTION.\nRaw response:\n{text[:400]}"
            )

        tokens_in  = resp.get("usage", {}).get("input_tokens",  0)
        tokens_out = resp.get("usage", {}).get("output_tokens", 0)
        latency_ms = resp.get("latency_ms", 0.0)

        return chosen_action, {
            "cot_text":       text,
            "tokens_in":      tokens_in,
            "tokens_out":     tokens_out,
            "latency_ms":     latency_ms,
            "zone":           zone,
            "zone_name":      zone_name,
            "zone_streak":    zone_streak,
            "zone_changed":   zone_changed,
        }

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        t_start = time.perf_counter()

        chosen_action, cot_meta = self._run_cot_action_selection(state, scenario)

        result = PhysioLLMWorker.generate_response(
            self,
            state,
            chosen_action,
            scenario,
            conversation_correction=conversation_correction,
        )

        existing_scout = result.get("tokens", {}).get("scout", 0)
        result["tokens"] = {
            "scout":        existing_scout + cot_meta["tokens_in"] + cot_meta["tokens_out"],
            "maverick":     0,
            "maverick_in":  cot_meta["tokens_in"],
            "maverick_out": cot_meta["tokens_out"],
        }
        result["latency_ms"]     = round((time.perf_counter() - t_start) * 1000.0, 1)
        result["llm_calls"]      = 2
        result["cot_action"]     = chosen_action
        result["cot_reasoning"]  = cot_meta.get("cot_text", "")[:200]
        result["hysteresis_zone"]      = cot_meta.get("zone")
        result["hysteresis_zone_name"] = cot_meta.get("zone_name")
        result["hysteresis_streak"]    = cot_meta.get("zone_streak")
        result["hysteresis_changed"]   = cot_meta.get("zone_changed")
        if self._gate:
            result["hysteresis_gate"] = self._gate.to_dict()
        return result




# ── Exp 6: InertialHPVOOTPhysioMPSMCTSWorker ─────────────────────────────────

class InertialHPVOOTPhysioMPSMCTSWorker(InertialPhysioMPSMCTSWorker):
    """
    Exp 6: MPS-MCTS + HysteresisGate + HP+VOOT+PW tree search.

    Extends Exp 4 (InertialPhysioMPSMCTSWorker) by upgrading the MCTS call
    from DialogMCTS (80 iter, 20 depth) to HierarchicalPWVOOTMCTS
    (150 iter, 20 depth, mcts_mode=hpvoot).

    Extra Scout call per turn fetches a numeric prior score over all HP actions
    before tree search, seeding PW expansion order with contextual relevance.

    Total LLM calls per turn: 2 (Scout prior + Scout generation).
    No fallbacks.
    """

    ARM = "inertial_hpvoot_physio_mps_mcts"

    # HPVOOT runs 150 MCTS iterations with Scout prior scoring per turn, making
    # episodes ~3× slower than flat MCTS arms.  The rebalancer should not treat
    # this arm as a lagger purely because its episode count is lower.
    RELATIVE_SPEED = 0.35

    _DEFAULT_SYSTEM_PROMPT = (
        "You are a clinical companion. Current action strategy: {action}. "
        "Patient stress: {stress_index:.2f} (bucket: {stress_bucket}). "
        "{hysteresis_ctx}"
        "Respond with one empathetic, concise message (2-3 sentences)."
    )

    _PRIOR_SYSTEM = (
        "You are a clinical scoring assistant. "
        "Return a JSON object mapping each action name to a float score 0.0-1.0. "
        "Return ONLY the JSON object, no markdown fences."
    )

    def _fetch_prior_scores(self, state, zone_name, zone_streak, mode, actions):
        """
        Call Scout to score all HP actions given current patient state.
        Returns list[float] in same order as ``actions``.
        Raises RuntimeError on empty response.

        L2 fix: includes last 2 patient turns and session goal in the prompt so
        Scout can discriminate between actions based on conversational context, not
        just stress/zone (which produced near-uniform 0.5 scores before this fix).

        Extraction strategy (robust to truncated responses):
        1. Try to parse the full JSON object if one can be found.
        2. Fall back to scanning individual "key": value lines so partial
           responses still yield useful priors instead of failing entirely.
        3. Default score = 0.5 for any action not found in the response.
        """
        import json as _json, re as _re

        # Build a brief conversation excerpt (last 2 patient turns) for context.
        # This is the critical L2 fix — without it, Scout has no text to reason about
        # and returns near-uniform scores regardless of action type.
        recent_turns = [
            m for m in state.conversation_history[-6:]
            if m.get("role") == "user"
        ][-2:]
        excerpt = "\n".join(
            f"Patient: {m['content'][:200]}" for m in recent_turns
        ) or "(no turns yet)"

        action_list = "\n".join(f"  - {a}" for a in actions)
        prompt = (
            f"Patient state: stress={state.stress_index:.2f}, "
            f"zone={zone_name} (streak={zone_streak}), mode={mode}.\n\n"
            f"Session goal: {state.session_goal or 'general support'}\n\n"
            f"Recent conversation:\n{excerpt}\n\n"
            f"Rate each action 0.0 (wrong for this exact moment) to 1.0 (ideal).\n"
            f"Actions:\n{action_list}"
        )
        # max_tokens large enough for all actions (avg ~8 chars/key, ~5 chars/val, ~30 actions)
        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {"system": self._PRIOR_SYSTEM, "prompt": prompt, "max_tokens": 800, "arm": self.ARM},
            timeout=25.0,
        )
        text = (resp.get("text") or "").strip()
        if not text:
            raise RuntimeError(
                "InertialHPVOOTPhysioMPSMCTSWorker._fetch_prior_scores: "
                "Scout returned empty response."
            )

        score_map = {}

        # Strategy 1: full JSON object (handles well-formed responses)
        m = _re.search(r'\{([^{}]*)\}', text, _re.DOTALL)
        if m:
            try:
                score_map = _json.loads('{' + m.group(1) + '}')
            except _json.JSONDecodeError:
                pass  # fall through to strategy 2

        # Strategy 2: line-by-line key:value scan (handles truncated JSON)
        if not score_map:
            for line in text.splitlines():
                kv = _re.match(
                    r'["\s]*([a-zA-Z_][a-zA-Z0-9_\s]*?)["\s]*:\s*([\d.]+)',
                    line.strip(),
                )
                if kv:
                    score_map[kv.group(1).strip()] = float(kv.group(2))

        self._prior_tokens = {
            "in":  resp.get("usage", {}).get("input_tokens",  0),
            "out": resp.get("usage", {}).get("output_tokens", 0),
        }
        return [float(score_map.get(a, 0.5)) for a in actions]

    def generate_response(self, state, action, scenario, conversation_correction=0.0):
        from tensornets.a3c.hysteresis_gate import HysteresisGate
        from tensornets.mcts.hierarchical_pw_voot import ACTION_CLUSTERS
        from dataclasses import replace

        if self._gate is None:
            self._gate = HysteresisGate()

        zone, zone_changed = self._gate.update(state.stress_index)
        zone_name   = self._gate.zone_name
        zone_streak = self._gate.streak

        enriched_physio = dict(state.physio or {})
        enriched_physio["hysteresis_zone"]      = zone
        enriched_physio["hysteresis_zone_name"] = zone_name
        enriched_physio["hysteresis_streak"]    = zone_streak
        enriched_physio["zone_changed"]         = zone_changed

        enriched_state = replace(
            state,
            physio        = enriched_physio,
            stress_bucket = zone_name,
        )

        all_hp_actions = []
        for acts in ACTION_CLUSTERS.values():
            all_hp_actions.extend(acts)

        # Scout prior
        self._prior_tokens = {"in": 0, "out": 0}
        prior_scores = self._fetch_prior_scores(
            state=state,
            zone_name=zone_name,
            zone_streak=zone_streak,
            mode=scenario.get("mode", "standard"),
            actions=all_hp_actions,
        )

        physio_source = getattr(enriched_state, "physio_source", "sensor")
        mcts_physio   = dict(enriched_physio)
        if physio_source == "none":
            mcts_physio = {k: -1 for k in mcts_physio
                          if isinstance(mcts_physio[k], (int, float))}
            mcts_physio["physio_unknown"] = True

        try:
            mcts_resp = _http_post(
                f"{_TENSORNETS_URL}/mcts/best-action",
                {
                    "physio_state":      mcts_physio,
                    "candidate_actions": all_hp_actions,
                    "mode":              scenario.get("mode", "standard"),
                    "depth":             progressive_lookahead(scenario.get("_arm_ep_count", 0), session_boundary=getattr(state, "session_boundary", False)),
                    "iterations":        150,
                    "context":           state.summary or "",
                    "mcts_mode":         getattr(self, "_mcts_mode_override", "hpvoot"),
                    "llm_prior_scores":  prior_scores,
                    # MCTS6: inertia decay by inter-session gap
                    "gamma_eff":         _temporal_gamma(getattr(state, "session_gap_days", 0.0)),
                    "session_boundary":  getattr(state, "session_boundary", False),
                    "physio_available":  getattr(state, "physio_available", True),
                    # AUDIT1-3: conversation stress signals now in MCTS payload
                    "conversation_stress": getattr(state, "conversation_stress", 0.5),
                    "stress_discrepancy":  round(
                        getattr(state, "stress_index", 0.5)
                        - getattr(state, "conversation_stress", 0.5), 4
                    ),
                    # MCTS9: anticipatory anxiety context
                    "pending_event":       getattr(state, "pending_event", {}),
                },
                timeout=30.0,
            )
        except Exception as exc:
            raise RuntimeError(
                f"InertialHPVOOTPhysioMPSMCTSWorker: MCTS bridge failed: {exc}"
            ) from exc

        chosen_action = mcts_resp.get("best_action") or mcts_resp.get("action") or action
        m_trunc       = mcts_resp.get("M_trunc")

        t_start      = time.perf_counter()
        scout_result = self._call_scout(enriched_state, chosen_action, scenario, m_trunc=m_trunc)

        next_stress = _stress_after_response(
            state.stress_index, chosen_action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
            alliance_score=getattr(state, "alliance_score", 0.5),
            speaker_stress=getattr(state, "companion_stress", 0.5),
            physio_available=getattr(state, "physio_available", True),
            conversation_stress=getattr(state, "conversation_stress", 0.5),
        )
        reward     = _synthetic_reward(state, chosen_action, next_stress,
                                       response_text=scout_result["text"])
        latency_ms = (time.perf_counter() - t_start) * 1000.0

        result = {
            "response":             scout_result["text"],
            "reward":               reward,
            "judge":                {},
            "tokens": {
                "scout_in":   scout_result["tokens_in"]  + self._prior_tokens["in"],
                "scout_out":  scout_result["tokens_out"] + self._prior_tokens["out"],
            },
            "latency_ms":           round(latency_ms, 1),
            "next_stress_index":    next_stress,
            "next_physio":          {**state.physio, "stress_index": next_stress},
            "action_taken":         chosen_action,
            "frames_component":     None,
            "info_coverage":        reward["info_coverage"],
            "repetition_detected":  False,
            "discrepancy":          None,
            "mcts_mode":            getattr(self, "_mcts_mode_override", "hpvoot"),
            "mcts_tree_stats":      mcts_resp.get("tree_stats", {}),
            "hysteresis_zone":      zone,
            "hysteresis_zone_name": zone_name,
            "hysteresis_streak":    zone_streak,
            "hysteresis_changed":   zone_changed,
            "llm_calls":            2,
            "_mcts_top5":           mcts_resp.get("top5", []),
        }
        if self._gate:
            result["hysteresis_gate"] = self._gate.to_dict()
        return result


# ── Exp 7: InertialHPVOOTPhysioLLMCoTMCTSWorker ──────────────────────────────

class InertialHPVOOTPhysioLLMCoTMCTSWorker(InertialPhysioLLMCoTMCTSWorker):
    """
    Exp 7: CoT-MCTS + HysteresisGate + HP+VOOT+PW tree search.

    Extends Exp 5 by upgrading the MCTS step to HP+VOOT+PW.
    The Maverick CoT response includes per-action ratings (0-10) which are
    extracted and reused as the PW prior at zero additional LLM cost.

    Turn flow:
      1. Maverick CoT: rate ALL ACTION_TAXONOMY actions 0-10 + CHOSEN_ACTION.
      2. Parse RATINGS -> llm_prior_scores for HP+VOOT+PW actions.
      3. POST /mcts/best-action mcts_mode=hpvoot, iterations=150, depth=20.
      4. Scout generates the response using MCTS-selected (or CoT) action.

    Total LLM calls per turn: 2. No fallbacks.
    """

    ARM = "inertial_hpvoot_physio_llm_cot_mcts"
    RELATIVE_SPEED = 0.35   # HPVOOT 150-iter + Maverick CoT: ~3× slower than baseline

    def _run_cot_action_selection(self, state, scenario):
        """
        Override Exp 4 CoT to request per-action ratings in the RATINGS section.
        Returns (chosen_action, cot_meta) with hp_actions + llm_prior_scores.
        """
        import re as _re
        from tensornets.a3c.action_bandit import ACTION_TAXONOMY
        from tensornets.mcts.hierarchical_pw_voot import ACTION_CLUSTERS

        if self._gate is None:
            from tensornets.a3c.hysteresis_gate import HysteresisGate
            self._gate = HysteresisGate()

        zone, zone_changed = self._gate.update(state.stress_index)
        zone_name   = self._gate.zone_name
        zone_streak = self._gate.streak

        action_list_str = "\n".join(
            f"  {i+1:2d}. {name}" for i, name in enumerate(ACTION_TAXONOMY)
        )

        cot_prompt = (
            f"You are a clinical AI planner choosing the best therapeutic action.\n\n"
            f"Patient state:\n"
            f"  - Stress index: {state.stress_index:.2f}\n"
            f"  - Stress zone: {zone_name} (sustained {zone_streak} turns)\n"
            f"  - Therapeutic mode: {scenario.get('mode', 'standard')}\n\n"
            f"Recent conversation:\n{state.summary or '(none yet)'}\n\n"
            f"Rate EACH action 0-10 for its appropriateness right now,\n"
            f"then select the single best action.\n\n"
            f"Actions:\n{action_list_str}\n\n"
            f"Format:\n"
            f"RATINGS:\n<action_name>: <0-10>\n...\n\n"
            f"REASONING: <brief justification>\n\n"
            f"CHOSEN_ACTION: <exact action name>"
        )

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"prompt": cot_prompt, "max_tokens": 1400, "arm": self.ARM},
            )
        except Exception as exc:
            raise RuntimeError(
                f"InertialHPVOOTPhysioLLMCoTMCTSWorker: Scout CoT failed: {exc}"
            ) from exc

        text = (resp.get("text") or "").strip()
        if not text:
            raise RuntimeError(
                "InertialHPVOOTPhysioLLMCoTMCTSWorker: Maverick returned empty response."
            )

        chosen_action = None
        for line in text.splitlines():
            if line.strip().startswith("CHOSEN_ACTION:"):
                candidate = line.split(":", 1)[1].strip()
                if candidate in ACTION_TAXONOMY:
                    chosen_action = candidate
                    break
        if chosen_action is None:
            raise RuntimeError(
                f"InertialHPVOOTPhysioLLMCoTMCTSWorker: No valid CHOSEN_ACTION in CoT.\n"
                f"Raw:\n{text[:400]}"
            )

        all_hp_actions = []
        for acts in ACTION_CLUSTERS.values():
            all_hp_actions.extend(acts)

        prior_scores = []
        for a in all_hp_actions:
            m = _re.search(
                rf"{_re.escape(a)}[\s:]+([\d]+(?:\.\d+)?)", text, _re.IGNORECASE
            )
            if m:
                raw = float(m.group(1))
                prior_scores.append(min(1.0, raw / 10.0) if raw > 1.0 else raw)
            else:
                prior_scores.append(0.5)

        tokens_in  = resp.get("usage", {}).get("input_tokens",  0)
        tokens_out = resp.get("usage", {}).get("output_tokens", 0)

        return chosen_action, {
            "cot_text":         text,
            "tokens_in":        tokens_in,
            "tokens_out":       tokens_out,
            "latency_ms":       resp.get("latency_ms", 0.0),
            "zone":             zone,
            "zone_name":        zone_name,
            "zone_streak":      zone_streak,
            "zone_changed":     zone_changed,
            "hp_actions":       all_hp_actions,
            "llm_prior_scores": prior_scores,
        }

    def generate_response(self, state, action, scenario, conversation_correction=0.0):
        from dataclasses import replace
        t_start = time.perf_counter()

        chosen_action, cot_meta = self._run_cot_action_selection(state, scenario)
        all_hp_actions  = cot_meta["hp_actions"]
        prior_scores    = cot_meta["llm_prior_scores"]
        zone            = cot_meta["zone"]
        zone_name       = cot_meta["zone_name"]
        zone_streak     = cot_meta["zone_streak"]
        zone_changed    = cot_meta["zone_changed"]

        enriched_physio = dict(state.physio or {})
        enriched_physio["hysteresis_zone"]      = zone
        enriched_physio["hysteresis_zone_name"] = zone_name
        enriched_physio["hysteresis_streak"]    = zone_streak
        enriched_physio["zone_changed"]         = zone_changed

        enriched_state = replace(
            state,
            physio        = enriched_physio,
            stress_bucket = zone_name,
        )

        physio_source = getattr(state, "physio_source", "sensor")
        mcts_physio   = dict(enriched_physio)
        if physio_source == "none":
            mcts_physio = {k: -1 for k in mcts_physio
                          if isinstance(mcts_physio[k], (int, float))}
            mcts_physio["physio_unknown"] = True

        try:
            mcts_resp = _http_post(
                f"{_TENSORNETS_URL}/mcts/best-action",
                {
                    "physio_state":      mcts_physio,
                    "candidate_actions": all_hp_actions,
                    "mode":              scenario.get("mode", "standard"),
                    "depth":             progressive_lookahead(scenario.get("_arm_ep_count", 0), session_boundary=getattr(state, "session_boundary", False)),
                    "iterations":        150,
                    "context":           state.summary or "",
                    "mcts_mode":         getattr(self, "_mcts_mode_override", "hpvoot"),
                    "llm_prior_scores":  prior_scores,
                    # MCTS6: inertia decay by inter-session gap
                    "gamma_eff":         _temporal_gamma(getattr(state, "session_gap_days", 0.0)),
                    "session_boundary":  getattr(state, "session_boundary", False),
                    "physio_available":  getattr(state, "physio_available", True),
                    # AUDIT1-3: conversation stress signals now in MCTS payload
                    "conversation_stress": getattr(state, "conversation_stress", 0.5),
                    "stress_discrepancy":  round(
                        getattr(state, "stress_index", 0.5)
                        - getattr(state, "conversation_stress", 0.5), 4
                    ),
                    # MCTS9: anticipatory anxiety context
                    "pending_event":       getattr(state, "pending_event", {}),
                },
                timeout=30.0,
            )
        except Exception as exc:
            raise RuntimeError(
                f"InertialHPVOOTPhysioLLMCoTMCTSWorker: MCTS bridge failed: {exc}"
            ) from exc

        final_action = mcts_resp.get("best_action") or mcts_resp.get("action") or chosen_action

        # Call Scout via PhysioLLMWorker.generate_response (which owns the Scout call
        # and reward computation).  This arm's parent chain is CoT → PhysioLLMWorker,
        # so _call_scout is NOT available here; we use the parent generate_response
        # as the Scout + reward stage instead.
        scout_result = PhysioLLMWorker.generate_response(
            self,
            enriched_state,
            final_action,
            scenario,
            conversation_correction=conversation_correction,
        )

        next_stress = scout_result.get("next_stress_index", state.stress_index)
        reward      = scout_result.get("reward", {})
        latency_ms  = (time.perf_counter() - t_start) * 1000.0

        scout_tokens = scout_result.get("tokens", {})
        result = {
            "response":             scout_result["response"],
            "reward":               reward,
            "judge":                scout_result.get("judge", {}),
            "tokens": {
                "scout_in":     scout_tokens.get("scout_in", 0) + cot_meta["tokens_in"],
                "scout_out":    scout_tokens.get("scout_out", 0) + cot_meta["tokens_out"],
                "maverick_in":  0,
                "maverick_out": 0,
            },
            "latency_ms":           round(latency_ms, 1),
            "next_stress_index":    next_stress,
            "next_physio":          {**state.physio, "stress_index": next_stress},
            "action_taken":         final_action,
            "cot_action":           chosen_action,
            "mcts_action":          mcts_resp.get("best_action"),
            "frames_component":     None,
            "info_coverage":        reward.get("info_coverage", 0.0),
            "repetition_detected":  False,
            "discrepancy":          None,
            "mcts_mode":            getattr(self, "_mcts_mode_override", "hpvoot"),
            "mcts_tree_stats":      mcts_resp.get("tree_stats", {}),
            "hysteresis_zone":      zone,
            "hysteresis_zone_name": zone_name,
            "hysteresis_streak":    zone_streak,
            "hysteresis_changed":   zone_changed,
            "llm_calls":            2,
        }
        if self._gate:
            result["hysteresis_gate"] = self._gate.to_dict()
        return result


# ── Safety-ablation variants (Exp 4a, 6a, 0a) ────────────────────────────────
# These subclasses disable a single safety constraint while inheriting all other
# behaviour from their parent arm.  They measure each gate's independent
# contribution to outcome metrics.

class InertialPhysioMPSMCTSNoCritGateWorker(InertialPhysioMPSMCTSWorker):
    """
    Exp 4a: InertialPhysioMPSMCTS without the critical-failure termination gate.

    Identical to Exp 4 except the 2-strike rule does NOT end the episode early.
    The comparison between Exp 4 and Exp 4a isolates the gate's contribution:
    is Exp 4's goal rate driven by the learned policy or by cutting off bad episodes?
    """
    ARM = "inertial_physio_mps_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class InertialHPVOOTPhysioMPSMCTSNoCritGateWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 6a: HPVOOT+PW without the critical-failure episode-termination gate.

    Identical to Exp 6 except the 2-strike rule does NOT end the episode early.
    Measures whether HPVOOT's goal rate improvement over flat MCTS is policy-driven
    or gate-driven.
    """
    ARM = "inertial_hpvoot_physio_mps_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class PhysioLLMNoCritGateWorker(PhysioLLMWorker):
    """
    Exp 1a: PhysioLLM without the critical-failure termination gate.

    Identical to Exp 1 except the 2-strike episode-termination rule is suppressed.
    Provides the simplest no-gate baseline: pure LLM + stress input, no MCTS, no
    gate.  Enables a complete cross-arm no-gate comparison tier (Exp 1a–7a) so
    every experiment has a matched ablation partner.
    """
    ARM = "physio_llm_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class PhysioLLMCoTMCTSNoCritGateWorker(PhysioLLMCoTMCTSWorker):
    """
    Exp 2a: PhysioLLM CoT-MCTS without the critical-failure gate.

    Identical to Exp 2 except the 2-strike rule does NOT end the episode early.
    Pairs with Exp 1a to complete the no-gate ablation tier for the two lightweight
    MCTS arms, enabling apples-to-apples gate contribution measurement at every
    capability level.
    """
    ARM = "physio_llm_cot_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class PhysioMPSMCTSNoCritGateWorker(PhysioMPSMCTSWorker):
    """
    Exp 3a: PhysioMPS-MCTS without the critical-failure termination gate.

    Identical to Exp 3 except the 2-strike episode-termination rule is suppressed.
    Enables a fair comparison against Exp 4a and Exp 6a in the no-gate ablation
    tier: all three arms see the same raw episode trajectories regardless of
    catastrophic turns.
    """
    ARM = "physio_mps_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class InertialPhysioLLMCoTMCTSNoCritGateWorker(InertialPhysioLLMCoTMCTSWorker):
    """
    Exp 5a: Inertial PhysioLLM CoT-MCTS without the critical-failure gate.

    Identical to Exp 5 except the 2-strike rule does NOT end the episode early.
    Pairs with Exp 3a, 4a, and 6a to provide a complete cross-arm no-gate baseline.
    """
    ARM = "inertial_physio_llm_cot_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class InertialHPVOOTPhysioLLMCoTMCTSNoCritGateWorker(InertialHPVOOTPhysioLLMCoTMCTSWorker):
    """
    Exp 7a: Inertial HPVOOT CoT-MCTS without the critical-failure gate.

    Identical to Exp 7 except the 2-strike rule does NOT end the episode early.
    Completes the full no-gate ablation tier across all MCTS-gated experiments
    (Exp 3a–7a), enabling clean apples-to-apples comparison.
    """
    ARM = "inertial_hpvoot_physio_llm_cot_mcts_no_crit_gate"
    DISABLE_CRITICAL_FAILURE_GATE = True


class OldschoolNoPrivacyWorker(OldschoolWorker):
    """
    Exp 0a: Oldschool JS companion without privacyGuard filtering.

    Identical to Exp 0 except the privacyGuard handler is omitted from
    CompanionCoordinator for every turn.  Measures the clinical privacy-engagement
    trade-off: does privacy filtering reduce rapport or hurt goal achievement?
    """
    ARM = "oldschool_no_privacy"

    def generate_response(self, state, action, scenario, conversation_correction=0.0):
        import time as _time
        t_start = _time.perf_counter()
        user_msg = _last_user_message(state)

        try:
            resp = _node_benchmark_message(
                message            = user_msg,
                circle_id          = scenario.get("circle_id", "benchmark_circle"),
                user_id            = state.subject_id,
                session_id         = state.session_id,
                arm                = self.ARM,
                timeout            = 90.0,
                skip_privacy_guard = True,
            )
            response_text = resp.get("response", resp.get("message", "")).strip()
            if not response_text:
                raise ValueError("Empty response from JS companion (no_privacy arm)")
        except Exception as exc:
            raise RuntimeError(f"Arm5a: JS companion call failed: {exc}") from exc

        latency_ms = (_time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        return {
            "response":    response_text,
            "reward":      reward,
            "judge":       {},
            "next_stress": next_stress,
            "latency_ms":  latency_ms,
            "llm_calls":   1,
        }


# ── DPO/RLAIF prompt-improved variants (Exp 0p–7p) ───────────────────────────
# These are the "prompt improvement" treatment group in the 32-experiment design.
# Each is a thin subclass of its baseline counterpart; the only difference is:
#   1. ARM suffix "_dpo" so runs land in separate DB rows and checkpoint dirs.
#   2. PROMPT_VARIANT = "dpo" tag written into every episode summary, enabling
#      the dashboard to group baseline vs. improved experiments side-by-side.
#   3. A richer context-aware default system prompt: in addition to stress/zone,
#      the prompt now carries factual patient state (medication adherence, session
#      number, flagged topics, longitudinal goal status) so Scout can reason from
#      patient facts rather than only from instantaneous stress scalars.
#   4. Weight sharing: each DPO arm starts from Actor.cold_start() (same as its
#      baseline counterpart), giving a clean controlled comparison.  The prompt
#      difference is the sole independent variable.
#
# Prompt design rationale (context richness)
# ------------------------------------------
# The baseline prompts give Scout two signals: current action + stress index.
# The improved prompts add five additional fact categories:
#   F1  session_number / days_since_last  — longitudinal position
#   F2  medication_adherence              — adherence state from physio/summary
#   F3  flagged_topics                    — topics the patient has avoided/raised
#   F4  goal_status                       — progress toward the session goal
#   F5  last_patient_sentiment            — brief affect label from recent turns
# These are facts that a human clinician uses implicitly; providing them in the
# prompt tests whether LLM-in-the-loop companions benefit from explicit context.
#
# All five facts are drawn from fields already present in PatientState /
# session_memory / conversation_history — no new data collection is required.
# Missing fields gracefully degrade to "(unknown)" so the prompt always renders.

_DPO_SYSTEM_PROMPT = (
    "You are a clinical companion assistant.\n"
    "Recommended action: {action}.\n"
    "Patient stress: {stress_index:.2f} (zone: {stress_bucket}).\n"
    "{hysteresis_ctx}"
    "Session #{session_number} · {days_since_last} days since last session · "
    "Goal: {session_goal}.\n"
    "Goal status: {goal_status}. Medication adherence: {med_adherence}.\n"
    "Flagged topics: {flagged_topics}.\n"
    "Patient recent sentiment: {last_sentiment}.\n"
    "Respond in 2-3 sentences. Be empathetic and specific to the patient's current state."
)

_DPO_PRIOR_SYSTEM = (
    "You are a clinical scoring assistant. "
    "Score each action 0.0 (wrong for this moment) to 1.0 (ideal). "
    "Consider: patient facts, session context, prior topics, and current stress zone. "
    "Return ONLY a JSON object mapping action name to float. No markdown."
)


def _build_dpo_prompt_vars(state) -> dict:
    """
    Extract the rich context variables required by _DPO_SYSTEM_PROMPT from state.

    All fields degrade gracefully to a readable fallback when the data is absent
    so the prompt never contains raw Python None values.
    """
    mem: dict = getattr(state, "session_memory", None) or {}
    tl:  dict = mem.get("simulated_timeline") or {}
    physio: dict = getattr(state, "physio", None) or {}

    session_number   = int(tl.get("session_number", 1))
    days_since_last  = tl.get("days_since_last")
    days_str         = f"{days_since_last:.0f}" if days_since_last is not None else "first"

    session_goal     = (state.session_goal or "general support")[:80]

    # Goal status: use goal_progress from last turn summary if available
    gp = float(physio.get("goal_progress", 0.0))
    if gp >= 0.7:
        goal_status = "on track"
    elif gp >= 0.35:
        goal_status = "partial progress"
    else:
        goal_status = "not yet started"

    # Medication adherence: stored in physio channel or session_memory
    adh = physio.get("med_adherence") or mem.get("med_adherence")
    if adh is None:
        med_adherence = "unknown"
    elif isinstance(adh, float):
        med_adherence = f"{adh:.0%}"
    else:
        med_adherence = str(adh)[:30]

    # Flagged topics: list of topic strings stored by the worker
    flagged = mem.get("flagged_topics") or []
    flagged_topics = ", ".join(str(t) for t in flagged[:4]) or "none flagged"

    # Last patient sentiment: derive from the most recent user turn text
    recent_user_msgs = [
        m for m in state.conversation_history[-6:]
        if m.get("role") == "user"
    ]
    last_msg = (recent_user_msgs[-1].get("content", "") if recent_user_msgs else "")[:120]
    # Simple heuristic sentiment label — enough for prompt context
    neg_words = {"pain", "hurt", "tired", "scared", "worried", "worse", "bad", "afraid",
                 "anxious", "can't", "cannot", "difficult", "struggling", "hard"}
    pos_words = {"better", "good", "happy", "okay", "fine", "great", "improving",
                 "hopeful", "confident", "easier", "progress"}
    lower = last_msg.lower()
    neg_hits = sum(1 for w in neg_words if w in lower)
    pos_hits = sum(1 for w in pos_words if w in lower)
    if neg_hits > pos_hits:
        last_sentiment = "distressed / negative"
    elif pos_hits > neg_hits:
        last_sentiment = "positive / hopeful"
    else:
        last_sentiment = "neutral"

    return {
        "session_number":  session_number,
        "days_since_last": days_str,
        "session_goal":    session_goal,
        "goal_status":     goal_status,
        "med_adherence":   med_adherence,
        "flagged_topics":  flagged_topics,
        "last_sentiment":  last_sentiment,
    }


class PhysioLLMDPOWorker(PhysioLLMWorker):
    """
    Exp 1p: PhysioLLM with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 1 except the system prompt carries five additional patient
    fact categories (F1–F5) beyond stress index.  Isolates the contribution of
    prompt richness over the baseline Exp 1 two-signal prompt.
    """
    ARM            = "physio_llm_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT

    def _build_system_prompt(self, state, action, **kw) -> str:
        base = super()._build_system_prompt(state, action, **kw)
        # Patch in the DPO context vars if the base class used _DEFAULT_SYSTEM_PROMPT
        try:
            extra = _build_dpo_prompt_vars(state)
            return self._DEFAULT_SYSTEM_PROMPT.format(
                action           = action,
                stress_index     = state.stress_index,
                stress_bucket    = state.stress_bucket or "unknown",
                hysteresis_ctx   = kw.get("hysteresis_ctx", ""),
                session_number   = extra["session_number"],
                days_since_last  = extra["days_since_last"],
                session_goal     = extra["session_goal"],
                goal_status      = extra["goal_status"],
                med_adherence    = extra["med_adherence"],
                flagged_topics   = extra["flagged_topics"],
                last_sentiment   = extra["last_sentiment"],
            )
        except Exception:
            return base


class PhysioLLMCoTMCTSDPOWorker(PhysioLLMCoTMCTSWorker):
    """
    Exp 2p: PhysioLLM CoT-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 2 except Scout's generation prompt and Maverick's CoT prompt
    carry the five additional patient fact categories.
    """
    ARM            = "physio_llm_cot_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT


class PhysioMPSMCTSDPOWorker(PhysioMPSMCTSWorker):
    """
    Exp 3p: PhysioMPS-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 3 except the system prompt passed to Scout carries the five
    additional patient fact categories.  MCTS tree search is unchanged.
    """
    ARM            = "physio_mps_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT


class InertialPhysioMPSMCTSDPOWorker(InertialPhysioMPSMCTSWorker):
    """
    Exp 4p: Inertial PhysioMPS-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 4 except the system prompt carries the five additional patient
    fact categories.  HysteresisGate and MCTS are unchanged.
    """
    ARM            = "inertial_physio_mps_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT


class InertialPhysioLLMCoTMCTSDPOWorker(InertialPhysioLLMCoTMCTSWorker):
    """
    Exp 5p: Inertial PhysioLLM CoT-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 5 except the system prompt carries the five additional patient
    fact categories.  HysteresisGate and CoT-MCTS are unchanged.
    """
    ARM            = "inertial_physio_llm_cot_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT


class InertialHPVOOTPhysioMPSMCTSDPOWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 6p: Inertial HPVOOT MPS-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 6 except both the Scout prior prompt and the generation
    prompt carry the five additional patient fact categories.

    The _PRIOR_SYSTEM is also upgraded to the richer _DPO_PRIOR_SYSTEM so the
    Scout prior scores are based on full patient context, not just stress/zone.
    """
    ARM            = "inertial_hpvoot_physio_mps_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT
    _PRIOR_SYSTEM          = _DPO_PRIOR_SYSTEM

    def _fetch_prior_scores(self, state, zone_name, zone_streak, mode, actions):
        """
        DPO variant: injects all five patient fact categories into the prior
        scoring prompt, on top of the L2 fix (last 2 turns + session goal).

        This tests whether richer prior scoring improves HPVOOT action ranking
        compared to the baseline Exp 6 prior prompt.
        """
        import json as _json, re as _re

        recent_turns = [
            m for m in state.conversation_history[-6:]
            if m.get("role") == "user"
        ][-2:]
        excerpt = "\n".join(
            f"Patient: {m['content'][:200]}" for m in recent_turns
        ) or "(no turns yet)"

        extra = _build_dpo_prompt_vars(state)
        action_list = "\n".join(f"  - {a}" for a in actions)
        prompt = (
            f"Patient state: stress={state.stress_index:.2f}, "
            f"zone={zone_name} (streak={zone_streak}), mode={mode}.\n\n"
            f"Session #{extra['session_number']} · {extra['days_since_last']} days since last · "
            f"Goal: {extra['session_goal']}.\n"
            f"Goal status: {extra['goal_status']}. "
            f"Med adherence: {extra['med_adherence']}.\n"
            f"Flagged topics: {extra['flagged_topics']}.\n"
            f"Patient recent sentiment: {extra['last_sentiment']}.\n\n"
            f"Recent conversation:\n{excerpt}\n\n"
            f"Rate each action 0.0 (wrong for this exact moment) to 1.0 (ideal).\n"
            f"Actions:\n{action_list}"
        )
        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {"system": self._PRIOR_SYSTEM, "prompt": prompt,
             "max_tokens": 800, "arm": self.ARM},
            timeout=25.0,
        )
        text = (resp.get("text") or "").strip()
        if not text:
            raise RuntimeError(
                "InertialHPVOOTPhysioMPSMCTSDPOWorker._fetch_prior_scores: "
                "Scout returned empty response."
            )

        score_map = {}
        m = _re.search(r'\{([^{}]*)\}', text, _re.DOTALL)
        if m:
            try:
                score_map = _json.loads('{' + m.group(1) + '}')
            except _json.JSONDecodeError:
                pass
        if not score_map:
            for line in text.splitlines():
                kv = _re.match(
                    r'["\s]*([a-zA-Z_][a-zA-Z0-9_\s]*?)["\s]*:\s*([\d.]+)',
                    line.strip(),
                )
                if kv:
                    score_map[kv.group(1).strip()] = float(kv.group(2))

        self._prior_tokens = {
            "in":  resp.get("usage", {}).get("input_tokens",  0),
            "out": resp.get("usage", {}).get("output_tokens", 0),
        }
        return [float(score_map.get(a, 0.5)) for a in actions]


class InertialHPVOOTPhysioLLMCoTMCTSDPOWorker(InertialHPVOOTPhysioLLMCoTMCTSWorker):
    """
    Exp 7p: Inertial HPVOOT CoT-MCTS with DPO/RLAIF-improved context-rich prompt.

    Identical to Exp 7 except the system prompt and the Maverick CoT prompt carry
    the five additional patient fact categories.
    """
    ARM            = "inertial_hpvoot_physio_llm_cot_mcts_dpo"
    PROMPT_VARIANT = "dpo"
    _DEFAULT_SYSTEM_PROMPT = _DPO_SYSTEM_PROMPT


# ── Exp 0p: OldschoolDPOWorker ────────────────────────────────────────────────

class OldschoolDPOWorker(OldschoolWorker):
    """
    Exp 0p: Oldschool JS companion with DPO/RLAIF-improved context injection.

    The baseline Exp 0 sends the raw user message to CompanionCoordinator and
    relies entirely on the Node.js companion's built-in prompting.  Exp 0p adds a
    ``context_hint`` field to the JSON payload so the JS analysis pipeline can
    optionally incorporate the five DPO fact categories into its prompt.

    Why oldschool CAN have a DPO variant
    ─────────────────────────────────────
    The claim "Exp 0 has no Python prompt" means there is no *Python-managed*
    system prompt — the companion logic lives in JS.  However the JS pipeline
    already accepts an optional ``analysis.extra_context`` field from the message
    payload (see aiAnalysisHandler.js → extraContext).  Exp 0p populates that
    field with the five DPO fact categories so the Node.js companion can use them
    in its own prompting.  The Python side has no prompt to tune; the improvement
    is entirely in what context we hand off to JS.

    This means:
      • Exp 0  ↔  Exp 0p  isolates the value of context injection into the
        production JS companion with zero changes to the JS code.
      • The comparison is the JS-side analogue of Exp 1 vs Exp 1p.

    Will the existing JS analysis/feedback framework help?
    ──────────────────────────────────────────────────────
    Yes:
      • aiAnalysisHandler.js reads ``extra_context`` and appends it to the
        prompt fed to the JS LLM, so no JS changes are required.
      • The scoring/reward path is identical to Exp 0 (deferred JS scores).
      • The RL framework (A3C policy update) does not apply to oldschool arms;
        the "DPO improvement" here is purely context richness, not a trained policy.
    """

    ARM            = "oldschool_dpo"
    PROMPT_VARIANT = "dpo"
    RELATIVE_SPEED = 0.5   # same as Exp 0; JS round-trip dominates latency

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        import time as _time
        t_start  = _time.perf_counter()
        user_msg = _last_user_message(state)

        # Build the five DPO fact categories for context injection
        try:
            extra = _build_dpo_prompt_vars(state)
            context_hint = (
                f"Session #{extra['session_number']} "
                f"({extra['days_since_last']} days since last). "
                f"Goal: {extra['session_goal']} — {extra['goal_status']}. "
                f"Med adherence: {extra['med_adherence']}. "
                f"Flagged topics: {extra['flagged_topics']}. "
                f"Patient sentiment: {extra['last_sentiment']}."
            )
        except Exception:
            context_hint = None

        try:
            resp = _node_benchmark_message(
                message       = user_msg,
                circle_id     = scenario.get("circle_id", "benchmark_circle"),
                user_id       = state.subject_id,
                session_id    = state.session_id,
                arm           = self.ARM,
                timeout       = 90.0,
                context_hint  = context_hint,
            )
            response_text = resp.get("response", resp.get("message", "")).strip()
            if not response_text:
                raise ValueError("Empty response from JS companion (oldschool_dpo arm)")
        except Exception as exc:
            raise RuntimeError(f"OldschoolDPOWorker: JS companion call failed: {exc}") from exc

        latency_ms = (_time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        return {
            "response":    response_text,
            "reward":      reward,
            "judge":       {},
            "next_stress": next_stress,
            "latency_ms":  latency_ms,
            "llm_calls":   1,
        }


# ── Experiments 8–10: RAG ablation set ───────────────────────────────────────
# Three new arms that isolate the contribution of retrieval-augmented generation
# to therapeutic outcome quality.
#
#   Exp 8  PlainRAGWorker          — standard text-similarity RAG (no physio weighting)
#   Exp 9  TensorRAGWorker         — physio-conditioned RAG (TensorRAG with MPS encoding)
#   Exp 10 TensorRAGMPSMCTSWorker  — TensorRAG + MPS-MCTS action selection (full stack)
#
# All three arms use the same PhysioLLMWorker generation path (Scout LLM, same
# system prompt), so the ONLY independent variable is how retrieval context is
# constructed and injected.
#
# RAG context is fetched from the tensornets FastAPI server /rag/query endpoint
# and injected as an EXTRA_CONTEXT block before the Scout generation call.
# ─────────────────────────────────────────────────────────────────────────────

def _query_rag_context(
    state: "TurnState",
    arm: str,
    use_physio: bool,
    k: int = 5,
) -> str:
    """
    Call the local tensornets /rag/query endpoint and return a formatted
    context string for injection into the generation prompt.

    Parameters
    ----------
    state      Current TurnState (provides physio + conversation text).
    arm        A3C arm string — used to restrict episode_memory retrieval
               to episodes from the same experiment, preventing cross-arm
               contamination.
    use_physio If True, the query carries the full physio vector so TensorRAG
               can re-rank by physiological state similarity.
               If False, only text similarity is used (PlainRAG behaviour).
    k          Number of retrieved chunks to include.

    Returns
    -------
    Formatted context block string, or "" on failure.
    """
    try:
        user_msg  = _last_user_message(state)
        physio    = getattr(state, "physio", {}) or {}
        query_body: dict = {
            "text":              user_msg[:512],
            "k":                 k,
            "format":            "context_string",
            "sources":           ["clinical_kb", "episode_memory"],
            "arm_filter":        arm,
        }
        if use_physio:
            query_body["hrv_rmssd_ms"]      = physio.get("hrv_ms", 35.0)
            query_body["stress_index"]      = state.stress_index
            query_body["sleep_quality"]     = max(0.0, 1.0 - physio.get("sleep_deficit", 1.0) / 8.0)
            query_body["therapeutic_stage"] = getattr(state, "info_coverage", 0.0)
        result = _http_post(f"{_TENSORNETS_URL}/rag/query", query_body, timeout=8.0)
        return result.get("context_string", "") or ""
    except Exception:
        return ""


def _reason_rag_context(
    state: "TurnState",
    arm: str,
    k: int = 8,
    keep: int = 3,
) -> str:
    """
    Reasoning-based RAG: retrieve k candidates via text similarity, then use
    Scout to judge which are actually relevant to the current situation and WHY.

    This addresses the longitudinal data problem: cosine similarity alone ranks
    temporally adjacent episodes highly even when they are clinically irrelevant
    (same patient, different topic).  A lightweight LLM reasoning pass re-ranks
    by genuine clinical utility.

    Parameters
    ----------
    state   Current TurnState.
    arm     A3C arm string for episode_memory filtering.
    k       Number of candidates to retrieve before reasoning pass.
    keep    Number of chunks to retain after reasoning re-ranking.

    Returns
    -------
    Formatted context block string of the `keep` most relevant chunks, or "" on failure.

    Design note
    -----------
    The reasoning prompt is deliberately minimal (~150 tokens) to stay within
    the single Scout call budget.  It does NOT ask for explanations — just a
    ranked list of indices.  The physio vector is NOT used for the initial
    retrieval (avoiding the cosine-similarity-on-wrong-physio-state problem).
    Instead, the reasoning pass considers the current therapeutic situation,
    the patient's stated concern, and the session goal.
    """
    try:
        user_msg = _last_user_message(state)

        # Step 1: retrieve k candidates by text similarity only
        query_body = {
            "text":    user_msg[:512],
            "k":       k,
            "format":  "chunks",
            "sources": ["clinical_kb", "episode_memory"],
            "arm_filter": arm,
        }
        raw = _http_post(f"{_TENSORNETS_URL}/rag/query", query_body, timeout=8.0)
        chunks = raw.get("results", [])
        if not chunks:
            return ""

        # Step 2: build a reasoning prompt asking Scout to pick the most relevant
        chunk_list = "\n".join(
            f"[{i}] {c.get('text', '')[:200]}"
            for i, c in enumerate(chunks)
        )
        scenario_ctx = (
            f"Session goal: {getattr(state, 'session_goal', 'unclear')}. "
            f"Patient concern this turn: {user_msg[:150]}. "
            f"Therapeutic mode: {getattr(state, 'therapeutic_mode', 'standard')}. "
            f"Stress: {state.stress_index:.2f}."
        )
        reason_prompt = (
            f"You are selecting the most clinically relevant retrieved passages.\n"
            f"Context: {scenario_ctx}\n\n"
            f"Candidates:\n{chunk_list}\n\n"
            f"Return ONLY a JSON array of the {keep} most useful indices, e.g. [2,0,5]. "
            f"Prefer clinical knowledge over episode memory unless the episode directly "
            f"addresses the patient's current concern. Do not include temporally adjacent "
            f"episodes that share a patient ID but a different topic."
        )

        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {"prompt": reason_prompt, "max_tokens": 40, "arm": arm},
            timeout=15.0,
        )
        import json as _json
        text = resp.get("text", "").strip()
        # Parse the index array, robustly
        import re as _re
        arr_match = _re.search(r"\[[\d,\s]+\]", text)
        if arr_match:
            indices = _json.loads(arr_match.group())
            selected = [chunks[i] for i in indices if i < len(chunks)][:keep]
        else:
            selected = chunks[:keep]   # fallback: take top-k by original text score

        # Step 3: format selected chunks as a context string
        if not selected:
            return ""
        lines = ["[Relevant context (reasoning-filtered)]"]
        for c in selected:
            src  = c.get("source", "unknown")
            text = c.get("text", "").strip()
            lines.append(f"[{src}] {text[:300]}")
        return "\n".join(lines)

    except Exception:
        return ""


class PlainRAGWorker(PhysioLLMWorker):
    """
    Exp 8: PhysioLLM with standard text-similarity RAG (no physio weighting).

    Adds a RAG context block from the clinical knowledge base and episode
    memory, retrieved by cosine similarity on sentence embeddings alone.
    This is the 'PlainRAG' baseline for the TensorRAG ablation.

    Independent variable vs Exp 1 (PhysioLLM):  RAG context injection.
    Independent variable vs Exp 9 (TensorRAG):   physio weighting OFF.
    """

    ARM            = "plain_rag"
    RELATIVE_SPEED = 0.65   # one extra /rag/query call adds ~30-50 ms

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        import time as _time
        t_start = _time.perf_counter()

        rag_ctx = _query_rag_context(state, arm=self.ARM, use_physio=False, k=5)

        # Reuse PhysioLLMWorker's prompt by temporarily extending the system prompt template.
        # We append the RAG context block to the hysteresis context before handing off.
        user_msg = _last_user_message(state)

        hysteresis_ctx = _build_hysteresis_context(state, scenario)
        if rag_ctx:
            hysteresis_ctx = hysteresis_ctx + "\n[Retrieved context]\n" + rag_ctx

        system_prompt = _safe_fmt(
            self._system_prompt,
            hysteresis_ctx=hysteresis_ctx,
            action=action,
            stress_index=state.stress_index,
            stress_bucket=state.stress_bucket,
        )
        history_text = "\n".join(
            f"{t['role'].upper()}: {t['content']}"
            for t in state.conversation_history[-6:]
        )
        prompt = f"{history_text}\nUSER: {user_msg}\nASSISTANT:"

        llm_calls = 1
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 300, "arm": self.ARM},
                timeout=60.0,
            )
            response_text = resp.get("text", "").strip()
            if not response_text:
                raise ValueError("Empty Scout response (Exp 8 PlainRAG)")
        except Exception as exc:
            raise RuntimeError(f"Exp8: Scout generation failed: {exc}") from exc

        latency_ms = (_time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        return {
            "response":          response_text,
            "reward":            reward,
            "judge":             {},
            "tokens":            {},
            "latency_ms":        round(latency_ms, 1),
            "next_stress_index": next_stress,
            "next_physio":       {**state.physio, "stress_index": next_stress} if state.physio else {},
            "action_taken":      action,
            "frames_component":  None,
            "info_coverage":     reward["info_coverage"],
            "repetition_detected": False,
            "discrepancy":       None,
            "llm_calls":         llm_calls,
        }


class ReasonRAGWorker(PhysioLLMWorker):
    """
    Exp 9: Reasoning-based RAG (replaces naive physio-cosine TensorRAG).

    PROBLEM with cosine-similarity RAG on longitudinal clinical data
    ----------------------------------------------------------------
    Cosine similarity alone is a poor relevance signal for longitudinal episode
    memory.  Adjacent episodes from the same patient share patient ID, therapeutic
    mode, and clinical vocabulary — they get high cosine similarity regardless of
    whether they address the CURRENT concern.  A session about medication adherence
    from last week will outscore a highly relevant clinical guideline about panic
    simply because it shares more tokens with the current session.

    SOLUTION: reasoning-based re-ranking
    -------------------------------------
    1. Retrieve k=8 candidates by text similarity (cheap embedding pass — no physio).
    2. Send the candidates + current session context to Scout in a single short
       prompt (~150 tokens).  Ask it to pick the 3 most clinically useful chunks,
       explicitly penalising temporally adjacent but topically irrelevant episodes.
    3. Inject the 3 selected chunks into the generation prompt.

    The MPS/tensor component is intentionally NOT used for retrieval ranking here.
    Physio state is encoded in the generation prompt (via hysteresis context) —
    the retrieval stage should be driven by clinical content, not physiological
    proximity.  This is the correct separation of concerns.

    Independent variable vs Exp 1 (PhysioLLM):   reasoning-filtered RAG context.
    Independent variable vs Exp 8 (PlainRAG):     reasoning re-ranking vs plain top-k.
    Independent variable vs Exp 10 (ReasonRAG+MPS-MCTS): no MCTS action selection.

    LLM calls per turn: 2 (reasoning pass + generation).
    """

    ARM            = "reason_rag"
    RELATIVE_SPEED = 0.55   # two Scout calls; reasoning pass is short (~40 tokens out)

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        import time as _time
        t_start = _time.perf_counter()

        rag_ctx = _reason_rag_context(state, arm=self.ARM, k=8, keep=3)

        user_msg = _last_user_message(state)
        hysteresis_ctx = _build_hysteresis_context(state, scenario)
        if rag_ctx:
            hysteresis_ctx = hysteresis_ctx + "\n" + rag_ctx

        system_prompt = _safe_fmt(
            self._system_prompt,
            hysteresis_ctx=hysteresis_ctx,
            action=action,
            stress_index=state.stress_index,
            stress_bucket=state.stress_bucket,
        )
        history_text = "\n".join(
            f"{t['role'].upper()}: {t['content']}"
            for t in state.conversation_history[-6:]
        )
        prompt = f"{history_text}\nUSER: {user_msg}\nASSISTANT:"

        llm_calls = 2   # reasoning pass + generation
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 300, "arm": self.ARM},
                timeout=60.0,
            )
            response_text = resp.get("text", "").strip()
            if not response_text:
                raise ValueError("Empty Scout response (Exp 9 ReasonRAG)")
        except Exception as exc:
            raise RuntimeError(f"Exp9: Scout generation failed: {exc}") from exc

        latency_ms = (_time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(
            state.stress_index, action, state.archetype, state.drug_regimen,
            conversation_correction=conversation_correction,
        )
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        return {
            "response":          response_text,
            "reward":            reward,
            "judge":             {},
            "tokens":            {},
            "latency_ms":        round(latency_ms, 1),
            "next_stress_index": next_stress,
            "next_physio":       {**state.physio, "stress_index": next_stress} if state.physio else {},
            "action_taken":      action,
            "frames_component":  None,
            "info_coverage":     reward["info_coverage"],
            "repetition_detected": False,
            "discrepancy":       None,
            "llm_calls":         llm_calls,
        }


class ReasonRAGMPSMCTSWorker(PhysioMPSMCTSWorker):
    """
    Exp 10: ReasonRAG + MPS-MCTS — reasoning-filtered retrieval with physio-grounded planning.

    Stacks:
      1. Reasoning-based RAG (8 candidates → Scout re-ranks to 3 most relevant)
      2. MPS-MCTS action selection (physio-state tensor-network planning)
      3. Scout generation with the reasoning-filtered context in the prompt

    Independent variable vs Exp 3 (MPS-MCTS):      adds reasoning RAG.
    Independent variable vs Exp 9 (ReasonRAG):      adds MPS-MCTS planning.
    Independent variable vs Exp 11 (ReasonRAG+HPVOOT): no hysteresis gate, no HPVOOT widening.

    If Exp 10 outperforms both Exp 3 and Exp 9, reasoning RAG and physio planning
    are synergistic.  Exp 11 tests whether HPVOOT adds further value on top.

    LLM calls per turn: 2 (reasoning pass + generation); MCTS is local Python.
    """

    ARM            = "reason_rag_mps_mcts"
    RELATIVE_SPEED = 0.40   # MCTS + reasoning RAG; both add latency

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        rag_ctx = _reason_rag_context(state, arm=self.ARM, k=8, keep=3)

        original_prompt = self._system_prompt
        if rag_ctx:
            self._system_prompt = original_prompt.rstrip() + "\n" + rag_ctx
        try:
            return super().generate_response(
                state, action, scenario,
                conversation_correction=conversation_correction,
            )
        finally:
            self._system_prompt = original_prompt


class ReasonRAGInertialHPVOOTWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 11: ReasonRAG + Inertial HPVOOT-MPS-MCTS — the full longitudinal reasoning stack.

    Stacks all four components:
      1. Reasoning-based RAG (re-ranked retrieval; no cosine-on-physio confusion)
      2. HysteresisGate (zone-locked stress dead-band; prevents strategy flip-flopping)
      3. HPVOOT progressive widening (explores novel MCTS branches when known actions fail)
      4. MPS-MCTS action selection

    This arm tests whether reasoning-quality retrieval and inertial physio planning
    are jointly necessary for optimal multi-session performance.

    Independent variable vs Exp 6 (Inertial HPVOOT MPS):  adds reasoning RAG.
    Independent variable vs Exp 10 (ReasonRAG + MPS):     adds hysteresis + HPVOOT.

    LLM calls per turn: 2 (reasoning pass + generation); MCTS + HPVOOT local Python.
    """

    ARM            = "reason_rag_inertial_hpvoot"
    RELATIVE_SPEED = 0.30   # slowest: HPVOOT + reasoning RAG + MPS-MCTS

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        rag_ctx = _reason_rag_context(state, arm=self.ARM, k=8, keep=3)

        original_prompt = self._system_prompt
        if rag_ctx:
            self._system_prompt = original_prompt.rstrip() + "\n" + rag_ctx
        try:
            return super().generate_response(
                state, action, scenario,
                conversation_correction=conversation_correction,
            )
        finally:
            self._system_prompt = original_prompt


# ── Exp 16: InertialHPVOOTZoneWorker ─────────────────────────────────────────
# Ablation vs Exp 6: same HPVOOT+MPS pipeline but uses the discrete
# hysteresis-zone cluster-affinity (HierarchicalPWZoneMCTS, mcts_mode="hpvoot_zone")
# instead of the continuous Gaussian-bump affinity (Exp 6, mcts_mode="hpvoot").
# A statistically significant goal-rate difference confirms the continuous
# affinity function adds measurable value.

class InertialHPVOOTZoneWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 16: HPVOOT with discrete hysteresis-zone cluster affinity.

    Identical to Exp 6 except the MCTS tree uses ``HierarchicalPWZoneMCTS``
    (discrete zone → cluster mapping) instead of the continuous
    ``_continuous_cluster_affinity`` function introduced in Exp 6.
    """
    ARM            = "inertial_hpvoot_zone"
    RELATIVE_SPEED = 0.40   # same budget as Exp 6 — fair comparison

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        # Patch mcts_mode on the instance so the parent's HTTP payload builder
        # picks up "hpvoot_zone" instead of "hpvoot".  We use a temporary
        # instance attribute and restore it in the finally block so that
        # concurrent workers sharing the class are unaffected.
        _saved = self.__dict__.get("_mcts_mode_override")
        self._mcts_mode_override = "hpvoot_zone"
        try:
            return super().generate_response(state, action, scenario, conversation_correction)
        finally:
            if _saved is None:
                self.__dict__.pop("_mcts_mode_override", None)
            else:
                self._mcts_mode_override = _saved


# ─────────────────────────────────────────────────────────────────────────────
# NEW NAMING CONVENTION (Exp 15+)
# Dropping the verbose "InertialHPVOOTPhysio*" prefix in favour of semantic names:
#   MultiHorizonHPVOOT  → MCTS9: multi-horizon + anticipatory anxiety routing
#   ZoneHPVOOT          → alias for InertialHPVOOTZoneWorker (discrete affinity)
#   ReasonHPVOOT        → ReasonRAG + HPVOOT (already Exp 11)
# ─────────────────────────────────────────────────────────────────────────────

# ── Exp 15: MultiHorizonHPVOOTWorker ─────────────────────────────────────────

class MultiHorizonHPVOOTWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 15 — MCTS9: Multi-horizon discounting + anticipatory anxiety routing.

    Extends Exp 6 (InertialHPVOOT) with two complementary additions:

    1. **Multi-horizon discount** (``MultiHorizonHPVOOTMCTS``):
       The MCTS tree values MICRO, SESSION, and LONGITUDINAL actions with
       different effective gammas (0.95 / 0.70 / 0.40).  Stops the tree from
       always preferring immediate breathing/validate over a session-arc reframe.

    2. **Anticipatory anxiety routing** (``_anticipatory_anxiety_bonus``):
       When the scenario includes a ``pending_event`` dict (exam, diagnosis,
       job decision, delayed procedure), MCTS boosts time_bracketing,
       uncertainty_tolerance, probability_reframe, and graded_imagery and
       penalises them when their stress-level preconditions are violated.

    **Naming convention**: this is the first arm to use the semantic naming
    scheme going forward (``MultiHorizonHPVOOTWorker`` rather than
    ``InertialHPVOOTPhysioMPSMCTS*``).
    """
    ARM            = "multi_horizon_hpvoot"
    RELATIVE_SPEED = 0.40   # same budget as Exp 6

    def generate_response(  # type: ignore[override]
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        # Route to MultiHorizonHPVOOTMCTS instead of HierarchicalPWVOOTMCTS.
        # Same mechanism as InertialHPVOOTZoneWorker: patch the instance-level
        # override that the parent's payload builder reads via getattr.
        _saved = self.__dict__.get("_mcts_mode_override")
        self._mcts_mode_override = "multi_horizon"
        try:
            return super().generate_response(state, action, scenario, conversation_correction)
        finally:
            if _saved is None:
                self.__dict__.pop("_mcts_mode_override", None)
            else:
                self._mcts_mode_override = _saved


# ─────────────────────────────────────────────────────────────────────────────
# Exp 17: GoTHPVOOTWorker — Graph-of-Thought MCTS prior
# ─────────────────────────────────────────────────────────────────────────────
#
# Problem with current CoT prior (Exp 6/7):
#   The _fetch_prior_scores prompt asks Scout to "rate each action 0-1" in a
#   single flat query.  Scout sees all context at once and tends to produce
#   near-uniform scores unless the situation is extreme.  The linear chain of
#   thought ("physio -> stress -> action") compresses too much into one step.
#
# Graph-of-Thought approach:
#   The reasoning is structured as a directed 5-node graph executed in ONE
#   LLM call.  Each node produces an intermediate conclusion that feeds into
#   subsequent nodes — like a dependency graph, not a chain:
#
#   Node A (physio)     -> stress severity, HRV trend, EDA alert
#   Node B (language)   -> emotional valence, disclosure level, topic
#   Node C (temporal)   -> session gap, pending event, boundary
#   Node D (synthesis)  -> cluster recommendation using A+B+C
#   Node E (scoring)    -> per-action score using D + original action list
#
#   Forcing intermediate nodes prevents Scout from shortcutting to scores
#   without reasoning, and makes the reasoning trace auditable.
#
# Batch leaf evaluation:
#   After the GoT prior call, the MCTS runs 150 iterations with these richer
#   priors.  For the top-5 actions after tree search, a second "batch leaf"
#   Scout call re-scores them with the full GoT context, giving the final
#   ranking a quality boost without 150 individual leaf calls.
#   Net cost: 2 Scout calls (GoT prior + batch leaf) vs 1 Scout call (Exp 6).

_GOT_PRIOR_SYSTEM = (
    "You are a clinical reasoning assistant for a therapeutic companion. "
    "Follow the EXACT structured graph format below. "
    "Return ONLY valid JSON — no markdown, no prose outside the JSON object."
)

_GOT_PROMPT_TEMPLATE = """\
Reason step-by-step through the following 5 nodes. Each node's output feeds into later nodes.
Do NOT skip nodes. Do NOT collapse nodes. Each node must produce a distinct intermediate conclusion.

=== NODE A: Physiological Assessment ===
Stress index: {stress_index:.2f}  HRV: {hrv_ms}ms  EDA: {eda_us}uS  Zone: {zone}
Session gap: {session_gap_days}d  Physio available: {physio_available}
Conclude: stress severity [low/moderate/high/critical], HRV trend [stable/declining/recovering],
  EDA urgency [low/elevated/alert], overall physiological recommendation [1 sentence]

=== NODE B: Conversational & Relational Assessment ===
Recent patient messages (last 2 turns):
{excerpt}
Conversation stress estimate: {conversation_stress:.2f}  Stress discrepancy: {stress_discrepancy:+.2f}
Session goal: {session_goal}  Alliance score: {alliance_score:.2f}
Conclude: patient emotional state [open/guarded/distressed/resistant/catastrophising],
  disclosure level [none/surface/moderate/deep], relational climate [warm/neutral/ruptured],
  conversational recommendation [1 sentence]

=== NODE C: Temporal & Contextual Assessment ===
Session boundary: {session_boundary}  Pending event: {pending_event}
Therapeutic mode: {mode}  Turn: {turn}
Conclude: temporal urgency [none/low/high], anticipatory anxiety factor [none/mild/strong],
  session phase [opening/working/closing], temporal recommendation [1 sentence]

=== NODE D: Cluster Synthesis ===
Using conclusions from nodes A, B, C:
Preferred action cluster [choose ONE]: explore / challenge / de_escalate / structure / inform / meta / panic / emergency
Reasoning: [2 sentences combining physiological + conversational + temporal findings]

=== NODE E: Action Scoring ===
Rate each action 0.0 (counterproductive) to 1.0 (ideal) based on Node D cluster and patient state.
Actions to score:
{action_list}

Return this EXACT JSON (no other text):
{{"node_a":{{"severity":"...","hrv_trend":"...","eda_urgency":"...","physio_rec":"..."}},"node_b":{{"emotional_state":"...","disclosure":"...","climate":"...","conv_rec":"..."}},"node_c":{{"temporal_urgency":"...","anticipatory":"...","session_phase":"...","temporal_rec":"..."}},"node_d":{{"cluster":"...","reasoning":"..."}},"node_e":{{"action_name":score_float}}}}"""

_GOT_BATCH_LEAF_SYSTEM = (
    "You are evaluating the top candidate actions from a Monte Carlo tree search. "
    "Return ONLY valid JSON — no markdown, no prose."
)

_GOT_BATCH_LEAF_TEMPLATE = """\
After a 150-iteration MCTS with Graph-of-Thought priors, the top actions are:
{top_actions}

Patient context summary:
- Physio: stress={stress:.2f}, HRV={hrv}ms, zone={zone}
- Emotional state: {emotional_state}
- Cluster recommended by GoT: {cluster}
- Session phase: {session_phase}

Re-score each action (0.0-1.0) incorporating MCTS tree values and GoT reasoning.
Return ONLY: {{"rankings": [["action_name", score_float], ...]}} sorted best-first."""


def _got_prior_call(
    state: "TurnState",
    actions: list,
    arm: str = "",
) -> "tuple[list[float], dict]":
    """
    Graph-of-Thought prior call: structured 5-node reasoning -> per-action scores.

    Returns (scores_list, got_trace) where:
      - scores_list: float per action in same order as ``actions``
      - got_trace: the parsed GoT JSON for logging and batch-leaf reuse

    Falls back to CALMING_WEIGHT heuristic on any failure (non-fatal).
    """
    import json as _json, re as _re
    from tensornets.a3c.action_bandit import CALMING_WEIGHT

    physio  = state.physio or {}
    hrv_ms  = physio.get("hrv_ms", 35.0)
    eda_us  = physio.get("eda_us", 3.5)
    zone_v  = physio.get("hysteresis_zone", 2)

    recent_turns = [m for m in state.conversation_history[-6:] if m.get("role") == "user"][-2:]
    excerpt = "\n".join(f"  '{m['content'][:180]}'" for m in recent_turns) or "  (no turns yet)"

    pending_ev  = getattr(state, "pending_event", {})
    pending_str = (
        f"{pending_ev.get('event_type','?')} in {pending_ev.get('days_until','?')}d "
        f"(threat={pending_ev.get('threat_level',0):.0%})"
        if pending_ev else "none"
    )

    action_list_str = "\n".join(f"  {a}" for a in actions)

    prompt = _GOT_PROMPT_TEMPLATE.format(
        stress_index        = state.stress_index,
        hrv_ms              = f"{hrv_ms:.0f}",
        eda_us              = f"{eda_us:.1f}",
        zone                = zone_v,
        session_gap_days    = getattr(state, "session_gap_days", 0.0),
        physio_available    = getattr(state, "physio_available", True),
        excerpt             = excerpt,
        conversation_stress = getattr(state, "conversation_stress", 0.5),
        stress_discrepancy  = (
            state.stress_index - getattr(state, "conversation_stress", 0.5)
        ),
        session_goal        = state.session_goal or "general support",
        alliance_score      = getattr(state, "alliance_score", 0.5),
        session_boundary    = getattr(state, "session_boundary", False),
        pending_event       = pending_str,
        mode                = getattr(state, "therapeutic_mode", "standard"),
        turn                = getattr(state, "turn_count", 0),
        action_list         = action_list_str,
    )

    fallback_scores = [
        CALMING_WEIGHT.get(a, 0.5) * state.stress_index
        + (1.0 - CALMING_WEIGHT.get(a, 0.5)) * (1.0 - state.stress_index)
        for a in actions
    ]

    try:
        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {
                "system":     _GOT_PRIOR_SYSTEM,
                "prompt":     prompt,
                "max_tokens": 1200,
                "arm":        arm,
            },
            timeout=35.0,
        )
        text = (resp.get("text") or "").strip()
        if not text:
            return fallback_scores, {}

        m = _re.search(r'\{.*\}', text, _re.DOTALL)
        if not m:
            return fallback_scores, {}
        data = _json.loads(m.group(0))

        node_e = data.get("node_e", {})
        scores = []
        for i, a in enumerate(actions):
            v = node_e.get(a)
            try:
                v = float(v)
                v = min(1.0, max(0.0, v / 10.0 if v > 1.5 else v))
            except (TypeError, ValueError):
                v = fallback_scores[i]
            scores.append(v)
        return scores, data

    except Exception:
        return fallback_scores, {}


def _got_batch_leaf_rerank(
    state: "TurnState",
    top_actions: list,
    got_trace: dict,
) -> list:
    """
    Batch leaf re-scorer: given top-5 MCTS actions, ask Scout to re-rank
    them in ONE call using the GoT trace context.

    Returns list of (action, score) sorted best-first.
    Falls back to the MCTS ordering on any failure.
    """
    import json as _json, re as _re

    if not top_actions or not got_trace:
        return top_actions

    physio = state.physio or {}
    node_b = got_trace.get("node_b", {})
    node_c = got_trace.get("node_c", {})
    node_d = got_trace.get("node_d", {})

    top_str = ", ".join(f"{a}({s:.2f})" for a, s in top_actions)

    prompt = _GOT_BATCH_LEAF_TEMPLATE.format(
        top_actions     = top_str,
        stress          = state.stress_index,
        hrv             = physio.get("hrv_ms", 35.0),
        zone            = physio.get("hysteresis_zone", 2),
        emotional_state = node_b.get("emotional_state", "unknown"),
        cluster         = node_d.get("cluster", "de_escalate"),
        session_phase   = node_c.get("session_phase", "working"),
    )
    try:
        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {
                "system":     _GOT_BATCH_LEAF_SYSTEM,
                "prompt":     prompt,
                "max_tokens": 300,
            },
            timeout=20.0,
        )
        text = (resp.get("text") or "").strip()
        m = _re.search(r'\{.*\}', text, _re.DOTALL)
        if not m:
            return top_actions
        data = _json.loads(m.group(0))
        rankings = data.get("rankings", [])
        if not rankings:
            return top_actions
        return [(str(a), float(s)) for a, s in rankings]
    except Exception:
        return top_actions


class GoTHPVOOTWorker(InertialHPVOOTPhysioMPSMCTSWorker):
    """
    Exp 17 — Graph-of-Thought MCTS (GoT-HPVOOT).

    Replaces the flat "rate these actions 0-1" Scout prior call with a
    structured 5-node Graph-of-Thought reasoning graph executed in a SINGLE
    LLM call:

        Node A  Physiological assessment  ->  stress severity, HRV trend
        Node B  Conversational assessment ->  emotional state, relational climate
        Node C  Temporal assessment       ->  session gap, pending event, phase
        Node D  Synthesis                 ->  cluster recommendation (A+B+C)
        Node E  Action scoring            ->  per-action scores (using D)

    After MCTS runs with these richer priors, a second Scout call re-scores
    the top-5 actions in a single batch using the GoT trace context.
    Total: 2 Scout calls (GoT prior + batch leaf re-rank) vs 1 (Exp 6).

    The GoT trace is stored in the response dict for dashboard auditing and
    qualitative feedback (FB1).

    Naming: semantic convention (GoTHPVOOTWorker), not verbose prefixes.
    """
    ARM            = "got_hpvoot"
    RELATIVE_SPEED = 0.30   # 2 Scout calls per turn: slightly slower than Exp 6

    def _fetch_prior_scores(self, state, zone_name, zone_streak, mode, actions):
        """Override: use GoT structured reasoning instead of flat rating prompt."""
        scores, self._last_got_trace = _got_prior_call(state, actions, arm=self.ARM)
        return scores

    def generate_response(
        self,
        state: "TurnState",
        action: str,
        scenario: dict,
        conversation_correction: float = 0.0,
    ) -> dict:
        self._last_got_trace = {}
        result = super().generate_response(state, action, scenario, conversation_correction)

        top_5 = result.get("_mcts_top5", [])
        if top_5 and self._last_got_trace:
            reranked = _got_batch_leaf_rerank(state, top_5, self._last_got_trace)
            if reranked:
                reranked_best = reranked[0][0]
                valid_names = {a for a, _ in top_5}
                if reranked_best != result.get("action_taken") and reranked_best in valid_names:
                    result = {**result, "action_taken": reranked_best}
            result["got_trace"]    = self._last_got_trace
            result["got_reranked"] = reranked
            result["llm_calls"]    = result.get("llm_calls", 1) + 1

        return result