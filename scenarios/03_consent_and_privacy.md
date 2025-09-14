Scenarios: Consent & Privacy

This document covers the system's multi-layered consent model, including per-message requests, implied consent, and the global /consent command.
Case 10: Per-Message Consent Flow (Granted)

    Goal: Demonstrate the default flow where the AI asks for permission to share a specific piece of information.

    Setup: alice is the patient, bob is the caregiver.

    Interaction:

        alice > My knee has been bothering me a lot today.

        Personal Agent to alice > I'm sorry to hear that. Is it okay if I let your caregiver, bob, know you're experiencing some knee pain?

        alice > yes, please share

        Orchestrator Log: Consent granted. Sharing with bob.

        Personal Agent to bob > Just to keep you in the loop, Alice mentioned that her knee has been bothering her today.

Case 11: Implied Consent Flow

    Goal: Show that after granting consent once on a topic, the user is not asked again for a short period.

    Setup: Immediately following Case 10.

    Interaction:

        alice > Now my other knee is starting to ache.

        Orchestrator Log:

            Implied consent found for topic 'knee_pain'. Sharing automatically.

        Personal Agent to bob > Quick update: Alice mentioned her other knee is also starting to ache.

        Personal Agent to alice > (Does NOT ask for consent again, just provides a conversational reply).

Case 12: Global Consent Command (/consent)

    Goal: Demonstrate the use of the /consent command to set a standing permission level for another user in the circle.

    Setup: alice is the patient, bob is a caregiver in her circle.

    Interaction:

        alice > /consent bob full

        System to alice > [System] Consent for 'bob' in this circle set to 'full'.

        alice > I think I might have a slight fever.

        Orchestrator Log: Sharing with bob based on 'full' consent.

        Personal Agent to bob > Just letting you know, Alice thinks she might have a slight fever.
