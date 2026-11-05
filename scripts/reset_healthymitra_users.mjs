/**
 * @fileoverview scripts/reset_healthymitra_users.mjs
 * Gives HealthyMitra users a fresh start here: their next message provisions a new local
 * user, conversation and care circle, so no earlier chat, facts or escalations come back.
 * For demo and test accounts. HealthyMitra's own reference to the conversation must be
 * removed as well (its demo seed does that).
 *
 * The old local users are kept, renamed, so the display names are free for the new ones.
 *
 * Usage:
 *   node scripts/reset_healthymitra_users.mjs <name or HealthyMitra user ID>...
 *
 * Example:
 *   node scripts/reset_healthymitra_users.mjs "Ramesh Sharma" "Priya Sharma" "Dr. Anjali Mehta"
 */
import 'dotenv/config';
import { getDb } from '../db/connection.js';
import { PROVIDER, PROVISION_PURPOSE } from '../services/integrationService.js';

const HM_USER_ID = /^[0-9a-f]{24}$/i;

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error('Usage: node scripts/reset_healthymitra_users.mjs <name or HealthyMitra user ID>...');
    process.exit(1);
}

const db = await getDb();
const resetAt = new Date().toISOString().replace(/[:.]/g, '-');
let failed = false;

for (const target of targets) {
    const link = HM_USER_ID.test(target)
        ? await db.get(
            `SELECT e.external_user_id, e.user_id, u.username FROM external_identities e
             JOIN users u ON u.user_id = e.user_id WHERE e.provider = ? AND e.external_user_id = ?`,
            [PROVIDER, target])
        : await db.get(
            `SELECT e.external_user_id, e.user_id, u.username FROM external_identities e
             JOIN users u ON u.user_id = e.user_id WHERE e.provider = ? AND u.username = ?`,
            [PROVIDER, target]);

    if (!link) {
        console.log(`- ${target}: nothing to reset`);
        continue;
    }

    try {
        await db.exec('BEGIN');
        await db.run('UPDATE users SET username = ? WHERE user_id = ?', [`${link.username} (reset ${resetAt})`, link.user_id]);
        await db.run('DELETE FROM external_identities WHERE provider = ? AND external_user_id = ?', [PROVIDER, link.external_user_id]);
        // Provisioning is idempotent per user, so its stored response would return the old conversation
        await db.run('DELETE FROM integration_idempotency WHERE external_user_id = ? AND purpose = ?', [link.external_user_id, PROVISION_PURPOSE]);
        await db.exec('COMMIT');
        console.log(`- ${link.username}: reset`);
    } catch (error) {
        await db.exec('ROLLBACK');
        console.error(`- ${link.username}: could not reset (${error.message})`);
        failed = true;
    }
}

await db.close();
process.exit(failed ? 1 : 0);
