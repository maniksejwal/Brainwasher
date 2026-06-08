# TensorRAG: Physiologically-Conditioned Retrieval-Augmented Generation

---

## 1. Overview

TensorRAG extends standard RAG with a second retrieval axis: the patient's
current MPS-derived physiological state.  Standard RAG ranks retrieved chunks
by text similarity alone.  TensorRAG adds a physio similarity term so that a
clinical guideline retrieved when the patient was in acute distress is
preferentially returned when the patient is *currently* in acute distress — not
when they are at baseline.

```
COMPOSITE RETRIEVAL SCORE
─────────────────────────
score(query, chunk) = α · text_sim(q_text, chunk.text)
                    + β · physio_sim(q_mps,  chunk.physio_fp)
                    + γ · recency_boost(chunk.ts)

α = TEXT_WEIGHT    = 0.60  (semantic relevance)
β = PHYSIO_WEIGHT  = 0.30  (physiological context)
γ = RECENCY_WEIGHT = 0.10  (recency decay, half-life 24 h for episode memory)

text_sim     = cosine(embed(q_text), embed(chunk.text))
physio_sim   = cosine(mps.bond_fingerprint(), chunk.physio_fp)
                 OR cosine(physio_features(q), chunk.physio_fp)  [no MPS fallback]
recency_boost = exp(-(now − chunk.ts) / HALF_LIFE_S)
```

---

## 2. Architecture

```
tensornets/tensornets/tensor_rag/
├── __init__.py          — module-level docstring + integration notes
├── encoder.py           — text embedding backend (SentenceTransformers → TF-IDF → hash)
├── index.py             — PhysioConditionedIndex (core retrieval engine)
├── episode_store.py     — EpisodeMemoryStore (indexes completed A3C episodes)
├── kb_store.py          — ClinicalKnowledgeBase (90+ MI / NICE / escalation chunks)
└── rag.py               — TensorRAG facade (aggregates all sources)
```

### 2.1 PhysioConditionedIndex (`index.py`)

The core in-memory index.  Stores `Chunk` objects with:
- `text_vec`: L2-normalised float32 text embedding (384-dim SentenceTransformers
  or 128-dim TF-IDF/SVD or 128-dim hash trick)
- `physio_fp`: L2-normalised physio fingerprint (7-dim MPS bond fingerprint or
  8-dim `physio_features()` fallback)
- `metadata`: dict (source, episode_id, arm, scenario_id, zone, …)
- `ts`: Unix timestamp for recency weighting

Retrieval is fully vectorised (numpy matrix multiply) — no iterative loops.
Thread-safe via a `RLock`.  Persists to `.text.npy` + `.physio.npy` + `.meta.json`.

### 2.2 MPS Bond Fingerprint (`mps.py :: bond_fingerprint()`)

Added to `MatrixProductState`.  Returns a compact float32 vector of dimension
`chi_physio + 3` (7 for chi_physio=4) derived from the physio bond block:

| Component | Dims | Captures |
|---|---|---|
| Diagonal of physio transfer matrix | 4 | Distributional spread across physio subspace |
| Top-2 singular values of transfer matrix | 2 | Dominant oscillation modes |
| Scalar physio energy (Frobenius norms) | 1 | Overall physiological tension |

Normalised to unit L2 so dot-product = cosine similarity.

### 2.3 Encoder (`encoder.py`)

Tries in order:
1. `sentence-transformers all-MiniLM-L6-v2` (384-dim, best quality)
2. `scikit-learn TF-IDF + SVD` (128-dim, no GPU)
3. Hash trick (128-dim, zero dependencies, always available)

Physio fallback `physio_features(hrv_ms, stress_index, sleep_quality, therapeutic_stage)`
maps raw values to an 8-dim normalised vector when no MPS is available.

### 2.4 Retrieval Sources

| Source | Store | Content | Physio zone |
|---|---|---|---|
| `clinical_kb` | `ClinicalKnowledgeBase` | 90+ MI / NICE / escalation / medication / sleep / caregiver knowledge chunks | Per entry (baseline / moderate_stress / high_stress / crisis) |
| `episode_memory` | `EpisodeMemoryStore` | Completed A3C episode summaries (goal, reward, stress_auc, trust_delta) | From episode's mean physio state |

---

## 3. Integration Points

### 3.1 Python / A3C Training (`worker.py`)

The A3C worker initialises TensorRAG lazily on first scorer call:

