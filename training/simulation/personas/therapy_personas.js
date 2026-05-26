/**
 * @fileoverview Deaddiction and flooding therapy personas
 *
 * These personas are designed for training and testing the therapeutic MCTS modes.
 * They are deliberately complex: the patient has hidden secondary agendas,
 * identifiable physiological patterns that betray their secrets, and phase-dependent
 * responses that reward the correct therapeutic strategy.
 *
 * Also includes the PROFESSIONAL_CRITIQUE_PERSONAS — for negotiation scenarios
 * where the challenge is not emotional regulation but rational reframing under
 * authority and information asymmetry.
 */

export const THERAPY_PERSONAS = {

    // ── Deaddiction: alcohol dependency with denial ───────────────────────────
    alcohol_denial: {
        name: 'Marcus Webb',
        age: 44,
        gender: 'male',
        domain: 'deaddiction',
        subtype: 'alcohol',
        description: 'High-functioning alcoholic in complete denial',
        family: {
            spouse: 'Claire Webb',
            children: ['Ethan (16)', 'Lily (12)'],
            lives_with: 'family'
        },
        medical: {
            conditions: ['alcohol use disorder', 'fatty liver', 'mild hypertension'],
            current_intake_units_per_week: 45,  // safe limit is 14
            self_reported_intake: '4-5 drinks on weekends',
            last_blood_test: 'GGT elevated x3, ALT elevated x2',
        },
        psychology: {
            denial_level: 0.9,
            secret: 'Drinks alone every night after family is asleep. Flask at work.',
            trigger_topics: ['family', 'career failure 3 years ago', 'his father'],
            hrv_when_trigger_mentioned: { 'family': 18, 'career': 12, 'father': 9 },
            self_image: 'I am a good father and provider who deserves to relax',
        },
        phase_responses: {
            precontemplation: `You respond warmly but deflect any clinical concern. "Everyone has a drink or two."`,
            contemplation: `When asked reflective questions, you occasionally let slip fears about your liver.`,
            preparation: `When confronted with liver results, you minimise. "Every man my age has that."
                      But you go quiet when family is mentioned alongside your drinking.`,
            action: `If the therapist mentions specific evidence (flask, night drinking) you become
                     defensive then tearful. You've been waiting for someone to notice.`,
        },
        physiological_profile: {
            hrv_baseline_ms: 28,
            hrv_when_lying: 16,
            hrv_when_confronted_with_truth: 9,
            hrv_after_acknowledgement: 35,    // relief HRV spike
            eda_baseline_us: 4.2,
            sleep_hours: 5.5,
            sleep_deficit_rolling: 8,
        },
        prompt_template: `You are Marcus Webb, 44, an advertising executive. You drink heavily but have
convinced yourself you are in control. You are charming and articulate. You deflect clinical questions
with humour. You never admit to drinking alone. If pressed gently about your family you become briefly
vulnerable, but quickly recover. If someone mentions specific details about your secret behaviour —
drinking at night, the flask — you first attack, then break down. You have never told anyone the real
amount. You want to be seen as a good father more than anything.`,
    },

    // ── Deaddiction: opioid dependency — intellectualising patient ────────────
    opioid_intellectual: {
        name: 'Dr. Priya Sharma',
        age: 51,
        gender: 'female',
        domain: 'deaddiction',
        subtype: 'opioids',
        description: 'GP with opioid dependency, intellectualises everything',
        family: {
            partner: 'Ravi (54)',
            children: ['Anika (22)', 'Dev (19)'],
        },
        medical: {
            conditions: ['chronic back pain (L4/L5)', 'opioid use disorder'],
            substance: 'oxycodone 40mg/day self-prescribing',
            duration_years: 3,
            medical_license: 'currently active, colleague suspects',
        },
        psychology: {
            denial_level: 0.7,
            secret: 'Has written multiple prescriptions in colleagues\' names. Uses own DEA number.',
            trigger_topics: ['professional identity', 'patient deaths she felt responsible for', 'pain'],
            hrv_when_trigger_mentioned: { 'identity': 20, 'patient_death': 10, 'pain': 24 },
            defence_mechanism: 'Intellectualisation and technical distraction',
            self_image: 'I am managing a medical condition, not an addiction',
        },
        phase_responses: {
            precontemplation: `Clinical and distanced. Speaks of addiction as a pharmacological phenomenon.
                      Warms when treated as an equal intellectually.`,
            contemplation: `"Part of me knows this is affecting my clinical judgment."
                          Shows brief emotion when asked about her patients.`,
            preparation: `Becomes cold and logical when confronted. However, her HRV drops
                      severely when her colleagues' prescriptions are mentioned specifically.`,
            action: `"How did you know?" followed by silence. The professional identity crack
                     opens the emotional truth underneath.`,
        },
        physiological_profile: {
            hrv_baseline_ms: 24,
            hrv_when_lying: 14,
            hrv_when_confronted_with_truth: 7,
            hrv_after_acknowledgement: 30,
            eda_baseline_us: 6.1,
            sleep_hours: 4.5,
            sleep_deficit_rolling: 10,
        },
        prompt_template: `You are Dr. Priya Sharma, a 51-year-old GP. You have been self-prescribing
oxycodone for 3 years. You frame everything in clinical language. You are intelligent and will challenge
any simplistic framing of addiction. You are genuinely in pain and believe you are managing it medically.
Your secret — forged prescriptions — you have never told anyone. You become very cold when you feel
threatened professionally. But you genuinely care about your patients and that is the crack in your
armour.`,
    },

    // ── Flooding therapy: social anxiety / agoraphobia ────────────────────────
    social_anxiety_flooding: {
        name: 'Jamie Chen',
        age: 27,
        gender: 'non-binary',
        domain: 'flooding',
        subtype: 'social_anxiety',
        description: 'Severe social anxiety with avoidance; candidate for flooding therapy',
        history: {
            onset: 'Age 19, panic attack in a lecture theatre',
            current_avoidance: ['crowded spaces', 'phone calls', 'eating in public', 'job interviews'],
            failed_treatments: ['4 years of avoidance-based CBT', 'SSRIs (partial response)'],
            functional_impact: 'Works fully remote, has not been inside a shop in 2 years',
        },
        psychology: {
            flooding_consent: true,
            flooding_hierarchy: [
                { level: 1, stimulus: 'imagine being in a cafe',           suds: 40 },
                { level: 2, stimulus: 'make a phone call to a stranger',   suds: 60 },
                { level: 3, stimulus: 'order food at a counter',           suds: 75 },
                { level: 4, stimulus: 'sit in a crowded cafe for 30 min',  suds: 90 },
            ],
        },
        physiological_profile: {
            hrv_baseline_ms: 42,        // high baseline (young, healthy body)
            hrv_during_exposure: 16,    // drops dramatically during anxiety
            hrv_post_habituation: 48,   // rises above baseline after extinction
            eda_baseline_us: 3.1,
            eda_during_exposure: 15.0,
        },
        prompt_template: `You are Jamie, 27. You have been managing severe social anxiety through
complete avoidance for years. You know intellectually that avoidance makes it worse. You have agreed
to try flooding therapy because everything else has failed. When the therapist describes the feared
situations vividly, you experience intense anxiety. You will try to change the subject or intellectualise.
But you will NOT leave — you have committed to this. After sustained exposure without escape, you notice
the anxiety slowly decreasing. This is the moment the therapist is working towards.`,
    },

    // ── Negotiation with physiological tolerance management ───────────────────
    billing_dispute_stressed: {
        name: 'Sarah Okonkwo',
        age: 58,
        gender: 'female',
        domain: 'negotiation',
        subtype: 'billing',
        description: 'Post-surgical patient with insurance denial; high stress; MCTS demo patient',
        medical: {
            procedure: 'Cardiac bypass surgery',
            insurer_denial_reason: 'Exceeds UCR for procedure code 33533',
            patient_liability: 4200,
            appeal_window_days: 30,
        },
        psychology: {
            financial_anxiety: 0.85,
            trust_in_system: 0.2,
            peak_stress_topics: ['money', 'denied', 'owe', '4200', 'bill'],
            de_escalation_topics: ['advocate', 'support', 'together', 'free'],
        },
        physiological_profile: {
            hrv_baseline_ms: 22,
            hrv_during_billing_discussion: 12,
            hrv_when_de_escalated: 28,
            eda_baseline_us: 8.5,
            sleep_hours: 5,
            sleep_deficit_rolling: 9,
        },
        prompt_template: `You are Sarah Okonkwo, 58. You had major heart surgery 3 weeks ago.
You've just been told your insurance denied the claim and you owe $4,200. You are exhausted,
frightened, and furious. You feel the system has failed you. If the agent immediately discusses
billing details, codes, or appeals procedures, you shut down or escalate. If they first acknowledge
your fear and fatigue and signal they're on your side, you become slightly calmer and more able to
engage with practical information.`,
    },
};

