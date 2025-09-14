// This file is the central event emitter and dispatcher.
import { EventEmitter } from 'events';
// FIX: Update import path to the new db package index
import { clearDatabase } from './db/index.js';

// Import the new handlers
import { handleLogin } from './handlers/loginHandler.js';
import { handleCommand } from './handlers/commandHandler.js';
import { handleMessage } from './handlers/messageHandler.js';

// The orchestrator's main job is to provide a central event bus.
export const events = new EventEmitter();

// Listen for a 'clear_db' event and call the database function.
events.on('clear_db', clearDatabase);

// Export the handlers so the server can use them.
export { handleLogin, handleCommand, handleMessage };

