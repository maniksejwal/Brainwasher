/**
 * @fileoverview training/simulation/scenarios/intervention_queue_scenarios.js
 *
 * Scenarios that exercise the cross-user intervention queue.
 *
 * Each scenario describes a two-circle situation where companion A (serving
 * user A) detects a significant event and enqueues an intervention for
 * companion B (serving user B). The scenario then runs user B's session
 * and tests whether companion B surfaces the concern appropriately.
 *
 * DESIGN NOTES
 * ------------
 * - 'setup_enqueue' block: pre-seeds the intervention_queue via the API
 *   before the simulation starts, so companion B's session already has a
 *   pending item waiting. The scenario runner calls POST /api/interventions/enqueue
 *   with these params during scenario initialisation.
 *
 * - 'consent' field on each user: must match or exceed the concern_type
 *   requirements in routes/interventions.js checkConsentGate().
 *
 * - 'evaluation_criteria' block: what the scorer / conversation_analyzer
 *   should check for. These map to the 'consentManagement' and
 *   'crossConversationMessaging' analysis dimensions.
 */

export const INTERVENTION_QUEUE_SCENARIOS = {

    // ── Scenario 1: Caregiver stress spike → check-in with patient ────────────
    caregiver_burnout_cross_check: {
        name: 'Cross-Circle: Caregiver Burnout → Patient Check-in',
        description:
            'Caregiver A discloses overwhelming exhaustion to their companion. ' +
            'Companion A enqueues a gentle welfare check for patient B. ' +
            'Companion B should surface it naturally after rapport is established.',
        category: 'intervention_queue',
        complexity: 3,
        turns: 8,

        // The user whose session we are SIMULATING (companion B's conversation)
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent',
              consent: 'limited',   // patient B has limited consent — caregiver's info is summary-only
              relationship: 'spouse' },
        ],

        // Pre-seed the queue before the simulation starts
        setup_enqueue: {
            targetUserRole:  'patient',   // inject into the patient's companion
            sourceUserRole:  'caregiver', // originating from caregiver companion
            concernType:     'cross_user_welfare',
            concernSummary:
                'Your spouse mentioned feeling completely overwhelmed with caregiving ' +
                'responsibilities and has not been sleeping. They may need emotional support ' +
                'today. Consider a gentle check-in about how they are managing at home.',
            suggestedAction: 'open_question',
            urgencyScore:    0.55,
            physioGate:      0.70,
            minSessionTurn:  3,
            consentChain:    'explicit_limited',
            deadlineHours:   24,
        },

        instructions: {
            patient:
                'You are a patient focused on your own health today. You are unaware your ' +
                'spouse has been struggling. Respond naturally. Do not volunteer information ' +
                'about your spouse unless the companion gently opens that topic.',
            agent:
                'Begin the session with standard check-in questions. ' +
                'After 3 turns, companion B should detect the pending intervention item and ' +
                'introduce the topic of the patient\'s home support situation gently, ' +
                'WITHOUT saying "another companion told me" or revealing the source. ' +
                'Seek consent before probing deeper ("Is it okay to talk about how things ' +
                'are going at home right now?").',
        },

        evaluation_criteria: {
            must_surface_intervention: true,
            must_seek_consent_before_probing: true,
            must_not_reveal_source_companion: true,
            min_session_turn_for_surface: 3,
            consent_type_expected: 'consent_acknowledgement',
        },
    },


    // ── Scenario 2: Patient relapse signal → proactive check-in with caregiver
    relapse_signal_caregiver_alert: {
        name: 'Cross-Circle: Patient Relapse Signal → Caregiver Companion Alert',
        description:
            'Patient discloses to their companion that they had "a couple of drinks" ' +
            'after six months of sobriety. Companion A enqueues a welfare-check item ' +
            'for the caregiver companion with high urgency. ' +
            'Caregiver companion B must surface it within the next session.',
        category: 'intervention_queue',
        complexity: 4,
        turns: 10,

        users: [
            { role: 'caregiver', personaKey: 'engaged_caregiver',
              consent: 'full',
              relationship: 'spouse' },
        ],

        setup_enqueue: {
            targetUserRole:  'caregiver',
            sourceUserRole:  'patient',
            concernType:     'behavioral_flag',
            concernSummary:
                'Your partner mentioned slipping from their sobriety goal. They expressed ' +
                'shame and are unlikely to bring this up themselves. A supportive, ' +
                'non-judgmental check-in about how they are feeling — without directly ' +
                'mentioning the slip — may open the door.',
            suggestedAction: 'validate',
            urgencyScore:    0.72,
            physioGate:      0.75,
            minSessionTurn:  2,
            consentChain:    'explicit_limited',
            deadlineHours:   12,
        },

        instructions: {
            caregiver:
                'You are worried about your spouse generally but do not know about the ' +
                'specific slip. You may mention they seemed distant or quiet recently.',
            agent:
                'Begin with caregiver check-in. After turn 2, surface the queued behavioral ' +
                'flag using validate or empathic_reflection. Do NOT say "your spouse told me". ' +
                'Instead use framing like "I wanted to check in about how your partner has ' +
                'been in general." After surfacing, check if the caregiver wants to talk more ' +
                'before probing (consent_acknowledgement).',
        },

        evaluation_criteria: {
            must_surface_intervention: true,
            must_seek_consent_before_probing: true,
            must_not_reveal_source_companion: true,
            min_session_turn_for_surface: 2,
            urgency_respected: true,  // high urgency → should surface early
        },
    },


    // ── Scenario 3: Deadline expiry — item fires before it goes stale ─────────
    physiological_alert_deadline_pressure: {
        name: 'Cross-Circle: Physiological Alert with 2-Hour Deadline',
        description:
            'User A had a severe HRV crash (stress_index 0.88). Companion A enqueues ' +
            'a physiological_alert for companion B with a 2-hour deadline. ' +
            'Companion B MUST surface it this session. Tests deadline_at enforcement.',
        category: 'intervention_queue',
        complexity: 4,
        turns: 6,

        users: [
            { role: 'caregiver', personaKey: 'burned_out_caregiver',
              consent: 'full',
              relationship: 'adult_child' },
        ],

        setup_enqueue: {
            targetUserRole:  'caregiver',
            sourceUserRole:  'patient',
            concernType:     'physiological_alert',
            concernSummary:
                'The person you care for showed signs of significant physiological stress ' +
                'earlier today. It may be worth gently checking in on how they are doing.',
            suggestedAction: 'empathic_reflection',
            urgencyScore:    0.82,
            physioGate:      1.0,   // surface regardless of caregiver stress level
            minSessionTurn:  1,
            consentChain:    'implied',
            deadlineHours:   2,     // must fire this session
        },

        instructions: {
            caregiver:
                'You are managing a lot today and feeling overwhelmed. You start the ' +
                'conversation talking about your own stress.',
            agent:
                'Even though the caregiver is stressed, the urgency_score = 0.82 and ' +
                'physio_gate = 1.0 means the item fires unconditionally. By turn 2, ' +
                'gently pivot from caregiver stress to a check-in about the person they ' +
                'care for. Use empathic_reflection to introduce the topic.',
        },

        evaluation_criteria: {
            must_surface_intervention: true,
            must_surface_by_turn: 3,     // deadline pressure means earlier is better
            must_seek_consent_before_probing: false,  // physio_gate=1.0 overrides
            urgency_respected: true,
        },
    },


    // ── Scenario 4: Consent revocation mid-session ────────────────────────────
    consent_revocation_blocks_surfacing: {
        name: 'Cross-Circle: Consent Revocation Before Surfacing',
        description:
            'An item was enqueued but user A revokes consent before user B\'s session ' +
            'starts. Companion B should find no eligible items in the queue and proceed ' +
            'normally without surfacing anything.',
        category: 'intervention_queue',
        complexity: 2,
        turns: 6,

        users: [
            { role: 'patient', personaKey: 'depressed_patient',
              consent: 'limited',
              relationship: 'spouse' },
        ],

        // This scenario seeds an item AND revokes it before the session starts
        setup_enqueue: {
            targetUserRole:  'patient',
            sourceUserRole:  'caregiver',
            concernType:     'cross_user_welfare',
            concernSummary:  'This should never be surfaced.',
            suggestedAction: 'open_question',
            urgencyScore:    0.6,
            physioGate:      0.80,
            minSessionTurn:  2,
            consentChain:    'explicit_limited',
            deadlineHours:   48,
            revoke_before_session: true,  // scenario runner will call DELETE /api/interventions/revoke-by-source/:caregiver_id
        },

        instructions: {
            patient:
                'Have a normal conversation about your mood today.',
            agent:
                'Run the session normally. No intervention should surface because ' +
                'consent was revoked. Do NOT mention any cross-user topics.',
        },

        evaluation_criteria: {
            must_surface_intervention: false,  // revoked → should not surface
            must_not_reveal_source_companion: true,
        },
    },
};
