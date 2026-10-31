# False Action Claims in Agent Replies: Root Cause and Fix

*Revised 2026-10-30 after a review of the code. The revision corrects several claims, adds issues 8–12, and moves some Phase 2 work into Phase 1 so that Phase 1 works on its own. The decisions taken are recorded in Part 4.*

## Summary

On HIGH-criticality turns, agents tell patients things that never happened, for example "Help is on the way", "I've already sent for medical help and they're on their way to 123 Main Street", and "I'm escalating this to the doctor immediately".

No component of the system owns the record of what actions were actually taken:
- Eight modules write escalations, each in its own way.
- Several places write messages to the user who wrote in, without knowing about each other.
- The LLM writes its reply before any action runs, and it is never told what the system can do or what it did.

The fixed confirmation messages are also sent without checking that anyone received anything. In practice no one does: for doctors there is no live delivery path at all.

Part 1 describes the issues. Part 2 describes the fix. Part 3 lists the changes file by file, in the order they should be made. Part 4 records the decisions taken and what was deferred.

---

## Part 1: Issues

### Issue 1: The reply is written before any action runs

In `handlers/messageHandler.js`:
- `performAiAnalysis` produces `analysis.reply` (Step 2).
- `handleSharingAndEscalation` runs afterwards (Step 4).
- `analysis.reply` is then broadcast unchanged (end of the function).

When the model writes "I've notified your doctor", nothing has happened yet. The outcome of any later action is never fed back into the reply.

### Issue 2: The reply prompts give no capabilities and no action status

Three prompts write user-facing replies, and none of them is told what the system can do, what it did on this turn, or that it must not claim actions:
- **`prompts/companion_patient_optimizer.js`** (loaded by `companions/agents/patientOptimizer.js`) writes the reply for patients.
- **`prompts/companion_empathy.js`** writes the reply for caregivers, because `patientOptimizer` only runs for `role === 'patient'`. It is also the patient's reply whenever the optimizer fails and returns `null`.
- **`prompts/unified_prompt.js`** writes the reply on the unified path (see Issue 3).

Since the criticality-normalization fix, the patient prompt correctly receives HIGH plus assessments such as "potentially life-threatening, seek immediate medical attention". It is also told "Patient needs: Support, understanding, actionable steps". Asked to be supportive and give actionable steps in an emergency, the model writes what a human helper would say. When synthetic patients ask "please get help", it agrees and invents details such as addresses.

### Issue 3: The unified prompt tells the model to claim escalation

`prompts/unified_prompt.js` (around line 186) tells the model to say "This sounds serious. I'm escalating this to the doctor right away" whenever criticality is HIGH, whether or not an escalation happens or reaches anyone.

The unified path is not rare. `config.js` has `USE_COMPANIONS: true`, but the unified agent still runs whenever the companion system throws an error.

### Issue 4: Fixed confirmation messages are sent without checking delivery

- **`handlers/message_logic/sharing/criticalEvents.js`:** at confidence ≥ 0.9 it inserts an `escalations` row, emits `escalate`, and sends the patient "I'm escalating this to the doctor immediately…". It does not check that the circle has a doctor or that anyone was reached.
- **`handlers/message_logic/sharing/doctorRequests.js`:** it inserts a row and sends "I've notified the doctor… They should respond soon." It does not check that a doctor exists in the circle.
- **`handlers/message_logic/sharing/escalationTiers.js`:**
  - Tier 2 sends "I've notified your family members". The alert goes only over SSE, so a caregiver who is offline never gets it, and the alert is not stored anywhere.
  - Tier 3 sends "I've consulted with a doctor anonymously… They've provided guidance" right after logging a request. No guidance exists.
  - Tier 4 sends "I've arranged a consultation with your doctor" without checking that a doctor exists.

### Issue 5: "Notification" is not delivery

