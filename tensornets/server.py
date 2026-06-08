"""
FastAPI microservice bridge for tensornets.

Exposes the Python MPS / physiological engine to the Node.js companion system.
Run this alongside the Node.js server:

    cd tensornets
    uvicorn server:app --port 8765 --reload

All endpoints accept JSON and return JSON. The Node.js side calls these via
companions/physio/tensornetsBridge.js.

Endpoints
---------
GET  /health
POST /physio/state          -> compute stress_index, gamma, to_vector
POST /physio/history/append -> add state to subject's history, return updated trajectory
POST /mcts/score-candidates -> score N candidate responses by projected stress impact
POST /mps/project           -> apply constraint projection (requires mps_state in body)
"""

from __future__ import annotations

# Load .env from the project root (two levels up: tensornets/server.py → project root).
# This is a no-op if python-dotenv is not installed or the file is absent.
try:
    from dotenv import load_dotenv as _load_dotenv
    import pathlib as _pathlib
    _load_dotenv(_pathlib.Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass

import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
except ImportError:
    raise ImportError(
        "FastAPI not installed. Run: pip install fastapi uvicorn[standard] pydantic"
    )

log = logging.getLogger("tensornets.server")

from tensornets.physio.state import (
    PhysiologicalState,
    PhysiologicalHistory,
    stress_index as _stress_index,
    to_vector as _to_vector,
    stressLabel,
)
from tensornets.physio.hrv import (
    gamma_from_state,
    gamma_to_lambda1,
    stress_half_life_turns,
    estimate_baseline_from_history,
)
from tensornets.physio.simulator import SubjectProfile, PhysiologicalSimulator

app = FastAPI(
    title="tensornets bridge",
    description="Physiological state + MCTS services for the JS companion system",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # restrict to localhost in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory history store — persisted to TENSORNETS_HISTORY_DIR on restart ──
_histories: dict[str, PhysiologicalHistory] = {}

_HISTORY_DIR = os.environ.get("TENSORNETS_HISTORY_DIR", os.path.join(os.path.dirname(__file__), "data", "physio_history"))


def _history_path(subject_id: str) -> str:
    os.makedirs(_HISTORY_DIR, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in subject_id)
    return os.path.join(_HISTORY_DIR, f"{safe}.json")


def _load_all_histories() -> None:
    """Load all persisted history files from disk into _histories."""
    if not os.path.isdir(_HISTORY_DIR):
        return
    for fname in os.listdir(_HISTORY_DIR):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(_HISTORY_DIR, fname)
        try:
            hist = PhysiologicalHistory.load(fpath)
            _histories[hist.subject_id] = hist
            log.info("Loaded physio history for subject %s (%d states)", hist.subject_id, len(hist))
        except Exception as exc:
            log.warning("Failed to load physio history %s: %s", fpath, exc)


def _save_all_histories() -> None:
    """Flush all in-memory histories to disk."""
    for subject_id, hist in _histories.items():
        try:
            hist.save(_history_path(subject_id))
        except Exception as exc:
            log.warning("Failed to save physio history for %s: %s", subject_id, exc)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    _load_all_histories()
    yield
    _save_all_histories()


app.router.lifespan_context = _lifespan


# ── Request / response models ─────────────────────────────────────────────────

class PhysioStateIn(BaseModel):
    hrv_rmssd_ms:           float
    blood_glucose_mmol:     float
    eda_us:                 float
    time_of_day_h:          float
    location_stress_index:  float
    sleep_hours_last_night: float = 7.0
    sleep_deficit_hours:    float = 1.0
    circadian_entrainment:  float = 0.7
    respiratory_rate_bpm:   float = 15.0
    is_simulated:           bool  = True   # False when real wearable data is used
    hrv_source:             str   = "simulated"   # "ble" | "simulated" — set by wearable bridge
    subject_id:             Optional[str] = None


class CandidateScoreRequest(BaseModel):
    subject_id:    str
    physio_state:  PhysioStateIn
    candidates:    list[str]    # list of candidate response texts
    delta_t:       float = 1.0
    n_lookahead:   int   = 3    # turns to simulate forward


class SimulateRequest(BaseModel):
    subject_id:      str
    n_turns:         int   = 20
    hrv_baseline_ms: float = 35.0
    stressors:       list[dict] = []   # [{turn, magnitude, label}]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_physio_state(p: PhysioStateIn) -> PhysiologicalState:
    return PhysiologicalState(
        hrv_rmssd_ms           = p.hrv_rmssd_ms,
        blood_glucose_mmol     = p.blood_glucose_mmol,
        eda_us                 = p.eda_us,
        time_of_day_h          = p.time_of_day_h,
        location_stress_index  = p.location_stress_index,
        sleep_hours_last_night = p.sleep_hours_last_night,
        sleep_deficit_hours    = p.sleep_deficit_hours,
        circadian_entrainment  = p.circadian_entrainment,
        respiratory_rate_bpm   = p.respiratory_rate_bpm,
        is_simulated           = p.is_simulated,
        subject_id             = p.subject_id,
    )


def _physio_summary(state: PhysiologicalState) -> dict:
    idx     = _stress_index(state)
    gamma   = gamma_from_state(state)
    lambda1 = gamma_to_lambda1(gamma)
    half    = stress_half_life_turns(gamma)
    label   = stressLabel(idx)
    return {
        "stress_index":     round(idx, 4),
        "stress_label":     label["label"],
        "prompt_hint":      label["promptHint"],
        "gamma":            round(gamma, 5),
        "lambda1":          round(lambda1, 5),
        "half_life_turns":  round(half, 2) if half != float("inf") else None,
        "vector":           [round(x, 4) for x in _to_vector(state)],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "tensornets-bridge", "ts": int(time.time())}


@app.get("/physio/thresholds")
def physio_thresholds():
    """
    Return the canonical physiological thresholds used by the tensornets layer.

    The JS side (companions/physio/state.js) reads these at startup so that
    the Python and JavaScript stress labels are always in sync.

    Called by tensornetsBridge.js at initialisation (loadThresholds()).
    The returned values are used by action_selector.js, empathyHandler.js,
    and the simulation scorer to map raw HRV/stress_index to labels.
    """
    from tensornets.linguistic.backend_base import STRESS_THRESHOLDS, HRV_THRESHOLDS
    return {
        "stress_index": STRESS_THRESHOLDS,
        "hrv_ms":       HRV_THRESHOLDS,
        "labels":       ["low_stress", "moderate_stress", "high_stress", "critical"],
        "description": (
            "stress_index: 0..1 from PhysiologicalState.stress_index(). "
            "hrv_ms: RMSSD in milliseconds. "
            "Label is the WORST threshold exceeded."
        ),
    }


@app.post("/physio/state")
def physio_state(req: PhysioStateIn):
    """
    Compute stress_index, gamma, lambda1, and 8-d feature vector from raw signals.
    This is the main endpoint called by empathyHandler.js when sensor data is available.
    """
    try:
        state = _make_physio_state(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _physio_summary(state)


@app.post("/physio/history/append")
def physio_history_append(req: PhysioStateIn):
    """
    Append a state to the subject's running history.
    Returns the updated stress + HRV trajectories and current summary.
    """
    subject_id = req.subject_id or "default"
    try:
        state = _make_physio_state(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if subject_id not in _histories:
        _histories[subject_id] = PhysiologicalHistory(subject_id=subject_id)
    try:
        _histories[subject_id].append(state)
    except ValueError:
        # Timestamp out-of-order — update timestamp and retry
        from datetime import datetime
        state.timestamp = datetime.utcnow()
        _histories[subject_id].append(state)

    hist = _histories[subject_id]
    try:
        hist.save(_history_path(subject_id))
    except Exception as exc:
        log.warning("Could not persist physio history for %s: %s", subject_id, exc)
    return {
        "subject_id":         subject_id,
        "n_states":           len(hist),
        "current":            _physio_summary(state),
        "stress_trajectory":  [round(x, 4) for x in hist.stress_trajectory()],
        "hrv_trajectory":     [round(x, 2) for x in hist.hrv_trajectory()],
        "estimated_baseline": round(estimate_baseline_from_history(hist), 2),
    }


@app.post("/mcts/score-candidates")
def mcts_score_candidates(req: CandidateScoreRequest):
    """
    Score a list of candidate response texts by their projected stress impact.

    Algorithm:
    1. For each candidate, estimate its Γ impact using a keyword-based
       stress amplification heuristic (approximation until full MPS is wired).
    2. Apply exponential decay from current state for n_lookahead turns.
    3. Return candidates ranked by lowest projected cumulative stress.

    This is the practical MCTS approximation that runs today.
    The full MCTS tree search (Phase 3) replaces this with proper
    UCB1 + non-Hermitian operator expansion.
    """
    try:
        state = _make_physio_state(req.physio_state)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    gamma    = gamma_from_state(state)
    base_idx = _stress_index(state)

    # Keyword-based Γ amplification (practical approximation)
    # A full MCTS rollout would use the non-Hermitian operator instead.
    HIGH_STRESS_KEYWORDS = {
        "denied", "reject", "owe", "cost", "bill", "payment", "out-of-pocket",
        "deductible", "copay", "premium", "liability", "balance", "overdue",
        "surgery", "procedure", "diagnosis", "prognosis", "terminal", "chronic",
    }
    DE_ESCALATION_KEYWORDS = {
        "understand", "together", "support", "help", "here for you", "advocate",
        "moment", "breathe", "listen", "calm", "safe", "okay",
    }

    scored = []
    for i, candidate in enumerate(req.candidates):
        words = set(candidate.lower().split())
        stress_words = len(words & HIGH_STRESS_KEYWORDS)
        calm_words   = len(words & DE_ESCALATION_KEYWORDS)

        # Amplification factor: each stress keyword adds 5% to Γ,
        # each calm keyword subtracts 3%
        amplification = 1.0 + 0.05 * stress_words - 0.03 * calm_words
        amplification = max(0.5, min(amplification, 2.0))

        # Simulate forward n_lookahead turns
        cumulative_stress = 0.0
        current = base_idx
        for turn in range(1, req.n_lookahead + 1):
            # After this response, stress evolves as:
            # σ_{t+1} = σ_t * amplification * e^{-γΔt}
            # amplification only applies at turn 1 (the response turn)
            amp = amplification if turn == 1 else 1.0
            current = current * amp * gamma_to_lambda1(gamma, req.delta_t)
            cumulative_stress += current

        scored.append({
            "rank":             None,
            "candidate_index":  i,
            "candidate_text":   candidate,
            "projected_stress": round(cumulative_stress, 4),
            "amplification":    round(amplification, 3),
            "stress_keywords":  stress_words,
            "calm_keywords":    calm_words,
        })

    scored.sort(key=lambda x: x["projected_stress"])
    for rank, item in enumerate(scored):
        item["rank"] = rank + 1

    return {
        "subject_id":    req.subject_id,
        "current_stress": round(base_idx, 4),
        "gamma":         round(gamma, 5),
        "candidates":    scored,
        "best":          scored[0] if scored else None,
    }


@app.post("/physio/simulate")
def physio_simulate(req: SimulateRequest):
    """
    Run a synthetic HRV trajectory simulation using the Ornstein-Uhlenbeck model.
    Returns the full trajectory for display in the GUI.
    """
    from tensornets.physio.simulator import StressorEvent

    profile = SubjectProfile(
        baseline_hrv_ms   = req.hrv_baseline_ms,
        subject_id        = req.subject_id,
    )
    stressors = [
        StressorEvent(turn=s["turn"], magnitude=s["magnitude"], label=s.get("label", ""))
        for s in req.stressors
    ]
    sim = PhysiologicalSimulator(profile)
    history = sim.simulate(n_turns=req.n_turns, stressors=stressors)

    return {
        "subject_id":        req.subject_id,
        "n_turns":           len(history),
        "hrv_trajectory":    [round(s.hrv_rmssd_ms, 2) for s in history.states],
        "stress_trajectory": [round(_stress_index(s), 4) for s in history.states],
        "gamma_trajectory":  [round(gamma_from_state(s), 5) for s in history.states],
    }


# ── Therapy / longitudinal endpoints ─────────────────────────────────────────

from tensornets.therapy.modes import (
    TherapeuticMode as _TherapeuticMode,
    DeaddictionPhase as _DeaddictionPhase,
    MCTSConfig as _MCTSConfig,
    ModeKeywords as _ModeKeywords,
    score_candidate as _score_candidate_mode,
)
from tensornets.therapy.longitudinal import (
    SessionRecord as _SessionRecord,
    record_session as _record_session,
    detect_secrets as _detect_secrets,
    longitudinal_prompt_hint as _longitudinal_prompt_hint,
)


class TherapyCandidateRequest(BaseModel):
    subject_id:          str
    physio_state:        PhysioStateIn
    candidates:          list[str]
    mode:                str = "standard"
    deaddiction_phase:   str = "precontemplation"
    flooding_target:     float = 0.75
    n_lookahead:         int = 3


class SessionRecordIn(BaseModel):
    subject_id:       str
    session_id:       str
    mode:             str = "deaddiction"
    phase:            str = "precontemplation"
    turns:            int = 0
    rapport_score:    float = 0.5
    peak_stress:      float = 0.5
    final_stress:     float = 0.4
    topic_hrv_map:    dict = {}
    secret_detected:  bool = False
    secret_detail:    str  = ""
    notes:            str  = ""


@app.post("/therapy/score-candidates")
def therapy_score_candidates(req: TherapyCandidateRequest):
    """
    Score candidate responses using a therapeutic-mode-aware MCTS cost function.

    Unlike /mcts/score-candidates (which uses a keyword heuristic tuned for
    stress minimisation), this endpoint adapts the cost function to the
    therapeutic mode:
      - standard:    minimise projected stress
      - flooding:    reward responses that push stress toward the target level
      - deaddiction: phase-dependent cost (rapport/ambivalence/insight/strike)
      - negotiation: stress tolerance ceiling
    """
    try:
        mode  = _TherapeuticMode(req.mode)
        phase = _DeaddictionPhase(req.deaddiction_phase)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    state = _make_physio_state(req.physio_state)
    gamma = gamma_from_state(state)
    base  = _stress_index(state)

    cfg  = _MCTSConfig(
        mode                   = mode,
        deaddiction_phase      = phase,
        flooding_target_stress = req.flooding_target,
        n_lookahead            = req.n_lookahead,
    )
    kw = _ModeKeywords.for_mode(mode, phase)

    scored = []
    for i, text in enumerate(req.candidates):
        sc = _score_candidate_mode(text, base, gamma, cfg, kw)
        scored.append({
            "candidate_index": i,
            "candidate_text":  text,
            **sc,
        })

    scored.sort(key=lambda x: x["cumulative_cost"])
    for rank, item in enumerate(scored):
        item["rank"] = rank + 1

    best = scored[0]
    return {
        "mode":           mode.value,
        "phase":          phase.value,
        "current_stress": round(base, 4),
        "candidates":     scored,
        "best": {
            "candidate_index": best["candidate_index"],
            "candidate_text":  best["candidate_text"],
            "cumulative_cost": best["cumulative_cost"],
            "rank":            1,
            "amplification":   best["amplification"],
            "stress_keywords": best["stress_keywords"],
            "calm_keywords":   best["calm_keywords"],
        },
    }


@app.post("/therapy/record-session")
def therapy_record_session(req: SessionRecordIn):
    """
    Record a completed therapeutic session and advance the deaddiction phase.
    Returns the updated longitudinal state and the recommended phase for next session.
    """
    import time as _time
    record = _SessionRecord(
        session_id      = req.session_id,
        timestamp       = _time.time(),
        mode            = req.mode,
        phase           = req.phase,
        turns           = req.turns,
        rapport_score   = req.rapport_score,
        peak_stress     = req.peak_stress,
        final_stress    = req.final_stress,
        topic_hrv_map   = req.topic_hrv_map,
        secret_detected = req.secret_detected,
        secret_detail   = req.secret_detail,
        notes           = req.notes,
    )
    state, next_phase = _record_session(req.subject_id, record)
    return {
        "subject_id":         state.subject_id,
        "session_count":      state.session_count,
        "current_phase":      state.deaddiction_phase,
        "next_phase":         next_phase.value,
        "rapport_scores":     state.rapport_scores,
        "readiness_score":    round(state.readiness_score, 3),
        "secret_signals":     state.secret_signals,
    }


@app.get("/therapy/secrets/{subject_id}")
def therapy_detect_secrets(subject_id: str, sensitivity: float = 0.75):
    """
    Detect topics associated with consistent HRV suppression across sessions.
    Returns topics likely associated with hidden information (secrets).
    """
    secrets = _detect_secrets(subject_id, sensitivity=sensitivity)
    return {"subject_id": subject_id, "secrets": secrets}


@app.get("/therapy/prompt-hint/{subject_id}")
def therapy_prompt_hint(subject_id: str):
    """
    Return a compact therapist briefing note for injection into the LLM system prompt.
    """
    hint = _longitudinal_prompt_hint(subject_id)
    return {"subject_id": subject_id, "hint": hint}


# ─────────────────────────────────────────────────────────────────────────────
# Inter-agent communication endpoints
# ─────────────────────────────────────────────────────────────────────────────

from tensornets.agents.inter_agent_comm import SharedDialogueState as _SharedDialogueState

# In-process session store (replace with Redis or DB in production)
_shared_sessions: dict[str, _SharedDialogueState] = {}


class CommitmentIn(BaseModel):
    session_id: str
    agent_id: str
    statement: str
    topic: str
    delta_hrv_ms: float = 0.0
    is_clinical: bool = False
    current_hrv: float = 40.0


class EscalationIn(BaseModel):
    session_id: str
    from_agent: str
    to_agent: str
    reason: str


def _get_or_create_session(session_id: str, agents: list[str] | None = None) -> _SharedDialogueState:
    if session_id not in _shared_sessions:
        _shared_sessions[session_id] = _SharedDialogueState(
            session_id=session_id,
            agents=agents or ["patient", "caregiver", "clinician"],
        )
    return _shared_sessions[session_id]


@app.post("/agents/commit")
def agents_commit(req: CommitmentIn):
    """
    Record a commitment made by an agent and propagate the physiological
    prediction to all other agents via the social coupling matrix V_int.
    Returns the updated consistency hint for all agents.
    """
    state = _get_or_create_session(req.session_id)
    state.add_commitment(
        req.agent_id, req.statement, req.topic, req.is_clinical
    )
    # Propagate HRV prediction to other agents
    for other in state.agents:
        if other != req.agent_id and req.delta_hrv_ms != 0.0:
            state.update_physio_prediction(
                req.agent_id, other, req.delta_hrv_ms, req.current_hrv
            )
    return {
        "session_id": req.session_id,
        "turn": state.turn,
        "commitments_count": len(state.commitments),
        "hrv_predictions": state.agent_hrv_predictions,
    }


@app.get("/agents/consistency-hint/{session_id}/{agent_id}")
def agents_consistency_hint(session_id: str, agent_id: str):
    """
    Return a prompt injection string for `agent_id` listing cross-agent
    commitments that it must not contradict.
    """
    state = _get_or_create_session(session_id)
    from tensornets.agents.inter_agent_comm import multi_agent_mcts_hint
    hint = multi_agent_mcts_hint(state, agent_id)
    return {
        "session_id": session_id,
        "agent_id": agent_id,
        "hint": hint,
        "escalation_requested": state.escalation_requested,
        "escalation_target": state.escalation_target,
        "predicted_hrv": state.agent_hrv_predictions.get(agent_id),
    }


@app.post("/agents/escalate")
def agents_escalate(req: EscalationIn):
    """Request escalation from one agent to another."""
    state = _get_or_create_session(req.session_id)
    state.request_escalation(req.from_agent, req.to_agent, req.reason)
    return {
        "session_id": req.session_id,
        "escalation_requested": True,
        "escalation_target": req.to_agent,
    }


@app.delete("/agents/session/{session_id}")
def agents_clear_session(session_id: str):
    """Clear the in-memory shared state for a session (end of conversation)."""
    _shared_sessions.pop(session_id, None)
    return {"session_id": session_id, "cleared": True}


# ─────────────────────────────────────────────────────────────────────────────
# Intervention Queue — cross-user, cross-session scheduled interventions
#
# Companion A (serving user A) calls POST /agents/intervention/enqueue when it
# detects a significant event that requires companion B to act during B's next
# session with user B.
#
# This endpoint:
#   1. Validates the request structure
#   2. Applies the physio-aware urgency heuristic if urgency_score not supplied
#   3. Forwards to Node.js POST /api/interventions/enqueue (which has DB access)
#
# The Node.js side persists the item and applies the consent gate check.
# ─────────────────────────────────────────────────────────────────────────────

class InterventionEnqueueIn(BaseModel):
    target_user_id:      str
    target_circle_id:    str | None = None
    source_user_id:      str | None = None
    source_companion_id: str | None = None
    concern_type:        str        # physiological_alert|behavioral_flag|cross_user_welfare|scheduled_followup|clinical_directive|consent_request
    concern_summary:     str
    suggested_action:    str | None = None
    urgency_score:       float      = 0.5   # 0.0–1.0
    physio_gate:         float      = 0.70  # surface only if target stress_index < this
    min_session_turn:    int        = 3
    fire_after_ms:       int | None = None  # epoch ms; null = immediately eligible
    deadline_at_ms:      int | None = None  # epoch ms; null = no hard deadline
    consent_chain:       str        = "implied"
    # Physio context of source user at time of detection (for urgency auto-scaling)
    source_stress_index: float | None = None
    source_hrv_ms:       float | None = None


@app.post("/agents/intervention/enqueue")
async def agents_intervention_enqueue(req: InterventionEnqueueIn):
    """
    Enqueue a cross-user intervention item.

    Auto-scales urgency_score from physiological context if source_stress_index
    is provided:
      - source_stress_index >= 0.85  → urgency boosted to max(urgency, 0.90)
      - source_stress_index >= 0.70  → urgency boosted to max(urgency, 0.70)
      - concern_type = 'physiological_alert' → urgency floored at 0.60

    Forwards the validated payload to Node.js POST /api/interventions/enqueue.
    Returns the item_id assigned by Node.js.
    """
    import httpx, os, time

    # Auto-scale urgency from physio context
    urgency = req.urgency_score
    if req.source_stress_index is not None:
        si = req.source_stress_index
        if si >= 0.85:
            urgency = max(urgency, 0.90)
        elif si >= 0.70:
            urgency = max(urgency, 0.70)
    if req.concern_type == "physiological_alert":
        urgency = max(urgency, 0.60)
    if req.concern_type in ("clinical_directive",):
        urgency = max(urgency, 0.50)

    payload = {
        "targetUserId":      req.target_user_id,
        "targetCircleId":    req.target_circle_id,
        "sourceUserId":      req.source_user_id,
        "sourceCompanionId": req.source_companion_id,
        "concernType":       req.concern_type,
        "concernSummary":    req.concern_summary,
        "suggestedAction":   req.suggested_action,
        "urgencyScore":      urgency,
        "physioGate":        req.physio_gate,
        "minSessionTurn":    req.min_session_turn,
        "fireAfter":         req.fire_after_ms,
        "deadlineAt":        req.deadline_at_ms,
        "consentChain":      req.consent_chain,
    }

    node_url = os.environ.get("NODE_URL", "http://localhost:8247")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{node_url}/api/interventions/enqueue", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return {
                "status": "enqueued",
                "item_id": data.get("item_id"),
                "urgency_score": urgency,
            }
    except Exception as exc:
        # Non-fatal — log and return partial success so A3C training isn't blocked
        import logging
        logging.getLogger(__name__).warning(
            "intervention enqueue forwarding failed: %s", exc
        )
        return {
            "status": "enqueue_failed",
            "reason": str(exc),
            "urgency_score": urgency,
        }


@app.post("/agents/intervention/resolve")
async def agents_intervention_resolve(body: dict):
    """
    Mark a surfaced intervention item as resolved.
    Forwards to Node.js POST /api/interventions/resolve.

    body: { item_id, outcome ('completed'|'dismissed'), note? }
    """
    import httpx, os
    node_url = os.environ.get("NODE_URL", "http://localhost:8247")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{node_url}/api/interventions/resolve", json=body)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"status": "resolve_failed", "reason": str(exc)}


# ─────────────────────────────────────────────────────────────────────────────
# LLM-as-Judge (Python / Maverick via AWS Bedrock boto3)
#
# These endpoints are distinct from the JS judge (training/simulation/js_judge.js).
#
# JS judge  -> real-time, in-process, Scout/Maverick, no MPS check
# THIS judge -> offline, batch, Maverick or 405B, includes MPS constraint check
# ─────────────────────────────────────────────────────────────────────────────

class JudgeTurnIn(BaseModel):
    patient_input: str
    companion_reply: str
    physio_context: dict = {}
    mode: str = "standard"
    judge_model: str = "maverick"   # 'maverick' | '405b' | 'scout'
    session_id: str = ""
    turn: int = 0


class JudgeSessionIn(BaseModel):
    turns: list[dict]            # list of JudgeTurnIn-compatible dicts
    mode: str = "standard"
    judge_model: str = "maverick"


@app.post("/judge/turn")
def judge_turn(req: JudgeTurnIn):
    """
    HTN Judge: evaluate a single companion turn (real-time, uses Maverick).
    Returns 6-dimension rubric scores + DPO counterfactual hint.
    Call from tensornetsBridge.judgeDialogueTurn() after each companion response.
    Uses boto3 -> Bedrock Maverick (default) or 405B.
    Includes MPS constraint satisfaction check if an MPS state is available.
    Called by tensornetsBridge.js judgeDialogueTurn().
    """
    try:
        from tensornets.training.judge import JudgeConfig, evaluate_turn, build_judge_prompt
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Judge module error: {e}")

    config_obj = JudgeConfig(model=req.judge_model)
    result = evaluate_turn(
        patient_input=req.patient_input,
        companion_reply=req.companion_reply,
        physio_context=req.physio_context,
        mode=req.mode,
        config=config_obj,
    )
    return result


@app.post("/judge/session")
def judge_session(req: JudgeSessionIn):
    """
    Batch-evaluate all turns in a session.
    Returns aggregate statistics + per-turn verdicts.
    Equivalent to judgeSession() in js_judge.js but using Maverick/405B.
    """
    try:
        from tensornets.training.judge import JudgeConfig, evaluate_session
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Judge module error: {e}")

    config_obj = JudgeConfig(model=req.judge_model)
    return evaluate_session(turns=req.turns, mode=req.mode, config=config_obj)


class DiscrepancyAuditIn(BaseModel):
    """
    Request body for the multi-judge discrepancy audit endpoint.

    js_scores:      list of {turn, score, raw} dicts from simulation_scorer.js
                    score is in [-3, +3] (js scorer range)
    python_results: list of {turn, evaluator, judgment} dicts
                    evaluator is 'python_maverick' or 'python_405b'
                    judgment is the full output from evaluate_turn()
    dimension:      scoring dimension to compare ('overall', 'empathy', etc.)
    spread_threshold: minimum score spread to flag as discrepancy (default 0.2)
    """
    js_scores:        list[dict] = []
    python_results:   list[dict] = []
    dimension:        str = "overall"
    spread_threshold: float = 0.2


@app.post("/judge/audit")
def judge_audit(req: DiscrepancyAuditIn):
    """
    Cross-evaluator discrepancy audit.

    Accepts results from ALL evaluators (JS scorer + Python judges) and returns:
      - discrepancies: turns where evaluators disagree by >= spread_threshold
      - weighted_scores: trust-weighted per-turn scores
      - interpretation: which evaluator to trust for each discrepancy
      - high_confidence_turns: turns where all evaluators agree (best training signal)

    This endpoint enables the subjective multi-judge approach:
    Disagreements are surfaced for human review; agreements drive ALS updates.

    Called by tensornetsBridge.js  auditJudgeDiscrepancy().
    """
    try:
        from tensornets.training.judge import DiscrepancyAudit
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Judge module error: {e}")

    audit = DiscrepancyAudit(spread_threshold=req.spread_threshold)

    for js in req.js_scores:
        audit.add_js_scorer_output(
            turn=js.get("turn", 0),
            js_score=float(js.get("score", 0.0)),
            js_raw=js.get("raw", {}),
        )

    for pr in req.python_results:
        audit.add_python_judge_output(
            turn=pr.get("turn", 0),
            judgment_dict=pr.get("judgment", {}),
            model_key=pr.get("evaluator", "python_maverick"),
        )

    return audit.summary(dimension=req.dimension)


# ─────────────────────────────────────────────────────────────────────────────
# MCTS best-action endpoint
# ─────────────────────────────────────────────────────────────────────────────

class MCTSActionIn(BaseModel):
    physio_state:            dict
    candidate_actions:       list[str]
    mode:                    str   = "standard"
    depth:                   int   = 20       # lookahead depth; capped to remaining turns if session-aware
    iterations:              int   = 80
    context:                 str   = ""
    flooding_target_stress:  float = 0.7
    current_turn:            int   = 0        # current turn index in the session (0-based)
    max_turns:               int   = 0        # 0 = no cap (backward-compat); set to session length for capping
    # Multi-user: pass all participants' physio states; MCTS uses mean-weighted aggregate
    participants:            list[dict] = []  # [{agent_id, physio_state, weight}]; empty = single-user
    # HP+VOOT+PW mode: pass "hpvoot" to use HierarchicalPWVOOTMCTS
    mcts_mode:               str   = "standard"  # "standard" | "hpvoot"
    # LLM prior scores: caller-supplied scores over all actions in same order as
    # candidate_actions.  Required when mcts_mode="hpvoot".  Length must match
    # candidate_actions.  If omitted for hpvoot, CALMING_WEIGHT heuristic is used.
    llm_prior_scores:        list[float] = []


@app.post("/mcts/best-action")
def mcts_best_action(req: MCTSActionIn):
    """
    Run DialogMCTS and return the best action + Q-value + tree stats + M_trunc.

    Session-aware lookahead: if max_turns > 0, effective depth is capped to
    (max_turns - current_turn) so the search never simulates beyond session end.

    Multi-user: if participants is non-empty, physio_state is replaced by a
    weighted mean across all participants before MCTS (V_int coupling pre-step).
    """
    from tensornets.mcts.base import DialogMCTS

    # ── Multi-user physio aggregation ─────────────────────────────────────────
    if req.participants:
        # Weighted mean across participants; default weight=1.0 if not specified
        total_w  = sum(p.get('weight', 1.0) for p in req.participants)
        agg: dict = {}
        for field in ('stress_index', 'hrv_ms', 'eda_us', 'sleep_deficit', 'glucose_mg_dl'):
            vals = [p['physio_state'].get(field, 0.5 if field == 'stress_index' else 35.0)
                    * p.get('weight', 1.0) for p in req.participants]
            agg[field] = sum(vals) / total_w
        physio_state = {**req.physio_state, **agg}
    else:
        physio_state = req.physio_state

    # ── Session-aware lookahead cap ───────────────────────────────────────────
    effective_depth = req.depth
    if req.max_turns > 0:
        remaining = max(1, req.max_turns - req.current_turn)
        effective_depth = min(req.depth, remaining)

    stress_index = physio_state.get('stress_index', 0.5)
    hrv_ms       = physio_state.get('hrv_ms', 35.0)

    initial_state = {
        'physio':                    physio_state,
        'hrv_ms':                    hrv_ms,
        'stress_index':              stress_index,
        'turn':                      req.current_turn,
        'mode':                      req.mode,
        'candidate_actions':         req.candidate_actions,
        'context':                   req.context,
        'flooding_target_stress':    req.flooding_target_stress,
    }

    if req.mcts_mode == "hpvoot":
        from tensornets.mcts.hierarchical_pw_voot import HierarchicalPWVOOTMCTS
        from tensornets.a3c.action_bandit import CALMING_WEIGHT

        # Build llm_prior_fn: use caller-supplied scores if provided, else
        # fall back to CALMING_WEIGHT heuristic (zone-adjusted).
        if req.llm_prior_scores and len(req.llm_prior_scores) == len(req.candidate_actions):
            score_map = dict(zip(req.candidate_actions, req.llm_prior_scores))
            def llm_prior_fn(actions: list, state: dict) -> list:
                return [score_map.get(a, 0.0) for a in actions]
        else:
            # Heuristic prior: CALMING_WEIGHT adjusted by current stress
            si = stress_index
            def llm_prior_fn(actions: list, state: dict) -> list:  # type: ignore[misc]
                scores = []
                for a in actions:
                    cw = CALMING_WEIGHT.get(a, 0.5)
                    # Under high stress prefer calming; under low stress prefer activating
                    score = cw * si + (1.0 - cw) * (1.0 - si)
                    scores.append(score)
                return scores

        mcts = HierarchicalPWVOOTMCTS(
            llm_prior_fn=llm_prior_fn,
            mode=req.mode,
            iterations=req.iterations,
            max_depth=effective_depth,
        )
    else:
        mcts = DialogMCTS(
            mode=req.mode,
            iterations=req.iterations,
            max_depth=effective_depth,
        )

    result = mcts.best_action(initial_state)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Multi-session endpoints
# ─────────────────────────────────────────────────────────────────────────────

_session_manager = None

def _get_session_manager():
    global _session_manager
    if _session_manager is None:
        from tensornets.agents.session_manager import SessionManager
        _session_manager = SessionManager(state_dir="state/subjects")
    return _session_manager


class SessionOpenIn(BaseModel):
    subject_id:          str
    therapeutic_mode:    str       = "standard"
    deaddiction_phase:   str       = "behaviour_change_rapport"
    session_goal:        str       = ""
    stacked_topic_ids:   list[str] = []
    agents:              list[dict]= []   # Phase 4 SharedTensorBuffer: [{agent_id, role}, ...]
    circle_id:           str       = ""  # care circle ID for hysteretic alliance persistence


class SessionCloseIn(BaseModel):
    subject_id: str
    final_stress: float
    rapport_score: float = 0.0
    secret_detected: bool = False
    secret_detail: str = ""
    goal_achieved: bool = False


class TensorUpdateIn(BaseModel):
    """Phase 4: update one agent's HRV in the shared buffer and propagate V_int."""
    session_id:  str
    agent_id:    str
    hrv_ms:      float
    apply_vint:  bool = True   # propagate to other agents via V_int


class SharedStateQueryIn(BaseModel):
    """Phase 4: query the shared buffer for consistency hint or HRV summary."""
    session_id: str
    requesting_agent_id: str = ""


@app.post("/session/open")
def session_open(req: SessionOpenIn):
    """
    Open a tensornets session when a user comes online.

    TOPIC STACKING: The JS future_plans DB is the authority on stacked long-running
    topics. This endpoint receives the pending topic IDs (stacked_topic_ids) from
    the JS caller and uses them to weight the MCTS reward (e.g., prioritise
    behaviour_change_action over rapport-building if multiple topics are stacked).
    The Python layer does NOT manage the stack — it reads it.

    Returns session_id + longitudinal MCTS hint + Phase 4 SharedTensorBuffer info.
    """
    mgr = _get_session_manager()
    perm = mgr.check_contact_permission(req.subject_id)
    session = mgr.open_session(
        req.subject_id, req.therapeutic_mode, req.deaddiction_phase, req.session_goal
    )
    hint = mgr.longitudinal_mcts_hint(req.subject_id)

    # Adjust MCTS weights if stacked topics suggest urgency
    stacked_mode_hint = None
    if req.stacked_topic_ids:
        n = len(req.stacked_topic_ids)
        stacked_mode_hint = (
            f"{n} stacked topic(s) pending. MCTS goal_progress weight elevated. "
            f"Prioritise session_goal={req.session_goal!r} then surface next pending topic."
        )

    # Phase 4: create shared tensor buffer for this session
    buf_info = None
    if req.agents:
        try:
            from tensornets.agents.shared_tensor_state import open_shared_buffer
            open_shared_buffer(
                session.session_id,
                req.agents,
                circle_id=req.circle_id or req.subject_id or None,
            )
            buf_info = {"agents": [a['agent_id'] for a in req.agents]}
        except Exception as e:
            buf_info = {"error": str(e)}

    return {
        "session_id":                  session.session_id,
        "contact_permitted":           perm['permitted'],
        "contact_reason":              perm.get('reason', ''),
        "recommended_phase":           hint['recommended_phase'],
        "recommended_mode":            hint['recommended_mode'],
        "longitudinal_rationale":      hint['rationale'],
        "readiness_score":             hint['readiness_score'],
        "sessions_until_flooding":     hint.get('sessions_until_ready_for_flooding'),
        "stacked_topics_hint":         stacked_mode_hint,
        "stacked_topic_count":         len(req.stacked_topic_ids),
        "shared_buffer":               buf_info,
    }


@app.post("/session/close")
def session_close(req: SessionCloseIn):
    """Close a session when user goes offline. Persists longitudinal state."""
    mgr = _get_session_manager()
    active = mgr._active.get(req.subject_id)
    if not active:
        raise HTTPException(status_code=404, detail="No active session for subject")
    updated = mgr.close_session(
        active,
        final_stress=req.final_stress,
        rapport_score=req.rapport_score,
        secret_detected=req.secret_detected,
        secret_detail=req.secret_detail,
        goal_achieved=req.goal_achieved,
    )
    # Phase 4: close shared tensor buffer
    try:
        from tensornets.agents.shared_tensor_state import close_shared_buffer
        close_shared_buffer(active.session_id)
    except Exception:
        pass

    return {
        "subject_id": req.subject_id,
        "session_count": updated.session_count,
        "alliance": updated.alliance,
        "deaddiction_phase": updated.deaddiction_phase,
        "readiness_score": updated.readiness_score,
    }


@app.post("/session/tensor/update")
def session_tensor_update(req: TensorUpdateIn):
    """
    Phase 4 (G1/G3): Update one agent's HRV in the shared buffer.
    Propagates HRV delta to other agents via V_int social coupling matrix.
    Returns updated HRV summary for all agents in the session.
    """
    try:
        from tensornets.agents.shared_tensor_state import get_shared_buffer
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e))

    buf = get_shared_buffer(req.session_id)
    if buf is None:
        raise HTTPException(status_code=404,
                            detail=f"No shared buffer for session {req.session_id!r}. "
                                    "Open session first with /session/open and provide agents list.")
    delta = buf.put_mps(req.agent_id, mps=None, hrv_ms=req.hrv_ms)
    v_int_updates = {}
    if req.apply_vint:
        v_int_updates = buf.v_int_propagate(req.agent_id, new_hrv_ms=req.hrv_ms)

    return {
        "session_id":       req.session_id,
        "agent_id":         req.agent_id,
        "hrv_ms":           req.hrv_ms,
        "hrv_delta":        round(delta, 2),
        "v_int_updates":    v_int_updates,
        "hrv_summary":      buf.get_hrv_summary(),
        "consistency_hint": buf.consistency_hint(),
    }


@app.post("/session/tensor/summary")
def session_tensor_summary(req: SharedStateQueryIn):
    """
    Phase 4 (G2): Return HRV summary and consistency hint for the session.
    Used by CompanionCoordinator before generating each response.
    """
    try:
        from tensornets.agents.shared_tensor_state import get_shared_buffer
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e))

    buf = get_shared_buffer(req.session_id)
    if buf is None:
        return {"session_id": req.session_id, "status": "no_buffer",
                "hrv_summary": {}, "consistency_hint": ""}

    return {
        "session_id":       req.session_id,
        "hrv_summary":      buf.get_hrv_summary(),
        "consistency_hint": buf.consistency_hint(),
    }


