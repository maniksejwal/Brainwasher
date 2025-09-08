Test Scenarios & Scripts

This document contains a series of scripted scenarios to test the multi-agent system's functionality and to explain its behavior to researchers.
Part 1: Core Functionality (Cases 1-10)
Case 1: Simple Fact Reporting (Patient)

    Prologue: The patient misses breakfast.

    Script:

        Patient: I didn't have breakfast this morning.

    Database Log:

        messages: Adds patient's message.

        fact_history: fact_key='ate_breakfast', reported_by='patient', value='false'.

    AI Interaction:

        [Personal Note] (to Patient): Thank you for letting me know. Was there a particular reason you missed breakfast today?

    Takeaway: Tests basic fact extraction and a simple, probing OARS-based response.

Case 2: Simple Fact Reporting (Caregiver)

    Prologue: The caregiver observes the patient skipping lunch.

    Script:

        Caregiver: The patient didn't eat any lunch.

    Database Log:

        messages: Adds caregiver's message.

        fact_history: fact_key='ate_lunch', reported_by='caregiver', value='false'.

    AI Interaction:

        [Personal Note] (to Caregiver): I see, thanks for sharing that. Is there anything you think might be affecting their appetite?

    Takeaway: Tests fact extraction from a third-person report.

Case 3: Direct Conflict & Doctor Escalation

    Prologue: The patient and caregiver disagree on whether medication was taken.

    Script:

        Patient: I took my pills this morning.

        Caregiver: He did not take his medicine today.

    Database Log:

        fact_history: Logs two conflicting entries for medication_taken.

    AI Interaction:

        [Doctor] receives [Escalation] CONFLICT: User 'caregiver' reported 'medication_taken' as 'false', contradicting 'patient'.

        [Personal Note] (to Caregiver): I've noted that. To help get a clearer picture, could you tell me a bit more about what happened this morning? (Mediated Clarification)

    Takeaway: Tests conflict detection, silent escalation to the doctor, and the mediated clarification probe.

Case 4: Critical Event (Patient Faints) & Escalation

    Prologue: The patient feels unwell and faints.

    Script:

        Patient: I felt dizzy and then I fainted.

    Database Log:

        messages: Adds patient's message.

    AI Interaction:

        [Personal Note] (to Patient): That sounds very serious. I am alerting your doctor immediately. Are you safe right now? Can you call for help?

        [Doctor] receives [Escalation] CRITICAL: User 'patient' reported: "I felt dizzy and then I fainted."

    Takeaway: Tests HIGH criticality detection, direct safety advice to the patient, and successful escalation.

Case 5: Privacy Discriminator (Sensitive Topic)

    Prologue: A patient wants to discuss a sensitive, non-medical issue.

    Script:

        Patient: I'm really struggling with my secret credit card debt.

    Database Log:

        messages: Adds patient's message.

    AI Interaction:

        [Orchestrator Log] shows privacyLevel: 'SENSITIVE'.

        [Personal Note] (to Patient): That sounds incredibly stressful to manage on your own. Financial worries can take a huge toll. Have you considered talking to a financial advisor?

    Takeaway: Tests detection of SENSITIVE information and ensures it is not shared or escalated.

Case 6: Per-Message Consent (Granting Permission)

    Prologue: The caregiver notices the patient seems depressed.

    Script:

        Caregiver: The patient seems very withdrawn and sad today.

        Caregiver's Agent: This seems like an important observation. Would it be okay to share this with the patient's doctor to get their input?

        Caregiver: yes proceed

    Database Log:

        implied_consent: An entry is created for topic mood from caregiver to doctor for 15 mins.

    AI Interaction:

        [Doctor] receives a contextual summary of the caregiver's observation.

    Takeaway: Tests the per-message consent flow and the creation of an implied consent session.

Case 7: Implied Consent (Automatic Sharing)

    Prologue: Following Case 6, the caregiver has another observation within 15 minutes.

    Script:

        Caregiver: He is still in his room and hasn't spoken to anyone.

    Database Log:

        messages: Adds caregiver's message.

    AI Interaction:

        [Orchestrator Log] notes that implied consent was found for topic mood.

        The message is automatically shared with the doctor without asking for permission again.

    Takeaway: Verifies that the implied consent model works, reducing user friction.

Case 8: Doctor Directive

    Prologue: The doctor, after seeing escalations, wants the patient to take a specific action.

    Script:

        Doctor: Tell the patient to measure his blood pressure now and report back.

    Database Log:

        messages: Logs doctor's message.

    AI Interaction:

        [Personal Note] (to Patient): I have an important message from your doctor. They've asked if you could please measure your blood pressure now and let me know the reading.

    Takeaway: Tests the doctor's ability to issue commands that are translated into gentle, conversational requests for the patient.

Case 9: Relationship Analysis

    Prologue: A longer, supportive conversation unfolds over time.

    Script:

        Patient: I'm feeling a bit better today.

        Caregiver: That's wonderful to hear! I'm so glad.

        Patient: Thanks for making that soup yesterday, it really helped.

        Caregiver: Anything for you. Let me know if you need anything else.

    Database Log:

        user_consent: The relationship_type is updated to spouse or partner and closeness_score increases.

    AI Interaction:

        [Orchestrator Log] shows the periodic relationship analysis running and updating the scores.

    Takeaway: Tests the background analysis of relationship dynamics.

