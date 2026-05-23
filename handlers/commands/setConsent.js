/**
 * @fileoverview Handles the '/consent' command logic.
 * This module allows users to set consent levels for members within their circles.
 * Supports both care circles (patient/caregiver model) and professional circles.
 */

import { getCircleMembers, updateMemberConsent, findCircleByPatientId, findCircleById } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleConsentCommand(userId, circleId, parts) {
    const targetUsername = parts[1];
    const level = parts[2];

    // Professional circles may use different consent levels
    const currentCircle = await findCircleById(circleId);
    const isProfessional = currentCircle?.circle_type === 'professional';
    
    const validLevels = isProfessional 
        ? ['none', 'limited', 'business_standard', 'full'] 
        : ['none', 'limited', 'full'];

    if (!targetUsername || !level || !validLevels.includes(level)) {
        const levelOptions = validLevels.join('/');
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Invalid format. Use: /consent <username> <${levelOptions}>`, 
            from: 'system', 
            circleId 
        });
        return;
    }

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === targetUsername);

    if (!targetMember) {
        const circleType = isProfessional ? 'professional circle' : 'care circle';
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error: User '${targetUsername}' is not a member of this ${circleType}.`, 
            from: 'system', 
            circleId 
        });
        return;
    }

    // Professional circles: Check if user has permission to set consent
    if (isProfessional) {
        // In professional circles, the circle owner/creator can set consent for others
        // Also, anyone can set their own consent level for the circle owner
        const isOwner = currentCircle.primary_patient_id === userId;
        const isSettingForOwner = targetMember.user_id === currentCircle.primary_patient_id;
        
        if (targetMember.user_id === userId) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You cannot set consent for yourself.`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        
        if (!isOwner && !isSettingForOwner) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You can only set consent for the circle owner, or if you are the circle owner.`, 
                from: 'system', 
                circleId 
            });
            return;
        }
    } else {
        // Care circles: Original medical logic
        const personalCircle = await findCircleByPatientId(userId);
        const isMyCircle = personalCircle && personalCircle.circle_id === circleId;

        if (targetMember.user_id === userId) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You cannot set consent for yourself.`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        
        if (!isMyCircle && targetMember.role !== 'patient') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You can only set consent for the patient in a circle you are a caregiver in.`, 
                from: 'system', 
                circleId 
            });
            return;
        }
    }

    await updateMemberConsent(circleId, targetMember.user_id, level);
    const circleType = isProfessional ? 'professional circle' : 'care circle';
    events.emit('broadcast', { 
        targetUsers: [userId], 
        reply: `Consent for '${targetUsername}' in this ${circleType} set to '${level}'.`, 
        from: 'system', 
        circleId 
    });
}

