/**
 * @fileoverview Abstract storage provider interface
 * All storage providers must implement these methods
 */

export class StorageProvider {
    /**
     * Read file content
     * @param {string} path - Relative path (e.g., 'training/training_log.jsonl')
     * @returns {Promise<string>} File content
     */
    async read(path) {
        throw new Error('StorageProvider.read() not implemented');
    }

    /**
     * Write file content
     * @param {string} path - Relative path
     * @param {string} content - File content
     * @returns {Promise<void>}
     */
    async write(path, content) {
        throw new Error('StorageProvider.write() not implemented');
    }

    /**
     * Append to file
     * @param {string} path - Relative path
     * @param {string} content - Content to append
     * @returns {Promise<void>}
     */
    async append(path, content) {
        throw new Error('StorageProvider.append() not implemented');
    }

    /**
     * Check if file exists
     * @param {string} path - Relative path
     * @returns {Promise<boolean>}
     */
    async exists(path) {
        throw new Error('StorageProvider.exists() not implemented');
    }

    /**
     * Delete file
     * @param {string} path - Relative path
     * @returns {Promise<void>}
     */
    async delete(path) {
        throw new Error('StorageProvider.delete() not implemented');
    }

    /**
     * List files in directory
     * @param {string} path - Relative directory path
     * @returns {Promise<string[]>} Array of file paths
     */
    async list(path) {
        throw new Error('StorageProvider.list() not implemented');
    }
}
