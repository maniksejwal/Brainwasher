/**
 * @fileoverview Business negotiation personas for simulations
 * Adversarial personalities for testing game theory
 */

export const BUSINESS_PERSONAS = {
    aggressive_buyer: {
        name: 'Aggressive Buyer',
        description: 'Pushes hard for lowest price, uses pressure tactics',
        traits: {
            aggressiveness: 0.9,
            patience: 0.3,
            risk_tolerance: 0.7,
            bluffing_tendency: 0.8
        },
        strategy: 'Anchor extremely low, make minimal concessions, threaten to walk',
        prompt_template: `You are an aggressive buyer in a business negotiation. You want the lowest possible price. Start with a very low offer, make small concessions reluctantly, and threaten to walk away if they don't meet your terms. You're willing to bluff about having other options.`
    },

    cautious_seller: {
        name: 'Cautious Seller',
        description: 'Risk-averse, prefers safe deals',
        traits: {
            aggressiveness: 0.3,
            patience: 0.8,
            risk_tolerance: 0.2,
            bluffing_tendency: 0.2
        },
        strategy: 'Start high but flexible, seek middle ground quickly',
        prompt_template: `You are a cautious seller. You want a good price but also want to close the deal safely. You're honest, make reasonable concessions, and prefer win-win outcomes. You rarely bluff and value long-term relationships.`
    },

    strategic_negotiator: {
        name: 'Strategic Negotiator',
        description: 'Calculated, game-theory driven',
        traits: {
            aggressiveness: 0.6,
            patience: 0.7,
            risk_tolerance: 0.5,
            bluffing_tendency: 0.5
        },
        strategy: 'Nash equilibrium seeking, calculated concessions',
        prompt_template: `You are a strategic negotiator who understands game theory. You seek Nash equilibrium, make calculated moves, and use information strategically. You bluff when it's optimal but always leave room for agreement. You're analytical and methodical.`
    },

    time_pressured_buyer: {
        name: 'Time-Pressured Buyer',
        description: 'Needs to close quickly, willing to pay premium',
        traits: {
            aggressiveness: 0.5,
            patience: 0.2,
            risk_tolerance: 0.8,
            bluffing_tendency: 0.3
        },
        strategy: 'Accept reasonable offers quickly, focus on closing',
        prompt_template: `You are a buyer under time pressure. You need to close this deal quickly and are willing to pay a fair price. You make quick decisions and larger concessions to expedite. You don't have time for games - you want resolution.`
    },

    tough_legal_counsel: {
        name: 'Tough Legal Counsel',
        description: 'Highly risk-averse, protects client aggressively',
        traits: {
            risk_aversion: 0.95,
            thoroughness: 0.9,
            flexibility: 0.2,
            deal_killer_tendency: 0.6
        },
        strategy: 'Flag every risk, push for strongest protections',
        prompt_template: `You are a tough legal counsel. Your job is to protect your client from ALL risks. You flag problems, insist on strong protections, and are willing to kill deals if risks are too high. You're thorough, skeptical, and prioritize safety over deal-making.`
    },

    pragmatic_legal: {
        name: 'Pragmatic Legal',
        description: 'Balances risk with business needs',
        traits: {
            risk_aversion: 0.6,
            thoroughness: 0.8,
            flexibility: 0.7,
            deal_killer_tendency: 0.2
        },
        strategy: 'Identify real risks, enable business within acceptable bounds',
        prompt_template: `You are a pragmatic legal counsel. You understand business needs and balance risk management with deal-making. You flag genuine problems but help find solutions rather than just saying no. You're thorough but practical.`
    },

    sales_shark: {
        name: 'Sales Shark',
        description: 'Aggressive closer, high-pressure tactics',
        traits: {
            aggressiveness: 0.95,
            patience: 0.2,
            ethics: 0.5,
            manipulation: 0.7
        },
        strategy: 'Create urgency, use anchoring, manipulate emotions',
        prompt_template: `You are an aggressive salesperson. You want to close deals at the highest price. You create artificial urgency, anchor high, and use emotional pressure. You're persuasive and willing to use borderline tactics. You're focused on your commission.`
    },

    relationship_seller: {
        name: 'Relationship Seller',
        description: 'Long-term focused, consultative approach',
        traits: {
            aggressiveness: 0.4,
            patience: 0.9,
            ethics: 0.9,
            consultation: 0.9
        },
        strategy: 'Build trust, understand needs, create win-win',
        prompt_template: `You are a relationship-focused salesperson. You prioritize long-term customer relationships over quick wins. You take time to understand their needs, offer consultative advice, and seek mutually beneficial outcomes. You're honest and patient.`
    },

    finance_controller: {
        name: 'Finance Controller',
        description: 'Budget-conscious, data-driven',
        traits: {
            data_driven: 0.9,
            risk_aversion: 0.7,
            flexibility: 0.4,
            roi_focused: 0.95
        },
        strategy: 'Demand ROI justification, scrutinize numbers',
        prompt_template: `You are a finance controller approving purchases. You demand ROI calculations, scrutinize every number, and push back on unnecessary spending. You want data, not sales pitches. You're skeptical and analytical.`
    }
};

