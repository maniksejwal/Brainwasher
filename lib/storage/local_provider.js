/**
 * @fileoverview Local file system storage provider
 * Used for development environment
 */

import fs from 'fs/promises';
import path from 'path';
import { StorageProvider } from './storage_provider.js';

export class LocalStorageProvider extends StorageProvider {
    constructor(basePath = './data/storage/local') {
        super();
        this.basePath = basePath;
    }

    _getFullPath(relativePath) {
        return path.join(this.basePath, relativePath);
    }

    async read(relativePath) {
        const fullPath = this._getFullPath(relativePath);
        return await fs.readFile(fullPath, 'utf-8');
    }

    async write(relativePath, content) {
        const fullPath = this._getFullPath(relativePath);
        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
    }

    async append(relativePath, content) {
        const fullPath = this._getFullPath(relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.appendFile(fullPath, content, 'utf-8');
    }

    async exists(relativePath) {
        const fullPath = this._getFullPath(relativePath);
        try {
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async delete(relativePath) {
        const fullPath = this._getFullPath(relativePath);
        await fs.unlink(fullPath);
    }

    async list(relativePath) {
        const fullPath = this._getFullPath(relativePath);
        try {
            const files = await fs.readdir(fullPath);
            return files.map(f => path.join(relativePath, f));
        } catch (error) {
            // Directory doesn't exist
            return [];
        }
    }
}
