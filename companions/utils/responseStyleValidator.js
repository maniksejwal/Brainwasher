/**
 * @fileoverview Response Style Validator
 * Enforces response style guidelines: length, probing questions, blank turns, verbosity
 */

/**
 * Check if response is too verbose (more than 2 sentences)
 */
export function isTooVerbose(response) {
    if (!response || typeof response !== 'string') return false;
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.length > 2;
}

/**
 * Check if response ends with a probing question
 */
export function endsWithProbingQuestion(response) {
    if (!response || typeof response !== 'string') return false;
    const trimmed = response.trim();
    const probingStarters = /\b(how|what|when|where|why|can you tell me|tell me more|what's|what is|how's|how is)\b/i;
    const questionMark = trimmed.endsWith('?');
    
    // Check if it ends with a question that starts with a probing word
    const lastSentence = trimmed.split(/[.!?]/).filter(s => s.trim()).pop() || '';
    return questionMark && probingStarters.test(lastSentence);
}

/**
 * Check if response should be a blank turn
 * Conditions: user seems to be holding back, in middle of explaining, or needs encouragement
 */
export function shouldUseBlankTurn(userMessage, historyAnalysis, conversationHistory) {
    if (!userMessage || typeof userMessage !== 'string') return false;
    
    const message = userMessage.toLowerCase();
    const history = conversationHistory || [];
    
    // User seems to be in the middle of explaining (incomplete thoughts)
    const incompletePatterns = [
        /\b(but|and|or|because|so|although|however|though|while|when|if|since|as)\s*$/i,
        /^\.\.\.|\.\.\.$/,
        /\b(umm|uh|hmm|well|you know|i mean|i guess|i think|maybe|perhaps)\b/i
    ];
    
    const isIncomplete = incompletePatterns.some(pattern => pattern.test(message));
    
    // User seems to be holding back (short responses, vague language)
    const holdingBackPatterns = [
        /\b(just|only|a little|kind of|sort of|maybe|probably|i guess|i think)\b/i,
        /^.{1,30}$/ // Very short message
    ];
    
    const isHoldingBack = holdingBackPatterns.some(pattern => pattern.test(message)) && 
                         message.length < 50;
    
    // Recent history shows user is elaborating
    const recentUserMessages = history.filter(h => h.user_id && h.message).slice(-3);
    const isElaborating = recentUserMessages.length >= 2 && 
                         recentUserMessages[recentUserMessages.length - 1].message.length > 
                         recentUserMessages[recentUserMessages.length - 2].message.length;
    
    return isIncomplete || (isHoldingBack && isElaborating);
}

/**
 * Check if response avoids yes/no questions
 */
export function hasYesNoQuestion(response) {
    if (!response || typeof response !== 'string') return false;
    const yesNoPatterns = [
        /\b(are you|do you|have you|did you|will you|would you|can you|should you|is there|does|has|did|will|would|can|should)\s+\w+\s*\?/i
    ];
    return yesNoPatterns.some(pattern => pattern.test(response));
}

/**
 * Validate and adjust response based on style guidelines
 */
export function validateAndAdjustResponse(response, userMessage, historyAnalysis, conversationHistory, options = {}) {
    if (!response || typeof response !== 'string') {
        return { response: null, adjustments: [] };
    }
    
    const adjustments = [];
    let adjustedResponse = response;
    
    // Check for blank turn opportunity
    // if (options.allowBlankTurns && shouldUseBlankTurn(userMessage, historyAnalysis, conversationHistory)) {
    //     adjustedResponse = getBlankTurnResponse();
    //     adjustments.push('blank_turn');
    //     return { response: adjustedResponse, adjustments };
    // }
    
    // Check verbosity
    if (isTooVerbose(adjustedResponse)) {
        // Truncate to first 2 sentences
        const sentences = adjustedResponse.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 2) {
            adjustedResponse = sentences.slice(0, 2).join('. ') + '.';
            adjustments.push('truncated');
        }
    }
    
    // Check for repetition - if detected, suggest change
    if (historyAnalysis?.isRepetitive && !options.allowRepetition) {
        // Add variety instruction (this should be handled by the prompt, but we can flag it)
        adjustments.push('repetition_detected');
    }
    
    // Check for yes/no questions
    if (hasYesNoQuestion(adjustedResponse) && !options.allowYesNo) {
        adjustments.push('yes_no_question');
        // Note: Conversion to open-ended should be handled by prompt, but we flag it
    }
    
    // Check for probing question
    if (!endsWithProbingQuestion(adjustedResponse) && options.requireProbing && adjustedResponse.length > 20) {
        adjustments.push('missing_probing_question');
        // Note: Addition should be handled by prompt
    }
    
    return {
        response: adjustedResponse,
        adjustments,
        needsRegeneration: adjustments.includes('yes_no_question') || adjustments.includes('missing_probing_question')
    };
}

