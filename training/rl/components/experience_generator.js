/**
 * @fileoverview Component for generating baseline experience (simulations)
 */

export class ExperienceGenerator {
    /**
     * Generate baseline experience by running simulations with current system
     */
    async generateExperience(count) {
        console.log(`[ExperienceGenerator] Generating ${count} experiences (simulations)...`);

        // Import dependencies locally to avoid circular refs if any
        const { getScenarios } = await import('../../simulation/scenarios.js');
        const { SimulationDriver } = await import('../../simulation/simulator.js');

        // Select random scenarios
        const allScenarioMap = getScenarios({ includeGenerated: true });
        const allScenarios = Object.keys(allScenarioMap);
        const selectedScenarios = [];

        for (let i = 0; i < count; i++) {
            const random = allScenarios[Math.floor(Math.random() * allScenarios.length)];
            selectedScenarios.push(random);
        }

        // Run simulations in batches
        const originalSimMode = process.env.SIMULATION_MODE;
        process.env.SIMULATION_MODE = 'true';

        let completed = 0;
        const batchSize = 5; // Default batch size

        // Helper for splitting array into chunks
        const chunks = [];
        for (let i = 0; i < selectedScenarios.length; i += batchSize) {
            chunks.push(selectedScenarios.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
            console.log(`[ExperienceGenerator] ⏳ Processing Batch ${(chunks.indexOf(chunk) + 1)}/${chunks.length} (Scenarios: ${chunk.length})...`);

            await Promise.all(chunk.map(async (scenario) => {
                try {
                    const driver = new SimulationDriver();
                    const { config } = await this._getScenarioConfig(scenario);

                    await driver.runScenario(config, scenario);
                    completed++;

                    const percent = Math.round((completed / count) * 100);
                    process.stdout.write(`\r[ExperienceGenerator] Progress: ${completed}/${count} (${percent}%)  Last: ${scenario.substring(0, 30)}...`);

                    // Explicitly log this as a training update to ensure DB reflects it immediately
                    if (driver.simulationId) {
                        // console.log(`[ExperienceGenerator] Experience generated: ${scenario} (ID: ${driver.simulationId})`);
                    }

                    if (driver.cleanup) await driver.cleanup();
                } catch (error) {
                    console.warn(`[ExperienceGenerator] Failed to generate experience for ${scenario}:`, error.message);
                }
            }));
        }

        if (originalSimMode !== undefined) process.env.SIMULATION_MODE = originalSimMode;
        else delete process.env.SIMULATION_MODE;

        console.log(`[ExperienceGenerator] Experience generation complete: ${completed}/${count} successful`);
    }

    /**
     * Helper to get scenario config
     */
    async _getScenarioConfig(scenarioName) {
        const { getScenarios } = await import('../../simulation/scenarios.js');
        const scenarios = getScenarios({ includeGenerated: true });
        return { config: scenarios[scenarioName], isWorld: false };
    }
}
