import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { ChannelSendError } from '../channels/channel.types';

export interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_data?: { details?: string }; fbtrace_id?: string };
}

const RETRYABLE_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 133004]);

/** Thin client for the Meta WhatsApp Cloud API (Graph API). */
@Injectable()
export class WhatsAppGraphClient {
  private base() {
    return `${env.WHATSAPP_GRAPH_BASE_URL}/${env.WHATSAPP_GRAPH_API_VERSION}`;
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ChannelSendError(`WhatsApp API unreachable: ${(err as Error).message}`, 'NETWORK', true);
    }
    const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      const code = e.code ?? res.status;
      const detail = e.error_data?.details ? ` (${e.error_data.details})` : '';
      throw new ChannelSendError(`${e.message ?? `WhatsApp API error ${res.status}`}${detail}`, String(code), res.status >= 500 || RETRYABLE_CODES.has(Number(code)));
    }
    return json;
  }

  sendMessage(phoneNumberId: string, token: string, payload: Record<string, unknown>) {
    return this.request<{ messages?: Array<{ id: string }> }>(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
  }

  markRead(phoneNumberId: string, token: string, messageId: string) {
    return this.request(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  }

  getPhoneNumber(phoneNumberId: string, token: string) {
    return this.request<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; id: string }>(
      `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
      token,
    );
  }

  listTemplates(wabaId: string, token: string) {
    return this.request<{ data: Array<{ id: string; name: string; language: string; category: string; status: string; components: unknown[]; rejected_reason?: string }> }>(
      `/${encodeURIComponent(wabaId)}/message_templates?limit=200&fields=id,name,language,category,status,components,rejected_reason`,
      token,
    );
  }

  createTemplate(wabaId: string, token: string, body: { name: string; language: string; category: string; components: unknown[] }) {
    return this.request<{ id: string; status: string; category: string }>(`/${encodeURIComponent(wabaId)}/message_templates`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  deleteTemplate(wabaId: string, token: string, name: string) {
    return this.request(`/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`, token, { method: 'DELETE' });
  }

  getMedia(mediaId: string, token: string) {
    return this.request<{ url: string; mime_type: string; file_size?: number }>(`/${encodeURIComponent(mediaId)}`, token);
  }

  async downloadMedia(url: string, token: string): Promise<Buffer> {
    const parsed = new URL(url);
    // Only follow Meta CDN URLs returned by the Graph API.
    if (!/(^|\.)(fbcdn\.net|facebook\.com|whatsapp\.net|fbsbx\.com)$/.test(parsed.hostname)) {
      throw new ChannelSendError('Unexpected media host', 'MEDIA_HOST', false);
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new ChannelSendError(`Media download failed (${res.status})`, 'MEDIA_DOWNLOAD', res.status >= 500);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 25 * 1024 * 1024) throw new ChannelSendError('Media file too large', 'MEDIA_TOO_LARGE', false);
    return Buffer.from(await res.arrayBuffer());
  }
}
