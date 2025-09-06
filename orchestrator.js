import express from 'express';
import dotenv from 'dotenv';
import { 
    initializeDatabase, addUser, userExists, upsertFact, getFact, 
    addMessageToQueue, getMessagesForUser, getAllUsers, resetDatabase,
    setRelationship, getRelationship, addEscalation, getEscalations
} from './database.js';
import { generatePersonalAgentReply, privacyDiscriminator } from './agents.js';

// --- Initialization ---
dotenv.config();
const app = express();
app.use(express.json());
const PORT = 5000;
const CRITICAL_KEYWORDS = ['fainted', 'chest pain', 'overdose', 'can\'t breathe', 'suicide', 'passed out'];


// --- Core IP: Conflict Detection Engine ---
async function detectConflict(user, message) {
    let factKey = null;
    let factValue = null;

    if (message.toLowerCase().includes("took his meds") || message.toLowerCase().includes("took my meds") || message.toLowerCase().includes("took my medicine")) {
        factKey = "medication_taken";
        factValue = true;
    } else if (message.toLowerCase().includes("did not take his meds") || message.toLowerCase().includes("miss my medicine")) {
        factKey = "medication_taken";
        factValue = false;
    }

    if (factKey) {
        await upsertFact(factKey, user, factValue);
        const allReports = await getFact(factKey);

        const patientReport = allReports.find(r => r.userId === 'patient');
        const caregiverReport = allReports.find(r => r.userId === 'caregiver');

        if (patientReport && caregiverReport && patientReport.factValue !== caregiverReport.factValue) {
            const conflictMessage = `[Discrepancy Noted] A difference was noted in reports about '${factKey}'. This has been logged for the doctor's review.`;
            console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
            console.log(`*** CONFLICT DETECTED on fact '${factKey}' ***`);
            console.log(`-> caregiver reports: ${caregiverReport.factValue}`);
            console.log(`-> patient reported: ${patientReport.factValue}`);
            console.log(`-> ACTION: Silently Escalating to Doctor/System Log.`);
            console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
            await addEscalation(`CONFLICT: User 'patient' reported '${factKey}' as '${patientReport.factValue}', contradicting 'caregiver' who reported it as '${caregiverReport.factValue}'.`);
            
            // We no longer send a direct alert to users, making it more subtle.
            // await addMessageToQueue('patient', conflictMessage);
            // await addMessageToQueue('caregiver', conflictMessage);
        }
    }
}

// --- New Core IP: Critical Event Detection ---
async function detectCriticalEvent(user, message) {
    const lowerCaseMessage = message.toLowerCase();
    for (const keyword of CRITICAL_KEYWORDS) {
        if (lowerCaseMessage.includes(keyword)) {
            const escalationMessage = `CRITICAL ALERT from ${user}: "${message}"`;
            console.log(`\n!!! CRITICAL EVENT DETECTED !!! -> Escalating: ${escalationMessage}`);
            await addEscalation(escalationMessage);
            return true; // Event was critical
        }
    }
    return false; // Not critical
}


// --- API Endpoints ---
app.post('/register', async (req, res) => {
    const { userId } = req.body;
    await addUser(userId);
    res.status(200).json({ status: `user ${userId} registered` });
});

app.post('/send', async (req, res) => {
    const { userId, message } = req.body;
    if (!(await userExists(userId))) {
        return res.status(400).json({ error: "User not registered" });
    }
    console.log(`\n[Orchestrator] Received message from '${userId}': '${message}'`);
    
    // 1. Generate and queue the immediate personal reply
    const personalReply = await generatePersonalAgentReply(userId, message);
    await addMessageToQueue(userId, personalReply);

    // 2. Check for critical events and escalate if necessary
    const wasCritical = await detectCriticalEvent(userId, message);

    // 3. Check for privacy and conflicts
    const isPrivate = await privacyDiscriminator(userId, message);
    await detectConflict(userId, message);

    // 4. Broadcast a diplomatic update if not private
    if (!isPrivate) {
        const broadcastMessage = `[Care Circle Update] An update was shared by the ${userId}.`;
        const allUsers = await getAllUsers();
        for (const otherUser of allUsers) {
            if (otherUser.userId !== userId) {
                 const patientId = userId === 'patient' ? userId : otherUser.userId;
                 const caregiverId = userId === 'patient' ? otherUser.userId : userId;
 
                 if (patientId === caregiverId) continue;
                 
                 const relationship = await getRelationship(patientId, caregiverId);
                 const consentLevel = relationship ? relationship.consentLevel : 'full'; 
 
                 if (consentLevel === 'full') {
                     await addMessageToQueue(otherUser.userId, broadcastMessage);
                 } else {
                     console.log(`[Consent Manager] Update notification BLOCKED for ${otherUser.userId} (Consent: ${consentLevel})`);
                 }
            }
        }
    }
    res.status(200).json({ status: "message_received" });
});

app.get('/fetch/:userId', async (req, res) => {
    const { userId } = req.params;
    const messages = await getMessagesForUser(userId);
    res.status(200).json({ messages });
});

app.post('/consent/set', async (req, res) => {
    const { patientId, caregiverId, relationshipType, consentLevel } = req.body;
    await setRelationship(patientId, caregiverId, relationshipType, consentLevel);
    res.status(200).json({ status: 'Consent level updated.' });
});

app.get('/fetch/doctor', async (req, res) => {
    const escalations = await getEscalations();
    res.status(200).json({ escalations });
});

app.post('/test/reset', async (req, res) => {
    await resetDatabase();
    res.status(200).json({ status: "database_reset" });
});

// --- Main Execution ---
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`--- Multi-Agent Orchestrator (JS) is RUNNING ---`);
        console.log(`This terminal acts as the Doctor's Log.`);
        console.log(`Listening on http://127.0.0.1:${PORT}`);
        console.log(`---------------------------------------------`);
    });
}

startServer();

