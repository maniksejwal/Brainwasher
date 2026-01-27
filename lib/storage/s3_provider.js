/**
 * @fileoverview S3 storage provider for AWS
 * Used for production environment
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { StorageProvider } from './storage_provider.js';

export class S3StorageProvider extends StorageProvider {
    constructor(bucketName, region = 'us-east-1') {
        super();
        this.bucketName = bucketName;
        this.client = new S3Client({ region });
    }

    async read(relativePath) {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: relativePath
        });
        const response = await this.client.send(command);
        return await response.Body.transformToString();
    }

    async write(relativePath, content) {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: relativePath,
            Body: content
        });
        await this.client.send(command);
    }

    async append(relativePath, content) {
        // S3 doesn't support append - read, concat, write
        let existing = '';
        try {
            existing = await this.read(relativePath);
        } catch (e) {
            // File doesn't exist, that's fine
        }
        await this.write(relativePath, existing + content);
    }

    async exists(relativePath) {
        try {
            await this.read(relativePath);
            return true;
        } catch {
            return false;
        }
    }

    async delete(relativePath) {
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: relativePath
        });
        await this.client.send(command);
    }

    async list(relativePath) {
        const command = new ListObjectsV2Command({
            Bucket: this.bucketName,
            Prefix: relativePath
        });
        const response = await this.client.send(command);
        return response.Contents?.map(obj => obj.Key) || [];
    }
}
