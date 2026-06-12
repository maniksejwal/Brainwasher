/**
 * @fileoverview CompanionCoordinator
 * The coordinator that coordinates all Companion handlers, agents, and makes final decisions
 * Part of the Companion (coordinators + agents + handlers) that serves a user
 * ENHANCED: Now includes confidential companion-to-companion communication and decision coordination
 */

import { processCompanionHandlers } from './handlers/index.js';
import { aggregateResponses, resolveConflicts } from './utils/responseAggregator.js';
import { getDb } from '../db/connection.js';
import { processUserMessage, performContextEnrichment } from '../agents/unifiedAgent.js';
import { getLongitudinalHint, queryTensorRAGContext } from './physio/tensornetsBridge.js';
import { retrieveRelevantFacts } from '../db/queries_facts.js';

/**
 * Main coordinator that coordinates all Companion components
 * @param {string} userId - User ID
 * @param {string} role - User role (patient, caregiver, doctor)
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context (history, state, etc.)
 * @returns {Promise<object>} Final response object
 */
export async function coordinateCompanions(userId, role, message, circleId, context) {
    // Hoist currentTurn so it is available in the action-selector try block below
    // (was previously declared at Step 6, causing a TDZ error on every request).
    const currentTurn = context.history
        ? context.history.filter(m => m.user_id === userId).length + 1
        : 1;

    try {
        // Step 1: Activate all relevant handlers and agents
        // Some handlers depend on others, so we process in stages
        const initialResults = await processCompanionHandlers(userId, role, message, circleId, context);
        
        // Step 2: Enhance context with initial results for dependent handlers
        const enhancedContext = {
            ...context,
            inputUnderstanding: initialResults.inputUnderstanding?.result || {},
            historyAnalyzer: initialResults.historyAnalyzer?.result || {},
            empathyHandler: initialResults.empathyHandler?.result || {},
            stateTracker: initialResults.stateTracker?.result || {}
        };
        
        // Step 3: Re-process handlers that need enhanced context (like privacyGuard)
        // For now, privacyGuard gets enhanced context inline
        const componentResults = initialResults;

        // Step 2.5: ACTION SELECTION (MCTS planning layer)
        // Runs the action_selector prompt to decide WHAT action to take this turn,
        // before the patient optimizer decides HOW to phrase it.
        //
        // FRAMES mapping: each selected action carries a FRAMES component
        // (Feedback, Responsibility, Advice, Menu, Empathy, Self-efficacy)
        // which is injected into the patient optimizer context.
        //
        // This step DOES NOT conflict with response generation — it adds
        // `selectedAction` and `framesComponent` to enhancedContext.
        // The patient optimizer reads these as guidance, not hard constraints.
        //
        // DIVERGENCE HANDLING: if the user's actual message deviates from the
        // expected action trajectory (e.g. patient asks an off-topic question
        // when we expected compliance), the action selector recalculates from
        // the current message. MCTS backpropagation in the Python server also
        // updates Q-values so future selection adapts. Unexpected actions are
        // classified as:
        //   - topic_shift  → change_topic or topic_from_stack selected
        //   - off_message  → validate + acknowledge before returning to plan
        //   - escalation   → safety_protocol if crisis signals detected
        let selectedAction = null;
        let framesComponent = null;
        try {
            // Fetch longitudinal session hint from the Python server (non-blocking).
            // Injects cross-session memory context (phase, alliance, secrets) as a
            // short natural-language prefix into the action selector prompt.
            // Falls back silently to empty string if the server is unavailable.
            const longitudinalHint = await getLongitudinalHint(userId).catch(() => '');
            if (longitudinalHint) {
                enhancedContext.longitudinalHint = longitudinalHint;
            }

            // Retrieve relevant facts from facts_v2 (RAG retrieval with MPS-guided filtering).
            // Uses recency decay + MPS alignment to suppress stale false positives and
            // promote session-local facts to prevent false negatives from the current message.
            // Output is a structured block (not raw schema) injected into enhancedContext.
            if (circleId) {
                const factResult = await retrieveRelevantFacts({
                    circleId,
                    subjectId:     userId,
                    mpsHint:       longitudinalHint,
                    currentTopic:  enhancedContext.inputUnderstanding?.topic || '',
                    sensitivity:   context.privacyClearance || 'circle',
                    sessionStartMs: context.sessionStartMs || (Date.now() - 3_600_000),
                    topK: 6,
                }).catch(() => null);

                if (factResult?.block) {
                    enhancedContext.knownContextBlock = factResult.block;
                    enhancedContext.retrievedFacts    = factResult.facts;  // for audit log
                }
            }

            // TensorRAG: retrieve physio-conditioned clinical context for the current turn.
            // Runs in parallel with fact retrieval above; result injected into the prompt.
            const physio = context.physioState || {};
            const ragContext = await queryTensorRAGContext({
                text:              message,
                hrv_rmssd_ms:      physio.hrv_rmssd_ms   ?? physio.hrv_ms      ?? 35.0,
                stress_index:      physio.stress_index    ?? 0.3,
                sleep_quality:     physio.sleep_quality   ?? 1.0,
                therapeutic_stage: physio.stage_index     ?? 0.0,
                k:                 4,
                sources:           ['clinical_kb', 'episode_memory'],
            }).catch(() => '');
            if (ragContext) {
                enhancedContext.tensorRAGContext = ragContext;
            }

            const empathyLevel = enhancedContext.empathyHandler?.level || 'MEDIUM';
            const stressState   = context.physioState;
            const stressLevel   = stressState
                ? _stressLevelFromIndex(stressState.stress_index)
                : 'medium';
            const therapeuticMode = context.therapeuticMode || 'standard';
            const currentPhase    = context.deaddictionPhase || 'precontemplation';

            // Available actions vary by stress level (mirrors BaseMCTS gates)
            const availableActions = _availableActionsByStress(stressLevel);
            const blockedActions   = _blockedActionsByStress(stressLevel);

            // ── Intervention queue check ─────────────────────────────────────────
            // Before assembling the action selector prompt, check if there is a
            // pending cross-user intervention item due for this user this turn.
            // The peeked item is NOT marked surfaced here — that happens only if the
            // action selector returns 'surface_intervention' and the response is sent.
            let pendingIntervention = null;
            try {
                const { peekInterventionQueue } = await import('../db/queries_interventions.js');
                pendingIntervention = await peekInterventionQueue(userId, {
                    currentStressIndex: stressState?.stress_index ?? 0.0,
                    currentSessionTurn: currentTurn,
                });
                if (pendingIntervention) {
                    enhancedContext.pendingIntervention = pendingIntervention;
                    if (process.env.DEBUG_COMPANION) {
                        console.log(
                            `[CompanionCoordinator] Pending intervention for ${userId}: ` +
                            `type=${pendingIntervention.concern_type} ` +
                            `urgency=${pendingIntervention.urgency_score} ` +
                            `deadline=${pendingIntervention.deadline_at ?? 'none'}`
                        );
                    }
                }
            } catch (iqErr) {
                // Intervention queue is non-critical — never break response generation
                console.warn('[CompanionCoordinator] Intervention queue peek failed:', iqErr.message);
                if (process.env.NODE_ENV !== 'production') console.warn(iqErr.stack);
            }

            const { PROMPT_ACTION_SELECTOR, ACTION_TO_FRAMES } = await import('../prompts/action_selector.js');
            const { processUserMessage } = await import('../agents/unifiedAgent.js');

            // Build the {{PENDING_INTERVENTION}} block injected into the action selector.
            // Exposes urgency, concern type, and the privacy-filtered summary.
            // The LLM never sees the source_user_id or raw cross-user disclosure.
            const pendingInterventionBlock = pendingIntervention
                ? [
                    `PENDING INTERVENTION ITEM (item_id: ${pendingIntervention.item_id}):`,
                    `  concern_type   : ${pendingIntervention.concern_type}`,
                    `  urgency_score  : ${pendingIntervention.urgency_score}`,
                    `  summary        : ${pendingIntervention.concern_summary}`,
                    `  suggested_action: ${pendingIntervention.suggested_action ?? 'none'}`,
                    pendingIntervention.deadline_at
                        ? `  deadline_in    : ${Math.round((pendingIntervention.deadline_at - Date.now()) / 60000)}min`
                        : '',
                  ].filter(Boolean).join('\n')
                : 'none';

            const actionPrompt = PROMPT_ACTION_SELECTOR
                .replace('{{STRESS_LEVEL}}', stressLevel)
                .replace('{{HRV_NOTE}}', stressState ? `HRV ≈ ${stressState.hrv_rmssd_ms ?? '?'}ms` : 'unknown')
                .replace('{{ACTIVITY_CONTEXT}}', context.activityContext || 'none')
                .replace('{{AVAILABLE_ACTIONS}}', availableActions.join(', '))
                .replace('{{BLOCKED_ACTIONS}}',   blockedActions.join(', '))
                .replace('{{THERAPEUTIC_MODE}}',  therapeuticMode)
                .replace('{{CURRENT_PHASE}}',     currentPhase)
                .replace('{{SESSION_GOAL}}',      context.sessionGoal || 'general support')
                .replace('{{TURNS_COMPLETED}}',   String(currentTurn - 1))
                .replace('{{INFO_COVERAGE}}',     String(context.infoCoverage || 0.3))
                .replace('{{REPETITION_DETECTED}}', String(!!enhancedContext.inputUnderstanding?.repetition_detected))
                .replace('{{LAST_ACTION}}',       context.lastAction || 'none')
                .replace('{{MESSAGE}}',           message)
                .replace('{{CONVERSATION_HISTORY}}', _formatHistory(context.history, 4))
                .replace('{{KNOWN_CONTEXT}}',
                    enhancedContext.knownContextBlock
                        ? `\n---\n${enhancedContext.knownContextBlock}\n---`
                        : '')
                .replace('{{LONGITUDINAL_HINT}}',
                    enhancedContext.longitudinalHint
                        ? `\nSession history: ${enhancedContext.longitudinalHint}`
                        : '')
                .replace('{{TENSOR_RAG_CONTEXT}}',
                    enhancedContext.tensorRAGContext
                        ? `\n\n${enhancedContext.tensorRAGContext}`
                        : '')
                .replace('{{PENDING_INTERVENTION}}', pendingInterventionBlock)
                .replace('{{EXTRA_CONTEXT}}',
                    context.extraContext
                        ? `\n**DPO CONTEXT (Exp 0p — patient facts from Python side):**\n${context.extraContext}`
                        : '');

            const actionResult = await processUserMessage(
                userId, role, actionPrompt,
                (context.members || []).map(m => m.username),  // careCircleMembers must be array (unifiedAgent calls .join)
                circleId,
                null,
                { ...enhancedContext, _action_selector_call: true }
            );

            if (actionResult?.reply) {
                try {
                    const parsed = JSON.parse(
                        actionResult.reply.replace(/```json\n?/g, '').replace(/```/g, '').trim()
                    );
                    selectedAction  = parsed.action   || null;
                    framesComponent = parsed.frames_component || (selectedAction && ACTION_TO_FRAMES[selectedAction]) || null;

                    // Handle divergence: if stress_gate_check is 'blocked', override to safe action
                    if (parsed.stress_gate_check === 'blocked' && selectedAction) {
                        console.warn(
                            `[CompanionCoordinator] Action ${selectedAction} blocked by stress gate ` +
                            `(stress=${stressLevel}). Falling back to validate.`
                        );
                        selectedAction  = 'validate';
                        framesComponent = 'Responsibility';
                    }

                    if (process.env.DEBUG_COMPANION) {
                        console.log(
                            `[CompanionCoordinator] Action selected: ${selectedAction} ` +
                            `[FRAMES: ${framesComponent}] lookahead: ${parsed.lookahead_hint}`
                        );
                    }

                    // ── Intervention queue: mark surfaced when action selector chose it ──
                    // 'defer_intervention' leaves the item pending for reconsideration next turn.
                    // 'surface_intervention' marks it surfaced so it won't fire again this session.
                    if (selectedAction === 'surface_intervention' && pendingIntervention) {
                        try {
                            const { markSurfaced } = await import('../db/queries_interventions.js');
                            await markSurfaced(pendingIntervention.item_id, currentTurn);
                            // Pass the item into enhanced context so patient optimizer can use it
                            enhancedContext.surfacedInterventionItem = pendingIntervention;
                        } catch (mqErr) {
                            console.warn('[CompanionCoordinator] markSurfaced failed:', mqErr.message);
                        }
                    } else if (selectedAction === 'defer_intervention' && pendingIntervention) {
                        // Item stays pending — nothing to update in DB
                        if (process.env.DEBUG_COMPANION) {
                            console.log(`[CompanionCoordinator] Deferred intervention item=${pendingIntervention.item_id}`);
                        }
                    }
                } catch {
                    // JSON parse failure — action selector output was not valid JSON
                    // This is non-fatal; the patient optimizer runs without action guidance
                }
            }
        } catch (actionSelectorError) {
            // Action selector is advisory — never break a response because of it
            console.warn('[CompanionCoordinator] Action selector skipped:', actionSelectorError.message);
            if (process.env.NODE_ENV !== 'production') console.warn(actionSelectorError.stack);
        }

        // Inject action guidance into enhancedContext for use by the patient optimizer
        enhancedContext.selectedAction   = selectedAction;
        enhancedContext.framesComponent  = framesComponent;
        
        // Update privacyGuard with enhanced context if it didn't get it
        if (componentResults.privacyGuard && !componentResults.privacyGuard.result.sharingSuggestion) {
            const { processPrivacyDecision } = await import('./handlers/privacyGuard.js');
            componentResults.privacyGuard.result = await processPrivacyDecision(
                userId, role, message, circleId, enhancedContext
            );
        }
        
        // Step 4: Aggregate responses from all handlers and agents
        const aggregated = aggregateResponses(componentResults);
        
        // Step 5: Resolve any conflicts between handlers and agents
        const resolved = resolveConflicts(aggregated, componentResults);
        
        // Step 6: Generate future_plan if needed
        // (currentTurn is hoisted to the top of coordinateCompanions)
        
        // Generate future plan using dedicated agent
        let futurePlan = aggregated.future_plan || null;
        if (!futurePlan) {
            try {
                const { generateFuturePlan } = await import('./agents/futurePlanningAgent.js');
                futurePlan = await generateFuturePlan(
                    userId, 
                    role, 
                    message, 
                    circleId, 
                    context, 
                    currentTurn
                );
            } catch (error) {
                console.error('[CompanionCoordinator] Error generating future plan:', error.message);
                futurePlan = null;
            }
        }
        resolved.future_plan = futurePlan;
        
        // Step 7: Add state_update from state tracker
        resolved.state_update = aggregated.state_update || initialResults.stateTracker?.result?.state_update || null;
        
        // Step 8: MCTS candidate scoring — rank candidate replies by projected stress impact.
        // When the Python tensornets server is running, this replaces the default reply
        // with the physiologically safest candidate response.
        // Falls back to the aggregated reply when the server is unavailable (graceful).
        if (context.physioState && resolved.reply) {
            try {
                const { scoreCandidates, getMCTSAction } = await import('../physio/tensornetsBridge.js');

                // Build a small candidate set from the resolved reply + alternatives
                const candidates = [resolved.reply];
                if (aggregated.alternativeReplies?.length) {
                    candidates.push(...aggregated.alternativeReplies.slice(0, 4));
                }

                if (candidates.length > 1) {
                    const scored = await scoreCandidates({
                        subject_id:   context.physioState.subject_id || userId,
                        physio_state: context.physioState,
                        candidates,
                        n_lookahead:  3,
                    });

                    if (scored?.best) {
                        if (process.env.DEBUG_COMPANION) {
                            console.log(
                                `[CompanionCoordinator] MCTS selected candidate #${scored.best.rank} ` +
                                `(projected_stress=${scored.best.projected_stress}, ` +
                                `keywords: ${scored.best.stress_keywords} stress / ${scored.best.calm_keywords} calm)`
                            );
                        }
                        // Only swap to MCTS best if it differs meaningfully from the default
                        if (scored.best.candidate_index !== 0) {
                            resolved.reply = scored.best.candidate_text;
                            resolved.mcts_applied = true;
                        }
                        resolved.mcts_score = scored.best.projected_stress;
                        resolved.current_stress = scored.current_stress;
                    }
                }
            } catch (mctsError) {
                // MCTS is advisory — never break a response because of it
                console.warn('[CompanionCoordinator] MCTS scoring skipped:', mctsError.message);
            }
        }

        // Step 9: Ensure we have required fields for compatibility
        if (!resolved.intent) {
            resolved.intent = aggregated.intent || 'ASKING_QUESTION';
        }
        if (!resolved.reply) {
            resolved.reply = 'I understand. Can you tell me more?';
        }
        
        // Step 10: Return final coordinated response
        return resolved;
    } catch (error) {
        console.error('[CompanionCoordinator] Error:', error.message);
        // Fallback response
        return {
            intent: 'ASKING_QUESTION',
            reply: 'I understand. Can you tell me more?',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {},
            sharingSuggestion: null
        };
    }
}

