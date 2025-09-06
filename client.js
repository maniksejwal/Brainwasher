import readline from 'readline';
import { EOL } from 'os';
import chalk from 'chalk';

const ORCHESTRATOR_URL = "http://127.0.0.1:5000";
let userId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function registerUser(role) {
  userId = role;
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch (e) {
    console.error(chalk.red("Error: Could not connect to the orchestrator. Is it running?"));
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
        // Clear previous lines and print new messages
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        
        messages.forEach(msg => {
            if (msg.startsWith('[System Alert]')) {
                console.log(chalk.yellow.bold(msg)); // Yellow for alerts
            } else if (msg.startsWith('[personal-agent says]')) {
                console.log(chalk.cyan(msg)); // Cyan for AI replies
            } else {
                console.log(chalk.green(msg)); // Green for other user messages
            }
        });

        rl.prompt(true); // Re-display the prompt
      }
    }
  } catch (e) {
    // Silently fail if server is down, to avoid spamming console
  }
}

async function handleCommand(input) {
    const parts = input.split(' ');
    const command = parts[0];

    if (command === 'consent' && userId === 'patient') {
        const [, caregiverId, relationshipType, consentLevel] = parts;
        if (!caregiverId || !relationshipType || !consentLevel) {
            console.log(chalk.yellow("Usage: consent <caregiver_id> <relationship_type> <consent_level>"));
            console.log(chalk.yellow("Example: consent caregiver1 spouse full"));
            return;
        }
        try {
            await fetch(`${ORCHESTRATOR_URL}/consent/set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patientId: userId, caregiverId, relationshipType, consentLevel }),
            });
            console.log(chalk.blue(`Consent set for ${caregiverId}.`));
        } catch (e) {
            console.error(chalk.red("Error setting consent."));
        }
    } else {
        await sendMessage(input);
    }
}


async function sendMessage(message) {
  if (!userId || !message) return;
  try {
    await fetch(`${ORCHESTRATOR_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message }),
    });
  } catch (e) {
    console.error(chalk.red("\nError: Could not send message. Is the orchestrator running?"));
  }
}

// --- Main Execution ---
console.log(chalk.blue("--- Care Circle CLI Client ---"));
rl.question("Enter your role (patient/caregiver): ", async (role) => {
  if (role !== 'patient' && role !== 'caregiver') {
    console.log(chalk.red("Invalid role. Please enter 'patient' or 'caregiver'."));
    rl.close();
    return;
  }

  const registered = await registerUser(role);
  if (registered) {
    console.log(chalk.blue(`You are logged in as: ${role}. You can start typing messages.`));
    if (role === 'patient') {
        console.log(chalk.blue(`To set permissions, use: consent <caregiver_id> <type> <level>`));
    }
    rl.setPrompt(chalk.bold(`${role}> `));
    rl.prompt();

    // Fetch messages every 3 seconds
    setInterval(fetchMessages, 3000);

    rl.on('line', (line) => {
      handleCommand(line.trim()); // Use handleCommand instead of sendMessage directly
      rl.prompt();
    }).on('close', () => {
      console.log('Exiting client.');
      process.exit(0);
    });
  } else {
    rl.close();
  }
});

