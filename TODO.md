Multi-Agent System - Project Roadmap & TODO

This document tracks the development progress and future plans for the multi-agent system prototype.
Up Next
Advanced Agent Capabilities

    In Progress - Conversational Intent Analysis: Enhance the unified agent to distinguish between a user reporting a factual symptom versus expressing an opinion, frustration, or giving advice for another member. The message handler must be updated to use this intent to choose the correct action (e.g., mediate advice vs. escalate a symptom).

    Multi-Question Pending Action Stack (v2): Implement advanced logic for managing the question stack, including priority, timeouts, and dependencies.

    Self-Reference Resolution: Enhance the AI agent to correctly identify when a user is referring to themselves in the third person.

Learning & Training Infrastructure
    (See documentation/reinforcement_learning_framework.md for complete implementation plan)

    Implement Rich Data Logging: Create the training_log.jsonl pipeline.

    Create the Annotation Tool: Build annotator.js for human-in-the-loop feedback.

    Build the Training Stub: Create trainer.js.

    Implement Simulation Infrastructure: Build simulator.js with synthetic user generation.

    Add HITL Feedback: Implement /score command in client for live feedback collection.

    Build Meta-Learning: Create feedback analysis and prompt optimization agents.

    Establish A/B Testing: Framework for prompt version comparison.

Completed Features

    Advanced Agent Capabilities

        Entity Resolution & Context Enrichment (v2)

        Implied Context Switching (v2)

        Multi-Question Pending Action Stack (v1)

    Usability & Feature Enhancements

    Codebase Refactoring

    Enhance Doctor's Agent & Interaction Model

    Scenarios & Tests Refactored

    Reciprocal Care Circles (Infrastructure & Consent)