import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TrainingMetricsAnalyzer } from './lib/training_metrics_analyzer.js';
import { ReportRenderer } from './lib/report_renderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_FILE = path.join(__dirname, 'reports/simulation_report.html');

async function main() {
    console.log("Analyzing logs...");
    const analyzer = new TrainingMetricsAnalyzer();

    // 1. Analyze Logs
    const logStats = await analyzer.analyzeLogs();

    // 2. Analyze Database
    console.log("Analyzing database...");
    const dbStats = await analyzer.analyzeDB();

    // 3. Process Time Series
    console.log("Processing time series...");
    const timeSeriesData = analyzer.processTimeSeriesData();

    // 4. Generate HTML
    console.log("Generating HTML report...");
    const renderer = new ReportRenderer();

    // Prepare data object for renderer
    const analyzerResult = {
        logStats,
        dbStats,
        definedPersonasMap: analyzer.getDefinedPersonas(),
        scenarios: analyzer.getScenarios()
    };

    const html = renderer.render(analyzerResult, timeSeriesData);

    // 5. Write Report
    fs.writeFileSync(REPORT_FILE, html);
    console.log(`Report generated at ${REPORT_FILE}`);
}

main().catch(console.error);
