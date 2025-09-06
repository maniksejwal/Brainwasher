Project Roadmap & TODO

This document outlines the planned features, architectural changes, and future enhancements for the multi-agent reconciliation system.
Immediate Tasks (Implemented in this version)

    [x] Beautify CLI: Add color to the client interface for better readability using chalk.

    [x] Automated Testing: Create a test runner (test.js) to programmatically execute the scenarios defined in scenarios.md.

    [x] Refactor for Testability: Add a database reset function to enable clean test runs.

Next Up: Core Feature Enhancements

These are the next priorities to build out the core IP.

    Consent Manager (High Priority):

        Implement a basic consent framework. A patient should be able to define what types of information can be shared with a specific caregiver.

        This will require adding a relationships table to the database (e.g., patient_id, caregiver_id, relationship_type, consent_level).

        The privacyDiscriminator agent will need to be updated to check these consent rules.

    Doctor's Client / Escalation Pathway:

        Create a simple, read-only client for the "doctor" role.

        Implement an "escalate" function in the orchestrator. Critical conflicts or specific alerts should be flagged and pushed to the doctor's view.

    Enhanced Privacy Granularity:

        Move beyond a simple "YES/NO" for privacy.

        The privacyDiscriminator should classify messages with more nuanced labels like:

            SENSITIVE: (e.g., mental health, finance) - Requires explicit consent.

            CRITICAL: (e.g., overdose, severe symptom) - Should be shared/escalated regardless of privacy for safety.

            PRIVATE: (e.g., an infection in the privates) - Should never be shared with anyone except the doctor.

            SAFE_TO_SHARE: (e.g., headache, general updates) - Default sharing level.

Future Work & New IP

This section includes more complex features and potential new inventive steps.

    Inventive Step: Dynamic Relationship & Context Analysis:

        The system should dynamically measure the "closeness" and "state" (e.g., supportive, strained) of the relationship between patient and caregiver based on their message history.

        This "closeness score" can then be used to adapt the personal agent's tone and decide what information is appropriate to share (e.g., you might share more with a supportive spouse than a distant friend).

    Advanced Fact Extraction:

        Improve the detectConflict engine to extract more than just medication_taken. It should be able to identify and structure facts about symptoms, appointments, and lifestyle events (e.g., symptom: cough, severity: persistent).

    Expand Scenarios:

        Develop and test the more complex human scenarios you outlined:

            Caregiver is a friend, not family.

            Diseases with high social stigma (e.g., HIV/AIDS).

            Sensitive personal topics (e.g., extramarital affairs, divorce).

        A table of scenarios is a good idea for tracking test coverage. We should decide if test cases need to be thorough (testing every edge case) or light (proving the core feature). For a prototype, light tests are better.
