/**
 * @fileoverview GCP storage provider for Google Cloud
 * Used for production environment
 */

import { Storage } from '@google-cloud/storage';
import { StorageProvider } from './storage_provider.js';

export class GCPStorageProvider extends StorageProvider {
    constructor(bucketName, projectId) {
        super();
        this.bucketName = bucketName;
        this.storage = new Storage({ projectId });
        this.bucket = this.storage.bucket(bucketName);
    }

    async read(relativePath) {
        const file = this.bucket.file(relativePath);
        const [content] = await file.download();
        return content.toString('utf-8');
    }

    async write(relativePath, content) {
        const file = this.bucket.file(relativePath);
        await file.save(content);
    }

    async append(relativePath, content) {
        // GCP doesn't support append - read, concat, write
        let existing = '';
        try {
            existing = await this.read(relativePath);
        } catch (e) {
            // File doesn't exist
        }
        await this.write(relativePath, existing + content);
    }

    async exists(relativePath) {
        const file = this.bucket.file(relativePath);
        const [exists] = await file.exists();
        return exists;
    }

    async delete(relativePath) {
        const file = this.bucket.file(relativePath);
        await file.delete();
    }

    async list(relativePath) {
        const [files] = await this.bucket.getFiles({ prefix: relativePath });
        return files.map(f => f.name);
    }
}
