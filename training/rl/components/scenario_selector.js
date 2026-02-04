/**
 * @fileoverview Component for selecting mixed scenarios (Targeted + Random)
 */

export class ScenarioSelector {
    constructor(mixModeRatio = { targeted: 0.1, random: 0.9 }) {
        this.mixModeRatio = mixModeRatio;
    }

    /**
     * Select mixed scenarios using Mix Mode (targeted + random split)
     */
    selectMixedScenarios(allScenarios, targetTags, totalScenarios) {
        const targetedCount = Math.ceil(totalScenarios * this.mixModeRatio.targeted);
        const randomCount = totalScenarios - targetedCount;

        const result = {
            targeted: [],
            random: [],
            all: []
        };

        // Step 1: Select targeted scenarios if tags are provided
        if (targetTags.length > 0) {
            const taggedScenarios = allScenarios.filter(s => {
                const name = s.toLowerCase();
                return targetTags.some(t => name.includes(t));
            });

            if (taggedScenarios.length > 0) {
                // Randomly select from tagged scenarios
                const shuffled = [...taggedScenarios].sort(() => Math.random() - 0.5);
                result.targeted = shuffled.slice(0, Math.min(targetedCount, taggedScenarios.length));
                console.log(`[ScenarioSelector] Mix Mode: Selected ${result.targeted.length}/${targetedCount} targeted scenarios matching tags [${targetTags.join(',')}]`);
            } else {
                console.log(`[ScenarioSelector] Mix Mode: No scenarios found matching tags [${targetTags.join(',')}], using random selection`);
            }
        }

        // Step 2: Select random scenarios from the full pool (excluding already selected targeted ones)
        const availableForRandom = allScenarios.filter(s => !result.targeted.includes(s));
        const shuffledRandom = [...availableForRandom].sort(() => Math.random() - 0.5);

        // Compensate if targeted count wasn't met
        const additionalNeeded = totalScenarios - result.targeted.length;
        result.random = shuffledRandom.slice(0, additionalNeeded);

        console.log(`[ScenarioSelector] Mix Mode: Selected ${result.random.length} random scenarios for general coverage`);

        // Step 3: Combine both sets
        result.all = [...result.targeted, ...result.random];

        return result;
    }
}