- **The `escalations` table** has `circle_id, type, details, timestamp, is_read`. It has no recipient, no delivery status and no acknowledgement.
- **The `escalate` event:** `server.js` sends it to `payload.userId` if the payload has one, and otherwise falls back to `broadcastToAll`.
  - Most emitters send only `circleId`, so the escalation goes to every connected SSE client, including users of other circles. That is a privacy leak.
  - The only emitters that include a `userId` (tiers 3 and 4 in `escalationTiers.js`) pass the patient's ID, so the "targeted" escalation goes back to the patient.
- **No live delivery to doctors exists.** Doctors see escalations only through the unread list in `routes/core.js` (`getUnreadEscalationsForUser`) and the summary command. The simulation has its own listener (`training/simulation/escalation_notification_system.js`) that alerts doctors and caregivers, so simulation results look better than production.
- **`lib/sse.js` `broadcast`** silently skips users who aren't connected and reports nothing back.
- **`notificationService.send`** already returns a result per channel, but:
  - `aiAnalysisHandler.js` calls it without waiting for the result;
  - users without preferences get the `console` channel, which writes to the server log and reports `success: true`;
  - the SMS (`TwilioProvider`) and WhatsApp (`AISensyProvider`) channels are stubs that print to the log and also report `success: true` (with `simulated: true`).
- **Nothing integrates with emergency services.**

### Issue 6: Duplicate and contradictory messages per turn

Companion path, HIGH turn:
- `messageHandler` broadcasts the model's reply.
- Separately, `criticalEvents` sends either its fixed escalation text, or (when confidence is below 0.9) "This sounds concerning. ${analysis.reply} …", which repeats the model's reply a second time.

Unified path, HIGH turn:
- `aiAnalysisHandler` writes an escalation row, notifies everyone and broadcasts the reply.
- `messageHandler` broadcasts the same reply again.
- `criticalEvents` writes a second escalation row and sends its own confirmation.

The patient receives two or three agent messages written by components that don't know about each other. For example, "help is on the way" can arrive next to "I'm escalating to the doctor".

### Issue 7: No acknowledgement loop

The only thing like an acknowledgement is `is_read`. It is set only when a doctor runs the summary command, and `markCircleEscalationsAsRead` then marks every escalation in the circle as read. No acknowledgement is recorded for a specific escalation, the patient is never told, and an unanswered HIGH escalation never notifies anyone again.

### Issue 8: HIGH turns below 0.9 confidence never escalate

Below 0.9 confidence, `criticalEvents` schedules a follow-up question tagged `action: 'escalate_after_response'`. Nothing in the codebase reads that tag, so the escalation never happens, whatever the patient answers.

When the confidence LLM call fails, `calculateEmergencyConfidence` returns 0.6. As a result, a model error also means no escalation.

*Decided 2026-10-30:* both behaviours stay (see Fix G). Below the threshold there is no escalation, and a failed confidence call keeps returning 0.6. Only the unused tag is removed.

### Issue 9: Escalations are written from eight places

`addEscalation` is called from `aiAnalysisHandler`, `criticalEvents`, `doctorRequests`, `escalationTiers`, `factReporting`, `conflictHandler`, `intentHandler` (twice), `actionExecutor` and `orchestrator`. The `escalations` table also acts as a general inbox for doctors (INFO, FACT_REPORT, CONFLICT and CONSULT rows), not only for emergencies.

### Issue 10: Sharing results never reach the message handler

`handleSharingAndEscalation` returns nothing. `messageHandler` already reads `sharingResult?.escalated`, `.shared`, `.action`, `.details` and `.consentGranted`, so these are always undefined and training logs always record `escalated: false`. The simulation works around this by reading the database (`detectExecutedActions` in `training/simulation/ai_integration.js`).

### Issue 11: The default path does not save the patient's message

`addMessage` is called from `aiAnalysisHandler` only on the unified path. No call was found on the companion path, which is the default, and `addMessage` does not return an ID either. Deduplicating escalations per message (Fix A) needs a message ID, so this has to be fixed first.

