/**
 * @fileoverview Privacy Guard Handler
 * Manages consent, privacy, sharing decisions, relationships, and intent-based sharing
 */

import { getCircleMembers, getImpliedConsent, findCircleByPatientId } from '../../db/index.js';

/**
 * Process privacy decision with full granularity
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Privacy decision with sharing suggestions
 */
export async function processPrivacyDecision(userId, role, message, circleId, context) {
    // Get analysis from input understanding
    const intent = context.inputUnderstanding?.intent || 'ASKING_QUESTION';
    const mentionedUsernames = context.inputUnderstanding?.mentionedUsernames || [];
    const facts = context.inputUnderstanding?.facts || {};
    const resolvedUsers = context.inputUnderstanding?.resolvedUsers || []; // Resolved member matches
    
    // Determine privacy level
    let privacyLevel = 'PRIVATE';
    
    // Check if message contains sensitive content
    const sensitiveKeywords = ['medication', 'diagnosis', 'treatment', 'mental health', 'depression', 'anxiety', 'suicide', 'abuse'];
    const hasSensitiveContent = sensitiveKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
    );
    
    if (hasSensitiveContent) {
        privacyLevel = 'SENSITIVE';
    }
    
    // Check for public information (general conversation, non-medical)
    const publicKeywords = ['hello', 'hi', 'thanks', 'thank you', 'how are you'];
    const isPublicContent = publicKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
    ) && !hasSensitiveContent && intent === 'ASKING_QUESTION';
    
    if (isPublicContent) {
        privacyLevel = 'PUBLIC';
    }
    
    // Determine sharing suggestion based on intent and context
    let sharingSuggestion = null;
    
    // Get circle members for relationship checks
    const members = context.members || await getCircleMembers(circleId);
    const circle = await findCircleByPatientId(circleId);
    const patient = circle ? members.find(m => m.user_id === circle.primary_patient_id) : null;
    
    // Intent-based sharing suggestions
    if (intent === 'REPORTING_FACT') {
        // Check if facts are about another person
        const factsAboutOthers = Object.entries(facts).filter(([key, value]) => {
            // Check if value mentions another username
            if (typeof value === 'string') {
                return mentionedUsernames.some(username => 
                    value.toLowerCase().includes(username.toLowerCase())
                );
            }
            return false;
        });
        
        if (factsAboutOthers.length > 0 && mentionedUsernames.length > 0) {
            // Use resolved user if available (better matching with nicknames/IDs)
            let targetMember = null;
            let targetUsername = mentionedUsernames[0];
            
            if (resolvedUsers.length > 0) {
                // Use first resolved match (highest confidence)
                targetMember = resolvedUsers[0].matchedMember;
                targetUsername = targetMember.username;
            } else {
                // Fallback to direct matching
                targetMember = members.find(m => 
                    m.username.toLowerCase() === targetUsername.toLowerCase()
                );
            }
            
            if (targetMember) {
                // Check consent levels
                const targetConsent = targetMember.consent_level || 'none';
                
                // Check implied consent for topic
                const topic = Object.keys(facts)[0] || 'general';
                const implied = await getImpliedConsent(userId, circleId, topic);
                
                // Determine if we should suggest sharing or ask for consent
                if (targetConsent === 'full' || implied) {
                    // Can share directly
                    sharingSuggestion = {
                        target: targetMember.username,
                        reason: `Share information about ${targetUsername}`,
                        content_to_share: `${Object.keys(facts).join(', ')}: ${Object.values(facts).join(', ')}`
                    };
                } else {
                    // Need to ask for consent
                    sharingSuggestion = {
                        target: targetMember.username,
                        reason: `Ask permission to share information about ${targetUsername}`,
                        content_to_share: `${Object.keys(facts).join(', ')}: ${Object.values(facts).join(', ')}`,
                        requiresConsent: true
                    };
                }
            }
        }
    } else if (intent === 'REQUESTING_MEDIATION') {
        // User wants to communicate with another person
        if (mentionedUsernames.length > 0) {
            // Use resolved user if available for better matching
            const targetUser = resolvedUsers.length > 0 ? resolvedUsers[0].matchedMember : null;
            const targetUsername = targetUser?.username || mentionedUsernames[0];
            const targetMember = members.find(m => 
                m.username.toLowerCase() === targetUsername.toLowerCase()
            );
            
            if (targetMember) {
                sharingSuggestion = {
                    target: targetMember.username,
                    reason: 'Mediate communication',
                    content_to_share: message.substring(0, 200)
                };
            }
        }
    } else if (intent === 'GIVING_ADVICE_FOR_OTHER') {
        // User is giving advice to another person
        if (mentionedUsernames.length > 0) {
            // Use resolved user if available for better matching
            const targetUser = resolvedUsers.length > 0 ? resolvedUsers[0].matchedMember : null;
            const targetUsername = targetUser?.username || mentionedUsernames[0];
            const targetMember = members.find(m => 
                m.username.toLowerCase() === targetUsername.toLowerCase()
            );
            
            if (targetMember) {
                sharingSuggestion = {
                    target: targetMember.username,
                    reason: 'Share medical advice',
                    content_to_share: message.substring(0, 200)
                };
            }
        }
    } else if (intent === 'REQUESTING_DOCTOR') {
        // User explicitly requests doctor
        sharingSuggestion = {
            target: 'doctor',
            reason: 'Patient requested doctor consultation',
            content_to_share: 'Patient wants to speak with doctor'
        };
    }
    
    return {
        level: privacyLevel,
        sharingSuggestion,
        consentCheck: {
            required: sharingSuggestion?.requiresConsent || false,
            target: sharingSuggestion?.target || null
        }
    };
}

