Multi-Agent System for Patient Adherence

This project is a command-line prototype of a novel multi-agent system designed to improve patient adherence and facilitate communication within a "care circle" (patient, caregivers, doctor).
Core

    Multi-Agent Reconciliation Engine: The system uses a network of personal AI agents to gather information from multiple users, identify discrepancies in their reports, and escalate conflicts to a human professional (doctor).

    Mediated Clarification: Instead of simply reporting conflicts, the AI can proactively and gently probe users for more information to clarify a situation without revealing the source of the contradictory report.

    Dynamic Relationship & Privacy Analysis: The system analyzes conversations to model the relationship between users (e.g., spouse, friend) and a closenessScore. This, combined with message analysis for privacyLevel and criticality, allows for highly granular and context-aware information sharing.

    Consent Manager with Implied Consent: Users have granular control over what they share. The system reduces friction by using an "implied consent" model, where permission for a specific topic is temporarily remembered.

    Doctor-in-the-Loop Architecture: A dedicated doctor client receives real-time escalations for critical events and can issue directives, which are then translated by the AI into conversational actions for the patient or caregiver.

System Architecture

The system consists of three main components:

    server.js: An Express server that handles all network communication, including API endpoints for sending messages and a real-time Server-Sent Events (SSE) stream for broadcasting updates.

    orchestrator.js: The "brain" of the system. This module contains all the core logic for processing messages, running AI agents, detecting conflicts, managing consent, and handling escalations. It is a pure logic module, separate from the server.

    client.js: A unified command-line interface that can be run for any role (patient, caregiver, doctor). Each client connects to the orchestrator to send and receive messages.

Licensed by Google
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

3. Using Commands

The clients support special commands that begin with a forward slash (/).

    /clear: Clears the database. Useful for starting a fresh test.

    /consent <targetUser> <level> <relationship>: Sets a sharing rule.

        targetUser: The user you want to share with (e.g., caregiver, doctor).

        level: The level of consent (none, limited, full). See policy.md for details.

        relationship: The nature of your relationship (spouse, friend, sibling, etc.).

        Example: /consent caregiver full spouse

Core Policies (policy.md)

This file defines the rules for data handling, including:

    Privacy Levels: PUBLIC, PRIVATE, SENSITIVE.

    Criticality Levels: NONE, LOW, HIGH.

    Consent Levels: none, limited, full.

    How these policies interact to determine when and how information is shared or escalated.
