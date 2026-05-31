"""tensornets.a3c — Asynchronous Advantage Actor-Critic components for the HTN framework."""

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



