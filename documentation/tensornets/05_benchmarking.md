# Benchmarking System

> Database: `data/dbs/care_circle_dev.db` (SQLite)  
> Node.js routes: `routes/training.js`, `db/queries_benchmarks.js`  
> Python endpoints: `server.py /benchmark/*`  
> Dashboard: GUI → Benchmarks tab

---

## 1. Purpose

The benchmarking system captures every training episode, turn, and score in a queryable database. It serves three purposes:

1. **Live monitoring** — the GUI Benchmarks dashboard shows reward trends, failure rates, and per-experiment comparisons as training runs.
2. **Post-hoc analysis** — SQL queries over `htn_benchmark_turns` support the comparison metrics in `06_results.md`.
3. **Baseline anchoring** — a `baseline_cutoff_ts` field in `htn_benchmark_metadata` marks which runs are pre-HTN (baseline) and which are post-HTN, enabling a clean before/after comparison.

> **Terminology note**: the DB column is named `arm` for backwards-compatibility. In all new queries and reports, treat `arm` as the experiment identifier — it stores `htn_mcts`, `oldschool`, or `hysteresis_prompt`.

---

## 2. Database schema

### htn_benchmark_runs

One row per training run (`run_013`, `run_014`, ...).

| Column | Type | Description |
|---|---|---|
| `run_id` | TEXT PK | e.g. `run_013` |
| `arm` | TEXT | `htn_mcts` \| `oldschool` \| `hysteresis_prompt` (experiment identifier) |
| `started_at` | TIMESTAMP | ISO 8601 |
| `ended_at` | TIMESTAMP | NULL while running |
| `total_episodes` | INTEGER | |
| `mean_reward` | REAL | Mean scalar reward per turn |
| `config` | JSON | `{episodes, checkpoint_every, patient_mode, arms, ...}` |

### htn_benchmark_episodes

One row per completed episode.

| Column | Type | Description |
|---|---|---|
| `episode_id` | TEXT PK | UUID |
| `run_id` | TEXT FK | → htn_benchmark_runs |
| `arm` | TEXT | |
| `scenario_id` | TEXT | e.g. `deaddiction_alcohol_rapport` |
| `turn_count` | INTEGER | |
| `cumulative_reward` | REAL | |
| `mean_reward_per_turn` | REAL | |
| `genuine_metrics` | JSON | `{change_stage_delta, stress_auc, turns_to_goal, goal_achieved, ...}` |
| `session_memory` | JSON | Final state for multi-session continuity |
| `started_at` / `ended_at` | TIMESTAMP | |

### htn_benchmark_turns

One row per companion turn. The most granular table — used for per-action analysis.

| Column | Type | Description |
|---|---|---|
| `turn_id` | TEXT PK | UUID |
| `episode_id` | TEXT FK | |
| `run_id` | TEXT FK | |
| `arm` | TEXT | |
| `turn_idx` | INTEGER | 0-based within episode |
| `action` | TEXT | Selected action from ACTION_TAXONOMY |
| `stress_index` | REAL | Physio state at this turn |
| `stress_bucket` | TEXT | `low` \| `moderate` \| `high` |
| `therapeutic_mode` | TEXT | |
| `deaddiction_phase` | TEXT | |
| `scalar_reward` | REAL | |
| `reward_breakdown` | JSON | `{stress, trust_delta, goal_progress, ...}` |
| `judge_score` | JSON | `{scorer_integer, scorer_continuous, critical_failure, issues}` |
| `judge_modifiers` | JSON | `{pester_penalty, rapport_bonus, physio_modifier, delivery_quality, vint_updates}` |
| `patient_message` | TEXT | Synthetic patient's turn |
| `response` | TEXT | Companion's response |
| `tokens` | JSON | `{scout, maverick}` token counts |
| `latency_ms` | REAL | End-to-end turn latency |

### htn_benchmark_metadata

Key-value store for run-level metadata.

| Key | Value |
|---|---|
| `baseline_cutoff_ts` | `2026-05-23T23:59:59 IST` — runs before this are pre-HTN |
| `run_count` | Total runs stored |
| `last_run_id` | Most recent run |

### htn_transcripts

Full conversation transcripts keyed by episode. Used by the Simulation Report and by the HTN judge for batch offline evaluation.

---

## 3. Data flow

```
train.py (Python)
  │  _db_create_run(run_id, arm, config)
  │  POST /benchmark/run/create
  │
  ├─ per episode:
  │   _db_create_episode(episode_id, run_id, arm, scenario_id)
  │   POST /benchmark/episode/create
  │
  └─ per turn:
      POST /benchmark/turn (payload: TurnRecord)

server.py (FastAPI)
  → receives /benchmark/* requests
  → forwards to Node.js POST /api/benchmark/run, /api/benchmark/episode, /api/benchmark/message

routes/training.js (Node.js)
  → validates payload
  → writes to SQLite via db/queries_benchmarks.js
  → broadcasts to GUI via websocket (live dashboard update)
```

**Note on schema migration:** `server.js` calls `addHTNBenchmarkTables()` and `addConversationIntelligenceTables()` on startup to ensure all benchmark tables exist. Runs that start before the server restarts do not need a manual migration step.

---

## 4. GUI Benchmarks dashboard

The Benchmarks tab (`gui/ui/benchmarksDashboard.js`) shows:

- **Run summary table**: run_id, arm, episodes, mean reward, date
- **Reward curve**: mean reward per episode over training (per arm, colour-coded)
- **Genuine metrics panel**: stress_auc, goal_achieved%, turns_to_goal distribution
- **Action heatmap**: which actions are selected most frequently per stress bucket
- **Failure analysis**: 2-strike failure count, skipped episodes, negative-reward episodes
- **Simulation report link**: opens the HTML simulation report in an iframe

The dashboard auto-refreshes when the Benchmarks tab is clicked (`navigationHandlers.js`). It does NOT poll continuously — it reads the current DB state on tab activation.

---

## 5. Simulation report

An HTML simulation report is generated after each training run. It includes:

- Per-scenario win rates (which arm performed best on each scenario type)
- Trust-delta trajectories per arm
- Conversation excerpts (sampled turns where arms diverged significantly)
- Stress AUC distribution per arm

The report is stored at `training/analysis/reports/simulation_report.html` and linked from the GUI.

---

## 6. Baseline separation

The `baseline_cutoff_ts` metadata key (`2026-05-23T23:59:59 IST`) marks the boundary between:

- **Pre-HTN baseline**: runs before May 23, 2026 — the production JS companion without any MPS/MCTS layer
- **Post-HTN treatment**: runs from May 24 onwards — full HTN stack active

All comparison analyses should filter on this cutoff to avoid mixing pre/post data.

---

## 7. Cost tracking

Each turn record stores `tokens.scout` and `tokens.maverick` (word-count × 2 approximation). Per-episode cost can be estimated from the DB:

```sql
SELECT arm,
       AVG(json_extract(tokens, '$.scout'))    AS avg_scout_tokens,
       AVG(json_extract(tokens, '$.maverick')) AS avg_maverick_tokens,
       COUNT(*)                                AS turn_count
FROM htn_benchmark_turns
WHERE run_id = 'run_013'
GROUP BY arm;
```

At Bedrock pricing (~$0.17 / 1M input tokens for Scout, ~$0.72 / 1M for Maverick), a 200-episode run costs approximately $8–15 depending on turn length and scorer call frequency.
