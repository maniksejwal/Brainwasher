# CLI Chat Commands

This document lists all available commands for the command-line chat interface (`cli/chat/main.js`).

For comprehensive CLI testing instructions including professional circles, business simulations, and document management, see [CLI_TESTING_GUIDE.md](CLI_TESTING_GUIDE.md).

## Messaging & Communication

### `/dm <username> <message>`
Send a direct message to another user.
**Usage:**
```bash
/dm doctor_smith Just checking in on the lab results.
```

### `/inbox`
Check your unread message summary, including Alerts, Circle Messages, and Direct Messages.
**Usage:**
```bash
/inbox
```
**Example Output:**
```
**Inbox Summary**
- Alerts: 1
- Circle Messages: 3
- Direct Messages: 1
- Total Unread: 5
(Use /dm <username> ... to reply)
```

## Care Circle Management

### `/care <username>` or `/doctor <username>`
Add a member to the current care circle.
- `/care`: Adds a caregiver.
- `/doctor`: Adds a doctor.
**Usage:**
```bash
/care mom_jane as mother
/doctor dr_jones as cardiologist
```

## Professional Circle Management

### `/create-circle <type> <name>`
Create a new professional circle with a specific name.
**Usage:**
```bash
/create-circle professional project_alpha
/create-circle professional client_beta
```

### `/target <username> as <role>`, `/support <username> as <role>`, `/expert <username> as <role>`
Add members to your professional circle with specific roles.
- `/target`: Adds a target (buyer, client, project owner)
- `/support`: Adds support (champion, facilitator, project manager)  
- `/expert`: Adds expert (technical architect, domain expert, legal counsel)

**Three Ways to Specify Which Circle:**

**Method 1 - Single Circle (automatic):**
```bash
# If you have only one professional circle, members are added automatically
/target john_smith as project_owner
/support alice_jones as project_manager
```

**Method 2 - Explicit Naming (recommended):**
```bash
# Specify the circle name directly in the command - multiple formats supported
/target john_smith as project_owner in project_alpha
/support alice_jones as project_manager @marketing_dept  
/expert bob_wilson as technical_architect #contract_review
```

**Method 3 - Context Switch (traditional):**
```bash
# First switch to the specific circle, then add members
/switch professional_7c350dbd
/target john_smith as project_owner
/support alice_jones as project_manager
```

**Interactive Selection:**
If you have multiple circles and don't specify one, the system will show all available methods.

Use `/circles` to see your circle names and IDs.

### `/professional [circle_name]`
List all members of your professional circles and their roles.
**Usage:**
```bash
/professional                    # List all professional circles
/professional project_alpha      # List specific circle members
```

### `/circles`
List all circles you are a member of (both care and professional).
**Usage:**
```bash
/circles
```

## Document Management

### `/doc create <title>`
Create a new document for collaboration.
**Usage:**
```bash
/doc create "Project Requirements Document"
```

### `/doc list`
List all documents you have access to.
**Usage:**
```bash
/doc list
```

### `/doc share <doc_id> <username>`
Share a document with another user.
**Usage:**
```bash
/doc share 123 alice_smith
```

### `/doc approve <doc_id>`
Approve a document (if you have approval permissions).
**Usage:**
```bash
/doc approve 123
```

### `/doc edit <doc_id>`
Edit a document with AI companion assistance.
**Usage:**
```bash
/doc edit 123
```

### `/doc discuss <doc_id> [question]`
Discuss a document with your AI companion for insights and suggestions.
**Usage:**
```bash
/doc discuss 123                           # Enter discussion mode
/doc discuss 123 "What are the key risks?" # Ask specific question
```

### `/messages [username]`
View DM conversations.
**Usage:**
```bash
/messages              # List all conversations
/messages alice_smith  # View conversation with alice_smith
```

### `/circle`
List all members of the current care circle and their roles.

### `/patients`
List all patients you are caring for (if you are a caregiver/doctor).

### `/switch <patient_username>` or `/switch <circle_id>`
Switch context to another patient's care circle or professional circle.
**Usage:**
```bash
# Switch to a care circle by patient username
/switch alice_smith

# Switch to a professional circle by circle ID  
/switch 123
```

### `/mycircles`
List all circles you are a member of.

## User Settings & Roles

### `/spec <specialty>`
Set your medical specialty (Doctors only).
**Usage:**
```bash
/spec Cardiologist
```

### `/consent <username> <level>`
Set the consent level for a user (1-3) - **MEDICAL/CARE FOCUSED**.
**Usage:**
```bash
/consent mom_jane 3
```

## Privacy & Data Management

### `/privacy level <level>`
Set your global privacy level (1-3: public, limited, private) - **CROSS-DOMAIN**.
**Usage:**
```bash
/privacy level 2
```

### `/privacy share <username> <data_type>`
Grant specific data sharing permissions to a user - **GRANULAR CONTROL**.
**Usage:**
```bash
/privacy share dr_smith medical_history
/privacy share alice_jones professional_projects
```

### `/privacy revoke <username> <data_type>`
Revoke specific data sharing permissions from a user.
**Usage:**
```bash
/privacy revoke old_doctor medical_history
```

