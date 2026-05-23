/**
 * @fileoverview handlers/commands/switchContext.js
 * 
 * Context switching functionality for multi-circle navigation. Handles switching between:
 * - Care circles (patient-based): /switch <patient_username>
 * - Professional circles (ID-based): /switch <circle_id>
 * 
 * Ensures proper context validation, permission checking, and complete context payload
 * delivery to maintain user session state across different circles.
 */

import { findUserByUsername, findUserById, findCircleByPatientId, getMemberInfo } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { generateAndSendSummary } from './commandHelpers.js';

/**
 * Main handler for the /switch command supporting both care and professional circles.
 * 
 * BACKWARD COMPATIBLE Command syntax:
 * - /switch <patient_username>        : Switch to a care circle by patient username
 * - /switch <patient_user_id>         : Switch to a care circle by numeric patient ID  
 * - /switch professional_<id>         : Switch to a professional circle by full ID
 * - /switch <professional_circle_name>: Switch to a professional circle by name
 * 
 * @param {string} userId - ID of the user requesting the context switch
 * @param {string} circleId - Current circle ID (may be null for context switching)
 * @param {string[]} parts - Command parts array where:
 *   - parts[0] = '/switch' (command name)
 *   - parts[1] = target (various formats supported)
 *   
 * Process:
 * 1. Validates target parameter exists
 * 2. Routes based on target format with clear precedence:
 *    a) professional_xxxxx -> Professional circle ID
 *    b) numeric -> Could be care circle patient ID or professional ID
 *    c) text -> Try professional name, then patient username
 * 3. Emits 'context_switch' event with complete context payload
 * 
 * @returns {Promise<void>} Async operation, results sent via broadcast events
 */
export async function handleSwitchCommand(userId, circleId, parts) {
    const target = parts[1];
    if (!target) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: /switch <patient_username>, /switch <circle_id>, or /switch <circle_name>`, from: 'system', circleId });
        return;
    }

    const currentUser = await findUserById(userId);
    
    // ENHANCED SWITCH LOGIC - Backward Compatible & Clear Precedence
    // Priority order:
    // 1. Professional circle full IDs (professional_xxxxx)
    // 2. Numeric IDs (could be care circle patient IDs or professional circle IDs)  
    // 3. Professional circle names (saas, project_alpha, etc.)
    // 4. Care circle patient usernames (alice_smith, john_doe, etc.)
    
    if (target.startsWith('professional_')) {
        // Explicit professional circle ID - highest priority
        await handleCircleIdSwitch(userId, target, currentUser);
        
    } else if (!isNaN(target)) {
        // Numeric ID - could be either care or professional circle
        await handleNumericIdSwitch(userId, target, currentUser);
        
    } else {
        // Text identifier - try professional name first, then patient username
        const professionalCircleFound = await handleProfessionalCircleNameSwitch(userId, target, currentUser, circleId);
        if (!professionalCircleFound) {
            // Fall back to care circle patient username lookup
            await handlePatientUsernameSwitch(userId, target, currentUser, circleId);
        }
    }
}

/**
 * Attempts to switch to a professional circle by name.
 * 
 * @param {string} userId - ID of the user requesting the switch
 * @param {string} targetCircleName - Name of the professional circle (e.g., "saas", "alpha")
 * @param {Object} currentUser - User object containing username and other details
 * @param {string} circleId - Current circle ID context
 * 
 * @returns {Promise<boolean>} True if professional circle found and switched, false otherwise
 */
async function handleProfessionalCircleNameSwitch(userId, targetCircleName, currentUser, circleId) {
    const { getUserCircles } = await import('../../db/index.js');
    
    try {
        // Get user's circles
        const allCircles = await getUserCircles(userId);
        const professionalCircles = allCircles.filter(c => c.circle_type === 'professional');
        
        // Find matching professional circle by name
        const targetCircle = professionalCircles.find(circle => {
            if (circle.organization_context) {
                try {
                    const orgContext = JSON.parse(circle.organization_context);
                    if (orgContext.name) {
                        // Try exact match first
                        const exactMatch = orgContext.name.toLowerCase() === targetCircleName.toLowerCase();
                        // Try without professional_ prefix  
                        const withoutPrefix = orgContext.name.replace(/^professional_/i, '').toLowerCase() === targetCircleName.toLowerCase();
                        return exactMatch || withoutPrefix;
                    }
                    return false;
                } catch (e) {
                    return false;
                }
            }
            return false;
        });
        
        if (!targetCircle) {
            return false; // Not found, let caller try other methods
        }
        
        // Found professional circle, switch to it using the circle ID logic
        await handleCircleIdSwitch(userId, targetCircle.circle_id, currentUser);
        return true;
        
    } catch (error) {
        console.error('[switchContext] Error in professional circle name switch:', error);
        return false;
    }
}

/**
 * Handles switching using numeric IDs - supports both care and professional circles.
 * 
 * For backward compatibility:
 * - Care circles: circleId === patientUserId (numeric user ID)
 * - Professional circles: May have numeric circleId (from old system)
 * 
 * @param {string} userId - ID of the user requesting the switch
 * @param {string} numericId - Numeric identifier (could be patient ID or circle ID)
 * @param {Object} currentUser - User object containing username and other details
 */
async function handleNumericIdSwitch(userId, numericId, currentUser) {
    const { getUserCircles } = await import('../../db/index.js');
    
    try {
        // Get all user's circles
        const allCircles = await getUserCircles(userId);
        
        // Check if it's a professional circle ID first
        const professionalCircle = allCircles.find(c => 
            c.circle_type === 'professional' && c.circle_id.toString() === numericId.toString()
        );
        
        if (professionalCircle) {
            // Found professional circle, handle it
            await handleCircleIdSwitch(userId, numericId, currentUser);
            return;
        }
        
        // Check if it's a care circle (patient ID pattern)
        const careCircle = allCircles.find(c => 
            c.circle_type !== 'professional' && c.primary_patient_id.toString() === numericId.toString()
        );
        
        if (careCircle) {
            // Found care circle, get patient username and handle
            const patient = await findUserById(numericId);
            if (patient) {
                await handlePatientUsernameSwitch(userId, patient.username, currentUser, null);
                return;
            }
        }
        
        // Not found in either type
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Circle with ID ${numericId} not found or you're not a member.`, 
            from: 'system' 
        });
        
    } catch (error) {
        console.error('[switchContext] Error in numeric ID switch:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Failed to switch to circle ${numericId}. Please try again.`, 
            from: 'system' 
        });
    }
}

