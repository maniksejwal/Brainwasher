# Technical Architecture

This document details the technical implementation of the multi-agent AI system prototype. The system is built entirely in Node.js and is designed as a modular, event-driven application.

## 1. High-Level Overview

The architecture consists of three primary layers: the Clients, the Web Server, and the Application Core, which all interact with a persistent Database.

### 1.1 System Components

- **Clients** (`client/`): Command-line interfaces that simulate the patient, caregiver, and doctor. They establish a persistent, real-time connection to the server to send messages and receive updates.

- **Web Server** (`server.js`): An Express.js server that acts as the system's front door. It handles all incoming HTTP requests and manages the real-time Server-Sent Events (SSE) connections for broadcasting updates.

- **Application Core**: This is the "brain" of the system, composed of several modules:
  - **Orchestrator** (`orchestrator.js`): The central workflow manager. It receives messages from the server and coordinates the actions of all other modules.
  - **AI Agents** (`agents/`): Manages all interactions with the external Gemini Large Language Model (LLM), including message analysis, reply generation, and intent classification.
  - **State Manager** (`state_manager.js`): Tracks the conversational state for each user (e.g., if the system is awaiting a response to a consent question).

- **Database** (`db/`): A SQLite database that provides persistence for all users, messages, facts, and application states. **See [DATABASE_INTEGRITY.md](DATABASE_INTEGRITY.md) for critical data protection rules.**

## 2. Core Component Deep Dive

### 2.1 Server (`server.js`) - The Network Layer

**Responsibility**: Manages all network communication.

**Key Functions**:
- Sets up API endpoints (`/user`, `/send`, `/clear`, `/doctor/escalations/unread`)
- Manages the `/events` endpoint for Server-Sent Events (SSE), keeping a pool of connected clients
- Listens to events from the orchestrator (e.g., `broadcast`, `escalate`) and pushes data to the appropriate clients

### 2.2 Orchestrator (`orchestrator.js`) - The Workflow Engine

**Responsibility**: To direct the flow of information and decision-making. It is the central coordinator.

**Key Functions**:
- Receives new messages from the server via `handleMessage`
- Checks for and handles explicit user commands (e.g., `/consent`, `/clear`, "share with doctor")
- Passes control to the `state_manager` to see if the user's message is a response to a pending question
- If it's a new message, it calls `agents/` to perform the main AI analysis
- Based on the AI's analysis, it triggers core logic like conflict detection, criticality escalation, and consent requests
- Emits events (`broadcast`, `escalate`) that the `server.js` listens to

### 2.3 AI Agents (`agents/`) - The AI Interface

**Responsibility**: To abstract all LLM interactions.

**Key Functions**:
- Manages a pool of Gemini API keys for load balancing and resilience
- Implements a retry mechanism with exponential backoff for handling API errors (503, 429)
- Constructs detailed prompts using data from the orchestrator (user state, history, behavioral models) and sends them to the Gemini API
- Parses the JSON response from the LLM and returns a structured object to the orchestrator

### 2.4 State Manager (`state_manager.js`) - The Session Memory

**Responsibility**: To manage short-term conversational context.

**Key Functions**:
- Creates pending actions when the AI needs to ask a user a direct question (e.g., for consent to share)
- Uses an AI-powered intent classifier (`classifyUserIntent`) to interpret the user's response (e.g., distinguishing "I can't" from a direct "no")
- Resolves the pending action and returns the result to the orchestrator

### 2.5 Database (`db/`) - The Long-Term Memory

**Responsibility**: To provide data persistence.

**Key Functions**:
- Initializes the SQLite database and defines the schema for all tables (users, messages, facts, fact_history, escalations, consent, etc.)
- Provides a set of exported functions for all CRUD (Create, Read, Update, Delete) operations

## 3. Data Flow: Lifecycle of a Message

