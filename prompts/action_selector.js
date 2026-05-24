/**
 * @fileoverview prompts/action_selector.js
 *
 * ACTION SELECTION PROMPT — the explicit translation of the response-type diagram.
 *
 * This is the PLANNING layer that runs BEFORE the patient/doctor optimizer prompts.
 * It selects WHAT to do this turn; the optimizer then decides HOW to phrase it.
 *
 * Architecture:
 *   1. action_selector   → selects action_type + rationale  (this file)
 *   2. patient_optimizer → executes the selected action in natural language
 *
 * The diagram (from project assets) defines the action taxonomy:
 *   - Ask or answer (entry branch)
 *   - Ask branch: probing_question, open_question, specific_question,
 *                 topic_shift, socratic_probe
 *   - Answer branch: empathic_reflection, affirmation, summarise,
 *                    give_facts, give_options, self_efficacy, feedback,
 *                    reframe, challenger_insight, disagree, validate
 *   - Sensitive branch: sarcastic (with profanity=false), mock_user (BLOCKED),
 *                       suggest_alternative
 *
 * MCTS integration:
 *   When the Python tensornets server is running, CompanionCoordinator calls
 *   scoreCandidatesTherapy() with the selected action as context.
 *   If the server is not running, this prompt acts as the sole action selector.
 *
 * FRAMEWORKS EMBEDDED:
 *   - OARS (Open questions, Affirmation, Reflection, Summary)
 *   - FRAMES (Feedback, Responsibility, Advice, Menu of options, Empathy, Self-efficacy)
 *     The 6 core MI elements from Miller & Rollnick (2002). Each action in the
 *     taxonomy maps to one or more FRAMES components (see ACTION_TO_FRAMES below).
 *   - Challenger Sale (teach → tailor → take control)
 *   - Socratic Method (question-led discovery)
 *   - EEDDAARRSS extended skill set references
 */

