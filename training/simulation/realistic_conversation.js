/**
 * @fileoverview Realistic Multi-User Conversation Engine
 * Models natural conversation flow based on context, needs, and relationships
 */

export class RealisticConversationEngine {
    constructor() {
        this.conversationState = {
            patientNeedsHelp: false,
            caregiverConcerned: false,
            doctorAsked: false,
            crisisLevel: 0, // 0 = normal, 1 = concern, 2 = urgent, 3 = crisis
            lastSpeakerRole: null,
            conversationMomentum: 'patient_led', // patient_led, caregiver_led, doctor_led, crisis_mode
            topicsDiscussed: new Set(),
            emotionalTension: 0
        };
    }

    /**
     * Determine who should speak next based on realistic conversation dynamics
     */
    selectNextSpeaker(turn, users, conversationHistory) {
        const { patientUser, caregiverUsers, doctorUsers } = this._categorizeUsers(users);
        
        // Update conversation state based on recent messages
        this._updateConversationState(conversationHistory);
        
        // Determine conversation momentum
        this._updateConversationMomentum(conversationHistory);
        
        // Select speaker based on realistic scenarios
        return this._selectSpeakerByContext(patientUser, caregiverUsers, doctorUsers, turn);
    }

    /**
     * Categorize users by role
     */
    _categorizeUsers(users) {
        return {
            patientUser: users.find(u => u.role === 'patient'),
            caregiverUsers: users.filter(u => u.role === 'caregiver'),
            doctorUsers: users.filter(u => u.role === 'doctor')
        };
    }

    /**
     * Update conversation state based on recent messages
     */
    _updateConversationState(conversationHistory) {
        const recentMessages = conversationHistory.slice(-3); // Last 3 exchanges
        
        // Reset state flags
        this.conversationState.patientNeedsHelp = false;
        this.conversationState.caregiverConcerned = false;
        this.conversationState.doctorAsked = false;
        
        // Analyze recent messages for context
        recentMessages.forEach(msg => {
            if (msg.role === 'user') {
                const content = msg.content.toLowerCase();
                
                // Detect patient distress signals
                if (content.includes('struggling') || content.includes('confused') || 
                    content.includes('worried') || content.includes('pain') ||
                    content.includes('difficult') || content.includes('help')) {
                    this.conversationState.patientNeedsHelp = true;
                    this.conversationState.crisisLevel = Math.min(this.conversationState.crisisLevel + 1, 3);
                }
                
                // Detect caregiver concerns
                if (content.includes('concerned') || content.includes('worried') ||
                    content.includes('update') || content.includes('progress') ||
                    content.includes('symptoms') || content.includes('complications')) {
                    this.conversationState.caregiverConcerned = true;
                }
                
                // Detect doctor requests
                if (content.includes('doctor') || content.includes('clinical') ||
                    content.includes('treatment') || content.includes('recommendation')) {
                    this.conversationState.doctorAsked = true;
                }
                
                // Detect crisis indicators
                if (content.includes('emergency') || content.includes('urgent') ||
                    content.includes('critical') || content.includes('crisis')) {
                    this.conversationState.crisisLevel = 3;
                    this.conversationState.conversationMomentum = 'crisis_mode';
                }
            }
        });
        
        // Track emotional tension
        this._calculateEmotionalTension(recentMessages);
    }

    /**
     * Calculate emotional tension based on conversation content
     */
    _calculateEmotionalTension(messages) {
        let tension = 0;
        
        messages.forEach(msg => {
            if (msg.role === 'user') {
                const content = msg.content.toLowerCase();
                
                // Increase tension indicators
                if (content.includes('frustrated') || content.includes('angry') ||
                    content.includes('upset') || content.includes('disappointed')) {
                    tension += 2;
                } else if (content.includes('concerned') || content.includes('worried')) {
                    tension += 1;
                }
                
                // Decrease tension indicators
                if (content.includes('thank') || content.includes('appreciate') ||
                    content.includes('better') || content.includes('improving')) {
                    tension -= 1;
                }
            }
        });
        
        this.conversationState.emotionalTension = Math.max(0, Math.min(tension, 5));
    }

