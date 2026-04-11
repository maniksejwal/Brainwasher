/**
 * @fileoverview handlers/loginHandler.js
 * This file handles the user login and registration process. It now also fetches
 * all roles a user has across all their care circles to provide better
 * context to the client.
 */

import {
    addUser,
    findUserByUsername,
    createCareCircle,
    findCircleByPatientId,
    getUserCircles
} from '../db/index.js';
import { ProfessionalCircleManager } from '../agents/social/SpecializedCircleManagers.js';
import { randomUUID } from 'crypto';
// import { ProfessionalCircleManager } from '../agents/social/SpecializedCircleManagers.js';

export async function handleLogin(username) {
    let user = await findUserByUsername(username);
    let userId;
    let isNewUser = false;

    if (!user) {
        console.log(`[LoginHandler] First time login for '${username}'. Creating user and personal care circle.`);
        userId = randomUUID();
        await addUser(userId, username);
        await createCareCircle(userId, userId);
        isNewUser = true;
    } else {
        userId = user.user_id;
    }

    const personalCircle = await findCircleByPatientId(userId);
    const allCircles = await getUserCircles(userId);
    
    // Get medical and professional roles separately, then combine
    const medicalRoles = [...new Set(allCircles.filter(c => c.circle_type !== 'professional').map(c => c.role))];
    const professionalCircles = allCircles.filter(c => c.circle_type === 'professional');
    const professionalRoles = [...new Set(professionalCircles.map(c => c.relationship_type))];
    const allRoles = [...new Set([...medicalRoles, ...professionalRoles])];

    return {
        success: true,
        message: `Logged in as ${username}. Your active care circle is your own (patient: ${username}).`,
        userId: userId,
        activeCircleId: personalCircle.circle_id,
        patientUsername: username,
        allRoles: allRoles, // Medical roles only for now
        professionalCircles: 0, // Temporarily disabled
        isNewUser: isNewUser
    };
}

