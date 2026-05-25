/**
 * routes/training.js — A3C training and benchmarking endpoints.
 *
 * Mounted at /api in server.js (before simulationRouter).
 * Exposed routes:
 *   GET  /api/training/scenarios   — canonical A3C scenarios (consumed by Python)
 *   POST /api/benchmark/message    — synchronous companion call for Arm 2
 */

import express from 'express';
import { handleMessage, handleLogin } from '../orchestrator.js';
import {
    THERAPY_PERSONAS,
    THERAPY_SCENARIOS,
    PROFESSIONAL_CRITIQUE_PERSONAS,
    PROFESSIONAL_CRITIQUE_SCENARIOS,
} from '../training/simulation/personas/therapy_personas.js';
import { EDGE_CASE_PERSONAS } from '../training/simulation/personas/edge_case_personas.js';

const router = express.Router();

const BENCHMARK_USERNAME   = 'benchmark_a3c';
let   _benchmarkReady      = false;
let   _benchmarkUserId     = null;
let   _benchmarkCircleId   = null;

async function _ensureBenchmarkContext() {
    if (_benchmarkReady) return;
    try {
        const result = await handleLogin(BENCHMARK_USERNAME);
        _benchmarkUserId   = result.userId;
        _benchmarkCircleId = result.activeCircleId;
        console.log(`[training] Benchmark context ready: user=${_benchmarkUserId} circle=${_benchmarkCircleId}`);
        _benchmarkReady = true;
    } catch (err) {
        console.error('[training] Could not ensure benchmark context:', err.message);
    }
}

// ── GET /api/training/scenarios ───────────────────────────────────────────────
//
// Returns canonical A3C training scenarios built from JS persona/scenario files.
// Python scenario_loader.py fetches this on startup.
//
// Query params:
//   ?domain=deaddiction|flooding|negotiation|standard|all  (default: all)
//   ?id=<scenario_id>                                       (single lookup)
//
// Each scenario dict shape matches Python TurnState / CareCircleOrchestrator.

router.get('/training/scenarios', (req, res) => {
    try {
        const { domain, id } = req.query;
        const all = _buildCanonicalScenarios();

        if (id) {
            const scenario = all.find(s => s.scenario_id === id);
            if (!scenario) return res.status(404).json({ error: `Scenario '${id}' not found` });
            return res.json({ scenario });
        }

        const filtered = domain && domain !== 'all'
            ? all.filter(s => s.therapeutic_mode === domain || s.domain === domain)
            : all;

        res.json({ scenarios: filtered, total: filtered.length });
    } catch (error) {
        console.error('[/api/training/scenarios] Error:', error.message);
        res.status(500).json({ error: 'Failed to build training scenarios' });
    }
});

// ── POST /api/benchmark/message ───────────────────────────────────────────────
//
// Synchronous companion call used by A3C Arm 2.
// Body: { userId, circleId, message, sessionId?, arm? }
// Returns: { response, agent_action, session_id, latency_ms }

router.post('/benchmark/message', async (req, res) => {
    const { message, sessionId, arm } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Missing message' });
    }

    await _ensureBenchmarkContext();
    if (!_benchmarkUserId || !_benchmarkCircleId) {
        return res.status(503).json({ error: 'Benchmark context unavailable' });
    }

    const t0 = Date.now();
    try {
        const analysis = await handleMessage(_benchmarkUserId, _benchmarkCircleId, message);
        const response = analysis?.reply || analysis?.agent_response || analysis?.response || '';
        if (!response) {
            console.error('[/api/benchmark/message] Empty response. analysis:', JSON.stringify(analysis)?.slice(0, 200));
        }
        return res.json({
            response:     response,
            agent_action: analysis?.action || null,
            session_id:   sessionId || null,
            arm:          arm || 'oldschool',
            latency_ms:   Date.now() - t0,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err.message || err) });
    }
});


// ── Scenario builder ──────────────────────────────────────────────────────────

