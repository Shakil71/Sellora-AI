import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.module';
import { decryptSecret, hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import { env } from '../../config/env';

interface WaPayload {
  entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> } & Record<string, unknown>>;
  [key: string]: unknown;
}

export type WebhookVerdict ={ ok: true; eventId: string } | { ok: false; reason: string };

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

  private phoneNumberIds(payload: WaPayload): string[] {
    const ids = new Set<string>();
    for (const e of payload.entry ?? []) for (const c of e.changes ?? []) if (c.value?.metadata?.phone_number_id) ids.add(c.value.metadata.phone_number_id);
    return [...ids];
  }

  /**
   * Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app
   * secret). Unsigned or spoofed requests are rejected.
   *
   * A workspace's own app secret only vouches for that workspace's phone
   * numbers; the server-wide secret vouches for every number. Changes for
   * numbers the signing secret does not cover are dropped before storage, so
   * one workspace can never inject messages into another.
   */
  async receive(rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<WebhookVerdict> {
    if (!rawBody?.length) return { ok: false, reason: 'empty body' };
    let payload: WaPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WaPayload;
    } catch {
      return { ok: false, reason: 'invalid json' };
    }
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid json' };
    const ids = this.phoneNumberIds(payload);
    const accounts = ids.length ? await this.prisma.whatsAppAccount.findMany({ where: { phoneNumberId: { in: ids } } }) : [];
    const accountSecrets = accounts.map((a) => {
      if (!a.appSecretEnc) return undefined;
      try {
        return decryptSecret(a.appSecretEnc);
      } catch {
        return undefined; // undecryptable secret
      }
    });
    if (!env.WHATSAPP_APP_SECRET && !accountSecrets.some(Boolean)) return { ok: false, reason: 'no app secret configured' };
    const provided = signatureHeader?.startsWith('sha256=') ? signatureHeader.slice(7) : undefined;
    if (!provided) return { ok: false, reason: 'missing signature' };
    const signedBy = (secret: string | undefined) => Boolean(secret) && safeEqual(hmacSha256Hex(secret!, rawBody), provided);

    const platformSigned = signedBy(env.WHATSAPP_APP_SECRET);
    const trusted = accounts.filter((_a, i) => platformSigned || signedBy(accountSecrets[i]));
    if (!platformSigned && !trusted.length) return { ok: false, reason: 'invalid signature' };

    const dropped = ids.filter((id) => !trusted.some((a) => a.phoneNumberId === id));
    if (dropped.length && !platformSigned) this.logger.warn(`Dropped WhatsApp webhook changes not covered by the signing secret: ${dropped.join(', ')}`);
    if (!trusted.length) {
      // Authentic (server-wide secret) but for no connected number: keep it for the platform log only.
      const event = await this.prisma.webhookEvent.create({
        data: { tenantId: null, provider: 'whatsapp', eventType: 'other', payload: payload as Prisma.InputJsonValue, signatureValid: true, status: WebhookEventStatus.IGNORED },
      });
      return { ok: true, eventId: event.id };
    }

    // One event per workspace, holding only that workspace's changes: Meta can batch several
    // numbers of a shared app in one request, and each workspace can read its own webhook log.
    const eventIds: string[] = [];
    for (const tenantId of [...new Set(trusted.map((a) => a.tenantId))]) {
      const tenantIds = new Set(trusted.filter((a) => a.tenantId === tenantId).map((a) => a.phoneNumberId));
      const scoped: WaPayload = {
        ...payload,
        entry: (payload.entry ?? [])
          .map((e) => ({ ...e, changes: (e.changes ?? []).filter((c) => tenantIds.has(c.value?.metadata?.phone_number_id ?? '')) }))
          .filter((e) => e.changes.length),
      };
      const scopedBody = JSON.stringify(scoped);
      const event = await this.prisma.webhookEvent.create({
        data: {
          tenantId,
          provider: 'whatsapp',
          eventType: scopedBody.includes('"messages"') ? 'messages' : scopedBody.includes('"statuses"') ? 'statuses' : 'other',
          payload: scoped as Prisma.InputJsonValue,
          signatureValid: true,
          status: WebhookEventStatus.RECEIVED,
        },
      });
      await this.queues.processWebhook(event.id);
      eventIds.push(event.id);
    }
    return { ok: true, eventId: eventIds[0]! };
  }
}
