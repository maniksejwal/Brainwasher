# HTN Framework — Documentation Index

> **Hysteretic Tensor Negotiation** | PhD Research Project  
> Framework version: post-May 2026 (run_013 baseline, run_014+ with full stack)

---

## documentation/tensornets/ — Technical documentation (this package)

| File | Contents |
|---|---|
| [`01_overview.md`](01_overview.md) | What, why, core concepts (MPS, hysteresis, V_int, action taxonomy), primary references |
| [`02_tensornets_reference.md`](02_tensornets_reference.md) | Full package layout, class/method reference for every major module |
| [`03_physiological_model.md`](03_physiological_model.md) | Physio state vector, hysteretic baseline, reactivity profiles, PK/PD drug models, deviations from PDS |
| [`04_training_system.md`](04_training_system.md) | A3C three-arm design, POMDP-H formulation, reward signal, synthetic patient, scenarios, checkpointing |
| [`05_benchmarking.md`](05_benchmarking.md) | DB schema, data flow, GUI dashboard, baseline separation, cost tracking |
| [`06_results.md`](06_results.md) | run_013 quantitative results, interpretation, circularity analysis, cost breakdown |
| [`07_future_work.md`](07_future_work.md) | Pending tasks (short/medium/long-term), open questions for committee |

---

## documentation/ — Pre-existing documentation

| File | Contents |
|---|---|
| [`STRATEGIC_OVERVIEW.md`](../STRATEGIC_OVERVIEW.md) | High-level vision, business model, roadmap phases |
| [`architecture.md`](../architecture.md) | System architecture, component diagram, technology stack |
| [`reinforcement_learning_framework.md`](../reinforcement_learning_framework.md) | Original RL framework design (pre-HTN; now superseded by `04_training_system.md`) |
| [`simulation_guide.md`](../simulation_guide.md) | How to run simulations, scenario format, persona authoring |
| [`agentic_framework.md`](../agentic_framework.md) | Multi-agent orchestration, CompanionCoordinator design |
| [`implementation_roadmap.md`](../implementation_roadmap.md) | Phase-by-phase implementation plan |
| [`advancedRL.md`](../advancedRL.md) | Advanced RL concepts (bandits, policy gradient, value learning) |

---

## docs/tensornets/ — Design and planning documents (original)

These are the design specifications that preceded implementation. They should be read alongside the implementation docs above to understand what changed during development.

| File | Contents |
|---|---|
| [`A3C_COMPARISON_DESIGN.md`](../../docs/tensornets/A3C_COMPARISON_DESIGN.md) | Formal three-arm comparison protocol; reward dimensions; statistical analysis plan |
| [`A3C_MPS_DESIGN.md`](../../docs/tensornets/A3C_MPS_DESIGN.md) | MPS integration with A3C; phase plan (Phase 1–5) |
| [`RL_ENVIRONMENT.md`](../../docs/tensornets/RL_ENVIRONMENT.md) | POMDP-H environment spec; state/action/reward/transition definitions |
| [`EXPERIMENTS.md`](../../docs/tensornets/EXPERIMENTS.md) | Experiment tracking: hypotheses, runs, results, notes |
| [`MCTS_COMPARISON.md`](../../docs/tensornets/MCTS_COMPARISON.md) | MCTS vs. bandit comparison; UCB1 vs. Thompson Sampling |
| [`MCTS_WORKED_EXAMPLE.md`](../../docs/tensornets/MCTS_WORKED_EXAMPLE.md) | Step-by-step MCTS trace on a real deaddiction scenario |
| [`TODO_DISTILLATION.md`](../../docs/tensornets/TODO_DISTILLATION.md) | The "distillation paradox": MPS as constraint layer vs. fine-tuning |
| [`Tensor_nets.pdf`](../../docs/tensornets/Tensor_nets.pdf) | Original PDS / theoretical framework (founding document) |

---

## Quick reference: key design decisions

| Decision | What was chosen | Why | File |
|---|---|---|---|
| MPS representation | Tensor network over (semantic, physio) bonds | Compact, locality-preserving, partial trace for privacy | `02_tensornets_reference.md` |
| Hysteresis model | Discrete per-turn extinction + weekly recovery | Tractable, measurable; continuous ODE deferred pending wearables | `03_physiological_model.md` |
| Three-arm design | htn_mcts vs oldschool vs hysteresis_prompt | Isolates contribution of each layer independently | `04_training_system.md` |
| LLM for goal_progress | Maverick judge, not keyword scan | Keyword scan is circular with MCTS reward function | `04_training_system.md` §4.1 |
| Port 8765 | FastAPI on 8765 | Confirmed in `tensornets/server.py` | `05_benchmarking.md` |
| Genuine metrics | change_stage_delta, stress_auc, turns_to_goal | Independent of action-selection heuristics | `04_training_system.md` §4.3 |
| No keyword scan in arms.py | Removed from `_synthetic_reward()` | Reduced circularity; composite now uses action-taxonomy signal only | `06_results.md` §3.3 |

---

## Key citations (compact)

Bouton (2002) · Rescorla & Wagner (1972) · Maren (2001) · Vidal (2004) · Perez-Garcia et al. (2007) · Miller & Rollnick (2013) · Prochaska & DiClemente (1983) · Mnih et al. (2016) · Kleiger et al. (2005) · Agelink et al. (2001) · Roter (2002) · Hatfield et al. (1993) · Pinquart & Sorensen (2004) · Epstein et al. (2007) · Boucsein (2012) · Walker (2017) · Inzlicht & Schmeichel (2012) · Czeisler (1999) · Koran & Litt (1988) · Mason et al. (1999)
