/**
 * @fileoverview client/state.js
 * Manages the client-side state. This module acts as a single source of truth
 * for the client's current user information, active care circle context, and
 * a complete list of the user's roles across all circles.
 */

export const state = {
    userId: '',
    username: '',
    currentCircleId: '',
    userRoleInCurrentCircle: '',
    currentPatientUsername: '',
    allRoles: [] // NEW: Store all roles for the user.
};

export function updateUserState(newState) {
    Object.assign(state, newState);
}

