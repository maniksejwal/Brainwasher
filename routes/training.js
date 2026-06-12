/**
 * routes/training.js — A3C training and benchmarking endpoints.
 *
 * Mounted at /api in server.js (before simulationRouter).
 * Exposed routes:
 *   GET  /api/training/scenarios   — canonical A3C scenarios (consumed by Python)
 *   POST /api/benchmark/message    — synchronous companion call for Arm 2
 */

import express from 'express';

// ── Normalise JS scenario category/mode labels → valid Python TherapeuticMode values ──
// Python's TherapeuticMode enum accepts exactly:
//   standard | flooding | behaviour_change | deaddiction | negotiation
// Any JS category string not in this set is mapped here.
// If a scenario emits a mode not in this map AND not valid, _buildCanonicalScenarios
// will throw so the gap is found and fixed at the source, not silently papered over.
const VALID_PYTHON_MODES = new Set([
    'standard', 'flooding', 'behaviour_change', 'deaddiction', 'negotiation',
]);
const JS_MODE_TO_PYTHON = {
    // ── JS category → closest Python mode ────────────────────────────────────
    behavior_change:        'behaviour_change',  // US spelling
    mental_health:          'standard',
    caregiver:              'standard',
    ethical:                'standard',
    privacy:                'standard',
    consent:                'standard',
    disclosure:             'standard',
    crisis:                 'standard',
    escalation:             'standard',
    safety:                 'standard',
    curative:               'standard',
    preventative:           'behaviour_change',
    education:              'behaviour_change',
    rehabilitation:         'behaviour_change',
    longitudinal:           'behaviour_change',
    future_planning:        'behaviour_change',
    cognitive:              'behaviour_change',
    relapse_prevention:     'deaddiction',
    deception:              'standard',
    avoidance:              'behaviour_change',
    professional:           'negotiation',
    professional_critique:  'negotiation',
    professional_crisis:    'negotiation',
    document_collaboration: 'negotiation',
    conflict:               'negotiation',
    family_dynamics:        'standard',
    multi_user:             'standard',
    multi_role:             'standard',
    multi_circle:           'standard',
    complex_multi_circle:   'standard',
    complex:                'standard',
    world:                  'standard',
    environmental:          'standard',
    situational:            'standard',
    social:                 'standard',
    basic:                  'standard',
    opd:                    'standard',
    ipd:                    'standard',
    hospital_ipd:           'standard',
    hospital_opd:           'standard',
    community:              'standard',
    peer_support:           'standard',
    palliative:             'standard',
    oncology:               'standard',
    chronic:                'behaviour_change',
    acute:                  'standard',
    generational:           'standard',
    blended_family:         'standard',
    negotiation:            'negotiation',
    // ── Additional JS categories discovered from scenario files ──────────────
    stress_test:               'standard',
    professional_coordination: 'negotiation',
    psychotherapy:             'standard',
    supportive:                'standard',
    rehabilitation:            'behaviour_change',
    cognitive:                 'behaviour_change',
    // cultural / practical / lifestyle / psychology / misconception
    cultural:                  'standard',
    practical:                 'standard',
    lifestyle:                 'behaviour_change',
    psychology:                'standard',
    misconception:             'standard',
    // intervention queue and notification test
    intervention_queue:        'standard',
    notification_test:         'standard',
    // document categories
    document_negotiation:          'negotiation',
    document_approval:             'negotiation',
    document_privacy:              'standard',
    professional_document_hybrid:  'negotiation',
    // professional sub-categories
    professional_basic:        'negotiation',
    professional_complex:      'negotiation',
    professional_validation:   'negotiation',
    professional_scaling:      'negotiation',
    // world scenario categories
    role_inversion:            'standard',
    family_network:            'standard',
    // composite scenarios (multi-concern, used for advanced benchmarking)
    composite:                 'standard',
    // predictive escalation scenarios
    proactive_monitoring:      'standard',
};

/**
 * Normalise a raw mode string (from a JS scenario or category) to a valid
 * Python TherapeuticMode value.  Throws if the mode is unknown — fix the
 * scenario definition rather than adding a silent default.
 */