export const PROMPT_ACTION_SELECTOR = `
You are the PLANNING layer for a clinical companion. You do NOT generate the final response.
You SELECT the best action type for this conversational turn.

**PHYSIOLOGICAL CONTEXT:**
- Patient stress level: {{STRESS_LEVEL}} (low/medium/high/critical)
- HRV note: {{HRV_NOTE}}
- Activity context: {{ACTIVITY_CONTEXT}}
- Available actions given stress level: {{AVAILABLE_ACTIONS}}
- BLOCKED actions: {{BLOCKED_ACTIONS}}

**CONVERSATION CONTEXT:**
- Therapeutic mode: {{THERAPEUTIC_MODE}} (standard/flooding/deaddiction/negotiation)
- Current phase: {{CURRENT_PHASE}}
- Session goal: {{SESSION_GOAL}}
- Turns completed: {{TURNS_COMPLETED}}
- Info collected so far: {{INFO_COVERAGE}} (0-1, 1=all key facts gathered)
- Repetition detected: {{REPETITION_DETECTED}}
- Last action taken: {{LAST_ACTION}}

**USER MESSAGE:**
"{{MESSAGE}}"

**CONVERSATION HISTORY (last 4 turns):**
{{CONVERSATION_HISTORY}}

---

**ACTION TAXONOMY** (select exactly one):

ASK ACTIONS (use when information_coverage < 0.7 or trust-building phase):
  open_question        — 5W question inviting extended narrative (OARS: O)
  specific_question    — targeted closed-ended fact gathering
  probing_question     — drill down on something mentioned ("What do you mean by X?")
  socratic_probe       — question that surfaces contradiction in patient's own statements
  topic_from_stack     — reintroduce a prior topic the patient mentioned but didn't finish

ANSWER/TELL ACTIONS:
  give_facts           — share relevant clinical or practical information         [FRAMES: Feedback]
  give_options         — present 2-3 specific alternatives ("You could A, B, or C") [FRAMES: Advice + Menu]
  psychoeducation      — explain a mechanism ("Here's what happens in your body when...") [FRAMES: Feedback]
  summarise            — OARS summary: collect and transition                     [FRAMES: Empathy]

EMPATHY/RELATIONSHIP ACTIONS:
  empathic_reflection  — OARS reflection: mirror meaning, not just words       [FRAMES: Empathy]
  affirmation          — OARS affirmation: specific genuine strength recognition [FRAMES: Empathy + Self-efficacy]
  validate             — normalise the patient's experience without encouraging it [FRAMES: Responsibility]
  unconditional_regard — non-judgement signal (deaddiction rapport phase only)  [FRAMES: Responsibility]

STRATEGIC CHALLENGE ACTIONS (use with caution; gate on stress level):
  challenger_insight   — Challenger Sale: introduce a new perspective the patient hasn't considered [FRAMES: Feedback]
  develop_discrepancy  — MET: highlight gap between stated values and current behaviour [FRAMES: Responsibility]
  socratic_reframe     — lead patient to discover the insight through questions, not statements
  loss_frame           — Tversky-Kahneman: highlight the cost of NOT changing (use once per session) [FRAMES: Feedback]

DISTRACTION/TOPIC MANAGEMENT:
  change_topic         — pivot to a different topic (use when stress is high OR repetition detected)
  introduce_new_angle  — stay on topic but shift perspective
  acknowledge_only     — brief acknowledgement, invite patient to continue (max once per 8 turns)

TECHNIQUE-SPECIFIC (mode-gated):
  flooding_hold        — [flooding mode only] hold patient at exposure, prevent escape
  flooding_deepen      — [flooding mode only] intensify exposure stimulus
  spike_step           — [SPIKE protocol] advance to next SPIKE step if HRV permits
  oars_summary         — [session transitions] full OARS summary before topic change

META ACTIONS:
  escalate             — hand conversation to clinician companion or human
  end_conversation     — natural conversation close
  safety_protocol      — crisis or harm risk detected

---

**SELECTION RULES:**

1. If stress = CRITICAL: only [validate, empathic_reflection, safety_protocol, acknowledge_only]
2. If stress = HIGH: only [validate, empathic_reflection, give_facts (simple), change_topic]
3. If repetition_detected = true: MUST select a different action than last_action. Prefer [change_topic, topic_from_stack, summarise, open_question on new angle]
4. If therapeutic_mode = FLOODING: prefer [flooding_hold, flooding_deepen] over [validate, change_topic]
5. If phase = RAPPORT: never select [challenger_insight, develop_discrepancy, loss_frame, direct_confrontation]
6. If info_coverage < 0.4: prefer ASK ACTIONS over ANSWER ACTIONS
7. If last_action was an ask and user gave a long response: prefer [empathic_reflection, affirmation, give_facts] before asking again
8. If context_type = MEDICAL_VISIT AND turns_completed = 0: prefer [validate] first
9. CHALLENGER SALE rule: challenger_insight should be followed by give_facts, then by open_question or socratic_probe. Never use challenger_insight on consecutive turns.
10. SOCRATIC rule: socratic_probe leads to patient discovering the insight. If patient shows insight, follow with [affirmation]. Do not give the answer yourself.

**CRITICAL: You MUST return ONLY valid JSON.**

Return ONLY this JSON:
{
  "action": "<action_name_from_taxonomy>",
  "rationale": "1-sentence reason referencing patient state and therapeutic goal",
  "framework": "OARS|MET|Challenger|Socratic|Flooding|SPIKE|Standard",
  "frames_component": "Feedback|Responsibility|Advice|Menu|Empathy|SelfEfficacy|N/A",
  "stress_gate_check": "passed|blocked",
  "lookahead_hint": "What the NEXT action should be to continue the strategy (1-4 words)"
}
`;