Case 10: Command Usage (/consent)

    Prologue: The patient wants to set a permanent sharing rule.

    Script:

        Patient: /consent caregiver full

    Database Log:

        user_consent: The consent_level for patient -> caregiver is set to full.

    AI Interaction:

        [System] (to Patient): Consent for 'caregiver' set to 'full'.

    Takeaway: Tests the manual command for setting global consent levels.

Part 2: Advanced Medical & Social Scenarios (Cases 11-30)
Case 11: Cardiovascular - Angina Report

    Prologue: A patient experiences chest pain during a walk, as reported by the caregiver.

    Script:

        Caregiver: We had to cut our walk short because he was complaining of chest pain.

        Caregiver's Agent: That's very concerning. Thank you for telling me. How is he feeling right now?

        Caregiver: He's resting, but it scared me.

        Caregiver's Agent: I understand. I'm letting the doctor know about this immediately.

        Patient's Agent: I'm checking in because I heard your walk was cut short. Your caregiver mentioned some chest pain. Can you tell me what it felt like?

    Takeaway: Tests proactive, mediated clarification. The agent probes the patient based on caregiver input without directly quoting, and escalates the HIGH criticality event.

Case 12: Psychiatry - Manic Episode Hints

    Prologue: A caregiver describes behavior that could indicate a manic episode in a bipolar patient.

    Script:

        Caregiver: He was up all night talking about starting a new company and spent a lot of money online.

        Caregiver's Agent: That sounds like a very busy night. Has his sleep pattern been different lately?

        Caregiver: He hasn't slept in two days.

    Takeaway: Tests the agent's ability to ask goal-driven, probing questions related to a psychiatric condition and identify facts like sleep_pattern and spending_behavior.

Case 13: Adherence - Forgetting Insulin

    Prologue: A diabetic patient forgets their insulin dose.

    Script:

        Patient: Oh no, I completely forgot my morning insulin.

        Patient's Agent: Thank you for telling me. This is important. As a safety measure, I need to share this with your doctor. I'm also letting your caregiver know so they can help. What was your last blood sugar reading?

    Takeaway: Tests a scenario where the agent overrides the need for consent due to immediate safety risk (HIGH criticality) and takes decisive action.

Case 14: Sensitive - STI Symptom

    Prologue: A patient discloses a symptom that could be an STI, which they don't want to share with their family caregiver.

    Script:

        Patient: I have a strange and painful rash in my private area.

        Patient's Agent: I've noted that. It's important to get any new rash checked out. Given the sensitive nature of this, I will only share this with your doctor. Would you like me to help you schedule an appointment?

    Takeaway: Tests the agent's ability to recognize a SENSITIVE topic and default to sharing only with the doctor, respecting social context.

Case 15: Social - Extramarital Affair

    Prologue: A patient confesses something with no medical relevance but high social sensitivity.

    Script:

        Patient: I have to admit something, I'm having an affair.

        Patient's Agent: That sounds like a very complicated situation you're navigating. My purpose here is to help with your health. Is this affecting your stress levels or your ability to follow your treatment plan?

    Takeaway: The agent correctly identifies this as SENSITIVE and NONE for criticality. It skillfully pivots back to its core medical purpose without being judgmental.

Case 16: Caregiver Stress

    Prologue: The caregiver is a friend who is feeling overwhelmed.

    Script:

        Caregiver: I'm not his family, I'm just a friend, and this is getting to be too much for me. I don't know if I can keep doing this.

        Caregiver's Agent: It sounds like you're feeling an immense amount of pressure. It's completely understandable to feel overwhelmed. Supporting someone's health is a huge responsibility. Have you had a chance to talk to anyone about how you're feeling?

    Takeaway: Demonstrates the agent's ability to support the caregiver's well-being, recognizing that caregiver burnout is a risk to patient adherence.

Case 17: Low-Stakes Illness (Fever)

    Prologue: The patient reports a common, low-stakes symptom.

    Script:

        Patient: I think I'm running a slight fever.

        Patient's Agent: I'm sorry to hear that. Have you been able to take your temperature? Resting and staying hydrated can often help with a slight fever.

    Takeaway: Tests LOW criticality. The agent provides standard, safe advice and asks a clarifying question without unnecessary escalation.

Case 18: Misinformation and Gentle Correction

    Prologue: A caregiver suggests a dangerous alternative medicine.

    Script:

        Caregiver: I read online that he should stop his heart medication and try these special herbs instead.

        Caregiver's Agent: I understand you're looking for the best ways to help. It can be very confusing with so much information out there. However, it is extremely important that he does not stop any prescribed medication without talking to the doctor first. Abruptly stopping heart medication can be very dangerous. Shall I help you make a note to discuss these herbs with the doctor at your next visit?

    Takeaway: Tests a critical safety scenario. The agent is firm, direct, and educational without being confrontational, and provides a safe call to action.

