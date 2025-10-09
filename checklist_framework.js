/**
 * @fileoverview Checklist Framework for Business Negotiations
 * 
 * Separate from behavioral_models.js (which handles patient behavioral psychology)
 * This handles business decision checklists, approvals, and competitive analysis
 * 
 * Based on "The Checklist Manifesto" principles
 */

/**
 * Universal Checklist Engine
 */
class ChecklistEngine {
    constructor(domain, checklistType) {
        this.domain = domain;
        this.type = checklistType;
        this.checklist = this._loadChecklist(domain, checklistType);
        this.progress = new Map();
        this.bypassed = new Set();
        this.bypassReason = null;
    }

    _loadChecklist(domain, type) {
        if (domain === 'business') {
            return BUSINESS_CHECKLISTS[type] || BUSINESS_CHECKLISTS.default;
        }
        return [];
    }

    checkItem(itemId, value, extractedFrom = null) {
        this.progress.set(itemId, {
            value,
            completed: true,
            timestamp: Date.now(),
            source: extractedFrom || 'conversation',
            confidence: this._calculateConfidence(extractedFrom)
        });
    }

    getMissingCritical() {
        return this.checklist
            .filter(item => item.criticality === 'critical')
            .filter(item => !this.progress.has(item.id));
    }

    getNextQuestion() {
        const priorities = ['critical', 'high', 'medium', 'low'];
        
        for (const priority of priorities) {
            const missing = this.checklist
                .filter(item => item.criticality === priority)
                .filter(item => !this.progress.has(item.id));
            
            if (missing.length > 0) {
                return missing[0];
            }
        }
        
        return null;
    }

    canProceed(toStage) {
        const required = this.checklist
            .filter(item => item.requiredFor === toStage || item.criticality === 'critical');
        
        const allMet = required.every(item => this.progress.has(item.id));
        
        if (!allMet) {
            const missing = required.filter(item => !this.progress.has(item.id));
            return {
                canProceed: false,
                reason: 'Missing critical information',
                missing: missing.map(m => m.id)
            };
        }

        return { canProceed: true };
    }

    bypass(itemIds, bypassAuthority, reason) {
        const authorization = this._checkBypassAuthority(itemIds, bypassAuthority);
        
        if (!authorization.allowed) {
            return { success: false, reason: authorization.reason };
        }

        for (const itemId of itemIds) {
            this.bypassed.add(itemId);
            this.progress.set(itemId, {
                value: null,
                completed: false,
                bypassed: true,
                bypassedBy: bypassAuthority.userId,
                reason,
                timestamp: Date.now()
            });
        }

        return { success: true };
    }

    _checkBypassAuthority(itemIds, authority) {
        const requiredLevel = Math.max(...itemIds.map(id => {
            const item = this.checklist.find(i => i.id === id);
            return item?.bypassLevel || 10;
        }));

        if (authority.level >= requiredLevel) {
            return { allowed: true };
        }

        return {
            allowed: false,
            reason: `Requires authority level ${requiredLevel}, you have ${authority.level}`
        };
    }

    _calculateConfidence(source) {
        if (source === 'explicit_statement') return 0.95;
        if (source === 'conversation') return 0.75;
        if (source === 'inferred') return 0.50;
        return 0.60;
    }

    getCompletionPercentage() {
        const total = this.checklist.length;
        const completed = Array.from(this.progress.values()).filter(p => p.completed).length;
        return (completed / total) * 100;
    }
}

/**
 * Business Checklists
 */
