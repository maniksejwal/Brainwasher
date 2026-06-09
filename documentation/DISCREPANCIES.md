# Known Discrepancies, Implementation Gaps, and Design Debt

> **Purpose:** Tracks every known mismatch between the intended design,
> the documentation, and the actual codebase. Items are numbered for
> cross-referencing across documentation files.
>
> **Status legend:**
> - 🔴 Not addressed — code gap exists, no fix in progress
> - 🟡 Documented — gap is known, plan exists, not yet implemented
> - 🟢 Resolved — fixed in codebase and documentation

---

## D1 — Escalation `server.js` handler was misunderstood as a notification gap

| Field | Value |
|-------|-------|
| Severity | **RESOLVED** — original analysis was incorrect |
| Status | 🟢 Closed — see note below |
| Files | `server.js`, `handlers/message_logic/sharing/escalationTiers.js` |
| Discovered | 2026-06-08 code audit |
| Corrected | 2026-06-09 |

### Correction

The original D1 entry claimed escalation notifications did not reach care circle members
other than the triggering user. This was based on reading `server.js` in isolation.

**Escalations are not broadcasts — they are directed sharing actions.** The actual
member notifications are already sent by `escalationTiers.js` *before* the `escalate`
event fires:

- **Tier 2**: `handleTier2Caregiver()` — delivers alert to caregivers only (`role='caregiver'`)
- **Tier 3**: `handleTier3Anonymous()` — anonymous consultation, patient identity withheld
- **Tier 4**: `handleTier4Consultation()` — full context, doctor-targeted

The `escalate` event in `server.js` is a **secondary SSE confirmation push** back to
the triggering user only. Blasting all circle members here would:
1. Duplicate notifications already sent by the tier handlers
2. Break Tier 3 anonymity by re-sending patient-linked payload to all members

### Current state (correct behaviour)

`server.js` sends the `escalate` SSE only to `payload.userId` (the triggering user),
and strips `...payload` when `anonymous: true` to protect Tier 3 identity.

The real gap (if any) is whether `escalationTiers.js` tier routing uses
`consentManager.evaluateConsent()` before sharing clinical content with caregivers
— this is a future hardening item, not a current bug.

---

## D2 — privacyGuard.js conflates privacy classification with consent management

| Field | Value |
|-------|-------|
| Severity | **MEDIUM** — architectural design debt |
| Status | 🟢 Resolved — `companions/handlers/consentManager.js` created; `privacyGuard.js` refactored to pure classifier |
| Files | `companions/handlers/privacyGuard.js`, `companions/handlers/consentManager.js` |
| Discovered | 2026-06-08 code audit |

### Description

`privacyGuard.js` currently performs two logically distinct tasks:

1. **Privacy classification** (stateless): Given a message and circle
   context, classify the content as PUBLIC / PRIVATE / SENSITIVE.
   Output: `privacyLevel`.

2. **Consent management** (stateful, DB-dependent): Given the
   classification result and a proposed sharing target, check whether
   consent has been granted (via `consent_level` DB field or
   `getImpliedConsent()`), and determine whether explicit consent is
   required. Output: `sharingSuggestion.requiresConsent`.

These two concerns are implemented in a single 225-line file with a
private `_consentGate()` function (lines 189–225). This means:

- Privacy classification cannot be tested without a DB (because
  `_consentGate()` always calls `getCircleMembers()` + `getImpliedConsent()`)
- Consent checks cannot be triggered by other parts of the system
  (e.g. the escalation path) without going through the privacy classifier
- The consent taxonomy (NONE/LIMITED/FULL/EMERGENCY from the privacyGuard
  LLM output) is different from the consent taxonomy stored in the DB
  (`consent_level` = 'none' | 'full'). This mismatch is undocumented.

### Intended design (user intent)

Two separate modules:

```
privacyGuard.js       — LLM-based content classifier
                        Input: message, circle context
                        Output: PUBLIC | PRIVATE | SENSITIVE
                        (stateless, no DB calls)

consentManager.js     — DB-backed consent gate
                        Input: target, topic, privacyLevel, circleId, userId
                        Output: { allowed, requiresExplicit, impliedTopics }
                        (stateful, reads consent_level + implied_consent)
```