@app.get("/session/hint/{subject_id}")
def session_longitudinal_hint(subject_id: str):
    """Return longitudinal MCTS recommendation for next session."""
    mgr = _get_session_manager()
    return mgr.longitudinal_mcts_hint(subject_id)


# ─────────────────────────────────────────────────────────────────────────────
# BENCHMARK RECORDING ENDPOINTS
# The DB (via JS bridge) is the source of truth.
# These endpoints are called by comparison_runner.py and benchmarks/runner.py.
# ─────────────────────────────────────────────────────────────────────────────

class BenchmarkRunIn(BaseModel):
    arm:          str               # 'htn_mcts' | 'oldschool' | 'hysteresis_prompt'
    label:        str = ""
    scenario_set: str = "canonical"
    config:       dict = {}


class BenchmarkEpisodeIn(BaseModel):
    run_id:      str
    scenario_id: str
    persona_id:  str = ""
    arm:         str


class BenchmarkTurnIn(BaseModel):
    episode_id:    str
    run_id:        str
    arm:           str
    turn_number:   int
    action:        str = ""
    response:      str = ""
    hrv_ms:        float | None = None
    stress_label:  str = ""
    stress_index:  float | None = None
    reward:        dict = {}    # {stress, trust, goal, info, consistency}
    judge:         dict = {}    # {clinical, empathy, safety, goal, strategy}
    linguistic_stress: float | None = None
    discrepancy_flag:  bool = False
    tokens_scout:   int = 0
    tokens_maverick: int = 0
    latency_ms:     int | None = None


