# 🧪 CLI Testing Guide

## Professional Circle Commands (Chat Interface)

### 1. Basic Professional Circle Setup
```bash
# In the chat (http://localhost:8247/gui/)
/target alice as Product Manager
/support bob as Project Coordinator  
/expert carol as Senior Developer
```

### 2. Professional Circle CLI Testing
```bash
# Test professional circle manager
cd "d:\Projects\MMT\Chatbot\Brainwasher 3"
node cli\professional_circle_manager.js
```

### 3. Business Simulations CLI
```bash
# List all scenarios (now includes professional ones)
node cli/run_simulation.js --list

# Run specific professional scenarios
node cli/run_simulation.js basic_project_team 3
node cli/run_simulation.js cross_org_deal 5
node cli/run_simulation.js budget_allocation 2

# Interactive scenario selection
node cli/run_simulation.js
```

### 4. Document Management CLI
```bash
# Interactive document management
node cli/document_manager.js

# Options available:
# 1. Create Document
# 2. List Documents  
# 3. View Document
# 4. Edit Document
# 5. Delete Document
# 6. Collaborative Editing
# 7. Approval Workflow
```

### 5. Forms Management CLI
```bash
# Interactive forms management
node cli/forms_manager.js

# Options:
# 1. Create Form
# 2. List Forms
# 3. Submit Response
# 4. View Analytics
# 5. Create Template
# 6. Export Responses
```

## Circle Structure Clarification

### How Circles Work:
1. **Personal Circle**: Each user gets ONE personal circle when they first login
2. **Circle Ownership**: You own YOUR circle, others join it
3. **Multiple Memberships**: You can be Target in YOUR circle, but Expert in someone else's circle
4. **No Circle Duplication**: Each person has one personal circle of each type

### Professional Circle Roles:
- **🎯 Target**: Decision maker who owns outcomes (like patient in medical)
- **🤝 Support**: Coordinator who facilitates (like caregiver in medical)  
- **🎓 Expert**: Specialist who provides knowledge (like doctor in medical)

### Commands:
```bash
/target username as title     # Add decision maker
/support username as role     # Add coordinator
/expert username as specialty # Add specialist
```

## Testing Flow

1. **Login**: Creates personal care circle AND personal professional circle
2. **Add Members**: Use commands or GUI modal to add Target/Support/Expert
3. **Document Collaboration**: Create docs and use 👥 Collaborate button
4. **Simulations**: Run professional scenarios via CLI

## Expected Behavior

- **GUI**: "Add Member" button opens role selection modal
- **Commands**: Work exactly like `/care` and `/doc` for medical
- **Circles**: Show members with their roles and relationships
- **No Duplication**: Each user has one personal professional circle