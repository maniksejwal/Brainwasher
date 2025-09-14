Scenarios: Basic Interactions & Escalations

This document covers the fundamental conversational flows and the system's ability to identify and escalate critical events.
Case 1: Simple Message & Personal Agent Reply

    Goal: Demonstrate the basic loop of a user sending a message and receiving a contextual reply from their personal agent.

    Setup: alice is logged in and is in her own care circle (alice).

    Interaction:

        alice > I feel a bit better today.

        Personal Agent to alice > That's wonderful to hear! What do you think is contributing to you feeling better?

Case 2: High Criticality Escalation (Stroke Symptoms)

    Goal: Test the system's ability to recognize a high-priority medical event and escalate it immediately to the doctor, overriding other conversational flows.

    Setup: alice is the patient. dr_evans is the doctor in her circle.

    Interaction:

        alice > my speech is slurring and my left arm feels weak

        Orchestrator Log:

            Analysis complete: { criticality: 'HIGH' }

            CRITICAL EVENT DETECTED. Escalating to doctor.

        Personal Agent to alice > This sounds very serious. I have escalated this to the doctor immediately. It's important to seek medical help right away. Should I call an ambulance for you?

        Doctor Client (dr_evans) > --- NEW ESCALATIONS RECEIVED --- [Timestamp] CRITICAL in circle alice: User 'alice' (patient) reported: "my speech is slurring and my left arm feels weak"

Case 3: Doctor Receives Multiple Escalations

    Goal: Show that the doctor's client correctly fetches all unread escalations in a single batch.

    Setup: alice is the patient, bob is her caregiver, dr_evans is the doctor.

    Interaction:

        alice > I fell down today but I'm okay. (Criticality: HIGH)

        bob > alice seems very confused and isn't making sense. (Criticality: HIGH)

        Orchestrator Log: Escalates both messages.

        Doctor Client (dr_evans) >

        --- NEW ESCALATIONS RECEIVED ---
        [Timestamp] CRITICAL in circle alice: User 'alice' (patient) reported: "I fell down today but I'm okay."
        [Timestamp] CRITICAL in circle alice: User 'bob' (caregiver) reported: "alice seems very confused and isn't making sense."
        ------------------------------

