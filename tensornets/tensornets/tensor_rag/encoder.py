"""
tensornets.tensor_rag.encoder
==============================
Text embedding backend for TensorRAG.

Tries (in order):
  1. SentenceTransformers all-MiniLM-L6-v2  (384-dim dense, cosine)
  2. Scikit-learn TF-IDF + SVD (128-dim, sparse→dense fallback)
  3. Hash trick fallback (128-dim, no dependencies)

All backends return float32 numpy arrays, L2-normalised, so that
dot-product = cosine similarity.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

# ── Backend selection ─────────────────────────────────────────────────────────

_BACKEND: Optional[str] = None  # 'sentence_transformers' | 'tfidf' | 'hash'
_ST_MODEL = None
_TFIDF_PIPELINE = None

EMBED_DIM_ST    = 384
EMBED_DIM_TFIDF = 128
EMBED_DIM_HASH  = 128


def _init_backend() -> str:
    global _BACKEND, _ST_MODEL, _TFIDF_PIPELINE

    if _BACKEND is not None:
        return _BACKEND

    # Try SentenceTransformers
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _ST_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
        _BACKEND  = "sentence_transformers"
        log.info("TensorRAG encoder: using SentenceTransformers all-MiniLM-L6-v2 (%d dims)", EMBED_DIM_ST)
        return _BACKEND
    except Exception as e:
        log.info("SentenceTransformers unavailable (%s); trying TF-IDF fallback", e)

    # Try scikit-learn TF-IDF
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
        from sklearn.decomposition import TruncatedSVD                # type: ignore
        from sklearn.pipeline import Pipeline                         # type: ignore
        _TFIDF_PIPELINE = Pipeline([
            ("tfidf", TfidfVectorizer(max_features=4096, sublinear_tf=True, ngram_range=(1, 2))),
            ("svd",   TruncatedSVD(n_components=EMBED_DIM_TFIDF, random_state=42)),
        ])
        _BACKEND = "tfidf"
        log.info("TensorRAG encoder: using TF-IDF+SVD fallback (%d dims)", EMBED_DIM_TFIDF)
        return _BACKEND
    except Exception as e:
        log.info("TF-IDF unavailable (%s); using hash fallback", e)

    _BACKEND = "hash"
    log.info("TensorRAG encoder: using hash trick fallback (%d dims)", EMBED_DIM_HASH)
    return _BACKEND


def embed(texts: list[str]) -> np.ndarray:
    """
    Embed a list of strings → float32 array of shape [N, embed_dim], L2-normalised.

    Parameters
    ----------
    texts : list of str

    Returns
    -------
    np.ndarray  shape [N, D]
    """
    backend = _init_backend()

    if backend == "sentence_transformers":
        vecs = _ST_MODEL.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.array(vecs, dtype=np.float32)

    if backend == "tfidf":
        return _embed_tfidf(texts)

    return _embed_hash(texts)


def embed_one(text: str) -> np.ndarray:
    """Embed a single string → 1-D float32 array, L2-normalised."""
    return embed([text])[0]


def embed_dim() -> int:
    backend = _init_backend()
    if backend == "sentence_transformers": return EMBED_DIM_ST
    return EMBED_DIM_TFIDF if backend == "tfidf" else EMBED_DIM_HASH


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalised vectors."""
    return float(np.dot(a, b).clip(-1.0, 1.0))


# ── TF-IDF backend ────────────────────────────────────────────────────────────

_TFIDF_CORPUS: list[str] = []      # documents seen during fit
_TFIDF_FITTED  = False


def tfidf_add_corpus(texts: list[str]) -> None:
    """Add documents to the TF-IDF corpus and refit."""
    global _TFIDF_CORPUS, _TFIDF_FITTED
    _TFIDF_CORPUS.extend(texts)
    if len(_TFIDF_CORPUS) >= 10:
        _TFIDF_PIPELINE.fit(_TFIDF_CORPUS)
        _TFIDF_FITTED = True


def _embed_tfidf(texts: list[str]) -> np.ndarray:
    global _TFIDF_FITTED
    if not _TFIDF_FITTED:
        # Fit on the documents themselves (unsupervised)
        corpus = list(set(_TFIDF_CORPUS + texts))
        if len(corpus) < 2:
            corpus += ["placeholder document for TF-IDF initialisation"]
        _TFIDF_PIPELINE.fit(corpus)
        _TFIDF_FITTED = True
    vecs = _TFIDF_PIPELINE.transform(texts).astype(np.float32)
    # L2-normalise
    norms = np.linalg.norm(vecs, axis=1, keepdims=True).clip(min=1e-8)
    return vecs / norms


# ── Hash trick fallback ───────────────────────────────────────────────────────

def _embed_hash(texts: list[str]) -> np.ndarray:
    """
    Deterministic hash-based embedding.  No training, no dependencies.
    Quality is lower than TF-IDF but always available.
    """
    D   = EMBED_DIM_HASH
    out = np.zeros((len(texts), D), dtype=np.float32)
    for i, text in enumerate(texts):
        words = re.findall(r'\w+', text.lower())
        vec   = np.zeros(D, dtype=np.float32)
        for w in words:
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            j = h % D
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[j] += sign
        norm = np.linalg.norm(vec) + 1e-8
        out[i] = vec / norm
    return out


# ── Physio feature vector (fallback when no MPS) ─────────────────────────────

def physio_features(hrv_ms: float, stress_index: float,
                    sleep_quality: float = 1.0,
                    therapeutic_stage: float = 0.0) -> np.ndarray:
    """
    Compact physiological feature vector for use when MPS is not available.

    Maps raw physiological values to a normalised float32 vector [8 dims]:
      [hrv_norm, stress, sleep, stage, hrv_bin0..3]

    hrv_bins encode HRV into 4 buckets:
      [≥40ms, 25–40ms, 15–25ms, <15ms]
    """
    hrv_norm = float(np.clip(hrv_ms / 60.0, 0.0, 1.0))   # normalise to [0,1] at 60ms baseline

    bins = np.zeros(4, dtype=np.float32)
    if hrv_ms >= 40:   bins[0] = 1.0
    elif hrv_ms >= 25: bins[1] = 1.0
    elif hrv_ms >= 15: bins[2] = 1.0
    else:              bins[3] = 1.0

    vec = np.array([
        hrv_norm,
        float(stress_index),
        float(sleep_quality),
        float(therapeutic_stage),
        *bins,
    ], dtype=np.float32)

    norm = np.linalg.norm(vec) + 1e-8
    return vec / norm
