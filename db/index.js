/**
 * @fileoverview This file serves as the central public interface for the database module.
 * It consolidates and re-exports all the query functions from the specialized
 * query files. This allows other modules in the application to import all database
 * functions from a single, consistent location, simplifying dependency management.
 */

import { initializeDatabase, clearDatabase } from './schema.js';
import {
    findUserByUsername,
    findUserById, // FIX: Added the missing function to the import list
    findCircleByPatientId,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
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
    getUnreadEscalations,
    updateMemberConsent,
    addImpliedConsent,
    getImpliedConsent,
    addPendingAction,
    getPendingAction,
    removePendingAction
} from './queries_actions.js';

export {
    initializeDatabase,
    clearDatabase,
    findUserByUsername,
    findUserById, // FIX: Added the missing function to the export list
    findCircleByPatientId,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
    getUserState,
    addMessage,
    getRecentMessages,
    upsertFact,
    getLastFact,
    getFactHistory,
    addEscalation,
    getUnreadEscalations,
    updateMemberConsent,
    addImpliedConsent,
    getImpliedConsent,
    addPendingAction,
    getPendingAction,
    removePendingAction
};

