"""tensornets.a3c — Asynchronous Advantage Actor-Critic components for the HTN framework."""

from tensornets.a3c.action_bandit import ActionBandit, ACTION_TAXONOMY, STRESS_BUCKETS
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
from tensornets.a3c.arms import Arm1Worker, Arm2Worker, Arm3Worker

__all__ = [
    "ActionBandit", "ACTION_TAXONOMY", "STRESS_BUCKETS",
    "Actor", "Critic", "A3CWorker", "TurnState",
    "compute_advantage", "apply_update", "scalar_reward",
    "REWARD_DIMS", "REWARD_WEIGHTS",
    "Arm1Worker", "Arm2Worker", "Arm3Worker",
]
