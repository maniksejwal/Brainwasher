#!/usr/bin/env node

/**
 * @fileoverview Forms CLI Tool
 * Interactive command-line interface for testing business forms
 */

import { FormsAgent } from '../agents/business/formsAgent.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { getDb } from '../db/connection.js';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function main() {
    console.log('\n🔥 Business Forms CLI Tool 🔥\n');
    
    // Initialize database
    const db = await getDb();
    await initializeBusinessSchema(db);
    
    // Test user
    const userId = 'test-user-001';
    const organizationId = 'acme-corp';
    const formsAgent = new FormsAgent(userId, organizationId);
    
    while (true) {
        console.log('\nAvailable commands:');
        console.log('1. Create form');
        console.log('2. List forms');
        console.log('3. View form');
        console.log('4. Submit response');
        console.log('5. View responses');
        console.log('6. Form analytics');
        console.log('7. Create template');
        console.log('8. Test signature');
        console.log('0. Exit');
        
        const choice = await prompt('\nSelect option: ');
        
        try {
            switch (choice) {
                case '1':
                    await createForm(formsAgent);
                    break;
                case '2':
                    await listForms(formsAgent);
                    break;
                case '3':
                    await viewForm(formsAgent);
                    break;
                case '4':
                    await submitResponse(formsAgent);
                    break;
                case '5':
                    await viewResponses(formsAgent);
                    break;
                case '6':
                    await showAnalytics(formsAgent);
                    break;
                case '7':
                    await createTemplate(formsAgent);
                    break;
                case '8':
                    await testSignature(formsAgent);
                    break;
                case '0':
                    console.log('\n👋 Goodbye!');
                    process.exit(0);
                default:
                    console.log('❌ Invalid option');
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
        }
    }
}

async function createForm(formsAgent) {
    console.log('\n📝 Create New Form');
    
    const title = await prompt('Form title: ');
    const description = await prompt('Description (optional): ');
    
    const fields = [];
    console.log('\nAdd form fields (type "done" when finished):');
    
    while (true) {
        const fieldType = await prompt('\nField type (text/textarea/select/checkbox/radio/email/number/date/file/signature): ');
        if (fieldType.toLowerCase() === 'done') break;
        
        const label = await prompt('Field label: ');
        const required = await prompt('Required? (y/n): ');
        const placeholder = await prompt('Placeholder (optional): ');
        
        const field = {
            type: fieldType,
            label,
            required: required.toLowerCase() === 'y',
            placeholder
        };
        
        // Add options for select/radio/checkbox
        if (['select', 'radio', 'checkbox', 'multiselect'].includes(fieldType)) {
            const optionsStr = await prompt('Options (comma-separated): ');
            field.options = optionsStr.split(',').map(opt => opt.trim());
        }
        
        fields.push(field);
        console.log(`✅ Added field: ${label} (${fieldType})`);
    }
    
    const formId = await formsAgent.createForm(title, description, fields);
    console.log(`\n🎉 Form created successfully! ID: ${formId.substring(0, 8)}`);
}

async function listForms(formsAgent) {
    console.log('\n📋 Your Forms');
    
    const forms = await formsAgent.getUserForms();
    
    if (forms.length === 0) {
        console.log('No forms found.');
        return;
    }
    
    forms.forEach((form, index) => {
        console.log(`${index + 1}. ${form.title} (${form.id.substring(0, 8)})`);
        console.log(`   Status: ${form.status}, Responses: ${form.response_count}`);
        console.log(`   Created: ${new Date(form.created_at).toLocaleDateString()}`);
    });
}

async function viewForm(formsAgent) {
    const formId = await prompt('\nForm ID (or partial): ');
    
    try {
        const form = await formsAgent.getForm(formId);
        
        console.log(`\n📄 Form: ${form.title}`);
        console.log(`Description: ${form.description}`);
        console.log(`Status: ${form.status}`);
        console.log(`Created: ${new Date(form.created_at).toLocaleDateString()}`);
        
        console.log('\nFields:');
        form.fields.forEach((field, index) => {
            console.log(`${index + 1}. ${field.field_label} (${field.field_type})${field.required ? ' *' : ''}`);
            if (field.field_options.length > 0) {
                console.log(`   Options: ${field.field_options.join(', ')}`);
            }
        });
        
    } catch (error) {
        // Try finding form by partial ID
        const forms = await formsAgent.getUserForms();
        const matchingForm = forms.find(f => f.id.startsWith(formId));
        
        if (matchingForm) {
            await viewForm({ getForm: () => formsAgent.getForm(matchingForm.id) });
        } else {
            throw error;
        }
    }
}