/**
 * Determine which handlers and agents are relevant for this message
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {object} context - Conversation context
 * @returns {Array<string>} List of handler names to activate
 */
export function getRelevantHandlers(role, message, context) {
    const components = [];
    
    // Core handlers (always included)
    components.push('inputUnderstanding', 'historyAnalyzer', 'empathyHandler', 'stateTracker');
    // privacyGuard: included unless the caller explicitly disables it (Exp 5a ablation)
    if (!context?.skipPrivacyGuard) {
        components.push('privacyGuard');
    }
    
    // Role-specific agents
    if (role === 'patient') {
        components.push('patientOptimizer');
    } else if (role === 'doctor') {
        components.push('doctorOptimizer');
    } else if (role === 'caregiver') {
        components.push('caregiverOptimizer');
    }
    
    // Context-dependent agents
    if (context.hasMedicalContent || message.toLowerCase().includes('pain') || message.toLowerCase().includes('symptom')) {
        components.push('clinicalAgent');
    }
    
    if (context.hasCriticalContent || message.toLowerCase().includes('emergency') || message.toLowerCase().includes('urgent')) {
        components.push('escalationManager');
    }
    
    return components;
}

/**
 * Enhanced CompanionCoordinator class with confidential communication capabilities
 */
export class CompanionCoordinator {
    constructor() {
        this.confidentialLevels = {
            COMPANION_ONLY: 'companion_only',      // Only the sending companion sees this
            COMPANION_NETWORK: 'companion_network', // All user's companions can see
            CROSS_USER_COMPANION: 'cross_user'     // Can be shared with other users' companions
        };
    }

