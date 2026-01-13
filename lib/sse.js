/**
 * @fileoverview SSE (Server-Sent Events) Manager
 * Handles real-time client connections and broadcasting.
 */

const clients = {};

export function addClient(userId, res) {
    clients[userId] = res;
    console.log(`[SSE] Client connected: ${userId}`);
}

export function removeClient(userId) {
    if (clients[userId]) {
        delete clients[userId];
        console.log(`[SSE] Client disconnected: ${userId}`);
    }
}

export function getClient(userId) {
    return clients[userId];
}

/**
 * Broadcast message to specific users
 */
export function broadcast(targetUsers = [], data) {
    if (!Array.isArray(targetUsers) || targetUsers.length === 0) {
        console.warn('[SSE] broadcast invoked with no target users.');
        return;
    }

    targetUsers.forEach(userId => {
        if (clients[userId]) {
            clients[userId].write(`data: ${JSON.stringify(data)}\n\n`);
        }
    });
}

/**
 * Broadcast message to ALL connected clients
 */
export function broadcastToAll(data) {
    Object.keys(clients).forEach(clientId => {
        clients[clientId].write(`data: ${JSON.stringify(data)}\n\n`);
    });
}
