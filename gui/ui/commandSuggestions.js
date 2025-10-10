/**
 * @fileoverview Command auto-suggestions
 */

import { MESSAGES } from '../config/messages.js';

let suggestionBox = null;

const COMMANDS = [
    MESSAGES.COMMANDS.CARE + ' username as relationship - Add caregiver',
    MESSAGES.COMMANDS.DOC + ' username [as specialty] - Add doctor',
    MESSAGES.COMMANDS.CIRCLE + ' - Show circle members',
    MESSAGES.COMMANDS.SWITCH + ' username - Switch circles',
    MESSAGES.COMMANDS.MYCIRCLES + ' - Show all your circles',
    MESSAGES.COMMANDS.PATIENTS + ' - Show patients (doctors)',
    MESSAGES.COMMANDS.SPEC + ' specialty - Set specialty (doctors)',
    MESSAGES.COMMANDS.LOG + ' "directive" - Log directive (doctors)',
    MESSAGES.COMMANDS.ORDER + ' medication - Order medication (doctors)',
    MESSAGES.COMMANDS.AGENT + ' ask username "question" - Delegate to agent (doctors)',
    MESSAGES.COMMANDS.FEEDBACK + ' +1|-1 "comment" - Rate interaction',
    MESSAGES.COMMANDS.CONSENT + ' username level - Set consent (none/limited/full)'
];

export function setupCommandSuggestions(inputElement) {
    // Remove suggestions when input loses focus
    inputElement.addEventListener('blur', () => {
        // Delay removal to allow click events on suggestions
        setTimeout(() => {
            if (suggestionBox) {
                suggestionBox.remove();
                suggestionBox = null;
            }
        }, 200);
    });
    
    // Remove suggestions on Escape key
    inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && suggestionBox) {
            suggestionBox.remove();
            suggestionBox = null;
        }
    });
    
    inputElement.addEventListener('input', (e) => {
        const value = e.target.value;
        
        // Show suggestions if starts with /
        if (value.startsWith('/') && value.length > 1) {
            const matching = COMMANDS.filter(cmd => 
                cmd.toLowerCase().startsWith(value.toLowerCase())
            );
            
            if (matching.length > 0 && !suggestionBox) {
                suggestionBox = document.createElement('div');
                suggestionBox.style.cssText = `
                    position: absolute;
                    bottom: 60px;
                    left: 16px;
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 8px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    font-family: monospace;
                    font-size: 12px;
                    z-index: 100;
                    max-width: 500px;
                `;
                matching.forEach(cmd => {
                    const div = document.createElement('div');
                    div.textContent = cmd;
                    div.style.padding = '4px';
                    div.style.cursor = 'pointer';
                    div.style.borderBottom = '1px solid #eee';
                    div.addEventListener('click', () => {
                        const cmdText = cmd.split(' - ')[0];
                        inputElement.value = cmdText;
                        inputElement.focus();
                        if (suggestionBox) {
                            suggestionBox.remove();
                            suggestionBox = null;
                        }
                    });
                    suggestionBox.appendChild(div);
                });
                document.getElementById('chat-view').appendChild(suggestionBox);
            }
        } else if (suggestionBox) {
            suggestionBox.remove();
            suggestionBox = null;
        }
    });
}

