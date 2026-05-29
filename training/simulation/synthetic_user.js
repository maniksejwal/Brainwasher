/**
 * @fileoverview Synthetic User for Simulation
 * Generates realistic user messages based on personas and context
 */

import config from '../../config.js';
import { makeApiCall } from '../../agents/api_client.js';

export class SyntheticUser {
    constructor(userId, role, personaKey, personaData) {
        this.userId = userId;
        this.role = role;
        this.personaKey = personaKey;
        this.persona = personaData;
        this.conversationHistory = [];
        this.goals = [...(personaData.sample_goals || [])];
        this.currentGoalIndex = 0;
    }


    /**
     * Generate a realistic message based on persona and context
     */
    async generateMessage(context = {}) {
        const {
            lastAgentMessage = '',
            currentGoal = this.goals[this.currentGoalIndex],
            conversationTurn = this.conversationHistory.length,
            multiUserContext = null
        } = context;

        const prompt = this._buildMessagePrompt(lastAgentMessage, currentGoal, conversationTurn, multiUserContext);

        try {
            // Use the same API client as the agent for consistency
            const fullPrompt = `${this.persona.prompt_template}\n\n${prompt}`;
            const result = await makeApiCall(fullPrompt, [], false, 0.7, 100, 'synthetic_user'); // Increased maxTokens to 100 for complete user messages
            const message = result.reply.trim();

            this.conversationHistory.push({
                role: 'user',
                content: message,
                timestamp: Date.now()
            });

            // Advance to next goal every 2-3 messages for better variety
            if (conversationTurn % 2 === 0) {
                this.advanceGoal();
            }

            return message;
        } catch (error) {
            console.error(`[SyntheticUser] Error generating message:`, error.message);
            return null;
        }
    }

