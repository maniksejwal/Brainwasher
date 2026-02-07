
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function fixTimestamps() {
    console.log('Opening database...');
    const db = await open({
        filename: './data/dbs/care_circle_simulation.db',
        driver: sqlite3.Database
    });

    console.log('Checking for text timestamps...');
    const rows = await db.all("SELECT feedback_id, timestamp FROM feedback WHERE typeof(timestamp) = 'text'");
    console.log(`Found ${rows.length} rows with text timestamps.`);

    if (rows.length > 0) {
        console.log('First 5 text timestamps:', rows.slice(0, 5).map(r => r.timestamp));

        console.log('Updating timestamps to integer milliseconds...');
        await db.run(`
            UPDATE feedback 
            SET timestamp = CAST(strftime('%s', timestamp) AS INTEGER) * 1000 
            WHERE typeof(timestamp) = 'text'
        `);
        console.log('Update complete.');
    } else {
        console.log('No text timestamps found.');
    }

    const check = await db.all("SELECT timestamp, typeof(timestamp) as type FROM feedback ORDER BY id DESC LIMIT 5");
    console.log('Recent timestamps after fix:', check);

    await db.close();
}

fixTimestamps().catch(console.error);
