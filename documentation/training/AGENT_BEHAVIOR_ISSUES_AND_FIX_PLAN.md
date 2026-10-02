# Agent behavior: system-wide issues and proposed fixes

Date: 2026-10-02. Status: investigation and discussion only; no implementation approved or performed.

## Scope

This plan concerns the production agent and shared simulation infrastructure across all scenarios. Scenarios are independent behavioral tests; production decisions must not depend on scenario IDs or expected-answer instructions. No production behavior changes have been implemented.

The initial investigation used medication simulations as examples, then compared existing scenarios and saved transcripts. Specific test setup is documented separately in INCRETIN_SIMULATION_PLAN.md. Clinical policy changes require senior and appropriate clinical review.

Evidence comes from static code tracing and historical saved transcripts, not a fresh run of every scenario. Action logs and system labels have known inconsistencies, so findings are not an overall pass/fail score.

## Observed behavior

Existing `data/storage/local/training/training_log.jsonl` entries for the restart scenario show the patient repeatedly asking whether they can restart their previous dose that night. Replies ask about travel, missed injections, motivation, and dosing routines without resolving the question or completing a handoff.

One patient message says to let Dr. Patel know. Its recorded intent is `REPORTING_FACT|EXPRESSING_EMOTION|ASKING_QUESTION`, rather than `REQUESTING_DOCTOR`. Later entries sometimes report HIGH criticality while the conversational reply continues asking questions.

The transcript's `orchestrator_action: NONE` is not reliable evidence that no side effect occurred: the simulation adapter hardcodes that value.

## Execution path

`training/simulation/conversation_runner.js` -> `training/simulation/ai_integration.js` -> `handlers/messageHandler.js` -> `handlers/message_logic/aiAnalysisHandler.js` -> `companions/CompanionCoordinator.js` -> companion handlers and agents -> sharing/escalation handlers.

`config.js` enables companions. The examined incretin log entries also identify `system_used: companion`.

## Issues

### 1. Question gathering dominates resolution

- `prompts/companion_patient_optimizer.js` emphasizes ending with a probing question and penalties for failing to do so. Unified/model-specific prompts contain similar guidance.
- `training/simulation/scoring_constants.js` and `simulation_scorer.js` reward probing and penalize responses without questions.
- `companions/agents/patientOptimizer.js` responds to repetition by requiring a topic shift. This can move away from an unanswered patient concern.
- `companions/utils/responseStyleValidator.js` can truncate long replies to two sentences. Guidance or next steps later in a reply may be removed. Its question checks flag issues; they do not themselves regenerate the reply.

### 2. Clinical assessment is not passed to dependent components

`companions/handlers/index.js` runs clinical analysis, patient optimization, privacy decisions, and escalation concurrently after core processing. The patient optimizer and escalation manager read `context.clinicalAssessment`, but the clinical result is not inserted into their context first. They can use defaults such as "No immediate concerns" and NONE criticality.

`companions/utils/responseAggregator.js` collects clinical assessment afterward and prefers the patient optimizer's reply. It does not generate a new reply informed by the completed clinical/action decisions.

### 3. Activation and escalation propagation are incomplete

- `companions/CompanionCoordinator.js` selects clinical/escalation components using narrow keyword gates.
- Medical-content detection in `aiAnalysisHandler.js` does not explicitly recognize the new drug names or injections. Escalation activation emphasizes emergency/urgent/critical/severe wording.
- `companions/agents/escalationManager.js` creates a doctor sharing suggestion only for HIGH, although its `required` flag includes MEDIUM.
- The companion-to-analysis conversion in `aiAnalysisHandler.js` drops `escalationRequired`; downstream execution relies chiefly on criticality, intent, or sharing suggestions.

### 4. Exact intent checks miss requests

`handlers/message_logic/sharing/doctorRequests.js` requires exactly `REQUESTING_DOCTOR`. The input prompt's JSON example presents a pipe-separated intent list, and `companions/handlers/inputUnderstanding.js` accepts returned strings without enforcing one valid primary intent. Combined intent strings in the logs bypass exact-match routing.

