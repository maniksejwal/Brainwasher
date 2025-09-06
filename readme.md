This project is a command-line prototype of a multi-agent system designed to improve patient adherence by creating a collaborative "care circle" between a patient, a caregiver, and a doctor. Each participant interacts with their own personal AI agent.
Core Features

    Personal AI Agents: Each user (patient, caregiver, doctor) has a dedicated AI companion that provides context-aware responses and support.

    Conflict Detection & Mediation: The system identifies discrepancies in reports between the patient and caregiver.

    Mediated Clarification: Instead of direct confrontation, the AI gently probes the other party to clarify conflicting information.

    Critical Event Escalation: Urgent medical information is automatically escalated to the doctor's personal agent.

    Consent Manager: Users can control the level of information sharing with others in the care circle using chat commands.

How to Run

You will need three separate terminal windows open to simulate all participants.
1. Installation

First, install the necessary dependencies from your terminal:

npm install

2. Setup .env File

Create a file named .env in the project root and add your Gemini API key:

GEMINI_API_KEY="YOUR_API_KEY_HERE"

3. Run the Orchestrator (Terminal 1)

This is the central server. It logs all system activity.

node orchestrator.js

4. Run the Clients (Terminals 2 & 3)

Run the unified client in two other terminals. It will ask you for your role each time.

For the Patient (Terminal 2):

node client.js

    Enter your role (patient/caregiver/doctor): patient

For the Caregiver (Terminal 3):

node client.js

    Enter your role (patient/caregiver/doctor): caregiver

(Optional) For the Doctor (Terminal 4):
You can open a fourth terminal to interact as the doctor.

node client.js

    Enter your role (patient/caregiver/doctor): doctor

How to Test

You can follow the detailed scripts in scenarios.md or try the following:

    Test Conflict & Mediation: Have the patient report taking medicine, and the caregiver report the opposite. Watch the orchestrator log and see the gentle clarification message sent to the patient.

    Test Critical Escalation: Have the patient report "chest pain." The doctor's client will receive an immediate, summarized alert from their personal agent.

    Test Consent: As the patient, type /consent caregiver none. Then, send a public message. The caregiver will not receive the "Care Circle Update" notification.
