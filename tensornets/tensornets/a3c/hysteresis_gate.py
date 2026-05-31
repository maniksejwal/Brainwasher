"""
tensornets.a3c.hysteresis_gate — 5-zone physiological dead-band state machine.

Prevents strategy flip-flopping through asymmetric Schmitt-trigger thresholds
(±0.06 dead-band).  Zone transitions fire immediately on the first qualifying
crossing (LOCK_TURNS = 1), relying on the cross-episode MCTS tree to learn
which transient readings are noise rather than relying on an intra-episode lock.

Zones map to therapeutic strategy modes:
    Zone 0  calm         [0.00 – 0.25]  → exploration / psychoeducation
    Zone 1  mild_tension [0.25 – 0.45]  → motivational / change-talk
    Zone 2  moderate     [0.45 – 0.60]  → ambivalence / develop-discrepancy
    Zone 3  elevated     [0.60 – 0.78]  → validate / de-escalate
    Zone 4  critical     [0.78 – 1.00]  → safety-only / flooding-hold / escalate

Asymmetric thresholds (Schmitt trigger):
    Upward   transition: stress ≥ zone lower boundary
    Downward transition: stress < lower boundary − DEAD_BAND

Example for calm → mild_tension boundary at 0.25:
    Upward   fires when stress ≥ 0.25
    Downward fires when stress < 0.19 (0.25 − 0.06)

This module has no fallbacks.  Callers must handle ValueError from update().
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ── Zone definitions ──────────────────────────────────────────────────────────

# (zone_id, name, upper_boundary)
# A stress_index value belongs to the first zone whose upper_boundary it exceeds,
# working from zone 4 downward.  Zone 0 has no upper boundary (catch-all).
_ZONES: list[tuple[int, str, float]] = [
    (4, "critical",     1.01),   # [0.78, 1.00]  — sentinel upper bound
    (3, "elevated",     0.78),   # [0.60, 0.78)
    (2, "moderate",     0.60),   # [0.45, 0.60)
    (1, "mild_tension", 0.45),   # [0.25, 0.45)
    (0, "calm",         0.25),   # [0.00, 0.25)
]

# Zone lower boundaries (derived from _ZONES upper boundaries of the next-lower zone)
_ZONE_LOWER: dict[int, float] = {
    4: 0.78,
    3: 0.60,
    2: 0.45,
    1: 0.25,
    0: 0.00,
}

# Dead-band width: downward threshold = upward threshold − DEAD_BAND
DEAD_BAND: float = 0.06

# Number of consecutive turns a crossing must be sustained before the zone locks.
# Set to 1: fire on the first qualifying crossing.  Cross-episode MCTS memory
# is the mechanism for ignoring noise — not an intra-episode debounce.
LOCK_TURNS: int = 1

# Zone names indexed by zone id (for fast lookup)
ZONE_NAMES: dict[int, str] = {z: name for z, name, _ in _ZONES}


def _classify_zone(stress_index: float) -> int:
    """Return the zone id for a given stress_index, without hysteresis."""
    for zone_id, _, upper in sorted(_ZONES, reverse=True):
        if stress_index >= _ZONE_LOWER[zone_id]:
            return zone_id
    return 0   # unreachable given [0,1] input, but satisfies type checker


@dataclass
class HysteresisGate:
    """
    Stateful dead-band zone classifier for stress_index.

    Usage
    -----
        gate = HysteresisGate()
        zone, changed = gate.update(state.stress_index)

    The gate is stateless across episodes — create a new instance per episode.
    """

    _zone: int = field(default=-1, init=False)         # current locked zone (-1 = uninitialised)
    _pending_zone: int = field(default=-1, init=False)  # candidate zone accumulating streak
    _streak: int = field(default=0, init=False)         # consecutive turns in _pending_zone
    _zone_changes: int = field(default=0, init=False)   # total transitions fired this episode
    _turn_count: int = field(default=0, init=False)     # turns processed

    def update(self, stress_index: float) -> tuple[int, bool]:
        """
        Ingest one turn's stress_index and return (zone, zone_changed).

        Parameters
        ----------
        stress_index : float
            Current turn's stress_index.  Must be in [0.0, 1.0].

        Returns
        -------
        zone : int
            Currently locked zone (0–4).
        zone_changed : bool
            True if a transition fired this turn.

        Raises
        ------
        ValueError
            If stress_index is outside [0.0, 1.0].
        """
        if not (0.0 <= stress_index <= 1.0):
            raise ValueError(
                f"HysteresisGate.update: stress_index={stress_index!r} is outside [0, 1]. "
                f"Check physio_simulator or _stress_after_response for the source of this value."
            )

        self._turn_count += 1
        candidate = _classify_zone(stress_index)

        # ── First turn: initialise zone immediately (no lock needed) ─────────
        if self._zone == -1:
            self._zone = candidate
            self._pending_zone = candidate
            self._streak = 1
            return self._zone, True   # report as changed (initial assignment)

        # ── Apply asymmetric dead-band: downward transitions require crossing
        #    a lower threshold than upward transitions. ─────────────────────
        if candidate != self._zone:
            # Determine effective threshold for this direction
            moving_up = candidate > self._zone
            if moving_up:
                # Upward transition fires at zone lower boundary
                threshold = _ZONE_LOWER[candidate]
                crossing = stress_index >= threshold
            else:
                # Downward transition fires only below (lower_boundary − DEAD_BAND)
                threshold = _ZONE_LOWER[self._zone] - DEAD_BAND
                crossing = stress_index < threshold

            if crossing:
                if candidate == self._pending_zone:
                    self._streak += 1
                else:
                    self._pending_zone = candidate
                    self._streak = 1
            else:
                # Crossing condition not met — reset streak, stay in current zone
                self._pending_zone = self._zone
                self._streak = 0
        else:
            # Still in same zone — reset any pending transition
            self._pending_zone = self._zone
            self._streak = 0

        # ── Commit transition after LOCK_TURNS consecutive crossing turns ────
        if self._pending_zone != self._zone and self._streak >= LOCK_TURNS:
            old_zone = self._zone
            self._zone = self._pending_zone
            self._streak = 0
            self._zone_changes += 1
            return self._zone, True

        return self._zone, False

    @property
    def zone(self) -> int:
        """Currently locked zone id (0–4).  -1 if update() has never been called."""
        return self._zone

    @property
    def zone_name(self) -> str:
        """Human-readable name of the currently locked zone."""
        if self._zone == -1:
            return "uninitialised"
        return ZONE_NAMES[self._zone]

    @property
    def streak(self) -> int:
        """Consecutive turns the pending zone has been sustained (0 if stable)."""
        return self._streak

    @property
    def pending_zone(self) -> int:
        """Zone candidate accumulating streak (-1 or same as zone if stable)."""
        return self._pending_zone

    @property
    def zone_changes(self) -> int:
        """Total zone transitions fired since the gate was created."""
        return self._zone_changes

    @property
    def turn_count(self) -> int:
        """Total turns processed."""
        return self._turn_count

    def to_dict(self) -> dict:
        """Serialise gate state for inclusion in MCTS payload or JSONL logs."""
        return {
            "zone":         self._zone,
            "zone_name":    self.zone_name,
            "streak":       self._streak,
            "pending_zone": self._pending_zone,
            "zone_changes": self._zone_changes,
            "turn_count":   self._turn_count,
        }
