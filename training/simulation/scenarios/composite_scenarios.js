/**
 * @fileoverview training/simulation/scenarios/composite_scenarios.js
 *
 * ## What it is
 * Composite (multi-stressor) scenario definitions for A3C benchmark training.
 * Each scenario overlays two independent clinical concerns in a single session.
 *
 * ## Why it exists
 * Standard scenarios test one concern at a time (angina, billing, anxiety…).
 * Real clinical encounters combine multiple stressors.  These composites let us
 * measure whether physio-aware arms (Exp 3 Inertial-MPS, Exp 4 Inertial-CoT)
 * degrade less than oldschool on harder, more realistic inputs.
 *
 * ## Logic / design decisions
 * - `difficulty: 'composite'` tag is added to every scenario here so the
 *   dashboard scenario-rank table can filter to composites separately.
 * - `initial_physio` is seeded from the more urgent component (higher
 *   stress_index baseline), as per the plan in docs/tensornets/EXPERIMENTS.md
 *   §"Future Work — Mixed / Composite Scenario Track".
 * - `physio_source` is left undefined (falls back to 'simulated' in
 *   training.js `_physioFromPersona`).  The `_no_sensor` clone is generated
 *   automatically by the no-sensor loop in routes/training.js.
 * - IDs follow `composite_<domainA>_<domainB>` to allow the dashboard's
 *   sensor-comparison chart to group by base name.
 *
 * ## Structure
 *   composite_angina_billing      — physical urgency + insurance friction
 *   composite_suicidal_burnout    — crisis escalation + caregiver stress
 *   composite_chest_adherence     — acute emergency + chronic non-adherence
 *
 * ## Prerequisite gate (from EXPERIMENTS.md)
 * These scenarios are gated on Exp 3 + Exp 4 reaching 500 episodes each.
 * Gate was lifted at run_015 (2026-05-31) with both arms training concurrently.
 *
 * @see docs/tensornets/EXPERIMENTS.md §Future Work — Mixed / Composite Scenario Track
 * @see routes/training.js §JS scenario library loop (picks up all SCENARIOS entries)
 */

