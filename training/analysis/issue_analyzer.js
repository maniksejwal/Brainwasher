/**
 * @fileoverview training/analysis/issue_analyzer.js
 * Analyzes detailed issue reports to identify systematic problems.
 */

import { getDb } from '../../db/connection.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class IssueAnalyzer {
    /**
     * Load all detailed feedback reports
     */
    async loadDetailedFeedback() {
        const db = await getDb();
        
        try {
            const reports = await db.all(`
                SELECT * FROM detailed_feedback 
                ORDER BY timestamp DESC
            `);
            return reports;
        } catch (error) {
            console.error('[IssueAnalyzer] Error loading feedback:', error.message);
            return [];
        }
    }

    /**
     * Analyze patterns by category
     */
    analyzeByCategory(reports) {
        const byCategory = {};
        
        for (const report of reports) {
            if (!byCategory[report.category]) {
                byCategory[report.category] = [];
            }
            byCategory[report.category].push(report);
        }

        return byCategory;
    }

    /**
     * Generate comprehensive failure pattern report with prompt analysis
     */
    async generateFailurePatternReport() {
        const db = await getDb();
        
        try {
            // Get critical failures with prompt versions
            const criticalFailures = await db.all(`
                SELECT 
                    f.conversation_id,
                    f.prompt_version,
                    f.score,
                    f.comment,
                    f.timestamp,
                    df.category,
                    df.description,
                    df.severity
                FROM feedback f
                LEFT JOIN detailed_feedback df ON f.conversation_id = df.conversation_id
                WHERE f.critical_failure = 1 OR f.score <= -2
                ORDER BY f.timestamp DESC
            `);
            
            if (criticalFailures.length === 0) {
                return {
                    summary: { total_failures: 0, patterns: [] },
                    prompt_analysis: {},
                    recommendations: []
                };
            }
            
            // Analyze failure patterns
            const patterns = this.analyzeFailurePatterns(criticalFailures);
            
            // Analyze by prompt version
            const promptAnalysis = this.analyzeFailuresByPrompt(criticalFailures);
            
            // Generate recommendations
            const recommendations = this.generateFailureRecommendations(patterns, promptAnalysis);
            
            return {
                summary: {
                    total_failures: criticalFailures.length,
                    patterns: patterns,
                    time_range: this.getTimeRange(criticalFailures)
                },
                prompt_analysis: promptAnalysis,
                recommendations: recommendations,
                detailed_failures: criticalFailures.slice(0, 20) // Top 20 for detailed view
            };
            
        } catch (error) {
            console.error('[IssueAnalyzer] Error generating failure pattern report:', error.message);
            return null;
        }
    }
    
    /**
     * Analyze failure patterns from critical failures
     */
    analyzeFailurePatterns(failures) {
        const patterns = {};
        
        failures.forEach(failure => {
            const comment = failure.comment?.toLowerCase() || '';
            const description = failure.description?.toLowerCase() || '';
            const combined = `${comment} ${description}`;
            
            // Pattern detection
            if (combined.includes('escalat') && combined.includes('fail')) {
                patterns.escalation_failure = (patterns.escalation_failure || 0) + 1;
            }
            if (combined.includes('denial') && combined.includes('accept')) {
                patterns.denial_acceptance = (patterns.denial_acceptance || 0) + 1;
            }
            if (combined.includes('empathy') && combined.includes('loop')) {
                patterns.empathy_loop = (patterns.empathy_loop || 0) + 1;
            }
            if (combined.includes('generic') || combined.includes('bland')) {
                patterns.generic_response = (patterns.generic_response || 0) + 1;
            }
            if (combined.includes('critical') && combined.includes('symptom')) {
                patterns.critical_symptom_missed = (patterns.critical_symptom_missed || 0) + 1;
            }
            if (combined.includes('consent') && combined.includes('violat')) {
                patterns.consent_violation = (patterns.consent_violation || 0) + 1;
            }
        });
        
        // Convert to sorted array
        return Object.entries(patterns)
            .map(([pattern, count]) => ({
                pattern: pattern,
                count: count,
                percentage: (count / failures.length * 100).toFixed(1),
                severity: count >= 5 ? 'high' : count >= 3 ? 'medium' : 'low'
            }))
            .sort((a, b) => b.count - a.count);
    }
    
    /**
     * Analyze failures by prompt version
     */
    analyzeFailuresByPrompt(failures) {
        const byPrompt = {};
        
        failures.forEach(failure => {
            const version = failure.prompt_version || 'unknown';
            if (!byPrompt[version]) {
                byPrompt[version] = {
                    failures: [],
                    categories: {},
                    total_count: 0
                };
            }
            
            byPrompt[version].failures.push(failure);
            byPrompt[version].total_count++;
            
            const category = failure.category || 'unknown';
            byPrompt[version].categories[category] = (byPrompt[version].categories[category] || 0) + 1;
        });
        
        // Calculate failure rates and patterns per prompt
        Object.entries(byPrompt).forEach(([version, data]) => {
            data.failure_rate = data.total_count / failures.length;
            data.top_category = Object.entries(data.categories)
                .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
        });
        
        return byPrompt;
    }
    
    /**
     * Generate actionable recommendations based on failure patterns
     */
    generateFailureRecommendations(patterns, promptAnalysis) {
        const recommendations = [];
        
        // Pattern-based recommendations
        patterns.forEach(pattern => {
            if (pattern.severity === 'high') {
                recommendations.push({
                    type: 'pattern_fix',
                    priority: 'high',
                    pattern: pattern.pattern,
                    description: `Address ${pattern.pattern.replace('_', ' ')} issues (${pattern.count} occurrences)`,
                    actions: this.getPatternActions(pattern.pattern)
                });
            }
        });
        
        // Prompt-specific recommendations
        Object.entries(promptAnalysis).forEach(([version, data]) => {
            if (data.failure_rate > 0.2) { // High failure rate
                recommendations.push({
                    type: 'prompt_review',
                    priority: 'high',
                    prompt_version: version,
                    description: `Prompt ${version} has high failure rate (${(data.failure_rate * 100).toFixed(1)}%)`,
                    actions: [
                        'Review prompt clarity and specificity',
                        'Add safety checks for critical situations',
                        'Improve escalation triggers',
                        'Test with adversarial personas'
                    ]
                });
            }
        });
        
        return recommendations.sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
    }
    
    /**
     * Get specific actions for failure patterns
     */
    getPatternActions(pattern) {
        const actions = {
            escalation_failure: [
                'Strengthen escalation triggers in prompts',
                'Add temporal urgency assessment',
                'Improve critical symptom detection',
                'Add emergency response protocols'
            ],
            denial_acceptance: [
                'Add persistence mechanisms for critical situations',
                'Implement safety override for denial patterns',
                'Strengthen gentle but firm escalation',
                'Add caregiver notification triggers'
            ],
            empathy_loop: [
                'Limit repetitive empathy expressions',
                'Add action-oriented response templates',
                'Implement conversation flow controls',
                'Add variety to caring language'
            ],
            generic_response: [
                'Create context-specific response templates',
                'Add symptom-specific question libraries',
                'Improve personalization based on patient history',
                'Add care circle goal awareness'
            ],
            critical_symptom_missed: [
                'Enhance symptom combination detection',
                'Add medical urgency assessment',
                'Improve temporal context analysis',
                'Strengthen emergency protocols'
            ],
            consent_violation: [
                'Review consent management prompts',
                'Add privacy level checks',
                'Improve consent request clarity',
                'Add consent override mechanisms'
            ]
        };
        
        return actions[pattern] || ['Review prompt for clarity and safety'];
    }
    
    /**
     * Get time range of failures
     */
    getTimeRange(failures) {
        if (failures.length === 0) return null;
        
        const timestamps = failures.map(f => f.timestamp).sort();
        const earliest = new Date(timestamps[0]);
        const latest = new Date(timestamps[timestamps.length - 1]);
        
        return {
            earliest: earliest.toISOString(),
            latest: latest.toISOString(),
            duration_days: Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24))
        };
    }
    async generateIssueReport(outputPath = path.join(__dirname, '../issue_report.md')) {
        console.log('[IssueAnalyzer] Generating issue analysis report...\n');

        const reports = await this.loadDetailedFeedback();
        
        if (reports.length === 0) {
            console.log('No detailed reports found.');
            return;
        }

        const byCategory = this.analyzeByCategory(reports);
        const report = this._buildReport(reports, byCategory);

        await fs.writeFile(outputPath, report, 'utf8');
        console.log(`✓ Issue report saved to: ${outputPath}\n`);
    }

    /**
     * Build markdown report
     */
    _buildReport(reports, byCategory) {
        const timestamp = new Date().toISOString();
        
        let report = `# Detailed Issue Analysis Report

Generated: ${timestamp}

---

## Summary

- **Total Issues Reported**: ${reports.length}
- **Unresolved**: ${reports.filter(r => !r.resolved).length}
- **Resolved**: ${reports.filter(r => r.resolved).length}

---

## Issues by Category

`;

        // Sort categories by count
        const sortedCategories = Object.entries(byCategory)
            .sort(([,a], [,b]) => b.length - a.length);

        for (const [category, items] of sortedCategories) {
            report += `### ${this._getCategoryEmoji(category)} ${category.toUpperCase()} (${items.length} reports)\n\n`;
            
            // Show top 5 most recent
            const recent = items.slice(0, 5);
            for (const item of recent) {
                const date = new Date(item.timestamp).toLocaleDateString();
                const resolved = item.resolved ? '✅' : '⏸️';
                report += `${resolved} **${date}** - ${item.description}\n`;
                if (item.context) {
                    report += `   _Context: "${item.context.substring(0, 100)}..."_\n`;
                }
                report += `\n`;
            }
            
            if (items.length > 5) {
                report += `_... and ${items.length - 5} more ${category} issues_\n`;
            }
            report += `\n---\n\n`;
        }

        report += `## Recommendations

### High Priority Issues

`;

        // Find categories with most reports
        const highPriority = sortedCategories.slice(0, 3);
        for (const [category, items] of highPriority) {
            report += `- **${category}**: ${items.length} reports - ${this._getRecommendation(category, items)}\n`;
        }

        report += `
---

*Use \`/report <category> "description"\` to submit detailed feedback*
`;

        return report;
    }

    _getCategoryEmoji(category) {
        const emojis = {
            bug: '🐛',
            privacy: '🔒',
            architecture: '🏗️',
            tone: '💬',
            accuracy: '🎯',
            verbosity: '📝',
            brevity: '📉',
            escalation: '🚨',
            consent: '✋',
            other: '📌'
        };
        return emojis[category] || '📌';
    }

    _getRecommendation(category, items) {
        const recommendations = {
            bug: 'Review template replacement logic and error handling',
            privacy: 'Audit agent-to-user message boundaries and consent checks',
            architecture: 'Review agent communication patterns - agents should not cross-talk',
            tone: 'Adjust empathy parameters in prompts',
            accuracy: 'Improve intent classification and entity resolution',
            verbosity: 'Add conciseness constraints to prompts',
            brevity: 'Expand response templates for common scenarios',
            escalation: 'Review criticality detection thresholds',
            consent: 'Strengthen consent validation logic'
        };
        return recommendations[category] || 'Review and address reported issues';
    }
}

async function main() {
    const analyzer = new IssueAnalyzer();
    await analyzer.generateIssueReport();
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('issue_analyzer')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { IssueAnalyzer };

