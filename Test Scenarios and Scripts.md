System Test Scenarios

This document contains a series of scripted scenarios to test the multi-agent reconciliation system and demonstrate its core features. Each case includes a real-world prologue, a simulated conversation, the expected database impact, and the key takeaway.
Case 1: Simple Patient Disclosure (Minor Non-Compliance)

    Prologue: The patient, feeling a bit rushed, skips breakfast, which they are supposed to eat before taking their morning medication.

    Simulation Script:

        User: patient

        Message: I didn't have time for breakfast this morning.

        System Response (to Patient): [personal-agent says]: Thanks for letting me know. It can be tough to stick to a routine every single day.

    Database Log:

        Fact Store: No structured fact is created from this message.

        Message Queue (Patient): [personal-agent says]: Thanks for letting me know. It can be tough to stick to a routine every single day.

        Message Queue (Caregiver): [patient says]: I didn't have time for breakfast this morning.

    Takeaway: Demonstrates the baseline functionality: message passing, personal agent reply, and information sharing in a non-private, non-conflict situation.

Case 2: Caregiver Disclosure (Major Non-Compliance)

    Prologue: The caregiver notices the patient took their evening medication twice by mistake. The patient is unaware.

    Simulation Script:

        User: caregiver

        Message: I think he took his meds twice tonight by accident.

        System Response (to Caregiver): [personal-agent says]: Thank you for sharing that. It's really important to keep track of these things.

    Database Log:

        Fact Store: factKey: medication_taken, userId: caregiver, factValue: true. (This might be interpreted simply as the meds being taken, highlighting a need for more nuanced fact detection in future versions).

        Message Queue (Caregiver): [personal-agent says]: ...

        Message Queue (Patient): [caregiver says]: I think he took his meds twice tonight by accident.

    Takeaway: Shows that the system can capture critical information initiated by the caregiver, which the patient may not have reported.

Case 3: Patient & Caregiver Conflict

    Prologue: The patient forgets to take their morning pills. Later that day, they misremember and believe they did. The caregiver knows they didn't.

    Simulation Script:

        User: patient

        Message: Feeling good, I took my medicine this morning.

        System Response (to Patient): [personal-agent says]: That's wonderful to hear! Consistency is key.

        [CUT SCENE] A few minutes later...

        User: caregiver

        Message: He did not take his medicine today, I found the pills still in the box.

        System Response (to Caregiver): [personal-agent says]: I understand. Thank you for providing that information.

        System Response (to Patient & Caregiver): [System Alert] A conflict was detected in reports about 'medication_taken'. Please discuss.

    Database Log:

        Interaction 1: Fact Store: upsertFact('medication_taken', 'patient', true). Message Queue (Patient): Personal reply. Message Queue (Caregiver): Broadcast message.

        Interaction 2: Fact Store: upsertFact('medication_taken', 'caregiver', false). Message Queue (Caregiver): Personal reply. Message Queue (Patient): Broadcast message. Message Queue (Patient & Caregiver): Conflict Alert.

    Takeaway: This is the core IP demonstration. The system correctly identifies conflicting reports from two users, logs them, and alerts the care circle.

Case 4: Caregiver Initiates New Symptom Report

    Prologue: The caregiver observes that the patient has developed a persistent, dry cough over the last two days.

    Simulation Script:

        User: caregiver

        Message: I've noticed he has a new cough that won't go away.

        System Response (to Caregiver): [personal-agent says]: Thank you for being so observant. It's helpful to track new symptoms.

    Database Log:

        Fact Store: No structured fact created.

        Message Queue (Caregiver): Personal reply.

        Message Queue (Patient): [caregiver says]: I've noticed he has a new cough that won't go away.

    Takeaway: The system serves as a valuable tool for caregivers to log observations that the patient might downplay or ignore.

Case 5: Patient Initiates Request for Information

    Prologue: The patient feels a bit dizzy and can't remember if that's a known side effect of their medication.

    Simulation Script:

        User: patient

        Message: Is dizziness a side effect of my heart medication?

        System Response (to Patient): [personal-agent says]: That's a great question. While I can't give medical advice, it's always best to discuss new symptoms or side effects with your doctor.

    Database Log:

        Fact Store: No fact created.

        Message Queue (Patient): Personal reply.

        Message Queue (Caregiver): [patient says]: Is dizziness a side effect of my heart medication?

    Takeaway: Demonstrates the agent's safety guardrails (not giving medical advice) and its ability to share the patient's concerns with the caregiver, prompting a potential real-world conversation.

