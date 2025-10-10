/**
 * @fileoverview Feedback modal and functionality
 */

import { MESSAGES } from '../config/messages.js';
import { addSystemMessage } from './messages.js';

export function setupFeedbackModal(sendMessageFn) {
    const modal = document.getElementById('feedback-modal');
    
    // Show modal on Ctrl+F
    document.getElementById('message-input').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            modal.classList.add('active');
        }
    });
    
    // Cancel button
    document.getElementById('cancel-feedback').addEventListener('click', () => {
        modal.classList.remove('active');
    });
    
    // Highlight selected button
    document.querySelectorAll('.feedback-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.feedback-btn').forEach(b => b.style.outline = '');
            btn.style.outline = '2px solid var(--google-blue)';
        });
    });
    
    // Submit feedback
    document.getElementById('submit-feedback').addEventListener('click', async () => {
        const selected = document.querySelector('.feedback-btn[style*="outline"]');
        if (!selected) {
            alert('Please select a rating');
            return;
        }

        const score = selected.dataset.score;
        const comment = document.getElementById('feedback-comment').value;
        
        const command = comment 
            ? `/feedback ${score > 0 ? '+' : ''}${score} "${comment}"`
            : `/feedback ${score > 0 ? '+' : ''}${score}`;

        await sendMessageFn(command);
        
        modal.classList.remove('active');
        document.getElementById('feedback-comment').value = '';
        document.querySelectorAll('.feedback-btn').forEach(b => b.style.outline = '');
        
        addSystemMessage(MESSAGES.FEEDBACK_SUBMITTED);
    });
}

