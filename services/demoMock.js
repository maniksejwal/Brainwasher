/**
 * @fileoverview services/demoMock.js
 * Scripted replies for recording product demos (DEMO_MOCK_MODE=true). Messages from the
 * demo patient and caregiver are answered from a fixed script instead of the LLM pipeline;
 * every other user still goes through the real pipeline.
 *
 * The script advances one step per message, whatever was typed, so a typo does not break a
 * take. Replies are sent as ordinary broadcasts, so they land in each user's HealthyMitra
 * conversation exactly like real replies. The caregiver's question is delivered to the
 * caregiver's own conversation.
 *
 * Progress is kept in memory: restart the server (or send "/demo reset" as the patient)
 * to start a new take.
 *
 * Settings:
 *   DEMO_MOCK_MODE=true
 *   DEMO_PATIENT_NAME   (default "Karthik Raman")
 *   DEMO_CAREGIVER_NAME (default "Divya Karthik")
 *   DEMO_REPLY_DELAY_MS (default 1500) - pause before each reply, so "typing" shows
 */
import { events } from '../orchestrator.js';
import { findUserById } from '../db/index.js';
import { getDb } from '../db/connection.js';

const RESET_COMMAND = '/demo reset';

// GLP-1 scenario: patient replies, in order. A step may also message the caregiver.
const PATIENT_STEPS = [
    {
        reply: `I'm sorry you're going through this, Karthik. Feeling sick and not seeing results is genuinely frustrating. Before you decide anything, let me understand what's happening so we can figure out the right next step together.

First, a quick safety check:
• Are you having severe stomach pain, especially pain that spreads to your back?
• Are you able to keep water down, and are you passing urine normally?`
    },
    {
        reply: `Good, that's reassuring. A few more questions:
1. Has your dose changed recently?
2. When does the vomiting usually happen, after meals or randomly?
3. How many meals are you eating in a day?`
    },
    {
        reply: `That explains a lot. Nausea and vomiting are most common right after a dose increase, and they usually settle within a few weeks as your body adjusts. Large, heavy meals late in the day tend to make it worse, because the medicine slows down how fast your stomach empties.

Feeling weak is likely because you're eating less than your body needs right now.

One more question: how have your sugar readings been since you started?`
    },
    {
        reply: `Karthik, that's a big improvement. It means the medicine is working, even if the scale isn't showing it yet.

Mounjaro isn't only a weight-loss drug. Its first job is controlling blood sugar, and weight loss usually builds slowly over many months.

How about we book an HbA1c test to measure your improvement? It shows your average sugar over the last 3 months. You can compare it with your 8.4% from before you started.

🧪 HbA1c Test · Home sample collection
📅 Tomorrow, 7:00–9:00 AM
💳 299 credits

Reply "Book it" to confirm.`
    },
    {
        reply: `Booked ✅ 299 credits used. Fasting isn't required for HbA1c.

Would it be okay if I check in with Divya too? Sometimes the people around us notice changes we can't see ourselves.`
    },
    {
        reply: `Thanks, Karthik. I've sent Divya a quick question. I'll let you know what she says.`,
        caregiver: `Hi Divya 👋 Karthik has been on a new diabetes medicine for about 4 months. A quick question only you can answer:

Has Karthik been snoring less than before?`,
        waitForCaregiver: true
    },
    {
        reply: `Done ✅ I'll share this summary with your doctor, and send your HbA1c result as soon as it's ready. Take care, Karthik, and keep dinner light tonight 😊`
    }
];

const CAREGIVER_THANKS = `That's wonderful to hear, thank you Divya! I'll let Karthik know.`;

