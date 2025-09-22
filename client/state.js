/**
 * @fileoverview Manages the client-side state.
 * This module acts as a single source of truth for the client's current
 * user information and active care circle context.
 */

export const state = {
    userId: '',
    username: '',
    currentCircleId: '',
    userRoleInCurrentCircle: '',
    currentPatientUsername: ''
};

export function updateUserState(newState) {
    Object.assign(state, newState);
}
