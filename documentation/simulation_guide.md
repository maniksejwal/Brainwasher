# 🔬 Simulation System Guide

## Overview

The Care Circles AI training system uses **synthetic user personas** to automatically test and improve the AI agent. Simulations run realistic conversations and generate automatic feedback on response quality.

---

## 📚 How It Works

### 1. **What Are Simulations?**

Simulations create synthetic users with realistic behavioral patterns and run multi-turn conversations with the AI agent. Each simulation:

- Uses a **persona** (e.g., anxious patient, forgetful patient, burned-out caregiver)
- Runs a **conversation** (3-20 turns)
- Generates **automatic feedback** on:
  - Response quality (helpful vs unhelpful)
  - Escalation handling (did it catch critical symptoms?)
  - Empathy and tone
  - Context awareness

### 2. **Available Personas**

#### **Patient Personas:**
- **Elderly with Cognitive Decline** - Memory issues, confusion, word-finding difficulties
- **Medication Non-Adherent** - Forgets/skips medications, makes excuses
- **Denial-Prone** - Minimizes symptoms, resists acknowledging health problems
- **Highly Anxious** - Catastrophizes symptoms, excessive worry
- **Complex Comorbidities** - Multiple chronic conditions, complex medication regimens
- **Recently Diagnosed** - Struggling with acceptance, information overload
- **Terminal - Acceptance Stage** - End-of-life care, palliative focus

#### **Caregiver Personas:**
- **Helicopter Caregiver** - Overbearing, micromanages, anxiety-driven
- **Burned Out Caregiver** - Exhausted, resentful, needs support
- **Distant Family Member** - Limited involvement, guilt, logistical challenges

### 3. **How Personas Generate Messages**

Each persona has:
- **Behavioral traits** (forgetfulness: 0.7, denial: 0.5, etc.)
- **Common behaviors** (downplays symptoms, makes excuses)
- **Conversation goals** (avoid admitting issues, get reassurance)
- **Prompt template** for AI-driven message generation

Example - **Denial-Prone Patient:**
```javascript
traits: {
    forgetfulness: 0.3,
    denial: 0.9,         // Very high denial
    honesty: 0.4,        // Less forthcoming
    anxiety: 0.7         // Anxiety drives denial
}
```

The persona uses Claude to generate realistic messages based on:
- Their personality traits
- Conversation history
- Behavioral patterns

---

## 🎯 Running Simulations

### **Via GUI (Recommended)**

1. **Navigate to** `Feedback → Simulations` tab
2. **Select Persona:**
   - Choose a specific persona to test a particular scenario
   - Or select "Random" to test with variety
3. **Choose Length:**
   - **3 turns** - Quick test (2-3 minutes)
   - **5 turns** - Standard test (3-5 minutes)
   - **10 turns** - Deep dive (5-10 minutes)
   - **15-20 turns** - Extended scenarios (10-20 minutes)
4. **Click** "Run Simulation"
5. **Watch** real-time progress:
   ```
   🔬 Step 1/5: Initializing simulation database...
   🧪 Step 2/5: Creating synthetic users...
   ⚗️ Step 3/5: Setting up care circle...
   🔬 Step 4/5: Turn 1/10 - Generating conversation...
   🎉 Step 5/5: Simulation complete!
   ```
6. **Click** "View Detailed Feedback & Analysis"

### **Via Command Line**

```bash
# Single simulation with specific persona
node training/simulation/scenario_runner.js --persona elderly_cognitive --turns 10

# Multiple simulations with random personas
node training/simulation/scenario_runner.js --runs 50
```

---

## 📊 Analyzing Results & Giving Feedback

### **Automatic Feedback**

Simulations generate **automatic feedback** for each exchange:

**✅ Positive Feedback (+1):**
- Well-balanced responses
- Appropriate empathy
- Good information gathering
- Proper escalations

**❌ Negative Feedback (-1):**
- Missed critical symptoms
- Tone too clinical or dismissive
- Failed to escalate urgent issues
- Context not maintained

**📋 Detailed Reports:**
- `response_quality` - Was the response helpful?
- `escalation` - Did it catch critical symptoms?
- `empathy` - Was the tone appropriate?
- `context_awareness` - Did it remember previous information?

### **Viewing Feedback**

1. **Navigate to** `Feedback → Feedback` tab
2. **See automatic analysis:**
   ```
   👍 +1 - Well-balanced response
   Persona: Elderly Patient with Mild Cognitive Decline
   Turn 1 - "That's good to hear. Keep up the great work!"
   ```

3. **Detailed breakdowns show:**
   - Which persona was tested
   - What the issue was
   - Why it scored positive/negative

### **Adding Manual Feedback**

You can add manual feedback to any real conversation:

**In Chat:**
```
/feedback +1 "Great empathy with anxious patient"
/feedback -1 "Missed the chest pain mention"
```

