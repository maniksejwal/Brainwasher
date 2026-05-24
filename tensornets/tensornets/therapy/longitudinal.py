"""
longitudinal.py — Persistent longitudinal state I/O helpers
============================================================
Thin wrappers around JSON persistence so session_manager.py
and the FastAPI server both import from a single location.
"""
from __future__ import annotations
import json
from pathlib import Path
from dataclasses import asdict


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


class LongitudinalState:
    """
    Placeholder for a richer longitudinal MPS state vector (Phase 4).
    Currently the SubjectPersistentState in session_manager.py fulfils this role.
    """
    pass