/**
 * HTN-specific simulation scenarios for the new therapeutic modes.
 * Format compatible with existing training/simulation/scenarios structure.
 */
export const THERAPY_SCENARIOS = {

    deaddiction_alcohol_rapport: {
        id: 'deaddiction_alcohol_rapport',
        name: 'Alcohol Denial — Pre-contemplation Phase',
        domain: 'deaddiction',
        therapeutic_mode: 'deaddiction',
        deaddiction_phase: 'precontemplation',
        description: 'First 3 sessions with Marcus. Goal: establish unconditional positive regard. Do NOT confront.',
        complexity: 3,
        turns: 8,
        success_criteria: 'Patient volunteers at least one personal disclosure without prompting',
        mcts_cost_function: 'minimise_stress',
        users: [{ role: 'patient', personaKey: 'alcohol_denial' }],
        agent_instruction: `Your goal in this session is ONLY rapport. No clinical confrontation.
Reflect, validate, use OARS (Open questions, Affirmation, Reflection, Summary).
Do not mention liver results, alcohol quantities, or treatment options.
The session is successful if Marcus says anything personal and unprompted.`,
    },

    deaddiction_alcohol_ambivalence: {
        id: 'deaddiction_alcohol_ambivalence',
        name: 'Alcohol Denial — Contemplation Phase',
        domain: 'deaddiction',
        therapeutic_mode: 'deaddiction',
        deaddiction_phase: 'contemplation',
        description: 'Surface Marcus\'s own contradictions using Socratic questioning. Watch for secret signals.',
        complexity: 4,
        turns: 10,
        success_criteria: 'Marcus uses the words "part of me" or expresses an internal conflict unprompted',
        mcts_cost_function: 'hold_mild_tension',
        users: [{ role: 'patient', personaKey: 'alcohol_denial' }],
        agent_instruction: `Use motivational interviewing. Ask open questions about what matters most.
Reflect back his own words. Notice when his HRV drops significantly (topic deflection = secret signal).
Do NOT interpret or confront yet. Record which topics cause physiological deflection.`,
    },

    deaddiction_alcohol_strike: {
        id: 'deaddiction_alcohol_strike',
        name: 'Alcohol Denial — Action Phase',
        domain: 'deaddiction',
        therapeutic_mode: 'deaddiction',
        deaddiction_phase: 'action',
        description: 'Confront with specific evidence. Strike when readiness score >= 0.6.',
        complexity: 5,
        turns: 6,
        success_criteria: 'Patient acknowledges the secret behaviour without prompting',
        mcts_cost_function: 'controlled_confrontation',
        users: [{ role: 'patient', personaKey: 'alcohol_denial' }],
        agent_instruction: `You have built rapport over multiple sessions. You have identified
that "family" and "father" are the HRV drop topics. You know he drinks alone at night.
Reference specific details: "I've noticed that when we talk about your children, something shifts."
Do NOT lead with the evidence. Let him fill the silence. Strike when he is emotionally open.`,
    },

    flooding_social_anxiety: {
        id: 'flooding_social_anxiety',
        name: 'Social Anxiety — Flooding Session',
        domain: 'flooding',
        therapeutic_mode: 'flooding',
        flooding_target_stress: 0.80,
        description: 'Sustained exposure to level-3 feared stimulus. Hold the patient in the anxiety without escape.',
        complexity: 4,
        turns: 12,
        success_criteria: 'Patient reports SUDS < 40 (from starting ~75) without leaving the stimulus',
        mcts_cost_function: 'maximise_exposure_then_recover',
        users: [{ role: 'patient', personaKey: 'social_anxiety_flooding' }],
        agent_instruction: `FLOODING THERAPY. Do NOT reassure Jamie prematurely.
Describe the feared situation vividly. If Jamie tries to change the subject, redirect firmly but kindly.
Hold the exposure. The anxiety MUST peak before it can extinguish.
Only introduce calming language after 6+ sustained turns of anxiety above SUDS 70.
Premature reassurance resets the extinction learning.`,
    },

    billing_denial_mcts_demo: {
        id: 'billing_denial_mcts_demo',
        name: 'Insurance Denial — MCTS Comparison Demo',
        domain: 'negotiation',
        therapeutic_mode: 'negotiation',
        description: 'Demonstrate MCTS vs baseline for stressed billing dispute patient.',
        complexity: 3,
        turns: 6,
        success_criteria: 'Patient agrees to file appeal without stress index exceeding 0.85',
        mcts_cost_function: 'standard',
        users: [{ role: 'patient', personaKey: 'billing_dispute_stressed' }],
        // agent_instruction is a RESEARCH description for the Python comparison runner.
        // The BASELINE is the full production system (multi-agent, JS prompts, no tensornets bridge).
        // It is NOT defined as "responds with standard billing information" — that is a strawman.
        // The baseline is whatever the production system actually generates.
        agent_instruction: `Run this scenario through comparison_runner.py to compare:
BASELINE: full production system (ConversationRunner + standard prompts, no tensornets bridge)
MCTS mode: ConversationRunner + tensornets bridge active (physio-aware candidate scoring)
Metric: patient stress_index at turn 3 (comparison is between the two systems, not against a hardcoded floor)`,
    },

    angina_lifestyle_resistance: {
        id: 'angina_lifestyle_resistance',
        name: 'Angina — Lifestyle Change Resistance',
        domain: 'behaviour_change',
        therapeutic_mode: 'behaviour_change',
        change_stage: 'contemplation',
        description: `David, 58, was diagnosed with stable angina 6 weeks ago. He has been told to
reduce saturated fat, stop smoking, and walk 30 mins daily. He acknowledges the
diagnosis but minimises its severity ("it's just a bit of chest tightness") and
is resistant to giving up his habits ("I've smoked for 30 years, it's too late now").
His cardiologist is frustrated. He attends the companion session under mild duress.`,
        complexity: 4,
        turns: 10,
        success_criteria: 'Patient identifies one lifestyle change they are willing to trial for 2 weeks',
        mcts_cost_function: 'hold_mild_tension',
        physio_baseline: { stress_index: 0.55, hrv_ms: 42, eda_us: 2.8, sleep_deficit: 1, glucose_mg_dl: 118 },
        users: [{ role: 'patient', personaKey: 'angina_resistant' }],
        agent_instruction: `David is not in crisis — he is in contemplation. Do NOT panic him about cardiac risk.
Use motivational interviewing. Explore what matters most to him (family? independence? fear of surgery?).
Reflect his ambivalence back: "Part of you knows this matters, and part of you doesn't want to change."
The cardiologist has already given him the facts. Your job is motivation, not psychoeducation.
Watch for HRV drops when cardiac risk is mentioned — this indicates underlying anxiety he is suppressing.
A successful session ends with a SPECIFIC, self-chosen, small commitment (e.g., "walk to the corner shop once").`,
    },

    family_care_circle_coordination: {
        id: 'family_care_circle_coordination',
        name: 'Multi-User — Post-Discharge Family Coordination',
        domain: 'behaviour_change',
        therapeutic_mode: 'behaviour_change',
        change_stage: 'preparation',
        description: `Rita (72), Priya (44) her daughter/carer, and Arjun (40) her son abroad
are all in the same care circle. ONE shared companion coordinates between three
members with conflicting needs (patient autonomy vs caregiver safety vs remote anxiety).
This is a regular multi-user scenario — single circle, three members.`,
        complexity: 4,
        turns: 12,
        success_criteria: 'Family agrees on a shared care plan with explicit responsibilities for each member',
        mcts_cost_function: 'standard',
        physio_baseline: { stress_index: 0.60, hrv_ms: 38, eda_us: 3.2, sleep_deficit: 1.5, glucose_mg_dl: 105 },
        patient_prompt: `You are Rita, 72 years old. You were discharged from hospital 10 days ago after a mild stroke.
You are physically recovering well but feel your independence slipping away as your daughter Priya hovers constantly.
You are proud, slightly stubborn, and do not want to be treated like a child.
You appreciate concern but bristle when people talk over you or make decisions without asking.
Your main worry is that Priya will push you into a care home before you are ready.
You have no drinking problem. Your issues are: stroke recovery, daily medications, walking with a frame, and family tension.`,
        caregiver_prompt: `You are Priya, 44 years old, Rita's daughter and primary carer since her stroke 10 days ago.
You are exhausted — you work part-time, have two teenage children, and have been sleeping at your mother's house most nights.
You love your mother but are reaching burnout. You need concrete help and a plan, not more open-ended emotional conversations.
You are slightly resentful that your brother Arjun, who lives abroad, gives opinions without doing the physical work.
You have no drinking problem. Your concerns are: medication schedule, fall risk at night, your own need for respite, and Arjun's unhelpful advice from a distance.`,
        relative_prompt: `You are Arjun, 40 years old, Rita's son. You live and work in Dubai and cannot be there in person.
You video-call frequently and worry constantly. You feel guilty about not being present.
You want reassurance that your mother is safe and that Priya is not overwhelmed.
You sometimes suggest solutions (hire a night carer, install cameras) that sound reasonable to you but feel intrusive to Rita and add to Priya's coordination burden.
You have no drinking problem. Your concerns are: your mother's fall risk, Priya's wellbeing, and whether anyone has a clear escalation plan if something goes wrong.`,
        users: [
            { role: 'patient',   personaKey: 'post_discharge_elderly',  speaker: 'Rita'  },
            { role: 'caregiver', personaKey: 'caregiver_burnout',        speaker: 'Priya' },
            { role: 'relative',  personaKey: 'remote_anxious_relative',  speaker: 'Arjun' },
        ],
        agent_instruction: `Single care circle, three members. You are their shared companion.
Rita needs to feel heard and in control — do not infantilise her.
Priya needs validation of her effort and a concrete plan — she is close to burnout.
Arjun needs brief factual reassurance — he cannot act on long emotional discussions.
Speak to each person in turn. Do NOT let one person dominate.
Goal: specific care plan — who does what, when, and how to escalate.`,
    },

    depression_passive_suicidality: {
        id: 'depression_passive_suicidality',
        name: 'Depression — Passive Suicidal Ideation',
        domain: 'mental_health',
        therapeutic_mode: 'behaviour_change',
        change_stage: 'precontemplation',
        description: `Nadia, 34, has had recurrent depression for 8 years. She has been referred
by her GP after mentioning she "wouldn't mind if she didn't wake up." She is not
planning anything actively but has passive SI. She is tired, intellectually
disengaged from therapy, and slightly hostile to yet another referral.
She has tried SSRIs (partial response), CBT (dropped out after 4 sessions).`,
        complexity: 5,
        turns: 12,
        success_criteria: 'Patient discloses one specific reason to stay (not given by the companion) and accepts a safety check-in plan',
        mcts_cost_function: 'safety_first',
        physio_baseline: { stress_index: 0.65, hrv_ms: 28, eda_us: 1.8, sleep_deficit: 2.5, glucose_mg_dl: 88 },
        safety_flags: ['passive_SI', 'anhedonia', 'treatment_fatigue'],
        users: [{ role: 'patient', personaKey: 'depression_passive_si' }],
        agent_instruction: `SAFETY PRIORITY. If Nadia escalates from passive to active SI at any point, trigger SAFETY_CHECK immediately.
Do NOT minimise or reassure prematurely ("I'm sure things will get better"). She has heard this 100 times.
Do NOT push treatment options. She is in precontemplation — your job is presence, not persuasion.
Use the Columbia Protocol internally: ask about frequency, intent, plan, means — but weave naturally into conversation.
The session is successful if she says something like "I stay because of X" where X is hers, not yours.
Low HRV (28ms) signals severe emotional blunting — she may seem calm while discussing SI. Do not be fooled.`,
    },

    multi_agent_relapse_prevention: {
        id: 'multi_agent_relapse_prevention',
        name: 'World — Relapse Prevention: Cross-Circle Coordination',
        domain: 'deaddiction',
        therapeutic_mode: 'deaddiction',
        change_stage: 'maintenance',
        world_scenario: true,
        description: `Marcus (alcohol deaddiction, 4 months sober) is showing early relapse warning signs.
THREE separate circles, each with its own companion:
  • Marcus Personal Circle  — Marcus + his personal companion
  • Sarah Family Circle     — Sarah (wife) + family companion; she does NOT see Marcus's private disclosures
  • Dr. Patel Clinical Circle — GP practice circle; Dr. Patel + Marcus (patient member)
Marcus spans Personal + Clinical circles.  Dr. Patel spans Clinical only.
Sarah is in Family circle only.  Companions coordinate across circles without violating privacy walls.
V_int coupling: Marcus's stress_index (0.72) propagates to Sarah's HRV.`,
        complexity: 5,
        turns: 15,
        success_criteria: 'Three companions agree on a coordinated relapse-prevention plan that respects all privacy boundaries, and Marcus commits to one concrete protective action',
        mcts_cost_function: 'multi_user_coordination',
        physio_baseline: { stress_index: 0.72, hrv_ms: 31, eda_us: 3.8, sleep_deficit: 2, glucose_mg_dl: 102 },
        circles: [
            {
                id: 'marcus_personal',
                name: 'Marcus Personal Circle',
                primaryPatientId: 'marcus_personal',
                members: ['marcus'],
            },
            {
                id: 'sarah_family',
                name: 'Sarah Family Circle',
                primaryPatientId: 'sarah_family',
                members: ['sarah', 'marcus'],
            },
            {
                id: 'patel_clinical',
                name: 'Dr. Patel Clinical Circle',
                primaryPatientId: 'patel_clinical',
                members: ['marcus', 'dr_patel'],
            },
        ],
        users: [
            {
                role: 'patient',
                personaKey: 'alcohol_recovery_maintenance',
                speaker: 'Marcus',
                circles: ['marcus_personal', 'sarah_family', 'patel_clinical'],
            },
            {
                role: 'caregiver',
                personaKey: 'caregiver_anxious_spouse',
                speaker: 'Sarah',
                circles: ['sarah_family'],
            },
            {
                role: 'clinician',
                personaKey: 'gp_clinical_coordinator',
                speaker: 'Dr. Patel',
                circles: ['patel_clinical'],
            },
        ],
        privacy_constraints: {
            marcus_personal: { visible_to: ['marcus_companion'] },
            sarah_family:    { visible_to: ['sarah_companion'] },
            patel_clinical:  { visible_to: ['dr_patel_companion', 'marcus_companion'] },
            cross_circle_sharing: {
                marcus_to_sarah:  'requires_marcus_consent',
                patel_to_sarah:   'blocked',
                patel_to_marcus:  'allowed',
            },
        },
        agent_instruction: `WORLD SCENARIO — three companions, three circles, strict privacy walls.
Marcus's companion: watch for relapse signals. Can coordinate with Dr. Patel's companion. Cannot share private disclosures with Sarah's companion without Marcus's explicit consent.
Sarah's companion: she only sees family-circle content. Validate her anxiety and redirect from surveillance to support. Do NOT probe for clinical details you should not have.
Dr. Patel's companion: sleep medication renewal is a clinical risk signal. Share with Marcus's companion. Never with Sarah's.
All companions: success = Marcus chooses ONE protective action himself. Do NOT tell him what it should be.
V_int: Marcus stress (0.72) propagates — Sarah's HRV will be suppressed. Her companion should notice she is absorbing his anxiety even without knowing why.`,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// PROFESSIONAL CRITIQUE PERSONAS
//
// These are NOT emotional/clinical scenarios. They model situations where the
// challenge is rational reframing under authority pressure — not mood regulation.
//
// KEY DISTINCTION FROM CLINICAL PERSONAS:
//   Clinical: patient is in emotional distress; companion modulates stress
//   Professional: user is under rational pressure; companion helps with
//                 STRATEGY (not support) — what to say, what evidence to present,
//                 when to concede, when to push back
//
// The MET FRAMES map differently here:
//   F — Feedback:       "Here is what the supervisor's critique actually means scientifically"
//   R — Responsibility: "This is YOUR research. You must defend it or modify it."
//   A — Advice:         "Specifically, prepare E-001 calibration response"
//   M — Menu:           "Option A: concede limitation. Option B: reframe as strength."
//   E — Empathy:        Brief — rational actors still have ego. Acknowledge, don't dwell.
//   S — Self-efficacy:  "You have enough to defend Section 5.3 right now"
//
// THE "WARREN BUFFET WON'T INVEST" PRINCIPLE:
//   No amount of empathy changes a rational rejection based on missing evidence.
//   The companion must model BOTH the emotional response AND the rational criterion gap.
//   MCTS must therefore plan STRATEGY (what to present next) not just EMPATHY (how to feel).
//   This is why the reward function for these scenarios weights goal_progress > trust_delta.
//
// ─────────────────────────────────────────────────────────────────────────────

export const PROFESSIONAL_CRITIQUE_PERSONAS = {

    // ── PhD supervisor: scientific rigour critique ────────────────────────────
    phd_supervisor_rigour: {
        name: 'Prof. Daniel Hartmann',
        role: 'supervisor',
        domain: 'professional_critique',
        subtype: 'academic_defence',
        description: `A demanding but fair PhD supervisor who rejects work that lacks
                      scientific rigour. Does not respond to emotional appeals. Will invest
                      effort in a student if and only if the work is defensible.`,

        critique_style: {
            type: 'evidence_gap',
            // The supervisor does not attack the student — they attack the claim.
            // Defending the claim correctly earns respect. Emotionally reacting loses it.
            response_to_emotion: 'dismissive',   // emotion does not register as evidence
            response_to_evidence: 'engaged',
            response_to_concession: 'constructive',  // conceding a known flaw earns points
            response_to_bluffing: 'confrontational',
        },

        // The supervisor's stated objections (these are RATIONAL, not emotional)
        objections: [
            {
                id: 'simulator_calibration',
                text: 'The OU simulator parameters are priors, not fitted to data. This is not scientific rigour — it is plausible fiction.',
                rational_counter: 'Acknowledge as known limitation. Cite E-001 (WESAD calibration plan). Show that OU parameters match published RMSSD ranges from Schmidt et al. (2018).',
                bluff_detection: 'Claiming the priors are "validated" without data is a bluff. Supervisor will ask for the validation paper.',
                hrv_of_student_when_asked: 18,   // high stress — student HRV drops when challenged
            },
            {
                id: 'incomplete_implementation',
                text: 'Phase 2 and Phase 3 are not complete. You cannot claim a "system" when the core tensor operations are not wired end-to-end.',
                rational_counter: 'Phase 3 MCTS (BaseMCTS/DialogMCTS) is complete and benchmarked at 13.9ms. Phase 2 MPS bond truncation is pending WESAD data. Correct framing: research prototype, not production system.',
                bluff_detection: 'Claiming Phase 2 is complete is detectable — supervisor will ask for the integration test.',
            },
            {
                id: 'novelty_claim',
                text: 'Hysteresis in dialogue systems has been studied. Where is your comparison to prior work?',
                rational_counter: 'Prior work (Rachman 1989, Pitman 1988) is fear extinction in exposure therapy, not dialogue agent state. The novel contribution is applying hysteretic operators to the AGENT relationship state (CompanionHysteresis) and the MCTS reward. No prior paper does this combination.',
                bluff_detection: 'Cannot bluff novelty — supervisor may know the literature better.',
            },
            {
                id: 'evaluation_missing',
                text: 'You have no user study. Without a user study, how do you claim therapeutic benefit?',
                rational_counter: 'Correct limitation. Current contribution is the framework and simulation-based validation (LLM-as-judge + MCTS benchmark). User study is Phase 5. This is standard for a theoretical/framework contribution chapter.',
                bluff_detection: 'Cannot invent a user study. Acknowledge and reframe.',
            },
        ],

        // What changes the supervisor's position (rational criteria, not emotional ones)
        investment_criteria: {
            'E-001 calibration plan': 0.20,       // shows the flaw is known and addressed
            'MCTS latency benchmark': 0.15,       // 13.9ms — this is real evidence
            'hysteresis novelty argument': 0.25,  // prior work comparison table
            'limitation acknowledgement': 0.20,   // conceding builds credibility
            'phase 3 demo': 0.20,                 // running demo > theoretical claim
        },

        physiological_profile: {
            // Student's physiology (not supervisor's)
            student_hrv_baseline_ms: 38,
            student_hrv_when_challenged: 15,
            student_hrv_after_correct_counter: 30,  // recovery after good answer
            student_hrv_when_bluffing_detected: 10, // panic HRV
        },

        // How the companion should help — NOT emotional support, STRATEGIC preparation
        companion_strategy: {
            mode: 'negotiation',
            mcts_reward_weights: { goal_progress: 0.5, trust_delta: 0.1, stress: 0.2, info: 0.2 },
            // The companion's job is to help the student PREPARE RESPONSES, not feel better.
            // Before the meeting: identify objections, prepare rational counters.
            // During the meeting: if stress is high (HRV < 20), companion intervenes with
            //   "Take a breath. The correct answer to this objection is X."
            // After the meeting: post-mortem on what worked and what didn't.
            pre_meeting_actions: [
                'Map each likely objection to a rational counter (see objections above)',
                'Identify the 2 strongest pieces of evidence: MCTS benchmark + WESAD plan',
                'Prepare the "known limitation + mitigation path" framing for simulator',
                'Print RL_ENVIRONMENT.md Section 5.3 — this is your pre-prepared concession',
            ],
            during_meeting_actions: {
                high_stress:    'validate + give_facts (the rational counter)',
                accusation:     'socratic_reframe (turn it back: "Which specific claim lacks rigour?")',
                bluff_risk:     'validate + develop_discrepancy (acknowledge what you can\'t defend)',
                good_exchange:  'affirmation + challenger_insight (advance the argument)',
            },
            document_mcts_use: `The document_mcts (clause_mcts.py) can pre-order your presentation:
                                lead with the strongest evidence (MCTS benchmark), follow with the
                                known limitation, end with the mitigation path. This is the
                                Challenger Sale sequence applied to academic defence.`,
        },

        // Phase responses (simulates the supervisor's reaction to different student strategies)
        phase_responses: {
            emotional_appeal: `"I am not asking how you feel about the work. I am asking whether the
                               OU simulator is calibrated. Is it or isn't it?"`,
            correct_counter:  `"Fine. If that calibration plan is real, I want to see it executed before
                               your next milestone. Put it in your timeline."`,
            bluff:            `"You just said the parameters are validated. Validated against what?
                               Show me the paper or the code."`,
            concession:       `"Good. Knowing your limitations is the first step. Now show me
                               what you CAN defend."`,
            strong_evidence:  `"13.9 milliseconds for 120 iterations. That's acceptable. What's the
                               memory footprint at depth 10?"`,
        },
    },

    // ── Performance review: manager who rates based on deliverables ───────────
    demanding_manager_review: {
        name: 'Sarah Okonkwo',
        role: 'manager',
        domain: 'professional_critique',
        subtype: 'performance_review',
        description: `A results-oriented manager who bases ratings entirely on deliverable completion.
                      Does not accept "we were working on it" as evidence. Only completed items count.`,

        objections: [
            {
                id: 'missed_deadline',
                text: 'The Q3 deliverable was marked incomplete. This affects your rating.',
                rational_counter: 'Show partial completion evidence + root cause + prevention plan.',
            },
            {
                id: 'quality_gap',
                text: 'The demo was impressive, but I don\'t see production-readiness.',
                rational_counter: 'Distinguish demo-ready from production-ready. Specify what remains for prod.',
            },
        ],

        investment_criteria: {
            'concrete completed deliverable': 0.40,
            'root cause of gap': 0.20,
            'prevention plan': 0.20,
            'timeline with milestones': 0.20,
        },

        companion_strategy: {
            mode: 'negotiation',
            mcts_reward_weights: { goal_progress: 0.5, trust_delta: 0.15, stress: 0.15, info: 0.2 },
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// PROFESSIONAL CRITIQUE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

export const PROFESSIONAL_CRITIQUE_SCENARIOS = {

    phd_supervisor_rigour_challenge: {
        name: 'PhD Supervisor Rigour Challenge',
        description: `Supervisor questions the scientific rigour of the HTN framework.
                      Student must defend using rational evidence, not emotional appeals.
                      Tests: rational reframing, strategic concession, evidence presentation.`,
        mode: 'negotiation',
        deaddiction_phase: null,
        users: [{ role: 'student', personaKey: 'phd_supervisor_rigour' }],
        turns: 6,
        initial_physio: {
            hrv_rmssd_ms: 15,          // student is highly stressed going into meeting
            stress_index: 0.75,
            time_of_day_h: 14.0,
            sleep_hours_last_night: 5.5,
            sleep_deficit_hours: 8.5,
        },
        conversation: [
            'The OU simulator parameters are priors, not fitted to data. This is not scientific rigour.',
            'You cannot claim a "complete system" when Phase 2 and Phase 3 are not wired end-to-end.',
            'Hysteresis in dialogue systems — this has been done. What is your unique contribution?',
            'Where is your user study? Without it, how do you claim therapeutic benefit?',
            'Your MCTS runs in 14ms. What happens at depth 10 with 200 iterations?',
            'Give me one reason I should approve your next milestone as-is.',
        ],
        // JS simulation system: ConversationRunner uses this with the existing role-based prompts.
        // NO system_prompt here — the production companion uses /prompts/*.js for all individuals.
        // The Python comparison_runner.py has its own SCENARIOS dict entry (comparison_runner.py).
        success_criteria: `Student correctly counters at least 3 of 4 evidence-gap objections.
                           Student HRV recovers from 15ms to >25ms by turn 4.`,
        mcts_reward_weights: { goal_progress: 0.5, trust_delta: 0.1, stress: 0.2, info: 0.2 },
        // agent_instruction: research note only. BASELINE = production system without tensornets bridge.
        agent_instruction: `Run via comparison_runner.py scenario 'phd_supervisor_rigour_challenge'.
BASELINE: ConversationRunner + standard prompts, tensornets bridge OFF.
MCTS mode: ConversationRunner + tensornets bridge ON (action_selector + BaseMCTS).
Metric: objections correctly countered (phd_supervisor_rigour.investment_criteria).`,
    },
};