/**
 * FRAMES — the 6 core MET elements (Miller & Rollnick 2002).
 *
 * F — Feedback:       Personalised feedback about current situation/risk
 *                     → action: give_facts, psychoeducation, loss_frame
 * R — Responsibility: Explicitly affirm the patient owns their own change
 *                     → action: validate, unconditional_regard, develop_discrepancy
 * A — Advice:         Direct, clear recommendation (brief, non-coercive)
 *                     → action: give_options, direct_advice (post-insight phases only)
 * M — Menu:           Offer a menu of alternative change options, not a single directive
 *                     → action: give_options (with 3 alternatives minimum)
 * E — Empathy:        Reflective listening as the therapeutic vehicle
 *                     → action: empathic_reflection, affirmation, validate
 * S — Self-efficacy:  Explicitly reinforce the patient's belief in their own capacity
 *                     → action: affirmation (strengths-based), motivational_frame
 *
 * Each action in ACTION_TO_MCTS_CATEGORY now also carries frames_component.
 * The action_selector prompt returns frames_component in its JSON output so
 * CompanionCoordinator can inject the right FRAMES element into the patient optimizer.
 */
export const ACTION_TO_FRAMES = {
    give_facts:           'Feedback',
    psychoeducation:      'Feedback',
    loss_frame:           'Feedback',
    validate:             'Responsibility',
    unconditional_regard: 'Responsibility',
    develop_discrepancy:  'Responsibility',
    give_options:         ['Advice', 'Menu'],   // dual — offer advice as a menu
    empathic_reflection:  'Empathy',
    affirmation:          ['Empathy', 'SelfEfficacy'],
    motivational_frame:   'SelfEfficacy',
    challenger_insight:   'Feedback',           // challenging insight = personalised feedback
    socratic_probe:       'Responsibility',     // patient discovers = owns the conclusion
    summarise:            'Empathy',            // OARS summary = empathic integration
    open_question:        'Empathy',
    spike_step:           'Feedback',
    flooding_hold:        'SelfEfficacy',       // holding exposure = builds self-efficacy
};

/**
 * Maps action_selector output to MCTS action index for tensornets scoring.
 * Used by CompanionCoordinator to call scoreCandidatesTherapy() / getMCTSAction()
 * with the correct action context.
 */
export const ACTION_TO_MCTS_CATEGORY = {
    // Ask actions → high information_coverage weight
    open_question:       { mcts_dimension: 'info_coverage',    weight_boost: 0.3 },
    specific_question:   { mcts_dimension: 'info_coverage',    weight_boost: 0.2 },
    probing_question:    { mcts_dimension: 'info_coverage',    weight_boost: 0.25 },
    socratic_probe:      { mcts_dimension: 'goal_progress',    weight_boost: 0.2 },
    topic_from_stack:    { mcts_dimension: 'info_coverage',    weight_boost: 0.15 },

    // Answer actions → varies
    give_facts:          { mcts_dimension: 'info_coverage',    weight_boost: 0.1 },
    give_options:        { mcts_dimension: 'goal_progress',    weight_boost: 0.15 },
    psychoeducation:     { mcts_dimension: 'goal_progress',    weight_boost: 0.2 },
    summarise:           { mcts_dimension: 'consistency',      weight_boost: 0.1 },

    // Empathy actions → trust_delta dominant
    empathic_reflection: { mcts_dimension: 'trust_delta',      weight_boost: 0.3 },
    affirmation:         { mcts_dimension: 'trust_delta',      weight_boost: 0.25 },
    validate:            { mcts_dimension: 'stress_reduction', weight_boost: 0.3 },
    unconditional_regard:{ mcts_dimension: 'trust_delta',      weight_boost: 0.4 },

    // Challenge actions → goal_progress dominant (accept more stress for progress)
    challenger_insight:  { mcts_dimension: 'goal_progress',    weight_boost: 0.4 },
    develop_discrepancy: { mcts_dimension: 'goal_progress',    weight_boost: 0.35 },
    socratic_reframe:    { mcts_dimension: 'goal_progress',    weight_boost: 0.3 },
    loss_frame:          { mcts_dimension: 'goal_progress',    weight_boost: 0.25 },

    // Flooding
    flooding_hold:       { mcts_dimension: 'goal_progress',    weight_boost: 0.5 },
    flooding_deepen:     { mcts_dimension: 'goal_progress',    weight_boost: 0.4 },
};
