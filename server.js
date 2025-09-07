import express from 'express';
import chalk from 'chalk';
import { initializeDatabase } from './database.js';
import { handleNewConnection, handleSendMessage, handleClearAll } from './orchestrator.js';

const app = express();
app.use(express.json());

// API endpoint for clients to establish a real-time connection
app.get('/events/:userId', handleNewConnection);

// API endpoint for clients to send messages
app.post('/send', handleSendMessage);

// API endpoint for testing to clear the database
app.post('/clear-all', handleClearAll);

const PORT = 5000;
app.listen(PORT, async () => {
    await initializeDatabase();
    console.log(chalk.green.bold('--- Multi-Agent System is RUNNING ---'));
    console.log(chalk.cyan('This terminal is the main server log.'));
    console.log(`Listening on http://127.0.0.1:${PORT}`);
    console.log(chalk.yellow('---------------------------------------------'));
});
