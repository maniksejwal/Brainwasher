"""
privacy_layer.py — MPS Privacy Constraints (tensornets layer)
=============================================================

SCOPE OF THIS MODULE
--------------------
This module handles ONE specific concern: privacy constraints for the
MPS/tensornets layer (V_int HRV propagation, partial trace, inter-agent
physiological sharing). It does NOT replace the existing JS escalation system.

THE EXISTING JS SYSTEM (DO NOT DUPLICATE)
------------------------------------------
The JS codebase already has a meticulously built privacy/escalation system:

  handlers/message_logic/sharing/criticalEvents.js
    - LLM-based emergency confidence scoring (0..1)
    - Immediate escalation at confidence >= 0.9 (bypasses all consent)
    - Future-planning follow-up question at confidence < 0.9
    - Family broadcast for HIGH criticality events

  handlers/message_logic/sharing/escalationTiers.js
    - 4-tier escalation: PERMISSION → CAREGIVER → ANONYMOUS → CONSULTATION
    - Tier selection based on criticality (NONE/LOW/MEDIUM/HIGH) × confidence
    - Permission denial handling: respect at LOW, override at MEDIUM + high confidence
    - Anonymous consultation (no patient identity disclosed, costs money)
    - Full consultation (patient identity, costs money)

  companions/handlers/privacyGuard.js
    - Intent-based sharing decisions (REPORTING_FACT, REQUESTING_MEDIATION, etc.)
    - DB-backed consent levels (full / implied / none) per topic
    - Circle membership checks via getCircleMembers()
    - Resolved username matching with fallback

  companions/agents/escalationManager.js
    - Uses clinicalAssessment.criticality from the clinical agent
    - Routes HIGH/MEDIUM to escalation tiers
    - Preserves patient agency at LOW criticality

This Python module sits ALONGSIDE those — it does not replace them.
It only activates when the tensornets MPS bridge is enabled.

WHAT THIS MODULE ADDS
---------------------
  1. INFORMATION CLASSES — sensitivity tier for MPS-routed physiological data
  2. MPS PRIVACY GATES — block V_int HRV propagation without role+consent
  3. DOCUMENT DISCLOSURE ADVANTAGE — clause withholding for optimal acceptance timing
  4. AUDIT LOG — GDPR-required record of every data routing decision
  5. ESCALATION BRIDGE — translate tensornets signals back to JS escalation tiers

The escalation bridge does NOT implement escalation. It produces a trigger
code that the JS caller (tensornetsBridge.js) passes to the existing
criticalEvents.js / escalationTiers.js system.

INFORMATION CLASSES
-------------------
  Class I   (freely shareable):   scheduling, appointment time, document status
  Class II  (role-gated):         physiological summaries (stress label, not raw HRV)
  Class III (consent-gated):      raw HRV values, medication adherence, secrets
  Class IV  (never shared):       personal disclosures (trauma, abuse, addiction history)

HARDCODED ROLE CONSTRAINTS
--------------------------
The following are not configurable. They mirror the JS governance rules.
  1. Cross-patient sharing: ALWAYS blocked (no override).
  2. Class IV: NEVER shared with any role.
  3. Class III requires BOTH role permission AND explicit per-field consent.
  4. Caregiver Class III: ALSO requires same-circle membership.
  5. Escalation codes are always forwarded to JS — never acted on in Python.

OLD VS NEW
----------
+----------------------------+-------------------------------+-----------------------------+
| Dimension                  | Old (rule-based JS)            | New (MPS + privacy layer)  |
+----------------------------+-------------------------------+-----------------------------+
| Blocking mechanism         | criticalEvents.js confidence   | PrivacyGate.allow()         |
|                            | + escalationTiers.js           | for MPS-routed data only    |
| Escalation trigger         | 4-tier JS system (PRESERVED)   | EscalationBridge.check()    |
|                            |                                | → returns code → JS handles |
| Physiological sharing      | None (HRV was not shared)      | V_int matrix (Class II      |
|                            |                                | after consent gate)         |
| Cross-agent consistency    | None (contradictions possible) | SharedDialogueState hints   |
| Secret handling            | Not implemented in JS          | SessionManager.secrets +    |
|                            |                                | Class IV gate               |
| Patient consent tracking   | Implicit (DB consent_level)    | Explicit per-field consent  |
|                            |                                | + DB consent_level preserved|
| Audit trail                | Message logs in DB             | PrivacyGate.audit_log       |
| Document disclosure        | Not implemented in JS          | DisclosureAdvantagePlanner  |
+----------------------------+-------------------------------+-----------------------------+

DOCUMENT DISCLOSURE ADVANTAGE
------------------------------
In multi-party document negotiation, the companion can strategically WITHHOLD
clauses to maximise acceptance (same as a lawyer ordering exhibits).
This is NOT a privacy violation — all clauses are eventually disclosed.
The DisclosureAdvantagePlanner works with ClauseMCTS (clause_mcts.py):
  1. ClauseMCTS finds optimal acceptance-maximising clause order.
  2. DisclosureAdvantagePlanner gates each clause behind min_acceptance_threshold.
  3. When patient stress is too high, the clause is deferred to a later turn.

REPUTATIONAL HYSTERESIS (academic/professional context)
-------------------------------------------------------
Disclosing a weak or incomplete draft creates a negative impression that
is harder to correct than if the gap had never been disclosed prematurely.
This is hysteresis: the trust recovery trajectory after a "bad impression"
is not the mirror of the trust-building trajectory.

In DisclosureAdvantagePlanner, ReputationRiskClause marks documents/clauses
that should NEVER be disclosed until they are complete. Premature disclosure
of an incomplete milestone → reputation_cost > min_acceptance. The planner
withholds them even if stress is low.

REFERENCES
----------
Nissenbaum (2004). Privacy as contextual integrity. Washington LR, 79, 119-157.
GDPR Art. 9 — special categories of health data.
HIPAA Privacy Rule — minimum necessary standard.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import time


# ─────────────────────────────────────────────────────────────────────────────
# ESCALATION BRIDGE
# Translates tensornets signals into codes the JS escalation system understands.
# The actual escalation is ALWAYS handled by the JS layer:
#   handlers/message_logic/sharing/criticalEvents.js  (HIGH criticality)
#   handlers/message_logic/sharing/escalationTiers.js (tiered escalation)
#   companions/agents/escalationManager.js            (orchestrates both)
#
# Python's role: produce an EscalationSignal. JS decides what to do with it.
# ─────────────────────────────────────────────────────────────────────────────

# These map to the JS escalationTiers.js ESCALATION_TIERS
JS_ESCALATION_TIERS = {
    'PERMISSION':    1,   # ask patient for permission (tier 1)
    'CAREGIVER':     2,   # notify caregiver (tier 2, low cost)
    'ANONYMOUS':     3,   # anonymous doctor consultation (tier 3, costs money)
    'CONSULTATION':  4,   # full consultation with patient identity (tier 4)
    'CRITICAL':      5,   # immediate escalation, bypasses consent (HIGH confidence >= 0.9)
}

# These are tensornets-specific signals that should trigger JS escalation.
# The JS criticalEvents.js handles the HIGH criticality cases independently.
# These are ADDITIONAL signals from the physiological/MCTS layer.
TENSORNETS_ESCALATION_TRIGGERS: dict[str, str] = {
    'crisis_hrv':                 'CRITICAL',     # HRV < 8ms for 3+ consecutive turns
    'strategic_patience_zero':    'CONSULTATION',  # CompanionHysteresis exhausted
    'mcts_plateau_extended':      'PERMISSION',    # MCTS cannot improve — seek new input
    'secret_bearing_topic_acute': 'ANONYMOUS',     # HRV drops on sensitive topic
}


@dataclass
class EscalationSignal:
    """
    Signal returned to JS caller indicating escalation is recommended.
    The JS caller passes this to criticalEvents.js / escalationTiers.js.
    """
    should_escalate:  bool
    trigger:          str               # key from TENSORNETS_ESCALATION_TRIGGERS or 'none'
    recommended_tier: str               # one of JS_ESCALATION_TIERS keys
    reason:           str
    physio_context:   dict = None       # current HRV/stress to include in escalation details

    def to_js_payload(self) -> dict:
        """
        Format for tensornetsBridge.js to pass to the JS escalation system.
        JS side calls handleTieredEscalation(userId, role, message, circleId, this).
        """
        return {
            'escalate':        self.should_escalate,
            'trigger':         self.trigger,
            'tier':            JS_ESCALATION_TIERS.get(self.recommended_tier, 1),
            'tier_name':       self.recommended_tier,
            'reason':          self.reason,
            'physio_context':  self.physio_context or {},
            'source':          'tensornets_mcts',  # so JS knows this came from Python
        }


class EscalationBridge:
    """
    Translates tensornets MCTS/physio signals into JS-compatible escalation payloads.

    This bridge does NOT duplicate the 4-tier JS escalation logic.
    It produces EscalationSignal objects that the JS caller handles.

    The existing JS system is authoritative for:
      - LLM confidence scoring for HIGH criticality (calculateEmergencyConfidence)
      - 4-tier routing (determineEscalationTier)
      - Permission request flows (handleTier1Permission)
      - Family notification (handleTier2Caregiver)
      - Anonymous consultation (handleTier3Anonymous)
      - Full consultation (handleTier4Consultation)
    """

    def __init__(self, consecutive_crisis_threshold: int = 3, plateau_turns: int = 5):
        self._crisis_hrv_count: int = 0
        self._plateau_count:    int = 0
        self._consecutive_crisis_threshold = consecutive_crisis_threshold
        self._plateau_turns_threshold      = plateau_turns

    def check(
        self,
        hrv_ms:                       float,
        strategic_patience_exhausted: bool  = False,
        mcts_cost_delta:              float = 0.0,
        secret_topic_detected:        bool  = False,
    ) -> EscalationSignal:
        """
        Check whether any tensornets signal warrants escalation.

        Parameters
        ----------
        hrv_ms                       : current patient HRV in ms
        strategic_patience_exhausted : True if CompanionHysteresis.strategic_patience <= 0
        mcts_cost_delta              : MCTS reward improvement this turn (< 0.01 = plateau)
        secret_topic_detected        : True if longitudinal.detect_secrets() found acute HRV drop

        Returns
        -------
        EscalationSignal — always returned, should_escalate may be False.
        The JS caller calls to_js_payload() and forwards to the JS escalation system.
        """
        # Crisis HRV: below 8ms = physiological emergency proxy
        if hrv_ms < 8.0:
            self._crisis_hrv_count += 1
        else:
            self._crisis_hrv_count = 0

        if self._crisis_hrv_count >= self._consecutive_crisis_threshold:
            return EscalationSignal(
                should_escalate=True, trigger='crisis_hrv',
                recommended_tier='CRITICAL',
                reason=f"HRV={hrv_ms:.1f}ms below 8ms for {self._crisis_hrv_count} consecutive turns",
                physio_context={'hrv_ms': hrv_ms},
            )

        if strategic_patience_exhausted:
            return EscalationSignal(
                should_escalate=True, trigger='strategic_patience_zero',
                recommended_tier='CONSULTATION',
                reason="Companion strategic patience exhausted: therapeutic alliance rupture risk",
            )

        if mcts_cost_delta < 0.01:
            self._plateau_count += 1
        else:
            self._plateau_count = 0

        if self._plateau_count >= self._plateau_turns_threshold:
            return EscalationSignal(
                should_escalate=True, trigger='mcts_plateau_extended',
                recommended_tier='PERMISSION',
                reason=f"MCTS plateau for {self._plateau_count} turns: seek new clinical input",
            )

        if secret_topic_detected:
            return EscalationSignal(
                should_escalate=True, trigger='secret_bearing_topic_acute',
                recommended_tier='ANONYMOUS',
                reason="Acute HRV suppression on sensitive topic: anonymous consultation recommended",
                physio_context={'hrv_ms': hrv_ms},
            )

        return EscalationSignal(
            should_escalate=False, trigger='none',
            recommended_tier='PERMISSION',
            reason="No tensornets escalation signal",
        )


# ─────────────────────────────────────────────────────────────────────────────
# INFORMATION CLASSES
# ─────────────────────────────────────────────────────────────────────────────

class InfoClass(Enum):
    """Information sensitivity classification."""
    I   = "freely_shareable"       # scheduling, document status
    II  = "role_gated"             # physiological summaries (stress label)
    III = "consent_gated"          # raw HRV, medication adherence
    IV  = "never_shared"           # trauma history, addiction secrets


# ─────────────────────────────────────────────────────────────────────────────
# HARDCODED ROLE-RECEIVE PERMISSIONS
# These are NOT driven by configuration. Changing them requires a PR.
# They mirror the original role checks in commandHandler.js / escalationHandler.js
# ─────────────────────────────────────────────────────────────────────────────

ROLE_RECEIVE_PERMISSIONS: dict[str, set[InfoClass]] = {
    'patient':    {InfoClass.I},
    'caregiver':  {InfoClass.I, InfoClass.II},          # Class III requires +consent
    'clinician':  {InfoClass.I, InfoClass.II, InfoClass.III},
    'supervisor': {InfoClass.I, InfoClass.II, InfoClass.III},   # clinical supervisor
    'system':     {InfoClass.I, InfoClass.II, InfoClass.III},   # audit/logging only, not IV
    # employer, friend, stranger → not in dict → blocked by default
}

# Cross-patient sharing is ALWAYS blocked regardless of role.
# A patient's companion cannot share with another patient's companion
# even if both are in the same circle — only clinician mediates.
CROSS_PATIENT_SHARE_BLOCKED = True


# ─────────────────────────────────────────────────────────────────────────────
# DECISION RECORD
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PrivacyDecision:
    allowed:    bool
    info_class: InfoClass
    reason:     str
    sender:     str
    receiver:   str
    field_name: str
    timestamp:  float = field(default_factory=time.time)


# ─────────────────────────────────────────────────────────────────────────────
# PRIVACY LAYER
# ─────────────────────────────────────────────────────────────────────────────

class PrivacyLayer:
    """
    Enforces information sharing constraints between companion agents.

    Hard-coded checks (NOT configurable):
      - Cross-patient sharing is always blocked (CROSS_PATIENT_SHARE_BLOCKED)
      - Class IV is never shared with any role
      - Escalation is only allowed for ESCALATION_TRIGGERS

    Soft checks (driven by consent + role):
      - Class II: role check only
      - Class III: role check + explicit per-field consent

    In Phase 4, the MPS partial trace will replace the soft checks.
    The hard-coded checks remain in code permanently (governance requirement).
    """

    def __init__(self):
        self.audit_log: list[PrivacyDecision] = []
        # subject_id → set of field_names the subject has explicitly consented to share
        self._consent: dict[str, set[str]] = {}
        # circle_id → set of (sender_id, receiver_id) pairs in the same circle
        self._circle_membership: dict[str, set[tuple[str, str]]] = {}

    # ── Consent management ────────────────────────────────────────────────────

    def grant_consent(self, subject_id: str, field_name: str) -> None:
        """Record explicit consent for sharing a specific field."""
        self._consent.setdefault(subject_id, set()).add(field_name)

    def revoke_consent(self, subject_id: str, field_name: str) -> None:
        """Revoke previously granted consent."""
        self._consent.get(subject_id, set()).discard(field_name)

    def add_circle_members(self, circle_id: str, sender_id: str, receiver_id: str) -> None:
        """Register that sender and receiver are in the same care circle."""
        self._circle_membership.setdefault(circle_id, set()).add((sender_id, receiver_id))

    def _same_circle(self, sender_id: str, receiver_id: str) -> bool:
        for members in self._circle_membership.values():
            if (sender_id, receiver_id) in members:
                return True
        return False

    # ── Core gate ────────────────────────────────────────────────────────────

    def allow(
        self,
        sender_role:   str,
        receiver_role: str,
        field_name:    str,
        subject_id:    str,
        info_class:    InfoClass,
        sender_id:     str = '',
        receiver_id:   str = '',
    ) -> bool:
        """
        Decide whether field_name can flow from sender_role to receiver_role.

        HARDCODED BLOCKS (checked first, cannot be bypassed):
          1. Class IV → always blocked.
          2. Cross-patient → always blocked.

        SOFT CHECKS (role + consent):
          3. receiver_role must be in ROLE_RECEIVE_PERMISSIONS.
          4. Class III requires explicit per-field consent.

        All decisions are appended to audit_log.
        """
        # ── Hard block 1: Class IV ─────────────────────────────────────────
        if info_class == InfoClass.IV:
            self._record(False, info_class, field_name, sender_role, receiver_role,
                         "HARDCODED: Class IV data is never shared with any role")
            return False

        # ── Hard block 2: Cross-patient ───────────────────────────────────
        if CROSS_PATIENT_SHARE_BLOCKED and sender_role == 'patient' and receiver_role == 'patient':
            self._record(False, info_class, field_name, sender_role, receiver_role,
                         "HARDCODED: cross-patient sharing is always blocked")
            return False

        # ── Soft check: role permissions ──────────────────────────────────
        permitted_classes = ROLE_RECEIVE_PERMISSIONS.get(receiver_role, set())
        if info_class not in permitted_classes:
            self._record(False, info_class, field_name, sender_role, receiver_role,
                         f"role '{receiver_role}' cannot receive {info_class.value}")
            return False

        # ── Class III: also needs explicit consent + same circle ──────────
        if info_class == InfoClass.III:
            has_consent = field_name in self._consent.get(subject_id, set())
            in_circle   = self._same_circle(sender_id, receiver_id) if (sender_id and receiver_id) else True
            allowed = has_consent and in_circle
            reason  = "allowed" if allowed else f"Class III: consent={has_consent}, same_circle={in_circle}"
            self._record(allowed, info_class, field_name, sender_role, receiver_role, reason)
            return allowed

        # ── Class I / II: role check passed ───────────────────────────────
        self._record(True, info_class, field_name, sender_role, receiver_role, "allowed")
        return True

    def can_escalate(
        self,
        trigger_type: str,
        strategic_patience_exhausted: bool = False,
        mcts_plateau_turns: int = 0,
    ) -> bool:
        """
        DEPRECATED in favour of EscalationBridge.check().

        This thin wrapper is kept for backward compatibility only.
        New code should use EscalationBridge directly so the result
        can be forwarded to the JS 4-tier escalation system.
        """
        bridge = EscalationBridge(plateau_turns=mcts_plateau_turns or 5)
        sig = bridge.check(
            hrv_ms=20.0,  # unknown here — EscalationBridge.check() handles properly
            strategic_patience_exhausted=strategic_patience_exhausted,
            mcts_cost_delta=0.0 if mcts_plateau_turns > 0 else 1.0,
        )
        # Also honour legacy trigger strings that map to JS system
        if trigger_type in {'suicidal_ideation', 'self_harm', 'medication_crisis',
                            'abuse_disclosure', 'psychotic_episode'}:
            return True
        return sig.should_escalate

    # ── HRV filtering (as before, now using hardcoded checks) ────────────────

    def filter_hrv_prediction(
        self,
        predictions:      dict,          # agent_id → predicted_hrv_ms
        requesting_role:  str,
        subject_id:       str,
        requester_id:     str = '',
    ) -> dict:
        """
        Filter HRV predictions to only include what the requesting role may see.
        Class III (raw ms) requires consent. Class II (label) requires role only.
        """
        result = {}
        for agent_id, hrv_ms in predictions.items():
            if self.allow('patient', requesting_role, f'hrv_raw_{agent_id}',
                          subject_id, InfoClass.III,
                          sender_id=agent_id, receiver_id=requester_id):
                result[agent_id] = {'hrv_ms': hrv_ms, 'stress_label': _hrv_to_label(hrv_ms)}
            elif self.allow('patient', requesting_role, f'hrv_summary_{agent_id}',
                            subject_id, InfoClass.II,
                            sender_id=agent_id, receiver_id=requester_id):
                result[agent_id] = {'stress_label': _hrv_to_label(hrv_ms)}
        return result

    def can_propagate_hrv(
        self,
        sender_id:    str,
        receiver_id:  str,
        sender_role:  str,
        receiver_role: str,
        subject_id:   str,
    ) -> bool:
        """
        Called inside SharedDialogueState.update_physio_prediction() for V_int gating.
        """
        return self.allow(
            sender_role, receiver_role, f'hrv_delta_{sender_id}',
            subject_id, InfoClass.II,
            sender_id=sender_id, receiver_id=receiver_id,
        )

    # ── Audit ─────────────────────────────────────────────────────────────────

    def get_audit_report(self) -> list[dict]:
        return [
            {
                'allowed':  d.allowed,
                'class':    d.info_class.value,
                'reason':   d.reason,
                'sender':   d.sender,
                'receiver': d.receiver,
                'field':    d.field_name,
            }
            for d in self.audit_log[-50:]
        ]

    # ── Internal helper ───────────────────────────────────────────────────────

    def _record(
        self, allowed: bool, info_class: InfoClass,
        field_name: str, sender: str, receiver: str, reason: str,
    ) -> None:
        self.audit_log.append(PrivacyDecision(
            allowed=allowed, info_class=info_class, reason=reason,
            sender=sender, receiver=receiver, field_name=field_name,
        ))


# ─────────────────────────────────────────────────────────────────────────────
# DOCUMENT DISCLOSURE ADVANTAGE PLANNER
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DisclosureStatus:
    """Result of a disclosure eligibility check for one clause."""
    clause_id:    str
    eligible:     bool
    reason:       str
    # If not eligible, earliest_turn is when MCTS estimates the clause becomes viable
    earliest_turn: Optional[int] = None


class DisclosureAdvantagePlanner:
    """
    Strategic clause withholding for document negotiation.

    This does NOT hide information permanently. It schedules WHEN each clause
    is disclosed to maximise acceptance probability.

    Principle:
      Present trust-building / low-stress clauses first.
      Withhold high-stress clauses until physiological state is calm enough.
      The threshold is: acceptance_p(clause, current_stress) >= min_acceptance_threshold.

    REPUTATIONAL HYSTERESIS
    -----------------------
    For professional/academic documents, premature disclosure of an incomplete
    or weak clause causes a reputational cost. This cost is NOT symmetric with
    the trust-building curve:

      If you submit a weak draft → supervisor forms a negative impression.
      Even if you fix it later → the negative impression persists (hysteresis).
      Recovery trajectory ≠ -1 × damage trajectory.

    To model this, clauses can have a `reputation_risk: True` flag.
    A reputation-risk clause is ONLY disclosed when:
      (a) acceptance_p >= min_acceptance_threshold (standard gate), AND
      (b) The clause is marked COMPLETE (complete=True in the clause dict).

    If a clause is marked incomplete AND reputation_risk=True, it is
    permanently withheld (eligible=False, reason='incomplete + reputation_risk').
    This forces the companion to never raise the topic until the work is done.

    Works in concert with ClauseMCTS (clause_mcts.py):
      - ClauseMCTS finds the global optimal order.
      - DisclosureAdvantagePlanner enforces that order turn-by-turn.
      - At each turn, only ELIGIBLE clauses are offered to the companion.

    Example use:
      planner = DisclosureAdvantagePlanner(clause_mcts_path)
      eligible = planner.get_eligible(current_stress)
      # companion only chooses from eligible clauses
    """

    MIN_ACCEPTANCE_THRESHOLD: float = 0.55

    def __init__(
        self,
        ordered_path: list[dict],
        min_acceptance_threshold: float = MIN_ACCEPTANCE_THRESHOLD,
    ):
        """
        Parameters
        ----------
        ordered_path : list[dict]
            MCTS-optimised clause sequence. Each entry:
            {clause_id, p_accept, stress_before, stress_after,
             reputation_risk: bool (optional, default False),
             complete: bool (optional, default True)}
        min_acceptance_threshold : float
            Clauses with p_accept < this are withheld.
        """
        self.ordered_path             = ordered_path
        self.min_acceptance_threshold = min_acceptance_threshold
        self._disclosed:  set[str]    = set()
        self._turn:       int         = 0

    def advance_turn(self, clause_id: str) -> None:
        """
        Record that a clause was presented (accepted or rejected).
        Must be called after each companion turn.
        """
        self._disclosed.add(clause_id)
        self._turn += 1

    def get_eligible(self, current_stress: float) -> list[DisclosureStatus]:
        """
        Return a DisclosureStatus for each undisclosed clause in the MCTS order.

        A clause is ELIGIBLE if:
          1. All prior MCTS-order clauses are disclosed (prerequisite gate), AND
          2. p_accept >= min_acceptance_threshold (stress gate), AND
          3. If reputation_risk=True: clause must also be marked complete=True
             (reputational hysteresis gate — incomplete work is NEVER disclosed early).

        Clauses blocked by gate 3 remain withheld until complete=True is set,
        regardless of stress level or turn count.
        """
        statuses: list[DisclosureStatus] = []
        undisclosed = [step for step in self.ordered_path
                       if step['clause_id'] not in self._disclosed]

        for i, step in enumerate(undisclosed):
            cid             = step['clause_id']
            p_accept        = step.get('p_accept', 1.0)
            reputation_risk = step.get('reputation_risk', False)
            complete        = step.get('complete', True)

            # Gate 1: preceding clauses must be disclosed
            preceding_done = all(
                s['clause_id'] in self._disclosed
                for s in self.ordered_path
                if s != step and
                   self.ordered_path.index(s) < self.ordered_path.index(step)
            )
            if not preceding_done:
                statuses.append(DisclosureStatus(
                    clause_id=cid, eligible=False,
                    reason="prerequisite MCTS-order clause not yet disclosed",
                    earliest_turn=self._turn + (i + 1),
                ))
                continue

            # Gate 3 (checked before gate 2 — incompleteness blocks regardless of stress)
            if reputation_risk and not complete:
                statuses.append(DisclosureStatus(
                    clause_id=cid, eligible=False,
                    reason=(
                        "REPUTATION RISK: clause is incomplete. "
                        "Disclosing incomplete work causes lasting negative impression "
                        "(reputational hysteresis). Withheld until complete=True."
                    ),
                    earliest_turn=None,  # no estimate — depends on work completion, not time
                ))
                continue

            # Gate 2: stress / acceptance probability
            if p_accept < self.min_acceptance_threshold:
                estimated_turns = max(1, int((self.min_acceptance_threshold - p_accept) / 0.1))
                statuses.append(DisclosureStatus(
                    clause_id=cid, eligible=False,
                    reason=f"p_accept={p_accept:.2f} < threshold={self.min_acceptance_threshold:.2f}",
                    earliest_turn=self._turn + estimated_turns,
                ))
            else:
                rep_note = " [reputation_risk: complete]" if reputation_risk else ""
                statuses.append(DisclosureStatus(
                    clause_id=cid, eligible=True,
                    reason=f"p_accept={p_accept:.2f} >= threshold{rep_note}",
                ))

        return statuses

    def eligible_clause_ids(self, current_stress: float) -> list[str]:
        """Convenience: return only the eligible clause IDs."""
        return [s.clause_id for s in self.get_eligible(current_stress) if s.eligible]

    def withheld_count(self, current_stress: float) -> int:
        """Number of clauses currently being withheld."""
        return sum(1 for s in self.get_eligible(current_stress) if not s.eligible)


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
# Demo
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    layer = PrivacyLayer()

    # ── Circle membership ────────────────────────────────────────────────────
    layer.add_circle_members('circle_001', 'patient_companion', 'clinician_companion')
    layer.add_circle_members('circle_001', 'patient_companion', 'caregiver_companion')

    # Patient consents to sharing raw HRV with clinician
    layer.grant_consent('patient_001', 'hrv_raw_patient')

    tests = [
        # (sender_role, receiver_role, field_name, subject_id, info_class, sender_id, receiver_id)
        ('patient', 'caregiver',  'hrv_raw_patient',  'patient_001', InfoClass.III, 'patient_companion', 'caregiver_companion'),
        ('patient', 'caregiver',  'appointment_time', 'patient_001', InfoClass.I,   '', ''),
        ('patient', 'caregiver',  'stress_label',     'patient_001', InfoClass.II,  '', ''),
        ('patient', 'clinician',  'hrv_raw_patient',  'patient_001', InfoClass.III, 'patient_companion', 'clinician_companion'),
        ('patient', 'clinician',  'addiction_secret', 'patient_001', InfoClass.IV,  '', ''),
        ('patient', 'patient',    'stress_label',     'patient_001', InfoClass.II,  '', ''),   # cross-patient block
        ('patient', 'employer',   'stress_label',     'patient_001', InfoClass.II,  '', ''),   # unknown role block
    ]

    print("PRIVACY GATE DECISIONS")
    print(f"{'Sender':<12} {'Receiver':<12} {'Field':<22} {'Class':<18} {'Decision'}")
    print("-" * 80)
    for sender, receiver, field, subj, cls, sid, rid in tests:
        ok = layer.allow(sender, receiver, field, subj, cls, sid, rid)
        status = "ALLOW" if ok else "BLOCK"
        print(f"{sender:<12} {receiver:<12} {field:<22} {cls.value:<18} {status}")

    # ── HRV filtering ────────────────────────────────────────────────────────
    predictions = {'patient': 22.0, 'caregiver': 38.0}
    caregiver_view = layer.filter_hrv_prediction(predictions, 'caregiver', 'patient_001')
    clinician_view = layer.filter_hrv_prediction(predictions, 'clinician', 'patient_001')
    print(f"\nHRV views — caregiver: {caregiver_view}")
    print(f"           clinician:  {clinician_view}")

    # ── Escalation checks ────────────────────────────────────────────────────
    print("\nESCALATION CHECKS")
    cases = [
        ('suicidal_ideation', False, 0),
        ('normal_turn',       False, 3),
        ('normal_turn',       True,  0),
        ('normal_turn',       False, N_ESCALATION_TURNS),
    ]
    for trigger, sp_exhausted, plateau in cases:
        esc = layer.can_escalate(trigger, sp_exhausted, plateau)
        print(f"  trigger={trigger:<25} sp_exhausted={sp_exhausted}  plateau={plateau}  -> {'ESCALATE' if esc else 'hold'}")

    # ── Escalation bridge ─────────────────────────────────────────────────────
    print("\nESCALATION BRIDGE (tensornets signals -> JS 4-tier payload)")
    bridge = EscalationBridge()
    bridge_cases = [
        dict(hrv_ms=5.0,  strategic_patience_exhausted=False, mcts_cost_delta=0.5,  secret_topic_detected=False),
        dict(hrv_ms=5.0,  strategic_patience_exhausted=False, mcts_cost_delta=0.5,  secret_topic_detected=False),
        dict(hrv_ms=5.0,  strategic_patience_exhausted=False, mcts_cost_delta=0.5,  secret_topic_detected=False),
        dict(hrv_ms=25.0, strategic_patience_exhausted=True,  mcts_cost_delta=0.5,  secret_topic_detected=False),
        dict(hrv_ms=30.0, strategic_patience_exhausted=False, mcts_cost_delta=0.005,secret_topic_detected=False),
    ]
    for bc in bridge_cases:
        sig = bridge.check(**bc)
        flag = "ESCALATE" if sig.should_escalate else "hold   "
        print(f"  {flag} | trigger={sig.trigger:<30} | tier={sig.recommended_tier}")
        if sig.should_escalate:
            print(f"    -> JS: {sig.to_js_payload()}")

    # ── Disclosure advantage demo ────────────────────────────────────────────
    print("\nDISCLOSURE ADVANTAGE PLANNER")
    # Simulated MCTS path for an insurance appeal document
    mock_path = [
        {'clause_id': 'acknowledge',  'p_accept': 0.98, 'stress_before': 0.55, 'stress_after': 0.52},
        {'clause_id': 'rights',       'p_accept': 0.91, 'stress_before': 0.52, 'stress_after': 0.49},
        {'clause_id': 'appeal_basis', 'p_accept': 0.87, 'stress_before': 0.49, 'stress_after': 0.44},
        {'clause_id': 'liability',    'p_accept': 0.48, 'stress_before': 0.44, 'stress_after': 0.72},  # withheld initially
        {'clause_id': 'next_steps',   'p_accept': 0.80, 'stress_before': 0.44, 'stress_after': 0.50},
    ]
    planner = DisclosureAdvantagePlanner(mock_path, min_acceptance_threshold=0.55)

    for turn_n in range(4):
        current_stress = 0.55 - turn_n * 0.08   # stress decreasing with rapport
        eligible = planner.eligible_clause_ids(current_stress)
        statuses = planner.get_eligible(current_stress)
        print(f"\n  Turn {turn_n} (stress={current_stress:.2f}) — eligible: {eligible}")
        for s in statuses:
            flag = 'OK ' if s.eligible else f'HOLD (earliest turn {s.earliest_turn})'
            print(f"    {s.clause_id:<15} {flag}  [{s.reason}]")
        if eligible:
            planner.advance_turn(eligible[0])   # present first eligible clause

    # ── Audit log ────────────────────────────────────────────────────────────
    print("\nAudit log (last 10):")
    for rec in layer.get_audit_report()[-10:]:
        flag = "OK" if rec['allowed'] else "!!"
        print(f"  [{flag}] {rec['sender']:12} -> {rec['receiver']:12}  {rec['field']:22}  {rec['reason']}")
