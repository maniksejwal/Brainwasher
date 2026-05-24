"""
longitudinal.py — Persistent longitudinal state I/O helpers
============================================================
Thin wrappers around JSON persistence so session_manager.py
and the FastAPI server both import from a single location.
Re-exports session types for backward compatibility.
"""
from __future__ import annotations
import json
from pathlib import Path
from dataclasses import asdict, dataclass, field
from typing import List, Optional


def save_state(state, state_dir: str = "state") -> None:
    """Serialise any dataclass to JSON keyed by subject_id."""
    p = Path(state_dir) / f"{state.subject_id}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(asdict(state), indent=2))


def load_state(cls, subject_id: str, state_dir: str = "state"):
    """Load a dataclass from JSON, returns None if not found."""
    p = Path(state_dir) / f"{subject_id}.json"
    if not p.exists():
        return None
    data = json.loads(p.read_text())
    return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ── Re-exports from session_manager for server.py backward compatibility ──────

@dataclass
class SessionRecord:
    """One completed session record stored in LongitudinalState."""
    session_id:        str
    therapeutic_mode:  str
    phase:             str
    start_ts:          float
    end_ts:            float
    final_stress:      float = 0.5
    rapport_score:     float = 0.0
    goal_achieved:     bool  = False
    secret_detected:   bool  = False
    secret_detail:     str   = ""
    turn_count:        int   = 0


def record_session(longitudinal_state, session: SessionRecord) -> None:
    """Append a completed session to the longitudinal state."""
    if not hasattr(longitudinal_state, 'sessions'):
        return
    longitudinal_state.sessions.append(session)
    longitudinal_state.session_count = len(longitudinal_state.sessions)


def detect_secrets(text: str) -> list[str]:
    """
    Detect potential secret-bearing phrases in user text.
    Returns list of detected secret categories (empty if none found).
    Heuristic-based; upgrade to LLM classifier for production.
    """
    SECRET_MARKERS = [
        ('substance_use',    ['drink', 'alcohol', 'drug', 'smoke', 'high', 'pill', 'dose']),
        ('self_harm',        ['hurt myself', 'cut', 'harm', 'suicid', 'end it', 'not worth']),
        ('abuse',            ['abuse', 'hit me', 'hurt me', 'threatened', 'forced']),
        ('medication',       ["didn't take", "forgot meds", "stopped taking", "not taking"]),
        ('relationship',     ['affair', 'cheating', 'divorce', 'leaving', 'secret']),
    ]
    found = []
    text_lower = text.lower()
    for category, markers in SECRET_MARKERS:
        if any(m in text_lower for m in markers):
            found.append(category)
    return found


def longitudinal_prompt_hint(longitudinal_state) -> str:
    """
    Build a short prompt context string from longitudinal state.
    Injected into the system prompt to give the companion memory of past sessions.
    """
    if longitudinal_state is None:
        return ""
    parts = []
    if hasattr(longitudinal_state, 'session_count') and longitudinal_state.session_count:
        parts.append(f"This is session {longitudinal_state.session_count + 1}.")
    if hasattr(longitudinal_state, 'alliance') and longitudinal_state.alliance:
        a = longitudinal_state.alliance
        parts.append(f"Therapeutic alliance score: {a:.2f}.")
    if hasattr(longitudinal_state, 'deaddiction_phase') and longitudinal_state.deaddiction_phase:
        parts.append(f"Current behaviour-change phase: {longitudinal_state.deaddiction_phase}.")
    if hasattr(longitudinal_state, 'secrets') and longitudinal_state.secrets:
        parts.append(f"Known sensitive topics: {', '.join(longitudinal_state.secrets[:3])}. Handle with care.")
    return " ".join(parts)


class LongitudinalState:
    """Stub for type hints. Full implementation in session_manager.py (SubjectPersistentState)."""
    pass
