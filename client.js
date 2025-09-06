
import readline from 'readline';
import { EOL } from 'os';

// NOTE: The complex dynamic import for node-fetch has been removed.
// We are now using the native `fetch` available in modern Node.js (v18+).

const ORCHESTRATOR_URL = "http://127.0.0.1:5000";
let userId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function registerUser(role) {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: role })
    });
    if (response.ok) {
      userId = role;
      console.log(`Successfully registered as '${userId}'. You can start typing messages.`);
      return true;
    } else {
      console.log(`Error registering: ${await response.text()}`);
      return false;
    }
  } catch (e) {
    console.error("Error: Could not connect to the orchestrator. Is it running?");
    return false;
  }
}

async function fetchMessages() {
  if (!userId) return;
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/fetch?userId=${userId}`);
    if (response.ok) {
      const { messages } = await response.json();
      if (messages.length > 0) {
        // Erase current line, print messages, then redraw prompt
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        messages.forEach(msg => console.log(msg));
        rl.prompt(true);
      }
    }
  } catch (e) {
    // Silently fail if server is down, to avoid spamming console
  }
}

async function sendMessage(message) {
  if (!message.trim()) return;
  try {
    await fetch(`${ORCHESTRATOR_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message })
    });
  } catch (e) {
    console.error("\nError: Could not send message. Is the orchestrator running?");
  }
}

// --- Main Execution ---
console.log("--- Multi-Agent CLI Client (JS) ---");

rl.question("Enter your role (patient/caregiver): ", async (role) => {
  role = role.toLowerCase().trim();
  if (role !== 'patient' && role !== 'caregiver') {
    console.log("Invalid role. Please enter 'patient' or 'caregiver'.");
    rl.close();
    return;
  }

  if (await registerUser(role)) {
    rl.setPrompt(`You (${userId})> `);
    rl.prompt();

    rl.on('line', (line) => {
      sendMessage(line);
      rl.prompt();
    }).on('close', () => {
      console.log('Exiting client...');
      process.exit(0);
    });

    // Start polling for messages
    setInterval(fetchMessages, 2000);
  } else {
    rl.close();
  }
});