### Issue 12: The simulation sees only part of what the patient receives

The simulation adapter records `analysis.reply`, the return value of `handleMessage`. Messages sent directly by sharing handlers, such as the `criticalEvents` confirmation, never appear in simulation transcripts. Duplicates and false claims in those messages are therefore not measured.

### Why the earlier fixes made this more visible

Before the criticality fixes, HIGH rarely reached the reply prompt, so emergency language was rare. With criticality now correct, the gaps above show up on most emergency turns. The fixes did not create the problem; they exposed it.

---

## Part 2: Fix

The principle: **act first, record the outcome, then reply using only recorded facts, and verify the reply before sending it.** Statements about actions come from code, not from the model.

### Fix A: One escalation service with a delivery record
A new `services/escalationService.js` owns escalation. Patient-safety escalations go through it: HIGH emergencies, doctor requests and the escalation tiers. Routine inbox rows (INFO, FACT_REPORT, CONFLICT, CONSULT) do not (Part 4, decision 1). The service:
- creates at most one escalation per message;
- finds recipients from circle membership (doctors, then caregivers);
- sends to each recipient through the notification service, waiting up to a bounded timeout;
- records each delivery;
- returns a structured action result with the escalation ID, each recipient's name, role, channel and status (delivered, failed or pending), and whether a doctor was reached.

Twilio is out of scope for this repo, and SMS is not used. The console channel and simulated (stub) sends never count as delivered. In practice the in-app channel is the only real one. It reports "pending" when the escalation is stored in the doctor's unread list, and "delivered" when the doctor had the app open at the time it was sent (Part 4, decision 2).

### Fix B: Reorder the pipeline
The message handler runs in this order:
1. Analyze (classification only).
2. Decide on actions with deterministic rules (criticality, intent, confidence).
3. Run the actions through the service.
4. Write the reply with the action results as input.
5. Send exactly one message to the user who wrote in.

Sharing handlers stop messaging that user directly and return action results instead.

### Fix C: A fixed contract in every user-facing reply prompt
The patient optimizer, empathy and unified prompts all get the same two blocks:
- **CAPABILITIES:** what the system can and cannot do.
- **ACTIONS_TAKEN:** the action results rendered as text, or "none".

Rules:
- Describe only actions listed in ACTIONS_TAKEN, using the names and statuses given.
- Never state or imply that emergency services, an ambulance or any person is coming.
- On HIGH, the code puts the approved emergency sentence at the start of the reply. The model writes the supportive text that follows and must not change or contradict it. See "Decision: HIGH reply wording".

### Fix D: Build the final message in one place and check it before sending
`messageHandler` builds the one message sent to the user who wrote in, from three parts:
1. **Emergency sentence:** on HIGH, the approved sentence for the category. The check uses the *final* `analysis.criticality`, not the clinical agent's. The final value can differ for two reasons:
   - `resolveConflicts` takes the highest criticality from any component;
   - name matching can raise criticality after the reply is written.
2. **Model text:** the reply from the analysis.
3. **Action status sentence:** built by code from the action results. Examples: "I've sent your message to Dr. Rao in the app." or "No doctor is connected to your care circle yet."

