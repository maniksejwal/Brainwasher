import { getDb } from './db/connection.js';

async function migrateProfessionalCircles() {
    console.log('🔄 Migrating database for professional circle support...');
    
    const db = await getDb();
    
    try {
        // Check if columns already exist
        const tableInfo = await db.all('PRAGMA table_info(care_circles)');
        const columnNames = tableInfo.map(col => col.name);
        
        if (!columnNames.includes('circle_type')) {
            await db.exec('ALTER TABLE care_circles ADD COLUMN circle_type TEXT DEFAULT "medical"');
            console.log('✅ Added circle_type column');
        }
        
        if (!columnNames.includes('organization_context')) {
            await db.exec('ALTER TABLE care_circles ADD COLUMN organization_context TEXT');
            console.log('✅ Added organization_context column');
        }
        
        if (!columnNames.includes('coordination_engine')) {
            await db.exec('ALTER TABLE care_circles ADD COLUMN coordination_engine TEXT DEFAULT "medical_care"');
            console.log('✅ Added coordination_engine column');
        }
        
        console.log('✅ Database migration completed successfully!');
        
        // Verify migration
        const updatedTableInfo = await db.all('PRAGMA table_info(care_circles)');
        console.log('\n📋 Updated care_circles schema:');
        updatedTableInfo.forEach(col => {
            console.log(`   - ${col.name} (${col.type}) ${col.dflt_value ? `default: ${col.dflt_value}` : ''}`);
        });
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

migrateProfessionalCircles().catch(console.error);