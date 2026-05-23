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
Create a file named `.env` in the root of the project. Open it and add your API keys. The system now defaults to the hosted Ollama endpoint while still supporting OpenAI/Gemini keys when provided.

```env
# .env file
OLLAMA_API_BASE_URL="http://10.6.0.62:8001"
OLLAMA_DEFAULT_MODEL="mistral:latest"
DEFAULT_MODEL="mistral:latest"
FALLBACK_MODEL="mistral:latest"
USE_ONLY_OPENAI=false
CHAT_GPT_KEY="sk-..."
GEMINI_API_KEY_1="YOUR_GEMINI_KEY_HERE"
```

## How to Run

### Start the Server
In one terminal, run:

```bash
nodemon server.js
```

**Why nodemon?** Auto-restarts server when you make code changes (no manual restarts needed!)

**Don't have nodemon?** Install it globally:
```bash
npm install -g nodemon
```

Or use regular Node (but you'll need to restart manually after changes):
```bash
node server.js
```

The server runs on `http://localhost:5000` and serves:
- API endpoints for chat, commands, and training
- GUI static files at `/gui`
- Real-time updates via Server-Sent Events (SSE)

### Client Options

#### Option 1: Web GUI (Recommended)
Open your browser to:
```
http://localhost:5000/gui/
```

Features:
- ✅ Visual chat interface
- ✅ Real-time updates
- ✅ Training dashboard (view conversations, feedback, run simulations)
- ✅ Server log viewer
- ✅ Help system (click ❓ icon)

See [GUI Guide](documentation/gui_guide.md) for details.

#### Option 2: Terminal CLI
In separate terminals, run:

```bash
node cli/chat/main.js
```

You will be prompted to log in with a username (e.g., `alice`, `bob`, `dr_evans`).

**Note:** Both CLI and GUI connect to the same server and share the same backend API (zero duplication).

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

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────┐
│  Clients                                                │
│  ├─ Web GUI (http://localhost:5000/gui/)               │
│  │  └─ Visual interface with training dashboard        │
│  └─ Terminal CLI (client/main.js)                      │
│     └─ Command-line interface                          │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP/SSE (shared API)
┌──────────────────▼──────────────────────────────────────┐
│  Server (server.js)                                     │
│  ├─ API Endpoints (/login, /send, /command, /api/*)   │
│  ├─ Static File Serving (/gui, /shared)               │
│  ├─ SSE for Real-time Updates                         │
│  └─ Log Capture & Buffering                           │
└──────────────────┬──────────────────────────────────────┘
                   │
      ┌────────────┴────────────┐
      │                         │
┌─────▼──────┐         ┌───────▼────────┐
│ Orchestrator│         │  Training      │
│ ├─ Agents   │         │  ├─ Logger     │
│ ├─ State    │         │  ├─ Simulator  │
│ └─ Handlers │         │  └─ Analyzer   │
└─────┬──────┘         └───────┬────────┘
      │                         │
      └────────────┬────────────┘
                   │
            ┌──────▼──────┐
            │  Database   │
            │  (SQLite)   │
            └─────────────┘
```

### GUI Architecture

The GUI is a **single-page application** served by the server:
- **No CORS issues**: GUI served from same origin as API
- **Shared API client**: Both CLI and GUI use `shared/apiClient.js` (zero duplication)
- **Real-time updates**: SSE connection for live message delivery
- **Multiple views**: Chat, Circle, Training Dashboard (Feedback/Conversations/Simulations/Analysis/Logs)

See [Architecture Documentation](documentation/architecture.md) for technical details.

## Authentication & Authorization 🔐

The system now requires authentication for GUI and CLI access. We implement a Role-Based Access Control (RBAC) system:

**Roles**:
- **Admin**: Full system access, training pipeline execution, user management
- **Reviewer**: Training stats, simulations, feedback analysis
- **Doctor**: Patient data access, escalations, directives
- **Caregiver**: Limited patient data (consent-based)
- **Patient**: Own care circle only

**Login**:
- **GUI**: Login modal appears on first access
- **CLI**: Use `node cli/login.js` (stores token in `~/.care-circle/`)

**Permissions**: Fine-grained control over API endpoints. See [RBAC Documentation](documentation/rbac_documentation.md).

**Status**: ⚠️ Partially implemented (Database schema & middleware ready, endpoints in progress).

## Database Architecture

The system uses a **Two-Database Architecture** to isolate production data from testing:

- **Main DB** (`care_circle.db`): Stores production conversations, real user data, and human feedback.
- **Simulation DB** (`care_circle_simulation.db`): Stores synthetic training data and simulation results.

**Why Separate?**
- Isolates test data from production metrics.
- Prevents synthetic users from polluting real analytics.
- Allows safe, destructive experimentation in simulation.

**Selection**: Automatic via `SIMULATION_MODE` environment variable. See [Database Architecture](documentation/database_architecture.md) for details.

## Training & Continuous Improvement 🆕

The system includes a comprehensive training infrastructure that enables continuous self-improvement through:

- **Automatic Logging**: All conversations passively logged for analysis (< 2ms overhead)
- **Human Feedback**: `/feedback` command for real-time quality ratings
- **AI Simulations**: 11 synthetic personas generate unlimited training data
- **Automated Analysis**: AI-powered pattern detection and recommendations
- **Prompt Optimization**: Automatic improvement based on performance data
- **A/B Testing**: Statistical validation before deployment

### Quick Start

**In GUI:** Click 📊 → Simulations → "Run Simulation"

**In CLI:**
```bash
# Rate an interaction
/feedback +1 "Great response!"

# Run simulation
node training/simulation/simulator.js

# Analyze performance
node training/analysis/feedback_analyzer.js

# Optimize prompts
node training/analysis/prompt_optimizer.js
```

### Recent Enhancements (Jan 2026) 🆕

- **Feedback GUI**: Submit feedback directly from the "Conversation Logs" tab in the dashboard.
- **RLHF Integration**: Outcome labels (e.g., gratitude, profanity, irritability) are now automatically detected and used in training (Implicit Rewards).
- **Conversation Count Fix**: Training pipeline now correctly counts conversations from `training_log.jsonl`, enabling optimization on 1000+ samples.
- **Prompt Viewer**: View full text of optimized prompts via the API (`/api/prompts/:version`).

See [Training Enhancements Walkthrough](documentation/walkthrough.md).

### Simulation Dashboard 🎯

The **Simulation Dashboard** provides a comprehensive, interactive interface for monitoring and managing all simulation operations:

```bash
# Launch the interactive dashboard
node cli/simulation_dashboard.js

# Show help and options
node cli/simulation_dashboard.js --help
```

#### Features

- **📊 Real-time Monitoring**: Track simulation counts, feedback collection, critical failures, and performance metrics
- **🚀 Simulation Runner**: Execute individual simulations with interactive scenario selection and custom turn counts
- **🔍 Detailed Analysis**: View complete conversation logs, feedback scores, and performance data
- **📈 Performance Trends**: Analyze 7-day trends, identify top-performing scenarios, and detect common issues
- **🎭 Scenario Management**: Browse all scenarios, view details, and run batch tests
- **💬 Feedback Analysis**: Review auto-generated and human feedback, analyze critical failures
- **⚡ Batch Operations**: Run comprehensive analysis, generate reports, and export data
- **⚙️ System Status**: Monitor database connectivity, system health, and recent activity

#### Dashboard Commands

The dashboard provides an interactive menu system with the following options:

1. **Run New Simulation** - Interactive scenario selection with custom turn counts
2. **View Simulation Details** - Examine conversation logs, feedback, and detailed analysis
3. **Analyze Performance** - View trends, top scenarios, and common issues
4. **Manage Scenarios** - Browse scenarios, view details, run batch tests
5. **View Feedback** - Review all feedback, human feedback, critical failures, goal performance
6. **Batch Operations** - Run analysis, generate reports, clean data, export results
7. **System Status** - Check database connectivity and system health
8. **Refresh Dashboard** - Update metrics and return to main view
9. **Exit** - Close the dashboard

#### Integration

The dashboard integrates with all existing simulation tools:
- **`cli/run_simulation.js`** - Individual simulation execution
- **`training/simulation/scenario_runner.js`** - Batch testing
- **`cli/analyze_failures.js`** - Failure analysis
- **`cli/collect_feedback.js`** - Human feedback collection
- **`cli/view_feedback.js`** - Feedback review

#### Example Workflow

```bash
# 1. Launch dashboard
node cli/simulation_dashboard.js

# 2. Select "Run New Simulation" (option 1)
# 3. Choose scenario (e.g., "conflicting_reports")
# 4. Set custom turns (e.g., 8)
# 5. Monitor real-time execution
# 6. Review results and feedback
# 7. Analyze performance trends
# 8. Run batch operations if needed
```

### Documentation

- 🚀 **[Getting Started](documentation/training/GETTING_STARTED.md)** - Quick start guide
- 🏗️ **[Architecture](documentation/training/ARCHITECTURE.md)** - System diagrams with Mermaid
- ✅ **[Implementation](documentation/training/IMPLEMENTATION_SUMMARY.md)** - What was built
- 📖 **[RL Framework](documentation/reinforcement_learning_framework.md)** - Theoretical foundation

## API Endpoints Reference

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user details

### Messages
- `POST /api/messages/send` - Send a message
- `GET /api/messages/history` - Get conversation history

### Feedback
- `POST /api/feedback/submit` - Submit human feedback
- `GET /api/feedback/view` - View feedback logs (requires permissions)

### Training
- `POST /api/training/run` - Run training pipeline (Admin only)
- `GET /api/training/status` - Get training status

### Simulations
- `GET /api/simulations/history` - List simulation sessions
- `GET /api/simulations/:id/logs` - Get logs for a specific simulation

See [RBAC Documentation](documentation/rbac_documentation.md) for the full permission matrix.

## Testing

The project includes an automated test suite. To run all tests, use the command:

```bash
npm test
```

This will execute all test files located in the `tests/` directory and report the results.
