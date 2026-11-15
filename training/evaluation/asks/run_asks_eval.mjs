/**
 * @fileoverview training/evaluation/asks/run_asks_eval.mjs
 * Scores how input understanding labels a patient's questions and requests, against the
 * hand-labelled set in labelled_asks.json (patient messages from simulation runs).
 *
 * Usage: node training/evaluation/asks/run_asks_eval.mjs [label]
 * Uses the configured model (e.g. BEDROCK_MODEL_ID). Each message is scored on its own,
 * with no open asks, so this measures labelling only, not closing asks across turns.
 * Writes results_<label>.json next to this file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../../../db/index.js';
import { initializeDatabase } from '../../../db/schema.js';
import { processInputUnderstanding } from '../../../companions/handlers/inputUnderstanding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] || 'run';
const CONCURRENCY = 4;
const items = JSON.parse(fs.readFileSync(path.join(here, 'labelled_asks.json'), 'utf8'));

const db = await open({ filename: ':memory:', driver: sqlite3.Database });
setGlobalDb(db);
await initializeDatabase();

// A request outranks a question when a message has both, matching how the set is labelled
function predictedLabel(asks) {
    const kinds = new Set((asks || []).map(a => a?.kind));
    if (kinds.has('request')) return 'request';
    if (kinds.has('question')) return 'question';
    return 'none';
}

async function score(item) {
    const result = await processInputUnderstanding('eval_patient', 'patient', item.message, 'eval_circle', {
        members: [], history: [], speaker: { username: 'patient' }
    });
    return { ...item, predicted: predictedLabel(result.asks), asks: result.asks };
}

const results = [];
for (let i = 0; i < items.length; i += CONCURRENCY) {
    results.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(score)));
    process.stdout.write(`\r${results.length}/${items.length}`);
}
console.log();

function summarise(rows) {
    const needs = (x) => x !== 'none';
    const tp = rows.filter(r => needs(r.expected) && needs(r.predicted)).length;
    const fp = rows.filter(r => !needs(r.expected) && needs(r.predicted)).length;
    const fn = rows.filter(r => needs(r.expected) && !needs(r.predicted)).length;
    const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
    return {
        items: rows.length,
        exact: pct(rows.filter(r => r.expected === r.predicted).length, rows.length),
        needsAnswerPrecision: pct(tp, tp + fp),
        needsAnswerRecall: pct(tp, tp + fn),
        missedAsks: fn,
        falseAsks: fp
    };
}

const kinds = ['question', 'request', 'none'];
const confusion = Object.fromEntries(kinds.map(e => [e, Object.fromEntries(kinds.map(p => [p, results.filter(r => r.expected === e && r.predicted === p).length]))]));
const report = {
    label,
    all: summarise(results),
    clearCasesOnly: summarise(results.filter(r => !r.ambiguous)),
    confusion,
    mismatches: results.filter(r => r.expected !== r.predicted).map(({ id, expected, predicted, ambiguous, message, asks }) => ({ id, expected, predicted, ambiguous, message, asks }))
};
fs.writeFileSync(path.join(here, `results_${label}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ all: report.all, clearCasesOnly: report.clearCasesOnly, confusion }, null, 2));
process.exit(0);
