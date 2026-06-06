# JS Training Pipeline

## 1. Overview

The JS training pipeline bridges the Node.js application layer with the Python A3C training loop.

```
routes/training.js
    │  GET /api/training/scenarios  ──►  tensornets Python (scenario_loader.py)
    │                                         │
    │                                    A3C episode loop
    │                                    (worker.py, arms.py)
    │                                         │
    │  POST /api/benchmark/message  ◄──  Arm 2 (oldschool)
    │                                         │
    │                                    episode JSONL files
    │                                         │
    │                              training/analysis/ pipeline
    │                                         │
    │                                    HTML simulation report
    └──────────────────────────────────────────────────────────
```

Key responsibilities of the JS layer:
- Serve canonical scenario definitions to the Python A3C training loop on startup
- Accept synchronous companion calls from A3C Arm 2 (oldschool benchmark)
- Normalise JS snake_case mode category strings to valid Python `TherapeuticMode` enum values
- Generate stochastic physiological baselines for each participant using role- and scenario-aware distributions

---

## 2. routes/training.js — API Contract

Mounted at `/api` by `server.js`. Two public endpoints plus the internal `_buildCanonicalScenarios` builder.

### 2.1 GET /api/training/scenarios

Returns the canonical scenario list consumed by `tensornets/a3c/scenario_loader.py` on startup.

**Query parameters**

| Param | Values | Default |
|---|---|---|
| `domain` | `deaddiction \| flooding \| negotiation \| standard \| all` | `all` |
| `id` | any `scenario_id` string | — |

**Response shape** (per scenario object)

| Field | Type | Notes |
|---|---|---|
| `scenario_id` | string | Unique ID, e.g. `flooding_cardiac_patient`, `js_escalation_01`, `world_blended_family` |
| `therapeutic_mode` | string | Valid Python `TherapeuticMode` value — see §2.3 |
| `domain` | string | Raw JS category, e.g. `deaddiction`, `escalation`, `privacy` |
| `deaddiction_phase` | string | `precontemplation \| contemplation \| preparation \| action \| maintenance \| flooding_exposure` |
| `session_goal` | string | Human-readable goal string |
| `agent_instruction` | string | Instruction injected into agent system prompt |
| `max_turns` | int | Episode turn budget |
| `context_window` | int | Token context window hint |
| `archetype` | string | `standard \| anxious \| resistant \| avoidant` |
| `has_misconception` | bool | Whether the scenario involves a clinical misconception |
| `flooding_target_stress` | float | Target stress index for flooding exposure (0.0 otherwise) |
| `initial_physio` | object \| null | Physiological state dict; `null` on `_no_sensor` variants |
| `physio_source` | string | `"sensor" \| "simulated" \| "none"` |
| `patient_prompt` | string | Persona `prompt_template` passed to synthetic patient LLM |
| `caregiver_prompt` | string \| null | Caregiver role prompt (multi-user scenarios) |
| `relative_prompt` | string \| null | Relative role prompt |
| `doctor_prompt` | string \| null | Clinician role prompt |
| `required_elements` | string[] | Goals that must be achieved for goal_achieved=true |
| `users` | object[] | Array of `{role}` dicts defining care circle participants |
| `context` | string | Scenario narrative context |
| `escalation_expected` | bool | Whether escalation to clinician is required/rewarded |
| `consent_boundary_test` | bool | Whether scenario tests privacy/consent enforcement |
| `is_world_scenario` | bool | Multi-care-circle scenario flag |

**Scenario sources built by `_buildCanonicalScenarios`**

| Source | Prefix | Count (approx.) |
|---|---|---|
| `THERAPY_SCENARIOS` (deaddiction) | `deaddiction_*` | ~15 |
| `THERAPY_PERSONAS` (flooding domain) | `flooding_*` | ~8 |
| `PROFESSIONAL_CRITIQUE_SCENARIOS` | `negotiation_*` | ~10 |
| `EDGE_CASE_PERSONAS` (care circle) | `edge_*` | ~12 |
| `BUSINESS_SCENARIOS` | `business_*` | ~8 |
| `SCENARIOS` (unified JS library) | `js_*` | ~100+ |
| `WORLD_SCENARIOS_DEFINITIONS` | `world_*` | ~15 |
| `_no_sensor` clones (all of the above) | `*_no_sensor` | mirrors above |

### 2.2 POST /api/benchmark/message

