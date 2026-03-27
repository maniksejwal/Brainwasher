# Database Integrity and Data Isolation Rules

## Critical Data Protection Rules

### 🚫 **NEVER CROSS-CONTAMINATE DATABASES**

**Rule 1: Database Isolation**
- Production data (`care_circle_prod.db`) MUST NEVER be mixed with development data
- Simulation data (`care_circle_simulation.db`) MUST NEVER be mixed with production data  
- Development data (`care_circle_dev.db`) MUST NEVER be mixed with production data
- Test data (`:memory:` or `care_circle_test.db`) MUST be completely isolated

**Rule 2: Data Preservation**
- NEVER delete or truncate existing data without explicit user consent
- NEVER overwrite production databases with development/simulation data
- NEVER copy production data to development/simulation environments without proper anonymization
- ALL database migrations MUST be backward compatible

**Rule 3: Schema Changes**
- Database schema changes MUST use `ALTER TABLE` statements for backward compatibility
- NEVER drop existing columns without migration path
- NEVER change column types without data conversion
- ALL migrations MUST be tested on a copy before applying to production

## Database Environment Configuration

### Environment-Specific Database Paths

```javascript
// From config.js
DB_PATHS: {
    production: '/app/data/dbs/care_circle_prod.db',      // PRODUCTION DATA
    development: './data/dbs/care_circle_dev.db',         // DEV DATA  
    simulation: './data/dbs/care_circle_simulation.db',   // SIMULATION DATA
    test: ':memory:'                                      // TEMPORARY TEST DATA
}
```

### Database Selection Logic

The system selects databases based on:
1. **Explicit override**: `DB_PATH` environment variable
2. **Simulation mode**: `SIMULATION_MODE=true` → simulation database
3. **Environment**: `NODE_ENV` → corresponding database
4. **Default**: development database

## Data Migration Safety

### Safe Migration Pattern

```javascript
// ✅ CORRECT: Backward compatible migration
async function migrateDatabase(db) {
    // Check if column exists before adding
    const tableInfo = await db.all('PRAGMA table_info(table_name)');
    const hasColumn = tableInfo.some(col => col.name === 'new_column');
    
    if (!hasColumn && tableInfo.length > 0) {
        console.log('[Migration] Adding new_column to table_name...');
        await db.run('ALTER TABLE table_name ADD COLUMN new_column TEXT DEFAULT "default_value"');
    }
}
```

### ❌ **DANGEROUS OPERATIONS - NEVER DO THIS**

```javascript
// ❌ WRONG: Destructive operations
await db.run('DROP TABLE existing_table');           // Loses all data
await db.run('DELETE FROM users');                   // Loses all users
await db.run('UPDATE users SET data = NULL');        // Corrupts data
await db.exec('PRAGMA foreign_keys = OFF');          // Without re-enabling
```

## Database Backup Requirements

### Before Any Schema Changes
1. **Always backup the database first**
   ```bash
   cp care_circle_prod.db care_circle_prod_backup_$(date +%Y%m%d_%H%M%S).db
   ```

2. **Test migrations on a copy**
   ```bash
   cp care_circle_prod.db test_migration.db
   # Test migration on test_migration.db first
   ```

3. **Verify data integrity after migration**
   ```sql
   -- Check row counts
   SELECT COUNT(*) FROM users;
   SELECT COUNT(*) FROM messages;
   
   -- Check for NULL values in critical columns
   SELECT COUNT(*) FROM users WHERE user_id IS NULL;
   ```

## Environment-Specific Guidelines

### Development Environment
- Use `care_circle_dev.db` for all development work
- Safe to reset/clear development database for testing
- Can experiment with schema changes

### Simulation Environment  
- Use `care_circle_simulation.db` for all simulations
- Contains synthetic data for testing scenarios
- Can be reset between simulation runs if needed

### Production Environment
- Use `care_circle_prod.db` for real user data
- **NEVER** reset or clear production database
- ALL changes must be thoroughly tested first
- Require explicit backup before any modifications

## Monitoring and Validation

### Database Health Checks
```sql
-- Verify database integrity
PRAGMA integrity_check;

-- Check foreign key consistency  
PRAGMA foreign_key_check;

-- Verify table structure
.schema table_name
```

### Data Validation Rules
- User IDs must be unique and non-null
- Timestamps must be valid integers
- Foreign key relationships must be maintained
- JSON fields must contain valid JSON

## Emergency Procedures

### Data Recovery
1. **Stop the application immediately**
2. **Restore from the most recent backup**
3. **Verify data integrity**
4. **Investigate root cause**
5. **Implement prevention measures**

### Rollback Procedure
1. **Backup current state** (even if corrupted)
2. **Restore previous known good backup**
3. **Re-apply only verified safe migrations**
4. **Test thoroughly before resuming operations**

## Compliance and Auditing

### Change Tracking
- All database schema changes must be documented
- Migration scripts must be version controlled
- Database backups must be retained according to policy
- Access logs should be maintained for production databases

### Security Requirements
- Database files must have appropriate file permissions
- Connection strings must not be logged
- Sensitive data must be encrypted at rest
- Regular security audits of database access patterns

---

**Remember: Data is irreplaceable. When in doubt, backup first, test thoroughly, and preserve existing data.**