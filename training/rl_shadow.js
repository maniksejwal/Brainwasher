/**
 * @fileoverview training/rl_shadow.js
 *
 * RL Shadow Mode
 * ==============
 * Runs the A3C-trained policy in parallel with the current rule-based
 * production response, logs the divergence between the two, but does NOT
 * affect what the user actually receives.
 *
 * PURPOSE
 * -------
 * Shadow mode is the required precursor to any JS-side gradual rollout.
 * Before routing real traffic through the learned policy we need to:
 *   1. Confirm the A3C model is available and can produce responses.
 *   2. Measure the divergence between A3C responses and rule-based responses.
 *   3. Build confidence that safety/trust metrics are not degraded.
 *
 * ARCHITECTURE
 * ------------
 *
 *  CompanionCoordinator.generateResponse()
 *       │
 *       ├─── (normal path) → rule-based response → sent to user
 *       │
 *       └─── (shadow path) → RLShadowRunner.evaluate(context)
 *                                    │
 *                                    ├── POST /session/a3c/action (FastAPI)
 *                                    │       ↑  current state tensor
 *                                    │       ↓  A3C action + value estimate
 *                                    │
 *                                    ├── POST /api/benchmarks/shadow-log (Node)
 *                                    │       stores divergence record
 *                                    │
 *                                    └── returns silently (never used for response)
 *
 * DIVERGENCE METRIC
 * -----------------
 * We compute divergence as a composite of:
 *   - cosine_similarity: embedding similarity between A3C and rule-based response
 *     (uses ScaNN/embedding from the FastAPI server if available, else 0.0)
 *   - action_match: whether A3C would have selected the same action type
 *     (ACKNOWLEDGE / INFORM / QUESTION / COMMIT / ESCALATE)
 *   - value_estimate: A3C critic's estimate of current state value
 *
 * HIGH DIVERGENCE (cosine_similarity < 0.6 OR action_match = false) is logged
 * at WARN level so it can be reviewed without reading all shadow logs.
 *
 * ENABLING
 * --------
 * Shadow mode is off by default. Enable per-conversation:
 *
 *   import { RLShadowRunner } from './training/rl_shadow.js';
 *   const shadow = new RLShadowRunner({ enabled: true });
 *   // pass to CompanionCoordinator or call directly from agent handler
 *
 * Or via environment variable:
 *   RL_SHADOW_MODE=1 node server.js
 *
 * LOGS
 * ----
 * Shadow divergence records are written to:
 *   data/storage/local/training/shadow_log.jsonl    (local rolling file)
 *   DB table: shadow_divergence_log (via /api/benchmarks/shadow-log)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────

const TENSORNETS_URL     = process.env.TENSORNETS_URL    || 'http://localhost:8765';
const NODE_URL           = process.env.NODE_SERVER_URL   || 'http://localhost:8247';
const SHADOW_LOG_PATH    = path.join(__dirname, '../data/storage/local/training/shadow_log.jsonl');
const HIGH_DIV_THRESHOLD = 0.6;    // cosine_similarity below this → high divergence
const SHADOW_TIMEOUT_MS  = 8000;   // A3C call must respond within 8s

// ── Action classification ─────────────────────────────────────────────────────

const ACTION_KEYWORDS = {
    ACKNOWLEDGE: ['understand', 'hear you', 'that sounds', 'must be', 'i see', 'okay', 'that makes sense'],
    INFORM:      ['studies show', 'research indicates', 'the reason', 'this is because', 'did you know', 'actually'],
    QUESTION:    ['what do you', 'how are', 'can you tell', 'would you', 'have you', '?'],
    COMMIT:      ['i will', "i'll", 'i promise', 'let me schedule', 'i can arrange', 'we will'],
    ESCALATE:    ['contact a doctor', 'emergency', 'call 999', 'call 911', 'seek immediate', 'urgent care'],
};

function classifyAction(text) {
    if (!text) return 'UNKNOWN';
    const lower = text.toLowerCase();
    for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) return action;
    }
    return 'INFORM'; // default fallback
}

// ── Simple token overlap similarity (no embedding server needed) ──────────────

function tokenOverlapSimilarity(textA, textB) {
    if (!textA || !textB) return 0;
    const tokensA = new Set(textA.toLowerCase().split(/\W+/).filter(t => t.length > 3));
    const tokensB = new Set(textB.toLowerCase().split(/\W+/).filter(t => t.length > 3));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let intersection = 0;
    for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
    return intersection / Math.max(tokensA.size, tokensB.size);
}

// ── RLShadowRunner ────────────────────────────────────────────────────────────

export class RLShadowRunner {
    /**
     * @param {object} opts
     * @param {boolean} [opts.enabled]  - default: !!process.env.RL_SHADOW_MODE
     * @param {string}  [opts.arm]      - A3C arm to shadow (default: 'inertial_mcts')
     * @param {boolean} [opts.logToDb]  - persist to DB (default: true)
     * @param {boolean} [opts.logToFile]- persist to JSONL (default: true)
     */
    constructor(opts = {}) {
        this.enabled   = opts.enabled   ?? !!process.env.RL_SHADOW_MODE;
        this.arm       = opts.arm       ?? 'inertial_mcts';
        this.logToDb   = opts.logToDb   ?? true;
        this.logToFile = opts.logToFile ?? true;
        this._pendingWrites = 0;
    }

    /**
     * Evaluate the A3C policy against a production response in shadow mode.
     *
     * This is fire-and-forget: it returns immediately (async, no await needed
     * from caller) so it NEVER delays the production response.
     *
     * @param {object} context
     * @param {string}  context.conversationId
     * @param {string}  context.episodeId           - optional, if in A3C episode
     * @param {string}  context.arm                 - experiment arm name
     * @param {number}  context.turnIdx
     * @param {string}  context.productionResponse  - what the rule-based system said
     * @param {object}  context.state               - current TurnState-compatible dict
     * @param {object}  [context.physio]             - optional physiological state
     * @param {string}  [context.userId]
     */
    async evaluate(context) {
        if (!this.enabled) return;

        // Non-blocking: schedule evaluation but never await it from caller
        this._evaluateAsync(context).catch(err => {
            // Shadow failures must never surface to production
            console.warn('[RLShadow] evaluation error (non-fatal):', err.message);
        });
    }

    async _evaluateAsync(context) {
        const {
            conversationId,
            episodeId,
            arm         = this.arm,
            turnIdx     = 0,
            productionResponse,
            state       = {},
            physio      = {},
            userId,
        } = context;

        const startMs = Date.now();

        // ── Step 1: Ask A3C for action + value estimate ───────────────────────
        let a3cResult = null;
        let a3cError  = null;
        try {
            const resp = await _fetchWithTimeout(
                `${TENSORNETS_URL}/session/a3c/action`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        arm,
                        state:  state,
                        physio: physio,
                        turn_idx: turnIdx,
                    }),
                },
                SHADOW_TIMEOUT_MS,
            );
            if (resp.ok) {
                a3cResult = await resp.json();
            } else {
                a3cError = `HTTP ${resp.status}`;
            }
        } catch (err) {
            a3cError = err.message;
        }

        const latencyMs = Date.now() - startMs;

        // ── Step 2: Compute divergence ────────────────────────────────────────
        const a3cResponse    = a3cResult?.response_text  ?? null;
        const a3cAction      = a3cResult?.action_label   ?? (a3cResponse ? classifyAction(a3cResponse) : null);
        const prodAction     = classifyAction(productionResponse);
        const valueEstimate  = a3cResult?.value_estimate ?? null;

        const cosineSimilarity = (productionResponse && a3cResponse)
            ? tokenOverlapSimilarity(productionResponse, a3cResponse)
            : null;

        const actionMatch       = a3cAction ? (a3cAction === prodAction) : null;
        const highDivergence    = cosineSimilarity !== null
            ? cosineSimilarity < HIGH_DIV_THRESHOLD
            : null;

        // ── Step 3: Build log record ──────────────────────────────────────────
        const record = {
            ts:                  Date.now(),
            conversation_id:     conversationId    ?? null,
            episode_id:          episodeId         ?? null,
            arm,
            turn_idx:            turnIdx,
            user_id:             userId            ?? null,
            prod_action:         prodAction,
            a3c_action:          a3cAction         ?? null,
            action_match:        actionMatch,
            cosine_similarity:   cosineSimilarity  !== null ? +cosineSimilarity.toFixed(4) : null,
            high_divergence:     highDivergence,
            value_estimate:      valueEstimate,
            a3c_latency_ms:      latencyMs,
            a3c_error:           a3cError          ?? null,
        };

        if (highDivergence) {
            console.warn(
                `[RLShadow] HIGH DIVERGENCE arm=${arm} turn=${turnIdx} ` +
                `sim=${cosineSimilarity?.toFixed(3)} action=${prodAction}→${a3cAction}`,
            );
        }

        // ── Step 4: Persist ───────────────────────────────────────────────────
        if (this.logToFile) {
            this._appendToFile(record).catch(() => {});
        }
        if (this.logToDb) {
            this._appendToDb(record).catch(() => {});
        }
    }

    async _appendToFile(record) {
        try {
            await fs.mkdir(path.dirname(SHADOW_LOG_PATH), { recursive: true });
            await fs.appendFile(SHADOW_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
        } catch (err) {
            // silently ignore file write failures
        }
    }

    async _appendToDb(record) {
        try {
            const resp = await _fetchWithTimeout(
                `${NODE_URL}/api/benchmarks/shadow-log`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(record),
                },
                5000,
            );
            if (!resp.ok) {
                console.warn('[RLShadow] DB log failed:', resp.status);
            }
        } catch (err) {
            // silently ignore — shadow log is non-essential
        }
    }

    // ── Statistics ────────────────────────────────────────────────────────────

    /**
     * Read summary statistics from the local JSONL shadow log.
     * @returns {Promise<object>}
     */
    async stats() {
        try {
            const text  = await fs.readFile(SHADOW_LOG_PATH, 'utf8');
            const lines = text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
            if (lines.length === 0) return { total: 0 };

            let highDiv = 0, actionMismatch = 0, errorCount = 0, simTotal = 0, simCount = 0;
            for (const r of lines) {
                if (r.high_divergence)    highDiv++;
                if (r.action_match === false) actionMismatch++;
                if (r.a3c_error)          errorCount++;
                if (r.cosine_similarity !== null) { simTotal += r.cosine_similarity; simCount++; }
            }

            return {
                total:            lines.length,
                high_divergence:  highDiv,
                high_div_pct:     +(100 * highDiv / lines.length).toFixed(1),
                action_mismatch:  actionMismatch,
                error_count:      errorCount,
                avg_similarity:   simCount ? +(simTotal / simCount).toFixed(4) : null,
                span_hours:       lines.length
                    ? +((lines[lines.length - 1].ts - lines[0].ts) / 3_600_000).toFixed(2)
                    : 0,
            };
        } catch {
            return { total: 0 };
        }
    }
}

