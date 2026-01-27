/**
 * @fileoverview Storage manager - provides unified storage interface
 * Automatically selects provider based on environment configuration
 */

import config from '../../config.js';
import { LocalStorageProvider } from './local_provider.js';

let storageInstance = null;

/**
 * Get storage provider based on environment
 * @returns {StorageProvider} Storage provider instance
 */
export function getStorage() {
    if (storageInstance) return storageInstance;

    const storageType = config.STORAGE_TYPE || 'local';

    switch (storageType) {
        case 'local':
            storageInstance = new LocalStorageProvider(config.STORAGE_LOCAL_PATH);
            break;
        // Future: S3 and GCP providers
        // case 's3':
        //     storageInstance = new S3StorageProvider(
        //         config.STORAGE_S3_BUCKET,
        //         config.STORAGE_S3_REGION
        //     );
        //     break;
        // case 'gcp':
        //     storageInstance = new GCPStorageProvider(
        //         config.STORAGE_GCP_BUCKET,
        //         config.STORAGE_GCP_PROJECT_ID
        //     );
        //     break;
        default:
            throw new Error(`Unknown storage type: ${storageType}`);
    }

    console.log(`[Storage] Initialized ${storageType} provider (path: ${config.STORAGE_LOCAL_PATH || 'default'})`);
    return storageInstance;
}

/**
 * Reset storage instance (for testing)
 */
export function resetStorage() {
    storageInstance = null;
}

// Convenience exports
export { StorageProvider } from './storage_provider.js';
export { LocalStorageProvider } from './local_provider.js';
