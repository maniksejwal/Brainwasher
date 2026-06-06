# GUI Architecture

## 1. Overview

The GUI is an Electron/web application served at `:8247/gui` by the Node.js server. It uses a multi-panel layout:

```
┌─────────────────────────────────────────────────────────────┐
│  Nav bar: Circle | My Circles | Patients | Business |       │
│           Feedback (tabs) | Chat                            │
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│    Chat pane             │   Side panel                     │
│    (companion UI)        │   (circle info / patients /      │
│                          │    business / benchmarks)        │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

**Entry point**: `gui/index.html` (962 lines). Bootstraps the app, defines all panel HTML, and imports JS modules via `<script type="module">`.

**Key panels**

| Panel | Trigger | Contents |
|---|---|---|
| Chat | default / `#view-selector` | Companion chat, voice input, message list |
| Circle | `#circle-btn` | Active care circle info, member list |
| My Circles | `#mycircles-btn` | Multi-circle management |
| Patients | `#patients-btn` | Doctor/admin patient list |
| Business | `#business-btn` | Business scenario dashboard |
| Feedback tabs | `#feedback-btn` | Sub-tabs: feedback, conversations, logs, training, simulation-logs, reports, **benchmarks** |

The benchmarks view is a sub-tab of the Feedback panel, activated when the user clicks the "benchmarks" tab element.

---

## 2. Module map

| File | Purpose | Key exports / functions |
|---|---|---|
| `gui/index.html` | App shell, HTML layout, script bootstrap | — |
| `gui/ui/benchmarksDashboard.js` | Full A3C benchmark visualisation dashboard | `initBenchmarksDashboard`, `refreshBenchmarksDashboard`, `renderRecentStatsTable`, `loadInlineReport`, `initConversationViewer` |
| `gui/ui/navigationHandlers.js` | Tab/panel switching, keyboard shortcuts, refresh wiring | `setupNavigationHandlers` |
| `gui/ui/dataLoaders.js` | Data fetch helpers for circle, patients, business, feedback | `switchView`, `loadCircleInfo`, `loadMyCirclesData`, `loadPatientsData`, `loadFeedbackData`, `loadConversationsData`, `loadServerLogs`, `loadBusinessData` |
| `gui/ui/simulationLogsUI.js` | Simulation log display | `loadConversationLogs` |
| `gui/ui/reportUI.js` | Training report display | `generateAndShowReport` |
| `gui/config.js` | API base URL and global config | default export `config` |
| `routes/benchmarks.js` | Express routes for benchmark data (write + read) | See §5 |
| `db/queries_benchmarks.js` | SQLite queries backing the benchmark API | See §6 |

---

## 3. benchmarksDashboard.js — Benchmark Visualisation

`gui/ui/benchmarksDashboard.js` (2,226 lines) is the single-file dashboard for all A3C training data.

### Fetch → canonicalize → render pipeline

```
_refresh()
    │  Promise.all of all fetchers
    ├─ _fetchTimeline()      → _state.timeline
    ├─ _fetchMetrics()       → _state.metrics
    ├─ _fetchScenarioGoals() → _state.scenarioGoals
    ├─ _fetchPhysio()        → _state.physio
    ├─ _fetchCritFail()      → _state.critFail
    ├─ _fetchRewardComponents() → _state.rewardComponents
    ├─ _fetchCheckpoints()   → _state.checkpoints
    └─ _fetchSimStats()      → _state.simStats
         │
         │  Each fetcher calls _canonicalizeArm(row) on every row
         │  Legacy arm names (htn_mcts, hysteresis_prompt) → canonical
         │  EXP_KEYS before storage
         ▼
    _renderAll() → calls every _render* function in order
```

`_state` is a single mutable object that is never exported. All render functions read exclusively from it.

### Experiment metadata (EXP_META / EXP_KEYS)

`EXP_META` defines the canonical experiment arms: label, short label, hex colour, rgba fill. `LEGACY_ALIAS` maps old arm names to canonical names (rename happened at `run_015`, 2026-05-31). Rows from legacy runs are remapped at fetch time so old + new data plot as a continuous line with a grey partition marker.