async function submitResponse(formsAgent) {
    const formId = await prompt('\nForm ID: ');
    
    const form = await formsAgent.getForm(formId);
    console.log(`\n📝 Submitting response to: ${form.title}`);
    
    const responseData = {};
    
    for (const field of form.fields) {
        if (field.field_type === 'signature') {
            // Simulate signature
            responseData[field.field_key] = {
                type: 'drawn',
                data: 'base64_signature_data_here',
                timestamp: Date.now()
            };
            console.log(`✍️ [Signature simulated for: ${field.field_label}]`);
            
        } else if (field.field_type === 'audio') {
            // Simulate audio recording
            responseData[field.field_key] = {
                filename: `audio_${Date.now()}.wav`,
                mimeType: 'audio/wav',
                size: 125000,
                duration: 30000, // 30 seconds
                buffer: Buffer.from('simulated_audio_data')
            };
            console.log(`🎤 [Audio recording simulated for: ${field.field_label}]`);
            
        } else if (field.field_type === 'video') {
            // Simulate video recording
            responseData[field.field_key] = {
                filename: `video_${Date.now()}.mp4`,
                mimeType: 'video/mp4',
                size: 2500000, // 2.5MB
                duration: 120000, // 2 minutes
                buffer: Buffer.from('simulated_video_data')
            };
            console.log(`📹 [Video recording simulated for: ${field.field_label}]`);
            
        } else if (field.field_type === 'file') {
            // Simulate file upload
            responseData[field.field_key] = {
                filename: `document_${Date.now()}.pdf`,
                mimeType: 'application/pdf',
                size: 85000,
                buffer: Buffer.from('simulated_file_data')
            };
            console.log(`📎 [File upload simulated for: ${field.field_label}]`);
            
        } else {
            let value;
            
            if (field.field_options.length > 0) {
                console.log(`Options: ${field.field_options.join(', ')}`);
                value = await prompt(`${field.field_label}${field.required ? ' *' : ''}: `);
            } else {
                value = await prompt(`${field.field_label}${field.required ? ' *' : ''}: `);
            }
            
            responseData[field.field_key] = value;
        }
    }
    
    const responseId = await formsAgent.submitResponse(formId, responseData);
    console.log(`\n🎉 Response submitted! ID: ${responseId.substring(0, 8)}`);
    
    // Add signature if form had signature field
    const signatureField = form.fields.find(f => f.field_type === 'signature');
    if (signatureField) {
        const signatureData = responseData[signatureField.field_key];
        const signatureId = await formsAgent.addSignature(responseId, signatureData, 'drawn');
        console.log(`✍️ Digital signature added! ID: ${signatureId.substring(0, 8)}`);
    }
}

async function viewResponses(formsAgent) {
    const formId = await prompt('\nForm ID: ');
    
    const responses = await formsAgent.getFormResponses(formId, true);
    const form = await formsAgent.getForm(formId);
    
    console.log(`\n📊 Responses for: ${form.title}`);
    
    if (responses.length === 0) {
        console.log('No responses yet.');
        return;
    }
    
    responses.forEach((response, index) => {
        console.log(`\n${index + 1}. Response ${response.id.substring(0, 8)}`);
        console.log(`   Submitted: ${new Date(response.submitted_at).toLocaleString()}`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Respondent: ${response.respondent_name || 'Anonymous'}`);
        
        Object.entries(response.response_data).forEach(([key, value]) => {
            const field = form.fields.find(f => f.field_key === key);
            const label = field ? field.field_label : key;
            console.log(`   ${label}: ${JSON.stringify(value)}`);
        });
        
        if (response.signatures && response.signatures.length > 0) {
            console.log(`   ✍️ Signatures: ${response.signatures.length}`);
        }
    });
}

async function showAnalytics(formsAgent) {
    const formId = await prompt('\nForm ID: ');
    
    const analytics = await formsAgent.getFormAnalytics(formId);
    
    console.log(`\n📈 Form Analytics`);
    console.log(`Total Views: ${analytics.totalViews}`);
    console.log(`Total Starts: ${analytics.totalStarts}`);
    console.log(`Total Completions: ${analytics.totalCompletions}`);
    console.log(`Completion Rate: ${analytics.completionRate}`);
    
    if (analytics.fieldAnalytics.length > 0) {
        console.log('\nField Analytics:');
        analytics.fieldAnalytics.forEach(field => {
            console.log(`  Field ${field.field_id}: Avg time ${field.avg_time}ms, ${field.interactions} interactions`);
        });
    }
}

async function createTemplate(formsAgent) {
    console.log('\n📋 Create from Template');
    console.log('Available templates:');
    console.log('1. contact - Contact Information Form');
    console.log('2. feedback - User Feedback Form');
    console.log('3. application - Job Application Form');
    console.log('4. video_application - Video Application with Introduction');
    console.log('5. incident_report - Incident Report with Multimedia Evidence');
    console.log('6. customer_testimonial - Customer Video/Audio Testimonials');
    console.log('7. training_feedback - Training Feedback with Recordings');
    
    const choice = await prompt('\nSelect template: ');
    const templateMap = { 
        '1': 'contact', 
        '2': 'feedback', 
        '3': 'application',
        '4': 'video_application',
        '5': 'incident_report', 
        '6': 'customer_testimonial',
        '7': 'training_feedback'
    };
    const templateType = templateMap[choice];
    
    if (!templateType) {
        console.log('❌ Invalid template choice');
        return;
    }
    
    const formId = await formsAgent.createTemplate(templateType);
    console.log(`\n🎉 Template form created! ID: ${formId.substring(0, 8)}`);
}

async function testSignature(formsAgent) {
    console.log('\n✍️ Digital Signature Test');
    
    // Create a simple form with signature
    const formId = await formsAgent.createForm(
        'Signature Test Form',
        'Test digital signatures',
        [
            { type: 'text', label: 'Full Name', required: true },
            { type: 'textarea', label: 'Agreement Terms', defaultValue: 'I agree to the terms and conditions.' },
            { type: 'signature', label: 'Digital Signature', required: true }
        ]
    );
    
    console.log(`Created test form: ${formId.substring(0, 8)}`);
    
    // Submit response with signature
    const responseData = {
        full_name: 'John Doe',
        agreement_terms: 'I agree to the terms and conditions.',
        digital_signature: {
            type: 'drawn',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            timestamp: Date.now(),
            coordinates: [[100, 50], [150, 60], [200, 55]]
        }
    };
    
    const responseId = await formsAgent.submitResponse(formId, responseData);
    console.log(`Response submitted: ${responseId.substring(0, 8)}`);
    
    // Add signature
    const signatureId = await formsAgent.addSignature(responseId, responseData.digital_signature, 'drawn');
    console.log(`✍️ Digital signature added: ${signatureId.substring(0, 8)}`);
    
    console.log('🎉 Signature test completed successfully!');
}

main().catch(console.error).finally(() => rl.close());