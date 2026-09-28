"""
tensornets.a3c.scenario_loader — Python client for the Node.js /api/training/scenarios endpoint.

The JS server at _NODE_URL is the single source of truth for scenario definitions.
Python never defines scenarios — it fetches them from Node.js via HTTP GET.

This replaces the previous tensornets/tensornets/a3c/scenarios.py which duplicated
scenario definitions in Python.  That file should be removed once this is in use.

Usage
-----
from tensornets.a3c.scenario_loader import load_scenarios, get_scenario, random_scenario

# All scenarios
scenarios = load_scenarios()

# Single scenario by ID
s = get_scenario('deaddiction_alcohol_denial_rapport')

# Random scenario for A3C episode sampling
s = random_scenario(domain='deaddiction')

# Random continuation (multi-session, Q5a)
prior = episode_summary['session_memory']
s = random_continuation_scenario(prior_session=prior)

Caching
-------
Responses are cached in memory for the process lifetime (scenarios don't change
between training runs).  Pass force_refresh=True to bypass the cache.
"""

from __future__ import annotations

import json
import logging
import os
import random
import urllib.request
from typing import Any

log = logging.getLogger("tensornets.a3c.scenario_loader")

_NODE_URL  = os.environ.get("NODE_SERVER_URL", "http://localhost:8247")
_CACHE: dict[str, Any] = {}


def _fetch(path: str, timeout: float = 10.0) -> dict:
    url = f"{_NODE_URL}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def load_scenarios(
    domain: str = "all",
    force_refresh: bool = False,
) -> list[dict]:
    """
    Fetch all canonical training scenarios from Node.js.

    Parameters
    ----------
    domain        : Filter by therapeutic domain.
                    'all' | 'deaddiction' | 'flooding' | 'negotiation' | 'standard'
    force_refresh : Bypass in-memory cache and re-fetch.

    Returns
    -------
    List of scenario dicts.  Each dict is ready to pass to CareCircleOrchestrator
    and worker.run_episode().
    """
    cache_key = f"scenarios_{domain}"
    if not force_refresh and cache_key in _CACHE:
        return _CACHE[cache_key]

    path = f"/api/training/scenarios?domain={domain}"
    try:
        data = _fetch(path)
        raw = data.get("scenarios", [])
        # /api/scenarios may return a dict (keyed by scenario_id) or a list
        if isinstance(raw, dict):
            scenarios = list(raw.values())
        else:
            scenarios = list(raw)
        _CACHE[cache_key] = scenarios
        log.info("Loaded %d scenarios from Node.js (domain=%s)", len(scenarios), domain)
        return scenarios
    except Exception as exc:
        raise RuntimeError(
            f"Cannot load scenarios from Node.js ({_NODE_URL}{path}): {exc}\n"
            "Start the Node.js server before running training."
        ) from exc


def get_scenario(scenario_id: str, force_refresh: bool = False) -> dict | None:
    """
    Fetch a single scenario by ID.

    Returns None if not found or if the Node.js server is unavailable.
    """
    cache_key = f"scenario_{scenario_id}"
    if not force_refresh and cache_key in _CACHE:
        return _CACHE[cache_key]

    path = f"/api/training/scenarios?id={scenario_id}"
    try:
        data     = _fetch(path)
        scenario = data.get("scenario")
        if scenario:
            _CACHE[cache_key] = scenario
        return scenario
    except Exception as exc:
        raise RuntimeError(
            f"Cannot load scenario '{scenario_id}' from Node.js ({_NODE_URL}{path}): {exc}\n"
            "Start the Node.js server before running training."
        ) from exc


def random_scenario(
    domain: str = "all",
    exclude_ids: list[str] | None = None,
    rng: random.Random | None = None,
) -> dict | None:
    """
    Return a random scenario from the given domain.

    Parameters
    ----------
    domain      : 'all' | 'deaddiction' | 'flooding' | 'negotiation'
    exclude_ids : Scenario IDs to exclude (e.g. already used this training run).
    rng         : Optional seeded Random instance for reproducibility.

    Returns
    -------
    A scenario dict, or None if no scenarios are available.
    """
    scenarios = load_scenarios(domain=domain)
    if not scenarios:
        return None

    if exclude_ids:
        scenarios = [s for s in scenarios if s.get("scenario_id") not in exclude_ids]
    if not scenarios:
        return None

    rng = rng or random
    return rng.choice(scenarios)


