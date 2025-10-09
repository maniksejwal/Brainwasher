-- WhatsApp Integration Database Tables
-- Add these to your existing care_circle.db

-- Map phone numbers to user IDs
CREATE TABLE IF NOT EXISTS whatsapp_users (
    phone_number TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    first_seen INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    last_active INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

-- Track WhatsApp session state (active circle)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    user_id TEXT PRIMARY KEY,
    active_circle_id TEXT,
    last_updated INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

-- Optional: Message delivery tracking
CREATE TABLE IF NOT EXISTS whatsapp_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    phone_number TEXT,
    message TEXT,
    sent_at INTEGER,
    delivered_at INTEGER,
    read_at INTEGER,
    status TEXT, -- 'sent', 'delivered', 'read', 'failed'
    aisensy_message_id TEXT
);