### Impact

- The `consent_management_v2_real_modules.md` UML diagram shows
  `privacyGuard.js` performing both roles, which is accurate to the
  implementation but should note this as a design debt.
- The PDF revision (§4.x care circle) should describe both concepts
  separately even if they are currently in one module.

### Recommended split (see §consent-plan below)

---

## D3 — Conflict flag is per-fact-key, not per-conflict-event

| Field | Value |
|-------|-------|
| Severity | **LOW** — data completeness gap |
| Status | 🟢 Resolved — `fact_conflicts` table added to schema.js; `recordFactConflict`, `getFactConflicts`, `resolveFactConflict` added to `db/queries_facts.js`; `conflictHandler.js` wired to record every conflict event with message text references |
| Files | `db/schema.js`, `db/queries_facts.js`, `handlers/message_logic/conflictHandler.js` |
| Discovered | 2026-06-08 code audit |

### Description

When a fact conflict is detected, the code does:

```js
coord->>facts_db: upsertFact(circleId, claimedFact, conflictFlag: true)
```

The `conflictFlag` is a boolean on the `facts_v2` row, keyed by
`(circleId, subjectId, fact_key)`. Because this is an `INSERT OR REPLACE`
(upsert), a second conflict on the same `fact_key` simply overwrites the
existing row. There is no history of how many times a fact was disputed,
who disputed it, or what the resolution was.

### Example of the problem

```
Turn 10: Caregiver says "Patient took medication" → fact_key=medication_adherence, value=true
Turn 12: Patient says "I didn't take it" → conflictFlag=true, value=false (overwrites)
Turn 15: Caregiver says "I saw them take it" → conflictFlag=true, value=true (overwrites again)
```

After turn 15, the fact table shows one row with `conflictFlag=true,
value=true`. The two prior conflicts are gone.

### Recommended fix

Add a `fact_conflicts` table:

```sql
CREATE TABLE fact_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    reporter_user_id TEXT NOT NULL,
    claimed_value TEXT NOT NULL,
    existing_value TEXT,
    conflict_detected_at INTEGER NOT NULL,
    resolved BOOLEAN DEFAULT 0,
    resolution_notes TEXT,
    FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id)
);
```

This preserves full conflict history and enables resolution tracking
without breaking the existing `facts_v2` schema.

---

## D4 — Exp 7 training instability (arm_inertial_hpvoot_physio_llm_cot_mcts)

| Field | Value |
|-------|-------|
| Severity | **MEDIUM** — research validity concern |
| Status | 🔴 Not investigated |
| Files | `tensornets/runs/run_018/arm_inertial_hpvoot_physio_llm_cot_mcts/` |
| Discovered | 2026-06-08 run_018 analysis |

### Description

In `run_018`, Exp 7 shows a success rate of 16.4% (87/531) compared to
27.5–38.6% for all other arms. Its actor checkpoint is stuck at step 100
(vs 500–561 for all other arms), suggesting the training process either:

1. **Policy collapsed** — a gradient explosion or NaN loss caused the
   actor weights to become degenerate. Checkpointing at step 100
   followed by continued episode generation without checkpoint updates
   would produce this pattern.
2. **HPVOOT + LLM interaction failure** — the HPVOOT planner produces
   a hierarchical plan structure that is serialised into the LLM CoT
   prompt. If the structure is malformed, Maverick scores the responses
   as low quality, causing reward collapse.
3. **Latency ceiling** — HPVOOT + inertial MPS + LLM CoT is the
   highest-latency arm. If FastAPI calls time out, the worker records
   failed episodes (counted in `ep_count` but not `successful_eps`),
   inflating the denominator.

### Investigation needed

1. Read `arm_inertial_hpvoot_physio_llm_cot_mcts/checkpoints/run_state.json`
   — check `last_improved_at` and `cumulative_reward`.