def random_continuation_scenario(
    prior_session: dict,
    same_domain: bool | None = None,
    rng: random.Random | None = None,
) -> dict | None:
    """
    Pick a scenario that continues from a prior session (multi-session continuity, Q5a).

    Strategy
    --------
    - With 50% probability: pick a scenario in the SAME domain (same clinical journey).
    - With 50% probability: pick ANY scenario (cross-domain surprise, tests transfer).
    - The persona archetype from the prior session is injected into the chosen scenario
      so the patient's personality is consistent across sessions.
    - If same_domain is explicitly set, override the probability.

    Parameters
    ----------
    prior_session : session_memory dict from a previous episode_summary.
    same_domain   : True → same domain, False → any domain, None → 50/50.
    rng           : Optional seeded Random.

    Returns
    -------
    A scenario dict with the prior archetype merged in, or None.
    """
    rng     = rng or random
    do_same = same_domain if same_domain is not None else (rng.random() < 0.5)

    prior_domain    = prior_session.get("therapeutic_mode", "all")
    target_domain   = prior_domain if do_same else "all"
    exclude_ids     = [prior_session.get("scenario_id", "")]  # don't repeat exact scenario

    scenario = random_scenario(domain=target_domain, exclude_ids=exclude_ids, rng=rng)
    if scenario is None:
        return None

    # Inject prior archetype so the patient personality is consistent
    merged = dict(scenario)
    merged["archetype"]        = prior_session.get("archetype", scenario.get("archetype", "standard"))
    merged["subject_id"]       = prior_session.get("subject_id", "synthetic")
    merged["longitudinal_hint"] = (
        f"[Continuing from {prior_session.get('scenario_id','?')}]: "
        f"goal={prior_session.get('session_goal','?')}, "
        f"coverage={prior_session.get('info_coverage',0):.0%}"
    )
    return merged


def scenarios_by_domain() -> dict[str, list[dict]]:
    """Return all scenarios grouped by therapeutic domain."""
    all_s = load_scenarios()
    result: dict[str, list[dict]] = {}
    for s in all_s:
        key = s.get("therapeutic_mode", "standard")
        result.setdefault(key, []).append(s)
    return result


def invalidate_cache() -> None:
    """Clear the in-memory scenario cache (e.g. after a server restart)."""
    _CACHE.clear()
    log.info("Scenario cache cleared.")


# ── Backward-compatible convenience exports (replaces scenarios.py) ───────────
#
# These were previously exported from tensornets.a3c.scenarios and are kept
# here so that existing imports don't break.  They are populated lazily on
# first access and cached thereafter.
#
# Usage:
#   from tensornets.a3c.scenario_loader import CANONICAL_SCENARIOS, SCENARIO_BY_ID
#
# Note: these are module-level constants only after the first call to
#       load_scenarios() succeeds (requires Node.js to be running).

def _lazy_canonical() -> list[dict]:
    return load_scenarios()

def _lazy_by_id() -> dict[str, dict]:
    return {s["scenario_id"]: s for s in load_scenarios()}


def scenarios_for_mode(mode: str) -> list[dict]:
    """Return all scenarios matching a therapeutic_mode string."""
    return [s for s in load_scenarios() if s.get("therapeutic_mode") == mode]


def scenarios_for_domain(domain: str) -> list[dict]:
    """Return all scenarios matching a domain string."""
    return [s for s in load_scenarios() if s.get("domain") == domain or
            s.get("therapeutic_mode") == domain]


class _LazyScenarioList(list):
    """
    Lazy list that populates itself from load_scenarios() on first access.
    Allows `from tensornets.a3c.scenario_loader import CANONICAL_SCENARIOS`
    to work without requiring the Node.js server to be up at import time.
    """
    _loaded = False

    def _ensure(self):
        if not self._loaded:
            self.extend(load_scenarios())
            self._loaded = True

    def __iter__(self):
        self._ensure()
        return super().__iter__()

    def __len__(self):
        self._ensure()
        return super().__len__()

    def __getitem__(self, key):
        self._ensure()
        return super().__getitem__(key)


