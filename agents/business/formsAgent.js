/**
 * @fileoverview Business Forms Agent
 * Handles form creation, response processing, and digital signatures
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/connection.js';
import { getStorage } from '../../lib/storage/index.js';

export class FormsAgent {
    constructor(userId, organizationId = null) {
        this.userId = userId;
        this.organizationId = organizationId;
    }

    /**
     * Create a new form
     */
    async createForm(title, description = '', fields = [], settings = {}) {
        const db = await getDb();
        const formId = randomUUID();
        
        // Default form settings
        const defaultSettings = {
            allowAnonymous: false,
            allowMultipleResponses: false,
            requireLogin: true,
            collectMetadata: true,
            showProgressBar: true,
            ...settings
        };

        // Insert form
        await db.run(
            `INSERT INTO forms (id, title, description, form_structure, organization_id, created_by, created_at, updated_at, settings)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                formId,
                title,
                description,
                JSON.stringify({ fields }),
                this.organizationId,
                this.userId,
                Date.now(),
                Date.now(),
                JSON.stringify(defaultSettings)
            ]
        );

        // Insert form fields
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const fieldId = randomUUID();
            
            await db.run(
                `INSERT INTO form_fields (id, form_id, field_type, field_label, field_key, field_order, required, validation_rules, field_options, default_value, placeholder_text, help_text)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    fieldId,
                    formId,
                    field.type,
                    field.label,
                    field.key || field.label.toLowerCase().replace(/\s+/g, '_'),
                    i + 1,
                    field.required ? 1 : 0,
                    JSON.stringify(field.validation || {}),
                    JSON.stringify(field.options || []),
                    field.defaultValue || '',
                    field.placeholder || '',
                    field.helpText || ''
                ]
            );
        }

        return formId;
    }

    /**
     * Get form structure
     */
    async getForm(formId) {
        const db = await getDb();
        
        const form = await db.get(
            'SELECT * FROM forms WHERE id = ?',
            [formId]
        );
        
        if (!form) {
            throw new Error('Form not found');
        }

        const fields = await db.all(
            'SELECT * FROM form_fields WHERE form_id = ? ORDER BY field_order ASC',
            [formId]
        );

        return {
            ...form,
            form_structure: JSON.parse(form.form_structure || '{}'),
            settings: JSON.parse(form.settings || '{}'),
            fields: fields.map(field => ({
                ...field,
                validation_rules: JSON.parse(field.validation_rules || '{}'),
                field_options: JSON.parse(field.field_options || '[]'),
                conditional_logic: JSON.parse(field.conditional_logic || '{}')
            }))
        };
    }

    /**
     * Submit form response
     */
    async submitResponse(formId, responseData, metadata = {}) {
        const db = await getDb();
        const responseId = randomUUID();
        
        // Validate form exists and is active
        const form = await this.getForm(formId);
        if (form.status !== 'active') {
            throw new Error('Form is not accepting responses');
        }

        // Validate response data against form fields
        const validation = await this.validateResponse(form, responseData);
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if multiple responses allowed
        if (!form.settings.allowMultipleResponses) {
            const existingResponse = await db.get(
                'SELECT id FROM form_responses WHERE form_id = ? AND respondent_id = ?',
                [formId, this.userId]
            );
            if (existingResponse) {
                throw new Error('Multiple responses not allowed for this form');
            }
        }

        await db.run(
            `INSERT INTO form_responses (id, form_id, respondent_id, response_data, submitted_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                responseId,
                formId,
                this.userId,
                JSON.stringify(responseData),
                Date.now(),
                JSON.stringify(metadata)
            ]
        );

        // Log analytics event
        await this.logAnalytics(formId, 'complete', this.userId, null, null);

        return responseId;
    }

    /**
     * Validate response data
     */
    async validateResponse(form, responseData) {
        const errors = [];
        
        for (const field of form.fields) {
            const value = responseData[field.field_key];
            
            // Check required fields
            if (field.required && (!value || value === '')) {
                errors.push(`${field.field_label} is required`);
                continue;
            }

            if (value) {
                // Type-specific validation
                switch (field.field_type) {
                    case 'email':
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                            errors.push(`${field.field_label} must be a valid email`);
                        }
                        break;
                    case 'number':
                        if (isNaN(value)) {
                            errors.push(`${field.field_label} must be a number`);
                        }
                        break;
                    case 'date':
                        if (isNaN(Date.parse(value))) {
                            errors.push(`${field.field_label} must be a valid date`);
                        }
                        break;
                }

                // Custom validation rules
                const rules = field.validation_rules;
                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`${field.field_label} must be at least ${rules.minLength} characters`);
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`${field.field_label} must be at most ${rules.maxLength} characters`);
                }
                if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
                    errors.push(`${field.field_label} format is invalid`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Add digital signature to form response
     */
    async addSignature(responseId, signatureData, signatureType = 'drawn') {
        const db = await getDb();
        const signatureId = randomUUID();
        
        // Validate response exists
        const response = await db.get(
            'SELECT * FROM form_responses WHERE id = ?',
            [responseId]
        );
        
        if (!response) {
            throw new Error('Form response not found');
        }

        // Generate verification hash
        const verificationData = {
            responseId,
            signerId: this.userId,
            timestamp: Date.now(),
            signatureData
        };
        const verificationHash = await this.generateVerificationHash(verificationData);

        await db.run(
            `INSERT INTO signatures (id, document_id, document_type, signer_id, signature_data, signature_type, signed_at, verification_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                signatureId,
                responseId,
                'form',
                this.userId,
                JSON.stringify(signatureData),
                signatureType,
                Date.now(),
                verificationHash
            ]
        );

        return signatureId;
    }

    /**
     * Generate verification hash for signature integrity
     */
    async generateVerificationHash(data) {
        const crypto = await import('crypto');
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    /**
     * Get form responses with analytics
     */
    async getFormResponses(formId, includeAnalytics = false) {
        const db = await getDb();
        
        const responses = await db.all(
            `SELECT fr.*, u.username as respondent_name 
             FROM form_responses fr
             LEFT JOIN users u ON fr.respondent_id = u.user_id
             WHERE fr.form_id = ?
             ORDER BY fr.submitted_at DESC`,
            [formId]
        );

        const processedResponses = responses.map(response => ({
            ...response,
            response_data: JSON.parse(response.response_data || '{}'),
            metadata: JSON.parse(response.metadata || '{}')
        }));

        if (includeAnalytics) {
            // Get signatures for each response
            for (const response of processedResponses) {
                const signatures = await db.all(
                    'SELECT * FROM signatures WHERE document_id = ? AND document_type = "form"',
                    [response.id]
                );
                response.signatures = signatures.map(sig => ({
                    ...sig,
                    signature_data: JSON.parse(sig.signature_data || '{}')
                }));
            }
        }

        return processedResponses;
    }

    /**
     * Generate form analytics report
     */
    async getFormAnalytics(formId) {
        const db = await getDb();
        
        // Basic metrics
        const totalViews = await db.get(
            'SELECT COUNT(*) as count FROM form_analytics WHERE form_id = ? AND metric_type = "view"',
            [formId]
        );
        
        const totalStarts = await db.get(
            'SELECT COUNT(*) as count FROM form_analytics WHERE form_id = ? AND metric_type = "start"',
            [formId]
        );
        
        const totalCompletions = await db.get(
            'SELECT COUNT(*) as count FROM form_analytics WHERE form_id = ? AND metric_type = "complete"',
            [formId]
        );

        const completionRate = totalStarts.count > 0 
            ? (totalCompletions.count / totalStarts.count * 100).toFixed(2)
            : 0;

        // Field analytics
        const fieldAnalytics = await db.all(
            `SELECT field_id, AVG(time_spent) as avg_time, COUNT(*) as interactions
             FROM form_analytics 
             WHERE form_id = ? AND field_id IS NOT NULL
             GROUP BY field_id`,
            [formId]
        );

        return {
            totalViews: totalViews.count,
            totalStarts: totalStarts.count,
            totalCompletions: totalCompletions.count,
            completionRate: `${completionRate}%`,
            fieldAnalytics
        };
    }

    /**
     * Log analytics event
     */
    async logAnalytics(formId, metricType, userId = null, fieldId = null, metadata = {}) {
        const db = await getDb();
        
        await db.run(
            `INSERT INTO form_analytics (id, form_id, metric_type, user_id, timestamp, field_id, time_spent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                randomUUID(),
                formId,
                metricType,
                userId || this.userId,
                Date.now(),
                fieldId,
                metadata?.timeSpent || 0
            ]
        );
    }

    /**
     * Get user's forms
     */
    async getUserForms() {
        const db = await getDb();
        
        const forms = await db.all(
            `SELECT f.*, COUNT(fr.id) as response_count
             FROM forms f
             LEFT JOIN form_responses fr ON f.id = fr.form_id
             WHERE f.created_by = ? OR f.organization_id = ?
             GROUP BY f.id
             ORDER BY f.updated_at DESC`,
            [this.userId, this.organizationId]
        );

        return forms.map(form => ({
            ...form,
            settings: JSON.parse(form.settings || '{}')
        }));
    }

    /**
     * Handle file upload (including multimedia)
     */
    async handleFileUpload(responseId, fieldId, fileData) {
        const db = await getDb();
        const storage = getStorage();
        const uploadId = randomUUID();
        
        // Determine file type from MIME type
        const fileType = this.getFileTypeFromMime(fileData.mimeType);
        const storedFilename = `${uploadId}_${fileData.filename}`;
        const storagePath = `form_uploads/${fileType}s/${storedFilename}`;
        
        try {
            // Save file to storage
            await storage.writeFile(storagePath, fileData.buffer);
            
            // Process multimedia files
            let processingInfo = {};
            let transcription = null;
            let thumbnailPath = null;
            let duration = null;
            
            if (fileType === 'audio' || fileType === 'video') {
                processingInfo = await this.processMultimediaFile(fileData, storagePath, fileType);
                duration = processingInfo.duration;
                transcription = processingInfo.transcription;
                if (fileType === 'video') {
                    thumbnailPath = processingInfo.thumbnailPath;
                }
            }
            
            // Store file metadata
            await db.run(
                `INSERT INTO form_file_uploads (id, response_id, field_id, original_filename, stored_filename, 
                 file_type, mime_type, file_size, duration_ms, metadata, transcription, thumbnail_path, 
                 upload_status, processing_info, uploaded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uploadId,
                    responseId,
                    fieldId,
                    fileData.filename,
                    storedFilename,
                    fileType,
                    fileData.mimeType,
                    fileData.size,
                    duration,
                    JSON.stringify(processingInfo.metadata || {}),
                    transcription,
                    thumbnailPath,
                    'completed',
                    JSON.stringify(processingInfo),
                    Date.now()
                ]
            );
            
            return {
                uploadId,
                filename: fileData.filename,
                fileType,
                size: fileData.size,
                duration,
                transcription,
                thumbnailPath
            };
            
        } catch (error) {
            // Mark as failed
            await db.run(
                `INSERT INTO form_file_uploads (id, response_id, field_id, original_filename, 
                 upload_status, processing_info, uploaded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [uploadId, responseId, fieldId, fileData.filename, 'failed', JSON.stringify({ error: error.message }), Date.now()]
            );
            
            throw new Error(`File upload failed: ${error.message}`);
        }
    }

    /**
     * Determine file type from MIME type
     */
    getFileTypeFromMime(mimeType) {
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('image/')) return 'image';
        return 'document';
    }

    /**
     * Process multimedia files (extract metadata, generate transcriptions, thumbnails)
     */
    async processMultimediaFile(fileData, storagePath, fileType) {
        const processingInfo = {
            metadata: {
                originalSize: fileData.size,
                mimeType: fileData.mimeType
            }
        };

        try {
            // Simulated multimedia processing (in real implementation, use FFmpeg, speech-to-text APIs)
            if (fileType === 'audio') {
                // Extract audio metadata and transcribe
                processingInfo.duration = await this.extractAudioDuration(fileData);
                processingInfo.transcription = await this.transcribeAudio(fileData);
                processingInfo.metadata.channels = 2; // Simulated
                processingInfo.metadata.sampleRate = 44100; // Simulated
                
            } else if (fileType === 'video') {
                // Extract video metadata, generate thumbnail, transcribe audio
                processingInfo.duration = await this.extractVideoDuration(fileData);
                processingInfo.thumbnailPath = await this.generateVideoThumbnail(fileData, storagePath);
                processingInfo.transcription = await this.transcribeVideoAudio(fileData);
                processingInfo.metadata.resolution = '1920x1080'; // Simulated
                processingInfo.metadata.codec = 'h264'; // Simulated
            }
            
        } catch (error) {
            console.warn('[FormsAgent] Multimedia processing warning:', error.message);
            processingInfo.processingWarnings = [error.message];
        }

        return processingInfo;
    }

    /**
     * Extract audio duration (simulated - would use FFprobe/MediaInfo in real implementation)
     */
    async extractAudioDuration(fileData) {
        // Simulated duration extraction based on file size
        const estimatedDuration = Math.floor(fileData.size / 16000); // Rough estimate
        return Math.min(estimatedDuration, 3600000); // Cap at 1 hour
    }

    /**
     * Extract video duration (simulated)
     */
    async extractVideoDuration(fileData) {
        // Simulated duration extraction
        const estimatedDuration = Math.floor(fileData.size / 50000); // Rough estimate for video
        return Math.min(estimatedDuration, 7200000); // Cap at 2 hours
    }

    /**
     * Transcribe audio content (simulated - would use Whisper/Google Speech API in real implementation)
     */
    async transcribeAudio(fileData) {
        // Simulated transcription based on filename/type
        const mockTranscriptions = [
            "Thank you for considering my application. I'm very excited about this opportunity.",
            "This is a detailed explanation of the issue I encountered while using the system.",
            "I'd like to provide feedback on the recent changes to the user interface.",
            "Recording of the team meeting from April 1st, 2026 discussing quarterly goals."
        ];
        
        return mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];
    }

    /**
     * Transcribe video audio track (simulated)
     */
    async transcribeVideoAudio(fileData) {
        const mockVideoTranscriptions = [
            "Welcome to my video application. Let me walk you through my portfolio and experience.",
            "This screen recording shows the bug reproduction steps and the error message.",
            "Customer testimonial: I've been using this service for two years and it's fantastic.",
            "Training video: Here's how to properly use the new form submission process."
        ];
        
        return mockVideoTranscriptions[Math.floor(Math.random() * mockVideoTranscriptions.length)];
    }

    /**
     * Generate video thumbnail (simulated)
     */
    async generateVideoThumbnail(fileData, videoPath) {
        const storage = getStorage();
        const thumbnailPath = videoPath.replace(/\.[^/.]+$/, '_thumb.jpg');
        
        // Simulated thumbnail generation (would use FFmpeg in real implementation)
        const mockThumbnail = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgo...'; // Truncated base64
        
        try {
            await storage.writeFile(thumbnailPath, Buffer.from(mockThumbnail.split(',')[1], 'base64'));
            return thumbnailPath;
        } catch (error) {
            console.warn('[FormsAgent] Thumbnail generation failed:', error.message);
            return null;
        }
    }
    async createTemplate(templateType) {
        const templates = {
            'contact': {
                title: 'Contact Information Form',
                description: 'Collect basic contact information',
                fields: [
                    { type: 'text', label: 'Full Name', required: true },
                    { type: 'email', label: 'Email Address', required: true },
                    { type: 'text', label: 'Phone Number' },
                    { type: 'text', label: 'Company' },
                    { type: 'textarea', label: 'Message', placeholder: 'How can we help you?' }
                ]
            },
            'feedback': {
                title: 'Feedback Form',
                description: 'Collect user feedback and suggestions',
                fields: [
                    { type: 'radio', label: 'Overall Satisfaction', required: true, options: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'] },
                    { type: 'multiselect', label: 'What did you like?', options: ['Ease of use', 'Features', 'Performance', 'Design', 'Support'] },
                    { type: 'textarea', label: 'Suggestions for Improvement', placeholder: 'What could we do better?' },
                    { type: 'radio', label: 'Would you recommend us?', options: ['Definitely', 'Probably', 'Maybe', 'Probably not', 'Definitely not'] }
                ]
            },
            'application': {
                title: 'Application Form',
                description: 'Standard application with signature',
                fields: [
                    { type: 'text', label: 'Full Name', required: true },
                    { type: 'email', label: 'Email', required: true },
                    { type: 'date', label: 'Date of Birth', required: true },
                    { type: 'select', label: 'Position Applied For', required: true, options: ['Manager', 'Developer', 'Designer', 'Analyst'] },
                    { type: 'file', label: 'Resume', required: true },
                    { type: 'textarea', label: 'Why are you interested in this position?' },
                    { type: 'checkbox', label: 'I agree to the terms and conditions', required: true },
                    { type: 'signature', label: 'Digital Signature', required: true }
                ]
            },
            'video_application': {
                title: 'Video Application Form',
                description: 'Application with video introduction',
                fields: [
                    { type: 'text', label: 'Full Name', required: true },
                    { type: 'email', label: 'Email', required: true },
                    { type: 'select', label: 'Position Applied For', required: true, options: ['Manager', 'Developer', 'Designer', 'Sales', 'Marketing'] },
                    { type: 'file', label: 'Resume (PDF)', required: true },
                    { type: 'video', label: 'Video Introduction (2-3 minutes)', required: true, 
                      helpText: 'Please introduce yourself and explain why you\'re interested in this position' },
                    { type: 'audio', label: 'Voice Sample (Optional)', 
                      helpText: 'For customer-facing roles, please record a brief greeting' },
                    { type: 'textarea', label: 'Additional Comments' },
                    { type: 'checkbox', label: 'I consent to video/audio recording storage', required: true },
                    { type: 'signature', label: 'Digital Signature', required: true }
                ]
            },
            'incident_report': {
                title: 'Incident Report Form',
                description: 'Report incidents with multimedia evidence',
                fields: [
                    { type: 'text', label: 'Reporter Name', required: true },
                    { type: 'email', label: 'Contact Email', required: true },
                    { type: 'date', label: 'Incident Date', required: true },
                    { type: 'select', label: 'Incident Type', required: true, 
                      options: ['Safety', 'Security', 'Technical', 'HR', 'Customer Service', 'Other'] },
                    { type: 'textarea', label: 'Incident Description', required: true },
                    { type: 'file', label: 'Supporting Documents' },
                    { type: 'video', label: 'Video Evidence', 
                      helpText: 'Record or upload video evidence if available' },
                    { type: 'audio', label: 'Voice Recording', 
                      helpText: 'Record witness statement or additional details' },
                    { type: 'select', label: 'Severity Level', required: true, 
                      options: ['Low', 'Medium', 'High', 'Critical'] },
                    { type: 'checkbox', label: 'I certify this report is accurate', required: true }
                ]
            },
            'customer_testimonial': {
                title: 'Customer Testimonial Form', 
                description: 'Share your experience with video or audio testimonial',
                fields: [
                    { type: 'text', label: 'Your Name', required: true },
                    { type: 'text', label: 'Company/Title' },
                    { type: 'email', label: 'Email Address', required: true },
                    { type: 'radio', label: 'Testimonial Type', required: true, 
                      options: ['Video Testimonial', 'Audio Testimonial', 'Written Only'] },
                    { type: 'video', label: 'Video Testimonial (2-5 minutes)', 
                      helpText: 'Tell us about your experience with our product/service' },
                    { type: 'audio', label: 'Audio Testimonial (2-5 minutes)', 
                      helpText: 'Share your thoughts in your own voice' },
                    { type: 'textarea', label: 'Written Testimonial', 
                      placeholder: 'Please describe your experience...' },
                    { type: 'radio', label: 'Can we use this publicly?', required: true, 
                      options: ['Yes, with my name', 'Yes, but anonymously', 'Internal use only'] },
                    { type: 'checkbox', label: 'I consent to use of my testimonial', required: true }
                ]
            },
            'training_feedback': {
                title: 'Training Session Feedback',
                description: 'Provide feedback on training with optional recordings',
                fields: [
                    { type: 'text', label: 'Participant Name', required: true },
                    { type: 'text', label: 'Training Session Title', required: true },
                    { type: 'date', label: 'Training Date', required: true },
                    { type: 'radio', label: 'Overall Rating', required: true, 
                      options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'] },
                    { type: 'multiselect', label: 'What worked well?', 
                      options: ['Content Quality', 'Presenter Skills', 'Materials', 'Interactive Elements', 'Duration', 'Pace'] },
                    { type: 'textarea', label: 'Written Feedback' },
                    { type: 'audio', label: 'Voice Feedback (Optional)', 
                      helpText: 'Sometimes voice feedback captures nuances better than text' },
                    { type: 'video', label: 'Video Demonstration', 
                      helpText: 'If applicable, show us what you learned or demonstrate a skill' },
                    { type: 'radio', label: 'Would you recommend this training?', required: true, 
                      options: ['Definitely', 'Probably', 'Maybe', 'Probably Not', 'Definitely Not'] }
                ]
            }
        };

        const template = templates[templateType];
        if (!template) {
            throw new Error(`Template ${templateType} not found`);
        }

        return await this.createForm(template.title, template.description, template.fields);
    }
}