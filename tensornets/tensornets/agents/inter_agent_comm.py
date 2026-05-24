"""
inter_agent_comm.py — MPS-based Inter-Agent Communication (Phase 4 stub)
=========================================================================

PURPOSE
-------
The three companions (patient, caregiver, clinician) each maintain their own
MPS state Ψ_p, Ψ_c, Ψ_cl.  Without this module they are entirely independent:
the patient companion does not know that the clinician companion just said
something sensitive, potentially causing contradictory or repetitive messages.

This module implements Phase 4 of the paper (Section 4.6):
  G2 — Partial trace of the physio bond dimension to share arousal state.
  V_int — Social coupling matrix for multi-agent state influence.

CURRENT STATUS: Phase 4 stub — mathematical definitions and endpoints.
The full tensor contraction is in Phase 4 (pending chi SVD compression in Phase 2).

WHAT THIS ACHIEVES
------------------
1. SHARED PHYSIOLOGICAL STATE
   The clinician's companion updates the patient's predicted arousal:
     ρ_patient_updated = Tr_semantic(Ψ_cl† M_int Ψ_cl) ⊗ ρ_patient_physio
   If the clinician just delivered bad news, the patient's Γ prediction
   is updated BEFORE the patient companion generates its next response.
   Result: the patient companion does not try to deliver complex information
   immediately after the clinician's distressing statement.

2. ANTI-CONTRADICTION CONSISTENCY
   A SharedDialogueState records what each agent has committed to.
   Before any companion generates a response, it checks the shared state
   for commitments that would be contradicted.
   Example: clinician says "you can eat normally before the procedure."
            Without sharing: patient companion might say "fast from midnight."
            With sharing: patient companion defers to clinician's statement.

3. ESCALATION ROUTING
   When patient stress exceeds a threshold (or when the MCTS cost function
   plateaus), the SharedDialogueState can escalate the conversation to a
   more capable agent (e.g., from patient companion → clinician companion).

4. MCTS ACROSS AGENTS
   In multi-agent MCTS rollouts (Phase 3), each simulated turn includes
   the responding agent as a dimension. MCTS can find that:
     "patient companion says X at turn 3" + "clinician companion says Y at turn 4"
   has lower total cost than any single-agent sequence.
   This is the formal basis for the companion negotiation capability.

THEORETICAL BASIS
-----------------
Schröder, T. & Thagard, P. (2013). The affective meanings of automatic social
behaviors. Psych Rev, 120(3), 601.
  - Social appraisal theory: agents update affective states from observing
    other agents' behaviours (basis for V_int coupling matrix).

Boccaletti, S. et al. (2006). Complex networks: Structure and dynamics.
Physics Reports, 424(4-5), 175-308.
  - Social coupling as graph Laplacian over companion network.

MPS partial trace:
  Vidal, G. (2004). Efficient simulation of one-dimensional quantum many-body
  systems. PRL, 93(4), 040502.
  The partial trace over a subsystem in MPS is computed by contracting over
  the bond indices — O(χ²d) cost.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import math


# ─────────────────────────────────────────────────────────────────────────────
# Shared dialogue state — the in-memory shared object
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class AgentCommitment:
    """A factual or clinical commitment made by an agent during the conversation."""
    agent_id: str
    turn: int
    statement: str
    topic: str
    is_clinical: bool = False   # Clinical commitments have higher consistency weight


@dataclass
class SharedDialogueState:
    """
    Session-scoped object passed to all companion instances.
    Maintained by CompanionCoordinator (JS) as a serialisable dict.
    """
    session_id: str
    agents: list[str]               # e.g. ['patient', 'caregiver', 'clinician']
    commitments: list[AgentCommitment] = field(default_factory=list)
    agent_hrv_predictions: dict[str, float] = field(default_factory=dict)
    escalation_requested: bool = False
    escalation_target: Optional[str] = None
    last_acting_agent: Optional[str] = None
    turn: int = 0

    def add_commitment(self, agent_id: str, statement: str,
                       topic: str, is_clinical: bool = False) -> None:
        self.commitments.append(AgentCommitment(
            agent_id=agent_id,
            turn=self.turn,
            statement=statement,
            topic=topic,
            is_clinical=is_clinical,
        ))

    def get_commitments_on_topic(self, topic: str) -> list[AgentCommitment]:
        return [c for c in self.commitments if topic.lower() in c.topic.lower()]

    def consistency_hint(self, requesting_agent: str) -> str:
        """
        Returns a prompt injection string for the requesting agent,
        listing all commitments from other agents that it should not contradict.
        """
        other_commitments = [
            c for c in self.commitments
            if c.agent_id != requesting_agent
        ]
        if not other_commitments:
            return ""
        lines = ["CROSS-AGENT CONSISTENCY — do not contradict these statements:"]
        for c in other_commitments[-5:]:  # last 5 to keep prompt short
            marker = "[CLINICAL]" if c.is_clinical else ""
            lines.append(f"  [{c.agent_id} at turn {c.turn}]{marker}: {c.statement}")
        return "\n".join(lines)

    def update_physio_prediction(
        self, observing_agent: str, target_agent: str,
        delta_hrv_ms: float, current_hrv: float,
    ) -> None:
        """
        When agent A says something that is predicted to affect agent B's HRV,
        update the prediction for B.
        This implements the G2 partial trace concept: agent A's action
        propagates through the social coupling matrix to B's physio state.

        Coupling strength V_int is hardcoded here as a prior; Phase 4 will
        learn it from session data.
        """
        # V_int coupling matrix (prior): clinician → patient coupling stronger
        V_INT = {
            ('clinician', 'patient'):  0.6,
            ('caregiver', 'patient'):  0.4,
            ('patient',   'clinician'): 0.2,
            ('patient',   'caregiver'): 0.3,
        }
        coupling = V_INT.get((observing_agent, target_agent), 0.1)
        predicted = self.agent_hrv_predictions.get(target_agent, current_hrv)
        # Attenuate the delta by the coupling strength
        self.agent_hrv_predictions[target_agent] = (
            predicted + coupling * delta_hrv_ms
        )

    def request_escalation(self, from_agent: str, to_agent: str,
                            reason: str) -> None:
        """
        Flag that the conversation should be handed to a more capable agent.
        Triggered by MCTS when cost function plateaus or crisis is detected.
        """
        self.escalation_requested = True
        self.escalation_target = to_agent
        self.commitments.append(AgentCommitment(
            agent_id=from_agent,
            turn=self.turn,
            statement=f"[ESCALATION to {to_agent}: {reason}]",
            topic="escalation",
            is_clinical=True,
        ))


# ─────────────────────────────────────────────────────────────────────────────
# MCTS multi-agent rollout hint
# ─────────────────────────────────────────────────────────────────────────────

def multi_agent_mcts_hint(shared_state: SharedDialogueState,
                           current_agent: str) -> str:
    """
    Returns a string appended to the MCTS rollout context describing
    the shared state for multi-agent consistency scoring.

    Used by mcts_reward.py consistency dimension.
    """
    consistency = shared_state.consistency_hint(current_agent)
    pred = shared_state.agent_hrv_predictions.get(current_agent)

    lines = []
    if consistency:
        lines.append(consistency)
    if pred is not None:
        lines.append(f"PREDICTED HRV (cross-agent update): {pred:.1f}ms")
    if shared_state.escalation_requested:
        lines.append(
            f"ESCALATION ACTIVE: conversation handed to "
            f"{shared_state.escalation_target}"
        )
    return "\n".join(lines) if lines else ""


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI endpoint payloads (mirrors server.py additions below)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SharedStateIn:
    session_id: str
    agent_id: str
    statement: str
    topic: str
    delta_hrv_ms: float
    is_clinical: bool = False

@dataclass
class ConsistencyHintOut:
    hint: str
    escalation_requested: bool
    escalation_target: Optional[str]
    predicted_hrv: Optional[float]


# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 partial trace (MPS tensor operation — placeholder)
# ─────────────────────────────────────────────────────────────────────────────

def partial_trace_physio(mps_agent_a_cores: list, chi_physio: int) -> list:
    """
    Phase 4 operation (pending Phase 2 bond truncation implementation).

    Computes the partial trace of agent A's MPS over the physio bond
    subspace, yielding a reduced density matrix ρ_A_physio that can be
    used to update agent B's physio subspace.

    ρ_physio = Tr_semantic(|Ψ_A⟩⟨Ψ_A|)

    This is the formal G2 operator in the paper.

    Returns: list of physio-subspace core tensors (χ_physio × d × χ_physio).
    Implementation deferred to Phase 4.
    Reference: Vidal 2004, PRL 93(4):040502.
    """
    raise NotImplementedError(
        "partial_trace_physio is a Phase 4 operation. "
        "Prerequisites: Phase 2 (SVD bond truncation) + Phase 3 (MCTS rollout). "
        "See EXPERIMENTS.md OQ-6 for the validation experiment."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Worked example
# ─────────────────────────────────────────────────────────────────────────────

def worked_example():
    print("=" * 70)
    print("INTER-AGENT COMMUNICATION — Shared Dialogue State Demo")
    print("=" * 70)

    state = SharedDialogueState(
        session_id="session_001",
        agents=["patient", "caregiver", "clinician"],
    )

    # Clinician companion commits a clinical statement
    state.turn = 3
    state.add_commitment(
        "clinician",
        "You can eat a light meal up to 4 hours before the procedure.",
        topic="pre-procedure fasting",
        is_clinical=True,
    )

    # Clinician's statement predicted to reduce patient HRV (was stressful news)
    state.update_physio_prediction(
        observing_agent="clinician",
        target_agent="patient",
        delta_hrv_ms=-8.0,
        current_hrv=35.0,
    )

    # Patient companion tries to generate its next response
    state.turn = 4
    hint = multi_agent_mcts_hint(state, "patient")
    print("\nPatient companion receives:")
    print(hint)
    print(f"\nPredicted patient HRV after clinician statement: "
          f"{state.agent_hrv_predictions.get('patient', 'unknown'):.1f}ms")

    # MCTS plateau — escalate
    state.request_escalation(
        "patient", "clinician",
        "stress plateau after 4 turns — clinical decision needed"
    )
    print(f"\nEscalation: {state.escalation_requested} → {state.escalation_target}")


if __name__ == "__main__":
    worked_example()
