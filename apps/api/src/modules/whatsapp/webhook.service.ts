import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.module';
import { decryptSecret, hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import { env } from '../../config/env';

export type WebhookVerdict = { ok: true; eventId: string } | { ok: false; reason: string };

/**
 * Validates and stores WhatsApp webhooks. Processing happens asynchronously in
 * the worker so Meta receives a fast 200 response.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  /** GET verification handshake: the verify token must match an account (or the server default). */
  async verifySubscription(mode?: string, token?: string): Promise<boolean> {
    if (mode !== 'subscribe' || !token) return false;
    if (env.WHATSAPP_VERIFY_TOKEN && safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) return true;
    const account = await this.prisma.whatsAppAccount.findFirst({ where: { verifyToken: token }, select: { id: true } });
    return Boolean(account);
  }

  private phoneNumberIds(payload: unknown): string[] {
    const ids = new Set<string>();
    const entries = (payload as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> }> })?.entry ?? [];
    for (const e of entries) for (const c of e.changes ?? []) if (c.value?.metadata?.phone_number_id) ids.add(c.value.metadata.phone_number_id);
    return [...ids];
  }

  /**
   * Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app
   * secret). Unsigned or spoofed requests are rejected.
   */
  async receive(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<WebhookVerdict> {
    if (!rawBody?.length) return { ok: false, reason: 'empty body' };
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid json' };
    }
    const ids = this.phoneNumberIds(payload);
    const accounts = ids.length ? await this.prisma.whatsAppAccount.findMany({ where: { phoneNumberId: { in: ids } } }) : [];
    const secrets = new Set<string>();
    for (const a of accounts) {
      if (a.appSecretEnc) {
        try {
          secrets.add(decryptSecret(a.appSecretEnc));
        } catch {
          /* ignore undecryptable secret */
        }
      }
    }
    if (env.WHATSAPP_APP_SECRET) secrets.add(env.WHATSAPP_APP_SECRET);
    if (!secrets.size) return { ok: false, reason: 'no app secret configured' };
    const provided = signatureHeader?.startsWith('sha256=') ? signatureHeader.slice(7) : undefined;
    if (!provided) return { ok: false, reason: 'missing signature' };
    const valid = [...secrets].some((secret) => safeEqual(hmacSha256Hex(secret, rawBody), provided));
    if (!valid) return { ok: false, reason: 'invalid signature' };

    const tenantId = accounts[0]?.tenantId ?? null;
    const hasMessages = rawBody.includes('"messages"');
    const event = await this.prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'whatsapp',
        eventType: hasMessages ? 'messages' : rawBody.includes('"statuses"') ? 'statuses' : 'other',
        payload: payload as Prisma.InputJsonValue,
        signatureValid: true,
        status: accounts.length ? WebhookEventStatus.RECEIVED : WebhookEventStatus.IGNORED,
      },
    });
    if (accounts.length) await this.queues.processWebhook(event.id);
    return { ok: true, eventId: event.id };
  }
}
