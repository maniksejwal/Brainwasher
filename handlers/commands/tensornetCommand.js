/**
 * @fileoverview handlers/commands/tensornetCommand.js
 *
 * CLI commands for the tensornets physiological engine and MCTS.
 * These commands let you test the Python tensornets bridge from the
 * SAME CLI you use for regular chat — no separate terminal needed.
 *
 * COMMANDS
 * --------
 * /physio status
 *   Show whether the tensornets Python server is reachable.
 *
 * /physio state
 *   Show the current physiological state for your user (HRV, stress, gamma).
 *
 * /physio set hrv <value>
 *   Manually inject an HRV value for testing (e.g. /physio set hrv 22).
 *
 * /physio simulate <n_turns>
 *   Run a short OU HRV simulation and print the trajectory.
 *   Example: /physio simulate 10
 *
 * /mcts action <candidate1> <candidate2> ...
 *   Ask the MCTS engine to pick the best action from the given candidates.
 *   Example: /mcts action open_question empathic_reflection challenger_insight affirmation
 *
 * /mcts session hint
 *   Show the longitudinal MCTS recommendation for your next session.
 *
 * /mcts judge <last>
 *   Judge the last N messages (default 1) using the Python judge (Maverick).
 *   Example: /mcts judge 3
 *
 * SERVER SETUP (run once in a separate terminal)
 * -----------------------------------------------
 *   cd tensornets
 *   uvicorn server:app --port 8765 --reload
 *
 * The commands fall back gracefully if the Python server is not running.
 */

import {
    getPhysioSummary,
    getMCTSAction,
    getSessionHint,
    judgeDialogueTurn,
} from '../../companions/physio/tensornetsBridge.js';
import {
    listBenchmarkRuns,
    getBenchmarkRun,
    compareBenchmarkArms,
    getRunScenarioBreakdown,
} from '../../db/queries_benchmarks.js';
import { getDb } from '../../db/connection.js';