    /**
     * Initialize database schema for confidential communication
     */
    async initializeSchema() {
        const db = getDb();
        
        // Companion confidential messages - FIXED: Match existing database schema
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_confidential_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                sender_companion_id TEXT NOT NULL,
                sender_user_id TEXT NOT NULL,
                recipient_companion_id TEXT,
                recipient_user_id TEXT,
                message_content TEXT NOT NULL,
                confidential_level TEXT NOT NULL,
                intelligence_type TEXT,
                related_circle_id TEXT,
                metadata TEXT,
                requires_action BOOLEAN DEFAULT 0,
                expires_at INTEGER,
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                FOREIGN KEY (sender_user_id) REFERENCES users(user_id),
                FOREIGN KEY (recipient_user_id) REFERENCES users(user_id)
            )
        `);

        // Intelligence sharing between companions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_intel_sharing (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_companion TEXT NOT NULL,
                target_companion TEXT NOT NULL,
                user_id TEXT NOT NULL,
                intelligence_type TEXT NOT NULL,
                intelligence_content TEXT NOT NULL,
                confidence_level REAL DEFAULT 0.5,
                shared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                acted_upon BOOLEAN DEFAULT FALSE
            )
        `);

        // Decision coordination between companions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_decision_sync (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                decision_context TEXT NOT NULL,
                user_id TEXT NOT NULL,
                circle_id TEXT,
                medical_companion_input TEXT,
                professional_companion_input TEXT,
                social_companion_input TEXT,
                consensus_reached BOOLEAN DEFAULT FALSE,
                final_decision TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    /**
     * Send confidential message between companions
     */
    async sendCompanionMessage(senderType, receiverType, userId, messageContent, confidentialLevel = 'companion_network', contextData = null, targetUserId = null) {
        const db = getDb();
        
        // Set expiration based on confidential level (24h for companion_only, 7d for others)
        const expirationHours = confidentialLevel === 'companion_only' ? 24 : 168;
        const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString();

        const { randomUUID } = await import('crypto');
        const messageId = randomUUID();
        
        const result = await db.run(`
            INSERT INTO companion_confidential_messages (
                message_id, sender_companion_id, recipient_companion_id, sender_user_id, recipient_user_id,
                message_content, confidential_level, metadata, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [messageId, senderType, receiverType, userId, targetUserId, messageContent, confidentialLevel, JSON.stringify(contextData), expiresAt, Date.now()]);

        console.log(`[CompanionCoordinator] Confidential message sent: ${senderType} → ${receiverType} (Level: ${confidentialLevel})`);
        return messageId;
    }

    /**
     * Share intelligence between companions
     */
    async shareIntelligenceBetweenCompanions(sourceCompanion, targetCompanion, userId, intelligenceType, content, confidenceLevel = 0.7) {
        const db = getDb();
        
        await db.run(`
            INSERT INTO companion_intel_sharing (
                source_companion, target_companion, user_id, intelligence_type, 
                intelligence_content, confidence_level
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [sourceCompanion, targetCompanion, userId, intelligenceType, content, confidenceLevel]);

        console.log(`[CompanionCoordinator] Intelligence shared: ${sourceCompanion} → ${targetCompanion} (${intelligenceType}, confidence: ${confidenceLevel})`);
    }

    /**
     * Coordinate decision-making among multiple companions
     */
    async coordinateCompanionDecision(decisionContext, userId, circleId = null, messageForAnalysis = null) {
        const db = getDb();
        
        // Get decision input from each companion type
        const medicalInput = await this.getCompanionDecisionInput('medical', userId, decisionContext, messageForAnalysis);
        const professionalInput = await this.getCompanionDecisionInput('professional', userId, decisionContext, messageForAnalysis);
        const socialInput = await this.getCompanionDecisionInput('social', userId, decisionContext, messageForAnalysis);

        // Analyze consensus using LLM
        const companionInputsForConsensus = {
            medical_companion: medicalInput,
            professional_companion: professionalInput,
            social_companion: socialInput
        };
        const consensus = await this.analyzeCompanionConsensus(companionInputsForConsensus, decisionContext);
        
        // Store decision coordination
        const result = await db.run(`
            INSERT INTO companion_decision_sync (
                decision_context, user_id, circle_id, medical_companion_input,
                professional_companion_input, social_companion_input,
                consensus_reached, final_decision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            decisionContext, userId, circleId,
            JSON.stringify(medicalInput), JSON.stringify(professionalInput), JSON.stringify(socialInput),
            consensus.reached, JSON.stringify(consensus.decision)
        ]);

        console.log(`[CompanionCoordinator] Decision coordination complete. Consensus: ${consensus.reached}`);
        return {
            decisionId: result.lastID,
            consensus: consensus.reached,
            decision: consensus.decision,
            companionInputs: {
                medical: medicalInput,
                professional: professionalInput,
                social: socialInput
            }
        };
    }

    /**
     * Get decision input from a specific companion type using existing AI agents
     */
    async getCompanionDecisionInput(companionType, userId, decisionContext, messageForAnalysis = null) {
        try {
            // Create companion-specific decision prompt
            const prompt = this.createCompanionDecisionPrompt(companionType, decisionContext, messageForAnalysis);
            
            // Use existing AI processing with companion focus
            const analysis = await processUserMessage(prompt, {
                userId,
                focusAreas: this.getCompanionFocusAreas(companionType),
                analysisDepth: 'medium'
            });

            // Extract companion perspective from AI response
            return this.extractCompanionPerspective(companionType, analysis, decisionContext);

        } catch (error) {
            console.error(`[CompanionCoordinator] Error getting ${companionType} companion input:`, error);
            // Fallback to basic companion input
            return this.getFallbackCompanionInput(companionType, decisionContext);
        }
    }

    /**
     * Create companion-specific decision prompt
     */
    createCompanionDecisionPrompt(companionType, decisionContext, messageForAnalysis) {
        const basePrompt = `As a ${companionType} companion AI, analyze this decision context and provide your perspective:`;
        
        let specificGuidance = '';
        switch (companionType) {
            case 'medical':
                specificGuidance = 'Focus on health implications, safety considerations, and medical best practices.';
                break;
            case 'professional':
                specificGuidance = 'Focus on business implications, organizational dynamics, and professional relationships.';
                break;
            case 'social':
                specificGuidance = 'Focus on social dynamics, relationship implications, and community considerations.';
                break;
        }

        return `${basePrompt}

Decision Context: ${decisionContext}
${messageForAnalysis ? `Related Message: ${messageForAnalysis}` : ''}

${specificGuidance}

Please provide:
1. Your perspective on this decision
2. Key concerns or considerations from your domain
3. Recommended action or approach
4. Confidence level (0.0-1.0)`;
    }

    /**
     * Get focus areas for different companion types
     */
    getCompanionFocusAreas(companionType) {
        const focusMap = {
            medical: ['health_safety', 'medical_protocols', 'care_coordination'],
            professional: ['business_goals', 'organizational_dynamics', 'professional_relationships'],
            social: ['social_dynamics', 'community_impact', 'relationship_health']
        };
        return focusMap[companionType] || ['general_analysis'];
    }

    /**
     * Extract companion perspective from AI analysis
     */
    extractCompanionPerspective(companionType, analysis, decisionContext) {
        // Parse AI response to extract structured companion input
        const text = analysis.response || analysis.message || '';
        
        // Basic parsing - in real implementation, would use more sophisticated extraction
        const perspective = text.includes('perspective') ? 
            text.split('perspective')[1]?.split('2.')[0]?.trim() : 
            'No clear perspective identified';
        
        const concerns = text.includes('concerns') || text.includes('considerations') ?
            text.split(/concerns|considerations/)[1]?.split('3.')[0]?.trim() :
            'No specific concerns identified';

        const recommendation = text.includes('recommend') ?
            text.split('recommend')[1]?.split('4.')[0]?.trim() :
            'No specific recommendation';

        // Extract confidence level
        const confidenceMatch = text.match(/confidence.*?(\d*\.?\d+)/i);
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

        return {
            companionType,
            perspective,
            concerns,
            recommendation,
            confidence,
            decisionContext,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Fallback companion input when AI is unavailable
     */
    getFallbackCompanionInput(companionType, decisionContext) {
        const fallbacks = {
            medical: {
                perspective: 'Focus on health and safety implications',
                concerns: 'Ensure medical protocols are followed',
                recommendation: 'Prioritize patient safety and care quality',
                confidence: 0.3
            },
            professional: {
                perspective: 'Consider business and organizational impact',
                concerns: 'Maintain professional relationships and goals',
                recommendation: 'Balance efficiency with relationship preservation',
                confidence: 0.3
            },
            social: {
                perspective: 'Consider social and community dynamics',
                concerns: 'Maintain social harmony and relationships',
                recommendation: 'Foster positive social interactions',
                confidence: 0.3
            }
        };

        const fallback = fallbacks[companionType] || fallbacks.social;
        return {
            companionType,
            ...fallback,
            decisionContext,
            timestamp: new Date().toISOString(),
            fallback: true
        };
    }

    /**
     * Analyze consensus between companion inputs using LLM
     */
    async analyzeCompanionConsensus(companionInputs, decisionContext) {
        // Use the dedicated CompanionConfidentialComm for LLM-powered consensus
        const { default: CompanionConfidentialComm } = await import('./confidential/CompanionConfidentialComm.js');
        const companionComm = new CompanionConfidentialComm();
        
        const consensus = await companionComm.analyzeCompanionConsensus(companionInputs, decisionContext);
        
        // Transform to the expected format for backward compatibility
        return {
            reached: consensus.reached,
            confidence: consensus.confidence,
            conflictsDetected: consensus.conflictingAreas && consensus.conflictingAreas.length > 0,
            decision: consensus.reached ? {
                action: 'proceed_with_coordination',
                rationale: consensus.recommendation,
                companionAlignment: consensus.unanimous ? 'unanimous' : 'aligned'
            } : {
                action: 'require_human_input',
                rationale: consensus.reason,
                companionAlignment: consensus.majorityPosition === 'neutral' ? 'uncertain' : 'conflicted'
            },
            // Additional fields from LLM analysis
            supportCount: consensus.supportCount,
            concernCount: consensus.concernCount,
            nuances: consensus.nuances,
            majorityPosition: consensus.majorityPosition
        };
    }

    /**
     * Get confidential messages for a companion
     */
    async getCompanionMessages(companionType, userId, unreadOnly = false) {
        const db = getDb();
        
        let query = `
            SELECT * FROM companion_confidential_messages 
            WHERE recipient_companion_id = ? AND recipient_user_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
        `;
        const params = [companionType, userId, Date.now()];
        
        if (unreadOnly) {
            query += ' AND read_at IS NULL';
        }
        
        query += ' ORDER BY created_at DESC';
        
        const messages = await db.all(query, params);
        return messages.map(msg => ({
            ...msg,
            context_data: msg.context_data ? JSON.parse(msg.context_data) : null
        }));
    }

    /**
     * Mark companion message as read
     */
    async markCompanionMessageRead(messageId) {
        const db = getDb();
        await db.run(`
            UPDATE companion_confidential_messages 
            SET read_at = ? 
            WHERE message_id = ?
        `, [Date.now(), messageId]);
    }

    /**
     * Clean up expired messages
     */
    async cleanupExpiredMessages() {
        const db = getDb();
        const result = await db.run(`
            DELETE FROM companion_confidential_messages 
            WHERE expires_at IS NOT NULL AND expires_at < ?
        `, [Date.now()]);
        
        if (result.changes > 0) {
            console.log(`[CompanionCoordinator] Cleaned up ${result.changes} expired companion messages`);
        }
        return result.changes;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action selector helpers (module-level, used by coordinateCompanions)
// ─────────────────────────────────────────────────────────────────────────────

function _stressLevelFromIndex(index) {
    if (!index && index !== 0) return 'medium';
    if (index >= 0.75) return 'critical';
    if (index >= 0.55) return 'high';
    if (index >= 0.35) return 'medium';
    return 'low';
}

function _availableActionsByStress(level) {
    const all = [
        'open_question', 'empathic_reflection', 'affirmation', 'validate',
        'give_facts', 'give_options', 'summarise', 'psychoeducation',
        'challenger_insight', 'develop_discrepancy', 'loss_frame', 'socratic_probe',
        'socratic_reframe', 'change_topic', 'topic_from_stack',
    ];
    if (level === 'critical')
        return ['validate', 'empathic_reflection', 'safety_protocol', 'acknowledge_only'];
    if (level === 'high')
        return ['validate', 'empathic_reflection', 'give_facts', 'change_topic'];
    if (level === 'medium')
        return all.filter(a => !['challenger_insight', 'loss_frame', 'flooding_hold', 'flooding_deepen', 'spike_step'].includes(a));
    return all;
}

function _blockedActionsByStress(level) {
    if (level === 'critical') return ['challenger_insight', 'develop_discrepancy', 'loss_frame', 'psychoeducation', 'give_options', 'flooding_hold', 'spike_step'];
    if (level === 'high')     return ['challenger_insight', 'develop_discrepancy', 'loss_frame', 'flooding_hold', 'spike_step'];
    if (level === 'medium')   return ['flooding_hold', 'flooding_deepen', 'spike_step'];
    return [];
}

function _formatHistory(history, n) {
    if (!history?.length) return '(no history)';
    return history.slice(-n * 2).map(m =>
        `${m.role === 'assistant' ? 'Companion' : 'Patient'}: ${m.content?.slice(0, 120) ?? m.message?.slice(0, 120) ?? ''}`
    ).join('\n');
}

