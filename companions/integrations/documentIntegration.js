/**
 * @fileoverview Unified Document Integration
 * Connects companion conversations with document workflow for both medical and business contexts
 */

import { getDb } from '../db/connection.js';
import { findCircleById } from '../db/index.js';

/**
 * Unified Document Integration Manager
 * Works for both medical reports and business documents
 */
export class DocumentIntegration {
    
    /**
     * Trigger document creation from conversation (works for both medical and business)
     */
    async triggerDocumentFromConversation(messageId, circleId, documentRequest) {
        const { 
            title,
            documentType, // auto-detected: 'medical_report', 'business_contract', 'meeting_notes', 'proposal'
            initialContent = '',
            urgency = 'normal'
        } = documentRequest;
        
        // Auto-detect context type from circle
        const circle = await findCircleById(circleId);
        const contextType = circle?.circle_type === 'professional' ? 'business' : 'medical';
        
        // Create document in unified documents table
        const documentId = await this.createDocument({
            title,
            content: initialContent,
            document_type: documentType,
            circle_id: circleId,
            context_type: contextType,
            status: 'draft',
            urgency
        });
        
        // Link document to triggering conversation
        await this.linkDocumentToMessage(documentId, messageId, 'creation_trigger');
        
        return documentId;
    }
    
    /**
     * Process document mentions in conversations (unified for both contexts)
     */
    async processDocumentMention(message, messageId, circleId, analysis) {
        const mentionedDocuments = this.extractDocumentReferences(message);
        
        for (const docRef of mentionedDocuments) {
            const documentId = await this.resolveDocumentReference(docRef, circleId);
            if (documentId) {
                await this.linkDocumentToMessage(
                    documentId, 
                    messageId, 
                    this.inferLinkType(message, analysis)
                );
                
                // Update document based on conversation context
                await this.updateDocumentFromConversation(documentId, message, analysis);
            }
        }
    }
    
    /**
     * Extract document references from message text (works for both medical and business terms)
     */
    extractDocumentReferences(message) {
        const references = [];
        
        // Medical document patterns
        const medicalPatterns = [
            /\b(?:the|my|patient)\s+(report|chart|record|prescription|test\s+result|lab\s+result)\b/gi,
            /\b(medical\s+record|health\s+record|chart|prescription)\s+([A-Za-z0-9_-]+)\b/gi
        ];
        
        // Business document patterns  
        const businessPatterns = [
            /\b(?:the|our|that)\s+(contract|proposal|document|report|spec|requirements?)\b/gi,
            /\bdocument?\s+([A-Za-z0-9_-]+)\b/gi,
            /\b([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*)*)\s+(?:document|doc|contract|proposal)\b/gi
        ];
        
        const allPatterns = [...medicalPatterns, ...businessPatterns];
        
        for (const pattern of allPatterns) {
            const matches = message.matchAll(pattern);
            for (const match of matches) {
                references.push({
                    text: match[0],
                    type: match[1] || 'document',
                    context: match.input.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20)
                });
            }
        }
        
        return references;
    }
    
    /**
     * Resolve document reference to actual document ID (works for both contexts)
     */
    async resolveDocumentReference(docRef, circleId) {
        const db = await getDb();
        
        // Try exact title match first
        let doc = await db.get(
            'SELECT id FROM documents WHERE title LIKE ? AND circle_id = ?',
            [`%${docRef.text}%`, circleId]
        );
        
        if (!doc) {
            // Try fuzzy matching on content or document type
            doc = await db.get(`
                SELECT id FROM documents 
                WHERE (content LIKE ? OR document_type LIKE ?) 
                AND circle_id = ?
                ORDER BY updated_at DESC
                LIMIT 1
            `, [`%${docRef.type}%`, `%${docRef.type}%`, circleId]);
        }
        
        return doc?.id || null;
    }
    
    /**
     * Infer how the conversation relates to the document (unified logic)
     */
    inferLinkType(message, analysis) {
        const messageLower = message.toLowerCase();
        
        if (messageLower.match(/\b(review|feedback|comments?|thoughts?)\b/)) {
            return 'review_discussion';
        }
        if (messageLower.match(/\b(approve|approved|sign|accept)\b/)) {
            return 'approval_decision';  
        }
        if (messageLower.match(/\b(edit|change|update|modify|revise)\b/)) {
            return 'edit_request';
        }
        if (analysis.businessIntent === 'REQUESTING_ESCALATION' || analysis.intent === 'REQUESTING_ESCALATION') {
            return 'escalation_trigger';
        }
        
        return 'reference';
    }
    
    /**
     * Create a document in the unified system
     */
    async createDocument(documentData) {
        const db = await getDb();
        const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        await db.run(`
            INSERT INTO documents 
            (id, title, content, document_type, circle_id, context_type, status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            documentId,
            documentData.title,
            documentData.content,
            documentData.document_type,
            documentData.circle_id,
            documentData.context_type,
            documentData.status,
            'companion_system',
            Date.now(),
            Date.now()
        ]);
        
        return documentId;
    }
    
    /**
     * Link document to message
     */
    async linkDocumentToMessage(documentId, messageId, linkType) {
        const db = await getDb();
        
        await db.run(`
            INSERT INTO message_document_links 
            (message_id, document_id, link_type, created_at)
            VALUES (?, ?, ?, ?)
        `, [messageId, documentId, linkType, Date.now()]);
    }
    
    /**
     * Update document based on conversation insights (unified for both contexts)
     */
    async updateDocumentFromConversation(documentId, message, analysis) {
        const db = await getDb();
        
        // Add conversation context to document  
        const contextNote = `\n\n<!-- Conversation Context: ${analysis.intent || 'GENERAL'} at ${new Date().toISOString()} -->`;
        
        await db.run(`
            UPDATE documents 
            SET content = content || ?, updated_at = ?
            WHERE id = ?
        `, [contextNote, Date.now(), documentId]);
    }
    
    /**
     * Get conversation history for a document (works for both medical and business)
     */
    async getDocumentConversationHistory(documentId) {
        const db = await getDb();
        
        return await db.all(`
            SELECT m.*, mdl.link_type, u.username, mm.intent, mm.topics, mm.context_type
            FROM message_document_links mdl
            JOIN messages m ON mdl.message_id = m.message_id
            JOIN users u ON m.user_id = u.user_id
            LEFT JOIN message_metadata mm ON m.message_id = mm.message_id
            WHERE mdl.document_id = ?
            ORDER BY m.timestamp ASC
        `, [documentId]);
    }
    
    /**
     * Get documents discussed in a conversation (unified retrieval)
     */
    async getConversationDocuments(circleId, contextType = null, timeRange = null) {
        const db = await getDb();
        
        let query = `
            SELECT DISTINCT d.*, mdl.link_type, COUNT(mdl.message_id) as discussion_count
            FROM documents d
            JOIN message_document_links mdl ON d.id = mdl.document_id
            JOIN messages m ON mdl.message_id = m.message_id
            WHERE d.circle_id = ?
        `;
        
        const params = [circleId];
        
        if (contextType) {
            query += ' AND d.context_type = ?';
            params.push(contextType);
        }
        
        if (timeRange) {
            query += ' AND m.timestamp >= ? AND m.timestamp <= ?';
            params.push(timeRange.start, timeRange.end);
        }
        
        query += ' GROUP BY d.id ORDER BY discussion_count DESC';
        
        return await db.all(query, params);
    }
}

export const documentIntegration = new DocumentIntegration();

export default { DocumentIntegration, documentIntegration };