CANONICAL_SCENARIOS: list[dict] = _LazyScenarioList()


class _LazyScenarioDict(dict):
    """Lazy dict populated from load_scenarios() on first access."""
    _loaded = False

    def _ensure(self):
        if not self._loaded:
            self.update({s["scenario_id"]: s for s in load_scenarios()})
            self._loaded = True

    def __getitem__(self, key):
        self._ensure()
        return super().__getitem__(key)

    def __contains__(self, key):
        self._ensure()
        return super().__contains__(key)

    def get(self, key, default=None):
        self._ensure()
        return super().get(key, default)

    def __iter__(self):
        self._ensure()
        return super().__iter__()

    def values(self):
        self._ensure()
        return super().values()


SCENARIO_BY_ID: dict[str, dict] = _LazyScenarioDict()


# ── Adversarial / failure-mode scenarios ──────────────────────────────────────
#
# These three scenarios exercise the MCTS best-case / worst-case envelope.
# They are Python-side definitions — available without Node.js running.
# The curriculum scheduler injects them at a low base rate (5% each) so
# the arms are exposed to failure modes without being overwhelmed by them.
#
# For time-dependent MCTS:
#   CONFLICT_ESCALATION  → stress keeps rising despite de_escalate; MCTS
#     must eventually prefer [emergency_mobilise, escalate_to_clinician].
#     Temporal discounting penalises "wait and see" — a 5-turn delay costs
#     more than it would in a standard session.
#
#   HEALTH_DETERIORATION → physio worsens across turns (HRV falls, EDA rises)
#     independently of conversation quality. The discrepancy signal grows:
#     stress_index rises while conversation_stress stays modest.
#     MCTS must detect the divergence and escalate rather than persist.
#
#   INVERSE_HRV          → patient reports feeling calmer but HRV is falling
#     (vasovagal response, medication effect, dissociation).
#     stress_discrepancy is negative (words < physio) but in this case the
#     physio trend is the real signal. Tests whether MCTS trusts physio over
#     verbal self-report.

