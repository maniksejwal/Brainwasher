# Porting tensornetsfreeze Agent Improvements to `feat/agent-behavior-improvements`

**Date**: 2026-11-06 (replaces the plan of 2026-10-26)
**Source**: `origin/tensornetsfreeze` @ `bf4f49c` (2026-09-28). It contains all of `origin/tensornets` plus 18 commits.
**Target**: `feat/agent-behavior-improvements`, continuing on the same branch
**Related**: `documentation/training/AGENT_BEHAVIOR_ISSUES_AND_FIX_PLAN.md`, `FALSE_ACTION_CLAIMS_ROOT_CAUSE_AND_FIX.md`

Status: items 0 to 8 are ported (uncommitted); see the "as built" sections. Open items are listed under "Related open items" (sharing restrictions) and "Open questions". Line numbers below refer to the two commits above.

---

## What changed since the last plan

| Change | Effect on this plan |
|---|---|
| The source is now `tensornetsfreeze`, not `tensornets` @ `73ecd8e`. | Port from the newer code. |
| Exp 0p exists on the source (`OldschoolDPOWorker`). | Added as item 3, in JS, using live data. |
| The target now separates a draft reply from the final reply: `replyWriter.js` rewrites the reply after actions run, using `analysis.replyContext`. | Facts and the selected action must be in that context, or the final reply loses them. |
| The target runs `clinicalAgent` as its own stage in `companions/handlers/index.js`, before the optimizers. | The action selector now has an obvious place: straight after that stage. |
| The target has `ACTION_CONTRACT`, `ACTIONS_TAKEN`, the false claim guard and proposal-based escalation. | Never overwrite these files or prompts with the source versions. |
| Facts are to go into the **reply prompt** as well as the selector (decision of 2026-11-06). | Exp 0p itself never did this, so this goes beyond the experiment and needs its own measurement. |

## Already fixed on the target (do not port)

| Fix | Where |
|---|---|
| History order in the companion context (old D8; behaviour doc fix A) | `aiAnalysisHandler.js`, `replyWriter.js` |
| Clinical assessment reaches its dependents (fix B) | `companions/handlers/index.js` |
| Combined intents such as `REPORTING_FACT\|REQUESTING_DOCTOR` (fix C) | `doctorRequests.js`, `privacyGuard.js` |
| One checked reply per turn, written after actions, with no false action claims | `replyWriter.js`, `actionClaimGuard.js`, `action_contract.js` |
| Single escalation service, delivery tracking, asking before alerting | escalation service and related queries |

## Defects: current status

| # | Defect | Status on source | What to do |
|---|---|---|---|
| D1 | `currentTurn` used before its declaration stopped the selector running | **Fixed** | Keep the source's early declaration |
| D2 | Selector runs after `processCompanionHandlers`, so the optimizer has already replied | **Open** | Run it in the handler stages (item 2) |
| D3 | Known facts only reach the selector prompt | **Open** | Add them to the reply prompt (item 3) |
| D4 | `_formatHistory` reads `m.role`, but rows have `user_id`, so every line says "Patient" | **Open** | Label by `user_id === userId` |
| D5 | Empathy prompt has no `{{PHYSIO_CONTEXT}}` or `{{STRESS_OVERRIDE}}` | **Open** | Add the slots (item 6) |
| D6 | Production never sets `physioState`, `stressLevel`, `priorCriticality`, `escalationActive` | **Open** | Set the last two (item 5); the physio paths stay inactive |
| D7 | Fact retrieval matches `subject_id = userId`, but the guard writes `'self'` | **Not a problem on target** | `conflictHandler.js` stores `'self'` as the speaker's user ID, so no change. Do not match `'self'` in retrieval. |
| D13 | The analogy block never runs in the companion path, and its `addFact` omits the required `reportedBy` | **Fixed in port** | Asked for in input understanding; `selfReference.js` |
| D8 | `historyAnalyzer.js` and `doctorOptimizer.js` fetch history themselves, newest first | **Partly fixed on target** | `historyAnalyzer` uses `slice(-5)` on that list, so it reads the oldest messages. Fix it first. Check `doctorOptimizer`. |
| D9 | privacyGuard can make a second LLM call in the coordinator's rerun | **Open** | Rerun only if the first result is missing |
| D10 | Selector calls `processUserMessage`, running the whole unified pipeline on its prompt | **Open** | Use `makeApiCall` + `parseCompanionResponse` |
| D11 | Selector output `response_depth`, `secondary_action` and `strategy_note` is never read, and no reply prompt has a slot for the selected action | **Open** | Add slots and pass them through (item 2) |
| D12 | `getLongitudinalHint` has no timeout, and the selector also calls the Python RAG server every turn | **Open** | Make Python calls optional and time-limited (item 1) |

---

## The Python worker: do we rebuild it in JS?

**No. Only one small part of it is needed, and that part is rewritten against live data.**

`OldschoolDPOWorker` (`tensornets/tensornets/a3c/arms.py:2836`) is a test harness, not part of the companion. For each simulated turn it:

1. reads a simulated patient's state (`TurnState`);
2. turns that state into a short text with `_build_dpo_prompt_vars`;
3. sends the message and text to the JS companion at `POST /api/benchmark/message`;
4. computes a synthetic reward and next stress value for the A3C training run.

| Worker part | Rebuild in JS? | Reason |
|---|---|---|
| A3C worker class, reward, stress simulation | **No** | Training and benchmarking only. The live app has real patients and no reward. |
| `node_client.py` and the `/benchmark/message` route | **No** | Plumbing for Python to reach JS. In production the facts are built inside JS. |
| `extraContext` option through `handleMessage` | **No** | Replaced by building facts in `aiAnalysisHandler.js`. |
| `skipPrivacyGuard` option | **Never** | A safety-removal switch for experiments; must not reach production code. |
| `_build_dpo_prompt_vars` | **Rewrite as `buildPatientFacts`** | Its values come from the simulator, so they must come from real data here. |
| Keyword sentiment guess | **Replace** | The companion already assesses this each turn with an LLM. |

**The Python server stays optional.** `tensornetsBridge.js` works without it, and the first version of this port does not need it.

