# `documentation/deprecated/` — Historical Archive

This package holds documentation files that have been superseded by the current architecture but are retained for **historical traceability** — to understand design decisions, what was tried, and why things changed.

> **Do not cite any file in this directory as an authoritative reference for the current system.**
> Every file here carries a `⚠️ DEPRECATED`, `⚠️ STALE`, or `⚠️ WRONG PROJECT` header with a pointer to the replacement document.

---

## Contents

| File | Original path | Reason archived | Superseded by |
|---|---|---|---|
| `architecture.md` | `documentation/architecture.md` | Pre-companions design; Gemini monolith, old rl/ paths | `tensornets/00_architecture.md` |
| `reinforcement_learning_framework.md` | `documentation/reinforcement_learning_framework.md` | Pre-MPS RL design using Gemini/GPT judge | `tensornets/04_training_system.md`, `tensornets/11_RL_environment.md` |
| `advancedRL.md` | `documentation/advancedRL.md` | Speculative §5 fragment; Gemini-based "small RL model" replaced by A3C | `tensornets/08_HTN_framework.md` |
| `llama4_integration.md` | `documentation/llama4_integration.md` | Wrong project (EMM SageMaker); Brainwasher 3 uses AWS Bedrock | `tensornets/02_tensornets_reference.md §1` |
| `training_GETTING_STARTED.md` | `documentation/training/GETTING_STARTED.md` | 2024 Gantt-phase CLI guide; file paths and pipeline superseded | `documentation/training/18_training_pipeline.md` |

---

## Policy

When a document in the main `documentation/` tree becomes superseded:

1. Add a `> ⚠️ **DEPRECATED**` callout block at the top of the file with:
   - The reason for deprecation
   - A pointer to the replacement document
2. Move the file here (into `documentation/deprecated/`).
3. Update the stale-files table in `documentation/INDEX.md §8` with the new path.
4. Update any links in other documents that pointed to the old location.

Files are **never hard-deleted** — git history provides version control, but keeping the files in the repo ensures that grep/search tools can still surface the historical context.
