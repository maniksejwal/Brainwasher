"""
tensornets.tensor_rag
=====================

TensorRAG: Physiologically-Conditioned Retrieval-Augmented Generation
======================================================================

Standard RAG ranks retrieved chunks by text similarity alone.
TensorRAG adds a second retrieval axis: the current MPS physiological
state fingerprint.  A chunk retrieved when the patient was in acute
distress (low HRV, high stress) is more relevant RIGHT NOW if the
patient is also in acute distress than a chunk retrieved at baseline.

COMPOSITE RETRIEVAL SCORE
--------------------------
  score(q, chunk) = α * text_sim(q_text, chunk.text)
                  + β * physio_sim(q_mps, chunk.mps_fp)
                  + γ * recency_boost(chunk.ts)

  α = TEXT_WEIGHT     = 0.60  (semantic relevance dominates)
  β = PHYSIO_WEIGHT   = 0.30  (physiological context matters)
  γ = RECENCY_WEIGHT  = 0.10  (fresher memories slightly preferred)

  text_sim    = cosine(embed(q_text), embed(chunk.text))
  physio_sim  = cosine(q_mps.bond_fingerprint(), chunk.mps_fp)
                OR cosine(physio_features(q), chunk.physio_features)
                if no MPS is available (degrades gracefully)
  recency_boost = exp(-(now - chunk.ts) / HALF_LIFE_S)

RETRIEVAL SOURCES
-----------------
1. EpisodeMemoryStore: past training episode summaries indexed from
   htn_benchmark_episodes.  Retrieved chunks provide few-shot examples
   of how the A3C agent behaved in similar physiological states.

2. ClinicalKnowledgeBase: static clinical knowledge chunks (Motivational
   Interviewing techniques, NICE guidelines, escalation protocols,
   medication information).  Loaded from data/kg/ JSONL files.

3. TurnMemoryStore: session-local turn facts (commitments, disclosures,
   contradictions detected this session).  Retrieved to ground the
   companion's current-turn response.

ENCODING
--------
Text embeddings use SentenceTransformers (all-MiniLM-L6-v2, 384 dims)
if available.  Falls back to TF-IDF sparse vectors (no GPU needed)
so the system works in environments without the sentence-transformers
package.

INTEGRATION POINTS
------------------
Python (A3C training):
  from tensornets.tensor_rag import TensorRAG
  rag = TensorRAG()
  await rag.init()
  context_str = rag.query(text=turn_text, mps=current_mps, physio=state, k=3)

FastAPI:
  POST /rag/query  → returns top-k retrieved chunks as JSON

Node.js (companion prompt injection):
  import { queryTensorRAG } from './tensornets/tensorRagBridge.js'
  const context = await queryTensorRAG({ text, physio, k: 3 })
  // inject context into system prompt before LLM call
"""
