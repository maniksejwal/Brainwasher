/**
 * Centralized simulation state shared across the CLI-driven visualization flow.
 * Every run MUST call resetState() before processing any CLI output.
 */

const state = {
    runId: 0,
    networkInitialized: false,
    participantsReady: false,
    participants: [], // [{ username, persona, role }]
    personaNameToUsername: new Map(), // normalized persona/name -> username
    usernameToParticipant: new Map(), // username -> participant details
    circleMembers: new Map(), // circleId -> [username]
    circleNameToId: new Map(), // normalized name -> id
    userCircleMap: new Map(), // username -> [circleId]
    lastSpeakerByRole: {}, // role -> username
    pendingCliLines: [], // CLI lines received before participants ready
    buffers: {
        orchestrator: [],
        broadcasts: [],
        notifications: []
    },
    baselineRoster: {
        patient: new Set(),
        caregiver: new Set(),
        doctor: new Set()
    },
    provisionalParticipants: {
        patient: new Set(),
        caregiver: new Set(),
        doctor: new Set()
    },
    rosterBuffer: {
        patients: [],
        caregivers: [],
        doctors: [],
        seen: {
            patient: false,
            caregivers: false,
            doctors: false
        }
    },
    provisionalFragmentCount: 0,
    lastProvisionalUpdate: null
};

export function resetState() {
    state.runId += 1;
    state.networkInitialized = false;
    state.participantsReady = false;
    state.participants = [];
    state.personaNameToUsername.clear();
    state.usernameToParticipant.clear();
    state.circleMembers.clear();
    state.circleNameToId.clear();
    state.userCircleMap.clear();
    state.lastSpeakerByRole = {};
    state.pendingCliLines = [];
    state.buffers = {
        orchestrator: [],
        broadcasts: [],
        notifications: []
    };
    Object.values(state.baselineRoster).forEach(set => set.clear());
    Object.values(state.provisionalParticipants).forEach(set => set.clear());
    resetRosterBuffer();
    state.provisionalFragmentCount = 0;
    state.lastProvisionalUpdate = null;
}

export function getState() {
    return state;
}

export function setNetworkInitialized(value) {
    state.networkInitialized = Boolean(value);
}

export function isNetworkInitialized() {
    return state.networkInitialized;
}

export function setParticipants(participants) {
    state.participantsReady = true;
    state.participants = participants.slice();
    Object.values(state.baselineRoster).forEach(set => set.clear());
    participants.forEach(participant => {
        if (!participant?.role) return;
        const rosterSet = state.baselineRoster[participant.role];
        if (!rosterSet) return;
        const label = participant.displayName || participant.persona || participant.username;
        if (label) {
            rosterSet.add(label);
        }
    });
    Object.values(state.provisionalParticipants).forEach(set => set.clear());
}

export function areParticipantsReady() {
    return state.participantsReady;
}

export function registerParticipant(participant) {
    if (!participant?.username) return;
    const username = participant.username;
    state.usernameToParticipant.set(username, participant);
    if (participant.persona) {
        const normalized = normalize(participant.persona);
        if (normalized) {
            state.personaNameToUsername.set(normalized, username);
        }
    }
    if (participant.displayName && participant.displayName !== participant.persona) {
        const normalized = normalize(participant.displayName);
        if (normalized) {
            state.personaNameToUsername.set(normalized, username);
        }
    }
    if (participant.aliases && Array.isArray(participant.aliases)) {
        participant.aliases.forEach(alias => {
            const normalized = normalize(alias);
            if (normalized) {
                state.personaNameToUsername.set(normalized, username);
            }
        });
    }
    if (participant.role) {
        state.lastSpeakerByRole[participant.role] = username;
    }
}

export function recordCircleMembership(circleId, circleName, members) {
    if (!circleId) return;
    state.circleMembers.set(circleId, members.slice());
    if (circleName) {
        state.circleNameToId.set(normalize(circleName), circleId);
    }
    members.forEach(username => {
        const list = state.userCircleMap.get(username) || [];
        if (!list.includes(circleId)) {
            list.push(circleId);
        }
        state.userCircleMap.set(username, list);
    });
}

export function resolveUsernameByPersona(name) {
    if (!name) return null;
    return state.personaNameToUsername.get(normalize(name)) || null;
}

