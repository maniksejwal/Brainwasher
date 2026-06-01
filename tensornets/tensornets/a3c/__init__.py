"""
tensornets.a3c — Asynchronous Advantage Actor-Critic package for the HTN framework.

## What it is
Public re-export surface for the A3C sub-package.  Importing from
``tensornets.a3c`` gives access to all training primitives without needing
to know the internal module layout.

## Why it exists
``train.py`` and external callers (tests, the FastAPI server, notebooks) need a
stable import path that does not change when internal modules are reorganised.
This file is the single source of truth for what is "public" in the package.

## Logic / design decisions (citations)
* **Canonical arm names** — Each worker class declares a class-level ``ARM``
  string that matches the arm name written to ``htn_benchmark_episodes.arm``.
  The dashboard's ``LEGACY_ALIAS`` map in ``gui/ui/benchmarksDashboard.js``
  translates the old names (``htn_mcts`` → ``physio_mps_mcts``, etc.) used by
  runs prior to run_015 (2026-05-31).
  See [A3C Redesign chat](bd00417c-24b7-4ba3-8825-da1f77089b74).
* **Eight experiment arms** — Numbered Exp 0–7 and passed to ``train.py`` via
  ``--arms 1 … 8`` (1-indexed CLI, 0-indexed list).  The mapping is:
    1 → PhysioLLMWorker              (physio_llm)
    2 → PhysioLLMCoTMCTSWorker       (physio_llm_cot_mcts)
    3 → PhysioMPSMCTSWorker          (physio_mps_mcts)
    4 → InertialPhysioMPSMCTSWorker  (inertial_physio_mps_mcts)
    5 → InertialPhysioLLMCoTMCTSWorker (inertial_physio_llm_cot_mcts)
    6 → OldschoolWorker              (oldschool)
    7 → InertialHPVOOTPhysioMPSMCTSWorker  (inertial_hpvoot_physio_mps_mcts)
    8 → InertialHPVOOTPhysioLLMCoTMCTSWorker (inertial_hpvoot_physio_llm_cot_mcts)
* **No shared weights** — Arms train independent Actor+Critic networks.  The
  round-robin scheduler in ``train.py`` ensures fair wall-clock time per arm.

## Module structure
    action_bandit     — ActionBandit, ACTION_TAXONOMY, stress buckets
    worker            — Actor, Critic, A3CWorker base, reward math
    arms              — Concrete worker classes (Exp 0–7)
    synthetic_patient — LLM-driven patient simulation
    scorer            — Turn-level scoring (goal, empathy, stress)
    scenario_loader   — Loads scenario definitions from the Node.js API
    cost_tracker      — Per-turn LLM cost + latency accumulator
    hysteresis_gate   — Physiological dead-band / inertia logic
    node_client       — Centralised HTTP client for all Node.js API calls
    train             — CLI entry point; run with ``python -m tensornets.a3c.train``
"""

from tensornets.a3c.action_bandit import (
    ActionBandit,
    ACTION_TAXONOMY,
    STRESS_BUCKETS,
    CALMING_WEIGHT,
    ACTION_INTENT_GROUP,
)
from tensornets.a3c.worker import (
    Actor,
    Critic,
    A3CWorker,
    TurnState,
    compute_advantage,
    apply_update,
    scalar_reward,
    REWARD_DIMS,
    REWARD_WEIGHTS,
)
from tensornets.a3c.arms import (
    PhysioLLMWorker,
    PhysioLLMCoTMCTSWorker,
    PhysioMPSMCTSWorker,
    InertialPhysioMPSMCTSWorker,
    InertialPhysioLLMCoTMCTSWorker,
    OldschoolWorker,
    InertialHPVOOTPhysioMPSMCTSWorker,
    InertialHPVOOTPhysioLLMCoTMCTSWorker,
)
from tensornets.a3c.synthetic_patient import (
    SyntheticParticipant,
    CareCircleOrchestrator,
    ConversationState,
)
from tensornets.a3c.scorer import (
    A3CScorer,
    TurnScoreResult,
    map_scorer_to_reward_dims,
    SCORE_CRITICAL_FAILURE,
    SCORE_STRONG,
)
from tensornets.a3c.scenario_loader import (
    load_scenarios,
    get_scenario,
    random_scenario,
    random_continuation_scenario,
    scenarios_by_domain,
    CANONICAL_SCENARIOS,
    SCENARIO_BY_ID,
    scenarios_for_mode,
    scenarios_for_domain,
)

__all__ = [
    "ActionBandit", "ACTION_TAXONOMY", "STRESS_BUCKETS", "CALMING_WEIGHT", "ACTION_INTENT_GROUP",
    "Actor", "Critic", "A3CWorker", "TurnState",
    "compute_advantage", "apply_update", "scalar_reward",
    "REWARD_DIMS", "REWARD_WEIGHTS",
    "PhysioLLMWorker", "PhysioLLMCoTMCTSWorker", "PhysioMPSMCTSWorker",
    "InertialPhysioMPSMCTSWorker", "InertialPhysioLLMCoTMCTSWorker",
    "OldschoolWorker", "InertialHPVOOTPhysioMPSMCTSWorker", "InertialHPVOOTPhysioLLMCoTMCTSWorker",
    "SyntheticParticipant", "CareCircleOrchestrator", "ConversationState",
    "A3CScorer", "TurnScoreResult", "map_scorer_to_reward_dims",
    "SCORE_CRITICAL_FAILURE", "SCORE_STRONG",
    "load_scenarios", "get_scenario", "random_scenario",
    "random_continuation_scenario", "scenarios_by_domain",
    "CANONICAL_SCENARIOS", "SCENARIO_BY_ID",
    "scenarios_for_mode", "scenarios_for_domain",
]