class BenchmarkFinaliseIn(BaseModel):
    run_id:      str | None = None
    episode_id:  str | None = None
    metrics:     dict = {}


class BenchmarkQueryIn(BaseModel):
    scenario_set: str = ""
    arm:          str = ""
    limit:        int = 50


def _get_benchmark_url() -> str:
    """URL of the JS server for benchmark DB writes."""
    import os
    return os.environ.get('JS_SERVER_URL', 'http://localhost:8247')


def _post_to_js(path: str, payload: dict) -> dict:
    """
    Forward a benchmark record to the JS server which writes to the shared DB.
    This avoids duplicating SQLite logic in Python — the JS layer owns the DB.
    Falls back gracefully if JS server is not running.
    """
    import urllib.request, json as _json
    url = _get_benchmark_url() + path
    data = _json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data,
                                  headers={'Content-Type': 'application/json'},
                                  method='POST')
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return _json.loads(resp.read())
    except Exception as e:
        return {'error': str(e), 'stored': False}


@app.post("/benchmark/run/create")
def benchmark_run_create(req: BenchmarkRunIn):
    """
    Create a benchmark run record in the DB (via JS bridge).
    Called at the start of benchmarks/runner.py or comparison_runner.py.
    Returns run_id.
    """
    result = _post_to_js('/api/benchmarks/run', req.model_dump())
    return result