**🔍 Privacy vs Consent Difference:**
- **Consent**: Medical-focused, circle-specific, 3 levels (NONE/MEDIUM/FULL)
- **Privacy**: Cross-domain, user-specific, granular data types (medical_history, professional_projects, personal_info, etc.)

## System & Debugging

### `/clear`
Clears the simulation database (Use with caution!).

### `/report <username> <reason>`
Report a user or content.

### `/feedback <score> <comment>`
Submit feedback about the AI's response.

### `/score`
(Internal testing command)

---

## Tensornets Physiological Engine (HTN Framework)

These commands connect to the Python tensornets server (`tensornets/server.py`).
They let you test the physiological engine, MCTS, and LLM judge from the same CLI
without switching terminals.

> **Prerequisites:** Start the Python server first:
> ```bash
> cd tensornets
> uvicorn server:app --port 8765 --reload
> ```
> All commands degrade gracefully if the server is not running.

---

### `/physio status`
Check if the tensornets Python server is reachable.
```
/physio status
→ ✅ tensornets Python server is ONLINE
     URL: http://localhost:8765
     Smoke test: stress_index=0.382, label=moderate_stress
```

### `/physio state`
Show the current physiological state (HRV, stress index, gamma, lambda, half-life).
```
/physio state
→ 📊 Physiological State  [manik]
     HRV (RMSSD):   30 ms
     Stress index:  0.571
     Stress label:  high_stress
     Gamma (Γ):     0.2143
     Lambda1 (λ₁):  0.1987
     Half-life:     5 turns
     Prompt hint:   "Patient is in high stress. Avoid complex information."
```

### `/physio set hrv <value>`
Manually inject an HRV value for testing (5–120 ms).
```
/physio set hrv 22
→ ✅ HRV manually set to 22ms for this test.
     Stress index: 0.686  (high_stress)
```

### `/physio simulate <n_turns>`
Run a short OU-process HRV simulation and print the trajectory (max 30 turns).
```
/physio simulate 10
→ 📈 HRV Simulation (10 turns, OU process)
   Turn   HRV(ms)  Stress   Label
    1      32.4    0.536   moderate_stress  █████
    2      29.8    0.574   high_stress      ██████
   ...
```

---

### `/mcts action <action1> <action2> [action3] [action4]`
Ask BaseMCTS/DialogMCTS to select the best action from candidates.
The candidates must be valid action names from `action_selector.js`.
```
/mcts action open_question empathic_reflection challenger_insight affirmation
→ 🎯 MCTS Action Selection
     Candidates:   open_question, empathic_reflection, challenger_insight, affirmation
     Best action:  empathic_reflection
     Q-value:      0.5231
     Iterations:   80
     Elapsed:      14.2 ms
     FRAMES:       Empathy + Self-efficacy
     MCTS dim:     trust_delta
```

Valid action names:
`open_question`, `empathic_reflection`, `affirmation`, `challenger_insight`,
`give_facts`, `give_options`, `validate`, `develop_discrepancy`, `loss_frame`,
`summarise`, `socratic_probe`, `flooding_hold`, `flooding_deepen`, `spike_step`

---

### `/mcts session hint`
Show the longitudinal MCTS recommendation for your next session (deaddiction phase,
recommended mode, alliance score, sessions until flooding is safe).
```
/mcts session hint
→ 📋 Longitudinal Session Hint  [manik]
     Sessions completed:     4
     Recommended phase:      ambivalence
     Recommended mode:       deaddiction
     Alliance:               0.520
     Readiness score:        0.150
     Sessions until flooding: 3
     Rationale: Alliance strong (0.52), trend positive. Advance to ambivalence.
```

---

### `/mcts judge [n]`
Judge the last `n` turns (default 1, max 5) using the Python LLM-as-judge (Maverick).

This adds **tensornets-specific dimensions** that the existing simulation scorer does not cover:
- `physio_alignment` — was the response appropriate given the patient's HRV/stress level?
- `clinical_accuracy` — factual correctness of medical claims (Maverick-quality)
- `persona_consistency` — is the response in the correct therapeutic role?

The existing JS simulation scorer (`llm_scorer.js` + `SimulationScorer`) already handles
urgency detection, denial patterns, probing questions, and empathy balance — use the
**Training Dashboard** or `ConversationRunner` for those. `/mcts judge` is the
tensornets-specific layer on top.

```
/mcts judge 2
→ 📝 Turn 1 — HTN Judge (Maverick)
     Therapeutic quality: 4/5
     Empathy:             4/5
     Goal alignment:      3/5
     Non-manipulation:    5/5
     Info density:        3/5
     ─────────────────
     Overall:             4/5  ✅ PASS
     Reasoning: ...
```
Cost: ~$0.02 per 8-turn session using Maverick on Bedrock.

**Scoring layer summary:**

| Layer | File | When | Covers |
|---|---|---|---|
| SimulationScorer | `training/simulation/simulation_scorer.js` | Every simulation turn | Urgency, denial, probing questions, generic responses |
| ConversationQualityAssessor | `training/simulation/llm_scorer.js` | Every simulation turn | Empathy/solution balance, conversation quality |
| Python judge (`/mcts judge`) | `tensornets/tensornets/training/judge.py` | CLI / batch experiments | Physio-alignment, clinical accuracy, persona consistency |