function normalisePythonMode(rawMode) {
    if (!rawMode) return 'standard';
    if (VALID_PYTHON_MODES.has(rawMode)) return rawMode;
    const mapped = JS_MODE_TO_PYTHON[rawMode];
    if (mapped) return mapped;
    throw new Error(
        `Unknown therapeutic_mode '${rawMode}' — add it to JS_MODE_TO_PYTHON in routes/training.js`
    );
}
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
    const { message, sessionId, arm, skipPrivacyGuard, extraContext } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Missing message' });
    }

    await _ensureBenchmarkContext();
    if (!_benchmarkUserId || !_benchmarkCircleId) {
        return res.status(503).json({ error: 'Benchmark context unavailable' });
    }

    const t0 = Date.now();
    try {
        const opts = {};
        if (skipPrivacyGuard) opts.skipPrivacyGuard = true;
        if (extraContext)     opts.extraContext = extraContext;
        const analysis = await handleMessage(_benchmarkUserId, _benchmarkCircleId, message, opts);
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
            therapeutic_mode:       normalisePythonMode(ts.therapeutic_mode || 'deaddiction'),
            domain:                 ts.domain || 'deaddiction',
            deaddiction_phase:      phase,
            session_goal:           ts.description || ts.session_goal || `Support ${persona.name || personaKey} in ${phase} phase`,
            agent_instruction:      ts.agent_instruction || '',
            max_turns:              ts.turns || ts.max_turns || 35,
            context_window:         ts.context_window || 60,
            archetype:              ts.archetype || persona.archetype || 'standard',
            has_misconception:      ts.has_misconception ?? false,
            flooding_target_stress: ts.flooding_target_stress || 0.0,
            initial_physio:         _physioFromPersona(persona, ts, ts.id || `deaddiction_${personaKey}_${phase}`),
            patient_prompt:         persona.prompt_template || persona.phase_responses?.[phase] || '',
            caregiver_prompt:       ts.caregiver_prompt || null,
            relative_prompt:        ts.relative_prompt || null,
            doctor_prompt:          ts.doctor_prompt || null,
            required_elements:      ts.required_elements || _defaultGoals(phase),
            goal_descriptions:      ts.goal_descriptions || null,
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
            max_turns:              25,  // flooding can run longer; TTM drift needs room
            context_window:         40,
            archetype:              persona.archetype || 'anxious',
            has_misconception:      false,
            flooding_target_stress: persona.target_stress || 0.80,
            initial_physio:         _physioFromPersona(persona, {}, `flooding_${key}`),
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
            initial_physio:         _physioFromPersona(persona, cs, cs.id || `negotiation_${personaKey}`),
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
            therapeutic_mode:       normalisePythonMode(persona.therapeutic_mode || 'standard'),
            domain:                 persona.domain || 'standard',
            deaddiction_phase:      'contemplation',
            session_goal:           `Multi-user session with ${persona.name}`,
            max_turns:              30,
            context_window:         60,
            archetype:              persona.archetype || 'standard',
            has_misconception:      persona.has_misconception ?? false,
            flooding_target_stress: 0.0,
            initial_physio:         _physioFromPersona(persona, {}, `edge_${key}`),
            patient_prompt:         persona.prompt_template || '',
            caregiver_prompt:       persona.care_circle?.find(m => m.role === 'caregiver')?.prompt_template || null,
            relative_prompt:        persona.care_circle?.find(m => m.role === 'relative')?.prompt_template || null,
            doctor_prompt:          persona.care_circle?.find(m => m.role === 'doctor' || m.role === 'clinician')?.prompt_template || null,
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
            therapeutic_mode:       normalisePythonMode(bs.therapeutic_mode || 'negotiation'),
            domain:                 bs.domain || 'negotiation',
            deaddiction_phase:      bs.change_stage || 'contemplation',
            session_goal:           bs.description || bs.session_goal || 'Reach a mutually beneficial agreement',
            agent_instruction:      bs.agent_instruction || '',
            max_turns:              bs.turns || bs.max_turns || 10,
            context_window:         bs.context_window || 40,
            archetype:              bs.archetype || 'standard',
            has_misconception:      bs.has_misconception ?? false,
            flooding_target_stress: 0.0,
            initial_physio:         bs.physio_baseline
                ? _samplePhysio(
                    (bs.users?.[0]?.role || 'patient'),
                    bs.id || `bench_${persona?.name || 'unknown'}`,
                    bs.physio_baseline,    // explicit fields take precedence
                  )
                : _physioFromPersona(persona, bs, bs.id || `bench_${persona?.name || 'unknown'}`),
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
            therapeutic_mode:       normalisePythonMode(sc.therapeutic_mode || cat),
            domain:                 cat,
            deaddiction_phase:      sc.change_stage || 'contemplation',
            session_goal:           sc.description  || sc.name || key,
            agent_instruction:      instrAgent,
            max_turns:              sc.turns || sc.max_turns || 25,
            context_window:         60,
            archetype:              sc.archetype || 'standard',
            has_misconception:      false,
            flooding_target_stress: 0.0,
            initial_physio: sc.physio_baseline
                ? _samplePhysio(
                    (users[0]?.role || 'patient'),
                    `js_${key}`,
                    sc.physio_baseline,
                  )
                : {
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
            goal_descriptions:      sc.goal_descriptions || null,
            users,
            context:                sc.description || '',
            escalation_expected:    isEscalation,
            consent_boundary_test:  isConsent,
            multi_role:             isMulti,
            is_world_scenario:      isWorld,
            difficulty:             sc.difficulty || null,
        });
        seenIds.add(sid);
    }

    // ── World (multi-care-circle) scenarios ───────────────────────────────────
    for (const [key, wsc] of Object.entries(WORLD_SCENARIOS_DEFINITIONS || {})) {
        const sid = `world_${key}`;
        if (seenIds.has(sid) || !wsc.users) continue;
        scenarios.push({
            scenario_id:            sid,
            therapeutic_mode:       normalisePythonMode(wsc.therapeutic_mode || 'world'),
            domain:                 wsc.category         || 'world',
            deaddiction_phase:      'contemplation',
            session_goal:           wsc.description      || wsc.name || key,
            agent_instruction:      '',
            max_turns:              wsc.turns || wsc.max_turns || 30,
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

    // ── No-sensor variants ────────────────────────────────────────────────────
    // Three physio_source tiers:
    //   "sensor"    — real wearable / authored physio (original scenario)
    //   "simulated" — algorithmically generated from scenario narrative (original,
    //                 where _physioFromPersona sampled from distributions)
    //   "none"      — _no_sensor clone: no wearable, Arm1 degrades to actor-only,
    //                 Arm3 omits numeric physio from prompt (stress bucket only)
    const withSensorVariants = [...scenarios];
    for (const sc of withSensorVariants) {
        const noSensorId = `${sc.scenario_id}_no_sensor`;
        if (seenIds.has(noSensorId)) continue;
        scenarios.push({
            ...sc,
            scenario_id:    noSensorId,
            initial_physio: null,         // sampled by PhysioSimulator at runtime
            physio_source:  'none',       // canonical three-value enum
        });
        seenIds.add(noSensorId);
    }

    return scenarios;
}

// ── Physiological profile sampler ────────────────────────────────────────────
// Role-aware stochastic sampler matching tensornets/a3c/physio_simulator.py.
// Distributions grounded in published HRV/EDA literature (Task Force 1996;
// Shaffer & Ginsberg 2017).  Uses Box-Muller for Normal and a simple Gamma
// approximation via the Marsaglia fast-gamma method (no deps required).

function _randNormal(mu = 0, sigma = 1) {
    // Box-Muller transform
    const u1 = Math.random() || 1e-12;
    const u2 = Math.random() || 1e-12;
    return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function _randGamma(shape, scale) {
    // Marsaglia-Tsang fast-gamma via Normal approximation for shape >= 1.
    // For shape < 1 we use the Ahrens-Dieter boost: Gamma(k) = Gamma(k+1) * U^(1/k)
    if (shape <= 0 || scale <= 0) return 0;
    const k = shape < 1 ? shape + 1 : shape;
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    let x, v;
    for (;;) {
        do { x = _randNormal(); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * (x * x) * (x * x)) break;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) break;
    }
    const sample = d * v * scale;
    return shape < 1 ? sample * Math.pow(Math.random(), 1 / shape) : sample;
}
function _randLogNormal(muLog, sigmaLog) {
    return Math.exp(_randNormal(muLog, sigmaLog));
}
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const _HRV_LOGNORMAL = {
    patient:   [3.35, 0.40],   // median ~28 ms
    caregiver: [3.50, 0.38],   // median ~33 ms
    clinician: [3.80, 0.30],   // median ~45 ms
    doctor:    [3.80, 0.30],
    family:    [3.55, 0.40],
    relative:  [3.55, 0.40],
    agent:     [3.80, 0.25],
    unknown:   [3.60, 0.40],
};
const _HRV_SCENARIO_SHIFT = {
    standard: 0, crisis: -12, escalation: -10, hospital: -5,
    deaddiction: -4, bereavement: -8, oncology: -6, chronic: -5,
    mental_health: -5, ethical: -2, privacy: -1,
};
const _EDA_GAMMA = {
    patient:   [2.0, 1.8], caregiver: [2.0, 1.5], clinician: [1.5, 1.2],
    doctor:    [1.5, 1.2], family:    [1.8, 1.5], relative:  [1.8, 1.5],
    agent:     [1.2, 1.0], unknown:   [1.8, 1.6],
};
const _EDA_SC_MULT = {
    standard: 1.0, crisis: 2.5, escalation: 2.0, hospital: 1.5,
    deaddiction: 1.3, bereavement: 1.8, oncology: 1.5, chronic: 1.3,
    mental_health: 1.4, ethical: 1.1, privacy: 1.1,
};
const _SLEEP_GAMMA = {
    patient:   [1.5, 1.2], caregiver: [2.0, 1.3], clinician: [0.8, 0.8],
    doctor:    [1.0, 0.9], family:    [1.2, 1.0], relative:  [1.2, 1.0],
    agent:     [0.0, 0.0], unknown:   [1.0, 1.0],
};
const _GLUCOSE_NORMAL = {
    patient:   [96, 12], caregiver: [88, 9], clinician: [85, 8],
    doctor:    [87,  9], family:    [88, 10], relative: [88, 10],
    agent:     [90,  5], unknown:   [90, 12],
};
const _GLUCOSE_SC_SHIFT = {
    standard: 0, crisis: 8, escalation: 6, hospital: 5,
    deaddiction: 3, bereavement: 4, oncology: 10, chronic: 5,
    mental_health: 3, ethical: 0, privacy: 0,
};

function _scenarioTypeFromId(scenarioId = '') {
    const s = scenarioId.toLowerCase();
    if (/crisis|emergency|overdose|suicide/.test(s)) return 'crisis';
    if (/escalat/.test(s))                           return 'escalation';
    if (/ipd|hospital|inpatient|ward/.test(s))       return 'hospital';
    if (/deaddiction|alcohol|opioid|substance/.test(s)) return 'deaddiction';
    if (/bereave|grief|loss/.test(s))               return 'bereavement';
    if (/cancer|oncol|chemotherapy|palliative/.test(s)) return 'oncology';
    if (/chronic|htn|hypertension|diabetes/.test(s))    return 'chronic';
    if (/mental|depression|anxiety|ptsd|bipolar/.test(s)) return 'mental_health';
    if (/ethics|ethical|consent|autonomy/.test(s))  return 'ethical';
    if (/privacy|disclosure|confidential/.test(s))  return 'privacy';
    return 'standard';
}

/**
 * Sample a physiological state dict for one participant.
 * Replaces hardcoded defaults with a distribution draw.
 *
 * @param {string} role          - patient | caregiver | clinician | doctor | family | relative
 * @param {string} [scenarioId]  - used to infer scenario type
 * @param {object} [override]    - any explicit fields that take precedence
 */
function _samplePhysio(role = 'patient', scenarioId = '', override = {}) {
    const rk = _HRV_LOGNORMAL[role] ? role : 'unknown';
    const scType = _scenarioTypeFromId(scenarioId);

    const [muLog, sigLog] = _HRV_LOGNORMAL[rk];
    const shiftMean = _HRV_SCENARIO_SHIFT[scType] ?? 0;
    const hrv = Math.max(8, _randLogNormal(muLog, sigLog) + _randNormal(shiftMean, 3));
    const stressBase = _clamp(1 - (hrv - 10) / 60, 0.05, 0.95);
    const stressIndex = _clamp(stressBase + _randNormal(0, 0.04), 0.05, 0.95);

    const [kEda, tEda] = _EDA_GAMMA[rk];
    const edaMult = _EDA_SC_MULT[scType] ?? 1;
    const eda = Math.max(0.5, _randGamma(kEda, tEda) * edaMult + _randNormal(0, 0.5));

    const [kSl, tSl] = _SLEEP_GAMMA[rk];
    const sleepDeficit = Math.max(0, _randGamma(kSl, tSl));

    const [muG, sdG] = _GLUCOSE_NORMAL[rk];
    const gShift = (_GLUCOSE_SC_SHIFT[scType] ?? 0) + _randNormal(0, 5);
    const glucose = _clamp(_randNormal(muG + gShift, sdG), 50, 250);

    return {
        stress_index:  Math.round(_clamp(override.stress_index ?? stressIndex, 0.05, 0.95) * 1000) / 1000,
        hrv_ms:        Math.round((override.hrv_ms ?? hrv) * 10) / 10,
        eda_us:        Math.round((override.eda_us ?? eda) * 100) / 100,
        sleep_deficit: Math.round((override.sleep_deficit ?? sleepDeficit) * 10) / 10,
        glucose_mg_dl: Math.round((override.glucose_mg_dl ?? glucose) * 10) / 10,
    };
}

function _physioFromPersona(persona, override, scenarioId = '') {
    const physio  = persona.physiological_profile || {};
    const initial = override.initial_physio || {};

    // If the persona or override supplies explicit values, honour them;
    // otherwise draw from role-appropriate distributions.
    // The persona role is inferred from its category field if present.
    const role = persona.role || persona.category || 'patient';
    const sampled = _samplePhysio(role, scenarioId, initial);

    // Persona-level baseline overrides the sample if present (allows authored personas
    // to anchor a specific HRV without losing variability on the other dimensions).
    const hrv = initial.hrv_ms ?? physio.hrv_baseline_ms ?? sampled.hrv_ms;
    const stressIndex = initial.stress_index
        ?? (physio.hrv_baseline_ms
            ? _clamp(1 - (physio.hrv_baseline_ms - 10) / 60, 0.05, 0.95)
            : sampled.stress_index);

    // physio_source: "sensor" when explicit values were authored in the persona/scenario;
    // "simulated" when values were drawn from persona/scenario-seeded distributions;
    // "population" when drawn from pure population priors (no scenario context).
    // Production code, MCTS, and Arm3 use this to weight physio appropriately.
    // Note: conversation_stress is always tracked separately and is orthogonal to this.
    const sensorPresent = !!(
        initial.hrv_ms != null || initial.stress_index != null ||
        physio.hrv_baseline_ms != null || physio.eda_baseline_us != null
    );
    // Emit _sensor_present so Python's from_scenario() can classify correctly:
    //   true  → explicit authored values → "sensor"
    //   false → sampled from persona distributions → "simulated"

    return {
        stress_index:    Math.round(_clamp(stressIndex, 0.05, 0.95) * 1000) / 1000,
        hrv_ms:          Math.round(hrv * 10) / 10,
        eda_us:          Math.round((initial.eda_us ?? physio.eda_baseline_us ?? sampled.eda_us) * 100) / 100,
        sleep_deficit:   Math.round((initial.sleep_deficit ?? physio.sleep_deficit_rolling ?? sampled.sleep_deficit) * 10) / 10,
        glucose_mg_dl:   Math.round((initial.glucose_mg_dl ?? sampled.glucose_mg_dl) * 10) / 10,
        _sensor_present: sensorPresent,
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
