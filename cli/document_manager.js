#!/usr/bin/env node

/**
 * Document Management CLI
 * Interactive CLI for creating and managing markdown documents with approval workflows
 */

import { DocumentAgent } from '../agents/business/documentAgent.js';
import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { readlineManager } from './readline_manager.js';
import chalk from 'chalk';

class DocumentCLI {
    constructor() {
        this.db = null;
        this.currentUser = null;
        this.docAgent = null;
    }

    async initialize() {
        this.db = await getDb();
        await initializeBusinessSchema(this.db);
        console.log(chalk.green('📄 Document Collaboration CLI'));
        console.log(chalk.gray('Manage markdown documents with approval workflows\n'));
    }

    async run() {
        await this.initialize();
        
        // Set user
        this.currentUser = await readlineManager.question(chalk.yellow('Enter your user ID: '));
        this.docAgent = new DocumentAgent(this.currentUser, {});
        
        console.log(chalk.green(`\n👤 Logged in as: ${this.currentUser}`));
        
        while (true) {
            try {
                const choice = await this.mainMenu();
                if (choice === 'exit') break;
                await this.handleChoice(choice);
            } catch (error) {
                console.error(chalk.red('Error:'), error.message);
            }
        }
    }

    async mainMenu() {
        console.log(chalk.cyan('\n--- Document Management ---'));
        console.log('1. Create New Document');
        console.log('2. List My Documents');
        console.log('3. Edit Document');
        console.log('4. View Document');
        console.log('5. Add Collaborator');
        console.log('6. Start Approval Workflow');
        console.log('7. Approve/Reject Document');
        console.log('8. View Document History');
        console.log('9. Test Terminal Editor Integration');
        console.log('0. Exit');

        const choice = await readlineManager.question(chalk.yellow('Choose option: '));
        return choice.trim();
    }

    async handleChoice(choice) {
        switch (choice) {
            case '1': await this.createDocument(); break;
            case '2': await this.listDocuments(); break;
            case '3': await this.editDocument(); break;
            case '4': await this.viewDocument(); break;
            case '5': await this.addCollaborator(); break;
            case '6': await this.startApprovalWorkflow(); break;
            case '7': await this.approveDocument(); break;
            case '8': await this.viewDocumentHistory(); break;
            case '9': await this.testEditorIntegration(); break;
            case '0': return 'exit';
            default: console.log(chalk.red('Invalid choice'));
        }
    }

    async createDocument() {
        console.log(chalk.blue('\n--- Create New Document ---'));
        
        const title = await readlineManager.question('Document title: ');
        const content = await readlineManager.question('Initial content (or press enter for template): ');
        
        const defaultContent = `# ${title}

## Overview
Brief description of this document.

## Content
Main content goes here.

## Next Steps
- [ ] Review
- [ ] Approve
- [ ] Implement
`;

        try {
            const docId = await this.docAgent.createDocument(
                title,
                content || defaultContent,
                null // orgId - would be selected in real implementation
            );
            
            console.log(chalk.green(`✅ Document created with ID: ${docId}`));
            console.log(chalk.gray(`File saved as: documents/${docId}.md`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to create document: ${error.message}`));
        }
    }

    async listDocuments() {
        console.log(chalk.blue('\n--- My Documents ---'));
        
        try {
            // For testing, get all documents this user has access to
            const docs = await this.db.all(`
                SELECT d.id, d.title, d.status, d.version, d.updated_at, dc.role
                FROM org_documents d
                JOIN doc_collaborators dc ON d.id = dc.doc_id
                WHERE dc.user_id = ?
                ORDER BY d.updated_at DESC
            `, [this.currentUser]);
            
            if (docs.length === 0) {
                console.log(chalk.yellow('No documents found'));
                return;
            }
            
            docs.forEach((doc, i) => {
                const statusColor = this.getStatusColor(doc.status);
                console.log(`${i + 1}. ${chalk.white(doc.title)} (${chalk.cyan(doc.id.substring(0, 8))}) - v${doc.version}`);
                console.log(`   Status: ${statusColor(doc.status)} | Role: ${chalk.yellow(doc.role)} | Updated: ${new Date(doc.updated_at).toLocaleDateString()}`);
            });
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to list documents: ${error.message}`));
        }
    }