function _buildCanonicalScenarios() {
    const scenarios = [];

    // Deaddiction — THERAPY_SCENARIOS is a dict keyed by scenario ID
    for (const ts of Object.values(THERAPY_SCENARIOS || {})) {
        const patientUser = (ts.users || []).find(u => u.role === 'patient') || {};
        const personaKey  = patientUser.personaKey || ts.personaKey || ts.persona_key;
        const persona     = THERAPY_PERSONAS[personaKey] || {};
        const phase       = ts.deaddiction_phase || ts.phase || 'precontemplation';
        scenarios.push({
            scenario_id:            ts.id || `deaddiction_${personaKey}_${phase}`,
            therapeutic_mode:       ts.therapeutic_mode || 'deaddiction',
            domain:                 ts.domain || 'deaddiction',
            deaddiction_phase:      phase,
            session_goal:           ts.description || ts.session_goal || `Support ${persona.name || personaKey} in ${phase} phase`,
            agent_instruction:      ts.agent_instruction || '',
            max_turns:              ts.turns || ts.max_turns || 30,
            context_window:         ts.context_window || 60,
            archetype:              ts.archetype || persona.archetype || 'standard',
            has_misconception:      ts.has_misconception ?? false,
            flooding_target_stress: ts.flooding_target_stress || 0.0,
            initial_physio:         _physioFromPersona(persona, ts),
            patient_prompt:         persona.prompt_template || persona.phase_responses?.[phase] || '',
            caregiver_prompt:       null,
            doctor_prompt:          null,
            required_elements:      ts.required_elements || _defaultGoals(phase),
            users:                  ts.users || [{ role: 'patient' }],
            context:                ts.context || persona.description || ts.description || '',
        });
    }

    // Flooding
    for (const [key, persona] of Object.entries(THERAPY_PERSONAS).filter(([, p]) => p.domain === 'flooding')) {
        scenarios.push({
            scenario_id:            `flooding_${key}`,
            therapeutic_mode:       'flooding',
            domain:                 'flooding',
            deaddiction_phase:      'flooding_exposure',
            session_goal:           `Flooding exposure session for ${persona.name}`,
            max_turns:              20,
            context_window:         40,
            archetype:              persona.archetype || 'anxious',
            has_misconception:      false,
            flooding_target_stress: persona.target_stress || 0.80,
            initial_physio:         _physioFromPersona(persona, {}),
            patient_prompt:         persona.prompt_template || '',
            caregiver_prompt:       null,
            doctor_prompt:          null,
            required_elements:      ['stay with stimulus', 'acknowledge anxiety', 'no escape', 'peak reached'],
            users:                  [{ role: 'patient' }],
            context:                persona.description || 'flooding exposure therapy',
        });
    }

    // Negotiation / professional critique — also a dict
    for (const cs of Object.values(PROFESSIONAL_CRITIQUE_SCENARIOS || {})) {
        const patientUser = (cs.users || []).find(u => u.role === 'patient') || {};
        const personaKey  = patientUser.personaKey || cs.personaKey || cs.persona_key;
        const persona     = PROFESSIONAL_CRITIQUE_PERSONAS?.[personaKey] || THERAPY_PERSONAS[personaKey] || {};
        scenarios.push({
            scenario_id:            cs.id || `negotiation_${personaKey}`,
            therapeutic_mode:       'negotiation',
            domain:                 'negotiation',
            deaddiction_phase:      'contemplation',
            session_goal:           cs.session_goal || 'Support patient in resolving dispute',
            max_turns:              cs.max_turns || 25,
            context_window:         60,
            archetype:              cs.archetype || persona.archetype || 'standard',
            has_misconception:      cs.has_misconception ?? false,
            flooding_target_stress: 0.0,
            initial_physio:         _physioFromPersona(persona, cs),
            patient_prompt:         persona.prompt_template || '',
            caregiver_prompt:       null,
            doctor_prompt:          null,
            required_elements:      cs.required_elements || ['identify dispute', 'validate concern', 'explore options', 'resolution plan'],
            users:                  cs.users || [{ role: 'patient' }],
            context:                cs.context || persona.description || '',
        });
    }

    // Edge case / multi-user care circle
    for (const [key, persona] of Object.entries(EDGE_CASE_PERSONAS || {}).filter(([, p]) => Array.isArray(p.care_circle) && p.care_circle.length > 0)) {
        const users = [
            { role: 'patient' },
            ...persona.care_circle.map(m => ({ role: m.role || 'caregiver' })),
        ];
        scenarios.push({
            scenario_id:            `edge_${key}`,
            therapeutic_mode:       persona.therapeutic_mode || 'standard',
            domain:                 persona.domain || 'standard',
            deaddiction_phase:      'contemplation',
            session_goal:           `Multi-user session with ${persona.name}`,
            max_turns:              30,
            context_window:         60,
            archetype:              persona.archetype || 'standard',
            has_misconception:      persona.has_misconception ?? false,
            flooding_target_stress: 0.0,
            initial_physio:         _physioFromPersona(persona, {}),
            patient_prompt:         persona.prompt_template || '',
            caregiver_prompt:       persona.care_circle?.[0]?.prompt_template || null,
            doctor_prompt:          persona.care_circle?.find(m => m.role === 'doctor')?.prompt_template || null,
            required_elements:      persona.required_elements || ['build trust', 'identify concern', 'coordinate care'],
            users,
            context:                persona.description || '',
        });
    }

    return scenarios;
}

function _physioFromPersona(persona, override) {
    const physio   = persona.physiological_profile || {};
    const initial  = override.initial_physio || {};
    const hrv      = initial.hrv_ms ?? physio.hrv_baseline_ms ?? 35;
    const stressIndex = Math.max(0.05, Math.min(0.95, 1.0 - (hrv - 10) / 60));
    return {
        stress_index:  initial.stress_index ?? Math.round(stressIndex * 100) / 100,
        hrv_ms:        hrv,
        eda_us:        initial.eda_us ?? physio.eda_baseline_us ?? 3.5,
        sleep_deficit: initial.sleep_deficit ?? physio.sleep_deficit_rolling ?? 0,
        glucose_mg_dl: initial.glucose_mg_dl ?? 95,
    };
}

function _defaultGoals(phase) {
    return ({
        rapport:           ['establish trust', 'understand daily routine', 'identify support network'],
        precontemplation:  ['establish trust', 'understand daily routine', 'identify support network'],
        ambivalence:       ['surface ambivalence', 'explore pros and cons', 'elicit change talk'],
        contemplation:     ['surface ambivalence', 'explore pros and cons', 'elicit change talk'],
        insight:           ['acknowledge problem', 'identify triggers', 'develop discrepancy'],
        preparation:       ['acknowledge problem', 'identify triggers', 'develop discrepancy'],
        strike:            ['commit to change', 'identify first step', 'agree on follow-up'],
        action:            ['commit to change', 'identify first step', 'agree on follow-up'],
        maintenance:       ['reinforce gains', 'identify relapse triggers', 'build resilience'],
        flooding_exposure: ['stay with stimulus', 'acknowledge anxiety', 'no escape', 'peak reached'],
    })[phase] || ['general support'];
}

export default router;