const PATIENT_SUMMARY = `Good news. Divya says you've been snoring much less than before 😊

Here's the bigger picture after 4 months:
✅ Fasting sugar: 180 → 120–130
✅ Snoring: much less (this can mean better sleep and breathing)
⏳ Weight: slow so far, which is common at this stage
⚠️ Vomiting: likely from the recent dose increase, and usually temporary

Please don't stop the medicine on your own. Stopping often brings back high sugar and appetite. Talk to your doctor instead; they may slow down dose increases or adjust the plan.

Until then, these may help with the nausea:
• Eat smaller meals, and keep dinner light
• Stop eating when you feel full
• Avoid oily and fried food
• Sip water through the day

⚠️ If vomiting doesn't stop, you can't keep water down, or you get severe stomach pain, see a doctor right away.

Shall I share this summary and your HbA1c result with your doctor once it's ready?`;

const CAREGIVER_IDLE = `Thanks, Divya! I'll reach out if I have a question for you.`;
const PATIENT_WAITING = `I'm still waiting to hear back from Divya. I'll let you know as soon as she replies.`;
const PATIENT_DONE = `Take care, Karthik! (Demo script finished. Send "${RESET_COMMAND}" to start again.)`;

const state = { step: 0, waitingForCaregiver: false, patientUserId: null, patientCircleId: null };

export function isDemoMockEnabled() {
    return process.env.DEMO_MOCK_MODE === 'true';
}

export function resetDemoMock() {
    Object.assign(state, { step: 0, waitingForCaregiver: false, patientUserId: null, patientCircleId: null });
}

function names() {
    return {
        patient: process.env.DEMO_PATIENT_NAME || 'Karthik Raman',
        caregiver: process.env.DEMO_CAREGIVER_NAME || 'Divya Karthik'
    };
}

function replyDelay() {
    const ms = Number(process.env.DEMO_REPLY_DELAY_MS);
    return Number.isFinite(ms) && ms >= 0 ? ms : 1500;
}

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function send(userId, circleId, text) {
    events.emit('broadcast', { targetUsers: [userId], reply: text, from: 'agent', circleId, source: 'demo_mock' });
}

async function userIdByName(username) {
    const db = await getDb();
    const row = await db.get('SELECT user_id FROM users WHERE username = ?', [username]);
    return row?.user_id ?? null;
}

async function patientTurn(job) {
    if (job.text.trim().toLowerCase() === RESET_COMMAND) {
        resetDemoMock();
        send(job.user_id, job.circle_id, 'Demo reset. Send your first message to start again.');
        return;
    }
    state.patientUserId = job.user_id;
    state.patientCircleId = job.circle_id;
    await pause(replyDelay());

    if (state.waitingForCaregiver) return send(job.user_id, job.circle_id, PATIENT_WAITING);
    const step = PATIENT_STEPS[state.step];
    if (!step) return send(job.user_id, job.circle_id, PATIENT_DONE);
    state.step += 1;

    send(job.user_id, job.circle_id, step.reply);
    if (step.caregiver) {
        const caregiverId = await userIdByName(names().caregiver);
        if (!caregiverId) {
            console.warn(`[DemoMock] Caregiver "${names().caregiver}" not found; have them open the AI chat once first`);
            return;
        }
        state.waitingForCaregiver = Boolean(step.waitForCaregiver);
        await pause(replyDelay());
        send(caregiverId, job.circle_id, step.caregiver);
    }
}

async function caregiverTurn(job) {
    await pause(replyDelay());
    if (!state.waitingForCaregiver) return send(job.user_id, job.circle_id, CAREGIVER_IDLE);
    state.waitingForCaregiver = false;
    send(job.user_id, job.circle_id, CAREGIVER_THANKS);
    if (state.patientUserId) {
        await pause(replyDelay());
        send(state.patientUserId, state.patientCircleId, PATIENT_SUMMARY);
    }
}

/**
 * Wrap a runTurn: demo users get scripted replies, everyone else the real pipeline.
 */
export function createDemoRunTurn(fallback) {
    return async (job) => {
        const user = await findUserById(job.user_id);
        const { patient, caregiver } = names();
        if (user?.username === patient) return patientTurn(job);
        if (user?.username === caregiver) return caregiverTurn(job);
        return fallback(job);
    };
}
