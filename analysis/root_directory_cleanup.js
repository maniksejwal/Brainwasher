/**
 * Root Directory Cleanup Analysis
 * Files that should be moved to appropriate directories or deleted
 */

// ============================================================================
// FILES THAT CAN BE DELETED
// ============================================================================

const FILES_TO_DELETE = {
    
    // Database files (temporary/test data)
    database_files: [
        'care_circle.db',                      // Old/abandoned database
        'care_circle_simulation.db',           // Test simulation data
        'care_circle_world_simulation.db',     // Test simulation data
        'care_circle_world_simulation.db-shm', // SQLite temp files
        'care_circle_world_simulation.db-wal', // SQLite temp files
        'test_simulation.db',                  // Test database
        'test_simulation.db-shm',              // SQLite temp files
        'test_simulation.db-wal'               // SQLite temp files
    ],
    reasoning: 'Test/development databases should not be in root. Production DB is in data/dbs/',
    
    // Debug files (temporary development files)  
    debug_files: [
        'debug_foreign_key.js',
        'debug_social_circle.js',
        'debug_logger.js',
        'debug_pipeline.js', 
        'debug_scenarios.js'
    ],
    reasoning: 'Debug files are temporary. Should be deleted or moved to dedicated debug/ folder',
    
    // Log files (should be in logs/)
    log_files: [
        'deploy.log',
        'deploy_output.txt', 
        'deploy_run.log',
        'ps_error.log'
    ],
    reasoning: 'Log files cluttering root directory. Should be in logs/ or .gitignored',
    
    // Event/output files (temporary data)
    temp_data_files: [
        'cf_events.json',
        'events.json',
        'events5.json',
        'iam_policy.json',
        'id.json',
        'stack.json'
    ],
    reasoning: 'Temporary output files from scripts. Should be .gitignored or in temp/',
    
    // Migration files (should be in db/migrations/)
    migration_files: [
        'migrate_professional_circles.js'
    ],
    reasoning: 'Migration files should be in db/migrations/ not root',
    
    // Test files (should be in tests/)
    test_files: [
        'test_backward_compatibility_simple.js',
        'run_test_scenario.js',
        'verify_contextual_bandit.js'
    ],
    reasoning: 'Test files should be in tests/ directory for organization',
    
    // Old/unused files
    deprecated_files: [
        'doctor_client.js',      // Looks like old demo/test file
        'behavioral_models.js',  // May be unused
        'checklist_framework.js' // May be unused
    ],
    reasoning: 'Check if still used, if not delete. If used, move to appropriate directory'
};

// ============================================================================
// DIRECTORY STRUCTURE RECOMMENDATIONS  
// ============================================================================

const DIRECTORY_STRUCTURE_FIXES = {
    
    create_missing_directories: [
        'logs/',           // For all log files
        'db/migrations/',  // For database migration files
        'temp/',           // For temporary output files
        'debug/'           // For debug scripts (optional)
    ],
    
    move_files: {
        'logs/': [
            'deploy.log',
            'deploy_output.txt',
            'deploy_run.log', 
            'ps_error.log'
        ],
        'db/migrations/': [
            'migrate_professional_circles.js'
        ],
        'tests/': [
            'test_backward_compatibility_simple.js',
            'run_test_scenario.js',
            'verify_contextual_bandit.js'
        ],
        'temp/': [
            'cf_events.json',
            'events.json', 
            'events5.json',
            'iam_policy.json',
            'id.json',
            'stack.json'
        ]
    },
    
    gitignore_additions: [
        '*.log',
        '*.db',
        '*.db-shm',
        '*.db-wal', 
        'temp/',
        'debug/',
        'logs/',
        'events*.json',
        'deploy_output.txt',
        '*_error.log'
    ]
};

// ============================================================================
// CLEANUP COMMANDS
// ============================================================================

const CLEANUP_COMMANDS = `
# 1. Create proper directory structure
mkdir logs temp db/migrations

# 2. Move files to appropriate locations
mv deploy.log deploy_output.txt deploy_run.log ps_error.log logs/
mv migrate_professional_circles.js db/migrations/
mv test_backward_compatibility_simple.js run_test_scenario.js verify_contextual_bandit.js tests/
mv cf_events.json events.json events5.json iam_policy.json id.json stack.json temp/

# 3. Delete temporary/test database files
rm *.db *.db-shm *.db-wal

# 4. Delete debug files (review first!)
rm debug_*.js

# 5. Update .gitignore
echo "# Temporary files" >> .gitignore
echo "*.log" >> .gitignore
echo "*.db" >> .gitignore  
echo "*.db-shm" >> .gitignore
echo "*.db-wal" >> .gitignore
echo "temp/" >> .gitignore
echo "logs/" >> .gitignore
echo "debug/" >> .gitignore
`;

export { FILES_TO_DELETE, DIRECTORY_STRUCTURE_FIXES, CLEANUP_COMMANDS };