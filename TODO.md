Project Roadmap & TODO

This document outlines the planned features and improvements for the multi-agent system.
Immediate Next Steps

    [ ] Temporal Fact & Symptom Logging: Overhaul the database schema for the facts table to include a timestamp and a history of values. This will allow the system to track symptoms and behaviors over time (e.g., "Patient has reported headaches 5 times this week").

Future Enhancements & IP

    [ ] Reciprocal Care Circles: Architect a system where every user can have their own care circle. A user can be a "patient" in their own circle while being a "caregiver" in another's. This involves a more complex user and relationship management model in the database.

    [ ] Dynamic Relationship Analysis: Develop a module that analyzes conversation history to dynamically infer the relationship_closeness (e.g., supportive, strained, distant) between users. This score can then be used to further refine the AI's communication style and data-sharing decisions.

Completed

    [x] Implement "Mediated Clarification" Logic: The system now gently probes users to clarify discrepancies, rather than only escalating silently.

    [x] Implement Consent Manager Commands: Users can now set consent levels for others in their care circle via chat commands.

    [x] Beautify CLI: Add color and better formatting to the client terminals.

    [x] Create Automated Tests: Build a test.js runner for repeatable system checks.

    [x] Create Doctor's Client: Implement a separate client for doctors to view escalated alerts.

    [x] Implement Consent Manager (Backend): The database now supports consentLevel and relationshipType, laying the groundwork for user-facing controls.

    [x] Granular Privacy & Criticality: The messageAnalyzer now provides detailed classification, which the orchestrator uses for smarter decision-making.

    [x] Action-Oriented AI Persona: Updated the personal agent's prompts to be more decisive and provide direct advice in critical situations.