@app.post("/benchmark/run/finalise")
def benchmark_run_finalise(req: BenchmarkFinaliseIn):
    """Finalise a benchmark run with aggregate metrics."""
    result = _post_to_js('/api/benchmarks/run/finalise',
                          {'run_id': req.run_id, **req.metrics})
    return result


@app.post("/benchmark/episode/create")
def benchmark_episode_create(req: BenchmarkEpisodeIn):
    """Create an episode record. Called at the start of each episode."""
    result = _post_to_js('/api/benchmarks/episode', req.model_dump())
    return result


@app.post("/benchmark/episode/finalise")
def benchmark_episode_finalise(req: BenchmarkFinaliseIn):
    """Finalise an episode with aggregate metrics."""
    result = _post_to_js('/api/benchmarks/episode/finalise',
                          {'episode_id': req.episode_id, **req.metrics})
    return result


@app.post("/benchmark/turn")
def benchmark_turn(req: BenchmarkTurnIn):
    """
    Record one turn. This is the per-turn equivalent of the jsonl log —
    stored in htn_benchmark_turns via the JS DB bridge.
    """
    payload = req.model_dump()
    payload.update(req.reward)   # flatten reward dict into top-level fields
    payload.update({f'judge_{k}': v for k, v in req.judge.items()})
    result = _post_to_js('/api/benchmarks/turn', payload)
    return result


