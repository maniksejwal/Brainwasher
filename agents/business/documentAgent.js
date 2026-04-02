/**
 * @fileoverview Document Collaboration Agent
 * Handles markdown document creation, editing, and approval workflows
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/connection.js';
import { getStorage } from '../../lib/storage/index.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

class DocumentAgent {
    constructor(userId, userProfile) {
        this.userId = userId;
        this.userProfile = userProfile;
        this.storage = getStorage();
    }

    /**
     * Create a new markdown document
     */
    async createDocument(title, content = '# New Document\n\nContent here...', orgId = null) {
        const db = await getDb();
        const docId = randomUUID();
        
        await db.run(
            `INSERT INTO org_documents (id, title, content, version, org_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [docId, title, content, 1, orgId, this.userId, Date.now(), Date.now()]
        );

        // Add creator as owner
        await this.addCollaborator(docId, this.userId, 'owner', ['read', 'write', 'approve', 'delete']);

        // Create initial version
        await this.createVersion(docId, content, 'Initial version', this.userId);

        // Save document to file system for editing
        await this.saveDocumentToFile(docId, content);

        return docId;
    }

    /**
     * Edit document using CLI editor (nano, vim, or direct content)
     */
    async editDocument(docId, method = 'content', newContent = null) {
        const doc = await this.getDocument(docId);
        if (!doc) throw new Error('Document not found');

        // Check permissions
        const hasWritePermission = await this.checkPermission(docId, this.userId, 'write');
        if (!hasWritePermission) {
            throw new Error('No write permission for this document');
        }

        let finalContent = newContent;

        if (method === 'nano' || method === 'vim') {
            // Use terminal editor
            finalContent = await this.editWithTerminalEditor(docId, method);
        } else if (method === 'file') {
            // Edit via file system
            const filePath = await this.getDocumentFilePath(docId);
            finalContent = await this.storage.read(filePath);
        }

        if (finalContent && finalContent !== doc.content) {
            // Calculate diff
            const diff = this.generateDiff(doc.content, finalContent);
            
            // Update document
            await this.updateDocument(docId, finalContent, `Edited via ${method}`, diff);
            
            return { success: true, diff, version: doc.version + 1 };
        }

        return { success: false, message: 'No changes made' };
    }

    /**
     * Edit document using terminal editor (nano/vim)
     */
    async editWithTerminalEditor(docId, editor) {
        const doc = await this.getDocument(docId);
        const tempFile = path.join(process.cwd(), `temp_${docId}.md`);
        
        // Write current content to temp file
        fs.writeFileSync(tempFile, doc.content);
        
        try {
            // Open in editor (this would be interactive in real CLI)
            const command = `${editor} ${tempFile}`;
            console.log(`[DocumentAgent] Would open: ${command}`);
            console.log(`[DocumentAgent] For testing, simulating edit...`);
            
            // Simulate an edit for testing
            const simulatedEdit = doc.content + '\n\n## Edited via ' + editor + '\n\nThis was edited using ' + editor + ' editor.';
            fs.writeFileSync(tempFile, simulatedEdit);
            
            // Read the edited content
            const editedContent = fs.readFileSync(tempFile, 'utf8');
            
            // Clean up temp file
            fs.unlinkSync(tempFile);
            
            return editedContent;
        } catch (error) {
            // Clean up temp file on error
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            throw error;
        }
    }

    /**
     * Generate git-like diff between two versions
     */
    generateDiff(oldContent, newContent) {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        
        let diff = [];
        let i = 0, j = 0;
        
        while (i < oldLines.length || j < newLines.length) {
            if (i < oldLines.length && j < newLines.length) {
                if (oldLines[i] === newLines[j]) {
                    diff.push(`  ${oldLines[i]}`);
                    i++;
                    j++;
                } else {
                    diff.push(`- ${oldLines[i]}`);
                    diff.push(`+ ${newLines[j]}`);
                    i++;
                    j++;
                }
            } else if (i < oldLines.length) {
                diff.push(`- ${oldLines[i]}`);
                i++;
            } else {
                diff.push(`+ ${newLines[j]}`);
                j++;
            }
        }
        
        return diff.join('\n');
    }

    /**
     * Update document with new content and create version
     */
    async updateDocument(docId, content, comment = '', diff = '') {
        const db = await getDb();
        
        // Get current document
        const doc = await this.getDocument(docId);
        const newVersion = doc.version + 1;
        
        // Update main document
        await db.run(
            `UPDATE org_documents SET content = ?, version = ?, updated_at = ? WHERE id = ?`,
            [content, newVersion, Date.now(), docId]
        );
        
        // Create new version
        await this.createVersion(docId, content, comment, this.userId, diff);
        
        // Save to file system
        await this.saveDocumentToFile(docId, content);
        
        return newVersion;
    }

    /**
     * Create a new document version
     */
    async createVersion(docId, content, comment, author, diff = '') {
        const db = await getDb();
        const doc = await this.getDocument(docId);
        
        const versionId = randomUUID();
        
        await db.run(
            `INSERT INTO doc_versions (id, doc_id, version_number, content, content_diff, author, timestamp, comment)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [versionId, docId, doc.version + 1, content, diff, author, Date.now(), comment]
        );
        
        return versionId;
    }

    /**
     * Add collaborator to document
     */
    async addCollaborator(docId, userId, role, permissions) {
        const db = await getDb();
        const collabId = randomUUID();
        
        await db.run(
            `INSERT INTO doc_collaborators (id, doc_id, user_id, role, permissions, added_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [collabId, docId, userId, role, JSON.stringify(permissions), Date.now()]
        );
        
        return collabId;
    }

    /**
     * Check user permission for document
     */
    async checkPermission(docId, userId, permission) {
        const db = await getDb();
        
        const collaborator = await db.get(
            `SELECT permissions FROM doc_collaborators WHERE doc_id = ? AND user_id = ?`,
            [docId, userId]
        );
        
        if (!collaborator) return false;
        
        const permissions = JSON.parse(collaborator.permissions);
        return permissions.includes(permission) || permissions.includes('all');
    }

    /**
     * Get document by ID
     */
    async getDocument(docId) {
        const db = await getDb();
        return await db.get('SELECT * FROM org_documents WHERE id = ?', [docId]);
    }

    /**
     * Get document versions
     */
    async getDocumentVersions(docId) {
        const db = await getDb();
        return await db.all(
            'SELECT * FROM doc_versions WHERE doc_id = ? ORDER BY version_number DESC',
            [docId]
        );
    }

    /**
     * Get documents for organization
     */
    async getOrganizationDocuments(orgId) {
        const db = await getDb();
        return await db.all(
            `SELECT d.*, dc.role, dc.permissions 
             FROM org_documents d
             JOIN doc_collaborators dc ON d.id = dc.doc_id
             WHERE d.org_id = ? AND dc.user_id = ?
             ORDER BY d.updated_at DESC`,
            [orgId, this.userId]
        );
    }

    /**
     * Save document to file system for external editing
     */
    async saveDocumentToFile(docId, content) {
        const filePath = `documents/${docId}.md`;
        await this.storage.write(filePath, content);
        return filePath;
    }

    /**
     * Get document file path
     */
    async getDocumentFilePath(docId) {
        return `documents/${docId}.md`;
    }

    /**
     * Start approval workflow
     */
    async startApprovalWorkflow(docId, approvers = []) {
        const db = await getDb();
        const doc = await this.getDocument(docId);
        
        if (!doc) throw new Error('Document not found');
        
        // Get latest version
        const versions = await this.getDocumentVersions(docId);
        const latestVersion = versions[0];
        
        // Create approval steps for each approver
        for (let i = 0; i < approvers.length; i++) {
            const workflowId = randomUUID();
            
            await db.run(
                `INSERT INTO approval_workflows (id, doc_id, version_id, step, approver, status, deadline)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [workflowId, docId, latestVersion.id, i + 1, approvers[i], 'pending', Date.now() + 7 * 24 * 60 * 60 * 1000] // 7 days
            );
        }
        
        // Update document status
        await db.run(
            'UPDATE org_documents SET status = ? WHERE id = ?',
            ['in_review', docId]
        );
        
        return { docId, approvers: approvers.length, version: latestVersion.version_number };
    }

    /**
     * Approve/reject document
     */
    async approveDocument(docId, approve = true, comment = '') {
        const db = await getDb();
        
        // Find pending approval for this user
        const workflow = await db.get(
            `SELECT * FROM approval_workflows 
             WHERE doc_id = ? AND approver = ? AND status = 'pending'
             ORDER BY step ASC LIMIT 1`,
            [docId, this.userId]
        );
        
        if (!workflow) {
            throw new Error('No pending approval found for this user');
        }
        
        // Update approval status
        const newStatus = approve ? 'approved' : 'rejected';
        await db.run(
            `UPDATE approval_workflows 
             SET status = ?, approved_at = ?, comment = ?
             WHERE id = ?`,
            [newStatus, Date.now(), comment, workflow.id]
        );
        
        // Check if all approvals are complete
        const pendingApprovals = await db.all(
            'SELECT * FROM approval_workflows WHERE doc_id = ? AND status = "pending"',
            [docId]
        );
        
        let docStatus = 'in_review';
        if (pendingApprovals.length === 0) {
            // Check if any were rejected
            const rejectedApprovals = await db.all(
                'SELECT * FROM approval_workflows WHERE doc_id = ? AND status = "rejected"',
                [docId]
            );
            
            docStatus = rejectedApprovals.length > 0 ? 'draft' : 'approved';
        } else if (!approve) {
            docStatus = 'draft'; // Rejected, send back to draft
        }
        
        // Update document status
        await db.run('UPDATE org_documents SET status = ? WHERE id = ?', [docStatus, docId]);
        
        return {
            approved: approve,
            documentStatus: docStatus,
            pendingApprovals: pendingApprovals.length
        };
    }
}

export { DocumentAgent };