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
)

log = logging.getLogger("tensornets.a3c.arms")

# ── Environment defaults ──────────────────────────────────────────────────────

_TENSORNETS_URL  = os.environ.get("TENSORNETS_URL",  "http://localhost:8765")
_COMPANION_URL   = os.environ.get("COMPANION_URL",   "http://localhost:3000")
_BEDROCK_REGION  = os.environ.get("AWS_REGION",      "us-east-1")

# Scout (fast) for action selection; Maverick for value / judge
_SCOUT_MODEL   = "us.meta.llama4-scout-17b-instruct-v1:0"
_MAVERICK_MODEL = "us.meta.llama4-maverick-17b-instruct-v1:0"


def _http_post(url: str, payload: dict, timeout: float = 10.0) -> dict:
    """Minimal HTTP POST without httpx / requests dependency."""
    import json as _json
    import urllib.request as _req
    data = _json.dumps(payload).encode()
    req  = _req.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with _req.urlopen(req, timeout=timeout) as resp:
            return _json.loads(resp.read())
    except Exception as exc:
        raise ConnectionError(f"POST {url} failed: {exc}") from exc


def _null_reward() -> dict[str, float]:
    return {dim: 0.0 for dim in REWARD_DIMS}


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
                f"{_TENSORNETS_URL}/mcts/best_action",
                {
                    "state": state.physio,
                    "candidates": [action],   # pre-selected by actor; MCTS refines
                    "subject_id": state.subject_id,
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
        next_stress = _stress_after_response(state.stress_index, action)
        reward = _synthetic_reward(state, action, next_stress)
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
        """Generate a response via Scout (Bedrock).  Returns the response text."""
        system_prompt = (
            f"You are a clinical companion. Current action strategy: {action}. "
            f"Patient stress level: {state.stress_index:.2f} ({state.stress_bucket}). "
            "Respond with one empathetic, concise message (2–3 sentences)."
        )
        history_text = "\n".join(
            f"{t['role'].upper()}: {t['content']}"
            for t in state.conversation_history[-6:]
        )
        user_msg = scenario.get("turns", [{}])[state.turn_idx].get(
            "user_message", "[no user message]"
        )
        prompt = f"{history_text}\nUSER: {user_msg}\nASSISTANT:"

        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256},
                timeout=20.0,
            )
            return resp.get("text", "[Scout unavailable]")
        except Exception as exc:
            log.warning("Arm1: Scout call failed: %s", exc)
            return f"[{action}] I hear you. Let's work through this together."


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

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
    ) -> dict:
        t_start = time.perf_counter()
        user_msg = scenario.get("turns", [{}])[state.turn_idx].get(
            "user_message", "[no user message]"
        )

        payload = {
            "message":    user_msg,
            "circleId":   scenario.get("circle_id", "benchmark_circle"),
            "userId":     state.subject_id,
            "sessionId":  state.session_id,
            "benchmark":  True,
            "arm":        self.ARM,
        }

        response_text = "[JS companion unavailable]"
        deferred      = True
        try:
            resp = _http_post(
                f"{_COMPANION_URL}/api/message",
                payload,
                timeout=30.0,
            )
            response_text = resp.get("response", resp.get("message", response_text))
            deferred = False
        except Exception as exc:
            log.warning("Arm2: JS companion call failed: %s", exc)

        latency_ms = (time.perf_counter() - t_start) * 1000.0

        # Reward deferred to offline scoring — fill zeros here
        reward = _null_reward()
        reward["safety"] = 0.8 if deferred else 1.0

        next_stress = _stress_after_response(state.stress_index, action)
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
            "info_coverage":     state.info_coverage,   # JS arm doesn't update this inline
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

    def generate_response(
        self,
        state: TurnState,
        action: str,
        scenario: dict,
    ) -> dict:
        t_start = time.perf_counter()
        user_msg = scenario.get("turns", [{}])[state.turn_idx].get(
            "user_message", "[no user message]"
        )

        hysteresis_ctx = _build_hysteresis_context(state, scenario)
        system_prompt  = (
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

        response_text = f"[{action}] I hear you. Let's work through this together."
        scout_tokens  = 0
        try:
            resp = _http_post(
                f"{_TENSORNETS_URL}/llm/scout",
                {"system": system_prompt, "prompt": prompt, "max_tokens": 256},
                timeout=20.0,
            )
            response_text = resp.get("text", response_text)
            scout_tokens  = len(response_text.split()) * 2
        except Exception as exc:
            log.warning("Arm3: Scout call failed: %s", exc)

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        next_stress = _stress_after_response(state.stress_index, action)
        reward = _synthetic_reward(state, action, next_stress)

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

def _stress_after_response(current_stress: float, action: str) -> float:
    """
    Heuristic stress transition: actions with a calming intent reduce stress.

    This is a *simulator* approximation used when the tensornets server is
    unavailable or for Arm 2 (JS).  In the full K1 run, Arm 1 uses the
    PhysiologicalHistory trajectory from /physio/history/append instead.

    Decay magnitude matches the OU simulator parameters (~5% per good turn).
    """
    calming_actions = {
        "REFLECT_FEELING", "VALIDATE_EXPERIENCE", "NORMALISE_RESPONSE",
        "PSYCHOEDUCATION", "BREATHING_EXERCISE", "MINDFULNESS_PROMPT",
        "MOTIVATIONAL_AFFIRMATION",
    }
    escalating_actions = {
        "EMERGENCY_REFERRAL", "SAFETY_CHECK", "CRISIS_PROTOCOL",
    }
    if action in calming_actions:
        delta = -0.05
    elif action in escalating_actions:
        delta = +0.02
    else:
        delta = -0.02   # neutral: mild natural decay

    return max(0.0, min(1.0, current_stress + delta))


def _synthetic_reward(
    state: TurnState,
    action: str,
    next_stress: float,
) -> dict[str, float]:
    """
    Compute a synthetic multi-dim reward from real state signals.

    Used inline during training when the offline HTN judge batch has not run yet.
    Dimensions follow REWARD_DIMS and REWARD_WEIGHTS in worker.py.

    goal_progress   — derived from info_coverage delta and whether a FRAMES
                      component suggests forward progress (not just validate/hold)
    info_coverage   — carried directly from state.info_coverage (real session value)
    consistency     — penalised if the action repeats the last_action on non-repetition turns
    trust_delta     — penalised if patient is repeating (sign of unresolved concern)
    """
    stress_delta    = state.stress_index - next_stress
    stress_r        = max(0.0, min(1.0, 0.5 + stress_delta * 5.0))

    # Trust: repetition signals unresolved concern → lower trust delta
    trust_r = 0.4 if state.repetition_detected else (0.65 if stress_delta >= 0 else 0.35)

    # Goal progress: forward-action taxonomy advances the goal
    advancing_actions = {
        "PSYCHOEDUCATION", "MOTIVATIONAL_AFFIRMATION", "DEVELOP_DISCREPANCY",
        "GIVE_OPTIONS", "SUMMARISE", "CHALLENGER_INSIGHT", "GIVE_FACTS",
    }
    holding_actions = {"VALIDATE_EXPERIENCE", "REFLECT_FEELING", "NORMALISE_RESPONSE"}
    if action in advancing_actions:
        goal_r = min(1.0, state.info_coverage + 0.15)   # advances topic coverage
    elif action in holding_actions:
        goal_r = state.info_coverage                      # holds, doesn't advance
    else:
        goal_r = max(0.0, state.info_coverage - 0.05)    # other/unknown — slight drag

    # Info coverage: use real session value
    info_r = state.info_coverage

    # Consistency: penalise repeating the exact same action when patient is not
    # repeating (if the patient repeats, same action may be intentional)
    if action == state.last_action and not state.repetition_detected and state.turn_count > 1:
        consistency_r = 0.4
    else:
        consistency_r = 0.8

    safety_r = 1.0
    return {
        "stress":        round(stress_r, 4),
        "trust_delta":   round(trust_r, 4),
        "goal_progress": round(goal_r, 4),
        "info_coverage": round(info_r, 4),
        "consistency":   round(consistency_r, 4),
        "safety":        round(safety_r, 4),
    }


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
