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
import { randomUUID } from 'crypto';

export async function handleLogin(username) {
    let user = await findUserByUsername(username);
    let userId;

    if (!user) {
        console.log(`[LoginHandler] First time login for '${username}'. Creating user and personal care circle.`);
        userId = randomUUID();
        await addUser(userId, username);
        await createCareCircle(userId, userId);
    } else {
        userId = user.user_id;
    }

    const personalCircle = await findCircleByPatientId(userId);
    const allCircles = await getUserCircles(userId);
    // FIX: Determine all roles the user has to inform the client UI.
    const allRoles = [...new Set(allCircles.map(c => c.role))];


    return {
        success: true,
        message: `Logged in as ${username}. Your active care circle is your own (patient: ${username}).`,
        userId: userId,
        activeCircleId: personalCircle.circle_id,
        patientUsername: username,
        allRoles: allRoles // Send all roles to the client
    };
}

