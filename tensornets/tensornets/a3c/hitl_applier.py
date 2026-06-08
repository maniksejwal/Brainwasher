"""
tensornets.a3c.hitl_applier
============================
Human-in-the-Loop (HITL) reward correction loop.

Design
------
Human annotators score past conversations via training/feedback/annotator.js
(CLI tool) or the GUI feedback widget.  Each annotation is stored in the
``feedback`` table as ``{episode_id, score ∈ {-1, 0, +1}, comment}``.

This module runs as a daemon thread alongside A3C training.  Every
POLL_INTERVAL_S seconds it:

1. Fetches unapplied annotations from
   GET /api/benchmarks/feedback/pending

2. For each annotation whose ``episode_id`` is in a worker's
   _hitl_pending_corrections dict (set by CurriculumScheduler when it
   stores an episode summary), applies a reward override:

       corrected_reward = episode_reward + HITL_WEIGHT * score

   score:
     +1 → human rated response as good    → +HITL_WEIGHT
      0 → neutral                          →  0
     -1 → human rated response as bad    → −HITL_WEIGHT

3. The corrected reward is stored in a shared
   ``hitl_corrections: dict[episode_id, float]`` dict.  Workers check
   this dict before applying the gradient update for that episode and
   substitute the corrected reward if present.

4. Marks annotations as applied via
   POST /api/benchmarks/feedback/mark-applied

HITL_WEIGHT is conservative (0.5 by default): human feedback adjusts the
final episode reward by at most ±0.5, which is significant but not
large enough to override strong LLM scorer signals.

Thread safety
-------------
``hitl_corrections`` is a thread-safe dict protected by a Lock.  Workers
read from it once per episode at gradient application time.  The applier
thread writes to it.  Stale entries are evicted after MAX_AGE_S seconds.

Usage (in train.py)
--------------------
    from tensornets.a3c.hitl_applier import HITLApplier

    applier = HITLApplier()
    applier.start()                          # launches daemon thread
    # pass applier.corrections to _run_arm
    ...
    applier.stop()
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from tensornets.a3c.node_client import _node_post, http_post, NODE_URL

log = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
POLL_INTERVAL_S  = 30.0    # check for new annotations every 30 s
HITL_WEIGHT      = 0.5     # max reward adjustment per annotation (±0.5)
MAX_AGE_S        = 3600.0  # evict unapplied corrections after 1 hour


class HITLApplier:
    """
    Daemon thread that polls the feedback DB, translates human scores to
    reward corrections, and exposes them to A3C workers via self.corrections.
    """

    def __init__(self) -> None:
        self.corrections: dict[str, float] = {}   # episode_id → delta reward
        self._lock       = threading.Lock()
        self._timestamps: dict[str, float] = {}   # episode_id → insertion time
        self._stop       = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background polling thread."""
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="hitl-applier",
            daemon=True,
        )
        self._thread.start()
        log.info("HITL applier started (poll interval=%gs, weight=%.2f)", POLL_INTERVAL_S, HITL_WEIGHT)

    def stop(self) -> None:
        """Signal the thread to exit cleanly."""
        self._stop.set()

    def get_correction(self, episode_id: str) -> float:
        """
        Return the pending HITL reward correction for this episode, or 0.0.
        Clears the entry after reading (one-shot: each correction is applied once).
        """
        with self._lock:
            correction = self.corrections.pop(episode_id, 0.0)
            self._timestamps.pop(episode_id, None)
        if correction != 0.0:
            log.debug("HITL correction applied: episode=%s delta=%.3f", episode_id, correction)
        return correction

    # ── Internal loop ──────────────────────────────────────────────────────────

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll_and_apply()
                self._evict_stale()
            except Exception as exc:
                log.warning("HITL applier error (non-fatal): %s", exc)
            self._stop.wait(POLL_INTERVAL_S)

    def _poll_and_apply(self) -> None:
        """Fetch pending annotations and store corrections."""
        import urllib.request as _req
        import json

        url = f"{NODE_URL}/api/benchmarks/feedback/pending?limit=200"
        try:
            with _req.urlopen(url, timeout=8.0) as resp:
                data = json.loads(resp.read())
        except Exception as exc:
            log.debug("HITL poll skipped (server unavailable): %s", exc)
            return

        pending = data.get("pending", [])
        if not pending:
            return

        applied_ids: list[int] = []
        applied_count = 0

        for row in pending:
            episode_id = row.get("episode_id")
            score      = row.get("score", 0)
            fb_id      = row.get("id")

            if episode_id is None:
                # Annotation attached to a conversation_id only (no episode mapping).
                # Mark applied without correction — we can't map it to A3C.
                applied_ids.append(fb_id)
                continue

            delta = float(score) * HITL_WEIGHT    # score ∈ {-1, 0, +1}

            with self._lock:
                # Accumulate if multiple annotations exist for the same episode
                existing = self.corrections.get(episode_id, 0.0)
                self.corrections[episode_id] = existing + delta
                self._timestamps[episode_id] = time.time()

            applied_ids.append(fb_id)
            if delta != 0.0:
                applied_count += 1
                log.info(
                    "HITL: episode=%s score=%+d delta=%+.2f annotator=%s",
                    episode_id, score, delta, row.get("annotator_id", "?"),
                )

        if applied_ids:
            try:
                _node_post("/feedback/mark-applied", {"ids": applied_ids}, timeout=8.0)
                if applied_count:
                    log.info("HITL: %d corrections queued, %d ids marked applied",
                             applied_count, len(applied_ids))
            except Exception as exc:
                log.warning("HITL mark-applied failed (will retry): %s", exc)

    def _evict_stale(self) -> None:
        """Remove corrections that were never consumed (episode no longer in training)."""
        now = time.time()
        with self._lock:
            stale = [eid for eid, ts in self._timestamps.items()
                     if now - ts > MAX_AGE_S]
            for eid in stale:
                self.corrections.pop(eid, None)
                self._timestamps.pop(eid, None)
        if stale:
            log.debug("HITL evicted %d stale corrections", len(stale))
