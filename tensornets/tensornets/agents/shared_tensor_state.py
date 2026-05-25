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

import threading
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


# ─────────────────────────────────────────────────────────────────────────────
# V_int social coupling matrix (G3)
# ─────────────────────────────────────────────────────────────────────────────

# Prior coupling strengths between companion roles.
# These are literature-grounded priors; Phase 5 A3C will learn session-specific values.
# See module docstring for citations.
V_INT_PRIOR: dict[tuple[str, str], float] = {
    ('clinician', 'patient'):   0.6,
    ('caregiver', 'patient'):   0.4,
    ('patient',   'caregiver'): 0.35,
    ('patient',   'clinician'): 0.2,
    ('clinician', 'caregiver'): 0.25,
    ('caregiver', 'clinician'): 0.15,
}

DEFAULT_COUPLING: float = 0.1  # unknown role pairs


def v_int(sender_role: str, receiver_role: str,
          session_override: dict | None = None) -> float:
    """
    Coupling strength V_int[sender, receiver].
    session_override: optional learned values (Phase 5), keyed as (sender, receiver).
    """
    if session_override:
        val = session_override.get((sender_role, receiver_role))
        if val is not None:
            return float(val)
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

    def __init__(self, session_id: str, agents: list[dict]):
        """
        Parameters
        ----------
        session_id : str
        agents     : list of {agent_id, role} dicts
        """
        self.session_id = session_id
        self._lock      = threading.RLock()
        self._slots:    dict[str, AgentMPSSlot] = {}

        for a in agents:
            self._slots[a['agent_id']] = AgentMPSSlot(
                agent_id=a['agent_id'],
                role=a.get('role', 'patient'),
            )

        # Learned V_int overrides (populated by Phase 5 A3C)
        self._v_int_overrides: dict[tuple[str, str], float] = {}

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

                coupling = v_int(sender_role, rcv_slot.role, self._v_int_overrides)

                # Privacy gate: can this coupling propagate?
                if privacy_layer is not None:
                    from tensornets.agents.privacy_layer import InfoClass
                    # Use generic can_share() instead of the former HRV-specific gate.
                    # HRV delta is InfoClass.II (de-identified physiological signal).
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


def open_shared_buffer(session_id: str, agents: list[dict]) -> SharedTensorBuffer:
    """Create and register a new SharedTensorBuffer for a session."""
    buf = SharedTensorBuffer(session_id, agents)
    with _REGISTRY_LOCK:
        _SESSION_REGISTRY[session_id] = buf
    return buf


def get_shared_buffer(session_id: str) -> SharedTensorBuffer | None:
    """Retrieve an existing buffer. Returns None if session not found."""
    with _REGISTRY_LOCK:
        return _SESSION_REGISTRY.get(session_id)


def close_shared_buffer(session_id: str) -> None:
    """Deregister and discard a session buffer."""
    with _REGISTRY_LOCK:
        _SESSION_REGISTRY.pop(session_id, None)


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
