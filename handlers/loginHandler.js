// FIX: Update import path to the new db package index
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
        console.log(`[Orchestrator] First time login for '${username}'. Creating user and personal care circle.`);
        userId = randomUUID();
        await addUser(userId, username);
        // Every user gets their own care circle where they are the patient.
        // The circle_id is the same as the patient's user_id for simplicity.
        await createCareCircle(userId, userId);
    } else {
        userId = user.user_id;
    }

    const personalCircle = await findCircleByPatientId(userId);

    return {
        success: true,
        message: `Logged in as ${username}. Your active care circle is your own (patient: ${username}).`,
        userId: userId,
        activeCircleId: personalCircle.circle_id
    };
}

