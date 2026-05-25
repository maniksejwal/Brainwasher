import express from 'express';
import { handleLogin, handleCommand, handleMessage } from '../orchestrator.js';
import { getUnreadEscalationsForUser, getAllPromptVersions } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { broadcast } from '../lib/sse.js';
import {
    THERAPY_PERSONAS,
    THERAPY_SCENARIOS,
    PROFESSIONAL_CRITIQUE_PERSONAS,
    PROFESSIONAL_CRITIQUE_SCENARIOS,
} from '../training/simulation/personas/therapy_personas.js';
import { EDGE_CASE_PERSONAS } from '../training/simulation/personas/edge_case_personas.js';

const router = express.Router();

// ── /api/scenarios — A3C training scenario endpoint (consumed by Python tensornets) ──────────
//
// Returns canonical training scenarios merged with persona prompts so Python never
// has to know about JS persona internals.  The endpoint is intentionally server-local
// (no auth) because it is called only by the tensornets FastAPI microservice on
// localhost.  If you expose this externally, add authentication.
//
// Query params:
//   ?domain=deaddiction|flooding|negotiation|all    (default: all)
//   ?id=<scenario_id>                               (single scenario lookup)
//
// Response shape per scenario:
//   {
//     scenario_id       : string,
//     therapeutic_mode  : 'standard'|'flooding'|'deaddiction'|'negotiation',
//     deaddiction_phase : 'precontemplation'|'contemplation'|'preparation'|'action'|'maintenance' (TTM stage)
//     session_goal      : string,
//     max_turns         : number,
//     context_window    : number,
//     archetype         : string,        // ReactivityProfile key
//     has_misconception : boolean,
//     flooding_target_stress : number,
//     initial_physio    : { stress_index, hrv_ms, eda_us, sleep_deficit },
//     patient_prompt    : string,        // full persona prompt_template
//     caregiver_prompt  : string | null,
//     doctor_prompt     : string | null,
//     required_elements : string[],      // goal-coverage elements (goal-cycling targets)
//     users             : [{ role: 'patient'|'caregiver'|'doctor' }, ...],
//     context           : string,        // additional context for scorer
//   }

router.get('/api/scenarios', (req, res) => {
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
        console.error('[/api/scenarios] Error:', error.message);
        res.status(500).json({ error: 'Failed to load scenarios' });
    }
});