```python
_rag = _get_worker_rag()
rag_context = _rag.query_context(
    text        = f"{patient_msg} {agent_resp}",
    physio_dict = {"hrv_ms": 18.0, "stress_index": 0.78, ...},
    k           = 3,
    sources     = ["clinical_kb"],
    max_chars   = 800,
)
score_result = scorer.score_turn(..., rag_context=rag_context)
```

The retrieved context is injected into the LLM scoring prompt under
`CLINICAL KNOWLEDGE (TensorRAG — relevant to current physiological state)`.
This means the scorer LLM has access to the right MI technique or escalation
guideline for the patient's current state, improving scoring precision.

After each episode completes, the episode summary is indexed:
```python
_get_worker_rag().add_episode(summary)
```

### 3.2 FastAPI Endpoints (`server.py`)

| Endpoint | Method | Description |
|---|---|---|
| `/rag/query` | POST | Query TensorRAG for top-k chunks |
| `/rag/add-episode` | POST | Index a completed episode summary |
| `/rag/stats` | GET | Return index sizes and embedding backend info |

#### `/rag/query` request body

```json
{
  "text": "patient is experiencing cravings and low mood",
  "hrv_rmssd_ms": 18.0,
  "stress_index": 0.78,
  "sleep_quality": 0.4,
  "therapeutic_stage": 0.2,
  "k": 5,
  "sources": ["clinical_kb", "episode_memory"],
  "arm_filter": null,
  "format": "chunks"
}
```

`format: "context_string"` returns a formatted text block ready for prompt injection.

### 3.3 Node.js / Companion (`tensornetsBridge.js`)

```js
import { queryTensorRAGContext } from './companions/physio/tensornetsBridge.js';

const ragContext = await queryTensorRAGContext({
  text:         latestUserMessage,
  hrv_rmssd_ms: physioState.hrv_rmssd_ms ?? 35.0,
  stress_index: physioState.stress_index  ?? 0.3,
  k:            4,
});

if (ragContext) {
  systemPrompt += '\n\n' + ragContext;
}
```

In `CompanionCoordinator.js`, TensorRAG context is retrieved automatically on
every turn and injected via `{{TENSOR_RAG_CONTEXT}}` in the action selector prompt.

---

## 4. Persistent Storage

```
data/rag/
├── clinical_kb.index.text.npy      — text embedding matrix
├── clinical_kb.index.physio.npy    — physio fingerprint matrix
├── clinical_kb.index.meta.json     — chunk texts + metadata
├── episode_memory.index.text.npy
├── episode_memory.index.physio.npy
└── episode_memory.index.meta.json
```

---

## 5. Extending the Knowledge Base

Add custom clinical knowledge chunks via JSONL ingestion:

```python
# Each line: {"text": "...", "zone": "baseline|moderate_stress|high_stress|crisis"}
kb.also_ingest_jsonl("data/kg/local_protocols.jsonl")
```

Or via the in-process API:
```python
from tensornets.tensor_rag.rag import TensorRAG
rag = TensorRAG()
rag._kb._index.add(
    text       = "Local de-escalation protocol for post-discharge patients...",
    physio_dict = {"hrv_ms": 18.0, "stress_index": 0.75, ...},
    metadata   = {"source": "clinical_kb", "zone": "high_stress"},
)
```

---

## 6. Graceful Degradation

- If `sentence-transformers` is not installed → TF-IDF → hash trick (always works)
- If Python / FastAPI is offline → Node.js `queryTensorRAGContext()` returns `""` silently
- If TensorRAG init fails in worker → `_get_worker_rag()` returns `None`; scoring continues without RAG context
- Index files missing → starts fresh (empty index)

---

## 7. Future Work

- [ ] **Session-local TurnMemoryStore**: index per-turn commitments, contradictions, and disclosures made THIS session. Retrieve to ground the companion's current-turn response without hallucinating facts the patient said earlier.
- [ ] **Online learning**: reweight clinical KB entries based on A3C reward signals — entries retrieved before high-reward turns get upweighted; entries retrieved before low-reward turns get downweighted.
- [ ] **MPS fidelity metric**: replace the current bond-fingerprint cosine with true quantum fidelity `|⟨Ψ₁|Ψ₂⟩|²` for the physio similarity term.
- [ ] **Dense MPS retrieval**: store the full MPS bond dimension tensor per chunk (not just the 7-dim fingerprint) and compute exact transfer-matrix overlap as the physio score.
