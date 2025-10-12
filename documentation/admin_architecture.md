# Admin Architecture & Data Persistence

## Current Issues

1. **No Admin User**: Any user can access admin panel
2. **Hardcoded Scenarios**: Changes to scenarios.js require code deployment
3. **No Data Relationships**: Tabs don't show how feedback relates to conversations
4. **No Persistence**: Training/learning doesn't persist without code updates

---

## Proposed Architecture

### 1. Admin User System

**Database Schema:**
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'patient', -- 'patient', 'caregiver', 'doctor', 'admin'
    is_admin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Implementation:**
- Add `is_admin` flag to users table
- Check admin status before showing admin panel
- Admin can see all data, users see only their own
- First user created becomes admin automatically

---

### 2. Data Relationships & Tab Structure

**Concept:** Show how data flows through the system

```
Conversations → Feedback → Analysis
     ↓              ↓          ↓
Simulations  →  Scenarios  → Training
```

**Proposed Admin Tab Structure:**

#### **Tab 1: Conversations & Feedback**
- List all conversations (or user's own if not admin)
- Click conversation → Shows messages + feedback for that conversation
- **Link**: "Give Feedback" button on each message
- Shows simulation vs real conversations differently

#### **Tab 2: Scenarios & Training**
- List all scenarios (can edit/create new ones)
- Shows which scenarios have been run
- Shows feedback stats per scenario
- **UI to create/edit scenarios** (persists to DB, not code)

#### **Tab 3: Analysis**
- Aggregated metrics across all conversations
- Scenario performance comparison
- Prompt optimization suggestions

---

### 3. Persistent Scenarios (Database, Not Code)

**Problem:** scenarios.js is hardcoded - changes require deployment

**Solution:** Store scenarios in database

**Database Schema:**
```sql
CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,          -- e.g., 'cancer_treatment'
    name TEXT NOT NULL,                -- Display name
    description TEXT,
    category TEXT,                     -- 'basic', 'longitudinal', etc.
    complexity INTEGER,                -- 1-5
    multi_session BOOLEAN DEFAULT 0,
    sessions INTEGER DEFAULT 1,
    session_gap TEXT,                  -- 'week', 'month'
    instructions TEXT,                 -- AI instructions
    created_by TEXT,                   -- username who created it
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1        -- Can disable without deleting
);

CREATE TABLE scenario_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER,
    role TEXT,                         -- 'patient', 'caregiver', 'doctor'
    persona_key TEXT,
    relationship TEXT,
    consent TEXT,
    specialty TEXT,                    -- For doctors
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
);
```

**Flow:**
1. Admin creates scenario via UI
2. Saved to database
3. API loads scenarios from DB (not code)
4. Simulator reads from DB
5. Admin can edit/disable scenarios without code changes

---

### 4. Learned Prompts & Training Persistence

**Problem:** Prompt improvements don't persist

**Solution:** Version-controlled prompts in database

**Database Schema:**
```sql
CREATE TABLE prompt_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_type TEXT NOT NULL,         -- 'unified', 'doctor', 'intent', etc.
    version TEXT NOT NULL,             -- 'v1.0', 'v1.1', etc.
    content TEXT NOT NULL,             -- Actual prompt
    performance_score REAL,            -- Avg feedback score
    created_by TEXT,                   -- 'system' or username
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 0,       -- Only one active per type
    notes TEXT                         -- What changed and why
);

CREATE TABLE prompt_experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_version_id INTEGER,
    scenario_id INTEGER,
    avg_score REAL,
    total_runs INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
);
```

**Flow:**
1. System analyzes feedback
2. Generates prompt improvement suggestions
3. Admin reviews and creates new prompt version
4. New version tested against scenarios
5. If performance improves, make it active
6. Old versions kept for rollback

---

### 5. Implementation Plan

#### **Phase 1: Admin Users (Quick)**
- [x] Rename "View Feedback" → "Admin"
- [ ] Add `is_admin` column to users table
- [ ] Check admin status before showing admin panel
- [ ] Filter data by user (admin sees all, users see own)

#### **Phase 2: Data Relationships**
- [x] Fix conversation click (show full data)
- [ ] Add "Give Feedback" button in conversation details
- [ ] Link feedback to specific conversations
- [ ] Show conversation logs alongside feedback

#### **Phase 3: Scenario Management UI**
- [ ] Create "Scenarios" tab in admin
- [ ] List all scenarios from DB
- [ ] Form to create/edit scenarios
- [ ] JSON editor for complex scenarios
- [ ] Enable/disable scenarios without deletion

#### **Phase 4: Database Migration**
- [ ] Create scenarios table
- [ ] Create scenario_users table
- [ ] Migration script: code → DB
- [ ] Update API to load from DB
- [ ] Update simulator to use DB scenarios

#### **Phase 5: Prompt Management**
- [ ] Create prompt_versions table
- [ ] Create prompt_experiments table
- [ ] UI to view/create prompt versions
- [ ] A/B testing between prompt versions
- [ ] Automatic performance tracking

---

### 6. UI Mockup: Scenario Editor

```
┌─────────────────────────────────────┐
│ Create New Scenario                  │
├─────────────────────────────────────┤
│ Name: [Cancer Treatment Multi-Month] │
│ Key:  [cancer_treatment_________]    │
│ Category: [Longitudinal ▼]           │
│ Complexity: ⭐⭐⭐⭐⭐ (5)            │
│                                      │
│ Multi-Session: [✓]                  │
│ Sessions: [6]  Gap: [month ▼]       │
│                                      │
│ Users:                               │
│ ┌────────────────────────────────┐ │
│ │ 1. Patient                      │ │
│ │    Persona: [recently_diagnosed]│ │
│ │                                 │ │
│ │ 2. Caregiver                    │ │
│ │    Persona: [engaged_caregiver] │ │
│ │    Relationship: [spouse]       │ │
│ │    Consent: [full ▼]           │ │
│ │                                 │ │
│ │ 3. Doctor                       │ │
│ │    Persona: [empathetic_doctor] │ │
│ │    Specialty: [Oncology]        │ │
│ │                                 │ │
│ │ [+ Add User]                    │ │
│ └────────────────────────────────┘ │
│                                      │
│ Instructions:                        │
│ ┌────────────────────────────────┐ │
│ │ Session 1: Initial diagnosis... │ │
│ │ Session 2: Treatment effects... │ │
│ └────────────────────────────────┘ │
│                                      │
│ [Save Scenario] [Cancel]            │
└─────────────────────────────────────┘
```

---

### 7. Benefits

**Persistence:**
- Scenarios survive code deployments
- Prompt improvements accumulate over time
- Training data never lost

**Flexibility:**
- Admin can test new scenarios without coding
- Quick iteration on scenario design
- A/B test different prompts

**Visibility:**
- Clear data relationships
- Track which scenarios perform best
- See feedback impact on prompt evolution

**Security:**
- Admin-only access to sensitive data
- Users only see their own conversations
- Audit trail of who changed what

---

## Next Steps

1. Add admin user flag
2. Fix tab data relationships
3. Create scenario management UI
4. Migrate scenarios to database
5. Add prompt version management

This architecture ensures **persistence without code changes** and makes the **training loop self-improving**.

