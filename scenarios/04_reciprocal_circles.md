Scenarios: Reciprocal Care Circles

This document covers the advanced features of the multi-circle architecture, including creating circles, adding members, and switching contexts.
Case 20: User Registration and Circle Creation

    Goal: Show the flow for a new user and a returning user, demonstrating that each user gets their own personal care circle upon first login.

    Setup: Clean database (/clear).

    Interaction:

        Client 1 > (Logs in as alice for the first time).

        Orchestrator Log: First time login for 'alice'. Creating user and personal care circle.

        System to alice > Logged in as alice. Your active care circle is your own (patient: alice).

        Client 2 > (Logs in as bob for the first time).

        System to bob > Logged in as bob. Your active care circle is your own (patient: bob).

        Client 1 > (Restarts and logs in as alice again).

        Orchestrator Log: (Does not create a new user or circle).

        System to alice > Logged in as alice. Your active care circle is your own (patient: alice).

Case 21: Adding a Member to a Care Circle

    Goal: Demonstrate how a patient can add a caregiver to their personal circle using the /add command.

    Setup: alice and bob have both logged in at least once. alice is in her own circle.

    Interaction:

        alice > /add bob as caregiver with relationship spouse

        System to alice > [System] Added 'bob' to your care circle as a 'caregiver'.

        (Verification): bob can now use the /switch command to enter alice's circle, which would fail before this command was run.

Case 22: Context Switching (/switch)

    Goal: Show how a user who is a member of multiple circles can switch between them to direct their messages to the correct context.

    Setup: bob is a caregiver in alice's care circle. bob is logged in.

    Interaction:

        bob's prompt shows > bob@bob> (He is in his own circle).

        bob > /switch alice

        System to bob > Switched context to circle for patient: alice

        bob's prompt changes > bob@alice>

        bob > how is alice feeling today? (This message is now sent within the context of alice's circle).

        bob > /switch bob (Switches back to his personal circle).

        System to bob > Switched context to circle for patient: bob

        bob's prompt changes > bob@bob>

Case 23: Doctor's Role Safety Check

    Goal: Demonstrate that a user with a doctor role cannot perform administrative or clinical actions in their own personal care circle where they are the patient.

    Setup: dr_evans has a personal circle. She is also a doctor in alice's circle.

    Interaction:

        dr_evans > (Starts client, is in her own circle, dr_evans).

        dr_evans > /consent bob full (Tries to perform a command that should only be available to a patient in their own circle).

        System to dr_evans > [System] Safety alert: You cannot perform clinical actions in your own personal care circle.
