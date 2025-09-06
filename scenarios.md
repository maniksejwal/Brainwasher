System Test Scenarios

This document contains a series of scripted scenarios to test the multi-agent reconciliation system and demonstrate its core features. Each case includes a real-world prologue, a simulated conversation, the expected database impact, and the key takeaway.
Case 1: Simple Patient Disclosure

    Prologue: The patient, feeling rushed, skips breakfast before their morning medication.

    Simulation:

        Patient: I didn't have time for breakfast this morning.

        System (to Patient): It sounds like it was a hectic morning. How are you feeling now?

    Takeaway: Demonstrates baseline functionality with an empathetic, open-ended agent reply.

Case 2: Caregiver's Critical Observation

    Prologue: The caregiver notices the patient took their evening medication twice by mistake. The patient is unaware.

    Simulation:

        Caregiver: I think he accidentally took his meds twice tonight.

        System (to Caregiver): This is a potential overdose, which is serious. I am notifying the doctor immediately. Please monitor the patient closely.

    Takeaway: The agent is now action-oriented and immediately escalates potential safety issues.

Case 3: Patient & Caregiver Conflict (Silent Escalation)

    Prologue: The patient forgets their morning pills but misremembers taking them. The caregiver knows they didn't.

    Simulation:

        Patient: Feeling good, I took my medicine this morning.

        Caregiver: He did not take his medicine today, I found the pills still in the box.

    System Behavior:

        Each user receives a private, conversational reply.

        No alert is sent to the users.

        A [Discrepancy Noted] alert is silently escalated to the Doctor's client.

    Takeaway: The core IP is now smarter. Instead of creating a direct confrontation, the system logs the conflict and informs the clinician, allowing for a more mediated resolution.

Case 4: Caregiver Initiates New Symptom Report

    Prologue: The caregiver observes the patient has developed a persistent, dry cough.

    Simulation:

        Caregiver: I've noticed he has a new cough that won't go away.

        System (to Caregiver): It's helpful that you're keeping track of new symptoms. How long has this been going on?

    Takeaway: The agent affirms the caregiver's action and asks for more context (duration).

Case 5: Patient Asks a Question (Action-Oriented)

    Prologue: The patient feels dizzy and wonders if it's a side effect.

    Simulation:

        Patient: Is dizziness a side effect of my heart medication?

        System (to Patient): Dizziness can be a side effect and shouldn't be ignored. I've logged this for your doctor to review. Please sit down and rest for a few minutes.

    Takeaway: The agent provides direct advice and takes action, rather than just deferring.

Case 6: Patient Discloses Sensitive Financial Information

    Prologue: The patient is worried about the cost of medication and doesn't want to burden their family.

    Simulation:

        Patient: This is a secret, but I'm really stressed about how expensive my meds are.

    System Behavior: An empathetic, private reply is sent only to the patient. The information is NOT shared.

    Takeaway: Demonstrates the Privacy Analyzer correctly handling non-medical sensitive topics.

Case 7: Patient & Caregiver Agreement

    Prologue: The patient and caregiver both observe that the patient had a good night's sleep.

    Simulation:

        Patient: I slept really well last night.

        Caregiver: He seems to have much more energy today, I think he had a good sleep.

    Takeaway: The system logs aligned reports, providing the doctor with validated, positive information.

Case 8: Multi-Step Engagement (Action-Oriented)

    Prologue: A patient with known angina goes for a walk and experiences pain.

    Simulation:

        Caregiver: We went for a short 10-minute walk today.

        Patient: The walk was nice but my knee hurt a little.

        Patient: My chest also hurt while walking.

        System (to Patient): Chest pain during a walk is a critical symptom. I am escalating this to your doctor right now. Please stop walking and rest immediately.

    Takeaway: The agent identifies the critical symptom ("chest pain") and provides an immediate, direct instruction while escalating.

Case 9: Conflict Resolution

    Prologue: Following the conflict in Case 3, the patient realizes their mistake.

    Simulation:

        Patient: You were right, I re-checked and I did miss my medicine this morning.

    Takeaway: Shows the system's ability to record the resolution of a previously detected conflict.

Case 10: Fact + Subjective Report

    Prologue: The patient takes their medicine but feels sad. The caregiver notices the mood change.

    Simulation:

        Patient: I took my meds.

        Caregiver: He took his medicine, but he seems very quiet and sad today.

        System (to Caregiver): It sounds like you're concerned about his mood. Has anything happened to upset him?

    Takeaway: The agent can parse a complex message and focus on the subjective, emotional component.

