"""
tensornets — Hysteretic Tensor Negotiation (HTN) Framework
==========================================================

A research package implementing tensorized neural networks and tensor networks
with Monte Carlo Tree Search (MCTS) for non-Markovian, physiologically-aware
multi-agent conversational deliberation in clinical workflows.

Architecture
------------
The framework is bipartite:

  Multilinear Logic Engine (MPS + MCTS + non-Hermitian operators)
      ↓ Semantic Blueprint
  Tensorized Linguistic Engine (compressed Llama via Bedrock)

Initialization is via deterministic distillation — no training data required.
Clinical SOPs are compiled into tensor core geometry via SVD of LLM activations.

Tracks
------
  D  Distillation pipeline (TOP PRIORITY)
  B  LLM backend abstraction (Mistral local + Bedrock 70B)
  C  Physiological subspace (HRV, glucose, EDA, PK/PD)

See TODO.md for the full phased work breakdown.
"""

__version__ = "0.1.0"
__author__ = "Manik Sejwal"
