# Agent fixes #2, #4, #7, #9a: before/after simulation results

Date: 2026-10-29. Branch: `feat/agent-behavior-improvements`. Related: `AGENT_BEHAVIOR_ISSUES_AND_FIX_PLAN.md`.

## Summary

| Question | Answer |
|---|---|
| Do combined intents containing `REQUESTING_DOCTOR` now reach the doctor? (#4) | **Yes.** Before: 2 such turns, 0 doctor escalations. After: 3 such turns, 3 doctor escalations. |
| Did any scenario produce escalations it previously did not? | **Yes.** `chest_pain_emergency`: 0 escalations before (both runs), 3 after (2 `DOCTOR_REQUEST`, 1 `CRITICAL`). `fall_with_injury`: 0 → 1. |
| Is the clinical result now reaching the reply step? (#2) | Confirmed by unit test. Not separately measurable in these runs (see Limitations). |
| Does the agent now see recent history? (#7) | Confirmed by unit test. Not observable in transcript metrics. |
| Did anything get worse? | No regressions found. Turns take somewhat longer (one extra sequential LLM wait when the clinical agent runs). |
| Biggest remaining problem seen | Chest pain + dizziness + shortness of breath was rated criticality `NONE` on the first turn in **all 4 runs, before and after**. Not fixed by these changes. |

## What was changed

| # | Fix | File |
|---|---|---|
| 7 | History reversed to oldest-first once at fetch, so `slice(-N)` in companions selects the most recent messages | `handlers/message_logic/aiAnalysisHandler.js` |
| 2 | `clinicalAgent` runs as its own stage after core handlers; its result is injected as `context.clinicalAssessment` before patientOptimizer, escalationManager, doctorOptimizer and futurePlanning run | `companions/handlers/index.js` |
| 4 | Doctor-request routing accepts pipe-separated intents (`A\|REQUESTING_DOCTOR`), case- and space-insensitive | `handlers/message_logic/sharing/doctorRequests.js`, `companions/handlers/privacyGuard.js` |
| 9a | Simulation reports the action actually executed (from escalations/pending actions written during the turn) instead of hardcoded `NONE` | `training/simulation/ai_integration.js` |

Unit tests: `tests/agent_fixes.test.js` (4 tests, mocked LLM, part of `npm test`). The #2 and #4 tests were verified to fail on the pre-fix code.

## Method

- **Before:** commit `73c16e5` (branch head, none of the fixes), in a temporary git worktree.
- **After:** working tree with the fixes.
- Both used the same `.env`. Every LLM call (agent and synthetic users) was Bedrock `us.meta.llama4-scout-17b-instruct-v1:0`.
- 4 scenarios × 2 runs × 6 turns per version = 48 agent turns each. Each run used a fresh SQLite database.
- `autoFeedback` and `logResults` were turned off, but some code paths still log: these runs appended 77 lines to `data/storage/local/training/metrics.jsonl` and 2 to `training_log.jsonl`. They can be identified by simulation IDs containing `_run_17932`.
- Escalations and pending actions were counted **directly from each run's database**, not from transcript labels, so the "before" numbers don't depend on fix #9a.
- Scenarios:

  | Scenario | Users | Why chosen |
  |---|---|---|
  | `gip_restart_after_gap` | patient + doctor | The restart case cited in the fix plan |
  | `fall_with_injury` | patient | Fix plan evidence: doctor requests were missed |
  | `generated_anxious_patient_medication_lying` | patient | Fix plan evidence: doctor requests were missed |
  | `chest_pain_emergency` | patient + caregiver | Emergency regression check |

## Results

### Overall

| Metric (all 4 scenarios, 48 turns each) | Before | After |
|---|---|---|
| Turns whose intent includes `REQUESTING_DOCTOR` | 2 | 3 |
| `DOCTOR_REQUEST` escalations created | **0** | **3** |
| All escalations created | 0 | 4 |
| Turns rated HIGH / URGENT_INTERVENTION | 2 | 4 |
| Log lines with "invalid JSON" from the LLM | 65 | 62 |

### Per scenario

| Scenario | Metric | Before | After |
|---|---|---|---|
| chest_pain_emergency | Escalations per run | 0 / 0 | 2 / 1 |
| | Escalation types | — | DOCTOR_REQUEST, CRITICAL |
| | Criticality distribution | NONE:11 LOW:1 | NONE:10 HIGH:1 URGENT_INTERVENTION:1 |
| | Replies ending in "?" | 58% | 33% |
| fall_with_injury | Escalations per run | 0 / 0 | 0 / 1 |
| | Escalation types | — | DOCTOR_REQUEST |
| | Criticality distribution | HIGH:1 NONE:10 LOW:1 | NONE:10 LOW:1 URGENT_INTERVENTION:1 |
| | Replies ending in "?" | 83% | 83% |
| generated_anxious_patient_medication_lying | Escalations per run | 0 / 0 | 0 / 0 |
| | Criticality distribution | LOW:4 NONE:7 HIGH:1 | LOW:4 NONE:7 HIGH:1 |
| | Replies ending in "?" | 100% | 100% |
| gip_restart_after_gap | Escalations per run | 0 / 0 | 0 / 0 |
| | Pending actions | delegated_probe_response | delegated_probe_response |
| | Replies ending in "?" | 100% (4 turns) | 43% (7 turns) |

### The key comparison: the same message, before and after (#4)

The patient's opening message in `chest_pain_emergency` ("I'm feeling really worried, I'm experiencing chest pain, dizziness, and shortness of breath…") was classified the same way in all 4 runs:

| Version | Run | Intent | Criticality | Escalation |
|---|---|---|---|---|
| Before | 1 | `EXPRESSING_EMOTION\|REPORTING_FACT\|REQUESTING_DOCTOR` | NONE | **none** |
| Before | 2 | `EXPRESSING_EMOTION\|REPORTING_FACT\|REQUESTING_DOCTOR` | NONE | **none** |
| After | 1 | `EXPRESSING_EMOTION\|REPORTING_FACT\|REQUESTING_DOCTOR` | NONE | **DOCTOR_REQUEST** |
| After | 2 | `EXPRESSING_EMOTION\|REPORTING_FACT\|REQUESTING_DOCTOR` | NONE | **DOCTOR_REQUEST** |

This is the failure described in issue #4, reproduced on the old code and resolved on the new code. In `fall_with_injury` (after, run 2), the patient's single-intent "I think I need to see the doctor again" also produced a `DOCTOR_REQUEST`.

## How to read these numbers

- **Small sample.** There are 2 runs per scenario, and the synthetic patients behave differently each run. Only the doctor-request routing result is backed by an identical input on both sides; everything else is indicative.
- **The "?" percentages** move a lot but aren't a target of these fixes. Treat them as noise until there are more runs.
- **The criticality differences** (HIGH and URGENT_INTERVENTION turns) depend on which messages the synthetic patients produced. They aren't a controlled comparison.

## Limitations

1. **#2 and #7 have no direct metric here.** Their effect is inside the prompts, which the transcripts don't capture. They are verified by `tests/agent_fixes.test.js`. To measure them in simulation, log the optimizer's `CRITICALITY` and `CONVERSATION_HISTORY` prompt fields per turn.
2. **LLM JSON failures:** Llama 4 Scout returned unparseable JSON roughly 60 times per version, with up to 6 retries per call. When all retries fail, components fall back to defaults (criticality NONE, generic intents), which adds noise to both versions equally and slows runs down (2–3 minutes per 6-turn run).
3. **Multi-user runs end with a harness error:** `Cannot read properties of null (reading 'provideConversationFeedback')`. This happens because feedback was disabled for the comparison and the multi-user runner calls it anyway. It occurs after all turns finish and in both versions, so no data was lost.
4. **The doctor in `gip_restart_after_gap`** used some of the 6 turns, so the patient got fewer turns (4 before, 7 after).

## Open problems seen (not fixed by these changes)

1. **Emergency symptoms rated NONE.** Chest pain, dizziness and shortness of breath were rated criticality NONE on turn 1 in every run, before and after. The doctor request now goes out, but the message wasn't treated as an emergency. Possible causes: JSON fallback in the clinical agent, or the clinical result not reaching the analysis output. This needs investigation and clinical review, and is the most important follow-up.
2. **Questions still dominate** `generated_anxious_patient_medication_lying` (100% of replies end in "?"), which is issue #1 in the fix plan.
3. **The confirmation text overstates delivery.** "I've notified the doctor" is sent whether or not a doctor member exists (issue #9).

## Model comparison: Llama 4 Scout vs Llama 4 Maverick (same fixed code)

The same 4 scenarios × 2 runs × 6 turns were run on the fixed code with `BEDROCK_MODEL_ID=us.meta.llama4-maverick-17b-instruct-v1:0`, set as an environment override for the run (`.env` unchanged). **Confound:** the synthetic patients also ran on Maverick, so their messages differ from the Scout runs. Agent quality and input differences can't be fully separated.

| Metric (fixed code) | Scout | Maverick |
|---|---|---|
| "invalid JSON" log lines | 62 | **30** |
| Average seconds per 6-turn run | 138 | 110 |
| Agent turns completed | 48 | 44 (one run crashed, see below) |
| Turns whose intent includes `REQUESTING_DOCTOR` | 3 | 0 |
| Escalations created | 4 | **0** |
| Turns rated HIGH / URGENT_INTERVENTION | 4 | 3 |
| Replies ending in "?" (`generated_anxious_patient_medication_lying`) | 100% | 50% |

**What this shows:**

- **Maverick is more reliable and faster:** half the JSON failures and about 20% quicker runs. Its replies also end in questions less often in the anxious-patient scenario.
- **It didn't fix emergency triage.** "I'm experiencing *severe* chest pain, dizziness, and shortness of breath" was still rated criticality NONE on turn 1 in both runs. With no `REQUESTING_DOCTOR` in the intent, nothing was escalated. In run 2 the agent told the patient "I'm going to stay on the line with you until help arrives", which is a claim of an action it never took (issue #9).
- **Zero escalations even on URGENT_INTERVENTION turns.** This is a code bug, not a model problem. See problem 4 below.

The model change helps JSON reliability, but the triage failures are mostly in the pipeline. A larger model alone won't fix them.

## New bugs found in these runs

4. **`URGENT_INTERVENTION` is never acted on.** `prompts/enrichment_prompt.js:24` lets the model return criticality `NONE | LOW | HIGH | URGENT_INTERVENTION`. Every escalation check looks only for `HIGH` or `CRITICAL`:
   - `aiAnalysisHandler.js:334`
   - `escalationTiers.js:33, 218`
   - `factReporting.js:65`

   So the most severe rating is silently treated as no action. It was seen on 3 Maverick turns and 2 Scout turns. Fix: map it to `HIGH`/`CRITICAL` at parse time, or include it in the checks. This needs a clinical-policy decision about which tier it maps to.
   **Status: fixed (not yet re-simulated).**
   - **One scale:** NONE < LOW < MEDIUM < HIGH (`constants.js`: `CRITICALITY_LEVELS`, `CRITICALITY_ORDER`).
   - **Enrichment prompt** uses that scale, with the same level definitions as the clinical and unified prompts.
   - **New `utils/criticality.js`:** `normalizeCriticality()` maps `URGENT_INTERVENTION`, `CRITICAL`, `URGENT`, `EMERGENCY` and `SEVERE` to HIGH, and `MODERATE` to MEDIUM. A pipe-separated value resolves to its most severe part. An unknown value falls back to the prior rating instead of passing through.
   - **Where it's applied:** the enrichment result (both call sites), the companion→analysis conversion, unified-agent output, and the clinical agent's parsed output.
   - Unit-tested in `tests/agent_fixes.test.js`.
5. **Crash on a null fact.** `Cannot read properties of null (reading 'subject')` aborted one Maverick run (`fall_with_injury`). `factReporting.js` and `adviceSharing.js` read `fact.subject` without checking for a null entry in the model's facts array. Fix: filter out null facts before sharing.

## Root cause of emergency symptoms rated NONE (open problem 1): fixed

**Cause:**
- `makeApiCall` (`agents/api/index.js`) defaulted to `maxTokens = 100`. The clinical agent and 8 other JSON callers didn't pass a limit, so they got that default.
- The clinical JSON is about 250 tokens, so it was cut off mid-string, *after* `"criticality": "HIGH"` had already been written. The parser rejected the unfinished JSON, and each call was retried 5 times.
- After the last retry, `makeApiCall` returned a fallback object with `criticality: 'NONE'`. The clinical agent then reported "No immediate medical concerns", with no error logged.
- This also accounts for most of the ~60 "invalid JSON" lines per run. Maverick only looked more reliable because its answers are shorter.

**Fix:**
1. JSON calls now default to 1000 tokens; plain-text calls stay at 100. Explicit limits passed by callers are unchanged.
2. The fallback object carries `isFallback: true`. `parseCompanionResponse(result, '<Component>')` logs `[<Component>] LLM call failed; using fallback defaults`, and the clinical agent's result includes `llmFallback` so later code can tell a failure apart from a real NONE.

Tests in `tests/bedrock_provider.test.js` check the sent token limits (1000 / 100 / explicit 300) and the fallback flag.

**Live check:** I called the clinical agent directly on "severe chest pain, dizziness, and shortness of breath", 3 times per model.

| | Before fix | After fix |
|---|---|---|
| Scout | NONE ×3 (all retries failed) | **HIGH ×3**, no JSON failures |
| Maverick | NONE ×3 (all retries failed) | **HIGH ×3**, no JSON failures |

**Not changed:** callers that pass their own small limits for JSON may still truncate:

- `agents/stateAgent.js:19` and `agents/utilityAgents.js:24` (100)
- `agents/unifiedAgent.js:72, 83` (300, which includes the main unified analysis)

**Still open:** fail-safe behavior when the clinical call fails (`llmFallback`) is a policy decision.

**Effect on the earlier comparisons:** all the simulation runs above were affected by this bug on both sides, so they need re-running.

## Re-run after all fixes (2026-10-29): before vs after, Maverick and Scout

**Setup:**
- **Before:** `73c16e5`, with none of the fixes.
- **After:** the working tree with all fixes: #2, #4, #7, #9a, the single criticality scale and conversion function, the JSON token limit, and the fallback flag.
- Each set ran 4 scenarios × 2 runs × 6 turns. The model was set per run through `BEDROCK_MODEL_ID`; synthetic patients used the same model as the agent.

| Metric | Maverick before | Maverick after | Scout before | Scout after |
|---|---|---|---|---|
| Runs (crashed) | 8 (1) | 8 (0) | 8 (0) | 8 (0) |
| Agent turns | 42 | 48 | 48 | 48 |
| **Chest-pain turn 1 criticality (run 1, run 2)** | **NONE, NONE** | **HIGH, HIGH** | **NONE, NONE** | **HIGH, HIGH** |
| "invalid JSON" log lines | 127 | **6** | 275 | **1** |
| Components that fell back to defaults | not logged | 0 | not logged | 0 |
| All escalations | 3 | 7 | 4 | 5 |
| Escalation types | CRITICAL, CONFLICT | DOCTOR_REQUEST, CRITICAL | DOCTOR_REQUEST, CRITICAL | DOCTOR_REQUEST, CRITICAL |
| Turns with `REQUESTING_DOCTOR` → `DOCTOR_REQUEST` escalations | 0 → 0 | 1 → 1 | 3 → 1 | 2 → 1 |
| Turns rated HIGH (or URGENT) | 4 | 6 | 7 | 4 |
| Criticality distribution | NONE:36 LOW:2 URGENT_INTERVENTION:3 HIGH:1 | NONE:29 MEDIUM:13 HIGH:6 | NONE:31 LOW:10 HIGH:6 URGENT_INTERVENTION:1 | NONE:24 MEDIUM:13 LOW:7 HIGH:4 |
| Replies ending in "?" | 50% | 60% | 71% | 67% |
| Average seconds per 6-turn run | 109 | 92 | 171 | **97** |

**Findings:**

1. **The emergency is now detected on the first message.** "Severe chest pain, dizziness, and shortness of breath" went from NONE in every before run to HIGH in every after run, on both models. In every after run the turn produced a `CRITICAL` escalation.
2. **JSON failures are almost gone.** They fell from 127 → 6 (Maverick) and 275 → 1 (Scout), and no component fell back to defaults in the after runs. Scout runs are 43% faster (171 s → 97 s) because the retries are gone.
3. **MEDIUM now appears** (13 turns per model, previously 0). The clinical agent's MEDIUM ratings used to be lost to truncation, so routine-review concerns are now visible to later code.
4. **`URGENT_INTERVENTION` no longer appears.** The single scale and conversion function map it to HIGH.
5. **No crashes in the after runs.** The before Maverick set hit the null-`fact.subject` crash once. It wasn't triggered in the after runs, but it isn't fixed yet.
6. **Model choice matters much less once the bugs are fixed.** Maverick and Scout now produce similar results. Scout's earlier "worse JSON" was mostly the truncation bug.

**New issues these runs exposed (not fixed):**

- **The agent claims actions it never took** (issue #9), now on most emergency turns. Examples:
  - "Help is on the way… until the emergency responders arrive"
  - "I've already sent for medical help and they're on their way to 123 Main Street"
  - "I'm going to stay with you until the ambulance arrives"

  The system only records an escalation to the care circle. It doesn't contact emergency services. This is a patient-safety issue and the highest priority next.
- **Duplicate escalations:** one Maverick run logged 4 `CRITICAL` escalations, one per HIGH turn, for the same emergency. Escalations aren't de-duplicated per incident.
- **Doctor-request routing is now rarely tested:** the synthetic patients seldom ask for a doctor (0–3 turns per set), so 2 runs per scenario can't measure #4 well. Use a targeted scenario or more runs.

**Caveat:** there are 2 runs per scenario and the synthetic patients vary between runs. The chest-pain turn-1 result and the JSON/timing changes are consistent across all runs. Smaller differences, such as the share of replies ending in a question, are within run-to-run variation.

## Reproducing

The harness and raw results are in the session scratchpad (not committed):

- `harness.mjs <repoRoot> <label> <turns> <runs> <scenario...>`: runs scenarios on fresh DBs and writes `results_<label>.json` (per-turn intent, criticality, reply, plus escalations and pending actions from the DB).
- `summarize.cjs`: prints the per-scenario before/after tables.

To rerun the baseline, check out `73c16e5` in a worktree, link `node_modules`, copy `.env`, and run the harness against both trees. If the harness should become a permanent tool, move it to `training/scripts/`.
