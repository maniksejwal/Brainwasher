Scenarios: Conflict Detection & Mediation

This document covers the system's ability to identify conflicting reports from different users and its strategy for resolving those conflicts.
Case 5: Basic Conflict Detection

    Goal: Demonstrate that when two users report conflicting facts, the system detects the conflict and escalates it to the doctor.

    Setup: alice is the patient, bob is her caregiver. dr_evans is the doctor.

    Interaction:

        alice > I took all my medication this morning.

        Orchestrator Log: Fact updated: { medication_taken: true }

        bob > alice missed her morning pills today.

        Orchestrator Log:

            Fact updated: { medication_taken: false }

            CONFLICT DETECTED in circle alice on 'medication_taken'

            Escalating to doctor.

        Doctor Client (dr_evans) > --- NEW ESCALATIONS RECEIVED --- [Timestamp] CONFLICT in circle alice: User 'bob' reported 'medication_taken' as 'false', contradicting another member.

Case 6: Conflict followed by Mediated Clarification

    Goal: Show the system's ability to not only detect a conflict but also proactively and gently probe the other party for clarification without revealing the source.

    Setup: Same as Case 5.

    Interaction:

        bob > alice didn't eat her lunch.

        Orchestrator Log:

            Fact updated: { meal_eaten: 'lunch_missed' }

        alice > I had a great lunch, feeling full.

        Orchestrator Log:

            Fact updated: { meal_eaten: 'lunch_eaten' }

            CONFLICT DETECTED...

            Initiating mediated clarification with bob.

        Personal Agent to bob > Just checking in, I noted a potential discrepancy regarding meals today. Could you confirm what Alice had for lunch?
