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

### Notifications & Communication (New) 📢
- [ ] **Notification Layer**: Abstract service for handling multiple channels.
- [ ] **WhatsApp Integration**:
    - [ ] Support Twilio Provider.
    - [ ] Support AISensy Provider.
    - [ ] Template Message Management.
- [ ] **User Configuration**: Allow users to set preferences and provider settings.
- [ ] **Push Notifications**: Mobile/Web push integration.
- [ ] **Testing**: Comprehensive test cases for providers and layers.

### Data & State Architecture (Refinements) 🧠
- [ ] **Enhanced User Profiles**: Extend `users` table for preferences and demographics.
- [ ] **Structured Fact Storage**:
    - [ ] **Bi-Temporal Tracking**: Capture `reported_at` (transaction time) vs `valid_at` (event time).
    - [ ] **Veracity & Subjectivity**: Track confidence, source type (self-report vs external), and sentiment evolution.
    - [ ] **Source Attribution**: Track `reported_by` (User/Agent) and `provenance` (Original Message ID).
    - [ ] **Privacy & Access Policy**: Define visibility level (Circle-Wide, Private-to-Doctor, Patient-Only).
    - [ ] **Importance Scoring**: Weight facts by clinical/contextual significance.
    - [ ] **EMR & Document Storage**:
        - [ ] Secure file storage (S3/Blob + Encryption).
        - [ ] Metadata indexing (Patient ID, Date, Doctype).
    - [ ] Support complex objects/JSON storage.

### Security & Deployment 🛡️
- [ ] **Security Audit**:
    - [ ] Input Validation & Sanitization (XSS/SQLi)
    - [ ] API Rate Limiting
    - [ ] Dependency Vulnerability Check
- [ ] **Deployment**:
    - [ ] Production Database Configuration
    - [ ] Logging & Monitoring Setup
    - [ ] 6.5: Data & Storage
        - [ ] Connect EMR Storage (S3/Blob)
        - [ ] Implement Document Indexing
    - [ ] **Infrastructure Refinement**:
        - [ ] Ensure Production/Simulation Database Isolation (avoid locking).

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

## Future Roadmap (Phase 8+) 🚀

### Advanced Reinforcement Learning
- [ ] **Contextual Bandits / Actor-Critic**:
    - [ ] Move beyond simple MAB to state-aware RL.
    - [ ] **Simulated Critic Pre-training**: Train Value Function on millions of simulated turns.
- [ ] **Agent Configuration Optimizer**:
    - [ ] Optimize Model Selection (GPT-4 vs Gemini vs Local).
    - [ ] Optimize Hyperparameters (Temp, Top-P).
    - [ ] Wraps existing Prompt Optimizer.
- [ ] **Model Selection Layer**: Dynamic routing based on task complexity and cost.

### Data Privacy & Anonymization
- [ ] **PII Redaction Pipeline**:
    - [ ] NER-based entity detection (Names, Dates, Locations).
    - [ ] Token replacement (e.g., `[NAME]`, `[PHONE]`).
    - [ ] **Hashing**: Salted hashes for tracking User IDs securely.
- [ ] **Synthetic Data Augmentation**: Generate privacy-safe variants of real logs.

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
- **Simulation**:
    - [ ] **Scenario Builder**: Auto-generate test scenarios (Personas × Situations).
    - [ ] **World Scenarios**: Integrate multi-agent world scenarios into standard training loop.
- **Meta-Learning**: 
    - [ ] **Granular Feedback Analysis**: Add context-aware, specific failure categorization (not just good/bad).
    - Feedback analysis, prompt optimization agents.
- **A/B Testing**: Thompson Sampling framework for prompt selection.