A new `utils/actionClaimGuard.js` checks the model text only. It finds first-person action claims (I've notified, alerted, escalated, contacted, called, sent for; help is on the way; an ambulance or paramedics are coming) and checks each one against the action results:
- A doctor claim needs a delivered or pending doctor recipient.
- Ambulance and "someone is coming" claims always fail.
- Instructions to the user ("you should call 112") are not claims and must not fail.
- The approved emergency sentence is never checked, because the code inserts it after the check.

If a claim fails, the model text is regenerated once with the failure explained, once that is possible (Phase 2). Otherwise, or if regeneration fails again, a fixed text is used. Every violation is logged with the circle, user and turn, and with the message ID once one exists (Phase 2).

The check matches English only. That is enough for now: all replies are in English (Part 4, decision 5).

### Fix E: Send escalation events only to recipients
The `escalate` event carries recipient user IDs and goes only to them. The `broadcastToAll` fallback is removed. The simulation listeners are updated in the same change.

### Fix F: Acknowledgement and re-notification
- **Doctor acknowledgement:** a doctor acknowledges one specific escalation, which is recorded on their delivery row.
- **Patient update:** the patient gets a truthful follow-up ("Dr. X has seen your message").
- **Re-notification (deferred, Part 4, decision 4):** if a HIGH escalation is not acknowledged within a set time, the system alerts caregivers and tells the patient the true status. This needs a scheduler driven by the clock. `futurePlanningHandler` only runs when the user sends a message, so it can't do this.

### Fix G: Every HIGH turn has a defined escalation outcome
The existing rule stays (Part 4, decision 3): a HIGH turn escalates when its emergency confidence reaches the threshold (currently 0.9); below it, the agent asks a follow-up question and does not escalate. A failed confidence call keeps today's behaviour: it returns 0.6, which is below the threshold, so it does not escalate.

The only change is that the unused `escalate_after_response` tag is removed, so the code no longer suggests an escalation that never happens. Because replies describe only actions that were recorded, a HIGH turn without an escalation is never described as escalated.

### Fix H: Tests and metrics
- **Unit tests:** the claim check, the fallback builder and the final-message builder.
- **Integration tests:**
  - A HIGH turn in a circle with no doctor produces no reply claiming the doctor was notified.
  - A HIGH turn produces exactly one agent message and one escalation.
  - A failed delivery is never described as delivered.
- **Running the tests:** new test files must be added to the `test` script in `package.json`, which lists each file.
- **Simulation:** capture every message sent to the simulated user on each turn, not just `analysis.reply`. Measure the false-claim rate with the claim check against the action record. The target is zero.

---

## Part 3: Order of changes, file by file

Steps are grouped into phases. Each step is its own commit, and each phase can be shipped on its own. Phase 1 stops false claims, and Phase 1b tidies the confidence threshold. Phases 2 and 3 make the action record real.

### Phase 1: Stop false claims

**0a. `config/emergencyGuidance.js` (new)**
- Hold the approved emergency sentence for each HIGH category: medical emergency, self-harm risk, and violence or immediate danger. Also hold a general sentence for when the category is missing or not recognized.
- Hold the emergency and crisis numbers as per-deployment settings. For India: 112 for emergencies and Tele-MANAS 14416 for mental health. The model never supplies numbers.
- Export a function that returns the sentence for a given category.
- Note: this creates a `config/` folder next to the existing `config.js`. Imports use explicit file paths, so the two don't clash.

**0b. `prompts/companion_clinical.js`, `companions/agents/clinicalAgent.js`, `companions/utils/responseAggregator.js`, `handlers/message_logic/aiAnalysisHandler.js`**
- Add a `high_category` field to the clinical prompt's JSON output, with the allowed values MEDICAL_EMERGENCY, SELF_HARM_RISK and IMMEDIATE_DANGER. It is filled only when criticality is HIGH.
- In the clinical agent, check the value against the allowed list and treat anything else as missing.
- Carry it through the aggregator into the analysis object (`analysis.high_category`).
- The clinical agent only runs when the message matches a medical keyword. When it doesn't run, the category is missing and the general sentence is used.

**1. `utils/actionClaimGuard.js` (new)**
- Export a function that takes model text and an action-result object and returns a list of failed claims.
- Define the claim patterns (notification, escalation, contact, emergency dispatch) and the rule each one must satisfy. Match first-person claims only, not instructions to the user.
- Export a function that builds the action status sentence from an action result, including the "no doctor is connected" wording.
- Export a function that builds the fixed fallback text, used when the model text fails the check.

**2. `prompts/companion_patient_optimizer.js`**
- Add a CAPABILITIES section with the fixed list of what the system can and cannot do.
- Add an ACTIONS_TAKEN placeholder.
- Add the rules: claim only listed actions, and never imply anyone is coming. On HIGH, an approved emergency sentence will already open the message; continue after it without repeating, changing or contradicting it.
- Replace "actionable steps" with "actionable steps the patient can take themselves".

**3. `prompts/companion_empathy.js`**
- Add the same CAPABILITIES block, ACTIONS_TAKEN placeholder and rules as step 2.

**4. `companions/agents/patientOptimizer.js` and `companions/handlers/empathyHandler.js`**
- Render ACTIONS_TAKEN as "none". In Phase 1 the reply is still written before any action runs; the action status sentence from step 1 tells the user what happened.
- Do not insert the emergency sentence here; step 9 does it from the final criticality.

**5. `prompts/unified_prompt.js`**
- Remove the scripted "I'm escalating this to the doctor right away" instruction and the "I'm contacting the doctor immediately for you" example.
- Add the same CAPABILITIES block, ACTIONS_TAKEN placeholder and rules as step 2.

**6. `handlers/message_logic/aiAnalysisHandler.js`**
- Remove the reply broadcast at the end of `performAiAnalysis` (the unified path). Otherwise the unified reply reaches the user before the check in step 9 runs.
- Leave the HIGH escalation block until Phase 2.

**7. `handlers/message_logic/sharing/criticalEvents.js`, `doctorRequests.js`, `index.js`**
- `criticalEvents`:
  - Stop sending any message to the patient in either confidence branch. This removes the duplicate and the fixed "escalating to the doctor" text.
  - Keep the caregiver alert.
- `doctorRequests`:
  - Check whether the circle has a doctor before writing the escalation.
  - Stop sending the confirmation.
- Both handlers return a minimal action result: whether an escalation row was written, whether the circle has a doctor, and which caregivers were sent an alert.
- `handleSharingAndEscalation` returns that result, using the fields `messageHandler` already reads (`action`, `details`, `escalated`, `shared`, `consentGranted`) so that training logs become correct.
- Update test #4 in `tests/agent_fixes.test.js`, which expects `true`.

**8. `handlers/message_logic/sharing/escalationTiers.js`**
- Tier 2: change the message to say what happened, for example "I've sent your concern to [names] in the app."
- Tier 3: say the request was logged, not that guidance was received.
- Tier 4: check for a doctor first. If there is none, say no doctor is connected.
- These messages can also arrive through `actionResponseHandler` (the user's reply to a pending permission request), which returns before the step 9 check runs. That is why their wording is fixed here and not left to the check. Phase 2 turns them into action results.

**9. `handlers/messageHandler.js`**
- After `handleSharingAndEscalation`, build the final message as described in Fix D:
  1. the emergency sentence, from the final `analysis.criticality` and `analysis.high_category`;
  2. the model text, after the claim check;
  3. the action status sentence, from the sharing result.
- If the model text fails the check, use the fixed fallback text. Regeneration comes in Phase 2.
- Log each violation with circle, user and turn.
- Set `analysis.reply` to the final message, so that the simulation, training logs and the return value all see what the user actually received.

**10. Tests**
- Add `tests/action_claims.test.js` (node:test) and add it to the `test` script in `package.json`. It covers:
  - the claim check: true and false claims, a circle with no doctor, ambulance phrasing, and instructions such as "call 112" that must not fail;
  - the action status and fallback builders;
  - the emergency sentence chosen from the final criticality when the clinical agent said something lower;
  - `criticalEvents` sending no message to the patient;
  - `doctorRequests` in a circle with no doctor.

**Known Phase 1 limits:** these messages still bypass the check until Phase 2:
- scheduled messages and executed future plans;
- the LLM-written follow-up question from `criticalEvents`;
- replies on the pending-action path.

### Phase 1b: Confidence threshold

**11. `handlers/message_logic/sharing/criticalEvents.js`**
- Keep the rule: escalate when confidence ≥ the threshold; below it, ask the follow-up question without escalating.
- Move the threshold (0.9) into a named constant so it is set in one place.
- Keep today's behaviour when the confidence call fails (it returns 0.6, so there is no escalation).
- Remove the unused `action: 'escalate_after_response'` tag from the scheduled follow-up.

### Phase 2: A real action record and one reply per turn

**12. Saving the patient's message (`aiAnalysisHandler.js` and `db/queries_messages.js`)**
- Confirm where the companion path saves the patient's message. If it doesn't, save it.
- Make `addMessage` return the new message ID.

**13. `db/schema.js`**
- Add `status` (OPEN, ACKNOWLEDGED, RESOLVED) and `message_id` columns to `escalations`.
- Add an `escalation_deliveries` table with escalation ID, user ID, role, channel, status, provider message ID, error, sent time and acknowledged time.
- Add the migration to the existing `migrateDatabase`.

**14. `db/queries_actions.js`**
- Change `addEscalation` to return the new escalation ID and refuse a duplicate for the same message.
- Add queries to insert and update delivery rows, fetch deliveries for an escalation, and acknowledge one escalation for one user.

**15. `notifications/NotificationService.js`, `lib/sse.js`**
- Mark the `console` channel and simulated (stub) sends as non-delivering. Twilio is not used.
- Add the in-app channel: "pending" when the escalation is stored for the doctor's unread list, "delivered" when the doctor's SSE connection was open at send time.
- Make `broadcast` return which users were connected.

**16. `services/escalationService.js` (new)**
- Implement `escalate` as described in Fix A:
  - deduplicate on message ID;
  - find recipients;
  - send to each, waiting for the result with a timeout;
  - record each delivery;
  - return the action result.
- Move the patient-safety callers onto the service: `criticalEvents`, `doctorRequests` and `escalationTiers`. The HIGH block in `aiAnalysisHandler` is removed in step 17.
- The other `addEscalation` callers (`factReporting`, `conflictHandler`, `intentHandler`, `actionExecutor`, `orchestrator`) keep writing inbox rows directly, through one shared insert function so that every row gets `message_id` and `status`.

**17. `handlers/message_logic/aiAnalysisHandler.js`**
- Remove the HIGH escalation block (row insert, `escalate` event and per-member notifications). The function only analyzes and returns the analysis.
- Remove the second `updateUserState` call (`messageHandler` already does it).

**18. `handlers/message_logic/sharing/criticalEvents.js`, `doctorRequests.js`, `escalationTiers.js`**
- Call the escalation service and return its action result.
- `escalationTiers` stops sending messages to the patient. The pending-action path in `actionResponseHandler` builds its reply from the action result in the same way.

**19. `handlers/message_logic/sharing/index.js`**
- Return the full action result from whichever handler ran.

**20. `companions/agents/patientOptimizer.js`, `companions/handlers/empathyHandler.js` and the companion reply path**
- Split reply generation from analysis, so the reply can be written after the actions run, with the real action results.
- Export the reply function so `messageHandler` can regenerate once.

**21. `handlers/messageHandler.js`**
- Reorder the steps:
  1. analyze;
  2. run sharing and escalation;
  3. write the reply with the action results;
  4. run the claim check, regenerating once if it fails;
  5. build the final message and send it.
- Run scheduled messages and executed future plans through the same check.

**22. Tests and simulation**
- Add the integration tests from Fix H.
- Change the simulation adapter (`training/simulation/ai_integration.js`) to collect every `broadcast` event sent to the simulated user during a turn.

### Phase 2: as implemented (2026-10-31)

Steps 12–22 are done. Where the code differs from the steps above, or goes further, it is listed here.

**Saving the message (step 12)**
- The companion path never saved the user's message. `messageHandler` now saves it after analysis for both paths, with the final criticality, and puts the ID on `analysis.message_id`.
- The turn count includes the message just saved, as it already did on the unified path and in simulations.
- The simulation runner no longer saves regular user messages, which would now be stored twice. It still saves commands.
- Messages handled before analysis (pending-action answers, questions to another member) are still not saved. That is unchanged from production.

**Escalation records (steps 13–14)**
- Deduplication is in `addEscalationOnce`, not `addEscalation`. It only counts the five patient-safety types (CRITICAL, DOCTOR_REQUEST, CAREGIVER_NOTIFICATION, ANONYMOUS_CONSULTATION, CONSULTATION), so a routine row from the same message does not block a safety escalation.
- `addEscalation` is the shared insert: every row gets `status = OPEN`. FACT_REPORT and CONFLICT rows also get the message ID. The other routine callers have no message ID to pass, so theirs is empty.

**In-app channel (step 15)**
- `NotificationService.sendInApp` stores an in-app notification and reports delivered, pending or failed.
- Doctors also keep seeing the escalation row in their unread list, as before.

**Escalation service (steps 16–18)**
- Every send has a 5-second limit. A send that fails or times out is recorded as failed and never counted as reaching anyone. The status sentence then says "I couldn't send this to …".
- Tier 3 reports "anonymous consultation logged" from the action record.
- The HIGH block in `aiAnalysisHandler` is removed. Unified HIGH turns now escalate only through `criticalEvents`, at the same confidence threshold as companion turns.

**Sharing results (step 19, beyond the plan)**
- Every sharing handler returns a result, not only the safety ones:
  - fact reports;
  - advice sharing;
  - fallback sharing;
  - the tier 1 permission request.
- Fact reports no longer send their own "will share it with the doctor" message.
- Consent and permission questions are returned as a `question`. It goes at the end of the one reply, after a claim check, and is dropped if it claims an action.
- The pending-permission path sends one reply built from what the tier did. Two existing bugs on this path are also fixed:
  - answers are matched on whole words ("I took my pills" was read as "ok");
  - the pending question is removed once answered (it used to capture every later message).
- The null-fact crash in `factReporting` and `adviceSharing` (open problem 5 in the results doc) is fixed.

**Reply after actions (steps 20–21)**
- The draft reply from analysis is kept when nothing was done. Its ACTIONS_TAKEN was "none", which is then true.
- The reply is written again, with the real ACTIONS_TAKEN, only when one of these holds:
  - a handler acted or returned a question;
  - a scheduled message is due;
  - a planned follow-up is due.

  So the extra model call happens only on those turns.
- The new ACTIONS_TAKEN text also tells the model:
  - that the code adds the status sentence, so it should not repeat it;
  - which question will be appended, so it should not ask another one.
- A reply that still claims an action that did not happen is regenerated once, with the false sentence quoted. The fallback text is used only if that also fails.
- Patients get the patient optimizer and other roles get the empathy handler, as in analysis. The companion path reuses the context its handlers saw. The unified path uses a minimal context, so its rewritten replies are in the companion style.
- Due plans and scheduled messages:
  - A plan's description is an internal note. The reply works it in instead of the orchestrator sending the raw text. Escalation plans still act as before.
  - Scheduled messages for the user who wrote in are added to the reply.
  - Scheduled messages for other members are still sent, but dropped if they claim an action.
- The simulation runner no longer processes due plans a second time after each turn.

**Simulation (step 22)**
- `SimulationAI.getAgentResponse` returns `messages_to_user`, with every message sent to the simulated user during the turn.

**Still outside the one-reply path**
- The doctor message path.
- `handleNonDoctorQuestion` (questions to another member).
- Caregiver probing messages to other members.
- The ack follow-up and targeted `escalate` events (Phase 3).

### Phase 3: Targeted delivery and acknowledgements

**23. `services/escalationService.js`**
- Emit `escalate` with each recipient's user ID and the escalation ID.

**24. `server.js`, `training/simulation/escalation_notification_system.js`, `training/simulation/simulation_event_handler.js`**
- Remove the `broadcastToAll` fallback in the `escalate` listener.
- Send only to the listed recipients, and log an error if none are given.
- Update the simulation listeners to the new payload in the same commit.

**25. `db/queries_actions.js`, `handlers/commands/commandHelpers.js`, `routes/core.js`**
- Replace the circle-wide `markCircleEscalationsAsRead` with acknowledgement of a specific escalation by a specific doctor.
- Update the summary command to acknowledge only the escalations it showed.
- Base the unread list on delivery rows.
- When a doctor acknowledges an escalation, send the patient a follow-up naming who acknowledged it. This runs on the acknowledgement itself and needs no scheduler.

**26. Simulation metric (`training/simulation/ai_integration.js`)**
- Add the false-claim rate, computed with the claim check against the recorded deliveries.
- Re-run the Scout and Maverick suites and add the results to `AGENT_FIXES_SIMULATION_RESULTS.md`.

---

## Part 4: Decisions

### Decision: HIGH reply wording

Decided 2026-10-30. Every HIGH reply opens with a fixed, approved emergency sentence that depends on the kind of HIGH. The model writes the supportive text after it, under the Fix C rules.

**The sentence for each category:**
- **Medical emergency:** call the emergency number (112) or go to the nearest emergency department now.
- **Self-harm risk:** call 112, or Tele-MANAS on 14416 to talk to someone now.
- **Violence or immediate danger:** get to a safe place and call 112.
- **Category missing or not recognized:** "If you are in danger or this feels like an emergency, call 112 now."

**How it works:**
- The clinical agent gives the category (step 0b).
- The sentences and numbers live in `config/emergencyGuidance.js` (step 0a).
- `messageHandler` inserts the sentence based on the final criticality (step 9). The model never writes it, and the claim check does not check it.

**Options not chosen:**
- One sentence for every HIGH: it doesn't fit self-harm or danger situations. It is kept only as the general sentence.
- Wording that depends on confidence: it delays the instruction when the confidence score is wrong.
- Fully model-written wording: it can't be approved in advance.

**Still needed before Phase 1 ships:**
- Clinical review of the final wording of each sentence.
- Confirmation of the numbers for each deployment region.

### Other decisions (all 2026-10-30)

1. **Scope of the escalation service.** Only patient-safety escalations go through the service: HIGH emergencies, doctor requests and the escalation tiers. The routine inbox rows (INFO, FACT_REPORT, CONFLICT, CONSULT) stay as they are, with no delivery record. They are written through one shared insert function so that every row gets `message_id` and `status`.
   - *Reason:* no message to the patient depends on the inbox rows, so tracking their delivery adds work with no benefit.
2. **Delivery states for the in-app channel:**
   - **pending:** the escalation is stored and will appear in the doctor's unread list;
   - **delivered:** the doctor's SSE connection was open when it was sent;
   - **acknowledged:** the doctor acknowledged that specific escalation (Phase 3).
   - *Reason:* most users have no notification preferences and the SMS and WhatsApp providers are stubs, so the in-app channel is the only one that actually reaches anyone.
3. **HIGH turns and the confidence threshold.** The existing rule stays:
   - a HIGH turn escalates when confidence reaches the threshold (0.9);
   - below it, the agent asks a follow-up and does not escalate;
   - a failed confidence call keeps today's behaviour (0.6, so no escalation).

   Replies only describe recorded actions, so a HIGH turn that was not escalated is never described as escalated.
4. **Re-notification is deferred.** No timer-based re-notification is built in this plan. If a doctor does not acknowledge a HIGH escalation, nobody is reminded and the patient is not told. If it is picked up later, it needs a scheduler driven by the clock (nothing in the codebase runs on a timer apart from the SSE heartbeat). The choice is between:
   - a timer inside the server process, which reloads pending checks from the database on restart; or
   - an external job.

   The acknowledgement follow-up to the patient (Phase 3, step 25) does not depend on this and is still built.
5. **Reply language.** All replies are in English for now, so the claim check matches English only. Revisit if other languages are added.

**Out of scope:** Twilio and SMS are not used in this repo.
