/**
 * @fileoverview Test script for LLM-powered companion consensus analysis
 */

import CompanionConfidentialComm from '../../companions/confidential/CompanionConfidentialComm.js';

/**
 * Test the LLM-based consensus analysis with sample companion inputs
 */
async function testLLMConsensusAnalysis() {
    console.log('🧪 Testing LLM-powered companion consensus analysis...\n');

    const companionComm = new CompanionConfidentialComm();

    // Test scenario: User considering changing jobs
    const decisionContext = "I'm considering leaving my current job to start my own consulting business";

    const sampleCompanionInputs = {
        medical_companion: `**MEDICAL AND HEALTH COMPANION PERSPECTIVE:**

**Impact Assessment:** This career transition involves significant stress factors that could impact your health. Starting a business typically involves irregular schedules, financial uncertainty, and high stress levels.

**Risk Analysis:** Key health risks include increased stress leading to sleep disruption, potential for irregular eating patterns, reduced time for exercise, and possible anxiety related to financial uncertainty.

**Benefit Analysis:** Potential benefits include reduced work-related stress from toxic workplace environment, increased autonomy over schedule allowing for better work-life balance, and potential for more fulfilling work.

**Recommendation:** Support the decision with strong recommendation for stress management planning, maintaining health insurance coverage, and establishing regular health monitoring.

**Confidence Level:** 0.7

**Alternative Considerations:** Consider timing relative to any ongoing medical treatments and ensure continuity of healthcare coverage.`,

        professional_companion: `**PROFESSIONAL AND CAREER COMPANION PERSPECTIVE:**

**Impact Assessment:** This represents a significant career pivot with substantial implications for professional growth, income stability, and long-term career trajectory.

**Risk Analysis:** Major risks include income instability during startup phase, loss of employee benefits, potential damage to professional network if departure is handled poorly, and risk of business failure.

**Benefit Analysis:** Significant benefits include unlimited earning potential, professional autonomy, skill development in business management, and opportunity to leverage expertise in consulting market.

**Recommendation:** Cautiously support with strong emphasis on thorough business planning, financial cushion preparation, and gradual transition strategy if possible.

**Confidence Level:** 0.8

**Alternative Considerations:** Consider negotiating part-time consulting arrangement with current employer or gradual transition plan.`,

        social_companion: `**SOCIAL AND RELATIONSHIP COMPANION PERSPECTIVE:**

**Impact Assessment:** This decision significantly affects social dynamics, family relationships, and community connections, particularly regarding financial stability and time availability.

**Risk Analysis:** Social risks include potential strain on family relationships due to financial uncertainty, reduced social activities due to business demands, and possible isolation during intense startup phase.

**Benefit Analysis:** Benefits include potential for more flexible schedule allowing better family time, opportunity to build new professional community, and personal fulfillment from pursuing entrepreneurial goals.

**Recommendation:** Generally support the decision while emphasizing importance of maintaining social connections and family communication throughout the transition.

**Confidence Level:** 0.6

**Alternative Considerations:** Consider impact on family finances and involve spouse/family in decision-making process.`
    };

    try {
        console.log('📋 **Test Scenario:**');
        console.log(`Decision Context: "${decisionContext}"\n`);

        console.log('🤖 **Companion Inputs:**');
        Object.entries(sampleCompanionInputs).forEach(([companion, input]) => {
            console.log(`${companion}:`);
            console.log(input.substring(0, 200) + '...\n');
        });

        console.log('🔄 **Running LLM Consensus Analysis...**\n');

        const consensusResult = await companionComm.analyzeCompanionConsensus(sampleCompanionInputs, decisionContext);

        console.log('✅ **Consensus Analysis Result:**');
        console.log(JSON.stringify(consensusResult, null, 2));

        console.log('\n📊 **Analysis Summary:**');
        console.log(`- Consensus Reached: ${consensusResult.reached ? '✅ Yes' : '❌ No'}`);
        console.log(`- Confidence Level: ${(consensusResult.confidence * 100).toFixed(1)}%`);
        console.log(`- Support Count: ${consensusResult.supportCount}`);
        console.log(`- Concern Count: ${consensusResult.concernCount}`);
        console.log(`- Majority Position: ${consensusResult.majorityPosition}`);
        console.log(`- Conflicts Detected: ${consensusResult.conflictingAreas?.length > 0 ? '⚠️ Yes' : '✅ No'}`);

        if (consensusResult.nuances) {
            console.log(`- Important Nuances: ${consensusResult.nuances}`);
        }

        console.log(`\n💡 **Recommendation:**`);
        console.log(consensusResult.recommendation);

        console.log('\n🎉 **Test completed successfully!**');

    } catch (error) {
        console.error('❌ **Test failed:**', error.message);
        console.error('Stack trace:', error.stack);
        
        // Test fallback functionality
        console.log('\n🔄 **Testing fallback functionality...**');
        try {
            const fallbackResult = companionComm.fallbackKeywordConsensus(Object.values(sampleCompanionInputs));
            console.log('✅ **Fallback Result:**');
            console.log(JSON.stringify(fallbackResult, null, 2));
        } catch (fallbackError) {
            console.error('❌ **Fallback also failed:**', fallbackError.message);
        }
    }
}

/**
 * Test companion decision input generation using prompts package
 */
async function testCompanionDecisionInput() {
    console.log('\n🧪 Testing companion decision input generation...\n');

    const { generateCompanionDecisionPrompt, getFallbackCompanionAnalysis } = await import('../../prompts/companion_decision_analysis.js');
    const companionComm = new CompanionConfidentialComm();
    const decisionContext = "Should I take a 6-month sabbatical to travel and recharge?";

    console.log(`📋 **Decision Context:** "${decisionContext}"\n`);

    const companionTypes = ['medical_companion', 'professional_companion', 'social_companion'];

    for (const companionType of companionTypes) {
        try {
            console.log(`🤖 **Getting input from ${companionType}...**`);
            
            // Test prompt generation
            const prompt = generateCompanionDecisionPrompt(companionType, decisionContext);
            console.log(`📝 **Generated prompt (first 150 chars):** ${prompt.substring(0, 150)}...\n`);
            
            const input = await companionComm.getCompanionDecisionInput(companionType, 'test_user_123', decisionContext);
            
            console.log(`✅ **${companionType} input received:**`);
            console.log(input.substring(0, 300) + '...\n');
            
        } catch (error) {
            console.error(`❌ **Failed to get ${companionType} input:**`, error.message);
            
            // Test fallback from prompts package
            const fallback = getFallbackCompanionAnalysis(companionType, decisionContext);
            console.log(`🔄 **Fallback for ${companionType}:**`);
            console.log(fallback.substring(0, 200) + '...\n');
        }
    }
}

// Run tests
async function runAllTests() {
    console.log('🚀 **Starting LLM Companion Consensus Tests**');
    console.log('=' .repeat(60) + '\n');

    await testLLMConsensusAnalysis();
    await testCompanionDecisionInput();

    console.log('\n' + '='.repeat(60));
    console.log('🏁 **All tests completed!**');
}

// Execute tests if run directly
const currentFileUrl = import.meta.url;
const mainFileUrl = `file:///${process.argv[1].replace(/\\/g, '/').replace(/ /g, '%20')}`;

if (currentFileUrl === mainFileUrl) {
    runAllTests().catch(console.error);
}

export { testLLMConsensusAnalysis, testCompanionDecisionInput };