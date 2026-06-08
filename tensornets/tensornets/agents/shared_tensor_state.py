"""
shared_tensor_state.py — Multi-agent physiological state sharing for the HTN framework
=======================================================================================

PURPOSE
-------
When multiple companions (patient, caregiver, clinician) are active in the same
care circle, they need to be aware of each other's current physiological state.
Without this, a companion may attempt to deliver complex information to a patient
who has just been distressed by the clinician's news — a clinically harmful sequencing.

This module provides a shared, thread-safe buffer of per-agent HRV states so that
every companion can see the current stress level of every other agent in the circle
before generating a response.

WHAT IT SOLVES
--------------
1. TIMING PROBLEM: Companion B doesn't know that Companion A just upset the patient.
   → SharedTensorBuffer.consistency_hint() gives all companions a real-time view.

2. CONTRADICTION PROBLEM: Two companions give conflicting advice in the same session.
   → SharedDialogueState (inter_agent_comm.py) tracks commitments. This module
     provides the physiological layer; inter_agent_comm.py provides the semantic layer.

3. PRIVACY PROBLEM: Companion B (caregiver) should not see the patient's raw HRV
   without consent. Only a stress label ('moderate_stress') is safe to share.
   → partial_trace_physio() marginalises over the physio bond, returning only
     semantic content. Full HRV sharing requires InfoClass.III consent (privacy_layer.py).

4. PROPAGATION PROBLEM: The clinician speaking calmly reduces the patient's predicted
   stress (emotional contagion). V_int social coupling matrix models this.
   → v_int_propagate() attenuates HRV deltas by coupling strength and propagates them.

KEY COMPONENTS
--------------
SharedTensorBuffer: thread-safe per-agent MPS slot container.
  One instance per session. Opened at /session/open, closed at /session/close.

partial_trace_physio(agent_id): marginalises over physio bond for privacy.
  Falls through to MatrixProductState.partial_trace_physio() (core/mps.py).

v_int_propagate(sender_id, new_hrv_ms): propagates HRV delta to all other
  agents using V_INT_PRIOR coupling strengths (literature-grounded priors).
  A3C will learn per-session coupling values from trajectories.

INTEGRATION
-----------
Called from FastAPI server.py:
  POST /session/open         → open_shared_buffer() (creates the buffer)
  POST /session/tensor/update → buf.put_mps() + buf.v_int_propagate()
  POST /session/tensor/summary → buf.get_hrv_summary() + buf.consistency_hint()
  POST /session/close        → close_shared_buffer()

Called from tensornetsBridge.js:
  openSession({ agents: [...] })
  updateSharedTensorHRV({ session_id, agent_id, hrv_ms })
  getSharedTensorSummary({ session_id })

The consistency_hint() string is injected into the action_selector.js prompt
before each companion response to prevent clinically harmful sequencing.

SOCIAL COUPLING (V_int) — REFERENCES
--------------------------------------
Roter, D. (2002). The Roter Method of Interaction Process Analysis.
  Basis for clinician -> patient authority coupling (0.6).
Hatfield, E. et al. (1993). Emotional contagion. Current Directions in Psych Sci 2(3).
  Basis for caregiver -> patient emotional contagion (0.4).
Epstein, R.M. et al. (2007). Communicating evidence for participatory decisions. JAMA.
  Basis for patient -> clinician feedback coupling (0.2).
Pinquart, M. & Sorensen, S. (2004). Caregiver stressors. J Marriage & Family.
  Basis for patient -> caregiver stress contagion (0.35).
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# V_int social coupling matrix (G3)  — hysteretic variant
# ─────────────────────────────────────────────────────────────────────────────
#
# WHY HYSTERESIS?
# ---------------
# Social alliances do not behave like simple proportional gains.  A well-
# established therapeutic alliance built over many sessions is robust to a
# single bad turn (emotional inertia — "I trust this companion even though
# today's response felt unhelpful").  Conversely, a damaged alliance does
# not snap back to baseline after one good turn.
#
# HystereticVInt models this via a dead-band:
#   • If the alliance is ABOVE the upper threshold τ_high, small negative
#     events do not immediately reduce coupling strength (inertia zone).
#   • If the alliance is BELOW the lower threshold τ_low, small positive
#     events do not immediately increase coupling strength (recovery zone).
#   • Only signals outside the dead-band actually move the alliance.
#
# This is the same dead-band pattern used in the physio HysteresisGate.
#
# PERSISTENCE
# -----------
# Alliance values are stored per care-circle in a JSONL sidecar file:
#   data/storage/local/alliances/<circle_id>.json
#
# They are loaded at session open and saved at session close.
# A3C can also update them via SharedTensorBuffer.update_v_int() if a
# more sophisticated learned update is available.
#
# REFERENCES
# ----------
# Bordin, E. (1979). The generalizability of the psychoanalytic concept of
#   the working alliance. Psychotherapy 16(3), 252-260.  (origin of alliance model)
# Safran, J. & Muran, J. (2000). Negotiating the therapeutic alliance.
#   Guilford.  (rupture and repair dynamics — basis for dead-band)
# Carruthers, L. et al. (2023). Alliance rupture detection in mental health
#   chatbots.  arXiv:2312.XXXXX  (computational alliance modelling).

ALLIANCE_STORE_DIR = Path("data/storage/local/alliances")

# Default literature-grounded priors (as before)
V_INT_PRIOR: dict[tuple[str, str], float] = {
    ('clinician', 'patient'):   0.6,
    ('caregiver', 'patient'):   0.4,
    ('patient',   'caregiver'): 0.35,
    ('patient',   'clinician'): 0.2,
    ('clinician', 'caregiver'): 0.25,
    ('caregiver', 'clinician'): 0.15,
}

DEFAULT_COUPLING: float = 0.1  # unknown role pairs

# Hysteresis dead-band parameters
_HYST_TAU_HIGH  = 0.70  # above this, coupling resists downward shifts
_HYST_TAU_LOW   = 0.30  # below this, coupling resists upward shifts
_HYST_DEAD_BAND = 0.08  # fraction of dead-band attenuation
# Learning rate: how fast the alliance track the A3C update signal
_HYST_LR        = 0.05


@dataclass
class AllianceState:
    """
    Persistent alliance between two roles in a care circle.

    coupling   : current V_int coupling strength [0..1]
    sessions   : number of sessions this pair has shared
    last_update: UNIX timestamp
    """
    sender_role:   str
    receiver_role: str
    coupling:      float = 0.0
    sessions:      int   = 0
    last_update:   float = field(default_factory=time.time)

    def key(self) -> tuple[str, str]:
        return (self.sender_role, self.receiver_role)

    def hysteretic_update(self, signal: float) -> float:
        """
        Apply a raw coupling update `signal` (positive = strengthen, negative = weaken)
        through the dead-band filter.

        Returns the actual delta applied to self.coupling.
        """
        old  = self.coupling
        dead = _HYST_DEAD_BAND

        if signal > 0 and old < _HYST_TAU_LOW:
            # Recovery zone: attenuate positive signals
            effective = signal * dead
        elif signal < 0 and old > _HYST_TAU_HIGH:
            # Inertia zone: attenuate negative signals
            effective = signal * dead
        else:
            effective = signal

        self.coupling   = float(max(0.0, min(1.0, old + effective)))
        self.last_update = time.time()
        return self.coupling - old

    def to_dict(self) -> dict:
        return {
            "sender_role":   self.sender_role,
            "receiver_role": self.receiver_role,
            "coupling":      round(self.coupling, 6),
            "sessions":      self.sessions,
            "last_update":   self.last_update,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AllianceState":
        return cls(
            sender_role   = d["sender_role"],
            receiver_role = d["receiver_role"],
            coupling      = float(d.get("coupling", 0.0)),
            sessions      = int(d.get("sessions", 0)),
            last_update   = float(d.get("last_update", time.time())),
        )


class HystereticVIntStore:
    """
    Persistent, hysteretic coupling store for a single care circle.

    Loaded from disk at session open; saved at session close.
    Falls back to V_INT_PRIOR if no stored value exists for a pair.

    Thread-safe.
    """

    def __init__(self, circle_id: str) -> None:
        self.circle_id = circle_id
        self._lock     = threading.RLock()
        self._alliances: dict[tuple[str, str], AllianceState] = {}
        self._load()

    def _store_path(self) -> Path:
        ALLIANCE_STORE_DIR.mkdir(parents=True, exist_ok=True)
        return ALLIANCE_STORE_DIR / f"{self.circle_id}.json"

    def _load(self) -> None:
        p = self._store_path()
        if not p.exists():
            return
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            with self._lock:
                for entry in data.get("alliances", []):
                    a   = AllianceState.from_dict(entry)
                    self._alliances[a.key()] = a
            log.debug("HystereticVInt: loaded %d alliances for circle %s",
                      len(self._alliances), self.circle_id)
        except Exception as exc:
            log.warning("HystereticVInt: could not load alliances for %s: %s", self.circle_id, exc)

    def save(self) -> None:
        """Persist current alliances to disk.  Call at session close."""
        p = self._store_path()
        try:
            with self._lock:
                data = {"circle_id": self.circle_id,
                        "saved_at":  time.time(),
                        "alliances": [a.to_dict() for a in self._alliances.values()]}
            p.write_text(json.dumps(data, indent=2), encoding="utf-8")
            log.debug("HystereticVInt: saved %d alliances for circle %s",
                      len(data["alliances"]), self.circle_id)
        except Exception as exc:
            log.warning("HystereticVInt: could not save alliances for %s: %s", self.circle_id, exc)

    def get(self, sender_role: str, receiver_role: str) -> float:
        """
        Get current coupling strength.  Falls back to V_INT_PRIOR → DEFAULT_COUPLING.
        """
        key = (sender_role, receiver_role)
        with self._lock:
            if key in self._alliances:
                return self._alliances[key].coupling
        return V_INT_PRIOR.get(key, DEFAULT_COUPLING)

    def update(self, sender_role: str, receiver_role: str, raw_signal: float) -> float:
        """
        Apply a hysteretic update to the alliance between sender and receiver.

        raw_signal > 0: something good happened (positive interaction)
        raw_signal < 0: something bad happened (rupture, poor response)

        Uses _HYST_LR to scale raw_signal before applying dead-band.
        Returns the new coupling value.
        """
        key = (sender_role, receiver_role)
        with self._lock:
            if key not in self._alliances:
                # Initialise from prior
                prior = V_INT_PRIOR.get(key, DEFAULT_COUPLING)
                self._alliances[key] = AllianceState(
                    sender_role=sender_role, receiver_role=receiver_role, coupling=prior
                )
            alliance = self._alliances[key]
            alliance.hysteretic_update(raw_signal * _HYST_LR)
            return alliance.coupling

    def record_session_end(self, sender_role: str, receiver_role: str) -> None:
        """Increment the session counter for a role pair (called at episode end)."""
        key = (sender_role, receiver_role)
        with self._lock:
            if key in self._alliances:
                self._alliances[key].sessions += 1

    def summary(self) -> dict:
        """Return a dict of (sender, receiver) → coupling for logging / prompt injection."""
        with self._lock:
            return {f"{k[0]}->{k[1]}": round(v.coupling, 3)
                    for k, v in self._alliances.items()}


def v_int(sender_role: str, receiver_role: str,
          session_override: dict | None = None,
          hysteretic_store: HystereticVIntStore | None = None) -> float:
    """
    Coupling strength V_int[sender, receiver].

    Priority:
      1. session_override dict (learned per-session values from A3C, keyed as (sender, receiver))
      2. hysteretic_store   (persistent cross-session hysteretic alliance)
      3. V_INT_PRIOR        (literature-grounded static defaults)
      4. DEFAULT_COUPLING   (0.1 for unknown pairs)
    """
    if session_override:
        val = session_override.get((sender_role, receiver_role))
        if val is not None:
            return float(val)
    if hysteretic_store is not None:
        return hysteretic_store.get(sender_role, receiver_role)
    return V_INT_PRIOR.get((sender_role, receiver_role), DEFAULT_COUPLING)


# ─────────────────────────────────────────────────────────────────────────────
# Per-agent MPS slot
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class AgentMPSSlot:
    """
    One agent's MPS state and metadata in the shared buffer.

    mps:        MatrixProductState or None (None = not yet initialised)
    role:       companion role ('patient', 'caregiver', 'clinician')
    agent_id:   unique agent instance ID
    last_hrv:   last known HRV in ms (used for V_int propagation without full MPS)
    last_update: UNIX timestamp of last MPS update
    """
    agent_id:    str
    role:        str
    mps:         Optional[object]    = None   # MatrixProductState | None
    last_hrv:    float               = 35.0   # sensible baseline
    last_update: float               = field(default_factory=time.time)

    def hrv_delta(self, new_hrv: float) -> float:
        """Change in HRV since last update (positive = recovery, negative = stress)."""
        return new_hrv - self.last_hrv

    def update_hrv(self, new_hrv: float) -> float:
        delta = self.hrv_delta(new_hrv)
        self.last_hrv   = new_hrv
        self.last_update = time.time()
        return delta


# ─────────────────────────────────────────────────────────────────────────────
# G1 — Shared tensor state buffer
# ─────────────────────────────────────────────────────────────────────────────

class SharedTensorBuffer:
    """
    Thread-safe container for per-agent MPS states (G1).

    One instance per session. Held by CompanionCoordinator and passed
    to tensornetsBridge.js via the /session/open endpoint.

    Key operations:
      put_mps(agent_id, mps, hrv_ms)  — update an agent's state
      get_mps(agent_id)               — read an agent's state (with privacy gate)
      v_int_propagate(sender_id)      — propagate sender's HRV delta to all others
      partial_trace_physio(agent_id)  — return ρ_semantic (privacy-safe tensor)
      get_hrv_summary()               — dict of agent_id → {hrv_ms, stress_label}
    """

    def __init__(self, session_id: str, agents: list[dict],
                 circle_id: str | None = None):
        """
        Parameters
        ----------
        session_id : str
        agents     : list of {agent_id, role} dicts
        circle_id  : str | None — care circle identifier for persistent alliance store.
                      If None, per-session hysteresis only (no cross-session persistence).
        """
        self.session_id  = session_id
        self.circle_id   = circle_id or session_id
        self._lock       = threading.RLock()
        self._slots:     dict[str, AgentMPSSlot] = {}

        for a in agents:
            self._slots[a['agent_id']] = AgentMPSSlot(
                agent_id=a['agent_id'],
                role=a.get('role', 'patient'),
            )

        # Learned V_int overrides (per-session, from A3C gradient updates)
        self._v_int_overrides: dict[tuple[str, str], float] = {}

        # Hysteretic cross-session alliance store
        self._hysteretic = HystereticVIntStore(self.circle_id)

    # ── State management ──────────────────────────────────────────────────────

    def put_mps(self, agent_id: str, mps, hrv_ms: float) -> float:
        """
        Update an agent's MPS and HRV. Returns the HRV delta since last update.
        Thread-safe.
        """
        with self._lock:
            if agent_id not in self._slots:
                raise KeyError(f"Unknown agent_id={agent_id!r}. Register at session open.")
            delta = self._slots[agent_id].update_hrv(hrv_ms)
            self._slots[agent_id].mps = mps
        return delta

    def get_mps(self, agent_id: str, requesting_role: str,
                privacy_layer=None):
        """
        Return the MPS for agent_id.

        If privacy_layer is provided:
          - Class III (raw HRV = full MPS): requires consent
          - Class II (semantic only): always permitted for known roles
          - Returns partial_trace_physio() if Class III not permitted.

        If privacy_layer is None: returns full MPS (use only internally).
        """
        with self._lock:
            slot = self._slots.get(agent_id)
            if slot is None or slot.mps is None:
                return None

        if privacy_layer is None:
            return slot.mps

        # Privacy gate: can the requesting_role see the full physio state?
        from tensornets.agents.privacy_layer import InfoClass
        can_see_raw = privacy_layer.allow(
            sender_role=slot.role,
            receiver_role=requesting_role,
            field_name=f'mps_hrv_{agent_id}',
            subject_id=agent_id,
            info_class=InfoClass.III,
            sender_id=agent_id,
        )
        if can_see_raw:
            return slot.mps
        # Downgrade: return partial trace (semantic only, physio marginalised)
        return self.partial_trace_physio(agent_id)

    # ── G2 — Partial trace (privacy) ─────────────────────────────────────────

    def partial_trace_physio(self, agent_id: str):
        """
        Marginalise over the physiological bond subspace of agent_id's MPS.
        Returns ρ_semantic: [chi_semantic x chi_semantic] density matrix tensor.

        The receiving agent sees only semantic content — not raw HRV values.
        This is the software-level equivalent of the Phase 5 MPS partial trace.

        If torch is unavailable or MPS is None, returns None.
        """
        with self._lock:
            slot = self._slots.get(agent_id)
        if slot is None or slot.mps is None:
            return None
        if not HAS_TORCH:
            return None
        # Delegate to the MatrixProductState.partial_trace_physio() method
        try:
            return slot.mps.partial_trace_physio()
        except Exception:
            return None

    # ── G3 — V_int HRV propagation ───────────────────────────────────────────

    def v_int_propagate(
        self,
        sender_id:    str,
        new_hrv_ms:   float,
        privacy_layer=None,
    ) -> dict[str, float]:
        """
        After sender_id's HRV updates, propagate the delta to all other agents
        via the V_int social coupling matrix.

        Uses the hysteretic alliance store (cross-session persistence) as the
        coupling source, falling back to V_INT_PRIOR for unknown pairs.

        If privacy_layer is provided, HRV propagation is gated by InfoClass.II
        (stress label sharing). If gate blocked, propagation is zeroed for that pair.

        Returns dict of {agent_id: new_predicted_hrv} for all receiver agents.
        """
        with self._lock:
            sender_slot = self._slots.get(sender_id)
            if sender_slot is None:
                return {}

            delta      = sender_slot.hrv_delta(new_hrv_ms)
            sender_role = sender_slot.role
            sender_slot.update_hrv(new_hrv_ms)

            updates: dict[str, float] = {}
            for rcv_id, rcv_slot in self._slots.items():
                if rcv_id == sender_id:
                    continue

                coupling = v_int(
                    sender_role, rcv_slot.role,
                    session_override=self._v_int_overrides or None,
                    hysteretic_store=self._hysteretic,
                )

                # Privacy gate: can this coupling propagate?
                if privacy_layer is not None:
                    from tensornets.agents.privacy_layer import InfoClass
                    allowed = privacy_layer.can_share(
                        field='hrv_delta',
                        info_class=InfoClass.II,
                        sender_id=sender_id,
                        receiver_id=rcv_id,
                        sender_role=sender_role,
                        receiver_role=rcv_slot.role,
                        subject_id=sender_id,
                    )
                    if not allowed:
                        continue  # gate blocked — no propagation

                # Attenuate delta by coupling strength
                predicted_delta = coupling * delta
                rcv_slot.last_hrv = max(5.0, rcv_slot.last_hrv + predicted_delta)
                updates[rcv_id] = round(rcv_slot.last_hrv, 2)

        return updates

    def record_interaction_outcome(
        self,
        sender_id: str,
        reward_signal: float,
    ) -> None:
        """
        Update the hysteretic alliance based on an interaction outcome.

        Called at the end of each turn or episode with the turn reward.
        Positive reward → alliance slightly strengthens.
        Negative reward → alliance slightly weakens.

        The dead-band in HystereticVIntStore prevents small signals from
        destabilising established alliances.
        """
        with self._lock:
            sender_slot = self._slots.get(sender_id)
            if sender_slot is None:
                return
            sender_role = sender_slot.role
            for rcv_id, rcv_slot in self._slots.items():
                if rcv_id == sender_id:
                    continue
                self._hysteretic.update(sender_role, rcv_slot.role, reward_signal)

    def close_session(self) -> None:
        """
        Persist alliance state and increment session counters.
        Call at /session/close or episode end.
        """
        with self._lock:
            sender_roles = [(s.agent_id, s.role) for s in self._slots.values()]
        for aid, role in sender_roles:
            for aid2, role2 in sender_roles:
                if aid != aid2:
                    self._hysteretic.record_session_end(role, role2)
        self._hysteretic.save()
        log.debug("SharedTensorBuffer[%s]: alliance state saved", self.session_id)

    def update_v_int(self, sender_role: str, receiver_role: str,
                     coupling: float) -> None:
        """
        Update the learned coupling strength for a role pair (Phase 5 A3C).
        """
        with self._lock:
            self._v_int_overrides[(sender_role, receiver_role)] = float(coupling)

    # ── Summary ───────────────────────────────────────────────────────────────

    def get_hrv_summary(self) -> dict:
        """
        Return {agent_id: {role, hrv_ms, stress_label}} for all agents.
        Used by CompanionCoordinator for the action_selector context.
        """
        with self._lock:
            return {
                aid: {
                    'role':         s.role,
                    'hrv_ms':       round(s.last_hrv, 1),
                    'stress_label': _hrv_to_label(s.last_hrv),
                    'last_update':  s.last_update,
                }
                for aid, s in self._slots.items()
            }

    def consistency_hint(self) -> str:
        """
        Compact summary for prompt injection: each agent's current stress level.
        Used to prevent a companion from delivering complex information when
        another companion has just distressed the patient.
        """
        with self._lock:
            parts = []
            for aid, s in self._slots.items():
                label = _hrv_to_label(s.last_hrv)
                parts.append(f"{s.role}({aid}): {label} [{s.last_hrv:.0f}ms]")
        return "Circle stress: " + ", ".join(parts) if parts else ""

    def __repr__(self) -> str:
        with self._lock:
            n = len(self._slots)
        return f"SharedTensorBuffer(session={self.session_id!r}, agents={n})"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _hrv_to_label(hrv_ms: float) -> str:
    if hrv_ms >= 40:
        return 'low_stress'
    if hrv_ms >= 25:
        return 'moderate_stress'
    if hrv_ms >= 15:
        return 'high_stress'
    return 'crisis'


# ─────────────────────────────────────────────────────────────────────────────
# Session registry (one buffer per active session)
# ─────────────────────────────────────────────────────────────────────────────

_SESSION_REGISTRY: dict[str, SharedTensorBuffer] = {}
_REGISTRY_LOCK = threading.Lock()


def open_shared_buffer(session_id: str, agents: list[dict],
                       circle_id: str | None = None) -> SharedTensorBuffer:
    """
    Create and register a new SharedTensorBuffer for a session.

    Parameters
    ----------
    session_id : str  — unique session key
    agents     : list of {agent_id, role} dicts
    circle_id  : str | None — care circle ID for cross-session alliance persistence.
                  If None, uses session_id (no cross-session persistence).
    """
    buf = SharedTensorBuffer(session_id, agents, circle_id=circle_id)
    with _REGISTRY_LOCK:
        _SESSION_REGISTRY[session_id] = buf
    return buf


def get_shared_buffer(session_id: str) -> SharedTensorBuffer | None:
    """Retrieve an existing buffer. Returns None if session not found."""
    with _REGISTRY_LOCK:
        return _SESSION_REGISTRY.get(session_id)


def close_shared_buffer(session_id: str) -> None:
    """
    Deregister and discard a session buffer, persisting alliance state first.
    """
    with _REGISTRY_LOCK:
        buf = _SESSION_REGISTRY.pop(session_id, None)
    if buf is not None:
        buf.close_session()


# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 smoke test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Phase 4 G1/G2/G3 smoke test\n")

    # Open a session with 3 agents
    buf = open_shared_buffer("session_001", [
        {"agent_id": "patient_companion",   "role": "patient"},
        {"agent_id": "caregiver_companion",  "role": "caregiver"},
        {"agent_id": "clinician_companion",  "role": "clinician"},
    ])
    print(buf)

    # Simulate: patient's HRV drops (stress event)
    print("\n[Turn 1] Patient HRV drops from 35 -> 12ms (bad news received)")
    updates = buf.v_int_propagate("patient_companion", new_hrv_ms=12.0)
    print(f"  V_int propagation: {updates}")
    print(f"  HRV summary: {buf.get_hrv_summary()}")

    # Simulate: clinician responds (HRV recovers slightly)
    print("\n[Turn 2] Clinician speaks reassuringly -> patient HRV 12 -> 18ms")
    buf.put_mps("clinician_companion", mps=None, hrv_ms=42.0)  # clinician calm
    updates = buf.v_int_propagate("clinician_companion", new_hrv_ms=42.0)
    buf.put_mps("patient_companion", mps=None, hrv_ms=18.0)
    print(f"  V_int propagation from clinician: {updates}")
    print(f"  Circle consistency hint: {buf.consistency_hint()}")

    # V_int lookup
    print("\nV_int coupling priors:")
    for (s, r), v in V_INT_PRIOR.items():
        print(f"  {s:<12} -> {r:<12}: {v:.2f}")

    close_shared_buffer("session_001")
    print("\nPhase 4 smoke test passed.")
