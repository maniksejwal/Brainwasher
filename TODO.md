Project Roadmap & TODO

This document tracks the strategic direction and planned features for the multi-agent system.
Core 

    [x] Multi-Agent Reconciliation Engine: Core logic for detecting conflicts between patient and caregiver reports. (Implemented)

    [x] Privacy-Preserving Protocol: AI-driven privacy discriminator to prevent sharing of sensitive info. (Implemented)

    [x] Verifiable Conversational Logic: Using AI to generate context-aware, human-like replies. (Implemented)

    [x] Consent Manager: Granular control over what information is shared based on user-defined relationships. (Implemented)

    [x] Doctor Escalation Pathway: A dedicated client for clinicians to receive critical, filtered alerts. (Implemented)

    [ ] Dynamic Relationship Analysis: AI agent that actively analyzes the tone and content of conversations to determine the real-time state of the patient-caregiver relationship (e.g., "supportive," "strained"). This is a key inventive step.

Current Implementation (Prototype v1)

    [x] Backend: Node.js with Express (orchestrator.js)

    [x] Database: SQLite for persistence (database.js)

    [x] AI Logic: Gemini API integration (agents.js)

    [x] Clients: CLI for Patient, Caregiver, and Doctor. (client.js, doctor_client.js)

    [x] Testing: Automated test runner. (test.js)

Future Enhancements (The Next Big Steps)

    Add Time Dimension to Database: The current database overwrites facts. The next version should maintain a temporal log of all facts and symptom reports, including timestamps. This allows the doctor to see the history and progression of a patient's state over time, which is a critical feature for clinical analysis.

    Implement Reciprocal Roles & Multi-Circle Architecture: The current model assumes fixed "patient" and "caregiver" roles. The architecture needs to evolve to support a multi-circle model where every user has their own profile. A user can be a "patient" in their own care circle while also being a "caregiver" in someone else's circle (e.g., their parent's). This is a significant architectural and IP enhancement.

    Granular Privacy & Labels: Move beyond a simple private/not-private flag. Introduce a spectrum of labels (e.g., SENSITIVE, CRITICAL, SAFE_TO_SHARE, ROUTINE_UPDATE) that the AI can assign. The Consent Manager will use these labels to make more nuanced sharing decisions.

    Diplomatic Probing: Instead of just flagging a conflict, the AI agent should be able to ask a clarifying, non-accusatory question to the user who provided the conflicting report (e.g., "Just to double-check, are you sure about that time?").
