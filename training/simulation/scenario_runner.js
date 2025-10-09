/**
 * @fileoverview training/scenario_runner.js
 * Batch runner for executing multiple simulation scenarios.
 * Reads from scenarios/ directory and generates comprehensive training data.
 */

import { SimulationDriver } from './simulator.js';
import { listPersonas } from './personas.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ScenarioRunner {
    constructor(options = {}) {
        this.scenariosDir = options.scenariosDir || path.join(__dirname, '../../scenarios');
        this.runsPerScenario = options.runsPerScenario || 3;
        this.results = [];
    }

    /**
     * Parse scenario markdown files to extract test cases
     */
    async parseScenarioFile(filePath) {
        const content = await fs.readFile(filePath, 'utf8');
        const fileName = path.basename(filePath);
        
        // Basic scenario template from filename
        return {
            name: fileName.replace('.md', '').replace(/_/g, ' '),
            sourceFile: fileName,
            description: content.substring(0, 200)
        };
    }

    /**
     * Generate scenario configurations from scenario files
     */
    async generateScenarioConfigs() {
        const files = await fs.readdir(this.scenariosDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));

        const scenarios = [];

        for (const file of mdFiles) {
            const filePath = path.join(this.scenariosDir, file);
            const scenarioMeta = await this.parseScenarioFile(filePath);

            // Generate variations with different personas
            if (file.includes('basic')) {
                scenarios.push(...this._generateBasicScenarios(scenarioMeta));
            } else if (file.includes('conflict')) {
                scenarios.push(...this._generateConflictScenarios(scenarioMeta));
            } else if (file.includes('consent')) {
                scenarios.push(...this._generateConsentScenarios(scenarioMeta));
            } else if (file.includes('reciprocal')) {
                scenarios.push(...this._generateReciprocalScenarios(scenarioMeta));
            }
        }

        return scenarios;
    }

    /**
     * Generate basic interaction scenarios
     */
    _generateBasicScenarios(meta) {
        return [
            {
                name: `${meta.name} - Anxious Patient`,
                users: [
                    { userId: 'patient1', role: 'patient', personaKey: 'anxious_patient' }
                ],
                circle: { patientId: 'patient1', caregiverIds: [] },
                turns: 6
            },
            {
                name: `${meta.name} - Non-Adherent Patient`,
                users: [
                    { userId: 'patient2', role: 'patient', personaKey: 'medication_nonadherent' }
                ],
                circle: { patientId: 'patient2', caregiverIds: [] },
                turns: 6
            },
            {
                name: `${meta.name} - Denial-Prone Patient`,
                users: [
                    { userId: 'patient3', role: 'patient', personaKey: 'denial_prone' }
                ],
                circle: { patientId: 'patient3', caregiverIds: [] },
                turns: 6
            }
        ];
    }

    /**
     * Generate conflict scenarios
     */
    _generateConflictScenarios(meta) {
        return [
            {
                name: `${meta.name} - Overprotective Spouse vs Patient`,
                users: [
                    { userId: 'patient4', role: 'patient', personaKey: 'denial_prone' },
                    { userId: 'caregiver1', role: 'caregiver', personaKey: 'overprotective_spouse' }
                ],
                circle: { patientId: 'patient4', caregiverIds: ['caregiver1'] },
                turns: 8,
                adversarial: true
            },
            {
                name: `${meta.name} - Conflicted Family Member`,
                users: [
                    { userId: 'patient5', role: 'patient', personaKey: 'elderly_cognitive' },
                    { userId: 'caregiver2', role: 'caregiver', personaKey: 'conflicted_family' }
                ],
                circle: { patientId: 'patient5', caregiverIds: ['caregiver2'] },
                turns: 8,
                adversarial: true
            }
        ];
    }

    /**
     * Generate consent/privacy scenarios
     */
    _generateConsentScenarios(meta) {
        return [
            {
                name: `${meta.name} - Privacy-Conscious Patient`,
                users: [
                    { userId: 'patient6', role: 'patient', personaKey: 'anxious_patient' },
                    { userId: 'caregiver3', role: 'caregiver', personaKey: 'distant_child' }
                ],
                circle: { patientId: 'patient6', caregiverIds: ['caregiver3'] },
                turns: 6,
                privacyFocus: true
            }
        ];
    }

    /**
     * Generate reciprocal care circle scenarios
     */
    _generateReciprocalScenarios(meta) {
        return [
            {
                name: `${meta.name} - Mutual Caregiving`,
                users: [
                    { userId: 'patient7', role: 'patient', personaKey: 'elderly_cognitive' },
                    { userId: 'patient8', role: 'patient', personaKey: 'anxious_patient' }
                ],
                circle: { patientId: 'patient7', caregiverIds: [] },
                turns: 5,
                reciprocal: true
            }
        ];
    }

    /**
     * Run all scenarios
     */
    async runAll() {
        console.log('\n' + '█'.repeat(80));
        console.log('  SCENARIO BATCH RUNNER');
        console.log('█'.repeat(80) + '\n');

        const scenarioConfigs = await this.generateScenarioConfigs();
        
        console.log(`Found ${scenarioConfigs.length} scenario configurations`);
        console.log(`Running ${this.runsPerScenario} iterations per scenario`);
        console.log(`Total simulations: ${scenarioConfigs.length * this.runsPerScenario}\n`);

        let completedCount = 0;
        let totalCount = scenarioConfigs.length * this.runsPerScenario;

        for (let i = 0; i < scenarioConfigs.length; i++) {
            const config = scenarioConfigs[i];
            
            console.log(`\n[${i + 1}/${scenarioConfigs.length}] ${config.name}`);
            console.log('-'.repeat(80));

            for (let run = 0; run < this.runsPerScenario; run++) {
                console.log(`\n  Run ${run + 1}/${this.runsPerScenario}:`);
                
                const simulator = new SimulationDriver({ 
                    logResults: true,
                    maxTurns: config.turns
                });

                try {
                    const startTime = Date.now();
                    await simulator.runScenario(config);
                    const duration = Date.now() - startTime;

                    this.results.push({
                        scenario: config.name,
                        run: run + 1,
                        success: true,
                        duration,
                        timestamp: Date.now()
                    });

                    completedCount++;
                    console.log(`  ✓ Completed in ${(duration / 1000).toFixed(1)}s (${completedCount}/${totalCount})`);
                } catch (error) {
                    console.error(`  ✗ Error:`, error.message);
                    this.results.push({
                        scenario: config.name,
                        run: run + 1,
                        success: false,
                        error: error.message,
                        timestamp: Date.now()
                    });
                } finally {
                    await simulator.cleanup();
                }
            }
        }

        this._printSummary();
    }

    /**
     * Run specific scenario by name
     */
    async runScenario(scenarioName, runs = null) {
        const configs = await this.generateScenarioConfigs();
        const config = configs.find(c => c.name.toLowerCase().includes(scenarioName.toLowerCase()));

        if (!config) {
            console.error(`Scenario not found: ${scenarioName}`);
            console.log('\nAvailable scenarios:');
            configs.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}`));
            return;
        }

        const iterations = runs || this.runsPerScenario;
        console.log(`\nRunning scenario: ${config.name} (${iterations} iterations)\n`);

        for (let run = 0; run < iterations; run++) {
            console.log(`Run ${run + 1}/${iterations}:`);
            const simulator = new SimulationDriver({ logResults: true });
            
            try {
                await simulator.runScenario(config);
                console.log('✓ Complete\n');
            } catch (error) {
                console.error('✗ Error:', error.message);
            } finally {
                await simulator.cleanup();
            }
        }
    }

    /**
     * Print summary of results
     */
    _printSummary() {
        console.log('\n' + '█'.repeat(80));
        console.log('  SIMULATION SUMMARY');
        console.log('█'.repeat(80));

        const successful = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        const totalDuration = this.results.reduce((sum, r) => sum + (r.duration || 0), 0);
        const avgDuration = totalDuration / successful;

        console.log(`\nTotal simulations: ${this.results.length}`);
        console.log(`Successful: ${successful}`);
        console.log(`Failed: ${failed}`);
        console.log(`Average duration: ${(avgDuration / 1000).toFixed(1)}s`);
        console.log(`Total time: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);

        if (failed > 0) {
            console.log('\nFailed scenarios:');
            this.results
                .filter(r => !r.success)
                .forEach(r => console.log(`  - ${r.scenario} (run ${r.run}): ${r.error}`));
        }

        console.log('\n' + '█'.repeat(80) + '\n');
    }

    /**
     * List available personas
     */
    static listAvailablePersonas() {
        console.log('\n📋 Available Personas:\n');
        
        console.log('PATIENTS:');
        listPersonas('patient').forEach(p => {
            console.log(`  - ${p.key}: ${p.description}`);
        });

        console.log('\nCAREGIVERS:');
        listPersonas('caregiver').forEach(p => {
            console.log(`  - ${p.key}: ${p.description}`);
        });

        console.log('\nDOCTORS:');
        listPersonas('doctor').forEach(p => {
            console.log(`  - ${p.key}: ${p.description}`);
        });
        
        console.log('');
    }
}

/**
 * CLI interface
 */
async function main() {
    const args = process.argv.slice(2);

    // Show personas
    if (args.includes('--personas')) {
        ScenarioRunner.listAvailablePersonas();
        return;
    }

    // Parse options
    const runsPerScenario = (() => {
        const idx = args.indexOf('--runs');
        return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 3;
    })();

    const scenarioName = (() => {
        const idx = args.indexOf('--scenario');
        return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    })();

    const runner = new ScenarioRunner({ runsPerScenario });

    if (scenarioName) {
        await runner.runScenario(scenarioName);
    } else {
        await runner.runAll();
    }
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || 
    process.argv[1].includes('scenario_runner')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { ScenarioRunner };

