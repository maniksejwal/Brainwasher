Multi-Agent System for Patient Adherence

This project is a command-line prototype of a multi-agent AI system designed to improve patient adherence through mediated communication between patients, caregivers, and doctors.
Core Concepts & IP

    Multi-Agent Communication: Each user (patient, caregiver, doctor) interacts with a dedicated Personal AI Agent.

    Mediated Clarification: When the system detects conflicting information, it gently probes the other party to clarify the situation without causing direct confrontation.

    Dynamic Relationship Analysis: The system periodically analyzes conversation history to determine relationship type (e.g., spouse) and closeness, which is used to tailor communication.

    Dual Consent Model: The system supports two modes of consent:

        Global Consent: Users can set a persistent sharing level (/consent <user> <level>).

        Per-Message Consent: For private information, the agent can proactively ask for permission to share a single message with a specific user, providing a reason. This allows for granular, in-the-moment decision-making.

    Privacy & Criticality Policy: The system categorizes every message based on a formal policy (policy.md) for both its privacy implications and its clinical urgency, allowing for nuanced and safe decision-making.

Architecture & File Structure

The system is composed of several key files:

    server.js: The entry point. An Express.js server that handles all client connections and API requests.

    orchestrator.js: The "brain" of the system. It contains the core logic for routing messages, calling AI agents, detecting conflicts, and managing the consent and escalation workflows.

    client.js: A simple command-line interface for users to interact with the system. You run a separate instance for each role (patient, caregiver, doctor).

    agents.js: Contains the functions that interact with the Gemini API. It manages API key rotation and calls the various prompts.

    prompts.js: A library of all the master prompts that define the AI agents' personas, goals, and response formats.

    database.js: Manages the SQLite database, handling all data storage and retrieval for users, messages, facts, and consent states.

    policy.md: A human-readable document defining the rules for data privacy and criticality levels.

Consent and Privacy Explained

The system's safety and trust model is built on the policies in policy.md.

    Default Consent: By default, the consent level between any two users is none. No information is shared unless explicitly permitted.

    Consent Levels:

        none: No information is ever shared with this user.

        limited: Only non-critical, PUBLIC messages are shared. (Future feature)

        full: PUBLIC messages are shared with this user.

    Criticality Overrides: As defined in the policy, a message with HIGH criticality (e.g., "I am having chest pains") will be escalated to the doctor regardless of consent levels, because safety is the top priority.

    Dynamic Aspects: The Dynamic Relationship Analysis feature is designed to inform the AI's conversational tone. In the future, it could also suggest default consent levels based on inferred closeness.

How to Run

You will need at least three terminal windows open simultaneously.
1. Setup

# Install dependencies
npm install

# Create the .env file with your API keys
# GEMINI_API_KEY_1="key1"
# GEMINI_API_KEY_2="key2"

2. Run the Server (Terminal 1)

node server.js

3. Run the Clients (Terminals 2, 3, 4...)

node client.js

The client will ask for your role: patient, caregiver, or doctor.
4. How to Test

You can follow the detailed scripts in scenarios.md.

Testing Per-Message Consent:

    Start patient and caregiver clients.

    In the patient's terminal, send a private but important message: I think I forgot to take my blood pressure pill this morning.

    The agent will reply and then ask: This seems important for your caregiver to know. May I share this update with them?

    In the patient's terminal, reply yes or proceed.

    Check the caregiver's terminal. They will now receive a [Care Circle Update] with the information.