export async function handleTensornetCommand(userId, circleId, parts, send) {
    const sub = parts[1]?.toLowerCase();

    if (!sub) {
        send(userId, _help());
        return;
    }

    // ── /physio ──────────────────────────────────────────────────────────────
    if (parts[0] === '/physio') {
        switch (sub) {
            case 'status':
                await _physioStatus(userId, send);
                break;
            case 'state':
                await _physioState(userId, circleId, send);
                break;
            case 'set':
                await _physioSet(userId, circleId, parts, send);
                break;
            case 'simulate':
                await _physioSimulate(userId, parts, send);
                break;
            default:
                send(userId, `Unknown /physio sub-command: ${sub}\n\n${_help()}`);
        }
        return;
    }

    // ── /mcts ─────────────────────────────────────────────────────────────────
    if (parts[0] === '/mcts') {
        switch (sub) {
            case 'action':
                await _mctsAction(userId, circleId, parts, send);
                break;
            case 'session':
                await _mctsSessionHint(userId, send);
                break;
            case 'judge':
                await _mctsJudge(userId, circleId, parts, send);
                break;
            default:
                send(userId, `Unknown /mcts sub-command: ${sub}\n\n${_help()}`);
        }
        return;
    }

    // ── /benchmark ────────────────────────────────────────────────────────────
    if (parts[0] === '/benchmark') {
        switch (sub) {
            case 'list':
                await _benchmarkList(parts, send);
                break;
            case 'show':
                await _benchmarkShow(parts, send);
                break;
            case 'compare':
                await _benchmarkCompare(parts, send);
                break;
            case 'breakdown':
                await _benchmarkBreakdown(parts, send);
                break;
            default:
                send(userId, `Unknown /benchmark sub-command: ${sub}\n\n${_help()}`);
        }
        return;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /physio handlers
// ─────────────────────────────────────────────────────────────────────────────

async function _physioStatus(userId, send) {
    try {
        const result = await getPhysioSummary({ hrv_rmssd_ms: 35, stress_index: 0.4 });
        if (result) {
            send(userId,
                `✅ tensornets Python server is ONLINE\n` +
                `   URL: ${process.env.TENSORNETS_URL || 'http://localhost:8765'}\n` +
                `   Smoke test: stress_index=${result.stress_index?.toFixed(3)}, ` +
                `label=${result.stress_label}`
            );
        } else {
            send(userId,
                `⚠️  tensornets server responded but returned null.\n` +
                `   Check uvicorn logs.`
            );
        }
    } catch (e) {
        send(userId,
            `❌ tensornets Python server is OFFLINE\n` +
            `   Start it: cd tensornets && uvicorn server:app --port 8765 --reload\n` +
            `   Error: ${e.message}`
        );
    }
}

async function _physioState(userId, circleId, send) {
    // Pull the most recent HRV-like context from conversation state or DB
    // For now, use a representative test state
    const testState = {
        hrv_rmssd_ms: 30,
        stress_index: 0.55,
        time_of_day: new Date().getHours() / 24,
        subject_id: userId,
    };

    const result = await getPhysioSummary(testState);
    if (!result) {
        send(userId,
            `⚠️  tensornets server not reachable — showing JS fallback values\n` +
            `   HRV: 30ms | stress: 0.55 | label: moderate_stress`
        );
        return;
    }

    const lines = [
        `📊 Physiological State  [${userId}]`,
        `─────────────────────────────────`,
        `  HRV (RMSSD):   ${testState.hrv_rmssd_ms} ms`,
        `  Stress index:  ${result.stress_index?.toFixed(3)}`,
        `  Stress label:  ${result.stress_label}`,
        `  Gamma (Γ):     ${result.gamma?.toFixed(4) ?? 'n/a'}`,
        `  Lambda1 (λ₁):  ${result.lambda1?.toFixed(4) ?? 'n/a'}`,
        `  Half-life:     ${result.half_life_turns ?? 'n/a'} turns`,
        ``,
        `  Prompt hint:   "${result.prompt_hint ?? 'none'}"`,
    ];
    send(userId, lines.join('\n'));
}

async function _physioSet(userId, circleId, parts, send) {
    // /physio set hrv 22
    const field = parts[2]?.toLowerCase();
    const value = parseFloat(parts[3]);
    if (field !== 'hrv' || isNaN(value)) {
        send(userId, `Usage: /physio set hrv <value>\nExample: /physio set hrv 22`);
        return;
    }
    if (value < 5 || value > 120) {
        send(userId, `❌ HRV value must be between 5 and 120 ms.`);
        return;
    }
    const testState = { hrv_rmssd_ms: value, stress_index: _hrvToStress(value) };
    const result = await getPhysioSummary(testState);
    const label = result?.stress_label ?? _stressLabel(_hrvToStress(value));
    send(userId,
        `✅ HRV manually set to ${value}ms for this test.\n` +
        `   Stress index: ${testState.stress_index.toFixed(3)}  (${label})\n` +
        `   Note: this does not persist — it is a test injection.`
    );
}

async function _physioSimulate(userId, parts, send) {
    const nTurns = Math.min(parseInt(parts[2]) || 10, 30);
    // Simple OU simulation in JS (mirror of Python OU)
    let hrv = 35;
    const theta = 0.1, mu = 35, sigma = 4;
    const lines = [
        `📈 HRV Simulation (${nTurns} turns, OU process)`,
        `─────────────────────────────────────────────`,
        `Turn   HRV(ms)  Stress   Label`,
        `─────────────────────────────────────────────`,
    ];
    for (let t = 0; t < nTurns; t++) {
        const noise = sigma * (Math.random() * 2 - 1) * Math.sqrt(0.1);
        hrv = hrv + theta * (mu - hrv) + noise;
        hrv = Math.max(8, Math.min(90, hrv));
        const stress = _hrvToStress(hrv);
        const label = _stressLabel(stress).padEnd(14);
        const bar = '█'.repeat(Math.round(stress * 10));
        lines.push(`${String(t+1).padStart(4)}   ${hrv.toFixed(1).padStart(7)}  ${stress.toFixed(3)}   ${label} ${bar}`);
    }
    send(userId, lines.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// /mcts handlers
// ─────────────────────────────────────────────────────────────────────────────

async function _mctsAction(userId, circleId, parts, send) {
    // /mcts action open_question empathic_reflection challenger_insight affirmation
    const candidates = parts.slice(2).filter(Boolean);
    if (candidates.length < 2) {
        send(userId,
            `Usage: /mcts action <action1> <action2> [action3] [action4]\n` +
            `Example: /mcts action open_question empathic_reflection challenger_insight affirmation\n` +
            `\nValid actions: open_question, empathic_reflection, affirmation, challenger_insight,\n` +
            `               give_facts, give_options, validate, develop_discrepancy, loss_frame,\n` +
            `               summarise, socratic_probe, flooding_hold, spike_step`
        );
        return;
    }

    const physioState = { hrv_ms: 28, stress_index: 0.6 };
    const result = await getMCTSAction({
        physio_state: physioState,
        candidate_actions: candidates,
        mode: 'deaddiction',
        depth: 4,
        iterations: 80,
        context: `CLI test — user: ${userId}`,
    });

    if (!result) {
        send(userId, `⚠️  tensornets server not reachable. Start: cd tensornets && uvicorn server:app --port 8765 --reload`);
        return;
    }

    const stats = result.tree_stats || {};
    const lines = [
        `🎯 MCTS Action Selection`,
        `─────────────────────────────────────────`,
        `  Candidates:   ${candidates.join(', ')}`,
        `  Best action:  ${result.action}`,
        `  Q-value:      ${result.q_value}`,
        `  Iterations:   ${stats.iterations ?? '?'}`,
        `  Tree depth:   ${stats.depth ?? '?'}`,
        `  Elapsed:      ${stats.elapsed_ms ?? '?'} ms`,
        ``,
        `  FRAMES:       ${_framesFor(result.action)}`,
        `  MCTS dim:     ${_mctsCategory(result.action)}`,
    ];
    send(userId, lines.join('\n'));
}

async function _mctsSessionHint(userId, send) {
    const result = await getSessionHint(userId);
    if (!result) {
        send(userId, `⚠️  tensornets server not reachable — no session state available.`);
        return;
    }
    const lines = [
        `📋 Longitudinal Session Hint  [${userId}]`,
        `─────────────────────────────────────────`,
        `  Sessions completed:     ${result.session_count ?? 0}`,
        `  Recommended phase:      ${result.recommended_phase}`,
        `  Recommended mode:       ${result.recommended_mode}`,
        `  Alliance:               ${result.alliance?.toFixed(3) ?? 'n/a'}`,
        `  Readiness score:        ${result.readiness_score}`,
        `  Sessions until flooding: ${result.sessions_until_ready_for_flooding ?? 'ready now'}`,
        ``,
        `  Rationale: ${result.rationale}`,
    ];
    send(userId, lines.join('\n'));
}

async function _mctsJudge(userId, circleId, parts, send) {
    const n = Math.min(parseInt(parts[2]) || 1, 5);
    const db = await getDb();

    const rows = await db.all(
        `SELECT sender_id, message FROM messages
         WHERE circle_id = ?
         ORDER BY timestamp DESC LIMIT ?`,
        [circleId, n * 2]
    );

    if (!rows || rows.length < 2) {
        send(userId, `❌ Not enough messages to judge. Have at least 1 exchange.`);
        return;
    }

    // Pair up patient input + companion reply
    const turns = [];
    for (let i = 0; i < rows.length - 1; i += 2) {
        const a = rows[i], b = rows[i + 1];
        if (a && b) {
            turns.push({
                patient_input: b.message,
                companion_reply: a.message,
                physio_context: { stress_index: 0.5 },
            });
        }
    }

    // Try Python judge first (adds physio_alignment + clinical_accuracy dimensions)
    // Falls back to a note directing user to existing SimulationScorer
    send(userId, `⏳ Judging ${turns.length} turn(s) using Python Maverick judge… (may take 5-10s)`);

    for (let i = 0; i < turns.length; i++) {
        const verdict = await judgeDialogueTurn({
            ...turns[i],
            mode: 'standard',
            judge_model: 'maverick',
        });

        if (!verdict) {
            send(userId,
                `⚠️  Python judge unavailable (tensornets server offline).\n` +
                `Use the existing simulation scorer: training/simulation/llm_scorer.js\n` +
                `or run a simulation via the GUI Training Dashboard.`
            );
            return;
        }

        const scores = verdict.scores || {};
        const lines = [
            `\n📝 Turn ${i + 1} — Python Judge (Maverick)`,
            `─────────────────────────────────────────`,
            `  Patient said:   "${turns[i].patient_input?.slice(0, 60)}…"`,
            `  Companion said: "${turns[i].companion_reply?.slice(0, 60)}…"`,
            ``,
            `  Therapeutic quality: ${scores.therapeutic_quality ?? '?'}/5`,
            `  Empathy:             ${scores.empathy ?? '?'}/5`,
            `  Goal alignment:      ${scores.goal_alignment ?? '?'}/5`,
            `  Non-manipulation:    ${scores.non_manipulation ?? '?'}/5`,
            `  Info density:        ${scores.information_density ?? '?'}/5`,
            `  ─────────────────`,
            `  Overall:             ${verdict.overall}/5  ${verdict.passed ? '✅ PASS' : '❌ FAIL'}`,
            ``,
            `  Reasoning: ${verdict.reasoning}`,
            ``,
            `  Note: For full simulation scoring (urgency, denial, probing questions),`,
            `  use the Training Dashboard or ConversationRunner + SimulationScorer.`,
        ];
        send(userId, lines.join('\n'));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _hrvToStress(hrv) {
    // Matches Python stress_index formula (approximate)
    return Math.max(0, Math.min(1, 1 - (hrv - 10) / 70));
}

function _stressLabel(s) {
    if (s >= 0.75) return 'critical';
    if (s >= 0.55) return 'high_stress';
    if (s >= 0.35) return 'moderate_stress';
    return 'low_stress';
}

function _framesFor(action) {
    const map = {
        give_facts: 'Feedback', psychoeducation: 'Feedback', loss_frame: 'Feedback',
        validate: 'Responsibility', develop_discrepancy: 'Responsibility',
        give_options: 'Advice + Menu',
        empathic_reflection: 'Empathy', affirmation: 'Empathy + Self-efficacy',
        motivational_frame: 'Self-efficacy', flooding_hold: 'Self-efficacy',
        challenger_insight: 'Feedback', socratic_probe: 'Responsibility',
        open_question: 'Empathy', summarise: 'Empathy',
    };
    return map[action] || 'Standard';
}

function _mctsCategory(action) {
    const map = {
        open_question: 'info_coverage', empathic_reflection: 'trust_delta',
        affirmation: 'trust_delta', challenger_insight: 'goal_progress',
        give_options: 'goal_progress', flooding_hold: 'goal_progress',
        validate: 'stress_reduction', develop_discrepancy: 'goal_progress',
    };
    return map[action] || 'info_coverage';
}

function _help() {
    return [
        `🧠 tensornets CLI Commands`,
        `─────────────────────────────────────────────────────────`,
        `PHYSIOLOGY:`,
        `  /physio status              — ping the Python server`,
        `  /physio state               — show your current physio state`,
        `  /physio set hrv <value>     — inject an HRV value for testing`,
        `  /physio simulate <n_turns>  — run a short HRV simulation`,
        ``,
        `MCTS:`,
        `  /mcts action <a1> <a2>…     — pick best action (MCTS)`,
        `  /mcts session hint          — show longitudinal session recommendation`,
        `  /mcts judge [n]             — judge last n turns with Maverick`,
        ``,
        `SETUP:`,
        `  cd tensornets`,
        `  uvicorn server:app --port 8765 --reload`,
        ``,
        `BENCHMARKS:`,
        `  /benchmark list [arm]           — list runs (filter by arm: htn_mcts|oldschool|hysteresis_prompt)`,
        `  /benchmark show <run_id>        — show episodes for a run`,
        `  /benchmark compare <scenario>   — compare all arms on a scenario set`,
        `  /benchmark breakdown <run_id>   — per-scenario breakdown for a run`,
        `─────────────────────────────────────────────────────────`,
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// /benchmark handlers
// ─────────────────────────────────────────────────────────────────────────────

async function _benchmarkList(parts, send) {
    const arm = parts[2] || null;
    try {
        const runs = await listBenchmarkRuns({ arm, limit: 20 });
        if (!runs.length) {
            send(null, arm
                ? `No benchmark runs found for arm=${arm}.`
                : `No benchmark runs in DB yet. Run comparison_runner.py or benchmarks/runner.py first.`);
            return;
        }
        const label = arm ? ` [${arm}]` : '';
        const lines = [`Benchmark runs${label} (newest first):`, ''];
        for (const r of runs) {
            const dt = new Date(r.started_at).toISOString().slice(0, 16);
            const done = r.completed_at ? `✓ ${r.episode_count} ep` : '…running';
            const rew = r.mean_reward != null ? `  reward=${r.mean_reward.toFixed(3)}` : '';
            lines.push(`  ${r.run_id.slice(0, 8)}  ${r.arm.padEnd(20)} ${dt}  ${done}${rew}`);
            if (r.label) lines.push(`           ${r.label}`);
        }
        send(null, lines.join('\n'));
    } catch (e) {
        send(null, `benchmark list error: ${e.message}`);
    }
}

async function _benchmarkShow(parts, send) {
    const run_id = parts[2];
    if (!run_id) { send(null, 'Usage: /benchmark show <run_id>'); return; }
    try {
        const run = await getBenchmarkRun(run_id);
        if (!run) { send(null, `Run ${run_id} not found.`); return; }
        const lines = [
            `Run: ${run.run_id}`,
            `Arm: ${run.arm}  Scenario set: ${run.scenario_set}`,
            run.label ? `Label: ${run.label}` : null,
            `Episodes: ${run.episodes?.length ?? 0}`,
            run.mean_reward != null ? `Mean reward: ${run.mean_reward.toFixed(4)}` : null,
            run.goal_achieved_pct != null ? `Goal rate: ${(run.goal_achieved_pct * 100).toFixed(1)}%` : null,
            '',
            'Episodes:',
        ].filter(Boolean);
        for (const e of (run.episodes || []).slice(0, 15)) {
            const goal = e.goal_achieved ? '✓' : '✗';
            const rew = e.cumulative_reward != null ? e.cumulative_reward.toFixed(3) : '—';
            lines.push(`  ${goal} ${e.scenario_id.padEnd(30)} reward=${rew}  turns=${e.turn_count}`);
        }
        if ((run.episodes?.length ?? 0) > 15) lines.push(`  … and ${run.episodes.length - 15} more`);
        send(null, lines.join('\n'));
    } catch (e) {
        send(null, `benchmark show error: ${e.message}`);
    }
}

async function _benchmarkCompare(parts, send) {
    const scenario_set = parts[2] || '';
    try {
        const rows = await compareBenchmarkArms(scenario_set);
        if (!rows.length) {
            send(null, `No benchmark data for scenario_set="${scenario_set}". Run a comparison first.`);
            return;
        }
        const lines = [
            `Arm comparison${scenario_set ? ` — ${scenario_set}` : ''}:`,
            '',
            'Arm                   Episodes  Reward   Goal%   Turns  Tokens',
            '─'.repeat(65),
        ];
        for (const r of rows) {
            lines.push([
                r.arm.padEnd(22),
                String(r.episodes).padEnd(10),
                (r.mean_reward ?? 0).toFixed(3).padEnd(9),
                ((r.goal_rate ?? 0) * 100).toFixed(1).padEnd(8) + '%',
                (r.mean_turns ?? 0).toFixed(1).padEnd(7),
                Math.round(r.mean_tokens ?? 0),
            ].join(''));
        }
        send(null, lines.join('\n'));
    } catch (e) {
        send(null, `benchmark compare error: ${e.message}`);
    }
}

async function _benchmarkBreakdown(parts, send) {
    const run_id = parts[2];
    if (!run_id) { send(null, 'Usage: /benchmark breakdown <run_id>'); return; }
    try {
        const rows = await getRunScenarioBreakdown(run_id);
        if (!rows.length) { send(null, `No episodes for run ${run_id}.`); return; }
        const lines = [`Per-scenario breakdown for run ${run_id.slice(0, 8)}:`, ''];
        for (const r of rows) {
            const goal = r.goal_achieved ? '✓' : '✗';
            lines.push(`  ${goal} ${(r.scenario_id || '').padEnd(32)} reward=${(r.cumulative_reward ?? 0).toFixed(3)}  turns=${r.turns_to_goal ?? '—'}`);
        }
        send(null, lines.join('\n'));
    } catch (e) {
        send(null, `benchmark breakdown error: ${e.message}`);
    }
}
