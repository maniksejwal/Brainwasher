Multi-Agent System - Project Roadmap & TODO

This document tracks the development progress and future plans for the multi-agent system prototype.

## 🚨 Critical Priority: First Epoch Completion

The system is currently pre-optimization ("Cold Start"). The goal is to reach the **First Optimization Epoch**:
- [x] Fix conversation counting (Now sees 1000+ conversations)
- [x] Integrate Outcome Labels (RLHF)
- [x] Enable Human Feedback GUI
- [ ] **Run Training Pipeline**: Execute `node cli/train.js run` to complete the first full optimization cycle.
- [ ] **Deploy First Optimized Prompt**: Move winning prompt to production.

---

## Up Next

### RBAC Implementation (In Progress) 🔐
- [x] Database schema (`system_roles`, `sessions`)
- [x] Authentication middleware (minimal, with forward compatibility)
- [x] Login/logout endpoints
- [x] Password hashing (Simulated/Placeholder)
- [x] Frontend Login UI
- [ ] Admin UI (User Management)
- [ ] CLI Login Tool

### Advanced Agent Capabilities
- [ ] Multi-Question Pending Action Stack (v2)
- [ ] Self-Reference Resolution

---

## Completed Features ✅

### Training & Learning Infrastructure (Jan 2026)
- **Feedback GUI**: Human feedback modal in simulation logs.
- **RLHF Integration**: Implicit rewards (outcome labels) used in training.
- **Conversation Count Fix**: Pipeline correctly reads `training_log.jsonl`.
- **Database Architecture**: Split into Main DB (production) and Simulation DB (testing).
- **Rich Data Logging**: Capture "Chain of Thought" (reasoning) and outcome labels.
- **Poison Filter**: Error detection and filtering for training data.

### Core Capabilities
- **Advanced Agent**: Conversational Intent Analysis, Entity Resolution.
- **Context Management**: Implied Context Switching (v2), Context Enrichment.
- **Care Circles**: Reciprocal care circles infrastructure and consent model.
- **Doctor's Agent**: Specialized interaction model and tools.

### Infrastructure
- **Simulation**: Synthetic user generation, scenario runner.
- **Meta-Learning**: Feedback analysis, prompt optimization agents.
- **A/B Testing**: Thompson Sampling framework for prompt selection.