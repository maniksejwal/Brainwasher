# Environment Diagram 5 — Care Circle Social Graph

> **View:** Logical / Domain View  
> **Purpose:** Models the care circle as a graph of human principals and
> their relationships, showing consent levels, information sharing
> permissions, and which agents mediate each edge.

## Care Circle Graph — Triad Example

```mermaid
graph TD
    subgraph circle [Care Circle — circleId: C001]
        Patient["👤 Patient\nrole = patient\nprimary_patient_id"]
        Caregiver["👥 Caregiver / Family\nrole = caregiver"]
        Doctor["👨‍⚕️ Doctor / Clinician\nrole = doctor"]
    end

    subgraph agents [Companion Agents — one per principal]
        PA["Patient Companion\nCompanionCoordinator\n(role=patient)"]
        CA["Caregiver Companion\nCompanionCoordinator\n(role=caregiver)"]
        DA["Doctor Companion\nCompanionCoordinator\n(role=doctor)"]
    end

    subgraph mediation [Mediation Layer]
        PrivacyGuard["privacyGuard.js\nClassifies: PUBLIC / PRIVATE / SENSITIVE\nConsent gate: NONE / LIMITED / FULL / EMERGENCY\nImplied consent: topic-based bypass"]
        InterventionQ["Intervention Queue\ndb/queries_interventions.js\nCross-user pending items\nUrgency-scored, deadline-aware"]
        ConfComm["CompanionConfidentialComm.js\nCompanion-to-companion\npeer signalling\n(conflict, intel sharing)"]
        Orchestrator["orchestrator.js\nEvent bus\nEscalation broadcast\nFuture plan execution"]
    end

    Patient -- "speaks to" --> PA
    Caregiver -- "speaks to" --> CA
    Doctor -- "speaks to" --> DA

    PA -- "fact about Patient\n(privacyLevel=PRIVATE)\n→ check consent" --> PrivacyGuard
    PrivacyGuard -- "consent=FULL\nor implied consent\n→ share allowed" --> CA
    PrivacyGuard -- "consent=FULL\n→ share allowed" --> DA
    PrivacyGuard -- "consent=NONE\n→ blocked" --> PA

    PA -- "concern about Caregiver\nor cross-user info" --> InterventionQ
    InterventionQ -- "surfaced on\nnext session" --> CA
    InterventionQ -- "surfaced on\nnext session" --> DA

    PA -- "conflict detected" --> ConfComm
    CA -- "conflict detected" --> ConfComm
    ConfComm -- "peer notify" --> DA

    DA -- "escalation decision" --> Orchestrator
    PA -- "crisis detected\n(stress > 0.85)" --> Orchestrator
    Orchestrator -- "SSE broadcast\n⚠ userId-targeted\nnot all members" --> Caregiver
    Orchestrator -- "SSE broadcast" --> Doctor
```

## Consent Level Matrix (per circle_members row)

| Sharer | Recipient | `consent_level` | What can be shared |
|--------|-----------|-----------------|-------------------|
| Patient | Doctor | `full` | All health information including sensitive |
| Patient | Caregiver | `full` | All health information |
| Patient | Caregiver | `limited` | Subset only (medication adherence, appointments) |
| Patient | Caregiver | `none` | Nothing — explicit consent request required first |
| Caregiver | Patient | `full` | Caregiver's observations |
| Doctor | Patient | `full` | Clinical advice, assessments |

> Consent levels are stored per `(user_id, circle_id)` row in `circle_members`.
> The `consent_level` field is checked by `privacyGuard.js._consentGate()`.
> Topic-specific **implied consent** (`getImpliedConsent(userId, circleId, topic)`)
> can bypass the explicit consent gate for routine topics (medication,
> appointments, check-ins) that the user has consented to repeatedly.

## Information sharing paths

```mermaid
flowchart LR
    subgraph path_A [Path A — Implied Consent]
        A1["User says:\n'Tell Dr. Smith about\nmy medication adherence'"]
        A2["privacyGuard classifies:\nPRIVATE"]
        A3["_consentGate checks:\nimplied consent for\n'medication' topic = TRUE"]
        A4["Share proceeds immediately\nlogged as consent_granted/FULL"]
        A1 --> A2 --> A3 --> A4
    end

    subgraph path_B [Path B — Explicit Consent Required]
        B1["User says:\n'Share my mental health\nlog with my spouse'"]
        B2["privacyGuard classifies:\nPRIVATE\nimplied consent = FALSE\nconsent_level = none"]
        B3["requiresConsent: true\n→ enqueue consent request\n→ ask user to confirm"]
        B4["User confirms:\n'Yes, share'"]
        B5["Share proceeds\nlogged as consent_granted/FULL"]
        B6["User declines:\n'No'"]
        B7["Share blocked\nlogged as consent_denied"]
        B1 --> B2 --> B3 --> B4 --> B5
        B3 --> B6 --> B7
    end

    subgraph path_C [Path C — SENSITIVE Block]
        C1["User says:\n'Share my HIV status\nwith my employer'"]
        C2["privacyGuard classifies:\nSENSITIVE"]
        C3["Blocked unconditionally\nNo DB write"]
        C1 --> C2 --> C3
    end

    subgraph path_D [Path D — Emergency Override]
        D1["Crisis detected:\nstress_index > 0.85\nor clinicalCriticality = HIGH"]
        D2["checkEmergencyFlag = true"]
        D3["All relevant health data\nshared with Doctor + Caregiver\nlogged as consent_emergency/EMERGENCY"]
        D1 --> D2 --> D3
    end
```

## V_int Social Coupling Matrix

The social prior `V_int ∈ ℝⁿˣⁿ` encodes initial alliance strength
between circle members. Current fixed priors in `shared_tensor_state.py`:

```
           Patient   Caregiver   Doctor
Patient  [  1.0       0.7         0.5  ]
Caregiver[ 0.7        1.0         0.6  ]
Doctor   [  0.5       0.6         1.0  ]
```

> **Planned extension (not yet implemented):** Hysteretic V_int that
> persists and evolves across sessions based on therapeutic alliance
> measurements. See `documentation/vision_goals.md §7.1`.

## Known Gaps (see `documentation/DISCREPANCIES.md`)

- `D1` — Escalation does not broadcast to all circle members; only `payload.userId` receives the SSE event.
- `D2` — No dedicated `consentManager.js`; consent logic is inside `privacyGuard.js`.
- `D3` — Conflict flags are per-fact-key, not per-conflict-event; multi-party disagreement history is not persisted.