### Chart types

| Chart | Render function | Description |
|---|---|---|
| Learning curves | `_buildLineDatasets` | Per-arm WMA of cumulative reward, goal rate, stress AUC. Run-restart gaps injected as `null` points (`spanGaps:false`). Ctrl+wheel zoom via `_ZOOM_PLUGIN`. |
| Scenario goal-rate bar chart | `_renderScenarioGoalRates` | Overlapping bars sorted worst-first; `barPercentage:1, categoryPercentage:0.85`. |
| Scenario rank table | `_renderScenarioRankTable` | Heat-coloured cells, sortable by arm or mean. Sticky episode-count row includes legacy data. |
| Sensor vs. no-sensor | `_renderSensorComparison` | Classifies rows by `scenario_id.endsWith('_no_sensor')` or `arm==='oldschool'`. Stat cards + grouped bar chart. |
| Cost/latency | `_renderCostCharts` | Per-arm box plots of `latency_ms` and estimated USD cost from Python `CostTracker`. |
| Metric bars | `_renderMetricBars` | Overlapping bars for goal rate, mean reward, stress AUC per run. |

### Key public functions

| Function | Purpose |
|---|---|
| `initBenchmarksDashboard()` | First-time mount; creates all Chart.js instances and wires controls. Called by `navigationHandlers.js` on each "benchmarks" tab activation. |
| `refreshBenchmarksDashboard()` | Re-fetches all data then re-renders (equivalent to a tab reload without logging out). Wired to the `↻ Refresh` button. |
| `renderRecentStatsTable()` | Re-renders the recent-N stats summary table. Wired to the "Apply" button and Enter key in `#recent-stats-n`. |
| `loadInlineReport(frameId)` | Loads the latest HTML simulation report into an iframe. Used by the Reports sub-tab. |
| `initConversationViewer()` | Initialises the episode conversation viewer (JSONL episode replay UI). |
| `mountDialogGraphViewer(runId, episodeId)` | Mounts the MCTS graph dialog for visual comparison of MCTS tree search within a specific episode. Relevant for comparing CoT-MCTS arm vs. MPS arm. |
| `loadCompare(scenarioSet)` | Calls `POST /api/benchmarks/compare` and renders the multi-arm comparison panel. Used to compare experiment arms on a fixed scenario set. |

### Zoom / pan

All line charts share `_ZOOM_PLUGIN` (chartjs-plugin-zoom + hammerjs). Only `Ctrl+wheel` triggers zoom; normal scroll is never intercepted. Drag-pan on x-axis; pinch zoom on touch.

---

## 4. navigationHandlers.js — Navigation

`gui/ui/navigationHandlers.js` (160 lines) wires all panel switches and the benchmarks tab lifecycle.

**`setupNavigationHandlers(api, state)`** — single entry point called from `index.html`. Registers click listeners on all nav buttons and tab elements.

**Panel switching** (`switchView(name)` from `dataLoaders.js`)

| Button ID | Target view | Side effect |
|---|---|---|
| `#circle-btn` | `circle` | `loadCircleInfo(api, state.userId)` |
| `#mycircles-btn` | `mycircles` | `loadMyCirclesData(api, state.userId)` |
| `#patients-btn` | `patients` | `loadPatientsData(api, state.userId)` |
| `#business-btn` | `business` | `loadBusinessData(api, state.userId)` |
| `#feedback-btn` | `feedback` | `loadFeedbackData` + `loadConversationsData` |
| `#view-selector`, `#back-to-chat*` | `chat` | — |

