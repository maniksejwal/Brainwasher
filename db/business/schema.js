/**
 * @fileoverview Business domain database schema
 * CRM + ERP + Legal workflow tables (separate from medical)
 */

export async function initializeBusinessSchema(db) {
    // CRM: Leads and Opportunities
    await db.exec(`
        CREATE TABLE IF NOT EXISTS crm_leads (
            id TEXT PRIMARY KEY,
            company_name TEXT,
            contact_person TEXT,
            contact_user_id TEXT,
            value_estimate REAL,
            stage TEXT, -- 'prospect', 'qualified', 'opportunity', 'won', 'lost'
            source TEXT,
            assigned_to TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY(contact_user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS crm_opportunities (
            id TEXT PRIMARY KEY,
            lead_id TEXT,
            deal_name TEXT,
            value REAL,
            probability REAL,
            stage TEXT, -- 'proposal', 'negotiation', 'legal_review', 'closed_won', 'closed_lost'
            owner_user_id TEXT,
            counterparty_user_id TEXT,
            created_at INTEGER,
            expected_close_date INTEGER,
            actual_close_date INTEGER,
            FOREIGN KEY(lead_id) REFERENCES crm_leads(id)
        );

        CREATE TABLE IF NOT EXISTS crm_pipeline (
            id TEXT PRIMARY KEY,
            opportunity_id TEXT,
            stage TEXT,
            entered_at INTEGER,
            exited_at INTEGER,
            duration_hours REAL,
            FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
        );

        -- ERP: Inventory and Orders
        CREATE TABLE IF NOT EXISTS erp_inventory (
            id TEXT PRIMARY KEY,
            product_name TEXT,
            sku TEXT UNIQUE,
            quantity INTEGER,
            unit_price REAL,
            cost REAL,
            supplier TEXT,
            last_updated INTEGER
        );

        CREATE TABLE IF NOT EXISTS erp_orders (
            id TEXT PRIMARY KEY,
            order_number TEXT UNIQUE,
            customer_user_id TEXT,
            opportunity_id TEXT,
            items TEXT, -- JSON array
            total_value REAL,
            status TEXT, -- 'draft', 'submitted', 'approved', 'invoiced', 'paid', 'cancelled'
            created_at INTEGER,
            approved_by TEXT,
            approved_at INTEGER,
            FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
        );

        CREATE TABLE IF NOT EXISTS erp_invoices (
            id TEXT PRIMARY KEY,
            invoice_number TEXT UNIQUE,
            order_id TEXT,
            amount REAL,
            status TEXT, -- 'pending', 'sent', 'paid', 'overdue', 'cancelled'
            due_date INTEGER,
            paid_date INTEGER,
            created_at INTEGER,
            FOREIGN KEY(order_id) REFERENCES erp_orders(id)
        );

        -- Legal: Contract Review Workflow
        CREATE TABLE IF NOT EXISTS legal_contracts (
            id TEXT PRIMARY KEY,
            opportunity_id TEXT,
            contract_type TEXT, -- 'NDA', 'MSA', 'SOW', 'purchase_order'
            version INTEGER DEFAULT 1,
            content TEXT,
            status TEXT, -- 'draft', 'in_review', 'legal_approved', 'counter_proposed', 'signed', 'rejected'
            created_by TEXT,
            assigned_legal TEXT,
            risk_level TEXT, -- 'low', 'medium', 'high', 'critical'
            created_at INTEGER,
            reviewed_at INTEGER,
            approved_at INTEGER,
            FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
        );

        CREATE TABLE IF NOT EXISTS legal_clauses (
            id TEXT PRIMARY KEY,
            contract_id TEXT,
            clause_type TEXT,
            clause_text TEXT,
            risk_assessment TEXT,
            negotiable BOOLEAN DEFAULT 1,
            proposed_change TEXT,
            status TEXT, -- 'original', 'flagged', 'negotiated', 'approved', 'rejected'
            FOREIGN KEY(contract_id) REFERENCES legal_contracts(id)
        );

        -- Negotiation Sessions (Ephemeral - designed to be deleted)
        CREATE TABLE IF NOT EXISTS negotiation_sessions (
            id TEXT PRIMARY KEY,
            opportunity_id TEXT,
            participants TEXT, -- JSON array of user_ids
            topic TEXT,
            status TEXT, -- 'active', 'concluded', 'terminated'
            created_at INTEGER,
            expires_at INTEGER,
            concluded_at INTEGER,
            final_terms TEXT, -- JSON object with agreement
            FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
        );

        CREATE TABLE IF NOT EXISTS negotiation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            from_user_id TEXT,
            message_type TEXT, -- 'proposal', 'counter', 'question', 'acceptance', 'rejection'
            content TEXT,
            terms TEXT, -- JSON object
            timestamp INTEGER,
            ephemeral BOOLEAN DEFAULT 1, -- Will be deleted
            FOREIGN KEY(session_id) REFERENCES negotiation_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS negotiation_strategies (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            user_id TEXT,
            agent_state TEXT, -- JSON: internal agent reasoning, BATNA, limits
            calculated_moves TEXT, -- JSON: game theory calculations
            timestamp INTEGER,
            ephemeral BOOLEAN DEFAULT 1, -- Will be deleted
            FOREIGN KEY(session_id) REFERENCES negotiation_sessions(id)
        );

        -- Business User Roles
        CREATE TABLE IF NOT EXISTS business_roles (
            user_id TEXT,
            role TEXT, -- 'sales', 'buyer', 'legal', 'finance', 'executive'
            company TEXT,
            department TEXT,
            authority_level INTEGER, -- 1-10: approval authority
            PRIMARY KEY(user_id, role)
        );

        -- Activity Log (for CRM tracking)
        CREATE TABLE IF NOT EXISTS crm_activities (
            id TEXT PRIMARY KEY,
            lead_id TEXT,
            opportunity_id TEXT,
            activity_type TEXT, -- 'call', 'email', 'meeting', 'proposal', 'negotiation'
            description TEXT,
            user_id TEXT,
            timestamp INTEGER,
            FOREIGN KEY(lead_id) REFERENCES crm_leads(id),
            FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
        );
    `);

    console.log('[BusinessSchema] Business database schema initialized');
}

export default { initializeBusinessSchema };

