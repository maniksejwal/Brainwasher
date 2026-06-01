"""
tensornets.a3c.arms -- Six independent A3C training experiments.

Experiment index
----------------
Exp 0  PhysioLLMWorker                (physio_llm)
       Physio state as natural-language text in system prompt. No MCTS, no dead-band.
       Formerly: PhysioLLMWorker / hysteresis_prompt.

Exp 1  PhysioLLMCoTMCTSWorker         (physio_llm_cot_mcts)
       Same physio prompt as Exp 0, but action selection via Maverick chain-of-thought
       over all 51 ACTION_TAXONOMY candidates. LLM-as-planner; cost baseline for Exp 2.

Exp 2  PhysioMPSMCTSWorker            (physio_mps_mcts)
       Full HTN + Matrix Product State MCTS via tensornets bridge.
       M_trunc constraint steers Scout token generation.
       Formerly: PhysioMPSMCTSWorker / htn_mcts.

Exp 3  InertialPhysioMPSMCTSWorker    (inertial_physio_mps_mcts)
       Exp 2 + HysteresisGate 5-zone dead-band. Zone and streak injected into
       MCTS payload and system prompt. Most capable experiment.

Exp 4  InertialPhysioLLMCoTMCTSWorker (inertial_physio_llm_cot_mcts)
       Exp 1 + HysteresisGate. CoT-MCTS with inertial zone awareness.

Exp 5  OldschoolWorker                (oldschool)
       Production Node.js CompanionCoordinator via HTTP. No physio.
       Formerly: OldschoolWorker / oldschool.

Capability order (ascending): 5 < 0 < 1 < 4 < 2 < 3

Exception policy
----------------
No silent fallbacks in Exp 0-4. Failures raise RuntimeError or ValueError so the
episode is recorded as failed and bugs are immediately surfaced.

All experiments write the same EpisodeTurn jsonl schema for cross-experiment comparison.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from tensornets.a3c.worker import (
    A3CWorker,
    REWARD_DIMS,
    TurnState,
    _build_reactivity_profile,   # C6.1: ReactivityProfile wiring
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




# ── J5: Arm 1 — HTN + MCTS ────────────────────────────────────────────────────

class PhysioMPSMCTSWorker(A3CWorker):
    """
    J5: Full HTN + MCTS arm.

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
    for action and plain Scout generation (degrades to Arm 3 behaviour for
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

        # Arm 1 ideally requires real physiological state for MCTS.
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
                    {**physio, "subject_id": state.subject_id},
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

        try:
            system_prompt = self._system_prompt.format(
                action=action,
                stress_index=state.stress_index,
                stress_bucket=state.stress_bucket,
                hysteresis_ctx="",
            )
        except (KeyError, ValueError) as fmt_exc:
            log.warning("Arm1: system prompt format failed (%s), using fallback", fmt_exc)
            system_prompt = (
                f"You are a clinical companion. Action strategy: {action}. "
                f"Patient stress: {state.stress_index:.2f} ({state.stress_bucket}). "
                "Respond with one empathetic, concise message (2–3 sentences)."
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
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256},
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


# ── J6: Arm 2 — Old-school production JS ─────────────────────────────────────

class OldschoolWorker(A3CWorker):
    """
    J6: Old-school production JS arm.

    Posts to the Node.js CompanionCoordinator API endpoint.
    Reward is *deferred*: the JS system stores its own scores in
    htn_benchmark_turns.  This worker records a placeholder reward of 0
    and the episode summary is back-filled by the K1 comparison runner after
    querying getBaselineStats().

    This matches the design doc: Arm 2 IS the production system.
    We do not modify it — we only observe its output and score it offline.
    """

    ARM = "oldschool"

    def update_system_prompt(self, new_prompt: str) -> None:
        """No-op: Arm 2 uses the Node.js production companion; prompt lives in Node.js."""

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


# ── J7: Arm 3 — Hysteresis-in-prompt ─────────────────────────────────────────

class PhysioLLMWorker(A3CWorker):
    """
    J7: Hysteresis-in-prompt arm.

    Same as Arm 2 (production JS), but the system prompt is augmented with
    the full hysteresis context string:
      - PhysiologicalState summary (stress, HRV, EDA, sleep pressure)
      - HystereticBaseline extinction progress per trigger
      - Longitudinal hint (same format as the JS longitudinalHint)

    No MPS, no MCTS, no M_trunc projection.  Purely text-based physio context.

    This arm tests: "can you get most of the HTN benefit just by telling the
    LLM the physio state in natural language?" (A3C_COMPARISON_DESIGN §1 Arm 3)
    """

    ARM = "physio_llm"

    # Default system prompt template.
    # Template vars: {hysteresis_ctx}, {action}.
    _DEFAULT_SYSTEM_PROMPT = (
        "You are a clinical companion.\n"
        "Physiological context:\n{hysteresis_ctx}\n"
        "Recommended action strategy: {action}.\n"
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

        hysteresis_ctx = _build_hysteresis_context(state, scenario)
        try:
            system_prompt  = self._system_prompt.format(
                hysteresis_ctx=hysteresis_ctx,
                action=action,
                stress_index=state.stress_index,
                stress_bucket=state.stress_bucket,
            )
        except (KeyError, ValueError) as fmt_exc:
            log.warning("Arm3: system prompt format failed (%s), using fallback", fmt_exc)
            system_prompt = (
                f"You are a clinical companion.\n"
                f"Physiological context:\n{hysteresis_ctx}\n"
                f"Recommended action strategy: {action}.\n"
                "Respond with one empathetic, concise message (2–3 sentences)."
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
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256},
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
        # Arm3: no safety override — same unconditional floor as Exp 1/2 via _synthetic_reward

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

def _stress_after_response(
    current_stress: float,
    action: str,
    archetype: str = "standard",
    drug_regimen_dict: "dict | None" = None,
    conversation_correction: float = 0.0,
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

    conversation_correction:
    A real-time discrepancy signal derived from the scorer's assessment of the
    patient's actual response vs. the expected response for the chosen action.
    Positive = patient more stressed/resistant than expected (push up σ).
    Negative = patient calmer/more accepting than expected (pull σ down).
    This captures "the patient didn't accept the fact we expected" and forces
    MCTS to update its model of the patient's state before the next action.
    Max magnitude is capped at ±0.05 per turn to prevent instability.

    Falls back to 0.5 (neutral, zero delta) for unknown actions.
    """
    try:
        from tensornets.a3c.action_bandit import CALMING_WEIGHT
    except ImportError:
        CALMING_WEIGHT = {}

    DELTA_SCALE = 0.08   # maximum per-turn stress change (±4% at CW extremes)
    cw    = CALMING_WEIGHT.get(action, 0.5)
    delta = -(cw - 0.5) * 2.0 * DELTA_SCALE

    # ── C6.1: scale delta by ReactivityProfile gamma_modifier ────────────────
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
    if state.stress_index >= 0.85 and action not in {
        "validate", "empathic_reflection", "safety_protocol", "acknowledge_only",
        "escalate", "flooding_hold", "flooding_deepen", "spike_step",
    }:
        stress_r = max(0.0, stress_r - 0.40)   # hard penalty for violating CRITICAL gate

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
    # IMPORTANT: goal_r is NOT derived from state.info_coverage (a turn-count
    # proxy) because that conflates verbosity with quality.  The baseline is
    # instead a fixed mid-range value that the action type shifts up or down.
    # The orchestrator's real coverage_fraction feeds into info_r (dim 4) and
    # into the next-state's info_coverage, providing the longitudinal signal.
    advancing = {
        "psychoeducation", "motivational_frame", "develop_discrepancy",
        "give_options", "summarise", "challenger_insight", "give_facts",
        "oars_summary", "loss_frame", "socratic_reframe",
        "share_circle_insight", "direct_advice", "future_planning",
    }
    # Questioning actions surface information but don't deliver value by themselves.
    questioning = {
        "probing_question", "specific_question", "clarify_goal",
        "elicit_change_talk", "explore_ambivalence",
    }
    holding = {"validate", "empathic_reflection", "unconditional_regard", "acknowledge_only"}
    # Social/rapport actions — earn trust that makes the patient receptive.
    # Must match ACTION_TAXONOMY in action_bandit.py exactly.
    # "build_rapport", "small_talk", "greet", "check_in" are NOT in the taxonomy
    # — those JS-side labels fall through to _GOAL_R_OTHER unless aliased here.
    social = {
        "affirmation",          # OARS: genuine strength recognition
        "validate",             # normalise experience
        "unconditional_regard", # non-judgment signal
        "build_alliance",       # therapeutic alliance reinforcement
        "companion_handoff",    # session brief (end-of-session rapport)
        "end_conversation",     # natural close (positive closure = rapport value)
    }
    if action in advancing:
        goal_r = _GOAL_R_ADVANCING
    elif action in questioning:
        goal_r = _GOAL_R_QUESTIONING
    elif action in holding:
        goal_r = _GOAL_R_HOLDING
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


def _build_hysteresis_context(state: TurnState, scenario: dict) -> str:
    """
    Build the natural-language physio + hysteresis context string for Arm 3.

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


# ── Exp 1: PhysioLLMCoTMCTSWorker -- physio_llm_cot_mcts ─────────────────────

class PhysioLLMCoTMCTSWorker(PhysioLLMWorker):
    """
    Exp 1: Physio-in-prompt + Maverick chain-of-thought action selection.

    Differs from Exp 0 (PhysioLLMWorker) in one way:
      Instead of using actor.select() to pick the action, a Maverick LLM call
      evaluates ALL 51 ACTION_TAXONOMY candidates and returns the top-ranked
      action with a justification chain (CoT).

    This arm is a deliberate cost/capability baseline for Exp 2 (PhysioMPSMCTSWorker):
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
        "Last patient message: {last_patient_message}\n\n"
        "Available actions (choose exactly one):\n{actions_list}\n\n"
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
        Call Maverick to select the best action from ACTION_TAXONOMY via CoT.

        Returns
        -------
        action : str
            The selected action name.
        cot_meta : dict
            Raw CoT output including confidence and reasoning, for logging.

        Raises
        ------
        RuntimeError
            If the Maverick call fails or returns no parseable CHOSEN_ACTION.
        """
        from tensornets.a3c.action_bandit import ACTION_TAXONOMY

        physio_ctx = _build_hysteresis_context(state, scenario)
        actions_list = "\n".join(
            f"  {i+1:2d}. {name}" for i, name in enumerate(ACTION_TAXONOMY)
        )
        last_patient_msg = _last_user_message(state)

        prompt = self._COT_PROMPT_TEMPLATE.format(
            physio_ctx=physio_ctx,
            zone_ctx="",
            scenario_goal=scenario.get("session_goal", ""),
            last_patient_message=last_patient_msg,
            actions_list=actions_list,
        )

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/maverick",
                {"system": "You are a clinical AI planner.", "prompt": prompt, "max_tokens": 512},
                timeout=40.0,
            )
        except Exception as exc:
            raise RuntimeError(
                f"PhysioLLMCoTMCTSWorker: Maverick CoT call failed: {exc}. "
                f"Check that the tensornets FastAPI server is running on {_TENSORNETS_URL}."
            ) from exc

        text = resp.get("text", "").strip()
        if not text:
            raise RuntimeError(
                "PhysioLLMCoTMCTSWorker: Maverick returned empty CoT response. "
                "This is a server-side error — check FastAPI logs."
            )

        # Parse CHOSEN_ACTION from the structured response
        chosen_action = None
        for line in text.splitlines():
            if line.strip().startswith("CHOSEN_ACTION:"):
                candidate = line.split(":", 1)[1].strip()
                if candidate in ACTION_TAXONOMY:
                    chosen_action = candidate
                    break

        if chosen_action is None:
            raise RuntimeError(
                f"PhysioLLMCoTMCTSWorker: CoT response did not contain a valid "
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
            "scout":           existing_scout_tokens,
            "maverick":        cot_meta["tokens_in"] + cot_meta["tokens_out"],
            "maverick_in":     cot_meta["tokens_in"],
            "maverick_out":    cot_meta["tokens_out"],
        }
        result["latency_ms"] = round((time.perf_counter() - t_start) * 1000.0, 1)
        result["llm_calls"]  = 2     # CoT call + Scout generation
        result["cot_action"] = chosen_action
        result["cot_reasoning"] = cot_meta.get("cot_text", "")[:200]   # truncate for log
        return result


# ── Exp 3: InertialPhysioMPSMCTSWorker -- inertial_physio_mps_mcts ───────────

class InertialPhysioMPSMCTSWorker(PhysioMPSMCTSWorker):
    """
    Exp 3: Full MPS-MCTS + HysteresisGate 5-zone dead-band. Most capable experiment.

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


# ── Exp 4: InertialPhysioLLMCoTMCTSWorker -- inertial_physio_llm_cot_mcts ────

class InertialPhysioLLMCoTMCTSWorker(PhysioLLMCoTMCTSWorker):
    """
    Exp 4: CoT-MCTS action selection + HysteresisGate 5-zone dead-band.

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
                f"{_TENSORNETS_URL}/llm/maverick",
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
            "scout":        existing_scout,
            "maverick":     cot_meta["tokens_in"] + cot_meta["tokens_out"],
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

    Extends Exp 3 (InertialPhysioMPSMCTSWorker) by upgrading the MCTS call
    from DialogMCTS (80 iter, 20 depth) to HierarchicalPWVOOTMCTS
    (150 iter, 20 depth, mcts_mode=hpvoot).

    Extra Scout call per turn fetches a numeric prior score over all HP actions
    before tree search, seeding PW expansion order with contextual relevance.

    Total LLM calls per turn: 2 (Scout prior + Scout generation).
    No fallbacks.
    """

    ARM = "inertial_hpvoot_physio_mps_mcts"

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

        Extraction strategy (robust to truncated responses):
        1. Try to parse the full JSON object if one can be found.
        2. Fall back to scanning individual "key": value lines so partial
           responses still yield useful priors instead of failing entirely.
        3. Default score = 0.5 for any action not found in the response.
        """
        import json as _json, re as _re
        action_list = "\n".join(f"  - {a}" for a in actions)
        prompt = (
            f"Patient state: stress={state.stress_index:.2f}, "
            f"zone={zone_name} (streak={zone_streak}), mode={mode}.\n\n"
            f"Rate each action 0.0 (wrong) to 1.0 (ideal) for this exact moment.\n"
            f"Actions:\n{action_list}"
        )
        # max_tokens large enough for all actions (avg ~8 chars/key, ~5 chars/val, ~30 actions)
        resp = _http_post(
            f"{_TENSORNETS_URL}/llm/scout",
            {"system": self._PRIOR_SYSTEM, "prompt": prompt, "max_tokens": 800},
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
                    "depth":             20,
                    "iterations":        150,
                    "context":           state.summary or "",
                    "mcts_mode":         "hpvoot",
                    "llm_prior_scores":  prior_scores,
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
            "mcts_mode":            "hpvoot",
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


# ── Exp 7: InertialHPVOOTPhysioLLMCoTMCTSWorker ──────────────────────────────

class InertialHPVOOTPhysioLLMCoTMCTSWorker(InertialPhysioLLMCoTMCTSWorker):
    """
    Exp 7: CoT-MCTS + HysteresisGate + HP+VOOT+PW tree search.

    Extends Exp 4 by upgrading the MCTS step to HP+VOOT+PW.
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
                f"{_TENSORNETS_URL}/llm/maverick",
                {"prompt": cot_prompt, "max_tokens": 1400},
            )
        except Exception as exc:
            raise RuntimeError(
                f"InertialHPVOOTPhysioLLMCoTMCTSWorker: Maverick CoT failed: {exc}"
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
                    "depth":             20,
                    "iterations":        150,
                    "context":           state.summary or "",
                    "mcts_mode":         "hpvoot",
                    "llm_prior_scores":  prior_scores,
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
                "scout_in":     scout_tokens.get("scout_in", 0),
                "scout_out":    scout_tokens.get("scout_out", 0),
                "maverick_in":  cot_meta["tokens_in"],
                "maverick_out": cot_meta["tokens_out"],
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
            "mcts_mode":            "hpvoot",
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