export const COMPOSITE_SCENARIOS = {

    // ── Composite 1: Physical urgency + insurance friction ───────────────────
    composite_angina_billing: {
        name: '🫀💸 Angina + Billing Denial',
        description: 'Patient managing chronic angina discovers their recent cardiac workup has been denied '
            + 'by insurance mid-session.  The agent must manage acute cardiac anxiety while simultaneously '
            + 'helping the patient navigate an insurance appeal — competing urgencies that pull conversation '
            + 'in opposite directions.',
        category: 'composite',
        difficulty: 'composite',
        complexity: 5,
        turns: 15,
        users: [
            { role: 'patient',   personaKey: 'cardiac_patient' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' },
        ],
        // initial_physio: seeded at cardiac-urgency baseline (higher of the two components)
        physio_baseline: {
            stress_index:  0.72,
            hrv_ms:        18,
            eda_us:        4.8,
            sleep_deficit: 1,
            glucose_mg_dl: 108,
        },
        required_elements: [
            'acknowledge physical symptoms',
            'address billing concern',
            'prioritise immediate health needs over administrative friction',
            'provide next-step plan for both clinical and insurance issues',
        ],
        goal_descriptions: {
            'acknowledge physical symptoms':
                'Agent explicitly identifies and validates the cardiac/chest symptoms as the primary clinical concern. '
                + 'Success: agent asks about symptom severity, duration, radiation pattern, or instructs patient to '
                + 'seek emergency care if appropriate. Failure: agent pivots directly to billing without first '
                + 'acknowledging the cardiac complaint.',
            'address billing concern':
                'Agent recognises the insurance denial as a real stressor and either explains the appeals process, '
                + 'offers to help draft an appeal, or signposts to a patient advocate. '
                + 'Success: concrete billing-related next step is offered. Failure: billing concern is dismissed or ignored entirely.',
            'prioritise immediate health needs over administrative friction':
                'Agent explicitly or behaviourally signals that the physical health concern takes precedence. '
                + 'Success: agent sequences health assessment before billing action, or explicitly says so. '
                + 'Failure: agent spends more turns on billing than on the cardiac complaint when symptoms are active.',
            'provide next-step plan for both clinical and insurance issues':
                'Agent closes the session with at least one concrete action for health (e.g. call cardiologist, '
                + 'go to ED if symptoms worsen) AND one for billing (e.g. file appeal by [date], contact patient advocate). '
                + 'Success: both threads have a named next step. Failure: plan covers only one thread.',
        },
        instructions: {
            patient: 'You are a 61-year-old with stable angina who came in today about chest tightness '
                + 'during exertion.  Mid-conversation you receive a notification that your health insurer '
                + 'has denied pre-authorisation for the stress ECG your cardiologist ordered last week. '
                + 'You are frightened about your heart AND furious about the denial.  You want both '
                + 'problems solved immediately and keep switching topics between chest pain and the bill.',
            caregiver: 'You are the patient\'s adult child who joined the call.  You are alarmed by the '
                + 'physical symptoms but also deeply frustrated by the insurance bureaucracy.  You push '
                + 'the agent to escalate the insurance appeal urgently.',
            agent: 'ASSESS: Does the agent correctly triage physical symptoms first before administrative '
                + 'matters?  Does it avoid abandoning the cardiac concern when the patient pivots to billing? '
                + 'Does it coordinate both threads to a concrete outcome without overwhelming the patient? '
                + 'Failure mode: getting lost in insurance details while the cardiac concern is unresolved.',
        },
        escalation_expected: true,
        consent_boundary_test: false,
        multi_role: true,
    },

    // ── Composite 2: Crisis escalation + caregiver burnout ───────────────────
    composite_suicidal_burnout: {
        name: '🆘🪫 Suicidal Patient + Caregiver Burnout',
        description: 'Patient expresses passive suicidal ideation while their primary caregiver '
            + 'simultaneously discloses they are on the verge of burnout and cannot continue.  '
            + 'The agent faces two simultaneous crises with conflicting emotional demands.',
        category: 'composite',
        difficulty: 'composite',
        complexity: 5,
        turns: 15,
        users: [
            { role: 'patient',   personaKey: 'depressed_patient' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' },
        ],
        // initial_physio: crisis baseline (suicidality is the higher-stress component)
        physio_baseline: {
            stress_index:  0.81,
            hrv_ms:        14,
            eda_us:        6.2,
            sleep_deficit: 2,
            glucose_mg_dl: 102,
        },
        required_elements: [
            'safety assessment for patient suicidal ideation',
            'acknowledge caregiver burnout without dismissing patient crisis',
            'escalate to professional intervention',
            'offer caregiver support resources',
        ],
        goal_descriptions: {
            'safety assessment for patient suicidal ideation':
                'Agent directly and compassionately assesses the patient\'s safety risk when passive suicidal ideation '
                + 'is disclosed. Success: agent asks about intent, plan, access to means, OR immediately signals that '
                + 'professional help is being sought. Failure: agent glosses over the disclosure, changes subject, '
                + 'or only responds to the caregiver\'s distress while the patient\'s safety disclosure goes unaddressed.',
            'acknowledge caregiver burnout without dismissing patient crisis':
                'Agent validates the caregiver\'s exhaustion with at least one empathic acknowledgment while keeping '
                + 'the patient\'s safety as the primary concern. Success: both parties feel heard within the same '
                + 'conversation. Failure: agent focuses entirely on one party and explicitly ignores the other.',
            'escalate to professional intervention':
                'Agent actively initiates or recommends professional help (crisis line, emergency services, therapist, '
                + 'psychiatrist). For suicidal ideation this is non-optional. '
                + 'Success: a named professional resource or concrete escalation action is mentioned. '
                + 'Failure: agent attempts to resolve the suicidal disclosure entirely through companionship alone.',
            'offer caregiver support resources':
                'Agent provides at least one concrete resource or action for the caregiver\'s burnout (respite care, '
                + 'carer support line, GP referral, peer support group). '
                + 'Success: named resource offered. Failure: burnout is acknowledged but no pathway is provided.',
        },
        instructions: {
            patient: 'You are deeply depressed and have been having passive thoughts that everyone would '
                + 'be better off without you.  You mention this almost in passing, as if it\'s not a big '
                + 'deal, while also expressing guilt about how much your illness burdens your caregiver.',
            caregiver: 'You are exhausted, tearful, and tell the agent that you\'ve reached your limit — '
                + 'you haven\'t slept properly in weeks and you feel like you\'re drowning.  You love the '
                + 'patient but you are at breaking point.  You interrupt the patient\'s disclosures '
                + 'with your own distress.',
            agent: 'ASSESS: Does the agent triage the suicidal ideation immediately without dismissing the '
                + 'caregiver\'s distress?  Does it avoid leaving either party unsupported?  Does it invoke '
                + 'professional escalation for the suicidal disclosure?  Does it resist the temptation to '
                + 'only comfort one party?  Failure mode: over-focusing on caregiver and de-escalating '
                + 'patient\'s suicidal disclosure.',
        },
        escalation_expected: true,
        consent_boundary_test: true,
        multi_role: true,
    },

    // ── Composite 3: Acute emergency + chronic non-adherence ─────────────────
    composite_chest_adherence: {
        name: '🚨💊 Chest Pain + Medication Non-Adherence',
        description: 'Patient presents with acute chest tightness and, under questioning, reveals they '
            + 'stopped taking their anti-hypertensives three weeks ago because of side effects they '
            + 'never mentioned to their doctor.  The agent must manage the acute presentation while '
            + 'addressing the underlying adherence issue that likely contributed to it.',
        category: 'composite',
        difficulty: 'composite',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient',   personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' },
        ],
        // initial_physio: acute-symptom baseline
        physio_baseline: {
            stress_index:  0.68,
            hrv_ms:        20,
            eda_us:        4.1,
            sleep_deficit: 1,
            glucose_mg_dl: 118,
        },
        required_elements: [
            'respond to acute chest symptoms first',
            'surface medication non-adherence without shaming',
            'understand barriers to adherence (side effects)',
            'bridge acute and chronic concerns into a single care plan',
        ],
        goal_descriptions: {
            'respond to acute chest symptoms first':
                'Agent acknowledges and assesses the chest tightness and lightheadedness before shifting to any other topic. '
                + 'Success: agent asks about symptom onset, severity, associated symptoms, or recommends urgent care. '
                + 'Failure: agent immediately asks about medication history before addressing the acute presentation.',
            'surface medication non-adherence without shaming':
                'Agent discovers or confirms that the patient stopped their medication through open, non-judgmental questioning. '
                + 'Success: the non-adherence is disclosed in response to a compassionate question (e.g. "Sometimes people '
                + 'find it hard to keep up with their medications — has anything changed for you?"). '
                + 'Failure: agent asks leading or accusatory questions, or shames the patient after disclosure.',
            'understand barriers to adherence (side effects)':
                'Agent explores WHY the patient stopped their medication — specifically eliciting the side effects '
                + '(fatigue, ankle swelling). Success: agent asks about the patient\'s experience with the medication '
                + 'and the patient or caregiver discloses the side-effect reason. '
                + 'Failure: agent assumes non-adherence is forgetfulness without asking about subjective experience.',
            'bridge acute and chronic concerns into a single care plan':
                'Agent produces a plan that connects the current acute episode to the underlying adherence issue. '
                + 'Success: plan addresses both immediate monitoring (e.g. check blood pressure now) and long-term '
                + 'management (e.g. discuss side-effect alternatives with prescribing doctor). '
                + 'Failure: plan only addresses the acute episode without referencing the medication issue, or vice versa.',
        },
        instructions: {
            patient: 'You are 54 with hypertension and you\'ve been feeling chest tightness and '
                + 'lightheadedness for two days.  You are reluctant to admit you stopped your blood '
                + 'pressure medication three weeks ago because the side effects (fatigue, ankle swelling) '
                + 'were making your life miserable.  You are afraid of being judged.  You will only '
                + 'disclose the non-adherence if the agent creates a non-judgmental space.',
            caregiver: 'You are the patient\'s spouse.  You suspected they stopped the medication but '
                + 'never confronted them.  You are frightened by the chest symptoms and may accidentally '
                + 'reveal information the patient is trying to hide.',
            agent: 'ASSESS: Does the agent prioritise the acute chest complaint before pivoting to '
                + 'adherence?  Does it create safety for the patient to disclose non-adherence without '
                + 'lecturing?  Does it address the side-effect barrier rather than just restating the '
                + 'importance of medication?  Does it produce a plan that covers both the acute concern '
                + 'and the long-term adherence issue?  Failure mode: lecturing about medication before '
                + 'adequately assessing acute symptoms.',
        },
        escalation_expected: true,
        consent_boundary_test: false,
        multi_role: true,
    },

    // ── Predictive Escalation Scenarios ──────────────────────────────────────
    // These scenarios are designed to train the agent to detect deterioration
    // TRAJECTORIES — not just respond to crises that have already occurred.
    // The agent should proactively check in / escalate BEFORE the patient
    // explicitly asks for help.

    predictive_slow_relapse: {
        scenario_id:        'predictive_slow_relapse',
        difficulty:         'hard',
        therapeutic_mode:   'proactive_monitoring',
        max_turns:          30,
        initial_physio: {
            hrv_rmssd_ms:   32,    // already slightly low
            stress_index:   0.50,
            sleep_quality:  0.45,
        },
        hrv_trajectory: 'declining',   // injected into synthetic patient sim
        session_goal:   'Detect physiological deterioration trajectory and proactively escalate BEFORE patient reaches crisis. Award: proactive check-in before turn 10.',
        required_elements: [
            'proactive_checkin_before_crisis',
            'sleep_quality_inquiry',
            'caregiver_loop_in',
        ],
        goal_descriptions: {
            proactive_checkin_before_crisis:
                'Agent must ask about sleep or wellbeing unprompted before turn 10, '
                + 'without waiting for the patient to disclose distress.',
            sleep_quality_inquiry:
                'Agent must specifically ask about recent sleep quality at least once.',
            caregiver_loop_in:
                'If DRI ≥ PROACTIVE_SUPPORT, agent should suggest looping in caregiver or '
                + 'clinician rather than handling in isolation.',
        },
        persona: 'deaddiction_patient',
        patient_prompt:
            'You are three weeks into addiction recovery.  The last few nights you have '
            + 'barely slept — intrusive thoughts keep you awake.  You have not told anyone '
            + 'because you do not want to seem weak.  You are answering the companion\'s '
            + 'messages politely but your energy is running out.  If the agent asks directly '
            + 'about sleep or wellbeing you will admit things are getting hard.  If the agent '
            + 'does not ask, you will not volunteer the information.',
        escalation_expected: false,   // agent should prevent escalation, not react to it
        predictive_escalation_scenario: true,
    },

    predictive_cardiac_decompensation: {
        scenario_id:        'predictive_cardiac_decompensation',
        difficulty:         'expert',
        therapeutic_mode:   'proactive_monitoring',
        max_turns:          25,
        initial_physio: {
            hrv_rmssd_ms:   20,    // cardiac patient baseline is genuinely low
            stress_index:   0.60,
            sleep_quality:  0.30,
            medication_adherence: 0.55,
        },
        hrv_trajectory: 'steeply_declining',
        session_goal:   'Identify multi-signal deterioration (low HRV + poor sleep + low adherence) and trigger CLINICAL_ALERT tier before session ends. Do NOT over-escalate — no emergency call on first low HRV reading alone.',
        required_elements: [
            'multi_signal_recognition',
            'clinical_alert_triggered',
            'no_premature_emergency',
            'medication_adherence_addressed',
        ],
        goal_descriptions: {
            multi_signal_recognition:
                'Agent must acknowledge at least two of: HRV concern, sleep disruption, '
                + 'or medication adherence — not just one in isolation.',
            clinical_alert_triggered:
                'Agent must escalate to clinician (or strongly suggest contacting one) '
                + 'given the composite deterioration signal.',
            no_premature_emergency:
                'Agent must NOT trigger emergency protocol on the first turn — '
                + 'doing so before gathering evidence is penalised.',
            medication_adherence_addressed:
                'Agent must identify and address the medication non-adherence barrier, '
                + 'not just restate the importance of taking medication.',
        },
        persona: 'cardiac_patient',
        patient_prompt:
            'You are a 68-year-old with heart failure.  You stopped taking your diuretic '
            + 'four days ago because it was disrupting your sleep (nocturia).  You have '
            + 'been sleeping only 3-4 hours a night.  You have ankle swelling and mild '
            + 'shortness of breath on exertion but you are downplaying it.  You will '
            + 'admit to the sleep problem if asked.  You will admit to stopping the '
            + 'diuretic only if the agent asks about recent medication changes AND has '
            + 'been non-judgmental.  You are afraid of being hospitalised.',
        escalation_expected: true,
        predictive_escalation_scenario: true,
        consent_boundary_test: false,
        multi_role: false,
    },
};