1. A user types a message into their `client.js` terminal
2. The client sends an HTTP POST request to the `/send` endpoint on `server.js`
3. The server immediately calls the `handleMessage` function in `orchestrator.js` and sends a 202 Accepted response
4. The orchestrator checks if the message is a direct command or a response to a pending action via the `state_manager.js`
5. If it's a new statement, the orchestrator gathers the user's state and history from `database.js`
6. It calls the `processUserMessage` function in `agents.js`, passing all the context
7. `agents.js` constructs a prompt, calls the Gemini API, retries if necessary, and returns a structured JSON object
8. The orchestrator analyzes the JSON response:
   - It updates the database with new facts or user states
   - If criticality is HIGH, it writes to the escalations table and emits an escalate event
   - If a sharingSuggestion is present, it initiates the consent flow via the `state_manager.js`
9. The orchestrator emits a broadcast event containing the AI's reply
10. `server.js` catches the event and writes the message data to the SSE connection of the target user(s)
11. The user's `client.js` receives the SSE message and displays the AI's reply in their terminal

## 4. Testing & Reinforcement Learning Architecture

The system maintains a clear separation between traditional testing and reinforcement learning components to ensure reliability and maintainability.

### 4.1 Testing Layer (`tests/`)

The testing layer focuses on deterministic verification of system correctness:

**Unit Tests**: Verify individual component functionality
- `test_basic.js`: Login, messaging, basic operations
- `test_conflict.js`: Conflict detection and resolution
- `test_consent.js`: Privacy and consent mechanisms
- `test_escalation.js`: Critical event handling

**Integration Tests**: Verify end-to-end workflows
- `test_circles.js`: Care circle management
- `test_doctor.js`: Doctor-specific functionality
- `test_behavioural.js`: Behavioral model integration

**Test Infrastructure**:
- `test_runner.js`: Test orchestration and assertion framework
- Automated test execution with `npm test`
- Database clearing and user simulation

### 4.2 Reinforcement Learning Layer (`rl/`)

The RL layer focuses on performance optimization and continuous improvement:

**Simulation Engine** (`simulator.js`):
- Synthetic user generation with predefined personas
- Automated conversation simulation
- Adversarial testing (medical complications, privacy attacks)
- Scenario-based training data generation

**Training Infrastructure**:
- `trainer.js`: Training orchestration
- `annotator.js`: Human-in-the-loop feedback collection
- `training_log.jsonl`: Structured training data pipeline

**Evaluation Framework**:
- `performance_tests.js`: RL performance evaluation
- `benchmark_tests.js`: A/B testing for prompt versions
- `simulation_tests.js`: Synthetic user validation

### 4.3 Architecture Separation Benefits

**Clear Responsibilities**:
- Tests: Verify correctness, catch regressions
- RL: Optimize performance, learn from feedback

**Different Reliability Requirements**:
- Tests: Must be deterministic and fast
- RL: Involves AI responses, human feedback, stochastic processes

**Independent Development**:
- Teams can work on testing and RL separately
- Different CI/CD pipelines (tests on every commit, RL evaluation periodically)
- Easier debugging and maintenance

### 4.4 Integration Points

The testing and RL systems interact at specific interfaces:

- **RL Component Testing**: Traditional tests verify RL infrastructure works correctly
- **Performance Evaluation**: RL evaluation measures system improvements
- **Regression Testing**: Traditional tests run after RL updates to ensure no breaking changes
- **Data Validation**: Tests verify training data pipeline integrity

This architecture ensures that the system maintains both reliability (through testing) and continuous improvement (through RL) without compromising either objective.

## 5. UML Sequence Diagrams

This section contains UML sequence diagrams that illustrate the interactions between different components of the multi-agent AI system. Each diagram focuses on a specific aspect of the system's functionality and provides detailed interaction views that complement the high-level architecture overview.

### 5.1 Available Diagrams

#### [Basic Message Flow](uml_diagrams/basic_message_flow.md)
Shows the basic message flow when a user sends a message to their agent and the system processes it through the orchestrator to determine the appropriate response.

