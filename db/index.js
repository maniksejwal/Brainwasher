/**
 * @fileoverview db/index.js
 * This file serves as the central public interface for the database module.
 * It consolidates and re-exports all the query functions from the specialized
 * query files. This allows other modules in the application to import all database
 * functions from a single, consistent location, simplifying dependency management.
 */

import { initializeDatabase, clearDatabase } from './schema.js';
import {
    findUserByUsername,
    findUserById,
    findCircleByPatientId,
    findCircleByPatientUsername,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
    updateMemberRelationship,
    updateMemberRole, // NEW
    getUserState
} from './queries_users.js';
import {
    addMessage,
    getRecentMessages,
    upsertFact,
    getLastFact,
    getFactHistory
} from './queries_messages.js';
import {
    addEscalation,
    getUnreadEscalationsForCircle,
    getUnreadEscalationsForUser,
    markCircleEscalationsAsRead,
    addDirective,
    updateMemberConsent,
    addImpliedConsent,
    getImpliedConsent,
    addPendingAction,
    getActivePendingActions,
    getPendingAction,
    removePendingAction
} from './queries_actions.js';

export {
    initializeDatabase,
    clearDatabase,
    findUserByUsername,
    findUserById,
    findCircleByPatientId,
    findCircleByPatientUsername,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
    updateMemberRelationship,
    updateMemberRole, // NEW
    getUserState,
    addMessage,
    getRecentMessages,
    upsertFact,
    getLastFact,
    getFactHistory,
    addEscalation,
    getUnreadEscalationsForCircle,
    getUnreadEscalationsForUser,
    markCircleEscalationsAsRead,
    addDirective,
    updateMemberConsent,
    addImpliedConsent,
    getImpliedConsent,
    addPendingAction,
    getActivePendingActions,
    getPendingAction,
    removePendingAction
};

