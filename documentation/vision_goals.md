# Project Vision & Goals

This document outlines the vision, problem statement, and objectives for the multi-agent AI healthcare system.

## 1. Problem Statement

In modern healthcare, particularly in the management of chronic conditions and mental health, a significant gap exists between a patient's clinical reality and the information available to a clinician. This "information asymmetry" is caused by several factors:

### 1.1 Information Gap Challenges

- **Unreliable Self-Reporting**: Patients may unintentionally forget details, minimize symptoms due to denial, or misrepresent their adherence to treatment plans
- **Limited Observational Data**: Clinicians only see a brief snapshot of the patient's life during appointments
- **The Untapped Resource**: Caregivers (family members, spouses, close friends) often hold a more objective, continuous, and context-rich view of the patient's behavior, but this information is rarely captured systematically

### 1.2 Consequences

This gap leads to:
- Delayed diagnoses
- Ineffective treatment plans
- Poor patient adherence
- Preventable critical health events

## 2. Proposed Solution: The "Care Circle"

This project introduces a multi-agent AI system designed to bridge this information gap by creating a secure, mediated communication network called a "Care Circle."

### 2.1 Core Concept

The core concept is to assign a dedicated, personal AI agent to each member of the care team: the patient, the caregiver, and the doctor.

### 2.2 Agent Functionality

These agents do not facilitate direct, unfiltered chat. Instead, they act as intelligent intermediaries that:

- **Converse Independently**: Each agent builds a trusted relationship with its assigned user, collecting information, perspectives, and concerns through natural conversation
- **Mediate and Reconcile**: The agents communicate with each other through a central Orchestrator. The orchestrator analyzes incoming information, detects conflicts between reports (e.g., patient says they took medicine, caregiver says they didn't), and manages the complex social and privacy dynamics of the group
- **Provide Actionable Intelligence**: The system synthesizes the reconciled information to provide all parties with the context they need to act effectively, while respecting the consent and privacy of each individual

## 3. Key Goals & Objectives

The primary goals of this project are to create a system that:

### 3.1 Data Reliability
- **Improves Data Reliability**: By cross-referencing reports from multiple sources, the system can generate a more accurate and reliable picture of the patient's health status

### 3.2 Patient Adherence
- **Enhances Patient Adherence**: By understanding the true barriers to compliance (e.g., side effects, financial issues, denial), the system can facilitate more effective interventions and support

### 3.3 Communication & Support
- **Facilitates Counseling & Support**: The AI acts as a neutral third party, helping to surface sensitive topics and disagreements in a non-confrontational way, paving the path for more effective family and clinical counseling

### 3.4 Clinical Safety
- **Ensures Timely Clinical Escalation**: The system is designed to identify critical health events (e.g., reports of severe pain, fainting) and immediately escalate them to the doctor's attention, preventing them from getting lost in conversational noise

### 3.5 Privacy & Trust
- **Respects User Privacy**: Through a granular, multi-layered consent model, the system ensures that sensitive information is only shared with the right people at the right time

## 4. Success Metrics

### 4.1 Clinical Outcomes
- Reduction in missed critical health events
- Improved medication adherence rates
- Faster diagnosis of health issues
- Better treatment plan compliance

### 4.2 User Experience
- High user trust and engagement
- Effective conflict resolution
- Appropriate privacy protection
- Clear communication facilitation

### 4.3 System Performance
- Accurate fact extraction and reconciliation
- Timely escalation of critical events
- Effective consent management
- Robust conflict detection and mediation

---

## 5. Technical Mechanisms

The following HTN framework components serve each goal:

| Goal | Mechanism | Key module |
|---|---|---|
| Data Reliability | Physiological state vector provides objective ground truth independent of self-report | `tensornets/physio/state.py`, `physio/hysteresis.py` |
| Patient Adherence | MCTS selects optimal timing for adherence prompts based on HRV/stress; hysteresis tracks relapse risk between sessions | `mcts/base.py`, `physio/hysteresis.py` |
| Communication & Support | Multi-agent V_int propagation ensures care circle members receive physiologically-coherent information | `agents/shared_tensor_state.py`, `agents/inter_agent_comm.py` |
| Clinical Safety | Non-Hermitian H_eff operator ensures Γ-constrained responses; critical stress gate blocks unsafe actions | `core/operators.py`, `a3c/action_bandit.py` |
| Privacy & Trust | Privacy layer with Level 1/2/3 classification; consent taxonomy; DisclosureAdvantagePlanner | `agents/privacy_layer.py`, `companions/handlers/privacyGuard.js` |

---

## 6. Operationalised Success Metrics

The qualitative metrics in §4 are operationalised in the benchmark system as follows:

| §4 Goal | Operationalised metric | Tracked in | Target (preliminary) |
|---|---|---|---|
| Reduction in missed critical health events | `safety` score (LLM judge, 0–2) | `htn_benchmark_turns.safety` | Mean safety ≥ 1.5 across episodes |
| High user trust and engagement | `trust_delta` (accumulated per episode) | `genuine_metrics.trust_delta_final` | Mean trust_delta_final > 0 across episodes |
| Improved medication adherence | `change_stage_delta` (TTM advancement) | `genuine_metrics.change_stage_delta` | > 0 in ≥ 60% of adherence scenarios |
| Clinician workload reduction | `turns_to_goal` (efficiency) | `genuine_metrics.turns_to_goal` | Mean < 20 turns for defined-goal scenarios |
| Physiological benefit | `stress_auc` = mean(1 − stress_index) over turns | `genuine_metrics.stress_auc` | > 0.55 (baseline ≈ 0.50 for neutral conversation) |
| Benchmarkable PhD claim | `goal_achieved%` (primary comparison metric) | `htn_benchmark_turns.goal_progress` | htn_mcts > oldschool by OR ≥ 1.5, p < 0.05 |

---

## 7. Open TODOs

Items required to fully validate the vision. Grouped by track.

### 7.1 Research / ML track

- [ ] **HITL feedback loop**: Wire `training/feedback/annotator.js` → A3C weight update. Currently the annotation infrastructure exists but is not connected to the A3C reward signal.
- [ ] **RL shadow mode**: Implement a shadow-mode runner (`training/rl_shadow.js`) that runs the A3C policy in parallel with the current rule-based logic, logs the divergence, but does not affect production responses. Required precursor to any JS-side gradual rollout.
- [ ] **JS-side gradual rollout**: Once shadow mode is validated, incrementally route 5% → 25% → 50% → 100% of JS traffic through the learned policy. Requires a circuit-breaker with automatic rollback if safety or trust metrics degrade.
- [ ] **Social hysteresis**: V_int social coupling currently uses fixed priors in `agents/shared_tensor_state.py`. The planned hysteretic V_int (alliance persistence across sessions) is not yet built. See `documentation/tensornets/07_future_work.md §5`.
- [ ] **Predictive escalation**: `futurePlanningAgent.js` can schedule future plans, but proactive physiological deterioration prediction (escalating before the patient reaches crisis) is not yet implemented.
- [ ] **Wearable integration**: Replace conversation-inferred HRV with real BLE wearable data. Current physio model uses inferred estimates — trajectory shape is validated but baselines are not calibrated to individuals. See `documentation/tensornets/07_future_work.md §4`.

### 7.2 Clinical validation track

- [ ] **Real user study**: run_014+ uses fully synthetic patients. A real user pilot is needed to validate that simulated outcomes generalise to human patients. Requires IRB/ethics approval, informed consent protocol, and a data safety monitoring board.
- [ ] **HIPAA/GDPR compliance audit**: Privacy policy claims compliance. A formal audit with a qualified data protection officer has not been conducted. Key areas: at-rest encryption of `care_circle_dev.db`, right-to-erasure implementation, audit log completeness.

### 7.3 Infrastructure / deployment track

- [ ] **ICD API integration**: Connect a medical coding API (e.g., ICD-10-CM via `agents/icd_client.js`, which exists but is undocumented and has no production route) for standardised terminology in fact extraction and escalation reports.
- [ ] **Doc categoriser + completeness API**: Implement document classification and information-completeness checking for structured clinical documents generated by `tensornets/tensornets/documents/clause_mcts.py`.
- [ ] **CI/CD pipeline**: GitHub Actions workflow for automated test suite, linting, and deployment gate. Currently no automated pipeline exists.
- [ ] **Cloud infrastructure**: Provision production resources (AWS recommended — Bedrock is already in use). Requires decisions on: EC2 vs ECS for Node.js, Lambda vs FastAPI container for tensornets, RDS vs SQLite-in-EFS.
- [ ] **Real authentication**: Replace current local auth in `handlers/loginHandler.js` with Firebase Auth or AWS Cognito. Requires secure token storage, refresh-token rotation, and MFA for clinical roles.
- [ ] **Secure session management**: Implement cryptographically signed session tokens (`sessions/sessionManager.js`). Current implementation is in-memory only; tokens do not survive server restart.
- [ ] **Data encryption at rest**: Encrypt `care_circle_dev.db` (SQLCipher or AWS KMS-backed S3). In-transit encryption (TLS) already enforced via HTTPS/SSE.
- [ ] **Rate limiting hardening**: Current rate limiting is basic. Harden per-user and per-endpoint limits; add abuse detection for the `/send` and `/api/training/scenarios` endpoints.
- [ ] **Continuous training pipeline automation**: Automate the feedback → simulation → A3C weight update loop. Currently each step is manual. Target: nightly episode generation with automated checkpoint promotion if eval metrics improve.
- [ ] **Multi-device context sync**: The architecture supports SSE broadcast, but there is no cross-device session synchronisation mechanism (e.g., a patient switching from mobile to desktop mid-conversation loses in-memory state).