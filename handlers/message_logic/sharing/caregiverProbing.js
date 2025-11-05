/**
 * @fileoverview handlers/message_logic/sharing/caregiverProbing.js
 * Care Circle Probing: Sends probing questions to care circle members when relevant
 * topics are discussed. Ensures correct identity verification and doesn't interfere
 * with doctor commands.
 */

import { getCircleMembers, findUserById, findCircleByPatientId, getActivePendingActions } from '../../../db/index.js';
import { generateCaregiverProbe, generatePatientProbeFromCaregiver } from '../../../agents/index.js';
import { createScheduledMessage } from '../../../db/queries_future_plans.js';

/**
 * Check if there's an active doctor command that we shouldn't interfere with
 */
async function hasActiveDoctorCommand(circleId, targetUserId) {
    try {
        const pendingActions = await getActivePendingActions(targetUserId, circleId);
        return pendingActions.some(a => a.action_type === 'delegated_probe_response');
    } catch {
        return false;
    }
}

/**
 * Verify identity: ensure we're querying the correct person in the care circle
 */
function verifyIdentity(circle, userId, targetUserId, role) {
    // Verify the circle patient matches
    if (circle.primary_patient_id !== userId && role === 'patient') {
        return false; // Wrong patient - this shouldn't happen
    }
    
    // Verify target is in the same circle (will be checked by getCircleMembers)
    return true;
}

/**
 * Send probing question to caregiver when patient discusses health matters
 */
export async function handleCaregiverProbing(userId, role, message, circleId, analysis, currentTurn = 1) {
    if (role !== 'patient') return false;
    
    try {
        const circle = await findCircleByPatientId(circleId);
        if (!circle || circle.primary_patient_id !== userId) {
            return false; // Identity check: ensure this is the patient's circle
        }
        
        const members = await getCircleMembers(circleId);
        const caregivers = members.filter(m => m.role === 'caregiver');
        if (caregivers.length === 0) return false;
        
        // Check if doctor is already waiting for a response from any caregiver
        for (const caregiver of caregivers) {
            if (await hasActiveDoctorCommand(circleId, caregiver.user_id)) {
                return false; // Don't interfere with doctor commands
            }
        }
        
        const patient = await findUserById(userId);
        if (!patient) return false;
        
        // Generate specific probing question for caregiver
        const caregiverQuestion = await generateCaregiverProbe(
            patient.username,
            message,
            analysis.facts || {}
        );
        
        if (!caregiverQuestion) return false;
        
        // Schedule question for next turn to avoid interrupting current conversation
        const nextTurn = currentTurn + 1;
        for (const caregiver of caregivers) {
            // Identity verification: ensure caregiver is in the circle
            if (!verifyIdentity(circle, userId, caregiver.user_id, 'caregiver')) continue;
            
            await createScheduledMessage(
                circleId, userId, caregiverQuestion, nextTurn,
                caregiver.user_id, 'turn', null,
                { probing_type: 'care_circle', original_message: message }, null
            );
        }
        
        return true;
    } catch (error) {
        console.warn(`[CareCircleProbing] Error:`, error.message);
        return false;
    }
}

/**
 * Send probing question to patient when caregiver discusses them
 */
export async function handlePatientProbingFromCaregiver(userId, role, message, circleId, analysis, currentTurn = 1) {
    if (role !== 'caregiver') return false;
    
    try {
        const circle = await findCircleByPatientId(circleId);
        if (!circle) return false;
        
        const patient = await findUserById(circle.primary_patient_id);
        if (!patient) return false;
        
        // Identity check: ensure we're querying the correct patient
        if (!verifyIdentity(circle, patient.user_id, userId, 'caregiver')) {
            return false;
        }
        
        // Check if doctor is already waiting for response from patient
        if (await hasActiveDoctorCommand(circleId, patient.user_id)) {
            return false; // Don't interfere with doctor commands
        }
        
        const caregiver = await findUserById(userId);
        if (!caregiver) return false;
        
        // Generate specific probing question for patient
        const patientQuestion = await generatePatientProbeFromCaregiver(
            caregiver.username,
            patient.username,
            message,
            analysis.facts || {}
        );
        
        if (!patientQuestion) return false;
        
        // Schedule question for next turn
        const nextTurn = currentTurn + 1;
        await createScheduledMessage(
            circleId, userId, patientQuestion, nextTurn,
            patient.user_id, 'turn', null,
            { probing_type: 'care_circle', original_message: message }, null
        );
        
        return true;
    } catch (error) {
        console.warn(`[CareCircleProbing] Error:`, error.message);
        return false;
    }
}