The Arm 2 ("oldschool") endpoint. Used by `tensornets/a3c/arms.py` to run a full companion turn through the production JS stack.

**Request body**

| Field | Type | Required |
|---|---|---|
| `message` | string | yes |
| `sessionId` | string | no |
| `arm` | string | no (defaults to `"oldschool"`) |

The route internally calls `_ensureBenchmarkContext()` which logs in as `benchmark_a3c` (a synthetic user) and caches its `userId` and `activeCircleId`. Subsequent calls reuse the cached context.

**Response**

```json
{
  "response":     "<companion reply text>",
  "agent_action": "<action string or null>",
  "session_id":   "<sessionId or null>",
  "arm":          "oldschool",
  "latency_ms":   142
}
```

Errors: `400` if `message` missing; `503` if benchmark context unavailable; `500` on internal error.

### 2.3 TherapeuticMode normalisation map

`JS_MODE_TO_PYTHON` in `routes/training.js` maps every JS category string to a valid Python `TherapeuticMode` enum value. The Python enum accepts exactly five values:

```
standard | flooding | behaviour_change | deaddiction | negotiation
```

Key mappings (selected):

| JS category | Python mode | Rationale |
|---|---|---|
| `behavior_change` | `behaviour_change` | US→UK spelling |
| `mental_health`, `crisis`, `escalation`, `safety`, `caregiver`, `ethical`, `privacy` | `standard` | Clinical support, no specialised mode |
| `preventative`, `education`, `rehabilitation`, `cognitive`, `chronic`, `avoidance`, `lifestyle` | `behaviour_change` | Behaviour change intent |
| `relapse_prevention` | `deaddiction` | Deaddiction protocol |
| `professional`, `professional_critique`, `conflict`, `negotiation`, `document_*` | `negotiation` | Negotiation/dispute mode |

`normalisePythonMode(rawMode)` throws on unknown mode strings — fix the scenario definition rather than adding a silent default.

---

## 3. Simulation Personas (training/simulation/personas.js)

`training/simulation/personas.js` is ~1,986 lines and exports `PATIENT_PERSONAS`, `CAREGIVER_PERSONAS`, and helper functions. It is the primary source of synthetic patient behaviour for simulation and training data generation.

### 3.1 Persona schema

| Field | Type | Notes |
|---|---|---|
| `id` / key | string | Dict key used as `personaKey` in scenario files |
| `name` | string | Character name |
| `description` | string | One-line clinical description |
| `age` | int | Character age |
| `gender` | string | |
| `diagnosis` | string | Primary diagnosis |
| `change_stage` | string | Motivational stage matching `deaddiction_phase` |
| `archetype` | string | `standard \| anxious \| resistant \| avoidant \| denial_prone` |
| `traits` | object | Quantified trait vector — see §3.2 |
| `prompt_template` | string | Full LLM system prompt injected at training time |
| `drug_regimen` | object | Medications and adherence rate |
| `physiological_profile` | object | Optional authored physio baseline (HRV, EDA, sleep deficit) |
| `care_circle` | object[] | Multi-user: array of `{role, prompt_template}` members |
| `common_behaviors` | string[] | Behavioural anchors for the LLM |
| `sample_goals` | string[] | Session-level goals for evaluation |

### 3.2 Trait vector interpretation

Each trait is a float in [0, 1].

| Trait | Clinical meaning | Effect on synthetic patient behaviour |
|---|---|---|
| `health_anxiety` | Degree of somatic preoccupation | High → escalates every symptom, needs reassurance, resists discharge |
| `denial` | Refusal to acknowledge condition severity | High → minimises symptoms, disputes clinician recommendations |
| `frustration` | Affective irritability and low tolerance | High → short replies, topic-pivots, pushes for immediate answers |
| `assertiveness` | Willingness to self-advocate | High → asks pointed questions, challenges agent, demands explanations |
| `forgetfulness` | Medication/recall failures | High → omits key history, contradicts prior statements |
| `honesty` | Accuracy of self-reporting | Low → lies about adherence, hides relapse |

---

## 4. training/rl/ — RL Components

The `training/rl/` directory contains the JS-side reinforcement learning utilities for live prompt optimisation in production (distinct from Python `tensornets/a3c/` which handles training).

### 4.1 Contextual Bandit (contextual_bandit.js)

`ContextualBandit` manages a collection of `ThompsonSampling` instances, one per context segment key. This allows different optimal prompt versions for different user archetypes.

