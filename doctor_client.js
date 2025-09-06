import { EOL } from 'os';
import chalk from 'chalk';

const ORCHESTRATOR_URL = "http://120.0.0.1:5000";
const ROLE = 'doctor';

async function fetchEscalations() {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/fetch/doctor`);
    if (response.ok) {
      const { escalations } = await response.json();
      if (escalations.length > 0) {
        console.log(chalk.red.bold(`--- NEW ESCALATIONS RECEIVED ---`));
        escalations.forEach(item => {
            console.log(chalk.yellow(`[${new Date(item.timestamp).toLocaleString()}] ${item.content}`));
        });
         console.log(chalk.red.bold(`------------------------------${EOL}`));
      }
    }
  } catch (e) {
    // Fail silently
  }
}

// --- Main Execution ---
console.log(chalk.blue("--- Doctor's Escalation Client ---"));
console.log("Listening for critical alerts from the orchestrator...");

// Fetch escalations every 5 seconds
setInterval(fetchEscalations, 5000);