/**
 * Handles switching to a professional circle using its numeric circle ID.
 * 
 * Professional circles are business/project-focused and identified by unique IDs
 * rather than patient usernames. This function:
 * 1. Validates user membership in the target professional circle
 * 2. Retrieves user's role (target, support, expert) in that circle
 * 3. Emits context switch event with professional circle context
 * 
 * @param {string} userId - ID of the user requesting the switch
 * @param {string} targetCircleId - Numeric ID of the professional circle to switch to
 * @param {Object} currentUser - User object containing username and other details
 * 
 * Context payload includes:
 * - newCircleId: Target circle's database ID
 * - circleType: 'professional' to distinguish from care circles
 * - circleName: Human-readable name from organization_context
 * - newRole: User's role in the professional circle (target/support/expert)
 * 
 * @returns {Promise<void>} Results communicated via broadcast events
 */
async function handleCircleIdSwitch(userId, targetCircleId, currentUser) {
    const { ProfessionalCircleManager } = await import('../../agents/social/SpecializedCircleManagers.js');
    const { getMemberInfo } = await import('../../db/index.js');
    
    try {
        const manager = new ProfessionalCircleManager(userId);
        const circles = await manager.getUserCircles(userId);
        const targetCircle = circles.find(c => c.circle_id.toString() === targetCircleId.toString());
        
        if (!targetCircle) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Circle with ID ${targetCircleId} not found or you're not a member.`, 
                from: 'system' 
            });
            return;
        }

        // Get the user's role in this circle
        const memberInfo = await getMemberInfo(userId, targetCircle.circle_id);
        
        if (!memberInfo) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You are not a member of circle ${targetCircleId}.`, 
                from: 'system' 
            });
            return;
        }

        const circleName = targetCircle.organization_context 
            ? JSON.parse(targetCircle.organization_context).name 
            : `Circle ${targetCircleId}`;

        events.emit('context_switch', {
            userId,
            newCircleId: targetCircle.circle_id,
            circleType: targetCircle.circle_type || 'professional',
            circleName: circleName,
            newRole: memberInfo.relationship_type || memberInfo.role
        });
        
    } catch (error) {
        console.error('Error switching to circle ID:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Failed to switch to circle ${targetCircleId}. Please try again.`, 
            from: 'system' 
        });
    }
}

/**
 * Handles switching to a care circle using the patient's username.
 * 
 * Care circles are medical-focused and organized around patients. Each patient
 * has one primary care circle containing their caregivers and doctors. This function:
 * 1. Handles special case of switching to own care circle
 * 2. Validates target patient exists and user has access to their circle  
 * 3. Retrieves user's medical role (patient, caregiver, doctor) in that circle
 * 4. Generates medical summary for doctors entering the circle
 * 
 * @param {string} userId - ID of the user requesting the switch
 * @param {string} targetPatientUsername - Username of the patient whose circle to enter
 * @param {Object} currentUser - User object with username and profile details
 * 
 * Special behaviors:
 * - Self-switch: If username matches current user, switches to their own care circle
 * - Doctor entry: Automatically generates and sends medical summary to doctor
 * - Permission validation: Ensures user is actually a member of target circle
 * 
 * Context payload includes:
 * - newCircleId: Target care circle's database ID  
 * - patientUsername: Patient whose circle is being entered
 * - newRole: User's medical role (patient/caregiver/doctor)
 * 
 * @returns {Promise<void>} Results communicated via broadcast events
 */
async function handlePatientUsernameSwitch(userId, targetPatientUsername, currentUser, circleId) {
    if (targetPatientUsername === currentUser.username) {
        const personalCircle = await findCircleByPatientId(userId);
        events.emit('context_switch', {
            userId,
            newCircleId: personalCircle.circle_id,
            patientUsername: currentUser.username,
            newRole: 'patient'
        });
        return;
    }

    const targetPatient = await findUserByUsername(targetPatientUsername);
    if (!targetPatient) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Error: Patient '${targetPatientUsername}' not found.`, from: 'system', circleId });
        return;
    }

    const targetCircle = await findCircleByPatientId(targetPatient.user_id);
    if (!targetCircle) {
        events.emit('broadcast', { targetUsers: [userId], reply: `No care circle found for patient '${targetPatientUsername}'.`, from: 'system', circleId });
        return;
    }

    const memberInfo = await getMemberInfo(userId, targetCircle.circle_id);
    if (memberInfo) {
        // FIX: This payload is now complete, fixing the 'undefined' bug.
        events.emit('context_switch', {
            userId,
            newCircleId: targetCircle.circle_id,
            patientUsername: targetPatient.username,
            newRole: memberInfo.role
        });
        if (memberInfo.role === 'doctor') {
            await generateAndSendSummary(userId, targetCircle.circle_id, targetPatient.username);
        }
    } else {
        events.emit('broadcast', { targetUsers: [userId], reply: `You are not a member of the care circle for patient '${targetPatientUsername}'.`, from: 'system', circleId });
    }
}