@app.post("/benchmark/query")
def benchmark_query(req: BenchmarkQueryIn):
    """
    Query benchmark comparison data.
    Returns arm-level aggregates for a scenario set.
    """
    result = _post_to_js('/api/benchmarks/compare',
                          {'scenario_set': req.scenario_set,
                           'arm': req.arm, 'limit': req.limit})
    return result


# ─────────────────────────────────────────────────────────────────────────────
# LLM passthrough endpoints — used by A3C arms, scorer, and synthetic_patient
#
# POST /llm/scout    → Llama 4 Scout  (fast, cheap, bulk generation)
# POST /llm/maverick → Llama 4 Maverick (higher quality, value/judge)
#
# Request:  { "system": str, "prompt": str, "max_tokens": int }
# Response: { "text": str, "input_tokens": int, "output_tokens": int }
# ─────────────────────────────────────────────────────────────────────────────

_LLM_MODELS = {
    "scout":    "us.meta.llama4-scout-17b-instruct-v1:0",
    "maverick": "us.meta.llama4-maverick-17b-instruct-v1:0",
}

# ── Concurrency pool ──────────────────────────────────────────────────────────
# With 8 arms × 2 workers = up to ~20 simultaneous in-flight Bedrock calls,
# the per-account concurrency limit gets hit and returns 502 throttling errors.
# A semaphore caps active calls so excess requests wait in-thread rather than
# firing immediately and failing.  Scout and Maverick share one pool because
# they compete for the same account-level quota.
# Set BEDROCK_MAX_CONCURRENT env var to tune (default 8).
_MAX_BEDROCK_CONCURRENT = int(os.environ.get("BEDROCK_MAX_CONCURRENT", "8"))
_bedrock_semaphore      = threading.Semaphore(_MAX_BEDROCK_CONCURRENT)