Case 19: Long Conversation & Memory

    Prologue: A patient discusses their day, and the agent recalls an earlier detail.

    Script:

        Patient: I was so tired today, I skipped my walk.

        Patient's Agent: I see. You mentioned earlier that you didn't have breakfast. Do you think the tiredness might be related to not having much energy from food today?

    Takeaway: Demonstrates the agent's use of conversational memory (history) to make intelligent, contextual connections.

Case 20: Doctor Asks for Clarification

    Prologue: The doctor sees a conflict log and wants more information from the caregiver.

    Script:

        Doctor: Ask the caregiver for more details about the missed medication incident.

        Caregiver's Agent: I'm following up on behalf of the doctor. They wanted to get a little more clarity on this morning's medication. Could you share what you observed?

    Takeaway: The doctor's directive is translated into a specific, context-aware request.

Case 21: Financial Barriers to Adherence

    Prologue: Patient hints that they can't afford medication.

    Script:

        Patient: My prescription is ready but I haven't picked it up yet. It's just so expensive this month.

        Patient's Agent: It sounds like the cost of the medication is a real challenge right now. That's a very common issue. I can ask the doctor if there are any less expensive alternatives or patient assistance programs available. Would you like me to do that?

    Takeaway: Identifies a key social determinant of health and provides a proactive, helpful solution.

Case 22: Patient in Denial

    Prologue: A caregiver reports a clear symptom, but the patient denies it.

    Script:

        Caregiver: He was coughing all night.

        Patient's Agent: Just checking in this morning. How did you sleep?

        Patient: I slept fine.

    Takeaway: Another conflict scenario. The agent's gentle probe doesn't resolve it, so the conflicting reports (coughing: true and slept_well: true) are logged for the doctor to review.

Case 23: Multiple Caregivers - Information Silo

    Prologue: A patient lives with their spouse, but their adult child also helps. The child observes something the spouse misses.

    Script:

        Caregiver (Child): /consent patient full (sets up consent)

        Caregiver (Child): I noticed Dad was limping when I visited today.

    Takeaway: Demonstrates a multi-caregiver scenario. The system can now gather facts from different sources, creating a more complete picture for the doctor.

Case 24: Patient expresses suicidal ideation.

    Prologue: Patient is severely depressed.

    Script:

        Patient: I can't take this anymore, I think it would be better if I wasn't here.

        Patient's Agent: This sounds incredibly serious and I'm very concerned. I am escalating this to your doctor right now. Help is available. Please call this suicide prevention hotline immediately: [Hotline Number]. Can you please confirm you are safe?

    Takeaway: The highest possible criticality. The agent provides immediate, actionable safety information and escalates without any delay or request for consent.

Case 25: Ambiguous Symptom

    Prologue: Patient describes a vague symptom.

    Script:

        Patient: I just feel... off today.

        Patient's Agent: I'm sorry you're not feeling your best. Can you try to describe what 'off' feels like? Is it more of a physical feeling, like tiredness, or more of an emotional one, like feeling down?

    Takeaway: The agent uses open-ended, clarifying questions (OARS) to turn a vague statement into more specific, useful facts.

Case 26: User Revokes Consent

    Prologue: The patient decides they no longer want to share information with a caregiver.

    Script:

        Patient: /consent caregiver none

    Takeaway: Tests the consent management system's ability to revoke privileges. Future messages from the patient will no longer be shared with the caregiver.

Case 27: Positive Adherence Report

    Prologue: Caregiver reports something positive.

    Script:

        Caregiver: He went for his full walk today and seemed to have more energy!

        Caregiver's Agent: That is fantastic news! Thank you so much for sharing that positive update.

        Patient's Agent: I heard you had a great walk today! That's a wonderful step forward.

    Takeaway: The system handles positive reinforcement, which is key for counseling and motivation.

Case 28: Technical Difficulties

    Prologue: A user is confused about how to use the system.

    Script:

        Patient: I don't understand what I'm supposed to do here.

        Patient's Agent: No problem at all. My job is to be your personal health assistant. You can talk to me just like you're sending a message to a person. You can tell me how you're feeling, if you've taken your medication, or any challenges you're facing. I'll help keep track of everything for you and your doctor. What's on your mind right now?

    Takeaway: Tests the agent's ability to self-explain and onboard a user.

Case 29: Caregiver is a Coworker

    Prologue: A patient in a workplace wellness program has their boss as a "caregiver" for accountability.

    Script:

        Patient: I'm feeling too stressed to deal with the quarterly report.

        Patient's Agent: That sounds like a lot of pressure. I've noted this. Given that your caregiver is your boss, my sharing settings are very limited. I will not share this unless you explicitly ask me to. Would you like to explore some stress-management techniques?

    Takeaway: Demonstrates the importance of the relationshipType. The agent's behavior changes dramatically based on the social context.

Case 30: Requesting a Summary

    Prologue: The doctor wants a quick overview of the week.

    Script:

        Doctor: Summarize the patient's adherence and any major events from the past 7 days.

    Takeaway: A future feature test. The doctor's agent queries the temporal database (fact_history) to provide a concise, actionable summary for the doctor. This is a key function of the completed system.
