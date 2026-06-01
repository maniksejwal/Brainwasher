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
};