`questionDelegation.js` supports explicit member mentions, but does not provide a general doctor-role keyword route equivalent to its caregiver routing. A reference to an external prescriber is not automatically an addressable circle member.

### 5. Scenario expectations do not configure the agent

Scenario `instructions.agent` fields document intended behavior and are read by evaluation code. They are not injected into the actual conversational agent prompt. This is appropriate for independent testing, but authors must not mistake expectations for an implemented workflow.

Prefer keeping these expectations as independent evaluation criteria when testing production behavior. Injecting them into the agent would create a guided simulation mode and should be explicitly identified as such.

### 6. Recipient setup and simulated handoff fidelity

- Patient-only scenarios have no doctor/caregiver recipient for the escalation notifier. The original medication runs used this setup; subsequent test-definition updates add a doctor but leave shared handoff limitations unresolved.
- Naming Dr. Patel in dialogue does not create a doctor member or connection.
- `training/simulation/simulation_client.js` filters non-system broadcasts and routine notifications without selected urgency keywords.
- Its synthetic doctor notification response is displayed rather than submitted through the application handler.
- Adding a doctor alone therefore does not guarantee a complete question -> doctor answer -> patient response workflow. A multi-user runner may also let the doctor speak independently of a handoff, which would not establish that the agent initiated contact.

### 7. Agent memory differs from synthetic patient memory

The companion analysis path returns before message persistence in the unified path. The single-user runner does not explicitly persist both sides as the multi-user runner does. Synthetic users maintain their own conversation history, so they may remember exchanges absent from the agent's database context.

`db/queries_messages.js` returns newest-first history. `patientOptimizer.js` uses `slice(-5)`, selecting the oldest portion of the fetched set when it contains more than five entries. Ordering must be normalized before selecting recent messages.

### 8. Deferred escalation lacks a completed transition

`criticalEvents.js` immediately escalates HIGH concerns only when emergency confidence is at least 0.9; otherwise it schedules another question. Its `escalate_after_response` metadata has no identified consumer to complete that promised transition. The handler also defaults `currentTurn` to 1, and the sharing dispatcher does not supply the actual turn.

The unified path separately escalates HIGH/CRITICAL before sharing processing, so the two analysis paths do not apply identical escalation behavior.

### 9. Action reporting and confirmations overstate execution

- `ai_integration.js` always reports NONE for orchestrator action.
- `sharing/index.js` does not propagate meaningful action results, limiting action metadata in the message-handler log.
- Doctor-request and consultation confirmations can claim notification or arrangement without verifying a recipient and delivery.
- The anonymous tier claims guidance was received immediately after recording an escalation and emitting an event, without waiting for an answer.

## How to solve

1. Run clinical assessment before escalation decisions, and generate the final patient reply using both the clinical result and actual action status.
2. Replace unconditional question-first instructions with concern resolution: address the question, state limits, provide a concrete next step, and ask only decision-relevant unanswered questions. Repetition should trigger resolution or handoff rather than topic drift.
3. Enforce valid structured outputs: one primary intent, optional secondary intents, explicit action requirements, validated recipient and payload. Preserve escalation decisions through execution.
4. Define routine review workflows separately from emergencies: affordability, tolerability, proposed schedule change, and restart after interruption. Routine review must not require emergency vocabulary.
5. Persist unresolved concerns, answered facts, and handoff state: proposed, awaiting consent, sent, awaiting reply, answered, unavailable, or failed. Track recipient and response deadline; provide a fallback when no clinician is connected.
6. Repair simulation fidelity: persist both sides, normalize history ordering, include connected clinician participants where needed, accept routine handoffs, and submit clinician replies through the real message handler.
7. Capture executed actions and delivery results rather than hardcoded NONE. Confirm only actions actually completed; distinguish a request being sent from guidance being received.
8. Evaluate resolution, appropriate referral, and handoff completion. Do not penalize a complete response solely because it ends without a question.

## General acceptance criteria and verification