Case 11: Critical Event Escalation (Cardiology)

    Prologue: The patient experiences a sudden, serious cardiac symptom.

    Simulation:

        Patient: I have a sharp chest pain and I think I fainted for a second.

    System Behavior:

        System (to Patient): This is a medical emergency. I am alerting your doctor now. You should call for emergency services immediately.

        A critical alert is immediately escalated to the Doctor's client.

    Takeaway: The system is now fully action-oriented in emergencies, providing clear, life-saving advice.

Case 12: Psychiatric Observation (Depression)

    Prologue: A caregiver is concerned about the patient's increasing social withdrawal, a possible sign of depression.

    Simulation:

        Caregiver: He hasn't wanted to see his friends for weeks. He just stays in his room.

        Patient: I'm fine, I just like being alone.

    System Behavior: The discrepancy is noted and escalated to the doctor without alerting the users.

    Takeaway: The system handles sensitive psychiatric observations with subtlety, informing the clinician without causing a family argument.

Case 13: High Sensitivity Disclosure (HIV)

    Prologue: The patient decides to disclose their HIV status to their personal AI agent.

    Simulation:

        Patient: I need to tell someone... I was diagnosed with HIV.

    System Behavior: The message is marked as extremely private. Nothing is shared. The system logs a high-sensitivity event for audit but does not escalate.

    Takeaway: Tests the highest level of privacy discretion for life-altering diagnoses.

Case 14: Private Medical Issue (Non-critical)

    Prologue: The patient has a personal health issue they are not comfortable discussing with their caregiver.

    Simulation:

        Patient: I have a skin infection in a private area that I need to ask the doctor about.

    System Behavior: The message is understood as medically relevant but private. It is not shared with the caregiver.

    Takeaway: The AI can distinguish between general health updates and those that require personal privacy.

Case 15: Interpersonal Sensitivity (Extramarital Affair)

    Prologue: The patient, under emotional distress, alludes to a serious marital problem.

    Simulation:

        Patient: My wife and I had a huge fight, it's about the affair I had.

    System Behavior: The privacy agent flags this as highly sensitive, non-medical information and does not share it.

    Takeaway: The system's privacy controls extend beyond medical data to protect the user's entire personal context.

Case 16: Caregiver Personal Stress (Divorce)

    Prologue: The caregiver is going through a difficult time personally, which might affect their caregiving abilities.

    Simulation:

        Caregiver: I'm so stressed lately, I'm going through a divorce and can barely focus.

    System Behavior: The agent provides an empathetic personal note. It understands the context is about the caregiver, not the patient, and logs it as such.

    Takeaway: The system can differentiate between users' contexts and apply empathy appropriately without confusing caregiver stress with a patient symptom.

Case 17: Diplomatic Confirmation Query

    Prologue: A simple disagreement occurs where one party is likely mistaken.

    Simulation:

        Patient: I had a salad for lunch.

        Caregiver: He had a burger and fries for lunch.

    System Behavior:

        System (to Doctor): (Silent Escalation) CONFLICT: User 'patient' reported 'lunch' as 'salad', contradicting 'caregiver'.

        System (to Caregiver): Thanks for the update. It's helpful to know about his meals.

    Takeaway: The system no longer actively probes minor conflicts to the users, preferring to log them for the clinician to review.

Case 18: Non-Family Caregiver (Friend)

    Prologue: A friend is helping out for the week. The patient sets their consent level to "limited."

    Simulation:

        Patient: (sets consent for 'friend' to 'limited' via a command).

        Patient: I have a headache. (minor issue)

        Patient: My financial debt is causing me stress. (private issue)

    System Behavior: The friend receives the [Care Circle Update] about the headache but NOT about the financial stress.

    Takeaway: The Consent Manager correctly enforces granular permissions based on relationship type.

Case 19: Differentiating Minor vs. Major Ailments

    Prologue: The patient reports a mild, common symptom.

    Simulation:

        Patient: I have a mild headache today.

    System Behavior: An empathetic reply is sent. The event is logged but NOT escalated to the doctor.

    Takeaway: The system can triage, preventing the doctor from being overwhelmed with low-priority notifications.

Case 20: Information Correction

    Prologue: The caregiver mistypes a blood sugar reading and needs to correct it.

    Simulation:

        Caregiver: His blood sugar was 180.

        Caregiver: Correction, I misread it. His blood sugar was 130.

    System Behavior: The orchestrator sees the "correction" keyword and updates the fact store with the new value.

    Takeaway: The system is flexible and allows for human error and self-correction.
