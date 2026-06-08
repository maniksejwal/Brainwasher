"""
tensornets.tensor_rag.index
============================
PhysioConditionedIndex: the core TensorRAG retrieval engine.

Each stored document (chunk) has:
  - text_vec:   float32[D_text] — normalised text embedding
  - physio_fp:  float32[D_phys] — normalised MPS bond fingerprint
                                   OR physio_features() if no MPS
  - metadata:   dict            — source, ts, episode_id, tier, etc.

Retrieval computes a composite score and returns the top-k chunks.

COMPOSITE SCORE
---------------
  score = α·text_sim + β·physio_sim + γ·recency_boost

  α = TEXT_WEIGHT     (default 0.60)
  β = PHYSIO_WEIGHT   (default 0.30)
  γ = RECENCY_WEIGHT  (default 0.10)

Thread-safe: uses a lock around add/query.
Persistence: serialises to a .npy + .json sidecar file pair.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

from tensornets.tensor_rag.encoder import embed_one, cosine, embed_dim, physio_features

log = logging.getLogger(__name__)

# ── Weights ───────────────────────────────────────────────────────────────────

TEXT_WEIGHT     = 0.60
PHYSIO_WEIGHT   = 0.30
RECENCY_WEIGHT  = 0.10
HALF_LIFE_S     = 86400.0   # recency decays with 1-day half-life

# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    """
    A single stored document in the TensorRAG index.

    text         : the raw text content (used for prompt injection)
    text_vec     : L2-normalised text embedding
    physio_fp    : L2-normalised physio fingerprint (MPS or fallback)
    metadata     : arbitrary dict (source, episode_id, scenario_id, arm, ...)
    ts           : Unix timestamp (for recency boost)
    chunk_id     : unique identifier (auto-assigned)
    """
    text:       str
    text_vec:   np.ndarray                  # [D_text]
    physio_fp:  np.ndarray                  # [D_phys]
    metadata:   dict       = field(default_factory=dict)
    ts:         float      = field(default_factory=time.time)
    chunk_id:   str        = ""

    def __post_init__(self):
        if not self.chunk_id:
            import uuid
            self.chunk_id = str(uuid.uuid4())[:8]


@dataclass
class RetrievedChunk:
    """A chunk returned from a query, with its composite score."""
    chunk:       Chunk
    score:       float
    text_score:  float
    physio_score: float
    recency:     float


# ── Index ─────────────────────────────────────────────────────────────────────

class PhysioConditionedIndex:
    """
    In-memory vector index with optional disk persistence.

    Usage
    -----
    idx = PhysioConditionedIndex(persist_path="data/rag/main.index")
    idx.add(text="Patient disclosed relapse", physio_fp=mps.bond_fingerprint().numpy(), ...)
    results = idx.query(text="How to handle relapse?", physio_fp=current_fp, k=3)
    """

    def __init__(
        self,
        persist_path: Optional[str | Path] = None,
        text_weight:   float = TEXT_WEIGHT,
        physio_weight: float = PHYSIO_WEIGHT,
        recency_weight: float = RECENCY_WEIGHT,
        half_life_s:   float = HALF_LIFE_S,
        max_chunks:    int   = 50_000,
    ) -> None:
        self._lock         = threading.RLock()
        self._chunks:      list[Chunk] = []
        self._text_matrix: Optional[np.ndarray] = None   # [N, D_text] lazy-built
        self._phys_matrix: Optional[np.ndarray] = None   # [N, D_phys]
        self._dirty        = False

        self.text_weight   = text_weight
        self.physio_weight = physio_weight
        self.recency_weight = recency_weight
        self.half_life_s   = half_life_s
        self.max_chunks    = max_chunks
        self._persist_path = Path(persist_path) if persist_path else None

        if self._persist_path and self._persist_path.with_suffix(".meta.json").exists():
            self._load()

    # ── Adding documents ──────────────────────────────────────────────────────

    def add(
        self,
        text:        str,
        physio_fp:   Optional[np.ndarray]  = None,
        physio_dict: Optional[dict]        = None,
        metadata:    Optional[dict]        = None,
        ts:          Optional[float]       = None,
    ) -> str:
        """
        Add one document to the index.

        Parameters
        ----------
        text        : document text to embed and store
        physio_fp   : pre-computed physio fingerprint (from mps.bond_fingerprint())
                      If None, computed from physio_dict (or zero vector).
        physio_dict : {hrv_rmssd_ms, stress_index, sleep_quality, therapeutic_stage}
                      Used to compute physio_fp when no MPS is available.
        metadata    : arbitrary dict attached to the chunk
        ts          : override timestamp (default: now)

        Returns
        -------
        chunk_id : str
        """
        text_vec = embed_one(text)

        if physio_fp is None:
            if physio_dict:
                physio_fp = physio_features(
                    hrv_ms           = physio_dict.get("hrv_rmssd_ms", 35.0),
                    stress_index     = physio_dict.get("stress_index",  0.3),
                    sleep_quality    = physio_dict.get("sleep_quality", 1.0),
                    therapeutic_stage= physio_dict.get("therapeutic_stage", 0.0),
                )
            else:
                physio_fp = np.zeros(8, dtype=np.float32)

        physio_fp = np.asarray(physio_fp, dtype=np.float32)

        chunk = Chunk(
            text      = text,
            text_vec  = text_vec,
            physio_fp = physio_fp,
            metadata  = metadata or {},
            ts        = ts or time.time(),
        )

        with self._lock:
            self._chunks.append(chunk)
            self._dirty = True

            # Evict oldest if over limit
            if len(self._chunks) > self.max_chunks:
                self._chunks.sort(key=lambda c: c.ts)
                self._chunks = self._chunks[-self.max_chunks:]

            self._text_matrix = None   # invalidate lazy cache
            self._phys_matrix = None

        return chunk.chunk_id

    def add_batch(self, items: list[dict]) -> list[str]:
        """
        Add multiple documents.
        Each dict: {text, physio_fp?, physio_dict?, metadata?, ts?}
        """
        return [self.add(**item) for item in items]

    # ── Querying ──────────────────────────────────────────────────────────────

    def query(
        self,
        text:        str,
        physio_fp:   Optional[np.ndarray] = None,
        physio_dict: Optional[dict]       = None,
        k:           int                  = 5,
        min_score:   float                = 0.0,
        source_filter: Optional[str]      = None,
    ) -> list[RetrievedChunk]:
        """
        Retrieve the top-k most relevant chunks.

        Parameters
        ----------
        text          : query text
        physio_fp     : query physio fingerprint (from mps.bond_fingerprint())
        physio_dict   : fallback physio features dict
        k             : number of results
        min_score     : minimum composite score threshold
        source_filter : if set, only return chunks whose metadata["source"] matches

        Returns
        -------
        list of RetrievedChunk, sorted by composite score descending
        """
        with self._lock:
            if not self._chunks:
                return []

            q_text_vec = embed_one(text)

            if physio_fp is None:
                if physio_dict:
                    physio_fp = physio_features(
                        hrv_ms            = physio_dict.get("hrv_rmssd_ms", 35.0),
                        stress_index      = physio_dict.get("stress_index",  0.3),
                        sleep_quality     = physio_dict.get("sleep_quality", 1.0),
                        therapeutic_stage = physio_dict.get("therapeutic_stage", 0.0),
                    )
                else:
                    physio_fp = np.zeros(8, dtype=np.float32)

            physio_fp = np.asarray(physio_fp, dtype=np.float32)
            now       = time.time()

            # Build matrices (lazy)
            if self._text_matrix is None:
                self._text_matrix = np.stack([c.text_vec  for c in self._chunks])
                self._phys_matrix = np.stack([c.physio_fp for c in self._chunks])

            # ── Vectorised scoring ─────────────────────────────────────────────
            # Text similarity
            text_scores = self._text_matrix @ q_text_vec  # [N]

            # Physio similarity: pad/truncate to align dimensions
            D_phys_query = len(physio_fp)
            D_phys_index = self._phys_matrix.shape[1]
            if D_phys_query < D_phys_index:
                q_phys = np.pad(physio_fp, (0, D_phys_index - D_phys_query))
            elif D_phys_query > D_phys_index:
                q_phys = physio_fp[:D_phys_index]
            else:
                q_phys = physio_fp
            q_phys_norm = q_phys / (np.linalg.norm(q_phys) + 1e-8)
            phys_scores = self._phys_matrix @ q_phys_norm   # [N]

            # Recency boost
            timestamps   = np.array([c.ts for c in self._chunks])
            recency      = np.exp(-(now - timestamps) / self.half_life_s).clip(0.0, 1.0)

            # Composite
            composite = (
                self.text_weight    * text_scores +
                self.physio_weight  * phys_scores +
                self.recency_weight * recency
            )

            # Source filter
            if source_filter:
                mask = np.array([
                    c.metadata.get("source", "") == source_filter
                    for c in self._chunks
                ], dtype=bool)
                composite = np.where(mask, composite, -np.inf)

            # Top-k
            top_k_idx = np.argsort(-composite)[:k + 20]  # oversample then filter

            results: list[RetrievedChunk] = []
            for i in top_k_idx:
                sc = float(composite[i])
                if sc < min_score:
                    continue
                results.append(RetrievedChunk(
                    chunk        = self._chunks[i],
                    score        = sc,
                    text_score   = float(text_scores[i]),
                    physio_score = float(phys_scores[i]),
                    recency      = float(recency[i]),
                ))
                if len(results) >= k:
                    break

            return results

    # ── Persistence ───────────────────────────────────────────────────────────

    def save(self) -> None:
        """Persist index to disk (text+physio matrices + metadata sidecar)."""
        if not self._persist_path:
            return
        with self._lock:
            if not self._chunks:
                return
            p = self._persist_path
            p.parent.mkdir(parents=True, exist_ok=True)

            # Build matrices
            tm = np.stack([c.text_vec  for c in self._chunks]).astype(np.float32)
            pm = np.stack([c.physio_fp for c in self._chunks]).astype(np.float32)
            np.save(str(p) + ".text.npy",  tm)
            np.save(str(p) + ".physio.npy", pm)

            meta = [
                {"text": c.text, "metadata": c.metadata, "ts": c.ts, "chunk_id": c.chunk_id}
                for c in self._chunks
            ]
            with open(str(p) + ".meta.json", "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)

            self._dirty = False
            log.debug("TensorRAG index saved: %d chunks → %s", len(self._chunks), p)

    def _load(self) -> None:
        """Load from disk."""
        p = self._persist_path
        try:
            tm   = np.load(str(p) + ".text.npy",  allow_pickle=False)
            pm   = np.load(str(p) + ".physio.npy", allow_pickle=False)
            with open(str(p) + ".meta.json", encoding="utf-8") as f:
                meta = json.load(f)

            for i, m in enumerate(meta):
                chunk = Chunk(
                    text      = m["text"],
                    text_vec  = tm[i],
                    physio_fp = pm[i],
                    metadata  = m.get("metadata", {}),
                    ts        = m.get("ts", 0.0),
                    chunk_id  = m.get("chunk_id", ""),
                )
                self._chunks.append(chunk)

            self._dirty = False
            log.info("TensorRAG index loaded: %d chunks from %s", len(self._chunks), p)
        except Exception as exc:
            log.warning("TensorRAG index load failed (%s): starting fresh", exc)

    # ── Stats ─────────────────────────────────────────────────────────────────

    @property
    def size(self) -> int:
        return len(self._chunks)

    def stats(self) -> dict:
        with self._lock:
            sources = {}
            for c in self._chunks:
                src = c.metadata.get("source", "unknown")
                sources[src] = sources.get(src, 0) + 1
            return {
                "total":    len(self._chunks),
                "sources":  sources,
                "embed_dim": embed_dim(),
            }
