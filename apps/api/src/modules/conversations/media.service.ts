import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsAppGraphClient } from '../whatsapp/whatsapp-graph.client';
import { decryptSecret } from '../../common/utils/crypto.util';
import { ensureFound, NotFoundError } from '../../common/errors';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};

/**
 * Inbound WhatsApp media is fetched from Meta on first view, stored with the
 * configured storage provider and served from there afterwards.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly graph: WhatsAppGraphClient,
  ) {}

  async resolve(tenantId: string, conversationId: string, messageId: string): Promise<{ redirect?: string; buffer?: Buffer; mimeType: string; fileName: string }> {
    const message = ensureFound(
      await this.prisma.message.findFirst({
        where: { id: messageId, conversationId, tenantId },
        include: { conversation: { include: { whatsappAccount: true } } },
      }),
      'Message',
    );
    const fileName = message.mediaFileName ?? `attachment${EXT_BY_MIME[message.mediaMimeType ?? ''] ?? ''}`;
    const storedKey = (message.metadata as { storageKey?: string } | null)?.storageKey;
    if (storedKey) {
      return { buffer: await this.storage.get(storedKey), mimeType: message.mediaMimeType ?? 'application/octet-stream', fileName };
    }
    if (message.mediaUrl) return { redirect: message.mediaUrl, mimeType: message.mediaMimeType ?? 'application/octet-stream', fileName };
    if (!message.mediaId || !message.conversation.whatsappAccount) throw new NotFoundError('Media');

    const token = decryptSecret(message.conversation.whatsappAccount.accessTokenEnc);
    const info = await this.graph.getMedia(message.mediaId, token);
    const buffer = await this.graph.downloadMedia(info.url, token);
    const mimeType = info.mime_type?.split(';')[0] ?? message.mediaMimeType ?? 'application/octet-stream';
    const key = this.storage.buildKey(tenantId, 'inbound', `${message.id}${EXT_BY_MIME[mimeType] ?? ''}`);
    await this.storage.put(key, buffer, mimeType);
    await this.prisma.storedFile.create({
      data: { tenantId, key, originalName: fileName, mimeType, sizeBytes: buffer.length, purpose: 'inbound-media' },
    });
    await this.prisma.message.update({
      where: { id: message.id },
      data: { mediaMimeType: mimeType, metadata: { ...((message.metadata as object) ?? {}), storageKey: key } },
    });
    return { buffer, mimeType, fileName };
  }
}
