Project Documentation: Training & Learning Framework
3. Training Methodology & Learning System

This document outlines the conceptual framework for training the multi-agent AI system. A core inventive step of this project is the ability to bootstrap and continuously improve the system's intelligence in the absence of any pre-existing, labeled dataset for multi-user patient-caregiver interactions.
3.1. The "No Prior Dataset" Contingency

Standard supervised learning is not feasible for this problem. Our training strategy is therefore built on a three-phase model that relies on simulation, human expertise, and real-world feedback to create its own data and learning signals.
3.2. A More Complete Loss Function Framework

The system's learning is guided by optimizing for "Care Circle Health," a metric that encompasses clinical outcomes, user trust, and operational efficiency. This is achieved through two distinct, specialized loss/reward functions.
3.2.1. Personal Agent Loss Function (L_Agent)

The goal of the Personal Agent is to build trust and elicit high-quality, actionable information. Its loss function is a weighted sum designed to prioritize clarity and effectiveness over simple empathy.

L_Agent=w_1L_Actionability+w_2L_Adherence+w_3L_Conciseness+w_4L_Elicitation+w_5L_Empathy

    L_Actionability (High Weight): Measures if the agent's reply provides a clear, actionable next step or a goal-driven question.

    L_Adherence (High Weight): A delayed reward signal. If the agent's advice is followed by the user, the preceding interaction is rewarded.

    L_Conciseness (Medium-High Weight): Penalizes verbosity and rewards the agent for matching the user's conversational style.

    L_Elicitation (Medium Weight): Measures if the agent's reply successfully elicits new, useful information.

    L_Empathy (Low Weight): A modulating factor to ensure the tone is appropriate and builds rapport, but does not override clarity.

3.2.2. Orchestrator Reward Function (R(t))

The Orchestrator is a decision-making engine, not a conversationalist. It is trained using Reinforcement Learning to choose the action that maximizes the expected future reward for the Care Circle.

    Key Actions (A): SHARE(target, content), ESCALATE(details), REQUEST_CLARIFICATION(target, topic), REQUEST_CONSENT(user, suggestion), WAIT.

    Key Rewards (R):

        Timely Critical Escalation: +100

        Missed Critical Escalation: -200

        Privacy Violation: -100

        Action Confirmation (User Adherence): +50

        Medical Coding Accuracy: +30 (Correctly mapping user language to SNOMED/ICD codes).

        Successful Conflict Resolution: +20

        Annoying/Redundant Request: -10

3.3. State Representation: The Sparse Vector Approach

To handle the diverse and often sparse data associated with each user, the system maintains a structured State Vector (a JSON object) in the database.

{
  "clinical_facts": {
    "medication_taken": { "value": false, "timestamp": 1726055220 },
    "snomed_ct_symptoms": ["29857009"]
  },
  "behavioral_state": {
    "stage_of_change": "Contemplation",
    "coping_style": "Denial"
  },
  "social_context": {
    "relationship_patient": { "type": "spouse", "closeness": 75 },
    "last_interaction_conflict": false
  }
}