function _buildCanonicalScenarios() {
    const scenarios = [];

    // ── Deaddiction scenarios ────────────────────────────────────────────────
    const therapyScenarios = THERAPY_SCENARIOS || [];
    for (const ts of therapyScenarios) {
        const personaKey = ts.personaKey || ts.persona_key;
        const persona    = THERAPY_PERSONAS[personaKey] || {};
        const phase      = ts.deaddiction_phase || ts.phase || 'precontemplation';

        scenarios.push({
            scenario_id:           ts.id || `deaddiction_${personaKey}_${phase}`,
            therapeutic_mode:      'deaddiction',
            domain:                'deaddiction',
            deaddiction_phase:     phase,
            session_goal:          ts.session_goal || `Support ${persona.name || personaKey} in ${phase} phase`,
            max_turns:             ts.max_turns || 30,
            context_window:        ts.context_window || 60,
            archetype:             ts.archetype || persona.archetype || 'standard',
            has_misconception:     ts.has_misconception ?? false,
            flooding_target_stress: ts.flooding_target_stress || 0.0,
            initial_physio:        _physioFromPersona(persona, ts),
            patient_prompt:        persona.prompt_template || persona.phase_responses?.[phase] || '',
            caregiver_prompt:      null,
            doctor_prompt:         null,
            required_elements:     ts.required_elements || _defaultGoals(phase),
            users:                 [{ role: 'patient' }],
            context:               ts.context || persona.description || '',
        });
    }

    // ── Flooding scenarios ───────────────────────────────────────────────────
    const floodingPersonas = Object.entries(THERAPY_PERSONAS)
        .filter(([, p]) => p.domain === 'flooding');
    for (const [key, persona] of floodingPersonas) {
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

    // ── Professional critique / negotiation scenarios ────────────────────────
    const critiqueScenarios = PROFESSIONAL_CRITIQUE_SCENARIOS || [];
    for (const cs of critiqueScenarios) {
        const personaKey = cs.personaKey || cs.persona_key;
        const persona    = PROFESSIONAL_CRITIQUE_PERSONAS?.[personaKey] || THERAPY_PERSONAS[personaKey] || {};
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

    // ── Edge case scenarios (care circle — multi-user) ───────────────────────
    const edgeCaseEntries = Object.entries(EDGE_CASE_PERSONAS || {})
        .filter(([, p]) => Array.isArray(p.care_circle) && p.care_circle.length > 0);
    for (const [key, persona] of edgeCaseEntries) {
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

function _physioFromPersona(persona, scenarioOverride) {
    const physio = persona.physiological_profile || {};
    const initial = scenarioOverride.initial_physio || {};
    const hrv = initial.hrv_ms ?? physio.hrv_baseline_ms ?? 35;
    // Derive stress_index from HRV: high HRV → low stress, low HRV → high stress
    // Normalise: HRV 10 → stress 0.9, HRV 70 → stress 0.1
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
    const goalsByPhase = {
        rapport:           ['establish trust', 'understand daily routine', 'identify support network'],
        ambivalence:       ['surface ambivalence', 'explore pros and cons', 'elicit change talk'],
        insight:           ['acknowledge problem', 'identify triggers', 'develop discrepancy'],
        strike:            ['commit to change', 'identify first step', 'agree on follow-up'],
        flooding_exposure: ['stay with stimulus', 'acknowledge anxiety', 'no escape', 'peak reached'],
        contemplation:     ['identify concern', 'explore options', 'validate perspective'],
    };
    return goalsByPhase[phase] || ['general support'];
}



// Get unread escalations
router.get('/doctor/escalations/unread/:userId', async (req, res) => {
    const { userId } = req.params;
    const escalations = await getUnreadEscalationsForUser(userId);
    res.status(200).json(escalations);
});

// Get prompts
router.get('/api/prompts', async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit, 10);
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100;
        const prompts = await getAllPromptVersions(safeLimit);
        res.json({ prompts });
    } catch (error) {
        console.error('[API] Error fetching prompts:', error.message);
        res.status(500).json({ error: 'Failed to load prompts' });
    }
});

// Legacy Login (Keep for backward compatibility? Or deprecated?)
// The client/network.js might still use /login. The new Client uses /api/auth/login.
// We'll keep it for now.
router.post('/login', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }
    const result = await handleLogin(username);
    res.status(200).json(result);
});

// Command
router.post('/command', (req, res) => {
    const { userId, circleId, message } = req.body;
    if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleCommand(userId, circleId, message);
    res.status(202).send();
});

// Send Message
router.post('/send', (req, res) => {
    const { userId, circleId, message } = req.body;
    if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleMessage(userId, circleId, message);
    res.status(202).send();
});

// Context Switch API - GUI buttons use this, manual commands use CLI
router.post('/api/context/switch', authenticate, async (req, res) => {
    try {
        const { circleId, circleType } = req.body;
        const userId = req.user.id;

        if (!circleId) {
            return res.status(400).json({ error: 'Missing circleId' });
        }

        // Use the existing CLI command internally - this maintains consistency
        // GUI buttons → API → CLI command → Same processing as manual commands
        const command = `/switch ${circleId}`;
        handleCommand(userId, null, command);
        
        res.status(202).json({ 
            success: true, 
            message: `Context switch initiated for ${circleType || 'circle'} ${circleId}` 
        });
        
    } catch (error) {
        console.error('[API] Context switch error:', error);
        res.status(500).json({ error: 'Failed to switch context' });
    }
});

export default router;
