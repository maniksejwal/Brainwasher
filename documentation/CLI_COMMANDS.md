# CLI Chat Commands

This document lists all available commands for the command-line chat interface (`cli/chat/main.js`).

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

### `/care <username>` or `/doc <username>`
Add a member to the current care circle.
- `/care`: Adds a caregiver.
- `/doc`: Adds a doctor.
**Usage:**
```bash
/care mom_jane
/doc dr_jones
```

### `/circle`
List all members of the current care circle and their roles.

### `/patients`
List all patients you are caring for (if you are a caregiver/doctor).

### `/switch <patient_username>` or `/switch <circle_id>`
Switch context to another patient's care circle.

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
Set the consent level for a user (1-3).
**Usage:**
```bash
/consent mom_jane 3
```

## System & Debugging

### `/clear`
Clears the simulation database (Use with caution!).

### `/report <username> <reason>`
Report a user or content.

### `/feedback <score> <comment>`
Submit feedback about the AI's response.

### `/score`
(Internal testing command)
