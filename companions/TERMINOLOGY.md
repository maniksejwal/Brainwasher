# Companion System Terminology

## Core Terms

- **Companion**: A group of coordinators, agents, and handlers that work together for a specific user
  - Each user has their own Companion instance
  - Companions serve their user (they are "slaves to the user")
  - A Companion = Coordinators + Agents + Handlers
  
- **Coordinator**: Coordinates multiple components and makes final decisions
  - Example: `CompanionCoordinator` - coordinates all Companion components
  
- **Agent**: A decision-making AI that makes specific decisions
  - Examples: `clinicalAgent`, `escalationManager`, `patientOptimizer`, `doctorOptimizer`
  
- **Handler**: A specialized component that processes specific aspects
  - Examples: `inputUnderstanding`, `historyAnalyzer`, `empathyHandler`, `privacyGuard`

## Architecture Hierarchy

```
User
  └── Companion (coordinators + agents + handlers for this user)
       ├── CompanionCoordinator (coordinator - coordinates everything)
       ├── Handlers (processors)
       │   ├── inputUnderstanding
       │   ├── historyAnalyzer
       │   ├── empathyHandler
       │   └── privacyGuard
       └── Agents (decision-makers)
           ├── clinicalAgent
           ├── escalationManager
           ├── patientOptimizer
           └── doctorOptimizer
```

## Decision Flow

1. User message arrives
2. **CompanionCoordinator** activates relevant handlers and agents
3. Each **Handler/Agent** processes its aspect
4. **CompanionCoordinator** aggregates and makes final decision
5. Response sent to user

## Important Notes

- **Orchestrator**: Central and impersonal (NOT part of Companion)
- **Companion**: Personal to the user (coordinators + agents + handlers together)
- **CompanionCoordinator**: Client-side coordinator, NOT an orchestrator

