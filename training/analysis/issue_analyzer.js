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
     * Generate issue report
     */
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
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || 
    process.argv[1].includes('issue_analyzer')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { IssueAnalyzer };

