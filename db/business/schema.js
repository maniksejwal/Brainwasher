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

        -- Comprehensive Organizational System
        CREATE TABLE IF NOT EXISTS organizations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT, -- 'corporation', 'llc', 'partnership', 'non_profit', 'government'
            parent_org_id TEXT,
            settings TEXT, -- JSON: org-wide preferences, policies
            created_at INTEGER,
            FOREIGN KEY(parent_org_id) REFERENCES organizations(id)
        );

        CREATE TABLE IF NOT EXISTS org_hierarchies (
            id TEXT PRIMARY KEY,
            org_id TEXT,
            user_id TEXT,
            role TEXT,
            reports_to TEXT, -- user_id of manager
            authority_level INTEGER, -- 1-10: approval authority
            department TEXT,
            title TEXT,
            start_date INTEGER,
            end_date INTEGER, -- NULL if active
            created_at INTEGER,
            FOREIGN KEY(org_id) REFERENCES organizations(id),
            FOREIGN KEY(reports_to) REFERENCES org_hierarchies(user_id)
        );

        CREATE TABLE IF NOT EXISTS role_definitions (
            id TEXT PRIMARY KEY,
            role_name TEXT UNIQUE,
            permissions TEXT, -- JSON: list of permissions
            approval_authority INTEGER, -- Max amount/level this role can approve
            delegation_rights TEXT, -- JSON: what this role can delegate
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS project_roles (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            user_id TEXT,
            role TEXT,
            temporary BOOLEAN DEFAULT 1,
            start_date INTEGER,
            end_date INTEGER,
            authority_level INTEGER,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS role_contexts (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            role_id TEXT,
            context_type TEXT, -- 'project', 'negotiation', 'document', 'meeting'
            context_id TEXT, -- ID of the specific project/negotiation/document/meeting
            active_when TEXT, -- JSON: conditions when this role is active
            priority INTEGER, -- Higher priority roles take precedence
            created_at INTEGER,
            FOREIGN KEY(role_id) REFERENCES role_definitions(id)
        );

        -- Legacy business roles table (keep for backward compatibility)
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

        -- Document Collaboration System
        CREATE TABLE IF NOT EXISTS org_documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT, -- Markdown content
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'draft', -- 'draft', 'in_review', 'approved', 'published'
            org_id TEXT,
            created_by TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY(org_id) REFERENCES organizations(id)
        );

        CREATE TABLE IF NOT EXISTS doc_collaborators (
            id TEXT PRIMARY KEY,
            doc_id TEXT,
            user_id TEXT,
            role TEXT, -- 'owner', 'editor', 'reviewer', 'viewer'
            permissions TEXT, -- JSON: ['read', 'write', 'approve', 'delete']
            notification_settings TEXT, -- JSON: notification preferences
            added_at INTEGER,
            FOREIGN KEY(doc_id) REFERENCES org_documents(id)
        );

        CREATE TABLE IF NOT EXISTS doc_versions (
            id TEXT PRIMARY KEY,
            doc_id TEXT,
            version_number INTEGER,
            content TEXT, -- Full markdown content
            content_diff TEXT, -- Git-like diff
            author TEXT,
            timestamp INTEGER,
            comment TEXT, -- Version comment/description
            approved_by TEXT,
            approved_at INTEGER,
            FOREIGN KEY(doc_id) REFERENCES org_documents(id)
        );

        CREATE TABLE IF NOT EXISTS approval_workflows (
            id TEXT PRIMARY KEY,
            doc_id TEXT,
            version_id TEXT,
            step INTEGER, -- Approval step number
            approver TEXT, -- User ID who needs to approve
            status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'skipped'
            deadline INTEGER,
            escalation_rule TEXT, -- JSON: escalation settings
            approved_at INTEGER,
            comment TEXT,
            FOREIGN KEY(doc_id) REFERENCES org_documents(id),
            FOREIGN KEY(version_id) REFERENCES doc_versions(id)
        );

        CREATE TABLE IF NOT EXISTS doc_comments (
            id TEXT PRIMARY KEY,
            doc_id TEXT,
            version_id TEXT,
            user_id TEXT,
            comment TEXT,
            line_number INTEGER, -- Specific line in markdown (optional)
            resolved BOOLEAN DEFAULT 0,
            created_at INTEGER,
            FOREIGN KEY(doc_id) REFERENCES org_documents(id),
            FOREIGN KEY(version_id) REFERENCES doc_versions(id)
        );

        -- Autonomous Actions Audit Trail
        CREATE TABLE IF NOT EXISTS autonomous_actions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            action_type TEXT, -- 'draft_created', 'autonomous_edit', 'companion_collaboration'
            metadata TEXT, -- JSON: action details, context, decisions made
            privacy_level TEXT, -- 'public', 'internal', 'confidential'
            autonomy_level TEXT, -- 'assisted', 'supervised', 'autonomous'
            timestamp INTEGER,
            requires_human_review BOOLEAN DEFAULT 0,
            human_reviewed_at INTEGER,
            human_reviewer TEXT
        );

        -- Privacy and Consent Chains
        CREATE TABLE IF NOT EXISTS consent_chains (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            resource_type TEXT, -- 'document', 'data', 'information'
            resource_id TEXT,
            consent_level TEXT, -- 'none', 'limited', 'full'
            granted_by TEXT, -- User ID who granted consent
            granted_to TEXT, -- User ID or 'companion' who received consent
            conditions TEXT, -- JSON: conditions and constraints
            expires_at INTEGER,
            created_at INTEGER
        );

        -- Document Privacy Controls
        CREATE TABLE IF NOT EXISTS doc_privacy_controls (
            id TEXT PRIMARY KEY,
            doc_id TEXT,
            privacy_level TEXT, -- 'public', 'internal', 'restricted', 'confidential'
            access_rules TEXT, -- JSON: detailed access rules
            sensitive_sections TEXT, -- JSON: sections requiring special approval
            disclosure_approvers TEXT, -- JSON: who can approve sensitive disclosures
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY(doc_id) REFERENCES org_documents(id)
        );

        -- Companion Autonomy Settings
        CREATE TABLE IF NOT EXISTS companion_autonomy (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            context_type TEXT, -- 'document', 'negotiation', 'communication'
            autonomy_level TEXT, -- 'disabled', 'assisted', 'supervised', 'autonomous'
            permissions TEXT, -- JSON: specific autonomous permissions
            constraints TEXT, -- JSON: limits and boundaries
            privacy_settings TEXT, -- JSON: privacy-related autonomy rules
            created_at INTEGER,
            updated_at INTEGER
        );
    `);

    // Insert default role definitions
    await db.exec(`
        INSERT OR IGNORE INTO role_definitions (id, role_name, permissions, approval_authority, delegation_rights, description) VALUES
        ('ceo', 'CEO', '["all"]', 1000000, '["all"]', 'Chief Executive Officer - Full authority'),
        ('cfo', 'CFO', '["finance", "budgets", "contracts"]', 500000, '["finance_team"]', 'Chief Financial Officer'),
        ('coo', 'COO', '["operations", "hr", "processes"]', 300000, '["operations_team"]', 'Chief Operating Officer'),
        ('vp_sales', 'VP Sales', '["crm", "sales", "negotiations"]', 100000, '["sales_team"]', 'Vice President of Sales'),
        ('sales_manager', 'Sales Manager', '["crm", "sales"]', 50000, '["sales_reps"]', 'Sales Manager'),
        ('sales_rep', 'Sales Rep', '["crm"]', 10000, '[]', 'Sales Representative'),
        ('legal_counsel', 'Legal Counsel', '["legal", "contracts", "compliance"]', 0, '["legal_team"]', 'Legal Counsel'),
        ('finance_manager', 'Finance Manager', '["budgets", "invoices"]', 25000, '["finance_team"]', 'Finance Manager'),
        ('project_manager', 'Project Manager', '["projects", "resources"]', 15000, '["project_team"]', 'Project Manager'),
        ('clinician', 'Clinician', '["medical", "patients"]', 0, '[]', 'Medical Professional'),
        ('admin', 'Administrator', '["system", "users"]', 0, '[]', 'System Administrator');
    `);

    console.log('[BusinessSchema] Business database schema initialized');
}

export default { initializeBusinessSchema };

