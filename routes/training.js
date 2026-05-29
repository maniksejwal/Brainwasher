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
import { BUSINESS_PERSONAS, BUSINESS_SCENARIOS } from '../training/simulation/personas/business_personas.js';
// Full scenario library — single source of truth for all 100+ JS scenarios
import { SCENARIOS } from '../training/simulation/scenarios/index.js';
import { WORLD_SCENARIOS_DEFINITIONS } from '../training/world_simulation/world_scenarios.js';

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
            caregiver_prompt:       ts.caregiver_prompt || null,
            relative_prompt:        ts.relative_prompt || null,
            doctor_prompt:          ts.doctor_prompt || null,
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
        const hasDoctor = users.some(u => u.role === 'doctor' || u.role === 'clinician');
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
            required_elements:      persona.required_elements || [
                'build trust', 'identify concern', 'coordinate care',
                ...(hasDoctor ? ['escalate to clinician', 'clinician query'] : ['caregiver relay']),
            ],
            users,
            context:                persona.description || '',
            // Signal to worker.py that escalation is expected/rewarded
            escalation_expected:    hasDoctor,
        });
    }

    // Business / negotiation scenarios (buyer-seller, ROI justification, etc.)
    for (const bs of Object.values(BUSINESS_SCENARIOS || {})) {
        const patientUser = (bs.users || []).find(u => u.role === 'patient') || {};
        const personaKey  = patientUser.personaKey || '';
        const persona     = BUSINESS_PERSONAS?.[personaKey] || {};
        scenarios.push({
            scenario_id:            bs.id || `business_${personaKey}`,
            therapeutic_mode:       bs.therapeutic_mode || 'negotiation',
            domain:                 bs.domain || 'negotiation',
            deaddiction_phase:      bs.change_stage || 'contemplation',
            session_goal:           bs.description || bs.session_goal || 'Reach a mutually beneficial agreement',
            agent_instruction:      bs.agent_instruction || '',
            max_turns:              bs.turns || bs.max_turns || 10,
            context_window:         bs.context_window || 40,
            archetype:              bs.archetype || 'standard',
            has_misconception:      bs.has_misconception ?? false,
            flooding_target_stress: 0.0,
            initial_physio:         bs.physio_baseline ? {
                stress_index:  bs.physio_baseline.stress_index ?? 0.50,
                hrv_ms:        bs.physio_baseline.hrv_ms        ?? 38,
                eda_us:        bs.physio_baseline.eda_us        ?? 2.5,
                sleep_deficit: bs.physio_baseline.sleep_deficit ?? 0,
                glucose_mg_dl: bs.physio_baseline.glucose_mg_dl ?? 92,
            } : _physioFromPersona(persona, bs),
            patient_prompt:         bs.patient_prompt   || persona.prompt_template || '',
            caregiver_prompt:       bs.caregiver_prompt || null,
            relative_prompt:        bs.relative_prompt  || null,
            doctor_prompt:          bs.doctor_prompt    || null,
            required_elements:      bs.required_elements || ['acknowledge concern', 'explore options', 'reach agreement'],
            users:                  bs.users || [{ role: 'patient' }],
            context:                bs.context || persona.description || bs.description || '',
        });
    }

    // ── Full JS scenario library ──────────────────────────────────────────────
    // Convert every scenario from the unified SCENARIOS pool.
    // The persona-specific loops above already covered deaddiction, flooding,
    // negotiation, edge-case, and business variants with rich persona data.
    // This loop adds everything else: conflict, longitudinal, hospital, caregiver,
    // multi-user, privacy, escalation, ethical, avoidance, preventative, cultural,
    // behaviour-change, world/multi-circle, and any future categories.
    // Deduplication by scenario_id prevents double-counting.
    const seenIds = new Set(scenarios.map(s => s.scenario_id));

    for (const [key, sc] of Object.entries(SCENARIOS || {})) {
        const sid = `js_${key}`;
        if (seenIds.has(sid)) continue;

        const users      = sc.users || [{ role: 'patient' }];
        const hasDoctor  = users.some(u => (u.role || '').match(/doctor|clinician|physician/i));
        const isMulti    = users.length > 1;
        const cat        = sc.category || 'standard';
        const isEscalation  = cat === 'escalation' || !!(sc.instructions?.agent || '').match(/escalat/i);
        const isConsent     = cat === 'privacy' || cat === 'ethical';
        const isWorld       = !!(sc.circles) || cat === 'role_inversion' || cat === 'family_network'
                           || cat === 'generational' || cat === 'blended_family' || cat === 'complex_multi_circle';

        const instrPatient   = (sc.instructions || {}).patient   || '';
        const instrCaregiver = (sc.instructions || {}).caregiver || null;
        const instrDoctor    = (sc.instructions || {}).doctor    || null;
        const instrAgent     = (sc.instructions || {}).agent     || '';

        scenarios.push({
            scenario_id:            sid,
            therapeutic_mode:       sc.therapeutic_mode || cat,
            domain:                 cat,
            deaddiction_phase:      sc.change_stage || 'contemplation',
            session_goal:           sc.description  || sc.name || key,
            agent_instruction:      instrAgent,
            max_turns:              sc.turns || sc.max_turns || 20,
            context_window:         60,
            archetype:              sc.archetype || 'standard',
            has_misconception:      false,
            flooding_target_stress: 0.0,
            initial_physio: {
                stress_index:  isEscalation ? 0.65 : 0.40,
                hrv_ms:        isEscalation ? 22   : 38,
                eda_us:        2.5,
                sleep_deficit: 0,
                glucose_mg_dl: 95,
            },
            patient_prompt:         instrPatient,
            caregiver_prompt:       instrCaregiver,
            doctor_prompt:          instrDoctor,
            required_elements:      sc.required_elements || _clinicalGoals(cat, hasDoctor, isEscalation),
            users,
            context:                sc.description || '',
            escalation_expected:    isEscalation,
            consent_boundary_test:  isConsent,
            multi_role:             isMulti,
            is_world_scenario:      isWorld,
        });
        seenIds.add(sid);
    }

    // ── World (multi-care-circle) scenarios ───────────────────────────────────
    for (const [key, wsc] of Object.entries(WORLD_SCENARIOS_DEFINITIONS || {})) {
        const sid = `world_${key}`;
        if (seenIds.has(sid) || !wsc.users) continue;
        scenarios.push({
            scenario_id:            sid,
            therapeutic_mode:       wsc.therapeutic_mode || 'multi_circle',
            domain:                 wsc.category         || 'world',
            deaddiction_phase:      'contemplation',
            session_goal:           wsc.description      || wsc.name || key,
            agent_instruction:      '',
            max_turns:              wsc.turns || 25,
            context_window:         80,
            archetype:              'standard',
            has_misconception:      false,
            flooding_target_stress: 0.0,
            initial_physio: { stress_index: 0.40, hrv_ms: 38, eda_us: 2.5, sleep_deficit: 0, glucose_mg_dl: 95 },
            patient_prompt:         '',
            caregiver_prompt:       null,
            doctor_prompt:          null,
            required_elements:      wsc.required_elements || [
                'cross-circle coordination', 'escalate if needed', 'respect role boundaries',
            ],
            users:                  wsc.users || [],
            context:                wsc.description || '',
            is_world_scenario:      true,
            escalation_expected:    wsc.category === 'role_inversion' || wsc.category === 'crisis',
        });
        seenIds.add(sid);
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

function _clinicalGoals(category, hasDoctor, escalation_expected) {
    const base = {
        escalation: ['recognise crisis', 'de-escalate if safe', 'coordinate caregiver', 'escalate to clinician'],
        privacy:    ['identify consent level', 'enforce boundary', 'redirect caregiver', 'protect patient privacy'],
        ethical:    ['identify consent gap', 'anonymous consultation if needed', 'protect patient autonomy'],
    };
    const goals = base[category] || ['identify concern', 'coordinate appropriately', 'respect consent'];
    if (escalation_expected && !goals.includes('escalate to clinician')) goals.push('escalate to clinician');
    if (hasDoctor && !goals.includes('clinician query')) goals.push('clinician query');
    return goals;
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
