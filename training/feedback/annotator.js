/**
 * @fileoverview training/annotator.js
 * CLI tool for offline review and annotation of training logs.
 * Allows reviewers to score past conversations for training data quality.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { getDb } from '../../db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ConversationAnnotator {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    /**
     * Load training log entries
     */
    async loadTrainingLog(logPath = path.join(__dirname, '../training_log.jsonl')) {
        try {
            const content = await fs.readFile(logPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            return lines.map(line => JSON.parse(line));
        } catch (error) {
            console.error('Error loading training log:', error.message);
            return [];
        }
    }

    /**
     * Display a conversation entry
     */
    displayEntry(entry, index, total) {
        console.log('\n' + '='.repeat(80));
        console.log(`Entry ${index + 1} of ${total}`);
        console.log('='.repeat(80));
        console.log(`Conversation ID: ${entry.conversation_id}`);
        console.log(`User: ${entry.user_id}`);
        console.log(`Timestamp: ${new Date(entry.timestamp).toLocaleString()}`);
        console.log(`Latency: ${entry.latency_ms}ms`);
        console.log(`Prompt Version: ${entry.prompt_version}`);
        console.log('-'.repeat(80));
        console.log('USER MESSAGE:');
        console.log(entry.message);
        console.log('-'.repeat(80));
        console.log('AGENT RESPONSE:');
        console.log(entry.agent_response);
        console.log('-'.repeat(80));
        console.log('ORCHESTRATOR ACTION:');
        console.log(JSON.stringify(entry.orchestrator_action, null, 2));
        console.log('-'.repeat(80));
    }

    /**
     * Prompt for user input
     */
    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    /**
     * Collect annotation for an entry
     */
    async annotateEntry(entry) {
        console.log('\nRate this interaction:');
        console.log('  +1 = Good response (helpful, appropriate)');
        console.log('   0 = Neutral (acceptable but not great)');
        console.log('  -1 = Bad response (unhelpful, inappropriate)');
        console.log('   s = Skip this entry');
        console.log('   q = Quit annotation session');
        
        const scoreInput = await this.question('\nScore (+1/0/-1/s/q): ');
        
        if (scoreInput.toLowerCase() === 'q') {
            return { quit: true };
        }
        
        if (scoreInput.toLowerCase() === 's') {
            return { skip: true };
        }
        
        let score;
        if (scoreInput === '+1' || scoreInput === '1') {
            score = 1;
        } else if (scoreInput === '0') {
            score = 0;
        } else if (scoreInput === '-1') {
            score = -1;
        } else {
            console.log('Invalid score. Skipping...');
            return { skip: true };
        }
        
        const comment = await this.question('Comment (optional, press Enter to skip): ');
        
        return {
            score,
            comment: comment.trim(),
            timestamp: Date.now()
        };
    }

    /**
     * Save annotation to database
     */
    async saveAnnotation(entry, annotation, annotatorId = 'reviewer') {
        const db = await getDb();
        
        // Create feedback table if it doesn't exist
        await db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                score INTEGER,
                comment TEXT,
                timestamp INTEGER,
                annotator_id TEXT
            )
        `);
        
        await db.run(
            `INSERT INTO feedback (conversation_id, user_id, score, comment, timestamp, annotator_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                entry.conversation_id,
                entry.user_id,
                annotation.score,
                annotation.comment || '',
                annotation.timestamp,
                annotatorId
            ]
        );
    }

    /**
     * Run annotation session
     */
    async runSession(options = {}) {
        const {
            logPath = './training/training_log.jsonl',
            startIndex = 0,
            maxEntries = null,
            filterUnannotated = true,
            annotatorId = 'reviewer'
        } = options;

        console.log('🔍 Loading training log...');
        const entries = await this.loadTrainingLog(logPath);
        
        if (entries.length === 0) {
            console.log('No entries found in training log.');
            this.rl.close();
            return;
        }

        console.log(`Found ${entries.length} entries.`);
        
        // Filter out already annotated entries if requested
        let toAnnotate = entries;
        if (filterUnannotated) {
            const db = await getDb();
            const annotated = await db.all('SELECT DISTINCT conversation_id FROM feedback WHERE annotator_id = ?', [annotatorId]);
            const annotatedIds = new Set(annotated.map(a => a.conversation_id));
            toAnnotate = entries.filter(e => !annotatedIds.has(e.conversation_id));
            console.log(`${toAnnotate.length} entries pending annotation.`);
        }

        if (toAnnotate.length === 0) {
            console.log('All entries have been annotated!');
            this.rl.close();
            return;
        }

        // Limit entries if specified
        const finalEntries = maxEntries 
            ? toAnnotate.slice(startIndex, startIndex + maxEntries)
            : toAnnotate.slice(startIndex);

        console.log(`\nStarting annotation session with ${finalEntries.length} entries.\n`);
        
        let annotatedCount = 0;
        let skippedCount = 0;

        for (let i = 0; i < finalEntries.length; i++) {
            const entry = finalEntries[i];
            this.displayEntry(entry, i, finalEntries.length);
            
            const annotation = await this.annotateEntry(entry);
            
            if (annotation.quit) {
                console.log('\nQuitting annotation session...');
                break;
            }
            
            if (annotation.skip) {
                skippedCount++;
                continue;
            }
            
            await this.saveAnnotation(entry, annotation, annotatorId);
            annotatedCount++;
            console.log('✅ Annotation saved!');
        }

        console.log('\n' + '='.repeat(80));
        console.log('Annotation Session Complete');
        console.log('='.repeat(80));
        console.log(`Total annotated: ${annotatedCount}`);
        console.log(`Skipped: ${skippedCount}`);
        console.log(`Remaining: ${toAnnotate.length - annotatedCount - skippedCount}`);
        
        this.rl.close();
    }

    /**
     * Show annotation statistics
     */
    async showStats() {
        const db = await getDb();
        
        try {
            const stats = await db.all(`
                SELECT 
                    annotator_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN score = 1 THEN 1 ELSE 0 END) as positive,
                    SUM(CASE WHEN score = 0 THEN 1 ELSE 0 END) as neutral,
                    SUM(CASE WHEN score = -1 THEN 1 ELSE 0 END) as negative,
                    AVG(score) as avg_score
                FROM feedback
                GROUP BY annotator_id
            `);
            
            console.log('\n📊 Annotation Statistics\n');
            console.log('='.repeat(80));
            
            for (const stat of stats) {
                console.log(`Annotator: ${stat.annotator_id}`);
                console.log(`  Total annotations: ${stat.total}`);
                console.log(`  Positive (+1): ${stat.positive}`);
                console.log(`  Neutral (0): ${stat.neutral}`);
                console.log(`  Negative (-1): ${stat.negative}`);
                console.log(`  Average score: ${stat.avg_score.toFixed(2)}`);
                console.log('-'.repeat(80));
            }
        } catch (error) {
            console.log('No annotations found yet.');
        }
        
        this.rl.close();
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const annotator = new ConversationAnnotator();

    // Parse command line arguments
    const options = {
        annotatorId: process.env.ANNOTATOR_ID || 'reviewer',
        startIndex: 0,
        maxEntries: null,
        filterUnannotated: true
    };

    // Check for --stats flag
    if (args.includes('--stats')) {
        await annotator.showStats();
        return;
    }

    // Check for --all flag
    if (args.includes('--all')) {
        options.filterUnannotated = false;
    }

    // Check for --start flag
    const startIdx = args.indexOf('--start');
    if (startIdx !== -1 && args[startIdx + 1]) {
        options.startIndex = parseInt(args[startIdx + 1]);
    }

    // Check for --max flag
    const maxIdx = args.indexOf('--max');
    if (maxIdx !== -1 && args[maxIdx + 1]) {
        options.maxEntries = parseInt(args[maxIdx + 1]);
    }

    // Check for --id flag
    const idIdx = args.indexOf('--id');
    if (idIdx !== -1 && args[idIdx + 1]) {
        options.annotatorId = args[idIdx + 1];
    }

    console.log('📝 Conversation Annotator\n');
    console.log('Options:');
    console.log(`  Annotator ID: ${options.annotatorId}`);
    console.log(`  Start index: ${options.startIndex}`);
    console.log(`  Max entries: ${options.maxEntries || 'unlimited'}`);
    console.log(`  Filter unannotated: ${options.filterUnannotated}`);
    console.log('');

    await annotator.runSession(options);
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('annotator')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { ConversationAnnotator };