**Benchmarks tab activation** (within the Feedback panel's `.tab` click handler)

When `tabName === 'benchmarks'`:
1. `initBenchmarksDashboard()` — full mount
2. `initConversationViewer()` — episode viewer
3. Wires `#bench-refresh-btn` → `refreshBenchmarksDashboard()`
4. Wires `#recent-stats-apply` button and `#recent-stats-n` Enter key → `renderRecentStatsTable()`

**Reports tab activation**: calls `loadInlineReport('report-inline-frame')` and wires the reload and generate buttons.

---

## 5. Benchmark API (routes/benchmarks.js)

Mounted at `/api/benchmarks` by `server.js`.

### Write endpoints (called from Python `tensornets/server.py`)

| Method | Path | Handler | Purpose |
|---|---|---|---|
| POST | `/run` | `createBenchmarkRun` | Create a new training run record |
| POST | `/run/finalise` | `finaliseBenchmarkRun` | Write aggregate metrics at run end |
| POST | `/episode` | `createBenchmarkEpisode` | Create an episode record |
| POST | `/episode/finalise` | `finaliseBenchmarkEpisode` | Write episode metrics (supports nested `{metrics:{...}}` or flat body) |
| POST | `/turn` | `recordBenchmarkTurn` | Record a single episode turn |
| POST | `/checkpoint` | `insertCheckpointEvent` | Record an actor/critic checkpoint event |

### Read endpoints (called from GUI dashboard and CLI)

| Method | Path | Query params | Purpose |
|---|---|---|---|
| GET | `/runs` | `arm`, `limit` | List all runs, newest first |
| GET | `/runs/:run_id` | — | Get one run with its episodes |
| GET | `/scenario-breakdown/:run_id` | — | Per-scenario goal rate for a run |
| GET | `/learning-curves` | `run_id`, `limit`, `window` | Smoothed learning curve rows |
| GET | `/timeline` | `arm`, `window` | Full merged experiment timeline (cross-run) |
| GET | `/timeline/slim` | `arm`, `window` | Slim timeline (key columns only) |
| GET | `/metrics` | — | Experiment metric summary |
| GET | `/scenario-goals` | — | Scenario-level goal rates across all runs |
| GET | `/checkpoints` | — | All checkpoint events |
| POST | `/compare` | body: `{scenario_set}` | Multi-arm comparison on a scenario set |

---

## 6. Database schema (db/queries_benchmarks.js)

`db/queries_benchmarks.js` (1,009 lines) implements all DB queries. Tables are created by `addHTNBenchmarkTables` (called lazily on first write).

### htn_benchmark_runs

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT PK | UUID |
| `arm` | TEXT | Canonical experiment arm name |
| `label` | TEXT | Human-readable label |
| `scenario_set` | TEXT | e.g. `canonical_10` |
| `config` | TEXT | JSON: hyperparams, model IDs, random seed |
| `started_at` | INTEGER | Unix ms |
| `completed_at` | INTEGER | Unix ms |
| `episode_count` | INTEGER | Total episodes in run |
| `mean_reward` | REAL | Final aggregate mean reward |
| `mean_stress_auc` | REAL | Final aggregate mean stress AUC |
| `goal_achieved_pct` | REAL | Fraction of episodes with goal achieved |
| `notes` | TEXT | Free-form notes |

### htn_benchmark_episodes

| Column | Type | Notes |
|---|---|---|
| `episode_id` | TEXT PK | UUID |
| `run_id` | TEXT FK | → `htn_benchmark_runs.run_id` |
| `arm` | TEXT | Arm name (denormalised for query speed) |
| `scenario_id` | TEXT | Scenario identifier |
| `n_turns` | INTEGER | Actual turns taken |
| `cumulative_reward` | REAL | Episode total reward |
| `goal_achieved` | INTEGER | 0/1 |
| `stress_auc` | REAL | Stress area-under-curve |
| `started_at` / `completed_at` | INTEGER | Unix ms |

### htn_benchmark_turns

| Column | Type | Notes |
|---|---|---|
| `turn_id` | TEXT PK | UUID |
| `episode_id` | TEXT FK | → `htn_benchmark_episodes.episode_id` |
| `run_id` | TEXT | Denormalised |
| `arm` | TEXT | Denormalised |
| `turn_index` | INTEGER | 0-based turn number within episode |
| `message` | TEXT | Patient/user message |
| `response` | TEXT | Agent response |
| `reward` | REAL | Turn-level reward |
| `stress_index` | REAL | Physio stress at this turn |
| `action` | TEXT | Agent action token |
| `latency_ms` | INTEGER | Response latency |
| `cost_usd` | REAL | Estimated LLM cost |
| `recorded_at` | INTEGER | Unix ms |
