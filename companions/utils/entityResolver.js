/**
 * @fileoverview Entity Resolution Utility for Companion System
 * Matches mentioned usernames/nicknames to actual care circle members
 */

/**
 * Match mentioned name to actual circle member
 * Handles:
 * - Exact username matches
 * - Case-insensitive matches
 * - Nickname matches (if stored)
 * - Partial matches (e.g., "B" matching "bob")
 * @param {string} mentionedName - Name mentioned in message
 * @param {Array} members - Array of care circle members with username, user_id, role
 * @returns {object|null} Matched member or null
 */
export function matchMentionedUser(mentionedName, members) {
    if (!mentionedName || !members || members.length === 0) {
        return null;
    }
    
    const mentionedLower = mentionedName.toLowerCase().trim();
    
    // Try exact match (case-insensitive)
    let matched = members.find(m => 
        m.username && m.username.toLowerCase() === mentionedLower
    );
    if (matched) return matched;
    
    // Try partial match (e.g., "b" matches "bob")
    matched = members.find(m => 
        m.username && m.username.toLowerCase().startsWith(mentionedLower)
    );
    if (matched) return matched;
    
    // Try reverse partial match (e.g., "bob" mentioned when username is "b")
    matched = members.find(m => 
        m.username && mentionedLower.startsWith(m.username.toLowerCase())
    );
    if (matched) return matched;
    
    // Try nickname matching (if members have nickname field)
    matched = members.find(m => 
        m.nickname && m.nickname.toLowerCase() === mentionedLower
    );
    if (matched) return matched;
    
    // Try matching by first letter (e.g., "A" for "alice")
    if (mentionedLower.length === 1) {
        matched = members.find(m => 
            m.username && m.username.toLowerCase().charAt(0) === mentionedLower
        );
        if (matched) return matched;
    }
    
    return null;
}

/**
 * Extract and resolve all mentioned users from a message
 * @param {string} message - User message
 * @param {Array} members - Care circle members
 * @param {Array} mentionedUsernames - Already extracted usernames from AI (optional)
 * @returns {Array} Array of resolved member objects with match confidence
 */
export function resolveMentionedUsers(message, members, mentionedUsernames = []) {
    const resolved = [];
    
    // Use AI-extracted usernames if available
    for (const mentionedName of mentionedUsernames) {
        const matched = matchMentionedUser(mentionedName, members);
        if (matched) {
            resolved.push({
                mentionedName,
                matchedMember: matched,
                confidence: 'high',
                matchType: 'ai_extracted'
            });
        }
    }
    
    // Also try direct string matching in message (for cases AI missed)
    if (members && members.length > 0) {
        const messageLower = message.toLowerCase();
        for (const member of members) {
            if (!member.username) continue;
            
            const usernameLower = member.username.toLowerCase();
            
            // Check if username appears in message (whole word)
            const usernameRegex = new RegExp(`\\b${usernameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (usernameRegex.test(message) && !resolved.find(r => r.matchedMember.user_id === member.user_id)) {
                resolved.push({
                    mentionedName: member.username,
                    matchedMember: member,
                    confidence: 'high',
                    matchType: 'direct_mention'
                });
            }
        }
    }
    
    return resolved;
}

/**
 * Get member information for context
 * @param {Array} members - Care circle members
 * @returns {string} Formatted member list for prompts
 */
export function formatMemberListForPrompt(members) {
    if (!members || members.length === 0) {
        return 'No other members';
    }
    
    return members.map(m => {
        const parts = [m.username];
        if (m.role) parts.push(`(${m.role})`);
        if (m.relationship_type) parts.push(`- ${m.relationship_type}`);
        return parts.join(' ');
    }).join(', ');
}