    async editDocument() {
        console.log(chalk.blue('\n--- Edit Document ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        
        // Find full ID
        const doc = await this.db.get(
            'SELECT * FROM org_documents WHERE id LIKE ?',
            [`${docId}%`]
        );
        
        if (!doc) {
            console.log(chalk.red('Document not found'));
            return;
        }
        
        console.log(chalk.gray(`Editing: ${doc.title}`));
        console.log('Edit methods:');
        console.log('1. Direct content input');
        console.log('2. Simulate nano editor');
        console.log('3. Simulate vim editor');
        
        const method = await readlineManager.question('Choose method (1-3): ');
        
        try {
            let result;
            
            if (method === '1') {
                console.log('\nCurrent content:');
                console.log(chalk.gray('---'));
                console.log(doc.content);
                console.log(chalk.gray('---'));
                
                const newContent = await readlineManager.question('Enter new content (or press enter to keep current): ');
                if (newContent) {
                    result = await this.docAgent.editDocument(doc.id, 'content', newContent);
                }
            } else if (method === '2') {
                result = await this.docAgent.editDocument(doc.id, 'nano');
            } else if (method === '3') {
                result = await this.docAgent.editDocument(doc.id, 'vim');
            }
            
            if (result && result.success) {
                console.log(chalk.green(`✅ Document updated to version ${result.version}`));
                console.log(chalk.gray('Diff preview:'));
                console.log(result.diff.split('\n').slice(0, 5).join('\n'));
            } else {
                console.log(chalk.yellow('No changes made'));
            }
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to edit document: ${error.message}`));
        }
    }

    async viewDocument() {
        console.log(chalk.blue('\n--- View Document ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        
        const doc = await this.db.get(
            'SELECT * FROM org_documents WHERE id LIKE ?',
            [`${docId}%`]
        );
        
        if (!doc) {
            console.log(chalk.red('Document not found'));
            return;
        }
        
        console.log(chalk.cyan(`\n📄 ${doc.title}`));
        console.log(chalk.gray(`Status: ${doc.status} | Version: ${doc.version} | Updated: ${new Date(doc.updated_at).toLocaleString()}`));
        console.log(chalk.gray('---'));
        console.log(doc.content);
        console.log(chalk.gray('---'));
    }

    async addCollaborator() {
        console.log(chalk.blue('\n--- Add Collaborator ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        const userId = await readlineManager.question('User ID to add: ');
        const role = await readlineManager.question('Role (owner/editor/reviewer/viewer): ');
        
        const permissions = {
            'owner': ['read', 'write', 'approve', 'delete'],
            'editor': ['read', 'write'],
            'reviewer': ['read', 'approve'],
            'viewer': ['read']
        };
        
        try {
            const doc = await this.db.get('SELECT * FROM org_documents WHERE id LIKE ?', [`${docId}%`]);
            if (!doc) throw new Error('Document not found');
            
            await this.docAgent.addCollaborator(doc.id, userId, role, permissions[role] || ['read']);
            console.log(chalk.green(`✅ Added ${userId} as ${role} to document`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to add collaborator: ${error.message}`));
        }
    }

    async startApprovalWorkflow() {
        console.log(chalk.blue('\n--- Start Approval Workflow ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        const approversInput = await readlineManager.question('Approvers (comma-separated user IDs): ');
        
        const approvers = approversInput.split(',').map(id => id.trim());
        
        try {
            const doc = await this.db.get('SELECT * FROM org_documents WHERE id LIKE ?', [`${docId}%`]);
            if (!doc) throw new Error('Document not found');
            
            const workflow = await this.docAgent.startApprovalWorkflow(doc.id, approvers);
            console.log(chalk.green(`✅ Started approval workflow for "${doc.title}"`));
            console.log(chalk.gray(`${workflow.approvers} approvers assigned for version ${workflow.version}`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to start workflow: ${error.message}`));
        }
    }

    async approveDocument() {
        console.log(chalk.blue('\n--- Approve/Reject Document ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        const decision = await readlineManager.question('Approve? (y/n): ');
        const comment = await readlineManager.question('Comment (optional): ');
        
        try {
            const doc = await this.db.get('SELECT * FROM org_documents WHERE id LIKE ?', [`${docId}%`]);
            if (!doc) throw new Error('Document not found');
            
            const approve = decision.toLowerCase() === 'y';
            const result = await this.docAgent.approveDocument(doc.id, approve, comment);
            
            const status = result.approved ? chalk.green('APPROVED') : chalk.red('REJECTED');
            console.log(`${status} document "${doc.title}"`);
            console.log(chalk.gray(`Document status: ${result.documentStatus}`));
            console.log(chalk.gray(`Pending approvals: ${result.pendingApprovals}`));
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to process approval: ${error.message}`));
        }
    }

    async viewDocumentHistory() {
        console.log(chalk.blue('\n--- Document History ---'));
        
        const docId = await readlineManager.question('Document ID (8 characters): ');
        
        try {
            const doc = await this.db.get('SELECT * FROM org_documents WHERE id LIKE ?', [`${docId}%`]);
            if (!doc) throw new Error('Document not found');
            
            const versions = await this.docAgent.getDocumentVersions(doc.id);
            
            console.log(chalk.cyan(`\n📋 History for "${doc.title}":`));
            
            versions.forEach(version => {
                console.log(`\nv${version.version_number} - ${chalk.yellow(version.author)} at ${new Date(version.timestamp).toLocaleString()}`);
                console.log(`   Comment: ${version.comment || 'No comment'}`);
                if (version.content_diff) {
                    console.log(`   Changes: ${version.content_diff.split('\n').length} lines modified`);
                }
            });
            
        } catch (error) {
            console.log(chalk.red(`❌ Failed to get history: ${error.message}`));
        }
    }

    async testEditorIntegration() {
        console.log(chalk.blue('\n--- Test Terminal Editor Integration ---'));
        
        // Create a test document
        const testDocId = await this.docAgent.createDocument(
            'Editor Test Document',
            '# Test Document\n\nThis is for testing editor integration.'
        );
        
        console.log(chalk.green(`✅ Created test document: ${testDocId.substring(0, 8)}`));
        
        // Test nano simulation
        const nanoResult = await this.docAgent.editDocument(testDocId, 'nano');
        console.log(chalk.green('✅ Nano editor simulation completed'));
        
        // Test vim simulation
        const vimResult = await this.docAgent.editDocument(testDocId, 'vim');
        console.log(chalk.green('✅ Vim editor simulation completed'));
        
        console.log(chalk.yellow('\n💡 Terminal Editor Integration:'));
        console.log('   - In production, this would open the actual nano/vim editor');
        console.log('   - User would edit the file interactively');
        console.log('   - Changes would be saved and versioned automatically');
        console.log('   - Diffs would be generated and stored');
    }

    getStatusColor(status) {
        const colors = {
            'draft': chalk.gray,
            'in_review': chalk.yellow,
            'approved': chalk.green,
            'published': chalk.blue
        };
        return colors[status] || chalk.white;
    }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const cli = new DocumentCLI();
    cli.run().catch(console.error);
}

export { DocumentCLI };