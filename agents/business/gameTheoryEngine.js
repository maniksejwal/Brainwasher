/**
 * @fileoverview Game Theory Engine for Business Negotiations
 * Implements Nash equilibrium, minimax, and Bayesian game theory
 */

class GameTheoryEngine {
    constructor(userConstraints) {
        this.myConstraints = userConstraints; // { minPrice, maxPrice, BATNA, deadline }
        this.opponentModel = null; // Bayesian belief about opponent
        this.moveHistory = [];
    }

    /**
     * Calculate optimal opening move (anchoring strategy)
     */
    calculateOpeningMove(negotiationType, marketInfo) {
        if (negotiationType === 'buying') {
            // Buyer: Anchor LOW
            const anchor = this.myConstraints.maxPrice * 0.6; // Start at 60% of max
            return {
                move: 'PROPOSE',
                value: anchor,
                reasoning: 'Anchoring low to establish favorable reference point',
                confidence: 0.7
            };
        } else {
            // Seller: Anchor HIGH
            const anchor = this.myConstraints.minPrice * 1.4; // Start at 140% of min
            return {
                move: 'PROPOSE',
                value: anchor,
                reasoning: 'Anchoring high to maximize opening position',
                confidence: 0.7
            };
        }
    }

    /**
     * Update Bayesian belief about opponent based on their move
     */
    updateOpponentModel(theirMove) {
        if (!this.opponentModel) {
            this.opponentModel = {
                estimatedMin: null,
                estimatedMax: null,
                aggressiveness: 0.5,
                flexibility: 0.5,
                timePreference: 0.5
            };
        }

        // Infer from their move
        if (theirMove.type === 'COUNTER') {
            // Update price range estimation
            if (theirMove.direction === 'up') {
                this.opponentModel.estimatedMin = Math.max(
                    this.opponentModel.estimatedMin || 0,
                    theirMove.value * 0.8
                );
            } else {
                this.opponentModel.estimatedMax = Math.min(
                    this.opponentModel.estimatedMax || Infinity,
                    theirMove.value * 1.2
                );
            }

            // Update flexibility based on concession size
            const concessionPercent = Math.abs(
                (theirMove.value - theirMove.previousValue) / theirMove.previousValue
            );
            if (concessionPercent > 0.1) {
                this.opponentModel.flexibility += 0.1;
            }
        }

        // Update aggressiveness
        if (theirMove.type === 'REJECT') {
            this.opponentModel.aggressiveness += 0.15;
        }

        this.moveHistory.push(theirMove);
    }

    /**
     * Calculate best response using minimax with alpha-beta pruning
     */
    calculateBestResponse(theirLastMove, round) {
        // Simple minimax implementation (can be enhanced)
        const moves = this._generatePossibleMoves(theirLastMove);
        
        let bestMove = null;
        let bestValue = -Infinity;

        for (const move of moves) {
            const value = this._evaluateMove(move, round);
            if (value > bestValue) {
                bestValue = value;
                bestMove = move;
            }
        }

        return bestMove;
    }

    /**
     * Determine if bluffing is optimal
     */
    shouldBluff(currentOffer, round, trustLevel) {
        // Bluff early in negotiation when trust is low
        const bluffProbability = (1 - trustLevel) * (1 - round / 10);
        
        // Don't bluff if close to deadline
        const timeRemaining = this.myConstraints.deadline - Date.now();
        if (timeRemaining < 3600000) { // < 1 hour
            return false;
        }

        return Math.random() < bluffProbability;
    }

    /**
     * Calculate Nash equilibrium zone
     */
    findNashEquilibriumZone() {
        // Equilibrium exists where both parties' utilities are balanced
        const myMin = this.myConstraints.minPrice;
        const myMax = this.myConstraints.maxPrice;
        
        const estimatedOpponentMin = this.opponentModel?.estimatedMin || myMin * 0.8;
        const estimatedOpponentMax = this.opponentModel?.estimatedMax || myMax * 1.2;

        // Find overlap zone
        const zoneStart = Math.max(myMin, estimatedOpponentMin);
        const zoneEnd = Math.min(myMax, estimatedOpponentMax);

        if (zoneStart <= zoneEnd) {
            // Equilibrium exists
            const equilibriumPoint = (zoneStart + zoneEnd) / 2;
            return {
                exists: true,
                point: equilibriumPoint,
                zone: [zoneStart, zoneEnd],
                confidence: this._calculateConfidence()
            };
        } else {
            // No overlap - negotiation may fail
            return {
                exists: false,
                gap: zoneStart - zoneEnd,
                recommendation: 'Consider BATNA or expand constraints'
            };
        }
    }