2. Sample 5–10 episode JSONL files from this arm — check whether
   `reward.goal_progress` values are near-zero or if episodes are
   terminating early.
3. Compare `actor_10.json` vs `actor_100.json` weight magnitude to
   detect NaN or explosion.
4. Check FastAPI logs for timeout errors on HPVOOT calls.

### Impact on paper

Exp 7 results cannot be included in the confirmatory analysis until the
root cause is understood. The PDF empirical section should note this
anomaly explicitly (already added to `docs/tensornets/pdf_revision_instructions.md §B3`).

---

## D5 — Manual escalation not modelled in escalation flow diagram

| Field | Value |
|-------|-------|
| Severity | **MEDIUM** — documentation gap |
| Status | 🟡 Documented — fix needed in escalation_flow_v2_real_modules.md |
| Files | `documentation/uml_diagrams/escalation_flow_v2_real_modules.md` |
| Discovered | 2026-06-08 user review |

### Description

The v2 escalation flow diagram models two automated escalation paths
(MCTS-driven and `future_plan_executed`). It does not model the user-
initiated escalation path: a user explicitly requesting to contact their
doctor ("I want to speak to my doctor", "This feels like an emergency").

The v1 diagram (`escalation_flow_v1_original.md`) correctly modelled
this as the primary path: `User->>Agent: Report critical health event`.

The `escalationManager.js` also handles this via `clinicalCriticality`
from the `clinicalAgent.js` — which detects HIGH/MEDIUM criticality
from message content (e.g. chest pain keywords). This is triggered by
the user's message, not by MCTS, making it effectively a user-initiated
path even though it is mediated by an LLM classifier.

### Fix needed

Add a third path to the escalation flow v2 diagram:

```
Path C — User-initiated / clinicalAgent-triggered:
  User says "I have chest pain" → clinicalAgent assesses HIGH
  → escalationManager.processEscalation() → orchestrator.emit("escalate")
  → (same SSE broadcast path as Path A)
```

---

## D6 — "PersonalAgent" and "CareAgent" are role abstractions, not fictional

| Field | Value |
|-------|-------|
| Severity | **LOW** — documentation clarity |
| Status | 🟢 Resolved — all `*_v2_real_modules.md` preambles and footers updated |
| Files | All `*_v2_real_modules.md` files |
| Discovered | 2026-06-08 user review |

### Description

The v2 prologue tables describe v1 names like `PersonalAgent` and
`CareAgent B` as "fictional participant names." This is inaccurate.
They represent real role-specific agent instantiations — the design
intent was correct. The issue is naming granularity: the code uses
`CompanionCoordinator.js` with a `role` parameter rather than separate
`PersonalAgent.js` and `CareAgent.js` files.

Similarly, `Doctor`, `Family`, `Caregivers` in the v1 diagrams are real
user roles (`role=doctor`, `role=caregiver`) stored in `circle_members`.
They are SSE-connected clients who should receive broadcasts. The v2
diagrams incorrectly described these as absent when in fact they are the
intended recipients.

### Fix needed

Replace "Fictional" with "Role abstractions / design-intent names" in
the v2 prologue tables, and clarify that the v1 names map to `role`
values in the `circle_members` table, not to separate module files.

---

## D7 — docs/tensornets/pdf_revision_instructions.md — consent taxonomy inconsistency

| Field | Value |
|-------|-------|
| Severity | **LOW** — paper accuracy |
| Status | 🟡 Documented — needs fix in Part B2 of pdf_revision_instructions.md |
| Discovered | 2026-06-08 user review |

### Description

The PDF care circle section (Part B2 in `pdf_revision_instructions.md`)
lists the consent taxonomy as NONE / LIMITED / FULL / EMERGENCY.
This is the `privacyLevel` classification output from the LLM in
`privacyGuard.js`, not the consent level stored in the database
(`consent_level` = `none` | `full` | `limited`).

The paper should distinguish:
- **Privacy classification** (content-level): PUBLIC / PRIVATE / SENSITIVE
- **Consent level** (relationship-level, per DB): none / limited / full
- **Emergency override** (situation-level): bypasses both above

