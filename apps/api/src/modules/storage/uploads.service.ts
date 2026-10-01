import { Injectable } from '@nestjs/common';
// file-type v16 is the last CommonJS release
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileType = require('file-type') as { fromBuffer(buf: Buffer): Promise<{ ext: string; mime: string } | undefined> };
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { AppException } from '../../common/errors';
import type { Actor } from '../../common/auth-context';
import { UsageService } from '../billing/usage.service';

export const UPLOAD_PURPOSES = ['product', 'category', 'avatar', 'branding', 'attachment', 'document'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Folders whose files can be fetched without a session (unguessable keys). */
export const PUBLIC_FOLDERS = ['products', 'categories', 'avatars', 'branding', 'media'] as const;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOC_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];
const MEDIA_TYPES = [...IMAGE_TYPES, 'application/pdf', 'audio/ogg', 'audio/mpeg', 'video/mp4'];

const RULES: Record<UploadPurpose, { folder: string; types: string[] }> = {
  product: { folder: 'products', types: IMAGE_TYPES },
  category: { folder: 'categories', types: IMAGE_TYPES },
  avatar: { folder: 'avatars', types: IMAGE_TYPES },
  branding: { folder: 'branding', types: IMAGE_TYPES },
  attachment: { folder: 'media', types: MEDIA_TYPES },
  document: { folder: 'documents', types: DOC_TYPES },
};

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/** Magic bytes of Microsoft ASF containers (wma, wmv). A crafted ASF header can hang older file-type releases, and we never accept ASF. */
const ASF_MAGIC = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');

/**
 * Detects the real MIME type from file contents (not the client-provided
 * header) and enforces an allow-list per upload purpose.
 */
export async function detectMime(buffer: Buffer, originalName: string): Promise<string | undefined> {
  if (buffer.subarray(0, 16).equals(ASF_MAGIC)) return undefined;
  const detected = await FileType.fromBuffer(buffer);
  if (detected) {
    // DOCX files are zip containers
    if (detected.mime === 'application/zip' && /\.docx$/i.test(originalName)) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    return detected.mime;
  }
  if (looksLikeText(buffer)) return /\.(md|markdown)$/i.test(originalName) ? 'text/markdown' : 'text/plain';
  return undefined;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
  ) {}

  async store(actor: Actor, file: { buffer: Buffer; originalname: string; size: number }, purpose: UploadPurpose) {
    const rule = RULES[purpose];
    const mime = await detectMime(file.buffer, file.originalname);
    if (!mime || !rule.types.includes(mime)) {
      throw new AppException('UNSUPPORTED_FILE', `This file type is not allowed. Allowed: ${rule.types.map((t) => t.split('/')[1]).join(', ')}`, 415);
    }
    const sizeMb = Math.ceil(file.size / (1024 * 1024));
    await this.usage.assertWithin(actor.tenantId, 'storageMb', sizeMb);

    const originalName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
    const key = this.storage.buildKey(actor.tenantId, rule.folder, originalName);
    await this.storage.put(key, file.buffer, mime);
    const record = await this.prisma.storedFile.create({
      data: {
        tenantId: actor.tenantId,
        key,
        originalName,
        mimeType: mime,
        sizeBytes: file.size,
        purpose,
        uploadedById: actor.userId,
      },
    });
    return { id: record.id, key, url: this.storage.publicUrl(key), mimeType: mime, size: file.size, name: originalName };
  }
}
