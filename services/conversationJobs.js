/**
 * @fileoverview services/conversationJobs.js
 * Runs HealthyMitra conversation messages through the message pipeline and keeps each
 * user's conversation transcript.
 *
 * - Jobs: a submitted message is saved with a job (accepted). The worker claims jobs
 *   (processing), one at a time per conversation and in order, and runs the pipeline as one
 *   integration turn (lib/turnContext.js). A job ends completed, or failed if the pipeline
 *   threw. After a restart, jobs left processing are retried once, then marked failed.
 * - Transcript: every message broadcast to a user who has a conversation is saved in it,
 *   whether or not they are online, so HealthyMitra can read it back. A reply sent to the
 *   speaker during their turn is linked to that turn's job.
 */
import { randomUUID } from 'crypto';
import { events } from '../orchestrator.js';
import { currentTurn, runInTurn } from '../lib/turnContext.js';
import {
    findConversationByUser,
    addAgentConversationMessage,
    claimNextConversationJob,
    finishConversationJob,
    recoverInterruptedConversationJobs
} from '../db/index.js';

export const MAX_JOB_ATTEMPTS = 2;
const DEFAULT_CONCURRENCY = 2;

let started = false;
let concurrency = DEFAULT_CONCURRENCY;
let active = 0;
let runTurn = null;
const transcriptWrites = new Set();

async function defaultRunTurn(job) {
    const { handleMessage } = await import('../handlers/messageHandler.js');
    return handleMessage(job.user_id, job.circle_id, job.text);
}

/**
 * Save a broadcast message into each recipient's conversation.
 */
function recordBroadcast(payload) {
    const text = payload?.reply ?? payload?.message;
    if (!text || !Array.isArray(payload.targetUsers)) return;
    // events.emit is synchronous, so this still runs inside the turn that sent the message
    const turn = currentTurn();
    for (const userId of payload.targetUsers) {
        const write = (async () => {
            const conversation = await findConversationByUser(userId);
            if (!conversation) return;
            await addAgentConversationMessage({
                messageId: `msg_${randomUUID()}`,
                conversationId: conversation.conversation_id,
                circleId: payload.circleId ?? null,
                text: String(text),
                proposal: payload.proposal ?? null,
                source: payload.source ?? null,
                jobId: turn && turn.userId === userId ? turn.jobId : null
            });
        })().catch(error => console.error(`[ConversationJobs] Could not save a message for ${userId}:`, error.message));
        transcriptWrites.add(write);
        write.finally(() => transcriptWrites.delete(write));
    }
}

/**
 * Wait until every transcript write started so far has finished.
 */
export async function transcriptIdle() {
    while (transcriptWrites.size > 0) {
        await Promise.all([...transcriptWrites]);
    }
}

async function runJob(job) {
    try {
        await runInTurn({ userId: job.user_id, conversationId: job.conversation_id, jobId: job.job_id }, () => runTurn(job));
        // The job is complete only once its replies are in the transcript
        await transcriptIdle();
        await finishConversationJob(job.job_id, 'completed');
    } catch (error) {
        console.error(`[ConversationJobs] Job ${job.job_id} failed:`, error.message);
        await transcriptIdle();
        await finishConversationJob(job.job_id, 'failed', 'processing_failed');
    }
}

/**
 * Start jobs while there is capacity. Safe to call at any time; it does nothing before
 * the worker is started.
 */
export async function kickConversationWorker() {
    while (started && active < concurrency) {
        active += 1;
        let job;
        try {
            job = await claimNextConversationJob();
        } catch (error) {
            console.error('[ConversationJobs] Could not claim a job:', error.message);
        }
        if (!job) {
            active -= 1;
            return;
        }
        runJob(job).finally(() => {
            active -= 1;
            kickConversationWorker();
        });
    }
}

/**
 * Start recording transcripts and processing jobs.
 * @param {object} [options]
 * @param {Function} [options.runTurn] - Runs one job; defaults to the message pipeline
 * @param {number} [options.concurrency] - Jobs run at once across conversations
 */
export async function startConversationWorker(options = {}) {
    if (started) return;
    runTurn = options.runTurn ?? defaultRunTurn;
    concurrency = options.concurrency ?? (Number(process.env.INTEGRATION_JOB_CONCURRENCY) || DEFAULT_CONCURRENCY);
    events.on('broadcast', recordBroadcast);
    const { retried, failed } = await recoverInterruptedConversationJobs(MAX_JOB_ATTEMPTS);
    if (retried || failed) {
        console.log(`[ConversationJobs] After restart: ${retried} interrupted job(s) retried, ${failed} marked failed`);
    }
    started = true;
    kickConversationWorker();
}

/**
 * Stop taking new jobs and recording transcripts (tests). Running jobs finish.
 */
export function stopConversationWorker() {
    started = false;
    events.off('broadcast', recordBroadcast);
}
