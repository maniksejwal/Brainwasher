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
        log.error("Failed to load scenario '%s': %s", scenario_id, exc)
        return None


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