    /**
     * Update conversation momentum based on context
     */
    _updateConversationMomentum(conversationHistory) {
        const recentMessages = conversationHistory.slice(-2);
        
        if (this.conversationState.crisisLevel >= 3) {
            this.conversationState.conversationMomentum = 'crisis_mode';
        } else if (this.conversationState.caregiverConcerned && !this.conversationState.doctorAsked) {
            this.conversationState.conversationMomentum = 'caregiver_led';
        } else if (this.conversationState.doctorAsked) {
            this.conversationState.conversationMomentum = 'doctor_led';
        } else if (this.conversationState.patientNeedsHelp) {
            this.conversationState.conversationMomentum = 'patient_led';
        }
        
        // Track last speaker
        if (recentMessages.length > 0) {
            const lastMessage = recentMessages[recentMessages.length - 1];
            // This would need to be tracked differently in real implementation
            // For now, we'll use a simple heuristic
        }
    }

    /**
     * Select speaker based on realistic conversation context
     */
    _selectSpeakerByContext(patientUser, caregiverUsers, doctorUsers, turn) {
        const { conversationMomentum, crisisLevel, patientNeedsHelp, caregiverConcerned, doctorAsked } = this.conversationState;
        
        // Crisis mode - doctor takes priority
        if (conversationMomentum === 'crisis_mode' && doctorUsers.length > 0) {
            return this._selectDoctor(doctorUsers, 'crisis');
        }
        
        // Patient needs help - patient speaks first
        if (patientNeedsHelp && conversationMomentum === 'patient_led') {
            return patientUser;
        }
        
        // Caregiver is concerned but doctor hasn't been asked yet
        if (caregiverConcerned && !doctorAsked && caregiverUsers.length > 0) {
            return this._selectConcernedCaregiver(caregiverUsers);
        }
        
        // Doctor was asked - doctor responds
        if (doctorAsked && doctorUsers.length > 0) {
            return this._selectDoctor(doctorUsers, 'response');
        }
        
        // Normal conversation flow - let orchestrator decide
        if (turn === 0) {
            // Patient always starts
            return patientUser;
        } else {
            // Let orchestrator decide who speaks next based on context
            // This is more realistic - conversations don't follow rigid patterns
            const availableUsers = [patientUser, ...caregiverUsers, ...doctorUsers].filter(Boolean);
            
            // Simple random selection weighted by role importance
            const weights = {
                patient: 0.6,
                caregiver: 0.3, 
                doctor: 0.1
            };
            
            const random = Math.random();
            let cumulativeWeight = 0;
            
            for (const user of availableUsers) {
                cumulativeWeight += weights[user.role] || 0.1;
                if (random <= cumulativeWeight) {
                    return user;
                }
            }
            
            // Fallback to patient
            return patientUser;
        }
    }

    /**
     * Select appropriate caregiver based on context
     */
    _selectCaregiver(caregiverUsers) {
        // In a real implementation, this would consider:
        // - Relationship to patient
        // - Consent levels
        // - Recent activity
        // - Personality traits
        
        // For now, use simple selection
        return caregiverUsers[Math.floor(Math.random() * caregiverUsers.length)];
    }

    /**
     * Select concerned caregiver (likely the primary one)
     */
    _selectConcernedCaregiver(caregiverUsers) {
        // Primary caregiver (first in list) is usually most concerned
        return caregiverUsers[0] || caregiverUsers[Math.floor(Math.random() * caregiverUsers.length)];
    }

    /**
     * Select appropriate doctor based on context
     */
    _selectDoctor(doctorUsers, context) {
        // In a real implementation, this would consider:
        // - Specialty relevance
        // - Availability
        // - Relationship to case
        
        if (context === 'crisis') {
            // In crisis, any available doctor
            return doctorUsers[0];
        } else {
            // Normal selection
            return doctorUsers[Math.floor(Math.random() * doctorUsers.length)];
        }
    }

    /**
     * Get conversation context for message generation
     */
    getConversationContext() {
        return {
            momentum: this.conversationState.conversationMomentum,
            crisisLevel: this.conversationState.crisisLevel,
            emotionalTension: this.conversationState.emotionalTension,
            patientNeedsHelp: this.conversationState.patientNeedsHelp,
            caregiverConcerned: this.conversationState.caregiverConcerned,
            doctorAsked: this.conversationState.doctorAsked
        };
    }

    /**
     * Reset conversation state for new scenario
     */
    reset() {
        this.conversationState = {
            patientNeedsHelp: false,
            caregiverConcerned: false,
            doctorAsked: false,
            crisisLevel: 0,
            lastSpeakerRole: null,
            conversationMomentum: 'patient_led',
            topicsDiscussed: new Set(),
            emotionalTension: 0
        };
    }
}