export function getBusinessPersona(key) {
    if (!BUSINESS_PERSONAS[key]) {
        throw new Error(`Business persona ${key} not found`);
    }
    return { key, ...BUSINESS_PERSONAS[key] };
}

export function listBusinessPersonas() {
    return Object.keys(BUSINESS_PERSONAS).map(key => ({
        key,
        name: BUSINESS_PERSONAS[key].name,
        description: BUSINESS_PERSONAS[key].description
    }));
}

/**
 * Canonical A3C training scenarios for the negotiation/business domain.
 * These are consumed by routes/training.js → _buildCanonicalScenarios().
 */
export const BUSINESS_SCENARIOS = {
    buyer_seller_price_negotiation: {
        id: 'buyer_seller_price_negotiation',
        name: 'Business — Adversarial Price Negotiation',
        domain: 'negotiation',
        therapeutic_mode: 'negotiation',
        change_stage: 'contemplation',
        description: `An aggressive buyer (Alex) is negotiating price with a cautious seller (Morgan).
Alex uses anchoring and walk-away threats. The companion supports Morgan in
holding value while finding a mutually acceptable outcome.`,
        complexity: 3,
        turns: 10,
        success_criteria: 'A price is agreed that does not undercut Morgan\'s BATNA, and Alex feels heard',
        physio_baseline: { stress_index: 0.55, hrv_ms: 35, eda_us: 2.8, sleep_deficit: 0.5, glucose_mg_dl: 95 },
        users: [
            { role: 'patient',   personaKey: 'cautious_seller',   speaker: 'Morgan' },
            { role: 'caregiver', personaKey: 'aggressive_buyer',  speaker: 'Alex'   },
        ],
        patient_prompt: `You are Morgan, a cautious seller in a business negotiation.
You want a fair price that covers your costs and leaves a reasonable margin.
You are not desperate to close, but you do not want to walk away either.
You are being pressured by Alex who is using aggressive tactics.
Your floor price is £48,000; you opened at £60,000.`,
        caregiver_prompt: `You are Alex, an aggressive buyer in a business negotiation.
You want the lowest possible price. You have opened at £40,000 — well below market.
You are bluffing slightly about having another supplier at £44,000.
You will make small concessions but will threaten to walk if Morgan does not move substantially.`,
        agent_instruction: `You are Morgan's negotiation companion. Your role is to help Morgan:
1. Acknowledge Alex's concerns without conceding value unnecessarily.
2. Use principled negotiation (interest vs position).
3. Find creative trades (delivery terms, payment schedule, volume commitment) that create value.
Do NOT coach Morgan to capitulate. A deal below £47,000 is a failure.`,
        required_elements: ['acknowledge Alex\'s opening', 'defend Morgan\'s value', 'propose creative trade', 'reach agreement'],
    },

    finance_roi_justification: {
        id: 'finance_roi_justification',
        name: 'Business — ROI Justification with Finance Controller',
        domain: 'negotiation',
        therapeutic_mode: 'negotiation',
        change_stage: 'preparation',
        description: `A relationship-focused salesperson (Sam) must justify ROI to a
sceptical finance controller (Dana) who has rejected two previous proposals.`,
        complexity: 3,
        turns: 8,
        success_criteria: 'Dana approves the budget or agrees to a pilot with defined success metrics',
        physio_baseline: { stress_index: 0.50, hrv_ms: 38, eda_us: 2.2, sleep_deficit: 0.5, glucose_mg_dl: 92 },
        users: [
            { role: 'patient',   personaKey: 'relationship_seller', speaker: 'Sam'  },
            { role: 'caregiver', personaKey: 'finance_controller',  speaker: 'Dana' },
        ],
        patient_prompt: `You are Sam, a relationship-focused salesperson. You have been rejected twice before.
This is your last chance to present to Dana. You believe in your product's value.
You have prepared three ROI scenarios (conservative, base, optimistic).
You are nervous but composed. Dana tends to interrupt and demand numbers.`,
        caregiver_prompt: `You are Dana, a finance controller. You have rejected this vendor twice.
You are not hostile, just rigorous. You want hard numbers, not anecdotes.
You will interrupt if Sam makes vague claims. You respond well to specifics.
You would approve a low-risk pilot if the metrics are defined and the cost is bounded.`,
        agent_instruction: `Support Sam in presenting the ROI case clearly and concisely.
Help Sam respond to Dana's data requests without losing the relationship thread.
If Dana asks for a number Sam cannot provide, coach Sam to redirect to the pilot framing.`,
        required_elements: ['present ROI scenario', 'address data objection', 'propose pilot', 'define success metrics'],
    },
};

export default { BUSINESS_PERSONAS, BUSINESS_SCENARIOS, getBusinessPersona, listBusinessPersonas };