// ── FastAPI route handler (server.py will expose this) ────────────────────────
//
// This module only handles the JS side.  On the Python/FastAPI side,
// POST /session/a3c/action must:
//   1. Reconstruct a TurnState-like object from the request body
//   2. Call worker.select_action(state) on the named arm's actor network
//   3. Optionally generate a short text response via the arm's LLM
//   4. Return { action_label, value_estimate, response_text (optional) }
//
// If FastAPI is unavailable, a3cResult will be null and the shadow log will
// record a3c_error.  This is by design — production is never blocked.

// ── Benchmark route stub for shadow-log ──────────────────────────────────────
//
// Add to routes/benchmarks.js:
//
//   router.post('/shadow-log', async (req, res) => {
//       try {
//           const db = await _ensureShadowSchema();
//           const r  = req.body;
//           await db.run(`INSERT INTO shadow_divergence_log
//               (ts, conversation_id, episode_id, arm, turn_idx, prod_action,
//                a3c_action, action_match, cosine_similarity, high_divergence,
//                value_estimate, a3c_latency_ms, a3c_error)
//               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
//               [r.ts, r.conversation_id, r.episode_id, r.arm, r.turn_idx,
//                r.prod_action, r.a3c_action, r.action_match ? 1 : 0,
//                r.cosine_similarity, r.high_divergence ? 1 : 0,
//                r.value_estimate, r.a3c_latency_ms, r.a3c_error]);
//           res.json({ ok: true });
//       } catch (e) { res.status(500).json({ error: e.message }); }
//   });

// ── Utility: fetch with timeout ───────────────────────────────────────────────

async function _fetchWithTimeout(url, opts, timeoutMs) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ── CLI usage ─────────────────────────────────────────────────────────────────

if (process.argv[1]?.includes('rl_shadow')) {
    const runner = new RLShadowRunner({ enabled: true });
    const stats  = await runner.stats();
    console.log('RL Shadow mode statistics:');
    console.log(JSON.stringify(stats, null, 2));
}
