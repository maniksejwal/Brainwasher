# Porting tensornetsfreeze Agent Improvements to `feat/agent-behavior-improvements`

**Date**: 2026-11-06 (replaces the plan of 2026-10-26)
**Source**: `origin/tensornetsfreeze` @ `bf4f49c` (2026-09-28). It contains all of `origin/tensornets` plus 18 commits.
**Target**: `feat/agent-behavior-improvements`, continuing on the same branch
**Related**: `documentation/training/AGENT_BEHAVIOR_ISSUES_AND_FIX_PLAN.md`, `FALSE_ACTION_CLAIMS_ROOT_CAUSE_AND_FIX.md`

Status: plan only. Nothing from this plan has been ported yet. Line numbers below refer to the two commits above.

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

**Senior or clinical review needed before this ships:**
- It removes the regex pre-checks and the "simple pain HIGH to LOW" override.
- It returns LOW when the LLM fails. Recommended instead: one retry, then MEDIUM, with `llmFallback` logged.

## Item 6: privacyGuard and empathy

**Privacy**:
- Add `prompts/companion_privacy_guard.js`, and register `privacy_guard` in `companions/utils/promptLoader.js`.
- Port the LLM decision into `privacyGuard.js`, keeping the target's intent split (fix C) and defaulting to `PRIVATE` on failure. Drop the professional circle branch and `skipPrivacyGuard`. Apply D9.
- Fix `findCircleByPatientId(circleId)`, which passes a circle ID as a patient ID, if it's still there.
- **Review needed**: Path 1 lets `target === 'doctor'` skip the consent gate. Gate it, or mark it as requiring consent.

**Empathy**: port the physio block and add `{{PHYSIO_CONTEXT}}{{STRESS_OVERRIDE}}` to `prompts/companion_empathy.js` (D5). Drop the business branches. Nothing changes until `physioState` is supplied, so this is low priority.

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
- `addFact` replaces the current fact per circle and key. A caregiver's `symptom_report` therefore replaces the patient's, and retrieval no longer finds it. Check this before item 3 is measured.
- Most facts are stored in category `general`, so the safety-critical rule rarely applies. An old allergy can still rank below the top 6.
- A fact a caregiver states about someone else without the `other_person_` prefix is stored as the caregiver's own. It does not reach the patient's reply.
