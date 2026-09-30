import type { ChannelType } from '@prisma/client';

/**
 * Channel abstraction ("AIChannel"). Business logic, the AI runtime and the
 * automation engine only talk to channels through this interface, so new
 * channels (web chat, Instagram, Messenger, Telegram, voice) plug in without
 * touching them. V1 ships WhatsApp Cloud API plus an internal test channel.
 */
export interface OutboundPayload {
  kind: 'text' | 'media' | 'template';
  text?: string;
  media?: { url: string; mimeType: string; fileName?: string; caption?: string };
  template?: { name: string; language: string; components?: unknown[] };
}

export interface ChannelTarget {
  tenantId: string;
  conversationId: string;
  channel: ChannelType;
  whatsappAccountId: string | null;
  /** Recipient address on the channel, e.g. WhatsApp wa_id */
  recipient: string | null;
}

export interface SendResult {
  externalId: string | null;
}

export class ChannelSendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** Retryable errors are retried by the queue (network, rate limit, 5xx). */
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface MessagingChannel {
  readonly type: ChannelType;
  readonly label: string;
  /** Free-form messages allowed only within this window after the last inbound message (ms); null = always. */
  readonly customerServiceWindowMs: number | null;
  send(target: ChannelTarget, payload: OutboundPayload): Promise<SendResult>;
  markRead?(target: ChannelTarget, externalMessageId: string): Promise<void>;
}