- Resolve the primary concern with an answer, an explicit limitation and next step, or a real handoff.
- Ask only relevant unanswered questions; retain previous answers and unresolved concerns.
- Offer clinician contact for routine review and obtain scoped permission. An explicit contact request authorizes that request.
- Deliver a structured request to an actual recipient; process their reply and follow up with the patient.
- Verify emergency handling separately from routine referral, using an approved clinical policy.
- Report recipient absence, delivery failures, and non-response truthfully.
- Respect consent refusal and privacy boundaries; do not infer permission from synthetic speaker selection.
- Apply the same decision and action contract to companion and unified paths.

Verify across basic adherence support, routine questions, explicit doctor requests, urgent concerns, privacy, care-circle coordination, repetition, and future planning. Keep existing scenarios as independent tests and examine delivered actions alongside transcripts. Do not inject expected answers into the production agent to obtain passing scores.

## Existing scenario review

Existing scenario families already expect broader behavior than information gathering:

| Existing scenario | Expected behavior | Review focus |
| --- | --- | --- |
| medication_nonadherent | Support sustainable routines while respecting autonomy | Useful questioning followed by a practical outcome |
| caregiver_medication_alert | Address medication concerns sensitively | Concern resolution and coordination |
| chest_pain_emergency / hidden_crisis | Recognize and escalate urgent concerns | Real action, timing, and safety policy |
| full_care_circle | Coordinate patient, caregivers, and doctor with consent boundaries | Correct recipients, actual delivery, and reply propagation |
| doctor_patient_caregiver_disagreement | Coordinate differing perspectives | Resolution rather than indefinite probing |
| caregiver_limited_consent_medication / privacy_breach_caregiver | Respect sharing restrictions | Consent enforcement and unauthorized-disclosure prevention |
| future_planning_appointment_preparation / future_planning_crisis_intervention | Prepare follow-up or escalate as appropriate | Executed plans and completed transitions |

Historical evidence in data/storage/local/training/training_log.jsonl:

- Lines 7426-7427: a world-simulation patient asks whether the agent can ask the doctor if an appointment is necessary. The reply explores reservations instead; the companion record reports no sharing or escalation. The paired record has an inconsistent system label.
- A saved fall_with_injury run (1770223540317) contains two requests to ask the doctor about medication and stomach concerns. Both replies ask further questions and classify intent as ASKING_QUESTION. This supports the intent-routing concern; it does not independently establish whether every side effect was absent.
- A saved generated_anxious_patient_medication_lying run (1770291154126) asks the agent to ask a doctor about throat concerns. The reply asks about discomfort instead and records ASKING_QUESTION.

These examples establish that the concern is not unique to the newly added medication cases. They do not establish a current failure rate, demonstrate that all scenarios fail, or remove the need for medically relevant clarification. Follow-up checks should identify whether questions lead to eventual resolution and inspect persisted requests/delivery events.

Shared harness limitations also affect existing scenarios: member consent values are written as FULL by the simulator, doctor turns can be selected without delivered requests, and notification-generated replies may only be displayed. Correct these before claiming that a simulation proves scoped consent or a complete consultation.

## Proposed implementation order

1. Agree on system-wide answer/referral policy and clinically reviewed emergency handling.
2. Establish validated intent/action outputs, sequential assessment and response dependencies, and reliable memory.
3. Implement routine handoff state, scoped consent, recipient resolution, delivery status, and doctor-reply propagation.
4. Repair deferred action completion and consistency between analysis paths.
5. Align response prompts, repetition handling, and scoring with concern resolution.
6. Repair shared simulation fidelity and verify representative existing scenarios, plus the new cases.
7. Expand verification to refusal, unavailable recipients, delayed replies, failed delivery, and emergency regression checks.

## Decisions for senior review

The desired routine workflow is offer -> patient permission -> delivered clinician request -> clinician response -> patient follow-up. Production implementation remains deferred.

Open decisions include response deadlines and reminders, routing when multiple clinicians exist, external-contact fallback, clinically approved emergency overrides, and the scope of shared harness corrections. Approve production changes separately from scenario/persona setup.