The v1 diagram terminology (Implied / Explicit / No Consent) maps more
directly to the DB consent_level concept and should not be discarded
from the paper.

---

## Appendix: Plan for privacyGuard / consentManager separation (D2)

### Proposed module split

**`companions/handlers/privacyGuard.js` (revised — classifier only)**

```js
/**
 * Classifies message content as PUBLIC | PRIVATE | SENSITIVE.
 * Stateless — no DB calls. Takes pre-fetched memberListText.
 *
 * @param {string} message
 * @param {string} role
 * @param {string} memberListText  — pre-fetched by coordinator
 * @param {string} recentHistory   — last 3 turns
 * @param {string} circleType      — 'care' | 'professional'
 * @returns {Promise<{ level: string, sharingSuggestion: object|null, reasoning: string }>}
 */
export async function classifyPrivacy(message, role, memberListText, recentHistory, circleType)
```

**`companions/handlers/consentManager.js` (new)**

```js
/**
 * Consent gate — checks whether a proposed sharing action is allowed.
 *
 * Three tiers (in order of precedence):
 *   1. Emergency override: checkEmergencyFlag(circleId) → bypass all gates
 *   2. Implied consent:    getImpliedConsent(userId, circleId, topic) → allow
 *   3. Explicit consent:   consent_level DB field → 'full' allows, 'none' requires request
 *
 * @param {object} sharingSuggestion  — { target, reason, content_to_share }
 * @param {string} userId             — requesting user
 * @param {string} circleId
 * @param {object} inputUnderstanding — { facts, intent, mentionedUsernames }
 * @param {Array}  members            — pre-fetched circle_members rows
 * @param {Array}  resolvedUsers      — pre-resolved user objects
 * @returns {Promise<object>} sharingSuggestion with requiresConsent flag,
 *                            or null if blocked
 */
export async function evaluateConsent(sharingSuggestion, userId, circleId, inputUnderstanding, members, resolvedUsers)

/**
 * Records a consent decision (granted/denied/pending/emergency)
 * in db/queries_interventions.js.
 */
export async function logConsentDecision(circleId, userId, targetRole, level, status)

/**
 * Checks the emergency flag for a circle (from circle record or
 * a system-level trigger). Returns { emergency: bool, authorizedBy }.
 */
export async function checkEmergencyFlag(circleId)
```

### Migration path

1. Extract `_consentGate()` from `privacyGuard.js` into `consentManager.js`
   as `evaluateConsent()`.
2. Extract the emergency check into `consentManager.checkEmergencyFlag()`.
3. Add `logConsentDecision()` to replace the inline
   `db/queries_interventions.js` calls scattered in the coordinator.
4. Update `CompanionCoordinator.js` to call both modules sequentially:
   ```js
   const privacy = await classifyPrivacy(message, role, memberListText, history, circleType);
   const consent = await evaluateConsent(privacy.sharingSuggestion, userId, circleId, ...);
   ```
5. Update `env_05_care_circle_social_graph.md` and
   `consent_management_v2_real_modules.md` to show both modules.

### Consent taxonomy reconciliation

| Concept | Source | Values |
|---------|--------|--------|
| Privacy level (content) | `privacyGuard.js` LLM output | PUBLIC / PRIVATE / SENSITIVE |
| Consent level (relationship) | `circle_members.consent_level` DB | none / limited / full |
| Sharing gate decision | `consentManager.evaluateConsent()` | allowed / requiresExplicit / blocked |
| Override | `consentManager.checkEmergencyFlag()` | emergency (bypasses all gates) |
| Implied consent | `getImpliedConsent(userId, circleId, topic)` | true / false per topic |

This maps cleanly to the v1 taxonomy:
- v1 "Implied Consent" → `getImpliedConsent()` = true
- v1 "Explicit Consent Required" → `consent_level = none` + `requiresExplicit = true`
- v1 "No Consent" → `privacyLevel = SENSITIVE` (blocked before consent check)
- v1 "Emergency" → `checkEmergencyFlag()` = true (bypass)