const BUSINESS_CHECKLISTS = {
    deal_qualification: [
        { id: 'problem_statement', criticality: 'critical', question: 'What problem are you trying to solve?', requiredFor: 'proposal' },
        { id: 'justification', criticality: 'critical', question: 'Why is this important now?', requiredFor: 'proposal' },
        { id: 'budget_range', criticality: 'high', question: 'What budget range are you working with?', requiredFor: 'pricing' },
        { id: 'timeline', criticality: 'high', question: 'What\'s your ideal timeline?', requiredFor: 'delivery_commit' },
        { id: 'decision_authority', criticality: 'critical', question: 'Who needs to approve this decision?', requiredFor: 'approval_path', bypassLevel: 8 },
        { id: 'competition_analysis', criticality: 'high', question: 'What alternatives are you considering?', requiredFor: 'positioning' },
        { id: 'success_metrics', criticality: 'medium', question: 'How will you measure success?', requiredFor: 'value_prop' }
    ],

    financial_approval: [
        { id: 'deal_value', criticality: 'critical', question: 'What is the total deal value?', requiredFor: 'approval_routing' },
        { id: 'budget_code', criticality: 'high', question: 'Which budget does this come from?', requiredFor: 'financial_approval' },
        { id: 'roi_justification', criticality: 'high', question: 'What is the expected ROI?', requiredFor: 'approval', bypassLevel: 9 },
        { id: 'competitive_quotes', criticality: 'medium', question: 'Do you have competitive quotes?', requiredFor: 'procurement_compliance' },
        { id: 'payment_terms', criticality: 'high', question: 'What payment terms work for you?', requiredFor: 'cash_flow' },
        { id: 'contract_length', criticality: 'medium', question: 'What contract duration?', requiredFor: 'forecasting' }
    ],

    legal_review: [
        { id: 'contract_type', criticality: 'critical', question: 'What type of contract?', requiredFor: 'template_selection' },
        { id: 'liability_limits', criticality: 'critical', question: 'What liability limits are acceptable?', requiredFor: 'risk_assessment' },
        { id: 'termination_rights', criticality: 'high', question: 'What exit rights do you need?', requiredFor: 'flexibility' },
        { id: 'ip_ownership', criticality: 'high', question: 'Who owns intellectual property?', requiredFor: 'ip_protection' },
        { id: 'dispute_resolution', criticality: 'medium', question: 'Preferred dispute resolution method?', requiredFor: 'risk_mitigation' },
        { id: 'regulatory_compliance', criticality: 'high', question: 'Any regulatory requirements?', requiredFor: 'compliance', bypassLevel: 10 }
    ],

    competitive_analysis: [
        { id: 'competitors_identified', criticality: 'high', question: 'Who else are you considering?', requiredFor: 'positioning' },
        { id: 'competitor_pricing', criticality: 'medium', question: 'What are they offering price-wise?', requiredFor: 'price_strategy' },
        { id: 'our_differentiators', criticality: 'high', question: 'What would make you choose us?', requiredFor: 'value_prop' },
        { id: 'competitor_weaknesses', criticality: 'medium', question: 'What concerns do you have about alternatives?', requiredFor: 'competitive_advantage' }
    ],

    default: [
        { id: 'basic_need', criticality: 'critical', question: 'What brings you here today?', requiredFor: 'understanding' }
    ]
};

/**
 * Scale-Based Authorization Engine
 */
class AuthorizationEngine {
    getRequiredApprovalLevel(dealParams) {
        const { value, risk, type } = dealParams;
        let requiredLevel = 1;

        // Value-based escalation
        if (value < 1000) requiredLevel = 1;
        else if (value < 10000) requiredLevel = 3;
        else if (value < 50000) requiredLevel = 5;
        else if (value < 250000) requiredLevel = 7;
        else if (value < 1000000) requiredLevel = 9;
        else requiredLevel = 10;

        // Risk adjustment
        if (risk === 'high') requiredLevel = Math.min(requiredLevel + 2, 10);
        if (risk === 'critical') requiredLevel = 10;

        return {
            requiredLevel,
            approvers: this._getApproversByLevel(requiredLevel),
            reasoning: this._explainApprovalRequirement(value, risk, type)
        };
    }

    _getApproversByLevel(level) {
        const hierarchy = {
            1: ['self'],
            3: ['team_lead'],
            5: ['manager'],
            7: ['director'],
            9: ['vp'],
            10: ['ceo', 'cfo']
        };
        
        const approvers = [];
        for (const [lvl, roles] of Object.entries(hierarchy)) {
            if (parseInt(lvl) <= level) {
                approvers.push(...roles);
            }
        }
        
        return [...new Set(approvers)];
    }

    _explainApprovalRequirement(value, risk, type) {
        const reasons = [];
        
        if (value > 100000) reasons.push(`High value ($${value.toLocaleString()})`);
        if (risk === 'high' || risk === 'critical') reasons.push(`${risk} risk level`);
        if (type === 'strategic_partnership') reasons.push('Strategic importance');
        
        return reasons.join(', ') || 'Standard approval process';
    }

    canBypass(userId, userAuthority, itemIds) {
        const maxBypassLevel = Math.max(...itemIds.map(id => {
            for (const checklist of Object.values(BUSINESS_CHECKLISTS)) {
                const item = checklist.find(i => i.id === id);
                if (item) return item.bypassLevel || 10;
            }
            return 10;
        }));

        return {
            allowed: userAuthority >= maxBypassLevel,
            requiredAuthority: maxBypassLevel,
            userAuthority
        };
    }
}

/**
 * Dynamic Individual Detector
 */
class DynamicBehaviorDetector {
    analyze(userHistory) {
        const traits = {
            commandsPerMinute: this._calculateCommandRate(userHistory),
            bypassAttempts: this._countBypassAttempts(userHistory),
            questionsSkipped: this._countSkippedQuestions(userHistory),
            directiveStyle: this._analyzeDirectiveness(userHistory)
        };

        let dynamicScore = 0;
        
        if (traits.commandsPerMinute > 2) dynamicScore += 25;
        if (traits.bypassAttempts > 0) dynamicScore += 25;
        if (traits.questionsSkipped > 3) dynamicScore += 25;
        if (traits.directiveStyle > 0.7) dynamicScore += 25;

        return {
            isDynamic: dynamicScore > 50,
            score: dynamicScore,
            traits,
            recommendation: this._getRecommendation(dynamicScore)
        };
    }

    _calculateCommandRate(history) {
        if (history.length < 2) return 0;
        const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
        return (history.length / timeSpan) * 60000;
    }

