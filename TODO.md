Multi-Agent System - Project Roadmap & TODO

This document tracks the development progress and future plans for the multi-agent system prototype.
Up Next
Learning & Training Infrastructure

    Implement Rich Data Logging: Modify the orchestrator to log every significant decision (the "State-Action" pair) to a structured training_log.jsonl file.

    Create the Annotation Tool: Build annotator.js for human-in-the-loop feedback.

    Build the Training Stub: Create trainer.js as an entry point for future RL algorithms.

    Implement Reinforcement Learning Engine: Build the actual RL algorithms in trainer.js.

Ontology Integration

    SNOMED CT / ICD: Integrate via direct API calls to a Terminology Service.

    LOINC: Integrate via direct API calls.

    Clinical Guidelines / Drug Databases: Integrate via a Retrieval-Augmented Generation (RAG) pipeline.

Advanced Agent Capabilities

    Multi-Question Pending Action Stack: Upgrade the state_manager to handle a stack of pending questions for more complex, multi-threaded conversations.

    Implied Context Switching: Develop the NLU capability for the agent to automatically detect when a user is talking about another person and temporarily switch the message context.

Completed Features

    Scenarios Refactored: The monolithic scenarios.md has been split into a scenarios/ directory.

    Reciprocal Care Circles (Infrastructure & Consent)

        User Registration & Circle Creation

        Context Switching (/switch)

        Per-Circle Consent (/consent) & Doctor's Role Logic

    Refactor & Expand Scenarios and Tests
