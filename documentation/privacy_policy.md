# Privacy & Data Handling Policy

This document defines the data classification levels used within the multi-agent system and the policies for handling each. The goal is to balance patient safety, privacy, and the need for effective family/clinical support.

## Data Classification Levels

### Level 1: PUBLIC

**Definition**: Non-identifying, general information that is safe to share with all members of a care circle who have at least 'full' consent. This information helps maintain social context and engagement.

**Examples**:
- "We went for a walk today."
- "Feeling a bit better this morning."
- General questions about appointments or diet.

**Handling**: Can be broadcast to other users in the care circle, subject to consent rules.

### Level 2: PRIVATE

**Definition**: Information that is personal to the user but not necessarily medically sensitive or dangerous. It is the default level for most health-related discussions. It requires explicit consent to be shared.

**Examples**:
- "I forgot to take my morning medication." (Non-adherence)
- "I had a mild headache after lunch." (Common symptom)
- "I feel a bit tired and don't want to exercise." (Behavioral info)

**Handling**:
- Logged for the user's personal history
- Never broadcast directly
- May be used by the system to trigger "Mediated Clarification" (asking the other party a gentle question)
- Can be escalated to the doctor if it contributes to a pattern of concern

### Level 3: SENSITIVE

**Definition**: Information that could cause significant emotional distress, social stigma, or personal conflict if shared improperly. This category requires the highest level of protection.

**Examples**:
- Mentions of specific, highly sensitive conditions (e.g., STDs like AIDS, specific psychiatric diagnoses)
- Information about personal relationships (e.g., "I'm having marital problems," "I had an affair")
- Confessions of major non-compliance that could lead to conflict
- Financial or legal troubles

**Handling**:
- Strictly confined to the user and their personal agent
- Never used for "Mediated Clarification"
- Only escalated to the doctor in anonymized or summarized form if there is a direct and immediate health risk
- The system will prioritize user trust above all else

## Consent Management

### Consent Levels

1. **None**: No information sharing allowed
2. **Limited**: Only public information can be shared
3. **Full**: Public and private information can be shared with explicit consent
4. **Emergency**: Override for critical health situations only

### Consent Workflow

1. **Implied Consent**: System checks if user has given implied consent for similar topics
2. **Explicit Consent**: If no implied consent, system asks for explicit permission
3. **Emergency Override**: In critical situations, system can override consent for immediate health safety

## Privacy Safeguards

### Technical Safeguards
- All data encrypted in transit and at rest
- Access logging for all data access
- Regular security audits
- Data retention policies

### Operational Safeguards
- User control over their data
- Clear consent mechanisms
- Transparent data usage policies
- Regular privacy impact assessments

## Compliance

This policy is designed to comply with:
- HIPAA (Health Insurance Portability and Accountability Act)
- GDPR (General Data Protection Regulation)
- Local healthcare privacy regulations
- Ethical AI principles
