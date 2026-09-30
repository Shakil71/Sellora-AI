/**
 * Integrations catalog shared by the API and the web app: the channels a
 * business can connect and the events its own systems can subscribe to.
 */
import { WORKFLOW_TRIGGERS } from './automation';

export const CHANNEL_LABELS = {
  WHATSAPP: 'WhatsApp',
  WEB_CHAT: 'Website chat',
  MESSENGER: 'Messenger',
  INSTAGRAM: 'Instagram',
  TEST: 'Test',
} as const;
export type ChannelKey = keyof typeof CHANNEL_LABELS;

/** Events delivered to webhook endpoints. `*` subscribes to all of them. */
export const WEBHOOK_EVENTS = [
  ...WORKFLOW_TRIGGERS.filter((t) => t.key !== 'customer.inactive').map((t) => ({ key: t.key as string, label: t.label as string, description: t.description as string })),
  { key: 'webhook.test', label: 'Test event', description: 'Sent when you press “Send test event”.' },
] as const;
export type WebhookEventKey = (typeof WEBHOOK_EVENTS)[number]['key'];

export const WEBHOOK_SIGNATURE_HEADER = 'X-Sellora-Signature';

/** Website chat widget appearance and behaviour. */
export interface WebChatSettings {
  color: string;
  position: 'right' | 'left';
  title: string;
  greeting: string;
  /** Ask visitors for name and email before the first message. */
  askForContact: boolean;
  /** Empty = any website may embed the widget. */
  allowedDomains: string[];
}

export const DEFAULT_WEB_CHAT_SETTINGS: WebChatSettings = {
  color: '#0f766e',
  position: 'right',
  title: 'Chat with us',
  greeting: 'Hi! How can we help you today?',
  askForContact: false,
  allowedDomains: [],
};
