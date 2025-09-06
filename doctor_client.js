import chalk from 'chalk';
import EventSource from 'eventsource';
import config from './config.js';

const ESCALATIONS_URL = `${config.ORCHESTRATOR_URL}/doctor/escalations`;

console.log(chalk.bold.cyan("--- Doctor's Escalation Client ---"));
console.log(chalk.gray("Listening for critical alerts from the orchestrator..."));

const es = new EventSource(ESCALATIONS_URL);

es.on('open', () => {
  console.log(chalk.green('Connection to orchestrator established.'));
});

es.on('message', (e) => {
  try {
    const escalations = JSON.parse(e.data);
    if (escalations && escalations.length > 0) {
      console.log(chalk.red.bold(`\n--- NEW ESCALATIONS RECEIVED ---`));
      escalations.forEach(item => {
        const message = `[${new Date(item.timestamp).toLocaleString()}] ${item.type}: ${item.details}`;
        console.log(chalk.yellow(message));
      });
      console.log(chalk.red.bold(`------------------------------`));
    }
  } catch (error) {
    console.error(chalk.red('Error parsing escalation data:'), error);
  }
});

es.on('error', (err) => {
  if (err.status === 404) {
    console.error(chalk.red('Could not connect to the orchestrator. Is it running?'));
  } else if (err.type === 'error' && err.message === 'network error') {
     console.error(chalk.red('Network error. Retrying...'));
  }
});

