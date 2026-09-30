import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { env } from '../../config/env';

/** Storage abstraction. Business logic never touches the filesystem directly. */
export interface StorageProvider {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  isHealthy(): Promise<boolean>;
}

function safeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.startsWith('/') || normalized.includes('..')) throw new Error('Invalid storage key');
  return normalized;
}

export class LocalStorageProvider implements StorageProvider {
  readonly driver = 'local' as const;
  private readonly root = path.resolve(process.env.STORAGE_ROOT_DIR ?? process.cwd(), env.STORAGE_LOCAL_PATH);

  private resolve(key: string) {
    const full = path.resolve(this.root, safeKey(key));
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  get(key: string) {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string) {
    return `${env.API_URL}/api/v1/files/${safeKey(key)}`;
  }

  async isHealthy() {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root, (await import('fs')).constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export class S3StorageProvider implements StorageProvider {
  readonly driver = 's3' as const;
  private readonly client = new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials:
      env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY
        ? { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY }
        : undefined,
  });

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey(key), Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey(key) }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey(key) }));
  }

  publicUrl(key: string) {
    if (env.STORAGE_PUBLIC_URL) return `${env.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${safeKey(key)}`;
    return `${env.API_URL}/api/v1/files/${safeKey(key)}`;
  }

  async isHealthy() {
    return Boolean(env.STORAGE_BUCKET);
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  readonly provider: StorageProvider = env.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();

  buildKey(tenantId: string, folder: string, originalName: string) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    return `${tenantId}/${folder}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.provider.put(key, body, contentType);
  }

  get(key: string) {
    return this.provider.get(key);
  }

  async delete(key: string) {
    try {
      await this.provider.delete(key);
    } catch (err) {
      this.logger.warn(`Failed to delete ${key}: ${(err as Error).message}`);
    }
  }

  publicUrl(key: string) {
    return this.provider.publicUrl(key);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
