/**
 * @fileoverview handlers/loginHandler.js
 * This file handles the user login and registration process.
 */

import {
    addUser,
    findUserByUsername,
    createCareCircle,
    findCircleByPatientId
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

    return {
        success: true,
        message: `Logged in as ${username}. Your active care circle is your own (patient: ${username}).`,
        userId: userId,
        activeCircleId: personalCircle.circle_id,
        // FIX: Provide the patient username for the client prompt
        patientUsername: username
    };
}