**Limit of the evidence:** `TODO.md` says Exp 0p beats Exp 0, but no numbers were found in the docs, and its leakage check (AUDIT4) is still open. Exp 0p also tested simulated values going only to the selector. Treat its result as a reason to try this, not as proof it will work. Item 8 measures it.

---

## Scope

| # | Item | Depends on |
|---|---|---|
| 0 | Small fix: D8 | none |
| 1 | Fact retrieval and optional longitudinal hint | 0 |
| 2 | Action selector | 1 |
| 3 | Exp 0p: patient facts in selector and reply prompts | 1, 2 |
| 4 | Self-reference guard and analogy observation | none (should precede 1 in use, see D7) |
| 5 | clinicalAgent changes | 4; needs senior review |
| 6 | privacyGuard LLM and empathy physio | 1; needs senior review |
| 7 | Prompt conflict: probing questions | 2 |
| 8 | Measurement | all |

**Excluded**: MCTS, A3C and everything under `tensornets/` (including run state); the `/benchmark/message` route and benchmark dashboard; the intervention queue and `surface_intervention` (needs a table and a cross-user producer, so it's a separate feature); TensorRAG calls; business and professional circles; document integration; `CompanionConfidentialComm`; the `CompanionCoordinator` class; MCTS reply rescoring; CLI and GUI changes; persona and scenario reshuffles.

**Do not take**: the deletion of `incretin_personas.js` / `incretin_scenarios.js`; the deletion of `data/dbs/care_circle_dev.db`; any source version of `prompts/companion_patient_optimizer.js` that drops `ACTION_CONTRACT` or `ACTIONS_TAKEN`.

**Method**: do not merge or cherry-pick. Port by hand: `git show origin/tensornetsfreeze:<path>` for new files and `git diff HEAD origin/tensornetsfreeze -- <path>` for edits, keeping only the hunks listed here. The source commits were not accompanied by new tests, so each item adds its own to `tests/agent_fixes.test.js` or a new test file.

---

## Item 0: Small fixes

- **D8**: in `companions/handlers/historyAnalyzer.js`, use `context.history` when present, or reverse the fetched rows. Check `doctorOptimizer.js` for the same problem.
- **Bedrock timeout**: not needed. `llama.js` on the target has no Bedrock client, and `agents/api/providers/bedrock.js` already times out at 120 seconds.

## Item 1: Fact retrieval and longitudinal hint

- **`db/queries_facts.js`**: add `retrieveRelevantFacts()` and its helpers. Leave `addFact` and `getCurrentFact` alone. `facts_v2` already has the columns it uses. Apply D7.
- **Add** `companions/physio/state.js` and `companions/physio/tensornetsBridge.js`.
- **D12**: add `AbortSignal.timeout(TIMEOUT_MS)` to `getLongitudinalHint`, and call the bridge only when `TENSORNETS_URL` is set, so a normal deployment makes no failed request each turn.
- **`aiAnalysisHandler.js`**: load the facts where `conversationContext` is built and add `knownContextBlock` and `longitudinalHint` to it, so every handler and the final reply can see them.
- **Subjectless facts**: input understanding returns plain `key: value` facts, which are stored with no `subject_id`, and retrieval accepts those for anyone. A caregiver's statement could then be presented as known about the patient, so check this when building the block.
- **Privacy**: retrieve with `sensitivity: 'circle'` and `subjectId` set to the patient. Only inject into patient-facing replies at first (`role === 'patient'`), so a caregiver's reply can't reveal a patient's private facts.

## Item 2: Action selector

- **Add** `prompts/action_selector.js`. Remove the intervention rows and any slot this port doesn't fill; the prompt loader leaves unfilled `{{SLOTS}}` otherwise.
- **Add** to `companions/handlers/index.js`, as a new stage after `clinicalAgent` and before the dependent handlers (fixes D2):
  1. Skip it when criticality is HIGH. The emergency path must stay as it is, with no added delay.
  2. Build the prompt with the helpers `_stressLevelFromIndex`, `_availableActionsByStress`, `_blockedActionsByStress`, `_formatHistory` (D4). Put them in a new `companions/agents/actionSelector.js` rather than the coordinator.
  3. Call `makeApiCall` + `parseCompanionResponse` (D10).
  4. Keep the stress gate override: a blocked result becomes `validate` / `Responsibility`.
  5. Add `selectedAction`, `framesComponent`, `responseDepth`, `secondaryAction` and `strategyNote` to the context. On any failure, carry on with none of them.
- **Make sure they reach the final reply**: `replyContext` is built in `CompanionCoordinator.js:78`. Confirm it carries these fields, and that the handler context they're added to is the one used there.
- **`patientOptimizer.js` and its prompt** (D11): add a slot:
  ```
  **Planned action this turn:** {{SELECTED_ACTION}} (FRAMES: {{FRAMES_COMPONENT}}). {{STRATEGY_NOTE}}
  Use it as guidance. If the patient asked a direct question, answer it first.
  ```
- **Check**: without physio data, stress is always `medium`. So one fixed set of actions is allowed on every turn, and the stress gate can't respond to the patient until a real stress signal exists.
- **Cost**: this adds one LLM call per non-emergency turn. Record the latency in item 8.

## Item 3: Exp 0p, patient facts in both prompts

**Add** `companions/patientFacts.js` exporting `buildPatientFacts(context)`, a pure function that returns a short text block or an empty string.

| Field | Live source | Status |
|---|---|---|
| Session number, days since last | New query for the patient's message timestamps. A gap over a set time starts a new session. | Needs a query; `getRecentMessages` returns no timestamps, and the `sessions` table is for login |
| Goal and goal status | None found | **Leave out for now** |
| Medication adherence | Latest relevant fact from `facts_v2`, quoted as stated | Available only if the patient has mentioned it; never show an invented percentage |
| Flagged topics | Retrieved facts and `recentEscalations` | Available |
| Sentiment | `empathyHandler.level` from the same turn | Available as an empathy level; no keyword guess |

Rules:
- Omit a field with no real value. "Unknown" invites the model to fill the gap or ask again.
- Set `context.patientFacts` in the handler stage after core results, since sentiment needs `empathyHandler`.
- **Selector**: fill `{{EXTRA_CONTEXT}}`, without the "from Python side" label.
- **Reply prompt**: add to `companion_patient_optimizer.js`, after `**Consider:**`:
  ```
  **What we already know (do not ask again):**
  {{PATIENT_FACTS}}
  {{KNOWN_CONTEXT}}
  {{LONGITUDINAL_HINT}}
  ```
- **Both reply passes**: draft and final replies both go through `processPatientOptimization`, so pass the fields in its `loadPrompt` call and confirm `replyContext` carries them.
- **Unified path**: `getReplyContext` builds a minimal context there, with no facts. Leave that for the first version and record it as a known gap.
- **Safety**: facts are background, not new claims. `ACTION_CONTRACT` must stay after them in the prompt, and facts must not state or imply actions. Run the action claims harness to confirm.

## Item 4: Self-reference guard and analogy observation

- **`aiAnalysisHandler.js`**: port the block that builds `speakerNames`, normalises `facts[*].subject_id` to `'self'`, and enriches only other people's mentions. Port the analogy preference block (written to `facts_v2`, non-fatal).
- **Analogy**: done in `prompts/companion_input_understanding.js`, not `unified_prompt.js`, because the block is on the companion path. Only use is recorded; the source's repeated "unknown" rows are dropped so they can't crowd out useful facts.
- Take only these hunks. Leave out `opts`, `skipPrivacyGuard` and `extraContext`.

## Item 5: clinicalAgent changes

Port by diff, not by copying the file, and keep the target's stage behaviour. Then port the `prompts/companion_clinical.js` diff and check the prompt accepts the new descriptive strings for `HAS_SEVERE_INDICATORS`, `IS_SIMPLE_PAIN`, `IS_FALL_FOR_ELDERLY`.

Set in `aiAnalysisHandler.js` (D6): `priorCriticality` from the last message, `escalationActive` from `recentEscalations.length > 0`. Leave `stressLevel` unset.

**Decided:** the regex pre-checks and the "simple pain HIGH to LOW" override are removed, as in the source. On LLM failure the call is retried once, then MEDIUM is returned with `llmFallback: true` (the source returned LOW).

**Done (uncommitted):**
- `clinicalAgent.js`: the source's hints and stored analogy preference, a 20-message history and `privacyLevel`. Kept from the target: `normalizeCriticality`, `highCategory` and the `isFallback` check.
- `companion_clinical.js`: the source prompt, keeping the `high_category` field.
- `getLastCriticality` in `db/queries_messages.js` reads only the speaker's own messages. `aiAnalysisHandler.js` sets `priorCriticality` and `escalationActive`.
- `tests/clinical_agent.test.js` is added to `npm test`.

**Simulation (16 runs, Scout, compared with `port_sel4_on`):**

| Metric | Before (`port_sel4_on`) | Item 5 (`port_item5`) |
|---|---|---|
| False claims | 0 | 0 |
| HIGH turns, all in `chest_pain_emergency` | 6 | 10 |
| HIGH turns with an emergency sentence | 6 of 6 | 10 of 10 |
| Patient HIGH turns with an alert proposal | 6 of 6 | 7 of 7 |
| Caregiver HIGH turns | 0 | 3 |
| HIGH in the other three scenarios | 0 | 0 |
| Criticality fallbacks | — | 0 |
| Repeats | 8 | 10 |
| Time per run | 110 s | 108 s |

Rating a caregiver's follow-up during an active chest-pain emergency as HIGH is the 20-message history at work. No other scenario was over-escalated.

## Item 6: privacyGuard and empathy

**Privacy**:
- Add `prompts/companion_privacy_guard.js`, and register `privacy_guard` in `companions/utils/promptLoader.js`.
- Port the LLM decision into `privacyGuard.js`, keeping the target's intent split (fix C) and defaulting to `PRIVATE` on failure. Drop the professional circle branch and `skipPrivacyGuard`. Apply D9.
- Fix `findCircleByPatientId(circleId)`, which passes a circle ID as a patient ID, if it's still there.
- **Decided**: Path 1 must not let `target === 'doctor'` skip the consent gate. Messages to the doctor require consent.

**Empathy**: port the physio block and add `{{PHYSIO_CONTEXT}}{{STRESS_OVERRIDE}}` to `prompts/companion_empathy.js` (D5). Drop the business branches. Nothing changes until `physioState` is supplied, so this is low priority.

**Done (uncommitted):**
- **`privacyGuard.js`:**
  - The source prompt (`prompts/companion_privacy_guard.js`, registered as `privacy_guard`) classifies with the LLM, and an invalid or failed answer falls back to PRIVATE.
  - SENSITIVE content gets no suggestion.
  - Suggestions from intent (facts, mediation, advice, doctor) come first, with combined intents split. The classifier's suggestion is used only when intent gives none.
  - The circle lookup uses `findCircleById`.
- **`consentManager.js`:**
  - Ported from the source without the emergency override, because no `emergency_flag` column exists. `logConsentDecision` is not ported.
  - Every target goes through the gate. `doctor` resolves to the circle's doctor member, and without one, consent is always required.
- **D9:** the coordinator reruns the guard only when it has no result.
- **`responseAggregator.js`:** the most-restrictive privacy merge read only `result.privacyLevel`, so the guard's `level` was ignored. Now that the clinical agent also returns `privacyLevel`, its PRIVATE could override the guard's SENSITIVE. Fixed.
- **Empathy:** `companions/physio/state.js` is copied from the source. The physio block is in `empathyHandler.js`, keeping `ACTIONS_TAKEN`, and the slots are added.
- **Tests:** `tests/privacy_guard.test.js` is added to `npm test`.
- **Simulation:** `port_item6b` has 15 of 16 runs; low memory stopped it before the last `privacy_breach_caregiver` run.

  | Metric | Item 5 (`port_item5`) | Item 6 (`port_item6b`) |
  |---|---|---|
  | False claims | 0 | 0 |
  | HIGH turns with an emergency sentence | 10 of 10 | 6 of 6 |
  | Patient HIGH turns with a proposal | 7 of 7 | 5 of 5 |
  | Repeats | 10 | 3 |
  | Guard or clinical fallbacks | 0 | 0 |
  | Messages to others in the two caregiver scenarios | 59 (6 relays) | 40 (3 relays) |
  | Time per run | 108 s | 137 s |

  The guard's own LLM call adds about 5 s per turn. Messages to the literal recipients "patient" or "user" happen in both batches, so the port didn't cause them.
- **Note:** the classifier's own suggestions carry no `content_to_share`, so `fallbackSharing.js` doesn't act on them. Suggestions from intent behave as before.

### Follow-up to item 6: sharing restrictions (not from the source)

A manual GLP-1 test found that after "Don't tell my daughter about this", the companion offered to message the daughter. Recreated directly against the prompts: Scout and Maverick both labelled every "don't tell X" message `REQUESTING_MEDIATION` and listed X as mentioned, and `suggestionFromIntent` turns mediation plus a mention into a suggestion for X (12 of 12 on each model, directly and after a few turns). Maverick's guard also suggested X itself. The system had no way to represent "do not share", so a better model would not fix it.

- **Extract:** input understanding returns `sharing_directives` (`restrict` or `allow`, targets as member names or `all_caregivers`, `all_doctors`, `everyone`) and a new intent `REQUESTING_NON_DISCLOSURE`. Code maps targets to members (`resolveTargets`); unknown names are asked about, not guessed. On both models every test message mapped correctly, including "keep this between us" and "tell my doctor but not my daughter", and ordinary messages produced none.
- **Store:** table `sharing_restrictions` (`db/queries_sharing_restrictions.js`), one member or a role per row, revoked rather than deleted. A restriction covers everything until lifted; the topic is kept for display only.
- **Enforce** (`services/sharingPolicy.js`): `evaluateConsent` never suggests a restricted member; `shareWithMembers`, `escalate` (unless the user approved the recipients), `proposeEscalation`, auto-sent alerts and scheduled messages never send to one. If restrictions cannot be read, nothing is sent. A non-disclosure intent never produces a suggestion.
- **Emergencies:** a HIGH proposal keeps restricted members but names the restriction in the question, and is never sent automatically, so they are alerted only on an explicit yes.
- **Reply:** a code-written sentence confirms what was stored ("Okay, I won't share anything with Priya Sharma unless you tell me otherwise."), and the reply prompts and the guard prompt list active restrictions.
- **Limits:** restrictions belong to the user who set them, so a caregiver's own report about the patient is not limited by them. The unified (non-companion) path does not extract directives, but its sends are enforced. In "tell my doctor but not my daughter", Maverick may label the intent `REQUESTING_NON_DISCLOSURE`, which drops the doctor suggestion for that turn.
- **Tests:** `tests/sharing_policy.test.js` (16) is added to `npm test`; two cases added to `tests/privacy_guard.test.js`.

### Clinical model and temperature

The pancreatitis-like message from the same test ("vomited 6 times, upper belly pain going through to the back"), with the current prompt: Scout rated it MEDIUM 3 of 3, Maverick HIGH 3 of 3. The clinical agent now calls with temperature 0 and use case `clinical_assessment`, which uses `BEDROCK_CLINICAL_MODEL_ID` when set (`.env.example`: Llama 4 Maverick) and `BEDROCK_MODEL_ID` otherwise. No scenario-specific criteria were added to the prompt.

### Fixes from the app test of the above (GLP-1 scenario, demo accounts)

- The clinical agent ran only when the message contained "pain", "symptom", "medication", "diagnosis" or "treatment", so "threw up twice and feel dizzy" was never assessed and stayed NONE. It now runs on every patient and caregiver turn (`getRelevantHandlers`); doctors keep the old check. One more LLM call per turn.
- The code-written confirmation of a sharing directive was set by the coordinator but not copied onto the analysis, so it never reached the reply (`aiAnalysisHandler.js`).
- "Can you ask my doctor what I should do?" was labelled ASKING_QUESTION; the privacy guard's model suggested the doctor with empty content, and `fallbackSharing.js` drops suggestions without content. A doctor suggestion with empty content now takes the message as its content (`withDoctorContent`).
- Emergency confidence threshold lowered from 0.9 to 0.85 (the pancreatitis-like message scored 0.88).

### Restricted members and the owner's message history (fixed)

**Problem.** Restrictions were enforced where the companion sends or proposes something, but not where it reads history. `getRecentMessages` gave the speaker their own messages plus every other member's PUBLIC messages, with no check of `sharing_restrictions`, so a message from Ramesh labelled PUBLIC after he restricted Priya could reach her companion. In the GLP-1 app test nothing leaked only because the classifier labelled each of his messages PRIVATE.

**Fix: a restriction is a time window.**
- `sharing_restrictions.effective_from` (added by migration) starts the window `RESTRICTION_LOOKBACK_MS` (1 minute) before the turn that set it (`startedAt`, now set by `runInTurn`), so the message asking for it and anything said just before are covered. The window ends at `revoked_at`.
- In a turn, `getRecentMessages` and `hasRecentHighMessage` leave out another member's message when its author has a restriction covering the reader (as a member, by role, or everyone) and the message was written inside the window. Lifting a restriction shows new messages but keeps the window hidden. If the filter cannot be evaluated, the reader gets only their own messages.
- Message privacy labels are not changed. Members the owner did not restrict, such as the doctor, still see PUBLIC messages, and the classifier's label stays available.
- The restricted reader's reply prompts (empathy, and the patient reply via `buildKnownSection`) say updates from that member are not available and ask for a neutral answer: no update that can be shared, ask them directly, with no hint that anything is being kept private. If this cannot be checked, the prompt says it of "some circle members".
- Emergencies are unchanged: a restricted member is alerted only on the owner's explicit yes.

**Why not filter by topic.** That needs an LLM call per message to judge whether it touches the restricted topic, and misses are likely ("feeling queasy today" never names Ozempic but points straight to it). A restriction covers the whole relationship for its window; topic-level restrictions could be added later as an explicit opt-in.

**Tests.** Seven cases added to `tests/sharing_policy.test.js` (window hiding including PUBLIC messages, other readers unaffected, lifting keeps the window hidden, role restrictions, the emergency carry-over check, fail closed, the one-minute lookback, the neutral prompt guidance).

**Related open items.** Self-harm with a plan scored exactly 0.85 in the emergency run, so a small drop would miss the alert; a code rule that always proposes an alert for it is under consideration. The `[SharingPolicy] blocked on emergency_proposal` log line reads as if the alert was blocked, when the member was only flagged for an explicit yes; it should be reworded. The "ask my doctor" fix (`withDoctorContent`) is unit-tested but not yet tested through the app.

## Item 7: Probing question conflict

`companion_patient_optimizer.js` says replies without probing questions "will be penalized". That contradicts both a `give_facts` or `summarise` action and "do not ask again". Soften the wording so the planned action decides whether to ask. This also addresses behaviour doc issue 1.

## Item 8: Measurement

Run these before item 1, to get a baseline, and again after items 2 and 3:

- Simulation scenarios: `medication_nonadherent`, `chest_pain_emergency`, `caregiver_limited_consent_medication`, `privacy_breach_caregiver`.
- The action claims harness (`training/simulation/action_claims/`): the false claim rate must not rise.
- Compare: repeated questions, replies per concern, emergency criticality and turn latency.

To separate the effects, switch selector and reply-prompt facts independently with two temporary settings, and remove them once the result is known. Only those comparisons show whether reply-prompt facts help.

---

## Order of work

1. Item 8 baseline.
2. Item 0.
3. Item 4, because D7 and fact quality depend on it.
4. Item 1.
5. Item 3, reply prompt only.
6. Item 2, then connect facts to the selector.
7. Item 7, then the item 8 comparison.
8. Item 5 and item 6, once reviewed.

Commit each step separately so a regression can be bisected. Run `npm test` before each commit.

## Verification

- With `DEBUG_COMPANION=true`, one simulation shows an `Action selected: …` line, and the optimizer prompt contains the facts block in both draft and final passes.
- With no `TENSORNETS_URL`, turns complete with no bridge requests. With the URL set and the server stopped, the delay is no more than the bridge timeout.
- A HIGH turn makes no selector call, and its emergency reply and alert proposal are unchanged.
- Self-reference: patient "Manik" sends "I, Manik, forgot my meds". No enrichment call, a fact is stored with `subject_id='self'`, and the next turn retrieves it.
- A fact the patient already gave is not asked for again on a later turn.
- A caregiver's reply contains no patient-private facts.
- Unit tests for `buildPatientFacts`: missing fields are left out, and there are no invented values.

## Open questions

1. What gap between messages starts a new session? Suggested: 6 hours.
2. Should caregivers' and doctors' replies get facts later, and with what privacy rule?
3. Where should a real session goal come from, if we want that field?
4. Does the source's `prompts/action_selector.js` wording suit general health conversation? It includes addiction and flooding terms from the research work, so it needs review before use on patients.

## Baseline results (2026-11-06)

Run on `90de82d`, before item 0, with Llama 4 Scout: 4 scenarios x 2 runs x 6 turns, alert proposals accepted from the card. The sample is small and simulated patients vary between runs, so only large changes are meaningful.

```sh
BEDROCK_MODEL_ID=us.meta.llama4-scout-17b-instruct-v1:0 \
  node training/simulation/action_claims/harness.mjs --proposals accept port_baseline 6 2 \
  medication_nonadherent chest_pain_emergency caregiver_limited_consent_medication privacy_breach_caregiver
```

| Metric | Result |
|---|---|
| Runs, crashes | 8, 0 |
| Messages to the speaker | 48, one per turn |
| False action claims | 0 |
| Replies regenerated or replaced by the check | 0, 0 |
| Criticality | NONE 15, LOW 10, MEDIUM 17, HIGH 6 |
| HIGH turns opening with the emergency sentence | 6 of 6 |
| HIGH turns with an alert proposal | 4 of 6 |
| Alerts sent after acceptance | 4 |
| Average time per run | 115 s |

| Scenario | Turns | Replies ending in a question | Average reply length (characters) |
|---|---|---|---|
| `medication_nonadherent` | 12 | 8 | 234 |
| `chest_pain_emergency` | 12 | 3 | 300 |
| `caregiver_limited_consent_medication` | 12 | 8 | 199 |
| `privacy_breach_caregiver` | 12 | 3 | 226 |

Not yet measured: whether the agent asks again for something it was already told. This needs hand review of the transcripts, or a new metric, before the item 3 comparison.

### Repeated questions (added after the baseline)

`repeat_scorer.mjs` asks an LLM judge whether each reply asks for something the speaker already stated. Baseline, re-scored from the saved transcripts: **3 to 4 of 40 replies with a question flagged, 1 unscored**; the count varies between scorings. On hand review of the 3 flagged in the last scoring, 1 was genuine (`privacy_breach_caregiver` run 1 turn 3: told "this morning", then asked when it was first noticed) and 2 were false.

On 14 hand-labelled cases the judge caught 7 of 7 repeats and wrongly flagged 1 of 7 non-repeats. It over-flags "tell me more" questions, so hand review the flagged replies in each comparison rather than relying on the count.

### Emergency turns without a proposal

The 2 of 6 HIGH turns with no proposal (`chest_pain_emergency` turn 4 of each run) scored 80% emergency confidence, under the 0.9 threshold, and the caregiver had already been alerted on turn 1. Both replies opened with the 112 instruction. In run 2 the patient's request was forwarded to the caregiver. No change needed for this.

Separate problems seen in that review, not caused by the port and not fixed here:
- Run 1 turn 6: a patient with chest pain asks "get someone here ASAP", rated MEDIUM, so the reply has no 112 instruction. Criticality is judged per message, so an emergency can lose its instruction later in the conversation.
- Run 1 turn 4: the reply to the caregiver says "I'll make sure to look into this for you right away", a promise with no recorded action, which the claim check does not catch.

### Emergency instruction carry-over (added ahead of item 1)

For 30 minutes after a HIGH turn, a lower-rated reply opens with: "If these symptoms are still happening, please call 112 or go to the nearest emergency department now." Per-message criticality, alert proposals and escalations do not change. In a HealthyMitra turn, only HIGH messages the speaker may read count, so a member's private emergency is not revealed to another.

Live check, `chest_pain_emergency`, 2 runs x 6 turns: every lower-rated patient turn carried the instruction, with 3 alerts from 3 proposals on 3 HIGH turns and no false action claims.

Known limits, for senior review:
- Replies from question delegation ("Questions sent → ...") do not carry it, because `handleNonDoctorQuestion` returns before the checked reply is built. Seen for caregivers in 2 of 12 simulated turns. This path is skipped in HealthyMitra circles, so it affects non-HealthyMitra circles such as this simulation.
- The sentence is medical. A self-harm or danger emergency would get this wording too, because the HIGH category is not stored with the message.
- It cannot end early, so a patient who says they have reached hospital still sees it until the window ends.

This changes reply text on later turns, so measure items 1 to 3 against a new baseline that includes it.

### Baseline with the carry-over (`port_carry_baseline`, run on `0695ccc`)

Same command and scenarios as the first baseline. Use this one for later comparisons.

| Metric | Result |
|---|---|
| Runs, crashes | 8, 0 |
| False action claims | 0 |
| Replies regenerated or replaced | 1, 0 |
| Criticality | NONE 23, LOW 5, MEDIUM 15, HIGH 5 |
| HIGH turns opening with the emergency sentence | 5 of 5 |
| HIGH turns with an alert proposal, alerts sent | 3 of 5, 3 |
| Repeated questions | 3 of 40 replies with a question, 3 unscored |
| Average time per run | 99 s |

### Item 1 as built

Fact storage had to be fixed first. In the runs before this fix, 61 of 75 stored facts had the value `[object Object]`, because the extractor wrapped facts as `{"speaker": {...}}`. Facts are now flattened before storing, empty values are dropped, and the prompt asks for a flat object.

Differences from the source and from the plan above:
- **Sensitivity**: the source's filter leaves out `normal`, the default for stored facts, so it would exclude most facts. `normal` is now included.
- **Whose facts**: only facts the patient reported about themselves. Facts with no subject and `other_person_*` facts are left out, so a member's private statement cannot reach the patient's reply.
- **Scoring**: confidence and recency only. Topic matching and relapse history are not ported, because all facts are currently stored as `general` and no worker supplies a hint.
- **Bridge**: only `getLongitudinalHint`, with a timeout, and only when `TENSORNETS_URL` is set. `state.js` and the rest of the bridge are not ported.

Replies do not use the block yet. It reaches the reply prompt in item 3.

Live check, `medication_nonadherent`, 2 runs x 6 turns: 11 facts stored, none unreadable, and the patient's facts were retrieved without the caregiver's.

Known limits:
- Fixed after item 1: `addFact` now replaces the current fact per circle, key and subject, so a caregiver's own `symptom_report` no longer replaces the patient's. A fact about the same subject still replaces the earlier one, and conflict detection compares against the current fact for that subject.
- Most facts are stored in category `general`, so the safety-critical rule rarely applies. An old allergy can still rank below the top 6.
- A fact a caregiver states about someone else without the `other_person_` prefix is stored as the caregiver's own. It does not reach the patient's reply.

### Item 3 as built (reply prompt only)

- `companions/patientFacts.js`: `buildPatientFacts` gives the conversation number and days since the last one, and the types of escalations flagged in the circle. Escalation details are left out because they can quote other members. `buildKnownSection` adds the known facts and the longitudinal hint, under "What we already know (do not ask again)", marked as background that does not mean any action was taken. With nothing known, the section is empty.
- `knownContext.js`: a gap over 6 hours between the patient's messages starts a new conversation. The start of the current one is also the cut-off for "CURRENT SESSION" facts.
- `companion_patient_optimizer.js`: `{{KNOWN_SECTION}}` after **Consider:** and before `ACTION_CONTRACT`. Both reply passes use it, since the final pass reuses the draft's context.
- Not included: medication adherence and sentiment as separate lines. Adherence is already in the known facts, and the empathy level is already in the prompt. Goal status has no source. The unified path still gets no facts.

Measured (`port_item3`, same command as the baselines):

| Metric | `port_carry_baseline` | `port_item3` |
|---|---|---|
| Runs, crashes | 8, 0 | 8, 0 |
| False action claims | 0 | 0 |
| Replies regenerated or replaced | 1, 0 | 1, 0 |
| Criticality | NONE 23, LOW 5, MEDIUM 15, HIGH 5 | NONE 21, LOW 10, MEDIUM 13, HIGH 4 |
| HIGH turns opening with the emergency sentence | 5 of 5 | 4 of 4 |
| HIGH turns with an alert proposal, alerts sent | 3 of 5, 3 | 4 of 4, 4 |
| Repeated questions | 3 of 40, 3 unscored | 5 of 42, 1 unscored |
| Average time per run | 99 s | 101 s |

Repeated questions did not fall. All five repeats were in the same conversation, where the answer is already in the history the prompt shows. Only one answer had been stored as a fact (`location=home`, asked again during the chest pain emergency). Runs store 1 to 4 patient facts each, often vague (`symptom_report=scared`), so the block has little to add. The repeats look driven by the prompt's demand to always end with a probing question, which item 7 addresses.

### Item 7 as built

`companion_patient_optimizer.js` no longer requires a probing question or penalises replies without one. It now asks for at most one question, only when the answer would change the reply, and never for something already told; otherwise give information, reassurance or a next step. A direct question is answered first. `requireProbing` in `patientOptimizer.js` is off to match (it only logged). The unified path's prompts (`unified_prompt.js`, `model_specific_prompts.js`) still demand questions and are not changed.

| Metric | `port_carry_baseline` | `port_item3` | `port_item7` |
|---|---|---|---|
| Runs, crashes | 8, 0 | 8, 0 | 8, 0 |
| False action claims sent | 0 | 0 | 0 |
| Replies regenerated or replaced | 1, 0 | 1, 0 | 5, 0 |
| HIGH turns opening with the emergency sentence | 5 of 5 | 4 of 4 | 5 of 5 |
| HIGH turns with an alert proposal, alerts sent | 3 of 5, 3 | 4 of 4, 4 | 5 of 5, 5 |
| Replies with a question | 40 | 42 | 28 |
| Repeated questions | 3, 3 unscored | 5, 1 unscored | 3 |
| Average time per run | 99 s | 101 s | 94 s |

Replies with a question fell from 42 to 28 of 48, and repeats from 5 to 3. Regenerations rose from 1 to 5: four drafts said the doctor had been told and one said the matter was escalated. The guard caught all of them, but drafts without a question seem to fill the gap with "I'll let your doctor know". A next step should be something the patient can do, unless ACTIONS_TAKEN lists an action.

**Revised (`port_item7b`)**, replacing the version above: dropping questions loses detail about the patient, so probing questions are kept. The prompt asks for one specific probing question at the end of most replies, never one the patient has already answered (even in other words); instead it asks for a new detail, the effect on daily life, what helps or worsens it, or an area not yet covered. Direct questions are answered first. "Will be penalized" and "offer to flag it for their doctor" are removed. `requireProbing` is back on.

| Metric | `port_carry_baseline` | `port_item7b` |
|---|---|---|
| Runs, crashes | 8, 0 | 8, 0 |
| False action claims sent | 0 | 0 |
| Replies regenerated or replaced | 1, 0 | 0, 0 |
| HIGH turns opening with the emergency sentence | 5 of 5 | 7 of 7 |
| HIGH turns with an alert proposal, alerts sent | 3 of 5, 3 | 5 of 7, 5 |
| Replies with a question | 40 | 42 |
| Repeated questions | 3, 3 unscored | 2, 0 unscored |
| Average time per run | 99 s | 103 s |

### Item 2 as built

- `prompts/action_selector.js`: cut down from the source's ~500 lines to the 13 actions allowed at medium stress, which is every turn until a stress signal exists. Left out: actions that would claim contact, scheduling or presence (`call_for_help`, `request_presence`, `schedule_future_interaction`, `emergency_mobilise`, `escalate`), `share_circle_insight` (cross-member disclosure), the intervention queue, and techniques needing clinical review (flooding, SPIKE, paradoxical and panic actions). Slots with no real source (session goal, info coverage, phase, mode, HRV) are removed.
- `companions/agents/actionSelector.js`: `selectAction` runs for patients only, after `clinicalAgent` in `companions/handlers/index.js`, and not on HIGH turns. It uses `makeApiCall` + `parseCompanionResponse` (D10). History shows only the patient's messages and the companion's replies to them (D4); other members' messages are left out. The known section from item 3 is included. A blocked or unknown action becomes `validate` / `Responsibility`; a failed call gives no plan. "Last action" is taken from whether the companion's last reply ended with a question.
- The plan is returned as `componentResults.actionSelector` and added to `replyContext` in `CompanionCoordinator.js`, so both reply passes see it. `{{PLANNED_ACTION}}` in the reply prompt sits before `ACTION_CONTRACT` and keeps the probing question rule.

Measured (`port_item2`, with `DEBUG_COMPANION=true`):

| Metric | `port_item7b` | `port_item2` |
|---|---|---|
| Runs, crashes | 8, 0 | 8, 0 |
| False action claims sent | 0 | 0 |
| Replies regenerated or replaced | 0, 0 | 0, 1 |
| HIGH turns opening with the emergency sentence | 7 of 7 | 3 of 3 |
| HIGH turns with an alert proposal, alerts sent | 5 of 7, 5 | 3 of 3, 3 |
| Replies with a question | 42 | 39 |
| Repeated questions | 2 | 2 |
| Average time per run | 103 s | 104 s |

Selector: 22 calls, 0 failures. Chosen: `empathic_reflection` 15, `open_question` 6, `give_facts` 1. The one replaced reply was a caregiver turn, where the selector does not run. On this sample the selector changes nothing measurable; its choices lean heavily on reflection.

**Selector tuning (`port_item2b`)**: the selector now sees its last 3 actions for the patient (in memory per circle and patient), with rules for variety (not the same action twice in a row, at most two empathy actions in three turns), reflection only when a feeling was expressed, and moving forward once a problem is explained. Prompt rules only; not enforced in code.

| Metric | `port_item2` | `port_item2b` |
|---|---|---|
| Selector calls, failures | 22, 0 | 25, 0 |
| Actions chosen | reflection 15, open_question 6, give_facts 1 | reflection 13, open_question 5, give_facts 4, socratic_probe 3 |
| Same action as the previous call (log order, approximate) | n/a | 7 |
| False action claims sent | 0 | 0 |
| Replies regenerated or replaced | 0, 1 | 1, 0 |
| HIGH turns with an alert proposal | 3 of 3 | 3 of 4 |
| Replies with a question | 39 | 42 |
| Repeated questions | 2 | 4 |
| Average time per run | 104 s | 111 s |

Slightly more variety, but reflection is still about half of the choices and the model often repeats its last action despite the rule.

**Second look instead of variety (`port_item2d`)**: repeating an action is allowed; the strict variety rule is softened to "try a different approach if the conversation is not moving forward". When the patient's message asks something ("?", "can we/you", "please") and neither the action nor the secondary action is `give_facts`, `give_options` or `psychoeducation`, the model is asked once more with a note; it may switch, add an answering secondary action, or keep its choice. A failed second call keeps the first plan.

| Metric | `port_item2b` | `port_item2d` |
|---|---|---|
| Selector calls, failures | 25, 0 | 22, 0 |
| Second looks, choice changed | n/a | 12, 4 (2 to `give_facts`) |
| Actions chosen | reflection 13, open_question 5, give_facts 4, socratic_probe 3 | reflection 8, give_facts 5, socratic_probe 4, open_question 4, validate 1 |
| False action claims sent | 0 | 0 |
| Replies regenerated or replaced | 1, 0 | 1, 0 |
| HIGH turns with an alert proposal | 3 of 4 | 2 of 4 |
| Replies with a question | 42 | 39 |
| Repeated questions | 4 | 4 |
| Average time per run | 111 s | 104 s |

The second look fired on 12 of 22 calls. About half were tag questions ("you know?", "right?", "don't you think?"), where keeping the choice was correct. Real requests were missed too: "Can't we just focus on my blood sugar levels instead?" kept a plain reflection. The model kept its choice 8 times; the log does not show whether it added an answering secondary action. HIGH turns do not run the selector, so the alert proposal count is not affected by it.

### Open asks (A and B) and the asks evaluation (D)

- **A**: input understanding (no extra call) returns `asks` (question, request or rhetorical, with a short summary and `same_as` for a repeat of an open ask) and `resolved_asks` (answered or dropped, judged from the companion's last reply). The selector's second look now runs only when stored open asks exist and the plan does not answer them; the regex trigger is gone.
- **B**: `open_asks` table and `db/queries_asks.js`. Questions and requests only; repeats increment `times_asked`; only the patient's own open IDs can be closed; an ask not raised for 7 days stops being open. The selector and the reply prompt see "Still waiting for an answer" (no IDs); the reply prompt asks for an answer or an honest "cannot, but you can".
- **D**: `training/evaluation/asks/labelled_asks.json`, 92 patient messages from simulation runs, labelled by hand (13 marked ambiguous; labels need review), and `run_asks_eval.mjs`. Llama 4 Scout, clear cases: exact 89%, real asks missed 0 of 49, invented asks 6 of 30 (mostly complaints read as questions). The prompt was tuned once on this set (privacy requests such as "don't tell Emily" were missed before).

Live run (`port_asks`): 16 asks stored, 5 asked more than once, **0 closed**. In the rash conversation the patient asked three times whether it was serious and got partial answers each time, so staying open was correct; the reply prompt's "still waiting" list is not making the reply answer. A direct test with an answering reply did close the ask, but whether closing works in every harness case is not yet confirmed; `[OpenAsks]` debug lines now log each update. Selector: 21 calls, 6 second looks, 3 changed. Repeated questions 5, false claims 0, 102 s per run.

### C: reply ask check

`companions/agents/askChecker.js` and `prompts/ask_check.js`, called from `ensureAsksAddressed` in `replyWriter.js` after the false claim check. For a non-HIGH patient turn with open asks, one call checks which asks the reply addresses (a direct answer, or an honest "cannot, but you can"). If any are missed, the reply is written once more naming them (`missedAsks` in the reply prompt); the retry is used only if it passes the false claim check and addresses at least as much. Asks the final reply addresses are marked answered (`markAsksAnswered`). Also fixed: `same_as` and resolved IDs given as the ask's text are matched to the open ask.

| Metric | Scout before C (`port_asks_scout2`) | Scout with C (`port_c_scout`) | Maverick before C (`port_asks_maverick`) | Maverick with C (`port_c_maverick`) |
|---|---|---|---|---|
| Asks stored, closed by the end | not counted, 0 closed | 19, 12 | not counted, 3 closures | 23, **23** |
| Checks; first draft addressed all | n/a | 15; 5 | n/a | 19; 12 |
| Rewrites | n/a | 8 | n/a | 7 |
| False action claims sent | 0 | 0 | 0 | 0 |
| Replies regenerated or replaced | 0, 0 | 2, 1 | 3, 1 | 3, 0 |
| Repeated questions | 6 | 5 | 2 | 7 |
| Average time per run | 100 s | 115 s | 110 s | 120 s |

With Maverick every ask was answered by the end of its conversation; with Scout 7 of 19 were still open. The repeated question metric did not improve: it measures the companion asking for information the patient already gave, which this check does not cover. The check adds about 10 to 15 s per run.

### Item 8 comparison

Two temporary settings switched off the selector (`port_abl_nosel`) or the known facts in the reply prompt (`port_abl_nofacts`; open asks still shown), each with everything else as in `port_c_scout`. Llama 4 Scout, same command as the baselines, run one at a time. The settings have been removed.

| Metric | `port_carry_baseline` | All on (`port_c_scout`) | Selector off | Reply facts off |
|---|---|---|---|---|
| Runs, crashes | 8, 0 | 8, 0 | 8, 0 | 8, 0 |
| False action claims sent | 0 | 0 | 0 | 0 |
| Replies regenerated or replaced | 1, 0 | 2, 1 | 2, 0 | 0, 0 |
| HIGH turns opening with the emergency sentence | 5 of 5 | all | 5 of 5 | 4 of 4 |
| HIGH turns with an alert proposal | 3 of 5 | not recorded | 4 of 5 | 3 of 4 |
| Replies with a question | 40 | 36 | 41 | 39 |
| Repeated questions | 3 (3 unscored) | 5 | 4 (3 unscored) | 7 (1 unscored) |
| Asks stored, answered by the end | n/a | 19, 12 | 17, 12 | 19, 14 |
| Average time per run | 99 s | 115 s | 104 s | 136 s |

Findings:
- **Selector**: switching it off changes nothing measurable (repeats 4 vs 5, asks answered 12 vs 12) and saves about 10 s per run. On this sample it does not earn its cost.
- **Reply-prompt facts**: switching them off gives the most repeats (7, against 4 to 5), the only direction consistent with the facts helping, but within the run-to-run spread seen so far (2 to 7). The 136 s is likely Bedrock latency, since this setting removes prompt text.
- **Since the baseline**: false claims stay at 0 and every HIGH turn opens with the emergency sentence. Repeated questions have not fallen. They need a different fix: most repeats ask for something already in the visible history, not something missing from the prompt.
- "Replies per concern" from the plan was not measured; it needs a definition of a concern.
- 8 runs per setting is too few to separate effects of this size. A decision on keeping the selector needs either more runs (e.g. 4 per scenario) or a judgement on reply quality, not counts.

**Selector, 4 runs per scenario** (16 runs each, Scout; the setting has been removed again):

| Metric | Selector on (`port_sel4_on`) | Selector off (`port_sel4_off2`) |
|---|---|---|
| Runs, crashes | 16, 0 | 16, 0 |
| False action claims sent | 0 | 0 |
| Replies regenerated or replaced | 2, 0 | 4, 0 |
| HIGH turns opening with the emergency sentence | 6 of 6 | 9 of 9 |
| HIGH turns with an alert proposal | 6 of 6 | 7 of 9 |
| Replies with a question | 84 | 82 |
| Repeated questions | 8 (5 unscored) | 12 (5 unscored) |
| Asks stored, answered by the end | 41, 28 (68%) | 43, 25 (58%) |
| Average time per run | 110 s | 102 s |

With the larger sample the selector is ahead on every quality count: fewer repeats (8 vs 12), more asks answered (68% vs 58%) and fewer regenerated drafts, for about 8 s per run. The differences are modest and still within what two more batches could reverse, but they point the same way, so keeping the selector is recommended. The HIGH proposal difference is not the selector's, since it does not run on HIGH turns.