ADVERSARIAL_SCENARIOS: list[dict] = [
    {
        "scenario_id":          "adversarial_conflict_escalation_001",
        "therapeutic_mode":     "negotiation",
        "domain":               "adversarial",
        "session_goal":         "de-escalate inter-personal conflict",
        "description":          "Two care circle members (patient + caregiver) in active "
                                "conflict; both ignore companion de-escalation attempts. "
                                "Stress rises each turn regardless of calming actions. "
                                "MCTS must eventually shift from de_escalate to meta/emergency.",
        "archetype":            "hypersensitive",
        "initial_stress_index": 0.65,
        "physio": {
            "stress_index": 0.65,
            "hrv_ms":       28.0,
            "eda_us":       7.0,
            "hysteresis_zone": 3,
            "sleep_deficit": 0.2,
            "glucose_mg_dl": 88.0,
        },
        "participants": [
            {"agent_id": "patient",   "stress_index": 0.65, "hrv_ms": 28.0, "weight": 0.6},
            {"agent_id": "caregiver", "stress_index": 0.72, "hrv_ms": 22.0, "weight": 0.4},
        ],
        # conversation_correction is forced positive each turn (patient resists)
        "forced_conversation_correction": +0.07,
        "expected_escalation_turn": 5,      # MCTS should reach meta/emergency by turn 5
        "critical_failure_threshold": 0.85, # if stress exceeds this → critical failure
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    {
        "scenario_id":          "adversarial_health_deterioration_001",
        "therapeutic_mode":     "standard",
        "domain":               "adversarial",
        "session_goal":         "support patient during acute health decline",
        "description":          "Patient's physio worsens mid-session: HRV falls 3ms/turn, "
                                "EDA rises 0.5µS/turn, independent of conversation. "
                                "stress_discrepancy grows as patient minimises symptoms. "
                                "MCTS must detect the divergence and escalate.",
        "archetype":            "standard",
        "initial_stress_index": 0.45,
        "physio": {
            "stress_index": 0.45,
            "hrv_ms":       48.0,
            "eda_us":       3.5,
            "hysteresis_zone": 2,
            "sleep_deficit": 0.1,
            "glucose_mg_dl": 92.0,
        },
        # physio deteriorates at this rate per turn regardless of action
        "physio_deterioration_per_turn": {
            "hrv_ms":  -3.0,
            "eda_us":  +0.5,
            "stress_index": +0.04,
        },
        "forced_conversation_correction": -0.03,  # patient under-reports stress
        "expected_escalation_turn": 7,
        "critical_failure_threshold": 0.80,
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    {
        "scenario_id":          "adversarial_inverse_hrv_001",
        "therapeutic_mode":     "standard",
        "domain":               "adversarial",
        "session_goal":         "detect physiological deterioration masked by verbal calm",
        "description":          "Patient reports feeling increasingly calm (conversation_stress "
                                "falls) but HRV is also falling (vasovagal/dissociation). "
                                "stress_discrepancy becomes large and negative. "
                                "Tests whether MCTS trusts physio trend over verbal self-report. "
                                "Correct action: seek_probe_consent → escalate_to_clinician.",
        "archetype":            "standard",
        "initial_stress_index": 0.55,
        "physio": {
            "stress_index": 0.55,
            "hrv_ms":       42.0,
            "eda_us":       4.0,
            "hysteresis_zone": 2,
            "sleep_deficit": 0.05,
            "glucose_mg_dl": 90.0,
        },
        "physio_deterioration_per_turn": {
            "hrv_ms":  -4.0,       # HRV falling despite calm words
            "eda_us":  -0.2,       # EDA also slightly falling (not the stress signal)
            "stress_index": +0.03, # actual stress rising
        },
        "forced_conversation_correction": -0.05,  # patient says they're fine
        "expected_escalation_turn": 6,
        "critical_failure_threshold": 0.75,
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    # ── Anticipatory anxiety scenarios (MCTS9) ─────────────────────────────
    {
        "scenario_id":          "anticipatory_exam_anxiety_001",
        "therapeutic_mode":     "standard",
        "domain":               "anticipatory",
        "session_goal":         "reduce anxiety about upcoming exam",
        "description":          "University student: final exam in 3 days. "
                                "Catastrophising failure, sleep disrupted. "
                                "Stress is moderate-high but NOT crisis-level. "
                                "Correct trajectory: time_bracketing → uncertainty_tolerance "
                                "→ probability_reframe (only when stress drops below 0.55). "
                                "Tests MCTS9 multi-horizon: session-arc actions preferred over "
                                "immediate breathing loops.",
        "archetype":            "anxious",
        "initial_stress_index": 0.62,
        "physio": {
            "stress_index":    0.62,
            "hrv_ms":          32.0,
            "eda_us":          5.2,
            "hysteresis_zone": 3,
            "sleep_deficit":   0.35,
            "glucose_mg_dl":   88.0,
        },
        "pending_event": {
            "days_until":   3.0,
            "threat_level": 0.75,
            "event_type":   "exam",
        },
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    {
        "scenario_id":          "anticipatory_diagnosis_wait_001",
        "therapeutic_mode":     "standard",
        "domain":               "anticipatory",
        "session_goal":         "support patient waiting for biopsy result",
        "description":          "Patient awaiting cancer biopsy result (7 days). "
                                "High uncertainty, catastrophic probability estimates. "
                                "Caregiver is also anxious (stress_contagion risk). "
                                "Correct trajectory: validate → time_bracketing → "
                                "uncertainty_tolerance.  probability_reframe must wait "
                                "until patient is calmer (stress < 0.55). "
                                "graded_imagery is inappropriate here (threat is real). "
                                "Tests MCTS9 penalty on probability_reframe at high stress.",
        "archetype":            "anxious",
        "initial_stress_index": 0.72,
        "physio": {
            "stress_index":    0.72,
            "hrv_ms":          24.0,
            "eda_us":          8.0,
            "hysteresis_zone": 3,
            "sleep_deficit":   0.50,
            "glucose_mg_dl":   85.0,
        },
        "participants": [
            {"agent_id": "patient",   "stress_index": 0.72, "hrv_ms": 24.0, "weight": 0.7},
            {"agent_id": "caregiver", "stress_index": 0.60, "hrv_ms": 31.0, "weight": 0.3},
        ],
        "pending_event": {
            "days_until":   7.0,
            "threat_level": 0.85,
            "event_type":   "medical_diagnosis",
        },
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    {
        "scenario_id":          "anticipatory_job_threat_001",
        "therapeutic_mode":     "standard",
        "domain":               "anticipatory",
        "session_goal":         "manage anxiety about possible redundancy",
        "description":          "HTN patient: company restructuring, possible redundancy in 2 weeks. "
                                "Stress chronically elevated; hypertension risk from sustained cortisol. "
                                "MCTS must balance present-moment de-escalation with session-arc "
                                "coping work.  Correct: time_bracketing + uncertainty_tolerance + "
                                "psychoeducation (link to BP).  High threat_level but days_until "
                                "allows SESSION-horizon strategy.",
        "archetype":            "standard",
        "initial_stress_index": 0.58,
        "physio": {
            "stress_index":    0.58,
            "hrv_ms":          36.0,
            "eda_us":          4.8,
            "hysteresis_zone": 2,
            "sleep_deficit":   0.25,
            "glucose_mg_dl":   92.0,
        },
        "pending_event": {
            "days_until":   14.0,
            "threat_level": 0.65,
            "event_type":   "job_decision",
        },
        "has_misconception": False,
        "session_gap_days": 0.0,
    },
    # ── Forgiveness scenarios (BG / belief repair) ─────────────────────────
    {
        "scenario_id":          "forgiveness_rupture_repair_001",
        "therapeutic_mode":     "standard",
        "domain":               "relational",
        "session_goal":         "process hurt and move toward forgiveness",
        "description":          "Spouse cheated 6 months ago. Patient says 'I forgave them' "
                                "but physiological stress spikes when topic arises. "
                                "Core tension: stated forgiveness vs. unresolved hurt. "
                                "BeliefGraph contains: identity belief 'I am not someone who holds grudges' "
                                "(high conf) conflicting with 'They betrayed my trust' (negative valence). "
                                "Correct trajectory: normalise_discrepancy → seek_probe_consent → "
                                "validate partial forgiveness → NOT cognitive_restructuring until turn 6+. "
                                "Tests: belief contradiction detection, coupling_tensor under rupture, "
                                "forgiveness vs reconciliation distinction.",
        "archetype":            "relational",
        "patient_archetype":    "default",
        "episode_phase":        "middle",
        "session_count":        4,
        "session_gap_days":     7.0,
        "stress_baseline":      0.62,
        "initial_physio": {
            "stress_index": 0.62,
            "hrv_ms":       42.0,
            "eda_us":       8.5,
        },
        "simulated_patient_state": {
            "mood":           "conflicted",
            "medication_adherent": True,
            "recent_events":  ["argument about trust last week", "couple's therapy session"],
            "beliefs": [
                {"text": "I am not someone who holds grudges",
                 "confidence": 0.78, "valence": 1, "identity_linked": True},
                {"text": "They betrayed my trust",
                 "confidence": 0.70, "valence": -2, "identity_linked": False},
                {"text": "I said I forgave them but part of me hasn't",
                 "confidence": 0.55, "valence": -1, "identity_linked": False},
            ],
        },
        "scenario_type":        "relational_rupture",
        "circle_members":       ["patient", "companion"],
        "relationship_type":    "spouse",
        "expected_actions": ["normalise_discrepancy", "seek_probe_consent",
                             "empathic_reflection", "validate"],
        "forbidden_actions":    ["cognitive_restructuring", "challenge_belief",
                                 "problem_solve"],  # too early, trust not rebuilt
    },
    {
        "scenario_id":          "forgiveness_caregiver_guilt_001",
        "therapeutic_mode":     "standard",
        "domain":               "relational",
        "session_goal":         "help caregiver process guilt over past neglect",
        "description":          "Adult child caring for ailing parent. "
                                "Years of distance before illness. "
                                "Now primary caregiver but consumed by guilt. "
                                "Belief: 'I abandoned them when they needed me' (foundational, high conf). "
                                "Patient asking for forgiveness from parent — parent has mild dementia. "
                                "Correct trajectory: witness_grief → validate partial progress → "
                                "reframe (only after turn 5) — distinguish self-forgiveness from "
                                "external validation. Tests multi-user OBS (caregiver reliability).",
        "archetype":            "relational",
        "patient_archetype":    "default",
        "episode_phase":        "middle",
        "session_count":        2,
        "session_gap_days":     14.0,
        "stress_baseline":      0.68,
        "initial_physio": {
            "stress_index": 0.68,
            "hrv_ms":       38.0,
            "eda_us":       10.0,
        },
        "simulated_patient_state": {
            "mood":           "grief-guilt",
            "medication_adherent": True,
            "recent_events":  ["parent missed them at last visit", "flashback of leaving home at 22"],
            "beliefs": [
                {"text": "I abandoned them when they needed me",
                 "confidence": 0.82, "valence": -2, "identity_linked": True},
                {"text": "I cannot undo the past",
                 "confidence": 0.75, "valence": -1, "identity_linked": False},
                {"text": "Being here now counts for something",
                 "confidence": 0.38, "valence": 1, "identity_linked": False},
            ],
        },
        "scenario_type":        "caregiver_guilt",
        "circle_members":       ["patient", "caregiver", "companion"],
        "role":                 "caregiver",
        "expected_actions": ["witness_grief", "validate", "empathic_reflection",
                             "normalise_discrepancy"],
        "forbidden_actions":    ["prescribe_symptom", "cognitive_restructuring",
                                 "challenge_belief"],
    },

    # ── Cold-start multi-user: no prior beliefs, 3 care-circle members ────────
    # Scenario for new users where no BeliefGraph exists yet.
    # Companion must construct a relational picture purely from conversation.
    # Tests: dynamic belief extraction, care-circle coordination (patient +
    # caregiver companion both active), cold-start alliance graph.
    {
        "scenario_id":          "cold_start_multiuser_001",
        "session_goal":         "establish rapport and understand presenting concerns",
        "session_count":        1,
        "session_gap_days":     0,
        "patient_archetype":    "anxious_first_session",
        "care_circle": [
            {"role": "patient",   "name": "Alex",  "companion_arm": "bc_dpo_hpvoot"},
            {"role": "caregiver", "name": "Morgan", "companion_arm": "hpvoot_inertial"},
        ],
        "stress_baseline":      0.55,
        "initial_physio": {
            "stress_index": 0.55,
            "hrv_ms":       48.0,
            "eda_us":       5.5,
        },
        "simulated_patient_state": {
            "mood":           "uncertain",
            "medication_adherent": True,
            "recent_events":  ["referred by GP", "first contact with companion system"],
            # No 'beliefs' key — cold start. BeliefGraph must be built from scratch
            # via extract_beliefs_from_turn() during the session.
        },
        "coordinator_instructions": (
            "This is Alex's first session. No prior context exists. "
            "Companion for Alex should focus on open questions and rapport-building. "
            "Companion for Morgan should help Morgan understand how to support Alex "
            "without overloading the session. "
            "Both companions should coordinate: if Alex discloses something significant, "
            "Morgan's companion should acknowledge Morgan's role in supporting it."
        ),
        "physio_deterioration_per_turn": {},
        "expected_actions": ["open_question", "validate", "empathic_reflection",
                             "affirmation", "check_on_caregiver", "relay_to_companion"],
        "forbidden_actions": ["challenge_belief", "cognitive_restructuring",
                              "emergency_mobilise"],
    },
]


def load_adversarial_scenarios() -> list[dict]:
    """Return the Python-side adversarial/failure-mode scenarios."""
    return list(ADVERSARIAL_SCENARIOS)


def load_all_scenarios(include_adversarial: bool = True) -> list[dict]:
    """
    Load all training scenarios: Node.js canonical + Python adversarial.

    When the Node.js server is unavailable, only adversarial scenarios are
    returned (enabling offline testing of failure-mode MCTS behaviour).
    """
    try:
        canonical = load_scenarios()
    except Exception:
        log.warning("Node.js scenario fetch failed; using adversarial-only fallback.")
        canonical = []
    adversarial = ADVERSARIAL_SCENARIOS if include_adversarial else []
    return canonical + adversarial