    _countBypassAttempts(history) {
        return history.filter(h => 
            h.message?.toLowerCase().includes('skip') ||
            h.message?.toLowerCase().includes('just do it') ||
            h.message?.toLowerCase().includes('i don\'t have time')
        ).length;
    }

    _countSkippedQuestions(history) {
        let skipped = 0;
        for (let i = 0; i < history.length - 1; i++) {
            if (history[i].type === 'agent_question' && 
                !history[i + 1].message?.toLowerCase().includes(history[i].topic)) {
                skipped++;
            }
        }
        return skipped;
    }

    _analyzeDirectiveness(history) {
        const directiveKeywords = ['just', 'immediately', 'now', 'asap', 'urgent', 'skip', 'forward'];
        const directiveMessages = history.filter(h => 
            directiveKeywords.some(k => h.message?.toLowerCase().includes(k))
        );
        return directiveMessages.length / Math.max(history.length, 1);
    }

    _getRecommendation(score) {
        if (score > 75) return 'High-tempo individual - streamline process, allow bypasses';
        if (score > 50) return 'Moderate-tempo - balance thoroughness with speed';
        return 'Standard process - complete checklist systematically';
    }
}

/**
 * Competitive Analysis Engine
 */
class CompetitiveAnalysisEngine {
    analyzeCompetition(discoveredInfo) {
        const competitors = discoveredInfo.competitorsIdentified || [];
        
        return {
            competitors,
            ourPosition: this._determinePosition(competitors, discoveredInfo),
            threats: this._identifyThreats(competitors, discoveredInfo),
            opportunities: this._identifyOpportunities(competitors, discoveredInfo),
            strategy: this._recommendStrategy(competitors, discoveredInfo)
        };
    }

    _determinePosition(competitors, info) {
        if (competitors.length === 0) return 'unknown';
        if (info.competitorPricing && info.ourPricing < info.competitorPricing) return 'cost_leader';
        if (info.ourDifferentiators?.includes('quality')) return 'differentiated';
        return 'parity';
    }

    _identifyThreats(competitors, info) {
        const threats = [];
        
        if (competitors.length > 3) threats.push('High competition');
        if (info.competitorPricing < info.ourPricing) threats.push('Price pressure');
        if (info.competitorFeatures > info.ourFeatures) threats.push('Feature gap');
        
        return threats;
    }

    _identifyOpportunities(competitors, info) {
        const opportunities = [];
        
        if (info.competitorWeaknesses?.length > 0) {
            opportunities.push(`Exploit weaknesses: ${info.competitorWeaknesses.join(', ')}`);
        }
        
        if (info.unmetNeeds?.length > 0) {
            opportunities.push(`Address unmet needs: ${info.unmetNeeds.join(', ')}`);
        }
        
        return opportunities;
    }

    _recommendStrategy(competitors, info) {
        if (competitors.length === 0) return 'First mover - educate market';
        if (info.ourPosition === 'cost_leader') return 'Compete on price + volume';
        if (info.ourPosition === 'differentiated') return 'Emphasize unique value, premium pricing';
        return 'Match competition, differentiate on service';
    }
}

/**
 * Financial Analysis Engine
 */
class FinancialAnalysisEngine {
    analyzeDeal(dealParams) {
        const { revenue, cost, duration, paymentTerms } = dealParams;
        
        const analysis = {
            margin: this._calculateMargin(revenue, cost),
            npv: this._calculateNPV(revenue, cost, duration),
            roi: this._calculateROI(revenue, cost),
            cashFlowImpact: this._analyzeCashFlow(revenue, paymentTerms),
            breakeven: this._calculateBreakeven(cost, revenue),
            recommendation: null
        };

        analysis.recommendation = this._generateRecommendation(analysis);
        
        return analysis;
    }

    _calculateMargin(revenue, cost) {
        return ((revenue - cost) / revenue) * 100;
    }

    _calculateNPV(revenue, cost, duration) {
        const netCashFlow = revenue - cost;
        return netCashFlow * duration;
    }

    _calculateROI(revenue, cost) {
        return ((revenue - cost) / cost) * 100;
    }

    _analyzeCashFlow(revenue, paymentTerms) {
        if (paymentTerms === 'upfront') return 'positive';
        if (paymentTerms === 'net_60') return 'neutral';
        if (paymentTerms === 'installments') return 'extended';
        return 'unknown';
    }

    _calculateBreakeven(cost, revenuePerPeriod) {
        return Math.ceil(cost / revenuePerPeriod);
    }

    _generateRecommendation(analysis) {
        if (analysis.margin < 20) return '🔴 Low margin - negotiate higher price or lower costs';
        if (analysis.roi < 50) return '🟡 Moderate ROI - consider if strategic value exists';
        if (analysis.margin > 40 && analysis.roi > 100) return '🟢 Excellent deal - approve';
        return '🟡 Acceptable - proceed with standard approval';
    }
}

export {
    ChecklistEngine,
    DynamicBehaviorDetector,
    AuthorizationEngine,
    CompetitiveAnalysisEngine,
    FinancialAnalysisEngine,
    BUSINESS_CHECKLISTS
};

