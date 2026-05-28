"""
tensornets.a3c.arms — The three A3C comparison arm workers.

J5  Arm1Worker : HTN + MCTS — full tensornets bridge (tensornetsBridge → FastAPI).
J6  Arm2Worker : Old-school production JS via HTTP (CompanionCoordinator endpoint).
J7  Arm3Worker : Hysteresis-in-prompt — physio state as text, no MPS / no MCTS.

Each arm overrides A3CWorker.generate_response() and sets ARM = <arm_id>.

Arm 1 is the *treatment*.  Arms 2 and 3 are baselines.
The same Actor / Critic parameters are shared across all arms within a run
so the policy improves from all three streams simultaneously.

Design notes (from A3C_COMPARISON_DESIGN.md §1)
-----------------------------------------------
- Arm 1: calls /mcts/best_action + /physio/history/append on the tensornets
  FastAPI server (localhost:8765).  Falls back to Actor.select() if the
  bridge is unavailable so training is never blocked by a missing Python server.
- Arm 2: posts to the production Node.js CompanionCoordinator endpoint
  (localhost:3000 or COMPANION_URL env var).  Reward is synthetic (HTN judge
  not available inline for JS arm) — placeholder reward is returned and later
  updated from the stored htn_benchmark_turns rows.
- Arm 3: enriches the prompt with the hysteresis state text (same as
  longitudinalHint in the JS system) before calling Scout directly via the
  tensornets Bedrock backend.  No MPS, no MCTS projection.

All three arms write the same jsonl schema (EpisodeTurn) for K1–K5 analysis.
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

# ── Environment defaults ──────────────────────────────────────────────────────

_TENSORNETS_URL  = os.environ.get("TENSORNETS_URL",  "http://localhost:8765")
_COMPANION_URL   = os.environ.get("COMPANION_URL",   "http://localhost:8247")
_BEDROCK_REGION  = os.environ.get("AWS_REGION",      "us-east-1")

# Scout (fast) for action selection; Maverick for value / judge
_SCOUT_MODEL   = "us.meta.llama4-scout-17b-instruct-v1:0"
_MAVERICK_MODEL = "us.meta.llama4-maverick-17b-instruct-v1:0"


def _http_post(url: str, payload: dict, timeout: float = 10.0) -> dict:
    """Minimal HTTP POST without httpx / requests dependency. Retries once on transient failure."""
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
                _time.sleep(1.5)
    raise ConnectionError(f"POST {url} failed: {last_exc}") from last_exc


# ── J5: Arm 1 — HTN + MCTS ────────────────────────────────────────────────────

class Arm1Worker(A3CWorker):
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

    ARM = "htn_mcts"

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
    ) -> dict:
        t_start  = time.perf_counter()
        fallback = False
        m_trunc  = None
        scout_tokens = 0

        # Step 1: MCTS best action + M_trunc from tensornets bridge
        try:
            mcts_resp = _http_post(
                f"{_TENSORNETS_URL}/mcts/best-action",
                {
                    "physio_state":      state.physio,
                    "candidate_actions": [action],
                    "mode":              state.therapeutic_mode or "standard",
                },
                timeout=5.0,
            )
            action   = mcts_resp.get("best_action", action)
            m_trunc  = mcts_resp.get("M_trunc")      # constraint matrix (serialised)
        except Exception as exc:
            log.warning("Arm1: MCTS call failed (%s), falling back to actor action", exc)
            fallback = True

        # Step 2: physio history append (best-effort — non-fatal)
        try:
            _http_post(
                f"{_TENSORNETS_URL}/physio/history/append",
                {**state.physio, "subject_id": state.subject_id},
                timeout=3.0,
            )
        except Exception:
            pass

        # Step 3 + 4: generate response (Scout, with M_trunc if available)
        response_text = self._call_scout(state, action, scenario, m_trunc=m_trunc)
        scout_tokens  = len(response_text.split()) * 2   # rough token estimate

        # Step 5: synthetic reward from stress delta
        next_stress = _stress_after_response(state.stress_index, action, state.archetype, state.drug_regimen)
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        reward["safety"] = 1.0 if not fallback else 0.8

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        return {
            "response":           response_text,
            "reward":             reward,
            "judge":              {},    # filled offline by HTN judge batch run
            "tokens":             {"scout": scout_tokens, "maverick": 0},
            "latency_ms":         round(latency_ms, 1),
            "next_stress_index":  next_stress,
            "next_physio":        {**state.physio, "stress_index": next_stress},
            "action_taken":       action,
            "frames_component":   None,   # MCTS supplies this when bridge is live
            "info_coverage":      min(1.0, state.info_coverage + 0.08),
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
                vocab = list(ACTION_TAXONOMY.keys())[:len(dominant)]
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
            except Exception:
                pass   # non-fatal; M_trunc injection is a soft hint only

        try:
            system_prompt = self._system_prompt.format(
                action=action,
                stress_index=state.stress_index,
                stress_bucket=state.stress_bucket,
                hysteresis_ctx="",
            )
        except (KeyError, ValueError):
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
            return text
        except Exception as exc:
            raise RuntimeError(f"Arm1: Scout call failed: {exc}") from exc


# ── J6: Arm 2 — Old-school production JS ─────────────────────────────────────

class Arm2Worker(A3CWorker):
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
    ) -> dict:
        t_start = time.perf_counter()
        user_msg = _last_user_message(state)

        payload = {
            "message":    user_msg,
            "circleId":   scenario.get("circle_id", "benchmark_circle"),
            "userId":     state.subject_id,
            "sessionId":  state.session_id,
            "benchmark":  True,
            "arm":        self.ARM,
        }

        deferred = True
        try:
            resp = _http_post(
                f"{_COMPANION_URL}/api/benchmark/message",
                payload,
                timeout=90.0,
            )
            response_text = resp.get("response", resp.get("message", "")).strip()
            if not response_text:
                raise ValueError("Empty response from JS companion")
            deferred = False
        except Exception as exc:
            raise RuntimeError(f"Arm2: JS companion call failed: {exc}") from exc

        latency_ms = (time.perf_counter() - t_start) * 1000.0

        next_stress = _stress_after_response(state.stress_index, action, state.archetype, state.drug_regimen)

        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)
        reward["safety"] = 1.0

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
            "info_coverage":     state.info_coverage,
            "repetition_detected": False,
            "discrepancy":       None,
            "deferred_reward":   deferred,
        }


# ── J7: Arm 3 — Hysteresis-in-prompt ─────────────────────────────────────────

class Arm3Worker(A3CWorker):
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

    ARM = "hysteresis_prompt"

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
        except (KeyError, ValueError):
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
        scout_tokens  = 0
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256},
                timeout=20.0,
            )
            response_text = resp.get("text", "").strip()
            if not response_text:
                raise ValueError("Empty response from /llm/scout")
            scout_tokens = len(response_text.split()) * 2
        except Exception as exc:
            raise RuntimeError(f"Arm3: Scout call failed: {exc}") from exc

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(state.stress_index, action, state.archetype, state.drug_regimen)
        reward = _synthetic_reward(state, action, next_stress, response_text=response_text)

        return {
            "response":          response_text,
            "reward":            reward,
            "judge":             {},
            "tokens":            {"scout": scout_tokens, "maverick": 0},
            "latency_ms":        round(latency_ms, 1),
            "next_stress_index": next_stress,
            "next_physio":       {**state.physio, "stress_index": next_stress},
            "action_taken":      action,
            "frames_component":  None,
            "info_coverage":     min(1.0, state.info_coverage + 0.05),
            "repetition_detected": False,
            "discrepancy":       None,
        }


# ── Shared utilities ──────────────────────────────────────────────────────────

def _stress_after_response(
    current_stress: float,
    action: str,
    archetype: str = "standard",
    drug_regimen_dict: "dict | None" = None,
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
        except Exception:
            pass   # non-fatal; fall through to unmodified delta

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
        except Exception:
            pass   # non-fatal; ignore missing pkpd dependency

    return max(0.0, min(1.0, current_stress + delta))


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

    try:
        mode  = TherapeuticMode(mode_str)
        # Accept both old deaddiction phase names and new ChangeStage names
        from tensornets.therapy.modes import DEADDICTION_TO_CHANGESTAGE
        phase_str_mapped = DEADDICTION_TO_CHANGESTAGE.get(phase_str, phase_str)
        phase = ChangeStage(phase_str_mapped)
    except ValueError:
        mode  = TherapeuticMode.STANDARD
        phase = ChangeStage.PRECONTEMPLATION

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
    # grounded — advancing actions earn a small coverage boost, holding actions
    # maintain it) combined with the orchestrator's coverage fraction. This is
    # an unbiased, non-circular estimate for the MCTS cost function.
    advancing = {
        "psychoeducation", "motivational_frame", "develop_discrepancy",
        "give_options", "summarise", "challenger_insight", "give_facts",
        "oars_summary", "loss_frame", "socratic_reframe",
        "share_circle_insight", "direct_advice", "future_planning",
    }
    holding = {"validate", "empathic_reflection", "unconditional_regard", "acknowledge_only"}
    if action in advancing:
        goal_r = min(1.0, state.info_coverage + 0.15)
    elif action in holding:
        goal_r = state.info_coverage
    else:
        goal_r = max(0.0, state.info_coverage - 0.05)

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
    info_r = state.info_coverage

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
    """
    physio = state.physio
    stress_label = _stress_label(state.stress_index)
    lines = [
        f"- Stress level: {stress_label} (index={state.stress_index:.2f})",
        f"- HRV RMSSD: {physio.get('hrv_rmssd_ms', 'N/A')} ms",
        f"- EDA: {physio.get('eda_us', 'N/A')} µS",
        f"- Sleep pressure: {physio.get('sleep_pressure', 'N/A')}",
    ]
    hysteresis = scenario.get("hysteresis_context", {})
    if hysteresis:
        lines.append("Longitudinal trigger history:")
        for trigger_id, info in hysteresis.items():
            pct = info.get("pct_extinguished", 0)
            suds = info.get("suds", "N/A")
            lines.append(f"  - {trigger_id}: {pct:.0f}% extinguished (SUDS={suds})")
    return "\n".join(lines)


def _stress_label(stress_index: float) -> str:
    if stress_index < 0.35:
        return "low stress"
    if stress_index < 0.65:
        return "moderate stress"
    return "high stress"
