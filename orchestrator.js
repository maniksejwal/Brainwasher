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


// --- Core IP: Conflict Detection Engine ---
async function detectConflict(user, message) {
    console.log(`[Conflict Detector] Analyzing for conflicts based on message from ${user}: '${message}'`);
    let factKey = null;
    let factValue = null;

    const msgLower = message.toLowerCase();
    if (msgLower.includes("medicine") || msgLower.includes("meds")) {
        factKey = "medication_taken";
        factValue = !(msgLower.includes("not") || msgLower.includes("didn't") || msgLower.includes("did not"));
    }

    if (!factKey) {
        console.log("[Conflict Detector] No detectable fact in message.");
        return;
    }

    // Check for conflict
    const existingFacts = await getFact(factKey);
    for (const fact of existingFacts) {
        if (fact.userId !== user && fact.factValue !== factValue) {
            console.log("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            console.log(`*** CONFLICT DETECTED on fact '${factKey}' ***`);
            console.log(`-> ${user} reports: ${factValue}`);
            console.log(`-> ${fact.userId} reported: ${fact.factValue}`);
            console.log("-> ACTION: Escalating to Doctor/System Log.");
            console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");

            const conflictMsg = `[System Alert] A conflict was detected in reports about '${factKey}'. Please discuss.`;
            await addMessageToQueue(user, conflictMsg);
            await addMessageToQueue(fact.userId, conflictMsg);
            
            // --- New Feature: Escalate conflict to doctor ---
            const escalationContent = `CONFLICT: User '${user}' reported '${factKey}' as '${factValue}', contradicting '${fact.userId}'.`;
            await addEscalation(escalationContent);
        }
    }
    
    // Update fact store
    await upsertFact(factKey, user, factValue);
    console.log(`[Fact Store] Updated fact '${factKey}' for user '${user}'`);
}


// --- API Endpoints ---
app.post('/register', async (req, res) => {
    const { userId } = req.body;
    await addUser(userId);
    console.log(`\n[Orchestrator] User '${userId}' registered or already exists.`);
    res.status(200).json({ status: "registered", userId });
});

app.post('/send', async (req, res) => {
    const { userId, message } = req.body;
    if (!(await userExists(userId))) {
        return res.status(400).json({ error: "User not registered" });
    }
    console.log(`\n[Orchestrator] Received message from '${userId}': '${message}'`);
    
    const personalReply = await generatePersonalAgentReply(userId, message);
    await addMessageToQueue(userId, personalReply);

    const isPrivate = await privacyDiscriminator(userId, message);
    await detectConflict(userId, message);

    if (!isPrivate) {
        // --- New Feature: Diplomatic Broadcast Message ---
        const broadcastMessage = `[System Note] The ${userId} has shared a new update.`;
        const allUsers = await getAllUsers();
        for (const otherUser of allUsers) {
            if (otherUser.userId !== userId) {
                 // --- New Feature: Check consent before broadcasting ---
                 const patientId = userId === 'patient' ? userId : otherUser.userId;
                 const caregiverId = userId === 'patient' ? otherUser.userId : userId;
 
                 if (patientId === caregiverId) continue; // Don't check consent for self
                 
                 const relationship = await getRelationship(patientId, caregiverId);
                 // Default to 'full' consent if not set, change if you want default to be 'none'
                 const consentLevel = relationship ? relationship.consentLevel : 'full'; 
 
                 if (consentLevel === 'full') {
                     await addMessageToQueue(otherUser.userId, broadcastMessage);
                     console.log(`[Consent Manager] Update notification sent to ${otherUser.userId} (Consent: ${consentLevel})`);
                 } else {
                     console.log(`[Consent Manager] Update notification BLOCKED for ${otherUser.userId} (Consent: ${consentLevel})`);
                 }
            }
        }
    } else {
        console.log(`[Orchestrator] Message from '${userId}' was private and was NOT broadcasted.`);
    }
    res.status(200).json({ status: "message_received" });
});

app.get('/fetch', async (req, res) => {
    const { userId } = req.query;
    if (!(await userExists(userId))) {
        return res.status(400).json({ error: "User not registered" });
    }
    const messages = await getMessagesForUser(userId);
    res.status(200).json({ messages });
});

// --- New Endpoints for Consent and Doctor ---
app.post('/consent/set', async (req, res) => {
    const { patientId, caregiverId, relationshipType, consentLevel } = req.body;
    await setRelationship(patientId, caregiverId, relationshipType, consentLevel);
    console.log(`\n[Consent Manager] Relationship set: ${patientId} -> ${caregiverId} is a ${relationshipType} with ${consentLevel} consent.`);
    res.status(200).json({ status: "consent_set" });
});

app.get('/fetch/doctor', async (req, res) => {
    const escalations = await getEscalations();
    res.status(200).json({ escalations });
});


// --- New Endpoint for Testing ---
app.post('/test/reset', async (req, res) => {
    console.log("\n[Orchestrator] Received request to reset database for testing.");
    await resetDatabase();
    res.status(200).json({ status: "database_reset" });
});


// --- Main Execution ---
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log("--- Multi-Agent Orchestrator (JS) is RUNNING ---");
        console.log("This terminal acts as the Doctor's Log.");
        console.log(`Listening on http://127.0.0.1:${PORT}`);
        console.log("---------------------------------------------");
    });
}

startServer();

