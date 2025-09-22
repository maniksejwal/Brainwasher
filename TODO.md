Multi-Agent System - Project Roadmap & TODO

This document tracks the development progress and future plans for the multi-agent system prototype.
Up Next
Learning & Training Infrastructure

    Task: Build the data pipeline and tools for the "Three-Phase Training Strategy."

    Plan:

        Implement Rich Data Logging: Modify the orchestrator to log every significant decision (the "State-Action" pair) to a structured training_log.jsonl file.

        Create the Annotation Tool: Build annotator.js for human-in-the-loop feedback.

        Build the Training Stub: Create trainer.js as an entry point for future RL algorithms.

        Implement Reinforcement Learning Engine:

            Build the actual RL algorithms in trainer.js.

            Prompt Engineering & Optimization: Implement the meta-learning loop where AI agents analyze HITL feedback to suggest improvements to prompts.

Ontology Integration

    SNOMED CT / ICD, LOINC: Integrate via direct API calls to a Terminology Service.

    Clinical Guidelines / Drug Databases: Integrate via a Retrieval-Augmented Generation (RAG) pipeline.

Completed Features

    Advanced Agent Capabilities

        Multi-Question Pending Action Stack (v1)

        Implied Context Switching (v2)

        Entity Resolution & Context Enrichment (v2)

    Codebase Refactoring
