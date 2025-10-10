# Doctor Workflow Guide

## How to Become a Doctor in the System

### Step 1: Get Added to a Patient's Circle

A patient can add you in two ways:
```
Patient A: /doc C
System: Added 'C' to your care circle as a 'doctor'.
```

Or with specialty specified:
```
Patient A: /doc C as Cardiology
System: Added 'C' to your care circle as a 'doctor' (Cardiology).
```

**Note:** 
- Specialty is optional when being added
- If not specified during addition, you must set it later with `/spec`
- This is different from caregivers who require relationships (mother, spouse, etc.)

### Step 2: Switch to Patient's Circle

```
Doctor C: /switch A
System: Switched to A's circle (you are: doctor)
```

Your browser tab will update: `C (doctor) - Care Circles`

### Step 3: Set Your Specialty (if not already set)

**IMPORTANT:** You must have a specialty to unlock doctor-specific commands!

If the patient didn't specify your specialty when adding you:
```
Doctor C: /spec Cardiology
System: Your role in this circle has been updated to 'doctor'.
System: Specialty set to: Cardiology
```

If already set during addition, you can skip this step or use `/spec` to change it.

**Now you can use doctor commands!**

---

## Doctor-Specific Commands

### Available After Setting Specialty

#### 1. Log Confidential Notes
```
/log "Patient reports chest pain on exertion"
System: Confidential note logged successfully
```

#### 2. Log Orders
```
/order "ECG and cardiac enzymes stat"
System: Order logged successfully
```

#### 3. Delegate Questions to Patient's Agent
```
/agent ask patient "medication adherence"
System: Your agent will ask the patient about medication adherence
```

Can also ask specific caregivers:
```
/agent ask caregiver "patient's recent symptoms"
/agent ask mom "has patient been eating regularly?"
```

---

## GUI Workflow for Doctors

### Via Add Member Modal

When patient adds you:
1. Patient clicks "Add Member" in Circle view
2. Patient clicks "Add Doctor"
3. Patient enters your username
4. Patient clicks "Add"
5. Command sent: `/doc your_username`

**No relationship asked** - it's automatic!

### Setting Specialty in GUI

Currently need to use chat:
```
Type in message box: /spec Cardiology
```

**Future enhancement:** Could add a specialty dropdown in user settings.

---

## Doctor Dashboard Access

### What Doctors See

When in a patient's circle as a doctor:

**In Circle View:**
```
Circle Members
┌────────────────────────────────────┐
│ alice (patient)                    │
│ Consent: full                      │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ dr_smith (doctor) ← YOU            │
│ Consent: full                      │
└────────────────────────────────────┘
```

**In Chat:**
- Can see messages based on patient's consent
- Can log notes/orders
- Can delegate questions to agents

---

## Common Scenarios

### Scenario 1: New Doctor Joining

```
1. Patient: /doc dr_smith
2. Dr. Smith: /switch patient_name
3. Dr. Smith: /spec Cardiology
4. Dr. Smith: Now can use /log, /order, /agent commands
```

### Scenario 2: Multiple Doctors

```
Patient Alice has:
- Dr. Smith (Cardiology)
- Dr. Jones (Neurology)

Both doctors:
1. Switch to Alice's circle
2. Set their specialties
3. Can see each other's presence
4. Cannot see each other's confidential notes/orders
```

### Scenario 3: Doctor Has Own Patients

```
Dr. Smith's circles:
1. Own circle: dr_smith (patient role)
2. Alice's circle: dr_smith (doctor role)
3. Bob's circle: dr_smith (doctor role)

Use /switch to move between:
/switch dr_smith  → Your own circle (patient)
/switch alice     → Alice's circle (doctor)
/switch bob       → Bob's circle (doctor)
```

---

## Permission Levels

### What Doctors CAN Do:
- ✅ View messages (based on consent)
- ✅ Log confidential notes
- ✅ Log orders
- ✅ Delegate questions via agent
- ✅ Set their own specialty
- ✅ View circle members

### What Doctors CANNOT Do:
- ❌ Add/remove members from patient's circle
- ❌ Change patient's consent settings
- ❌ Access other doctor's confidential logs
- ❌ Switch to circles where they're not a member

---

## Safety Features

### In Your Own Circle

If you're a doctor and try to use patient commands in your own circle:
```
Dr. Smith (in own circle): /log "test"
System: Safety alert: You can only use /switch, /circle, or /spec in your personal circle.
```

**Allowed in own circle:**
- `/switch` - to change circles
- `/circle` - to view your circle
- `/spec` - to set specialty

**Not allowed in own circle:**
- `/log`, `/order`, `/agent` - only in patient circles

### Context Clarity

System always shows:
- Current circle: Header shows `@patient_name`
- Your role: Badge shows "doctor"
- Browser tab: `username (doctor) - Care Circles`

---

## Relationship Field Explained

### Why Doctors Don't Need Relationship

**Caregivers:**
- Need relationship to understand connection
- Examples: mother, spouse, friend, nurse
- Helps determine level of involvement

**Doctors:**
- Professional relationship is implicit
- Always set to "Physician"
- Specialty is what matters (set with `/spec`)
- Relationship field populated automatically

**In Database:**
```sql
-- Caregiver
role: 'caregiver'
relationship_type: 'mother'

-- Doctor
role: 'doctor'
relationship_type: 'Physician'  -- automatic!
```

---

## Troubleshooting

### "You are not a member of the care circle"

**Problem:** Trying to switch to a patient who hasn't added you

**Solution:** Ask patient to do `/doc your_username`

### "This command is only available to doctors"

**Problem:** Trying to use `/log` or `/order` but you're a caregiver

**Solution:** Patient needs to add you with `/doc` not `/care`

### "Safety alert: You can only use /switch..."

**Problem:** Trying to use doctor commands in your own circle

**Solution:** Use `/switch patient_name` first to get to patient's circle

### Commands not working after being added

**Problem:** Haven't set specialty yet

**Solution:** Use `/spec your_specialty` to unlock doctor features

---

## Best Practices

1. **Set specialty immediately** after being added to a patient circle
2. **Use /switch** to clearly indicate which patient you're focusing on
3. **Log important observations** using `/log` for continuity of care
4. **Delegate routine questions** to agents with `/agent ask`
5. **Return to own circle** when done: `/switch your_username`

---

**Remember:** The system knows you're a doctor because of HOW you were added (`/doc`), not what you type. Your actions are automatically logged with doctor context!

