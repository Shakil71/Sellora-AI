import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { ChannelSendError } from '../channels/channel.types';
import type { GraphErrorBody } from '../whatsapp/whatsapp-graph.client';

// Graph error codes worth retrying: temporary issues and rate limits.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613, 1200]);

export type MetaAttachmentType = 'image' | 'video' | 'audio' | 'file';

/**
 * Thin client for the Messenger Platform (Facebook Pages and Instagram
 * professional accounts linked to a Page). Uses the Page access token.
 */
@Injectable()
export class MetaGraphClient {
  private base() {
    return `${env.WHATSAPP_GRAPH_BASE_URL}/${env.WHATSAPP_GRAPH_API_VERSION}`;
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ChannelSendError(
        `Meta API unreachable: ${(err as Error).message}`,
        'NETWORK',
        true,
      );
    }
    const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      const code = e.code ?? res.status;
      throw new ChannelSendError(
        e.message ?? `Meta API error ${res.status}`,
        String(code),
        res.status >= 500 || RETRYABLE_CODES.has(Number(code)),
      );
    }
    return json;
  }

  /** Sends a text or attachment to a Messenger PSID or Instagram-scoped user ID. */
  send(
    pageId: string,
    token: string,
    recipientId: string,
    message: { text?: string; attachment?: { type: MetaAttachmentType; url: string } },
  ) {
    const body = {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: message.attachment
        ? {
            attachment: {
              type: message.attachment.type,
              payload: { url: message.attachment.url, is_reusable: false },
            },
          }
        : { text: message.text },
    };
    return this.request<{ message_id?: string; recipient_id?: string }>(
      `/${encodeURIComponent(pageId)}/messages`,
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  /** Name of the Page or Instagram account (used to test a connection). */
  describe(id: string, token: string, fields: string) {
    return this.request<{ id: string; name?: string; username?: string }>(
      `/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`,
      token,
    );
  }

  /** Subscribes the Page to this app's webhooks so messages are delivered. */
  subscribePage(pageId: string, token: string) {
    const fields = 'messages,messaging_postbacks,message_deliveries,message_reads';
    return this.request<{ success?: boolean }>(
      `/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${fields}`,
      token,
      { method: 'POST' },
    );
  }

  /** Best-effort display name for a customer. */
  async profileName(
    userId: string,
    token: string,
    kind: 'MESSENGER' | 'INSTAGRAM',
  ): Promise<string | undefined> {
    try {
      const fields = kind === 'INSTAGRAM' ? 'name,username' : 'first_name,last_name';
      const p = await this.request<{
        first_name?: string;
        last_name?: string;
        name?: string;
        username?: string;
      }>(`/${encodeURIComponent(userId)}?fields=${fields}`, token);
      const full =
        [p.first_name, p.last_name].filter(Boolean).join(' ') ||
        p.name ||
        (p.username ? `@${p.username}` : '');
      return full.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}
