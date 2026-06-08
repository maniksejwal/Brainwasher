import express from 'express';
import { findUserById, getUserCircles, getCircleMembers } from '../db/index.js';

const router = express.Router();

// Get Circle Members
router.get('/circle/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Get user's circles
        const circles = await getUserCircles(userId);

        if (!circles || circles.length === 0) {
            return res.json({ members: [], circleId: null });
        }

        // Get the primary circle (where user is patient)
        const primaryCircle = circles.find(c => c.circle_id === userId) || circles[0];

        // Get members of that circle
        const members = await getCircleMembers(primaryCircle.circle_id);

        res.json({
            members: members || [],
            circleId: primaryCircle.circle_id,
            patientUsername: primaryCircle.patient_username
        });
    } catch (error) {
        console.error('[API] Circle API error:', error);
        res.status(500).json({ error: error.message, members: [] });
    }
});

// Get User
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await findUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (error) {
        console.error('[API] User API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get My Circles
router.get('/mycircles/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const circles = await getUserCircles(userId);
        res.json({ circles });
    } catch (error) {
        console.error('[API] MyCircles API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Patients for Doctor
router.get('/patients/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const allCircles = await getUserCircles(userId);
        const doctorCircles = allCircles.filter(circle => circle.role === 'doctor');
        res.json({ patients: doctorCircles });
    } catch (error) {
        console.error('[API] Patients API error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;

// ── Wearable HRV push endpoint ────────────────────────────────────────────────
// Galaxy Watch app (Wear OS) or any BLE bridge POSTs here to push HRV readings.
// The latest reading per device is cached in memory for 60 seconds.
// FastAPI and Python workers can also query GET /api/wearable/hrv/:deviceId.
//
// If no wearable is active, GET returns { source: 'simulated', hrv_rmssd_ms: null }
// so the caller knows to fall back to the simulator.

const _wearableCache = new Map();  // deviceId → { hrv_rmssd_ms, ts, device_name, source }
const WEARABLE_STALE_MS = 60_000;  // readings older than 60s are considered stale

// POST /api/wearable/hrv  — receive push from wearable companion app
router.post('/wearable/hrv', (req, res) => {
    const { device_id, device_name, hrv_rmssd_ms, heart_rate, rr_intervals, user_id } = req.body;
    if (!device_id || hrv_rmssd_ms == null) {
        return res.status(400).json({ error: 'device_id and hrv_rmssd_ms are required' });
    }
    const record = {
        device_id,
        device_name:  device_name   || 'unknown',
        hrv_rmssd_ms: +hrv_rmssd_ms,
        heart_rate:   heart_rate    ?? null,
        rr_intervals: rr_intervals  ?? [],
        user_id:      user_id       || null,
        source:       'ble',
        ts:           Date.now(),
    };
    _wearableCache.set(device_id, record);
    res.json({ ok: true, received: record });
});

// GET /api/wearable/hrv/:deviceId  — read latest HRV for a device
router.get('/wearable/hrv/:deviceId', (req, res) => {
    const record = _wearableCache.get(req.params.deviceId);
    if (!record) {
        return res.json({ source: 'none', hrv_rmssd_ms: null, stale: true });
    }
    const stale = (Date.now() - record.ts) > WEARABLE_STALE_MS;
    res.json({ ...record, stale });
});

// GET /api/wearable/hrv  — list all active wearable devices
router.get('/wearable/hrv', (req, res) => {
    const now     = Date.now();
    const devices = [..._wearableCache.values()].map(r => ({
        ...r,
        stale: (now - r.ts) > WEARABLE_STALE_MS,
    }));
    res.json({ devices, count: devices.length });
});
