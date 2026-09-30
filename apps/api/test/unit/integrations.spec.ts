import { createHmac } from 'crypto';
import { MessageType } from '@prisma/client';
import { splitMessage } from '../../src/modules/channels/channels.service';
import { normalizeMetaMessage } from '../../src/modules/integrations/meta-webhook.service';
import { WebhooksService } from '../../src/modules/integrations/webhooks.service';

describe('splitMessage', () => {
  it('keeps short text intact', () => {
    expect(splitMessage('Hello there', 1000)).toEqual(['Hello there']);
  });

  it('splits long text at sentence boundaries within the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const parts = splitMessage(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.every((p) => p.endsWith('.'))).toBe(true);
    expect(parts.join(' ')).toBe(text);
  });

  it('hard-splits text without spaces', () => {
    const parts = splitMessage('x'.repeat(2500), 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
  });
});

describe('normalizeMetaMessage', () => {
  it('reads text messages', () => {
    const n = normalizeMetaMessage({
      sender: { id: '1' },
      timestamp: 1_700_000_000_000,
      message: { mid: 'm1', text: 'Hi' },
    });
    expect(n).toMatchObject({ externalId: 'm1', type: MessageType.TEXT, body: 'Hi' });
  });

  it('ignores echoes of our own messages', () => {
    expect(
      normalizeMetaMessage({ message: { mid: 'm2', text: 'Reply', is_echo: true } }),
    ).toBeNull();
  });

  it('maps image attachments with their URL', () => {
    const n = normalizeMetaMessage({
      message: {
        mid: 'm3',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.example/x.jpg' } }],
      },
    });
    expect(n).toMatchObject({ type: MessageType.IMAGE, mediaUrl: 'https://cdn.example/x.jpg' });
  });

  it('treats button postbacks as interactive replies', () => {
    const n = normalizeMetaMessage({ postback: { title: 'Track my order', payload: 'TRACK' } });
    expect(n).toMatchObject({ type: MessageType.INTERACTIVE, body: 'Track my order' });
  });
});

describe('webhook signatures', () => {
  it('signs timestamp.body with HMAC-SHA256', () => {
    const body = JSON.stringify({ event: 'order.created' });
    const sig = WebhooksService.sign('whsec_test', 1_700_000_000, body);
    const expected = createHmac('sha256', 'whsec_test').update(`1700000000.${body}`).digest('hex');
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
});
