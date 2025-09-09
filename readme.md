Multi-Agent System for Patient Adherence & Behavioral Support

This project is a command-line prototype of a novel multi-agent system designed to improve patient adherence and facilitate communication within a "care circle" (patient, caregivers, doctor). It moves beyond simple chatbots to create a network of AI assistants that mediate, analyze, and support complex human interactions.
Core Inventive Steps & Features

    Mediated Communication: Users (patient, caregiver, doctor) do not talk directly to each other. They interact exclusively with their personal AI agent. This allows the system to act as a thoughtful filter, mediator, and conflict resolver.

    Temporal Memory & Context: The AI maintains a temporal history of facts and conversations. This allows it to understand trends (e.g., "The patient has reported headaches three times this week") and provide context-aware, intelligent replies, rather than reacting to each message in isolation.

    Behavioral State Modeling: The system incorporates established psychological models (Stages of Change, Coping Styles) to analyze a user's behavioral state. The AI's conversational strategy adapts to this analysis (e.g., using reflective listening for a user in the "Pre-contemplation" stage, and offering concrete plans for a user in the "Preparation" stage).

    Dynamic Relationship Analysis: The AI analyzes shared conversations to infer the relationshipType (e.g., spouse, friend) and a closenessScore between users, tailoring its communication style to the unique dynamics of the care circle.

    Smart Consent & Sharing: The system uses a multi-layered consent model to protect user privacy while reducing friction:

        Global Consent: Users can set overall sharing rules (e.g., /consent caregiver full spouse).

        Per-Message Consent: For sensitive topics, the agent can ask for one-time permission to share.

        Implied Consent: Permission for a specific topic (e.g., "medication") is temporarily remembered to avoid repetitive requests.

    Conflict Resolution & Clarification: When the system detects a factual conflict between users, it does not simply report it. It triggers a "Mediated Clarification," where the agent gently probes the other party for more information without revealing the source of the conflict, de-escalating potential arguments.

    Doctor-in-the-Loop Architecture: A dedicated doctor client receives real-time escalations for critical events (HIGH criticality). The doctor can also issue directives (e.g., "ask patient about sleep"), which the AI translates into natural, conversational actions.

System Architecture

The system consists of three main components:

    server.js: An Express server that handles all network communication, including API endpoints for sending messages and a real-time Server-Sent Events (SSE) stream for broadcasting updates.

    orchestrator.js: The "brain" of the system. This module contains all the core logic for processing messages, running AI agents, detecting conflicts, managing consent, and handling escalations.

    client.js: A unified command-line interface that can be run for any role (patient, caregiver, doctor).

How to Run
1. Setup

    Install Node.js (version 18 or higher).

    In your terminal, in the project directory, run npm install.

    Create a .env file and add your Gemini API keys:

    GEMINI_API_KEY_1="your_first_key_here"
    GEMINI_API_KEY_2="your_second_key_here"

2. Running the System

You will need at least three separate terminal windows.

    Terminal 1 (Server): node server.js

    Terminal 2 (Patient): node client.js (enter patient when prompted)

    Terminal 3 (Caregiver): node client.js (enter caregiver when prompted)

    (Optional) Terminal 4 (Doctor): node client.js (enter doctor when prompted)

3. Running Automated Tests

The tests have been split into a tests/ directory for better organization. To run the full test suite, use the npm script:

npm test

To run a single test file, for example the consent test:

node tests/test_consent.js