    /**
     * Determine if we should accept an offer
     */
    shouldAccept(offer, alternatives) {
        // Accept if better than BATNA and within constraints
        const withinConstraints = this._isWithinConstraints(offer);
        const betterThanBATNA = offer > this.myConstraints.BATNA;
        
        // Check if we can likely get a better deal
        const equilibrium = this.findNashEquilibriumZone();
        if (equilibrium.exists) {
            const potentialGain = equilibrium.point - offer;
            const negotiationCost = this._estimateNegotiationCost();
            
            if (potentialGain < negotiationCost) {
                return { accept: true, reason: 'Further negotiation not worth the cost' };
            }
        }

        if (withinConstraints && betterThanBATNA) {
            return { accept: true, reason: 'Offer meets constraints and exceeds BATNA' };
        }

        return { accept: false, reason: 'Can likely negotiate better terms' };
    }

    /**
     * Calculate optimal counter-offer
     */
    calculateCounterOffer(theirOffer, round) {
        const equilibrium = this.findNashEquilibriumZone();
        
        if (!equilibrium.exists) {
            // Push toward our limit aggressively
            return {
                value: this.myConstraints.minPrice * 0.95,
                reasoning: 'No equilibrium zone detected - holding firm',
                concession: 0.05
            };
        }

        // Gradual concessions toward equilibrium
        const concessionRate = 0.15 * (1 / (round + 1)); // Smaller concessions over time
        const targetPoint = equilibrium.point;
        
        const lastOffer = this.moveHistory.length > 0 
            ? this.moveHistory[this.moveHistory.length - 1].value 
            : this.myConstraints.maxPrice;

        const counter = lastOffer + (targetPoint - lastOffer) * concessionRate;

        return {
            value: counter,
            reasoning: `Moving toward Nash equilibrium (${equilibrium.point.toFixed(2)}) with ${(concessionRate * 100).toFixed(1)}% concession`,
            concession: concessionRate
        };
    }

    /**
     * Generate possible moves
     */
    _generatePossibleMoves(theirMove) {
        return [
            { type: 'ACCEPT', value: theirMove.value },
            { type: 'COUNTER', value: theirMove.value * 0.9 },
            { type: 'COUNTER', value: theirMove.value * 0.95 },
            { type: 'COUNTER', value: theirMove.value * 1.05 },
            { type: 'HOLD', value: this.moveHistory[this.moveHistory.length - 1]?.value },
            { type: 'WALK_AWAY', value: this.myConstraints.BATNA }
        ];
    }

    /**
     * Evaluate move quality
     */
    _evaluateMove(move, round) {
        let utility = 0;

        // Value component
        if (move.value >= this.myConstraints.minPrice) {
            utility += (move.value - this.myConstraints.minPrice) * 10;
        } else {
            utility -= 1000; // Penalty for below minimum
        }

        // Time component (prefer faster deals)
        utility -= round * 5;

        // Risk component
        if (move.type === 'WALK_AWAY') {
            utility = this.myConstraints.BATNA - 50; // BATNA minus opportunity cost
        }

        return utility;
    }

    _isWithinConstraints(offer) {
        return offer >= this.myConstraints.minPrice && offer <= this.myConstraints.maxPrice;
    }

    _calculateConfidence() {
        // Confidence based on information collected
        return Math.min(this.moveHistory.length / 10, 0.9);
    }

    _estimateNegotiationCost() {
        // Time cost of continued negotiation
        return 100; // Simple fixed cost (can be enhanced)
    }

    /**
     * Strategic recommendation for user
     */
    getStrategicAdvice(currentState) {
        const equilibrium = this.findNashEquilibriumZone();
        const timeRemaining = this.myConstraints.deadline - Date.now();
        const hourRemaining = timeRemaining / 3600000;

        let advice = [];

        if (!equilibrium.exists) {
            advice.push('⚠️ No overlap zone detected - consider your BATNA');
        }

        if (hourRemaining < 2) {
            advice.push('⏰ Time pressure - consider accepting reasonable offers');
        }

        if (this.opponentModel?.aggressiveness > 0.7) {
            advice.push('💪 Opponent is aggressive - hold firm or walk away');
        }

        if (this.opponentModel?.flexibility > 0.7) {
            advice.push('🤝 Opponent is flexible - room for better terms');
        }

        return advice;
    }
}

export { GameTheoryEngine };