export function resolveCircleId(value) {
    if (!value) return null;
    const normalized = normalize(value);
    return state.circleNameToId.get(normalized) || null;
}

export function setLastSpeaker(role, username) {
    if (!role || !username) return;
    state.lastSpeakerByRole[role] = username;
}

export function getLastSpeaker(role) {
    return state.lastSpeakerByRole[role] || null;
}

export function enqueuePendingLine(line) {
    if (line) {
        state.pendingCliLines.push(line);
    }
}

export function flushPendingLines() {
    const lines = state.pendingCliLines.slice();
    state.pendingCliLines.length = 0;
    return lines;
}

export function normalize(value = '') {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function addProvisionalParticipant(role, name) {
    if (!role || !name) return false;
    const set = state.provisionalParticipants[role];
    if (!set) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    const normalizedKey = normalize(trimmed);
    if (!normalizedKey) return false;
    for (const existing of set.values()) {
        if (normalize(existing) === normalizedKey) {
            return false;
        }
    }
    set.add(trimmed);
    return true;
}

export function incrementProvisionalFragmentCount() {
    state.provisionalFragmentCount += 1;
    state.lastProvisionalUpdate = Date.now();
}

export function getProvisionalFragmentCount() {
    return state.provisionalFragmentCount;
}

export function getProvisionalTotals() {
    return {
        patients: state.provisionalParticipants.patient.size,
        caregivers: state.provisionalParticipants.caregiver.size,
        doctors: state.provisionalParticipants.doctor.size
    };
}

export function getProvisionalRoster() {
    const combine = (role) => {
        const merged = new Set();
        const baseline = state.baselineRoster[role];
        const provisional = state.provisionalParticipants[role];
        if (baseline) {
            baseline.forEach(value => merged.add(value));
        }
        if (provisional) {
            provisional.forEach(value => merged.add(value));
        }
        return Array.from(merged);
    };

    return {
        patients: combine('patient'),
        caregivers: combine('caregiver'),
        doctors: combine('doctor')
    };
}

export function hasProvisionalParticipants() {
    return state.provisionalParticipants.patient.size > 0 ||
        state.provisionalParticipants.caregiver.size > 0 ||
        state.provisionalParticipants.doctor.size > 0;
}

export function clearProvisionalParticipants() {
    Object.values(state.provisionalParticipants).forEach(set => set.clear());
    state.provisionalFragmentCount = 0;
    state.lastProvisionalUpdate = null;
}

export function resetRosterBuffer() {
    state.rosterBuffer = {
        patients: [],
        caregivers: [],
        doctors: [],
        seen: {
            patient: false,
            caregivers: false,
            doctors: false
        }
    };
}

export function markRosterSection(section, names = []) {
    if (!section || !(section in state.rosterBuffer.seen)) return;
    state.rosterBuffer.seen[section] = true;
    if (Array.isArray(names) && names.length) {
        state.rosterBuffer[`${section === 'patient' ? 'patients' : section}`] = Array.from(new Set(names));
    }
}

export function updateRosterSection(section, names = []) {
    if (!section || !(section in state.rosterBuffer.seen)) return;
    const key = section === 'patient' ? 'patients' : section;
    const target = state.rosterBuffer[key];
    if (!Array.isArray(names)) return;
    names.forEach(name => {
        if (name && !target.includes(name)) {
            target.push(name);
        }
    });
    state.rosterBuffer.seen[section] = true;
}

export function getRosterSnapshot() {
    return {
        patients: state.rosterBuffer.patients.slice(),
        caregivers: state.rosterBuffer.caregivers.slice(),
        doctors: state.rosterBuffer.doctors.slice(),
        seen: { ...state.rosterBuffer.seen }
    };
}

export function isRosterComplete() {
    const seen = state.rosterBuffer.seen;
    return Boolean(seen.patient && seen.caregivers && seen.doctors);
}

export function hasRosterSeed() {
    const seen = state.rosterBuffer.seen;
    return seen.patient || seen.caregivers || seen.doctors;
}

export function consumeRosterBuffer() {
    const snapshot = getRosterSnapshot();
    resetRosterBuffer();
    return snapshot;
}