```
contextKey examples:
  "persona:anxious"
  "complexity:high"
  "combined:denial_prone_high"
```

- `getBandit(contextKey)` — lazily creates a per-context bandit, initialising from `priorStatsByType[contextKey]` if available; falls back to `globalBandit` for unknown contexts.
- `selectVersion(context)` — generates a composite key from `context.personaCategory` + `context.complexity`, then delegates to the appropriate bandit.
- Context keys are generated via `_generateContextKey(context)`.

### 4.2 Thompson Sampling (thompson_sampling.js)

`ThompsonSampling` is the shared Beta-distribution bandit used by both `ContextualBandit` and the training orchestrator.

- Tracks `successes[v]`, `failures[v]`, `totalSamples[v]` per prompt version.
- **Exploration phase**: while any version has fewer than `minSamples` (default 20) samples, selects the least-sampled version (pure exploration).
- **Exploitation phase**: samples from `Beta(successes+1, failures+1)` for each version, selects the maximum draw.
- `explorationFactor` (default 1.0) scales the Beta parameters. `confidenceLevel` (default 0.95) is used for statistical significance testing before discarding a version.
- A version cannot be discarded until it has `minRunsBeforeDiscard` (default 15) runs.

### 4.3 Prompt Optimizer (prompt_optimizer_multi.js)

`PROMPT_CONFIGS` in `prompt_optimizer_multi.js` defines every optimisable prompt type across the system:

| Config key | Prompt file | Purpose | Priority |
|---|---|---|---|
| `unified` | `unified_prompt.js` | Main conversational agent | 1 |
| `doctor_summary` | `doctor_prompts.js` | Clinical summary for doctors | 2 |
| `doctor_probe` | `doctor_prompts.js` | Natural question generation from doctor requests | 2 |
| `enrichment` | `enrichment_prompt.js` | Re-evaluation after entity resolution | 3 |
| `intent` | `intent_prompt.js` | User intent classification | 3 |
| `companion_input_understanding` | `companion_input_understanding.js` | Companion input analysis | — |

`MultiPromptOptimizer` (the main export) wraps `PromptOptimizer` from `training/analysis/prompt_optimizer.js` and `FeedbackAnalyzer` from `training/analysis/feedback_analyzer.js` to coordinate A/B testing across all prompt types simultaneously, using priority ordering to prevent conflated signal.

---

## 5. training/analysis/ — Report Generation

The `training/analysis/` directory is a 10-file (plus subdirectories) pipeline that converts raw JSONL episode data into HTML simulation reports.

### Pipeline overview

```
Episode JSONL files
    │
    ▼
training/analysis/feedback_analyzer.js
    Parse episode turns; compute per-turn reward components,
    goal achievement flags, stress AUC, critical failure events.
    │
    ▼
training/analysis/ab_test.js
    Statistical A/B comparison across experiment arms.
    Paired t-tests, confidence intervals, effect sizes.
    │
    ▼
training/analysis/issue_analyzer.js
    Cluster failure modes; identify systematic weaknesses
    per scenario category and per arm.
    │
    ▼
training/analysis/prompt_optimizer.js
    PromptOptimizer: wraps ThompsonSampling; reads feedback
    signal from FeedbackAnalyzer; updates Beta posteriors;
    serialises/deserialises state for persistence.
    │
    ▼
training/analysis/generate_simulation_report.js
    Orchestrates all of the above; calls HTML template renderer.
    │
    ▼
training/analysis/templates/  (HTML/CSS templates)
training/analysis/reports/    (output — not tracked in git)
    │
    ▼
HTML simulation report (viewable via "Reports" tab in GUI)
```

### Key files

| File | Role |
|---|---|
| `feedback_analyzer.js` | Turn-level reward parsing, goal-rate and stress-AUC aggregation |
| `ab_test.js` | Statistical significance tests between arms (33 kB, most complex file) |
| `issue_analyzer.js` | Failure clustering and weakness identification |
| `prompt_optimizer.js` | JS-side PromptOptimizer wrapping ThompsonSampling |
| `generate_simulation_report.js` | Top-level report orchestrator |
| `index.js` | Barrel export |
| `components/` | Reusable HTML report section components |
| `lib/` | Shared utilities (stats helpers, formatters) |
| `templates/` | HTML/CSS Handlebars-style templates |
| `reports/` | Generated output (not tracked in git) |
