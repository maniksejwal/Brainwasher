/**
 * @fileoverview db/index.js
 * This file serves as the central public interface for the database module.
 * It consolidates and re-exports all the query functions from the specialized
 * query files (e.g., queries_users.js, queries_actions.js). This allows other
 * modules in the application to import all database functions from a single,
 * consistent location, simplifying dependency management and abstracting the
 * internal structure of the database package.
 */

import { getDb, setGlobalDb } from './connection.js';
import { initializeDatabase, clearDatabase, addConversationIntelligenceTables, addDialogGraphSchemaTables } from './schema.js';
import {
    findUserByUsername,
    findUserById,
    findCircleByPatientId,
    findCircleById,
    findCircleByPatientUsername,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
    updateMemberRelationship,
    updateMemberRole,
    getUserState,
    findMemberInSharedCircles
} from './queries_users.js';
import {
    addMessage,
    getRecentMessages,
    upsertFact,
    getLastFact,
    getFactHistory,
    getTotalUnreadMessageCount,
    markCircleRead,
    getEnhancedConversationHistory,
    getFactsByCategory
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
    findPendingAction,
    removePendingAction
} from './queries_actions.js';
import {
    createFuturePlan,
    getPendingFuturePlans,
    executeFuturePlan,
    cancelFuturePlan,
    rescheduleFuturePlan,
    createScheduledMessage,
    getPendingScheduledMessages,
    markScheduledMessageSent,
    cancelScheduledMessage,
    rescheduleScheduledMessage
} from './queries_future_plans.js';
import {
    savePromptVersion,
    getPromptVersion,
    findPromptVersionsByName,
    getAllPromptVersions,
    getCurrentDeployedPrompt
} from './queries_prompts.js';
import {
    logApiUsage,
    getApiUsageStats
} from './queries_usage.js';
import {
    getUserNotificationPreferences,
    setNotificationPreference,
    isNotificationEnabled,
    logNotification,
    getNotificationHistory
} from './queries_notifications.js';
import {
    listDialogGraphs,
    getDialogGraph,
    upsertDialogGraph,
    getDialogGraphRuns,
    getRunPath,
    compareRunPaths,
    importSimulationRunToGraph,
    createDialogGraphRun,
    appendRunStep,
    finalizeDialogGraphRun,
} from './queries_dialog_graphs.js';

export {
    getDb,
    setGlobalDb,
    initializeDatabase,
    clearDatabase,
    addConversationIntelligenceTables,
    findUserByUsername,
    findUserById,
    findCircleByPatientId,
    findCircleById,
    findCircleByPatientUsername,
    addUser,
    createCareCircle,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    getUserCircles,
    updateUserState,
    updateMemberRelationship,
    updateMemberRole,
    getUserState,
    findMemberInSharedCircles,
    addMessage,
    getRecentMessages,
    upsertFact,
    getLastFact,
    getFactHistory,
    getTotalUnreadMessageCount,
    markCircleRead,
    getEnhancedConversationHistory,
    getFactsByCategory,
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
    findPendingAction,
    removePendingAction,
    createFuturePlan,
    getPendingFuturePlans,
    executeFuturePlan,
    cancelFuturePlan,
    rescheduleFuturePlan,
    createScheduledMessage,
    getPendingScheduledMessages,
    markScheduledMessageSent,
    cancelScheduledMessage,
    rescheduleScheduledMessage,
    savePromptVersion,
    getPromptVersion,
    findPromptVersionsByName,
    getAllPromptVersions,
    getCurrentDeployedPrompt,
    logApiUsage,
    getApiUsageStats,
    getUserNotificationPreferences,
    setNotificationPreference,
    isNotificationEnabled,
    logNotification,
    getNotificationHistory,
    // Dialog graphs
    listDialogGraphs,
    getDialogGraph,
    upsertDialogGraph,
    getDialogGraphRuns,
    getRunPath,
    compareRunPaths,
    importSimulationRunToGraph,
    createDialogGraphRun,
    appendRunStep,
    finalizeDialogGraphRun,
};