# ── Reusable boto3 clients (one per region) ───────────────────────────────────
# Creating a new client per call re-reads credentials and re-establishes the
# TCP connection pool on every request.  One client per region is reused instead.
_bedrock_clients: dict = {}
_bedrock_clients_lock  = threading.Lock()

def _get_bedrock_client(region: str):
    """Return (lazily created) reusable boto3 bedrock-runtime client."""
    try:
        import boto3 as _boto3
    except ImportError:
        raise HTTPException(status_code=500, detail="boto3 not installed")
    with _bedrock_clients_lock:
        if region not in _bedrock_clients:
            _bedrock_clients[region] = _boto3.client("bedrock-runtime", region_name=region)
        return _bedrock_clients[region]


class LLMRequestIn(BaseModel):
    system:     str = ""
    prompt:     str
    max_tokens: int = 512
    temperature: float = 0.7


def _call_bedrock_llm(model_key: str, system: str, prompt: str,
                      max_tokens: int, temperature: float) -> dict:
    region   = os.environ.get("AWS_REGION", "us-east-1")
    model_id = _LLM_MODELS.get(model_key, _LLM_MODELS["scout"])
    client   = _get_bedrock_client(region)

    messages    = [{"role": "user", "content": [{"text": prompt}]}]
    system_list = [{"text": system}] if system else []
    kwargs: dict = {
        "modelId":         model_id,
        "messages":        messages,
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    if system_list:
        kwargs["system"] = system_list

    # Acquire pool slot — blocks until a slot is free rather than firing
    # immediately and hitting the Bedrock concurrency limit.
    with _bedrock_semaphore:
        last_exc: Exception | None = None
        for attempt in range(4):
            try:
                response       = client.converse(**kwargs)
                content_blocks = response["output"]["message"]["content"]
                if not content_blocks:
                    raise ValueError("Bedrock returned empty content block list")
                text  = content_blocks[0]["text"]
                usage = response.get("usage", {})
                return {
                    "text":          text,
                    "input_tokens":  usage.get("inputTokens",  0),
                    "output_tokens": usage.get("outputTokens", 0),
                }
            except Exception as exc:
                last_exc = exc
                exc_name = type(exc).__name__
                is_throttle = (
                    "Throttling" in exc_name
                    or "TooManyRequests" in exc_name
                    or "throttling" in str(exc).lower()
                    or "empty content" in str(exc).lower()
                )
                if is_throttle and attempt < 3:
                    import random as _random
                    wait = (2 ** attempt + 1) + _random.uniform(-0.5, 0.5)
                    log.warning(
                        "Bedrock throttled (%s), retrying in %.1fs (attempt %d/4)",
                        model_key, wait, attempt + 1,
                    )
                    time.sleep(wait)
                else:
                    break

    log.error("Bedrock %s call failed: %s", model_key, last_exc)
    raise HTTPException(status_code=502, detail=f"Bedrock error: {last_exc}")


@app.post("/llm/scout")
def llm_scout(req: LLMRequestIn):
    """
    Llama 4 Scout passthrough — used by A3C arms (response generation),
    A3CScorer (inline reward), and SyntheticPatient (patient turn generation).
    """
    return _call_bedrock_llm("scout", req.system, req.prompt, req.max_tokens, req.temperature)


@app.post("/llm/maverick")
def llm_maverick(req: LLMRequestIn):
    """
    Llama 4 Maverick passthrough — used by A3C Critic value estimation
    and offline HTN judge batch runs.
    """
    return _call_bedrock_llm("maverick", req.system, req.prompt, req.max_tokens, req.temperature)


# ── RL Shadow Mode: A3C action endpoint ──────────────────────────────────────
# Called by training/rl_shadow.js in shadow mode.
# Takes a state dict, asks the trained A3C actor for an action, returns a
# structured response without affecting production output.

# ── Predictive Escalation endpoint ───────────────────────────────────────────
# Called by Python worker.py at each turn to get the DRI and escalation tier.
# Pure computation — does not call LLM.

class PredictiveEscalationIn(BaseModel):
    hrv_history:              list[float] = []
    stress_score:             float       = 0.0
    sleep_quality:            float       = 1.0
    medication_adherence:     float       = 1.0
    consecutive_stress_turns: int         = 0


@app.post("/physio/predict-escalation")
def physio_predict_escalation(req: PredictiveEscalationIn):
    """
    Compute Deterioration Risk Index (DRI) from physiological signals.

    Returns:
        dri        float  — composite risk score [0..1]
        tier       str    — NO_ACTION | SOFT_CHECKIN | PROACTIVE_SUPPORT | CLINICAL_ALERT | IMMEDIATE_ESCALATION
        reasons    list   — human-readable reasons for the tier
        components dict   — per-signal contribution scores
    """
    try:
        from tensornets.physio.predictive_escalation import compute_dri
        result = compute_dri(
            hrv_history              = req.hrv_history,
            stress_score             = req.stress_score,
            sleep_quality            = req.sleep_quality,
            medication_adherence     = req.medication_adherence,
            consecutive_stress_turns = req.consecutive_stress_turns,
        )
        return result
    except ImportError:
        # Fallback: simple threshold-based tier
        current_hrv = req.hrv_history[-1] if req.hrv_history else 35.0
        if req.stress_score > 0.85 or current_hrv < 15:
            return {"dri": 0.90, "tier": "IMMEDIATE_ESCALATION", "reasons": ["stress>0.85 or hrv<15 (fallback)"], "components": {}}
        if req.stress_score > 0.70 or current_hrv < 22:
            return {"dri": 0.72, "tier": "CLINICAL_ALERT", "reasons": ["stress>0.70 or hrv<22 (fallback)"], "components": {}}
        if req.stress_score > 0.55:
            return {"dri": 0.52, "tier": "PROACTIVE_SUPPORT", "reasons": ["stress>0.55 (fallback)"], "components": {}}
        return {"dri": 0.10, "tier": "NO_ACTION", "reasons": [], "components": {}}
    except Exception as exc:
        return {"dri": 0.0, "tier": "NO_ACTION", "reasons": [f"error: {exc}"], "components": {}}


class ShadowActionIn(BaseModel):
    arm:      str  = "inertial_mcts"
    state:    dict = {}
    physio:   dict = {}
    turn_idx: int  = 0


@app.post("/session/a3c/action")def session_a3c_action(req: ShadowActionIn):
    """
    Shadow mode: evaluate the A3C actor for arm `req.arm` on the given state.

    Returns:
        action_label    str   — action classification (ACKNOWLEDGE/INFORM/QUESTION/COMMIT/ESCALATE)
        value_estimate  float — critic's state-value estimate
        response_text   str   — (optional) short LLM-generated response draft (only if LLM available)
        arm             str   — the arm that was evaluated

    If the arm is not loaded (no active training), returns {available: false}.
    This endpoint is non-blocking for production — errors return gracefully.
    """
    try:
        # Lazy import: only the training arm registry is needed here
        from tensornets.a3c.arms import _ARM_REGISTRY  # populated during training init

        arm_entry = _ARM_REGISTRY.get(req.arm)
        if arm_entry is None:
            return {"available": False, "arm": req.arm, "reason": "arm not loaded"}

        actor  = arm_entry.get("actor")
        critic = arm_entry.get("critic")
        if actor is None:
            return {"available": False, "arm": req.arm, "reason": "actor not loaded"}

        # Build a minimal TurnState from the incoming dict
        from tensornets.a3c.worker import TurnState
        try:
            state = TurnState(**{k: req.state.get(k, v)
                                 for k, v in TurnState.__dataclass_fields__.items()})
        except Exception:
            state = TurnState()  # fallback to defaults

        import torch
        with torch.no_grad():
            state_tensor = actor.encode_state(state)
            action_probs = actor(state_tensor)
            action_idx   = int(action_probs.argmax(-1).item())
            value_est    = float(critic(state_tensor).item())

        # Map action index to label
        action_labels = ["ACKNOWLEDGE", "INFORM", "QUESTION", "COMMIT", "ESCALATE"]
        action_label  = action_labels[action_idx] if action_idx < len(action_labels) else "INFORM"

        return {
            "available":      True,
            "arm":            req.arm,
            "action_label":   action_label,
            "action_idx":     action_idx,
            "value_estimate": round(value_est, 4),
            "response_text":  None,   # text generation skipped in shadow mode (latency)
        }

    except ImportError:
        return {"available": False, "arm": req.arm, "reason": "ARM_REGISTRY not initialised (training not active)"}
    except Exception as exc:
        import traceback
        return {"available": False, "arm": req.arm, "reason": str(exc),
                "trace": traceback.format_exc(limit=5)}