**Key Components:**
- User A and User B
- PersonalAgent A and CareAgent B
- Orchestrator
- AI Analysis Handler
- Intent Handler
- Action Executor
- State Manager
- Database

#### [Conflict Resolution](uml_diagrams/conflict_resolution.md)
Illustrates the conflict detection and resolution process when users report contradictory information about the same topic.

**Key Components:**
- User A and User B
- PersonalAgent A and CareAgent B
- Orchestrator
- Fact Reporting Handler
- Conflict Handler
- Database

#### [Consent Management](uml_diagrams/consent_management.md)
Demonstrates the consent management process when users want to share information with others in their care circle.

**Key Components:**
- User A and User B
- PersonalAgent A and CareAgent B
- Orchestrator
- Sharing Handler
- Consent Manager
- State Manager
- Database

#### [Escalation Flow](uml_diagrams/escalation_flow.md)
Shows the escalation process when critical health events are detected and need immediate attention from healthcare providers and family members.

**Key Components:**
- User
- PersonalAgent
- Orchestrator
- Critical Events Handler
- Database
- Doctor
- Family Members
- Caregivers
- Dashboard

#### [Context Switching](uml_diagrams/context_switching.md)
Illustrates the context switching process when users move between different care circles, changing their agent identity and role context.

**Key Components:**
- User
- Current Agent and New Agent
- Command Handler
- State Manager
- Database

### 5.2 Diagram Conventions

#### Participant Types
- **👤 User**: Human users (patients, caregivers, family members)
- **🤖 Agent**: AI agents (PersonalAgent, CareAgent)
- **🎯 Orchestrator**: Central decision-making component
- **🧠 Handler**: Specialized handlers for specific functions
- **📊 Manager**: State and context management components
- **💾 Database**: Data storage and retrieval
- **👨‍⚕️ Doctor**: Healthcare providers
- **👥 Family**: Family members
- **📊 Dashboard**: Monitoring and tracking systems

#### Message Types
- **Solid Arrows**: Synchronous calls
- **Dashed Arrows**: Asynchronous responses
- **Parallel Blocks**: Concurrent operations
- **Alt Blocks**: Conditional flows
- **Notes**: Additional context and explanations

#### Color Coding
- **Blue**: User interactions
- **Green**: Successful operations
- **Red**: Error conditions
- **Orange**: Decision points
- **Purple**: State management
- **Yellow**: AI processing

### 5.3 Usage Guidelines

#### Reading the Diagrams
1. **Start from the top**: Follow the sequence from top to bottom
2. **Identify participants**: Understand who is involved in each interaction
3. **Follow the flow**: Track the message flow between components
4. **Note conditions**: Pay attention to alt blocks and conditional flows
5. **Understand context**: Read the accompanying explanations

#### Understanding Interactions
- **Synchronous**: Caller waits for response
- **Asynchronous**: Caller continues without waiting
- **Parallel**: Multiple operations happen simultaneously
- **Conditional**: Different paths based on conditions

#### System Architecture Integration
These diagrams complement the main architecture documentation by providing detailed interaction views. They show:
- **Component Relationships**: How components interact
- **Data Flow**: How information moves through the system
- **Decision Points**: Where the system makes choices
- **Error Handling**: How errors are managed
- **State Changes**: How system state evolves

### 5.4 Maintenance

#### Updating Diagrams
When system components change:
1. Update the relevant sequence diagram
2. Update the component descriptions
3. Update the integration notes
4. Test the diagram for accuracy

#### Adding New Diagrams
For new system features:
1. Create a new sequence diagram file in `uml_diagrams/`
2. Follow the established conventions
3. Include comprehensive explanations
4. Update this section with the new diagram reference

#### Version Control
- Diagrams are version controlled with the codebase
- Changes should be reviewed and tested
- Documentation should be kept in sync with implementation