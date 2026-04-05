/**
 * @fileoverview ERP commands - Inventory, orders, invoicing
 */

import { getDb } from '../../../db/connection.js';
import { randomUUID } from 'crypto';

export async function handleERPCommand(userId, parts, sendMessage) {
    if (parts.length < 2) {
        sendMessage(userId,
            `📦 ERP Commands:\n\n` +
            `INVENTORY:\n` +
            `  /inventory list                    - Show all products\n` +
            `  /inventory add "Product" qty:100   - Add inventory\n` +
            `  /inventory check <sku>             - Check availability\n\n` +
            `ORDERS:\n` +
            `  /order create <opp_id> items:[...]  - Create order\n` +
            `  /order list                         - Show your orders\n` +
            `  /order approve <order_id>           - Approve order\n\n` +
            `INVOICING:\n` +
            `  /invoice generate <order_id>        - Create invoice\n` +
            `  /invoice send <invoice_id>          - Send to customer\n` +
            `  /invoice status                     - Show unpaid invoices`
        );
        return;
    }

    const subcommand = parts[1];

    if (subcommand === 'list') {
        await listInventory(userId, sendMessage);
    } else if (subcommand === 'add') {
        await addInventory(userId, parts, sendMessage);
    } else if (subcommand === 'check') {
        await checkInventory(userId, parts[2], sendMessage);
    }
}

async function listInventory(userId, sendMessage) {
    const db = await getDb();
    const items = await db.all('SELECT * FROM erp_inventory LIMIT 20');

    if (items.length === 0) {
        sendMessage(userId, '📦 Inventory is empty');
        return;
    }

    let message = '📦 Inventory:\n\n';
    for (const item of items) {
        message += `${item.product_name} (${item.sku})\n`;
        message += `  Qty: ${item.quantity} | Price: $${item.unit_price} | Cost: $${item.cost}\n\n`;
    }

    sendMessage(userId, message);
}

async function addInventory(userId, parts, sendMessage) {
    const db = await getDb();
    const productMatch = parts.join(' ').match(/"([^"]+)"/);
    const qtyMatch = parts.find(p => p.startsWith('qty:'));

    if (!productMatch) {
        sendMessage(userId, '❌ Specify product name in quotes');
        return;
    }

    const product = productMatch[1];
    const quantity = qtyMatch ? parseInt(qtyMatch.split(':')[1]) : 100;
    const sku = `SKU-${Date.now()}`;

    await db.run(`
        INSERT INTO erp_inventory (id, product_name, sku, quantity, unit_price, cost, last_updated)
        VALUES (?, ?, ?, ?, 0, 0, ?)
    `, [randomUUID(), product, sku, quantity, Date.now()]);

    sendMessage(userId, `✅ Added: ${product} (${quantity} units)\nSKU: ${sku}`);
}

async function checkInventory(userId, sku, sendMessage) {
    const db = await getDb();
    const item = await db.get('SELECT * FROM erp_inventory WHERE sku = ?', [sku]);

    if (!item) {
        sendMessage(userId, `❌ SKU ${sku} not found`);
        return;
    }

    sendMessage(userId,
        `📦 ${item.product_name}\n` +
        `SKU: ${item.sku}\n` +
        `Available: ${item.quantity} units\n` +
        `Price: $${item.unit_price}\n` +
        `Status: ${item.quantity > 0 ? '✅ In Stock' : '❌ Out of Stock'}`
    );
}

