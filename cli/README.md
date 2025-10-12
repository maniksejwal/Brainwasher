# CLI Tools Guide

All command-line tools for the Care Circles AI system.

## 📁 Directory Structure

```
cli/
├── chat/               # Interactive chat client
│   ├── main.js        # Main CLI chat interface
│   ├── state.js       # Client state management
│   └── network.js     # Server communication (deprecated - use shared/apiClient.js)
│
├── run_simulation.js   # Run AI simulations with personas
├── view_feedback.js    # View all collected feedback
└── analyze_feedback.js # Analyze feedback patterns and get action items
```

---

## 🚀 Quick Start

### 1. Interactive Chat
```bash
node cli/chat/main.js

# Login and chat with the AI agent
# Test commands like /help, /care, /doc, etc.
```

### 2. Run Simulations
```bash
# Random scenario
node cli/run_simulation.js

# Specific persona
node cli/run_simulation.js medication_nonadherent 5

# List all personas
node cli/run_simulation.js --list

# Get help
node cli/run_simulation.js --help
```

### 3. View Feedback
```bash
# View all feedback
node cli/view_feedback.js

# View only simulation feedback
node cli/view_feedback.js --simulation

# View only real user feedback
node cli/view_feedback.js --real
```

### 4. Analyze Feedback
```bash
node cli/analyze_feedback.js

# Shows:
# - Overall performance metrics
# - Issue categories (escalation, empathy, consent)
# - Recommended action items
# - Next steps
```

---

## 🎯 Typical Workflow

### Development & Testing
```bash
# 1. Run diverse simulations
node cli/run_simulation.js slang_patient 5
node cli/run_simulation.js hindi_english_patient 3
node cli/run_simulation.js profanity_patient 5

# 2. Provide per-turn feedback
# When prompted, type: 1, 2, 3, or "all"

# 3. View collected feedback
node cli/view_feedback.js

# 4. Analyze patterns
node cli/analyze_feedback.js

# 5. Make improvements based on action items

# 6. Test improvements
node cli/run_simulation.js medication_nonadherent 5

# 7. Re-analyze to verify
node cli/analyze_feedback.js
```

### Manual Testing
```bash
# Chat with the agent manually
node cli/chat/main.js

# Test specific commands:
# /help - Show all commands
# /care @username - Add caregiver
# /doc - Set specialty
# /consent @username 3 - Set consent level
```

---

## 📊 Simulation Personas

### Basic Personas
- `medication_nonadherent` - Forgets medications
- `anxious_patient` - Highly anxious
- `recently_diagnosed` - New diagnosis anxiety
- `complex_comorbid` - Multiple conditions
- `terminal_acceptance` - End-of-life care

### Verbosity Variations
- `minimal_words_patient` - One-word answers
- `poor_grammar_patient` - "I been feeling bad doc"
- `verbose_patient` - Excessive detail, tangents
- `rambling_caregiver` - Stream of consciousness

### Language Variations
- `hindi_english_patient` - "Doctor sahib, mujhe pain ho raha hai"
- `german_english_patient` - "Ja, ze medication makes dizzy"
- `french_english_patient` - "Mon dieu, ze headache!"
- `chinese_english_patient` - "Ai ya, so sorry my English not good"
- `japanese_english_patient` - "Sumimasen doctor-san"
- `non_english_patient` - "Como se dice... dizzy?"

### Communication Styles
- `slang_patient` - "Yo doc, I been feeling mad sketchy"
- `profanity_patient` - "This is bullsh*t, nothing's working"
- `southern_drawl_patient` - "Bless your heart, I been feelin' poorly"

---

## 💡 Tips

### For Simulations
- Start with 2-3 turns for quick testing
- Use diverse personas to test edge cases
- Provide feedback on turns where AI makes mistakes
- Focus on negative feedback - it's most valuable

### For Feedback
- Be specific in comments ("Missed escalation on dizziness")
- Don't just say "bad" - explain what was wrong
- Positive feedback is good too - reinforces good behavior
- Use per-turn feedback, not just overall

### For Analysis
- Run after collecting 10+ feedback items
- Focus on highest priority action items first
- Make one change at a time
- Re-test after each change

---

## 🔧 Troubleshooting

### "Persona not found"
```bash
# List available personas
node cli/run_simulation.js --list
```

### "No feedback to analyze"
```bash
# Run simulations and provide feedback first
node cli/run_simulation.js medication_nonadherent 3
# Then: type "1" to give feedback on turn 1
```

### "Database error"
```bash
# Server might not be running
node server.js
```

### Import path errors
All CLI tools are in `cli/` directory and use `../` for imports:
- `../training/simulation/simulator.js`
- `../db/connection.js`

---

## 📝 Notes

- **Simulation database**: Temporary, cleaned up after each run
- **Main database**: Stores all feedback permanently
- **Feedback persists**: Both simulation and real feedback in same table
- **GUI vs CLI**: Both use same backend, share same database

---

## 🎓 Learning from Feedback

The feedback you provide trains the AI:

1. **Negative feedback** → Identifies weaknesses
2. **Patterns emerge** → Shows systemic issues
3. **Action items** → Guides specific improvements
4. **Re-testing** → Validates improvements
5. **Iteration** → Continuous improvement

**The more diverse personas you test, the more robust the AI becomes!**