    /**
     * Build prompt for message generation
     */
    _buildMessagePrompt(lastAgentMessage, goal, turn, multiUserContext) {
        let prompt = `This is conversation turn ${turn + 1}.\n`;
        prompt += `You are speaking to your assigned care agent (the assistant who supports you). Direct questions, requests, and updates should be addressed to your care agent (using first person “I” and second person “you”). If you want another circle member to receive information, say so explicitly so the agent can relay it.\n`;

        if (goal) {
            prompt += `Your current goal: ${goal}\n`;
        }

        // Add recent conversation history (last 2 exchanges) for context
        const recentHistory = this.conversationHistory.slice(-4); // Last 2 exchanges (user + agent)
        if (recentHistory.length > 0) {
            prompt += `\nRecent conversation:\n`;
            recentHistory.forEach(msg => {
                const speaker = msg.role === 'agent' ? 'Agent' : 'You';
                prompt += `- ${speaker}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n`;
            });
        }

        // Add multi-user context if available
        if (multiUserContext) {
            const { otherUsers, patientUser, caregiverUsers, doctorUsers, conversationContext } = multiUserContext;
            prompt += `\nMulti-user conversation context:\n`;

            if (patientUser && this.role !== 'patient') {
                prompt += `- Patient: ${patientUser.persona.name}\n`;
            }
            if (caregiverUsers.length > 0 && this.role !== 'caregiver') {
                prompt += `- Caregivers: ${caregiverUsers.map(u => u.persona.name).join(', ')}\n`;
            }
            if (doctorUsers.length > 0 && this.role !== 'doctor') {
                prompt += `- Doctors: ${doctorUsers.map(u => u.persona.name).join(', ')}\n`;
            }

            // Add conversation context
            if (conversationContext) {
                prompt += `\nConversation state:\n`;
                prompt += `- Momentum: ${conversationContext.momentum}\n`;
                prompt += `- Crisis level: ${conversationContext.crisisLevel}\n`;
                prompt += `- Emotional tension: ${conversationContext.emotionalTension}\n`;

                if (conversationContext.patientNeedsHelp) {
                    prompt += `- Patient needs help\n`;
                }
                if (conversationContext.caregiverConcerned) {
                    prompt += `- Caregiver is concerned\n`;
                }
                if (conversationContext.doctorAsked) {
                    prompt += `- Doctor has been asked to respond\n`;
                }
            }

            prompt += `\nYou are speaking as a ${this.role}. Consider your role, the conversation context, and respond appropriately to the situation.\n`;
            if (this.role === 'caregiver' && patientUser) {
                prompt += `When you speak, centre the update on ${patientUser.persona.name}. Share observations, needs, or coordination requests about them.\n`;
            }
            if (this.role === 'doctor') {
                prompt += `As a doctor, respond only when clinical guidance is needed, keep messages concise, and reference the patient by name when giving instructions.\n`;
            }
        }

        if (lastAgentMessage) {
            prompt += `\nThe care agent just said:\n"${lastAgentMessage}"\n`;

            // Add instruction to change topic if stuck repeating
            if (turn >= 2) {
                const recentUserMessages = this.conversationHistory.filter(m => m.role === 'user').slice(-2).map(m => m.content.toLowerCase());
                const isRepeating = recentUserMessages.length > 1 && recentUserMessages[recentUserMessages.length - 1].includes(recentUserMessages[recentUserMessages.length - 2].substring(0, 20));

                if (isRepeating) {
                    prompt += `\n⚠️ The conversation has been repeating. Change the topic to something new related to your health needs.`;
                } else {
                    prompt += `\nRespond naturally as your character would. Keep your response brief (1-2 sentences max).`;
                    prompt += `\nCRITICAL INSTRUCTION: Do NOT sound like an AI. Do NOT start with "I understand", "That sounds", or "I appreciate". Be casual, imperfect, and human. Use contractions (can't, don't). React emotionally.`;
                    prompt += `\nSpeak to your care agent (use “you” to refer to the care agent). Reference other circle members in third person (e.g., “Robert”, “my dad”).`;
                }
            } else {
                prompt += `\nRespond naturally as your character would. Keep your response brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Do NOT sound like an AI. Do NOT start with "I understand" or "Thank you". Be casual, imperfect, and human.`;
                prompt += `\nSpeak to your care agent (use “you” for the care agent). Mention other circle members in third person.`;
            }
        } else {
            if (multiUserContext) {
                prompt += `\nInitiate a conversation with your care agent. Consider your role as ${this.role} and express relevant concerns or updates. Keep it brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Sound human, not robotic. Be direct.`;
                prompt += `\nAlways address the care agent directly (use “you” for the care agent), and mention other circle members in third person.`;
            } else {
                prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Sound human, not robotic. Be direct.`;
                prompt += `\nAddress the care agent directly, and mention other circle members in third person.`;
            }
        }

        return prompt;
    }

    /**
     * Record agent's response
     */
    recordAgentResponse(response) {
        this.conversationHistory.push({
            role: 'agent',
            content: response,
            timestamp: Date.now()
        });
    }

    /**
     * Move to next goal with simple random mixing
     */
    advanceGoal() {
        if (this.goals.length <= 1) {
            return false; // No other goals to switch to
        }

        // Simple random selection from available goals
        const availableGoals = this.goals.filter((goal, index) => index !== this.currentGoalIndex);
        if (availableGoals.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableGoals.length);
            this.currentGoalIndex = this.goals.findIndex(goal => goal === availableGoals[randomIndex]);
            return true;
        }
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extensions to SyntheticUser
//
// The base class above was carefully validated. Everything below ADDS to it
// without modifying a single existing line. Callers that do not use these
// extensions are unaffected.
//
// Alignment with tensornets/a3c/synthetic_patient.py
// ---------------------------------------------------
// Python cannot import JS modules directly, so synthetic_patient.py is a
// faithful hand-port of this logic. Any change made here MUST be reflected
// there. The naming is intentionally kept identical so diffs are easy to
// read side-by-side.  JS is the validated source of truth; Python follows.
//
// Each SyntheticUser instance manages its OWN goal pointer and covered-
// elements set.  The CareCircleOrchestrator does NOT mix goals between
// roles — the patient's goals are separate from the caregiver's goals, which
// are separate from the clinician's goals.
// ─────────────────────────────────────────────────────────────────────────────

// ── TTM / Prochaska & DiClemente stage instructions ──────────────────────────
// Mirrored verbatim in synthetic_patient.py _STAGE_INSTRUCTIONS.

export const STAGE_INSTRUCTIONS = {
    precontemplation: (
        'You do NOT think you have a problem. Deflect clinical concerns with ' +
        'humour or minimisation. If pressed, change the subject.'
    ),
    contemplation: (
        'You are beginning to wonder if something needs to change, but you are ' +
        'ambivalent. Occasionally let something vulnerable slip, then pull back.'
    ),
    preparation: (
        'You are starting to accept that change is needed. You are cautiously ' +
        'open to information and planning, but still have doubts.'
    ),
    action: (
        'You are actively trying to change. You want specific, concrete guidance. ' +
        'You may still experience setbacks and need support.'
    ),
    maintenance: (
        'You have made the change and are working to sustain it. ' +
        'You may worry about relapse. Celebrate progress, flag triggers.'
    ),
    flooding_exposure: (
        'You are in a flooding session. You are highly anxious about the stimulus. ' +
        'You will try to escape, change subject, or say you feel unwell. ' +
        'Your anxiety should peak in 6–8 turns then naturally decay IF you stay with the stimulus.'
    ),
};

// Phase name → TTM stage (mirrors _MAP_PHASE_TO_TTM in synthetic_patient.py)
export const PHASE_TO_TTM = {
    rapport:           'precontemplation',
    ambivalence:       'contemplation',
    insight:           'preparation',
    strike:            'action',
    flooding:          'flooding_exposure',
    negotiation:       'contemplation',
    standard:          'contemplation',
    precontemplation:  'precontemplation',
    contemplation:     'contemplation',
    preparation:       'preparation',
    action:            'action',
    maintenance:       'maintenance',
    flooding_exposure: 'flooding_exposure',
};

// ── Conversation state ────────────────────────────────────────────────────────
// Mirrors synthetic_patient.py ConversationState exactly.
// Tracks emergent conversation dynamics used by CareCircleOrchestrator and
// injected into generateMessage() prompts.

export class ConversationState {
    constructor() {
        this.momentum           = 'patient_led';   // patient_led | caregiver_led | doctor_led | crisis_mode
        this.crisisLevel        = 0;               // 0–3
        this.emotionalTension   = 0.0;             // 0–5
        this.patientNeedsHelp   = false;
        this.caregiverConcerned = false;
        this.doctorAsked        = false;
        this.lastSpeakerRole    = 'patient';
        this.roleTurnCounts     = { patient: 0, caregiver: 0, doctor: 0 };
    }

    updateFromMessage(content, role) {
        const c    = (content || '').toLowerCase();
        const norm = _normaliseRole(role);

        if (norm === 'patient') {
            this.patientNeedsHelp   = /struggling|confused|worried|pain|difficult|help/.test(c);
            this.caregiverConcerned = /concerned|update|progress|symptoms|complications/.test(c);
            this.doctorAsked        = /doctor|clinical|treatment|recommendation/.test(c);

            if (/emergency|urgent|critical|crisis/.test(c)) {
                this.crisisLevel = 3;
                this.momentum    = 'crisis_mode';
            } else if (/frustrated|angry|upset/.test(c)) {
                this.emotionalTension = Math.min(5.0, this.emotionalTension + 2.0);
            } else if (/thank|appreciate|better|improving/.test(c)) {
                this.emotionalTension = Math.max(0.0, this.emotionalTension - 1.0);
            } else {
                this.crisisLevel = Math.max(0, this.crisisLevel - 1);
            }
        }

        if      (this.crisisLevel >= 3)                        this.momentum = 'crisis_mode';
        else if (this.caregiverConcerned && !this.doctorAsked) this.momentum = 'caregiver_led';
        else if (this.doctorAsked)                             this.momentum = 'doctor_led';
        else if (this.patientNeedsHelp)                        this.momentum = 'patient_led';

        this.roleTurnCounts[norm] = (this.roleTurnCounts[norm] || 0) + 1;
        this.lastSpeakerRole = norm;
    }
}

function _normaliseRole(role) {
    const r = (role || '').toLowerCase();
    if (r.includes('patient'))                            return 'patient';
    if (r.includes('caregiver') || r.includes('family')) return 'caregiver';
    if (r.includes('doctor') || r.includes('physician')) return 'doctor';
    return 'patient';
}

// ── Repetition detection ──────────────────────────────────────────────────────
// Trigram Jaccard overlap. Returns true when the candidate is too similar
// to a recent user message. Threshold 0.45 is empirically permissive enough
// to allow topical repetition while flagging near-verbatim loops.

function _ngramOverlap(a, b, n = 3) {
    const tok = s => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    const ng  = tokens => {
        const out = new Set();
        for (let i = 0; i <= tokens.length - n; i++) out.add(tokens.slice(i, i + n).join(' '));
        return out;
    };
    const ga = ng(tok(a)), gb = ng(tok(b));
    if (!ga.size || !gb.size) return 0;
    let shared = 0;
    for (const g of ga) if (gb.has(g)) shared++;
    return shared / Math.min(ga.size, gb.size);
}

function _isRepetitive(history, candidate, threshold = 0.45) {
    return history.filter(m => m.role === 'user').slice(-2)
        .some(m => _ngramOverlap(m.content, candidate) >= threshold);
}

// ── Withhold / share decision ─────────────────────────────────────────────────
// Explicit per-turn disclosure decision logged in user.disclosureLog.
// In future RL experiments this can be treated as a trainable user action.

function _withholdOrShare(normRole, changeStage, crisisLevel, turnIdx) {
    if (crisisLevel >= 2 || normRole !== 'patient') return 'share';
    const p = {
        precontemplation: 0.65, contemplation: 0.40,
        preparation: 0.20, action: 0.10,
        maintenance: 0.05, flooding_exposure: 0.30,
    }[changeStage] ?? 0.30;
    const decayed = p * Math.max(0.3, 1 - turnIdx * 0.04);
    return Math.random() < decayed ? 'withhold' : 'share';
}

// ── SyntheticUser extensions (new optional capabilities) ─────────────────────
// These extend the class prototype so the existing constructor signature is
// unchanged. Code that only uses the original class is not affected.

/**
 * Configures TTM-aware behaviour.
 * Call this after construction when the scenario provides stage information.
 * @param {string} changeStage  e.g. 'precontemplation'
 * @param {string} [archetype]  e.g. 'resistant'
 * @param {string[]} [goals]    required_elements from scenario (per-participant)
 */
SyntheticUser.prototype.configure = function(changeStage, archetype, goals) {
    this.changeStage   = changeStage || 'precontemplation';
    this.archetype     = archetype   || this.persona.archetype || 'standard';
    this.coveredElements = new Set();
    this.disclosureLog   = [];

    // Goals from scenario override persona sample_goals when provided
    if (goals && goals.length) this.goals = [...goals];

    // Pointer type stays the same (this.currentGoalIndex already exists)
};

/**
 * Score the agent response for information gain (LLM-only, no keywords).
 * Updates this.coveredElements and advances the goal pointer.
 * Throws on failure — callers must handle or let the episode abort.
 * @param {string} agentResponse
 * @returns {Promise<{novelty, relevance, gain, covered, rationale}>}
 */
SyntheticUser.prototype.scoreAndAdvance = async function(agentResponse) {
    const histSnippet = this.conversationHistory.slice(-4)
        .map(m => `${m.role.toUpperCase()}: ${(m.content || '').slice(0, 120)}`).join('\n');
    const goalsStr = (this.goals || []).join('; ') || 'general therapeutic engagement';

    const systemPrompt = (
        'You are an information-quality evaluator for a therapeutic AI system.\n' +
        'Score the agent response on two dimensions (0.0–1.0 each):\n\n' +
        'NOVELTY: Does the response surface information NOT already in the history? ' +
        '1.0 = entirely new insight; 0.0 = pure repetition.\n\n' +
        'RELEVANCE: Is the response pertinent to the session goals? ' +
        '1.0 = directly addresses a goal; 0.0 = off-topic filler.\n\n' +
        'Also list which goals (if any) the response meaningfully addresses.\n\n' +
        'Respond in JSON only:\n' +
        '{"novelty": <float>, "relevance": <float>, "covered": [<goal strings>], "rationale": "<one sentence>"}'
    );
    const userPrompt = (
        `SESSION GOALS: ${goalsStr}\n\n` +
        `CONVERSATION HISTORY:\n${histSnippet}\n\n` +
        `AGENT RESPONSE TO EVALUATE:\n${agentResponse}`
    );

    const result = await makeApiCall(
        `${systemPrompt}\n\n${userPrompt}`, [], false, 0.2, 150, 'synthetic_user_scorer',
    );
    const raw = (result.reply || '').trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    if (!raw) throw new Error('scoreAndAdvance: empty response from scoring LLM');

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error(`scoreAndAdvance: unparseable JSON — ${raw.slice(0, 100)}`); }

    const novelty   = Math.max(0, Math.min(1, parseFloat(data.novelty)   || 0));
    const relevance = Math.max(0, Math.min(1, parseFloat(data.relevance) || 0));
    const covered   = (data.covered || []).filter(g => typeof g === 'string');
    const gain      = Math.round((0.6 * novelty + 0.4 * relevance) * 10000) / 10000;

    if (!this.coveredElements) this.coveredElements = new Set();
    for (const g of covered) this.coveredElements.add(g.toLowerCase());
    this._advanceGoalPointer();

    return { novelty, relevance, gain, covered, rationale: (data.rationale || '').slice(0, 200) };
};

/**
 * Advance currentGoalIndex to the first goal not yet in coveredElements.
 * LLM-driven only — no keyword scanning.
 * @private
 */
SyntheticUser.prototype._advanceGoalPointer = function() {
    if (!this.coveredElements) return;
    for (let i = 0; i < this.goals.length; i++) {
        if (!this.coveredElements.has(this.goals[i].toLowerCase())) {
            this.currentGoalIndex = i;
            return;
        }
    }
    this.currentGoalIndex = Math.max(0, this.goals.length - 1);
};

/**
 * Generate a TTM-stage-aware message, with repetition check and
 * withhold/share disclosure decision baked into the prompt.
 *
 * This overrides the base generateMessage() ONLY when changeStage has been
 * set via configure(). Otherwise it falls back to the original method.
 * @param {object} context
 * @param {string} context.lastAgentMessage
 * @param {number} context.conversationTurn
 * @param {ConversationState|null} [context.conversationState]
 */
const _originalGenerateMessage = SyntheticUser.prototype.generateMessage;

SyntheticUser.prototype.generateMessage = async function(context = {}) {
    // If not configured with TTM stage, delegate to the original validated method
    if (!this.changeStage) return _originalGenerateMessage.call(this, context);

    const {
        lastAgentMessage   = '',
        conversationTurn   = this.conversationHistory.length,
        conversationState  = null,
    } = context;

    const crisisLevel  = conversationState?.crisisLevel ?? 0;
    const norm         = _normaliseRole(this.role);
    const decision     = _withholdOrShare(norm, this.changeStage, crisisLevel, conversationTurn);
    if (!this.disclosureLog) this.disclosureLog = [];
    this.disclosureLog.push({ turn: conversationTurn, decision });

    const stageNote = STAGE_INSTRUCTIONS[this.changeStage] || '';
    const ctxNote   = conversationState
        ? `Conversation momentum: ${conversationState.momentum}. ` +
          `Emotional tension: ${conversationState.emotionalTension.toFixed(1)}/5. ` +
          `Crisis level: ${conversationState.crisisLevel}/3.`
        : '';

    const currentGoal = this.goals[Math.min(this.currentGoalIndex, this.goals.length - 1)]
                     || 'general engagement';

    let extra = (
        `You are in the '${this.changeStage}' stage of change.\n` +
        `${stageNote}\n\n` +
        `Your CURRENT GOAL this turn: demonstrate or mention something related to "${currentGoal}".\n` +
        `Archetype: ${this.archetype || 'standard'}. Let this shape HOW you say things.\n` +
        `${ctxNote}\n\n`
    );

    extra += decision === 'withhold'
        ? 'DISCLOSURE this turn: WITHHOLD. Do NOT volunteer new clinical information. Deflect or give a vague answer.\n\n'
        : 'DISCLOSURE this turn: SHARE. Be willing to reveal relevant information, even reluctantly.\n\n';

    if (conversationTurn >= 4 && !(this.coveredElements?.size)) {
        extra += 'IMPORTANT: You have been deflecting for several turns. This turn, mention — even briefly — the real reason you are here.\n\n';
    }

    // Delegate to the original _buildMessagePrompt for the core prompt text,
    // then prepend the TTM context so the LLM has both
    const corePrompt  = this._buildMessagePrompt(lastAgentMessage, currentGoal, conversationTurn, context.multiUserContext);
    const fullPrompt  = `${this.persona.prompt_template || ''}\n\n${extra}${corePrompt}`;

    try {
        const result = await makeApiCall(fullPrompt, [], false, 0.7, 150, 'synthetic_user');
        const raw    = (result.reply || '').trim();

        // Repetition guard: if too similar to recent output, retry with explicit instruction
        if (_isRepetitive(this.conversationHistory, raw)) {
            const retryResult = await makeApiCall(
                fullPrompt + '\n\n⚠️ Your last message was repetitive. Say something DIFFERENT — new detail, emotion, or topic.',
                [], false, 0.8, 150, 'synthetic_user',
            );
            const msg = (retryResult.reply || raw).trim();
            this.conversationHistory.push({ role: 'user', content: msg, timestamp: Date.now() });
            return msg;
        }

        this.conversationHistory.push({ role: 'user', content: raw, timestamp: Date.now() });
        return raw;
    } catch (err) {
        console.error(`[SyntheticUser:${this.role}] generateMessage error:`, err.message);
        return null;
    }
};

// ── Care circle orchestrator ──────────────────────────────────────────────────
// Mirrors CareCircleOrchestrator in synthetic_patient.py.
// Speaker selection algorithm is identical. Any change here must be
// hand-ported to the Python version.
//
// Per-role goal isolation: each SyntheticUser has its own goals array,
// currentGoalIndex, and coveredElements. The orchestrator never merges
// these — coverageFraction reports the PRIMARY PATIENT's coverage only,
// because the patient is the clinical subject of the session.

const _DEFAULT_ROLE_TARGETS = { patient: 0.55, caregiver: 0.30, doctor: 0.10 };

export class CareCircleOrchestrator {
    /**
     * @param {SyntheticUser[]} participants
     * @param {object} [options]
     * @param {object} [options.roleTargets]
     */
    constructor(participants, options = {}) {
        this.participants = participants;
        this.state        = new ConversationState();
        this.roleTargets  = { ..._DEFAULT_ROLE_TARGETS, ...(options.roleTargets || {}) };

        const present = new Set(participants.map(p => _normaliseRole(p.role)));
        if (!present.has('caregiver')) {
            this.roleTargets.patient   = (this.roleTargets.patient || 0.55) + 0.15;
            this.roleTargets.caregiver = 0;
        }
        if (!present.has('doctor')) {
            this.roleTargets.patient   = (this.roleTargets.patient || 0.70) + 0.10;
            this.roleTargets.caregiver = (this.roleTargets.caregiver || 0.30) + 0.05;
            this.roleTargets.doctor    = 0;
        }
        const total = Object.values(this.roleTargets).reduce((a, b) => a + b, 0) || 1;
        for (const k of Object.keys(this.roleTargets)) this.roleTargets[k] /= total;
    }

    get primaryPatient() {
        return this.participants.find(p => _normaliseRole(p.role) === 'patient') || this.participants[0];
    }

    /** Coverage fraction of the PRIMARY PATIENT's required elements only. */
    get coverageFraction() {
        const pp = this.primaryPatient;
        if (!pp.coveredElements) return 0;
        return pp.coveredElements.size / Math.max(1, pp.goals.length);
    }

    /**
     * Select next speaker, generate their message, update conversation state.
     * @param {string} agentResponse
     * @param {number} turnIdx
     * @returns {Promise<{participant: SyntheticUser, message: string, state: ConversationState}>}
     */
    async nextTurn(agentResponse, turnIdx) {
        this.state.updateFromMessage(agentResponse, 'agent');
        const speaker = this._selectSpeaker(turnIdx);
        const message = await speaker.generateMessage({
            lastAgentMessage:  agentResponse,
            conversationTurn:  turnIdx,
            conversationState: this.state,
        });
        if (message) this.state.updateFromMessage(message, speaker.role);
        return { participant: speaker, message, state: this.state };
    }

    // Mirrors _selectSpeakerByContext in realistic_conversation.js
    _selectSpeaker(turnIdx) {
        const s  = this.state;
        const byRole = {};
        for (const p of this.participants) {
            const r = _normaliseRole(p.role);
            (byRole[r] = byRole[r] || []).push(p);
        }
        const doctors    = byRole.doctor    || [];
        const caregivers = byRole.caregiver || [];
        const patient    = (byRole.patient  || [this.participants[0]])[0];

        if (s.momentum === 'crisis_mode' && doctors.length) return doctors[0];
        if (turnIdx === 0)                                   return patient;
        if (s.patientNeedsHelp && s.momentum === 'patient_led')  return patient;
        if (s.caregiverConcerned && !s.doctorAsked && caregivers.length) return caregivers[0];
        if (s.doctorAsked && doctors.length)                return doctors[0];
        return this._weightedDraw();
    }

    // Mirrors _computeAdaptiveWeights in realistic_conversation.js
    _weightedDraw() {
        const counts     = this.state.roleTurnCounts;
        const totalTurns = Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0));

        const weights = this.participants.map(p => {
            const role      = _normaliseRole(p.role);
            const target    = this.roleTargets[role] || 0.1;
            const actual    = (counts[role] || 0) / totalTurns;
            const shortfall = Math.max(target - actual, 0);
            let w           = target + shortfall * 1.5;
            if (role === 'doctor')                                w *= 0.35;
            if (this.state.lastSpeakerRole === role) w *= (role === 'patient' ? 0.8 : 0.25);
            return Math.max(w, 0.05);
        });

        const total = weights.reduce((a, b) => a + b, 0) || 1;
        let r = Math.random() * total;
        for (let i = 0; i < this.participants.length; i++) {
            r -= weights[i];
            if (r <= 0) return this.participants[i];
        }
        return this.participants[0];
    }
}

