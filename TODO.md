Project Roadmap & TODO

This document tracks the strategic direction and planned features for the multi-agent system.
Core IP & Inventive Steps

    [x] Multi-Agent Reconciliation Engine: Core logic for detecting conflicts between patient and caregiver reports. (Implemented)

    [x] Privacy-Preserving Protocol: AI-driven privacy discriminator to prevent sharing of sensitive info. (Implemented)

    [x] Verifiable Conversational Logic: Using AI to generate context-aware, human-like replies. (Implemented)

    [x] Consent Manager: Granular control over what information is shared based on user-defined relationships. (Implemented)

    [x] Doctor Escalation Pathway: A dedicated client for clinicians to receive critical, filtered alerts. (Implemented)

    [x] Granular Privacy & Labels: AI assigns privacyLevel and criticality to every message for nuanced decision-making. (Implemented)

    [ ] Dynamic Relationship Analysis: AI agent that actively analyzes the tone and content of conversations to determine the real-time state of the patient-caregiver relationship.

Current Implementation (Prototype v2)

    [x] Backend: Node.js with Express (orchestrator.js)

    [x] Database: SQLite for persistence (database.js)

    [x] AI Logic: Gemini API integration (agents.js)

    [x] Prompt Library: Centralized prompts for easier management (prompts.js)

    [x] Clients: CLI for Patient, Caregiver, and Doctor. (client.js, doctor_client.js)

    [x] Testing: Automated test runner. (test.js)

Future Enhancements (The Next Big Steps)

    Goal-Driven Conversation from DB: Enhance the Personal Agent to pull from the database (e.g., past symptoms, conflicts) to inform its goal-driven questions, making conversations contextually aware over time.

    Add Time Dimension to Database: Maintain a temporal log of all facts and symptom reports, including timestamps, to allow for trend analysis.

    Implement Reciprocal Roles & Multi-Circle Architecture: Evolve the architecture to support a model where every user can be both a patient and a caregiver in different circles.

    Diplomatic Probing: Instead of just flagging a conflict, the AI agent should be able to ask a clarifying, non-accusatory question to the user who provided the conflicting report.
