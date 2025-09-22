/**
 * @fileoverview This file handles the user login and registration process.
 * On first login, it creates a new user account and a personal care circle for them,
 * ensuring every user has a primary context. For returning users, it fetches
 * their existing information and sets their initial active care circle.
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
        patientUsername: username
    };
}