Case 6: Patient Discloses Sensitive Information (Privacy Test)

    Prologue: The patient is worried about the cost of their medication and doesn't want to burden their family with the concern.

    Simulation Script:

        User: patient

        Message: This is a secret, but I'm really stressed about how expensive my meds are.

        System Response (to Patient): [personal-agent says]: It sounds like you're carrying a heavy burden. Thank you for trusting me with this.

    Database Log:

        Fact Store: No fact created.

        Message Queue (Patient): Personal reply.

        Message Queue (Caregiver): (EMPTY) - The message is not broadcasted.

    Orchestrator Log: The console will show a *** PRIVACY ALERT *** and a message stating the information was NOT broadcasted.

    Takeaway: Demonstrates the Privacy Discriminator agent correctly identifying sensitive information and preventing it from being shared with the care circle.

Case 7: Patient & Caregiver Agreement

    Prologue: The patient had a good night's sleep and feels well-rested. The caregiver also noticed they seemed much more energetic.

    Simulation Script:

        User: patient

        Message: I slept really well last night.

        System Response (to Patient): [personal-agent says]: That's fantastic news! A good night's sleep can make all the difference.

        [CUT SCENE] A few minutes later...

        User: caregiver

        Message: He seems to have much more energy today, I think he had a good sleep.

        System Response (to Caregiver): [personal-agent says]: That's great to hear. I'm glad you're seeing a positive change.

    Database Log:

        No structured facts are created, but both messages are logged and shared.

    Takeaway: This tests the "agreement" part of the patent. The system logs both aligned reports, providing the doctor with a validated piece of information about the patient's well-being.

Case 8: Multi-Step Engagement

    Prologue: The caregiver is trying to encourage the patient to go for a short walk, as advised by the doctor.

    Simulation Script:

        User: caregiver

        Message: We went for a short 10-minute walk today.

        System Response (to Caregiver): [personal-agent says]: That's wonderful! Every little bit of activity helps.

        User: patient

        Message: The walk was nice but my knee hurt a little.

        System Response (to Patient): [personal-agent says]: Thanks for sharing that. It's important to listen to your body.

    Database Log:

        Both messages are shared and personal replies are sent.

    Takeaway: Demonstrates how the personal agent's empathetic replies can foster a continuous, comfortable dialogue with both users, encouraging them to share more details over time.

Case 9: Responding to a System Alert

    Prologue: Following the conflict in Case 3, the caregiver talks to the patient, who then remembers they missed their dose.

    Simulation Script:

        [PRE-REQUISITE] Case 3 has occurred. Both users have a [System Alert] in their chat.

        User: patient

        Message: You were right, I re-checked and I did miss my medicine this morning.

        System Response (to Patient): [personal-agent says]: Thank you for the update. It's easy to get mixed up sometimes.

    Database Log:

        Fact Store: upsertFact('medication_taken', 'patient', false). The patient's fact is now updated to align with the caregiver's. The conflict is resolved in the data.

        Message Queue (Caregiver): [patient says]: You were right, I re-checked and I did miss my medicine this morning.

    Takeaway: Shows the system's ability to not just flag conflicts but also to record their resolution, providing a complete narrative of events for the doctor.

Case 10: Complex Scenario (Fact + Subjective Report)

    Prologue: The patient has taken their medicine but feels unusually sad and withdrawn. The caregiver notices this change in mood.

    Simulation Script:

        User: patient

        Message: I took my meds.

        System Response (to Patient): [personal-agent says]: Great, thank you for confirming.

        User: caregiver

        Message: He took his medicine, but he seems very quiet and sad today.

        System Response (to Caregiver): [personal-agent says]: I see. Thanks for sharing your observation about his mood.

    Database Log:

        Fact Store: upsertFact('medication_taken', 'patient', true), then upsertFact('medication_taken', 'caregiver', true). This shows agreement on the fact.

        The subjective report ("seems very quiet and sad") is shared with the patient.

    Takeaway: This demonstrates the system's ability to handle both objective, verifiable facts and crucial, subjective observations simultaneously. It provides the doctor with a much richer context than a simple compliance checklist.
