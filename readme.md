# Multi-Agent AI System for Mediated Communication

This project is a Node.js prototype of a multi-agent AI system designed to solve the "information asymmetry" problem in multi-user groups. It creates a network of personal AI agents that mediate communication, reconcile conflicting reports, and provide a more accurate, unified understanding of a situation for a decision-maker.

## Core Concepts

- **Reciprocal Care Circles**: The architecture supports multiple, distinct Care Circles. Any user can be a patient in their own personal circle while also being a caregiver or doctor in others.

- **Context Switching**: Users must explicitly switch their active context using the `/switch` command to ensure privacy and clarity.

- **Implied Context Switching**: The system can infer when a user is talking about another patient and ask for consent to log the message in the correct circle.

- **Multi-Layered Consent**: A sophisticated consent model manages information flow, including global commands (`/consent`), per-message requests, and implied consent.

- **AI-Powered Agents**: The system's intelligence is driven by a suite of specialized AI agents using LLMs (Gemini or OpenAI).

- **State Management**: A robust session state machine tracks conversational context to handle multi-step interactions without losing track.

- **🆕 Self-Improving Training System**: A comprehensive reinforcement learning infrastructure that continuously improves the AI through simulations, human feedback, and automated prompt optimization. See [Training Documentation](documentation/training/).

## Setup & Installation

### Prerequisites
You must have Node.js (version 18 or higher) and npm installed.

### Install Dependencies
In your project's root directory, run:

```bash
npm install
```

### Set Up API Keys
Create a file named `.env` in the root of the project. Open it and add your API keys. The system defaults to OpenAI if `CHAT_GPT_KEY` is present.

```env
# .env file
CHAT_GPT_KEY="sk-..."
GEMINI_API_KEY_1="YOUR_GEMINI_KEY_HERE"
```

## How to Run

### Start the Server
In one terminal, run:

```bash
node server.js
```

### Start Clients
In separate terminals, run the client application:

```bash
node client/main.js
```

You will be prompted to log in with a username (e.g., `alice`, `bob`, `dr_evans`).

## How to Use: Key Commands

### All Users

- `/switch <patient_username>` - Switch to another care circle you are a member of.
- `/circle` - View the members of your currently active care circle.
- `/yes` or `/no` - Respond unambiguously to a question from your agent.

### Patient Workflow

When you log in for the first time, a personal care circle is created for you. You can then build your circle using the following commands:

- `/care <username> as <relationship>` - Add a caregiver (e.g., spouse, friend, nurse) to your personal care circle.
- `/doc <username>` - Add a doctor to your personal care circle.
- `/consent <username> <level>` - Set a standing consent level (`none`, `limited`, `full`) for a member of your circle.

### Doctor's Workflow

A user becomes a "doctor" in a care circle when a patient adds them using the `/doc <username>` command. This grants them doctor-level permissions only within that specific circle.

- `/spec <specialty>` - Set your clinical specialty (e.g., Cardiology) for your role in the current circle.
- `/log "note"` - Log a confidential note in the patient's record.
- `/order "test/medication"` - Log a confidential order request.
- `/agent ask <username_or_role> "topic"` - Have your agent ask a question on your behalf. You can specify either a username (e.g., `alice`) or a role (e.g., `patient`, `caregiver`).

## Training & Continuous Improvement 🆕

The system includes a comprehensive training infrastructure that enables continuous self-improvement through:

- **Automatic Logging**: All conversations passively logged for analysis (< 2ms overhead)
- **Human Feedback**: `/score` command for real-time quality ratings
- **AI Simulations**: 11 synthetic personas generate unlimited training data
- **Automated Analysis**: AI-powered pattern detection and recommendations
- **Prompt Optimization**: Automatic improvement based on performance data
- **A/B Testing**: Statistical validation before deployment

### Quick Start

```bash
# Rate an interaction
/score +1 "Great response!"

# Run simulation
node training/simulation/simulator.js

# Analyze performance
node training/analysis/feedback_analyzer.js

# Optimize prompts
node training/analysis/prompt_optimizer.js
```

### Documentation

- 🚀 **[Getting Started](documentation/training/GETTING_STARTED.md)** - Quick start guide
- 🏗️ **[Architecture](documentation/training/ARCHITECTURE.md)** - System diagrams with Mermaid
- ✅ **[Implementation](documentation/training/IMPLEMENTATION_SUMMARY.md)** - What was built
- 📖 **[RL Framework](documentation/reinforcement_learning_framework.md)** - Theoretical foundation

## Testing

The project includes an automated test suite. To run all tests, use the command:

```bash
npm test
```

This will execute all test files located in the `tests/` directory and report the results.
