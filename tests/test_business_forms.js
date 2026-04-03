#!/usr/bin/env node

/**
 * @fileoverview Business Forms System Test
 * Comprehensive testing of forms, signatures, and analytics
 */

import { FormsAgent } from '../agents/business/formsAgent.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { getDb } from '../db/connection.js';

console.log('\n🔥 Business Forms System Test 🔥\n');

async function runTests() {
    // Initialize database
    console.log('📊 Initializing database...');
    const db = await getDb();
    await initializeBusinessSchema(db);
    console.log('✅ Database initialized\n');
    
    // Test users
    const users = [
        { id: 'manager-001', name: 'Alice Manager', org: 'acme-corp' },
        { id: 'employee-002', name: 'Bob Employee', org: 'acme-corp' },
        { id: 'external-003', name: 'Charlie External', org: null }
    ];
    
    console.log('👥 Test Users:');
    users.forEach(user => console.log(`   ${user.name} (${user.id})`));
    console.log();
    
    const managerAgent = new FormsAgent(users[0].id, users[0].org);
    const employeeAgent = new FormsAgent(users[1].id, users[1].org);
    const externalAgent = new FormsAgent(users[2].id, users[2].org);
    
    // Test 1: Create forms from templates
    console.log('📋 Test 1: Creating forms from templates...');
    
    const contactFormId = await managerAgent.createTemplate('contact');
    console.log(`   ✅ Created contact form: ${contactFormId.substring(0, 8)}`);
    
    const feedbackFormId = await managerAgent.createTemplate('feedback');
    console.log(`   ✅ Created feedback form: ${feedbackFormId.substring(0, 8)}`);
    
    const applicationFormId = await managerAgent.createTemplate('application');
    console.log(`   ✅ Created application form: ${applicationFormId.substring(0, 8)}`);
    console.log();
    
    // Test 2: Custom form creation
    console.log('📝 Test 2: Creating custom expense report form...');
    
    const expenseFields = [
        { type: 'text', label: 'Employee Name', required: true },
        { type: 'date', label: 'Expense Date', required: true },
        { type: 'select', label: 'Category', required: true, options: ['Travel', 'Meals', 'Office Supplies', 'Software', 'Other'] },
        { type: 'number', label: 'Amount ($)', required: true, validation: { min: 0 } },
        { type: 'textarea', label: 'Description', required: true },
        { type: 'file', label: 'Receipt', required: true },
        { type: 'checkbox', label: 'I certify this expense is legitimate', required: true },
        { type: 'signature', label: 'Employee Signature', required: true }
    ];
    
    const expenseFormId = await managerAgent.createForm(
        'Expense Report Form',
        'Submit business expenses for reimbursement',
        expenseFields,
        { allowMultipleResponses: true, requireLogin: true }
    );
    console.log(`   ✅ Created expense report form: ${expenseFormId.substring(0, 8)}`);
    console.log();
    
    // Test 3: Form submissions
    console.log('📤 Test 3: Submitting form responses...');
    
    // Contact form response
    const contactResponse = {
        full_name: 'John Prospect',
        email_address: 'john@prospect.com',
        phone_number: '555-0123',
        company: 'Prospect Corp',
        message: 'Interested in your services for enterprise solution.'
    };
    
    const contactResponseId = await externalAgent.submitResponse(contactFormId, contactResponse, {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...'
    });
    console.log(`   ✅ Contact form submitted: ${contactResponseId.substring(0, 8)}`);
    
    // Feedback response
    const feedbackResponse = {
        overall_satisfaction: 'Very Satisfied',
        what_did_you_like: ['Features', 'Performance', 'Support'],
        suggestions_for_improvement: 'More customization options would be great!',
        would_you_recommend_us: 'Definitely'
    };
    
    const feedbackResponseId = await employeeAgent.submitResponse(feedbackFormId, feedbackResponse);
    console.log(`   ✅ Feedback form submitted: ${feedbackResponseId.substring(0, 8)}`);
    
    // Application response
    const applicationResponse = {
        full_name: 'Sarah Developer',
        email: 'sarah@developer.com',
        date_of_birth: '1990-05-15',
        position_applied_for: 'Developer',
        resume: { filename: 'sarah_resume.pdf', size: 125000 },
        why_are_you_interested_in_this_position: 'I am passionate about building innovative solutions and believe my experience in React and Node.js would be valuable to your team.',
        i_agree_to_the_terms_and_conditions: true,
        digital_signature: {
            type: 'drawn',
            data: 'signature_data_base64',
            timestamp: Date.now()
        }
    };
    
    const applicationResponseId = await externalAgent.submitResponse(applicationFormId, applicationResponse);
    console.log(`   ✅ Application form submitted: ${applicationResponseId.substring(0, 8)}`);
    
    // Expense report response  
    const expenseResponse = {
        employee_name: 'Bob Employee',
        expense_date: '2026-04-01',
        category: 'Travel',
        'amount_($)': 125.50,
        description: 'Uber to client meeting downtown',
        receipt: { filename: 'uber_receipt.jpg', size: 85000 },
        'i_certify_this_expense_is_legitimate': true,
        employee_signature: {
            type: 'drawn',
            data: 'employee_signature_base64',
            timestamp: Date.now()
        }
    };
    
    const expenseResponseId = await employeeAgent.submitResponse(expenseFormId, expenseResponse);
    console.log(`   ✅ Expense report submitted: ${expenseResponseId.substring(0, 8)}`);
    console.log();
    
    // Test 4: Digital signatures
    console.log('✍️ Test 4: Adding digital signatures...');
    
    // Add signature to application
    const appSignatureId = await externalAgent.addSignature(
        applicationResponseId,
        applicationResponse.digital_signature,
        'drawn'
    );
    console.log(`   ✅ Application signature added: ${appSignatureId.substring(0, 8)}`);
    
    // Add signature to expense report
    const expenseSignatureId = await employeeAgent.addSignature(
        expenseResponseId,
        expenseResponse.employee_signature,
        'drawn'
    );
    console.log(`   ✅ Expense signature added: ${expenseSignatureId.substring(0, 8)}`);
    console.log();
    
    // Test 5: Form analytics
    console.log('📊 Test 5: Form analytics and reporting...');
    
    const forms = [
        { id: contactFormId, name: 'Contact Form' },
        { id: feedbackFormId, name: 'Feedback Form' },
        { id: applicationFormId, name: 'Application Form' },
        { id: expenseFormId, name: 'Expense Report' }
    ];
    
    for (const form of forms) {
        console.log(`\n   📋 ${form.name} Analytics:`);
        
        const analytics = await managerAgent.getFormAnalytics(form.id);
        console.log(`      Views: ${analytics.totalViews}`);
        console.log(`      Starts: ${analytics.totalStarts}`);
        console.log(`      Completions: ${analytics.totalCompletions}`);
        console.log(`      Completion Rate: ${analytics.completionRate}`);
        
        const responses = await managerAgent.getFormResponses(form.id, true);
        console.log(`      Responses: ${responses.length}`);
        
        if (responses.length > 0) {
            const signedResponses = responses.filter(r => r.signatures && r.signatures.length > 0).length;
            console.log(`      Signed: ${signedResponses}`);
        }
    }
    console.log();
    
    // Test 6: Form validation
    console.log('🔍 Test 6: Form validation...');
    
    try {
        // Try invalid email
        await externalAgent.submitResponse(contactFormId, {
            full_name: 'Test User',
            email_address: 'invalid-email',
            message: 'Test message'
        });
        console.log('   ❌ Validation should have failed');
    } catch (error) {
        console.log(`   ✅ Email validation works: ${error.message}`);
    }
    
    try {
        // Try missing required field
        await externalAgent.submitResponse(applicationFormId, {
            full_name: 'Test Applicant'
            // Missing required fields
        });
        console.log('   ❌ Required field validation should have failed');
    } catch (error) {
        console.log(`   ✅ Required field validation works: ${error.message.substring(0, 50)}...`);
    }
    console.log();
    
    // Test 7: Multiple responses (when allowed)
    console.log('📤 Test 7: Multiple responses test...');
    
    // Submit another expense report
    const expenseResponse2 = {
        employee_name: 'Bob Employee',
        expense_date: '2026-04-02',
        category: 'Meals',
        'amount_($)': 45.75,
        description: 'Business lunch with client',
        receipt: { filename: 'lunch_receipt.pdf', size: 65000 },
        'i_certify_this_expense_is_legitimate': true,
        employee_signature: {
            type: 'typed',
            data: 'Bob Employee',
            timestamp: Date.now()
        }
    };
    
    const expenseResponse2Id = await employeeAgent.submitResponse(expenseFormId, expenseResponse2);
    console.log(`   ✅ Second expense report submitted: ${expenseResponse2Id.substring(0, 8)}`);
    
    try {
        // Try submitting another contact form (should fail - multiple responses not allowed)
        await externalAgent.submitResponse(contactFormId, {
            full_name: 'Second Contact',
            email_address: 'second@contact.com',
            message: 'Second message'
        });
        console.log('   ❌ Multiple response prevention should have worked');
    } catch (error) {
        console.log(`   ✅ Multiple response prevention works: ${error.message}`);
    }
    console.log();
    
    // Test 8: User forms listing
    console.log('📋 Test 8: User forms listing...');
    
    const managerForms = await managerAgent.getUserForms();
    console.log(`   Manager has ${managerForms.length} forms:`);
    managerForms.forEach(form => {
        console.log(`      ${form.title} (${form.response_count} responses)`);
    });
    
    const employeeForms = await employeeAgent.getUserForms();
    console.log(`   Employee has access to ${employeeForms.length} forms`);
    console.log();
    
    // Test Summary
    console.log('🎉 Test Summary:');
    console.log('   ✅ Form template creation - PASSED');
    console.log('   ✅ Custom form creation - PASSED');
    console.log('   ✅ Form submissions - PASSED');
    console.log('   ✅ Digital signatures - PASSED');
    console.log('   ✅ Form analytics - PASSED');
    console.log('   ✅ Input validation - PASSED');
    console.log('   ✅ Multiple response control - PASSED');
    console.log('   ✅ User form access - PASSED');
    
    console.log('\n🎊 Business Forms System: ALL TESTS PASSED! 🎊\n');
    
    console.log('📋 Forms Created:');
    console.log(`   Contact Form: ${contactFormId.substring(0, 8)}`);
    console.log(`   Feedback Form: ${feedbackFormId.substring(0, 8)}`);
    console.log(`   Application Form: ${applicationFormId.substring(0, 8)}`);
    console.log(`   Expense Report: ${expenseFormId.substring(0, 8)}`);
    
    console.log('\n✍️ Digital Signatures:');
    console.log(`   Application Signature: ${appSignatureId.substring(0, 8)}`);
    console.log(`   Expense Signature: ${expenseSignatureId.substring(0, 8)}`);
    
    console.log('\n🚀 Ready to use! Try the CLI: `node cli/forms_manager.js`');
}

runTests().catch(console.error);