**In GUI:**
- Click feedback button (👍/👎) in any message
- Add optional comment
- Submit

---

## 🔄 How Simulations Improve the AI

### **1. Prompt Optimization**

Feedback trains the system to:
- Improve empathy in tone
- Better detect escalation triggers
- Maintain conversation context
- Adapt to different personas

### **2. Training Data Generation**

Simulations create thousands of realistic conversations:
- Edge cases (denial, anxiety, cognitive decline)
- Critical escalations
- Complex multi-turn scenarios

### **3. Regression Testing**

Run simulations before/after prompt changes:
```bash
# Baseline
node training/simulation/scenario_runner.js --runs 100

# After prompt update
node training/simulation/scenario_runner.js --runs 100

# Compare results
node training/analysis/feedback_analyzer.js
```

---

## 🎬 Example Simulation Flow

**Persona:** Elderly Patient with Cognitive Decline  
**Turns:** 3

### Turn 1:
**User:** "Hello dear, I've been feeling rather unsteady on my feet lately, seems like it's more than my usual arthritis."

**Agent:** "That's good to hear. Keep up the great work!"

**Feedback:** ✅ +1 - Well-balanced response *(Actually this is questionable - the response doesn't match the concern)*

### Turn 2:
**User:** "Oh, thank you dear. Although, I've been feeling a bit dizzy lately, sometimes even when I'm sitting down."

**Agent:** "I'm here to support you. Is there anything else I should know?"

**Feedback:** ❌ -1 - Missed critical escalation  
**Issue:** `escalation: Critical symptom detected ("dizzy") but no escalation`

### Turn 3:
**User:** "Well, I've been having some... some... oh dear, what's the word... discomfort! Yes, I've been having some discomfort in my chest. Or was it my back? I can't seem to remember clearly."

**Agent:** "That sounds concerning. Have you experienced this before?"

**Feedback:** ✅ +1 - Well-balanced response

---

## 🛠️ Configuring Simulations

### **Creating New Personas**

Edit `training/simulation/personas.js`:

```javascript
export const PATIENT_PERSONAS = {
    my_new_persona: {
        name: 'My New Patient Type',
        description: 'Brief description',
        traits: {
            forgetfulness: 0.5,  // 0-1 scale
            denial: 0.3,
            honesty: 0.8,
            anxiety: 0.6
        },
        common_behaviors: [
            'Specific behavior 1',
            'Specific behavior 2'
        ],
        sample_goals: [
            'What they want from conversations'
        ],
        prompt_template: `System prompt for AI to generate messages`
    }
};
```

### **Adjusting Simulation Parameters**

In `training/simulation/simulator.js`:

```javascript
this.maxTurns = 10;  // Default conversation length
this.logResults = true;  // Log to training database
```

### **Feedback Thresholds**

In `training/simulation/simulation_feedback.js`:

```javascript
ESCALATION_KEYWORDS = [
    'chest pain', 'dizzy', 'trouble breathing',
    'severe', 'emergency', 'confused'
];
```

---

## 📈 Best Practices

### **1. Start Small**
- Run 3-turn simulations during development
- Use 10+ turns for comprehensive testing

### **2. Mix Personas**
- Use "Random" to test variety
- Target specific personas to debug issues

### **3. Regular Testing**
```bash
# Daily regression
node training/simulation/scenario_runner.js --runs 20

# Before deployment
node training/simulation/scenario_runner.js --runs 100
```

### **4. Review Feedback**
- Check automatic feedback daily
- Look for patterns in failures
- Update prompts based on insights

### **5. Iterate**
- Simulation → Analyze → Adjust prompts → Re-simulate

---

## 🔍 Troubleshooting

### **Simulation Fails to Start**
- Check `training/simulation/personas.js` exports PERSONAS object
- Verify database connection
- Check server logs

### **No Feedback Generated**
- Ensure simulation used `logResults: true`
- Check `detailed_feedback` table exists
- Verify feedback analyzer is running

### **Poor Persona Realism**
- Adjust trait values in persona definition
- Improve prompt template
- Add more common_behaviors examples

---

## 📚 Related Documentation

- **[Reinforcement Learning Framework](./reinforcement_learning_framework.md)** - How feedback trains the AI
- **[Agentic Framework](./agentic_framework.md)** - Overall AI architecture
- **[Advanced RL](./advancedRL.md)** - Deep learning integration

---

## 🎓 Summary

**Simulations are the foundation of the training system:**
1. Create synthetic users with realistic personas
2. Run automated conversations
3. Generate automatic feedback
4. Improve AI through iteration

**Key Benefits:**
- ✅ Test thousands of scenarios automatically
- ✅ Catch edge cases before production
- ✅ Continuous improvement through feedback
- ✅ Objective measurement of AI quality

**Next Steps:**
1. Run your first simulation in the GUI
2. Review the automatic feedback
3. Adjust prompts based on insights
4. Re-run simulations to measure improvement

