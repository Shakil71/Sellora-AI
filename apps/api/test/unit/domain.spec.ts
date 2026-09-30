import { calculateOrderTotals, SYSTEM_ROLES } from '@sellora/shared';
import { computeStockStatus } from '../../src/modules/commerce/inventory.service';
import { validateWorkflowGraph } from '../../src/modules/automation/workflows.service';
import { compare, inTimeWindow } from '../../src/modules/automation/workflow-engine.service';
import { isWithinWorkingHours, sanitizeReply } from '../../src/modules/ai/agent-runtime.service';
import { chunkText, cosineSimilarity, htmlToText, assertPublicUrl } from '../../src/modules/ai/text-extraction';
import { normalizeWhatsAppMessage } from '../../src/modules/conversations/inbound.service';
import { findDeliveryZone, commerceSettingsSchema } from '../../src/modules/tenants/tenant-settings';
import { renderTemplate, normalizePhone } from '../../src/common/utils/text.util';
import { ORDER_TRANSITIONS } from '../../src/modules/commerce/orders.service';

describe('order calculation', () => {
  it('prices a cart with tax after discount plus shipping', () => {
    const t = calculateOrderTotals({ items: [{ unitPrice: 109, quantity: 2 }], shipping: 4.99, taxRatePercent: 8 });
    expect(t.subtotal).toBe(218);
    expect(t.taxTotal).toBe(17.44);
    expect(t.total).toBe(240.43);
  });
});

describe('order lifecycle', () => {
  it('only allows forward transitions and terminal states stay terminal', () => {
    expect(ORDER_TRANSITIONS.PENDING).toContain('CONFIRMED');
    expect(ORDER_TRANSITIONS.DELIVERED).not.toContain('PENDING');
    expect(ORDER_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(ORDER_TRANSITIONS.REFUNDED).toHaveLength(0);
  });
});

describe('inventory', () => {
  it('computes stock status from available units', () => {
    expect(computeStockStatus(10, 0, 5)).toBe('IN_STOCK');
    expect(computeStockStatus(10, 6, 5)).toBe('LOW_STOCK');
    expect(computeStockStatus(3, 3, 5)).toBe('OUT_OF_STOCK');
  });
});

describe('roles', () => {
  it('agents cannot manage users, roles or billing', () => {
    const p = SYSTEM_ROLES.AGENT.permissions as string[];
    expect(p).not.toContain('users.create');
    expect(p).not.toContain('roles.manage');
    expect(p).not.toContain('billing.manage');
  });
});

describe('workflow validation', () => {
  const base = {
    name: 'W',
    nodes: [
      { key: 't', type: 'TRIGGER' as const, subtype: 'order.created', config: {}, positionX: 0, positionY: 0 },
      { key: 'c', type: 'CONDITION' as const, subtype: 'order.amount', config: { operator: 'gt', value: 100 }, positionX: 0, positionY: 0 },
      { key: 'a', type: 'ACTION' as const, subtype: 'notify_team', config: { title: 'Hi' }, positionX: 0, positionY: 0 },
    ],
    edges: [
      { sourceKey: 't', targetKey: 'c' },
      { sourceKey: 'c', targetKey: 'a', sourceHandle: 'yes' as const },
    ],
  };
  it('accepts a valid graph', () => {
    expect(validateWorkflowGraph(base, true).errors).toEqual([]);
  });
  it('rejects loops, missing triggers, unlabeled condition branches and missing required fields', () => {
    expect(validateWorkflowGraph({ ...base, edges: [...base.edges, { sourceKey: 'a', targetKey: 'c' }] }, false).errors).toContain('Workflows cannot contain loops');
    expect(validateWorkflowGraph({ ...base, nodes: base.nodes.slice(1) }, false).errors).toContain('A workflow needs exactly one trigger');
    expect(validateWorkflowGraph({ ...base, edges: [{ sourceKey: 't', targetKey: 'c' }, { sourceKey: 'c', targetKey: 'a' }] }, false).errors.length).toBeGreaterThan(0);
    const missing = { ...base, nodes: base.nodes.map((n) => (n.key === 'a' ? { ...n, config: {} } : n)) };
    expect(validateWorkflowGraph(missing, true).errors.join()).toContain('Title');
  });
  it('evaluates comparisons and time windows', () => {
    expect(compare(150, 'gt', 100)).toBe(true);
    expect(compare(100, 'lt', 100)).toBe(false);
    const noon = new Date('2026-09-30T12:00:00Z');
    expect(inTimeWindow({ from: '09:00', to: '18:00' }, 'UTC', noon)).toBe(true);
    expect(inTimeWindow({ from: '09:00', to: '18:00', days: ['sat'] }, 'UTC', noon)).toBe(false);
  });
});

describe('AI safety helpers', () => {
  it('redacts keys and blocks system-prompt leaks', () => {
    expect(sanitizeReply('your key is sk-ABCDEFGHIJKLMNOPQRSTUV')).not.toContain('sk-ABCDEF');
    expect(sanitizeReply('## Operating rules\n- secret')).not.toContain('Operating rules');
    expect(sanitizeReply('Hello!')).toBe('Hello!');
  });
  it('respects working hours', () => {
    const wed10 = new Date('2026-09-30T10:00:00Z');
    expect(isWithinWorkingHours(null, wed10)).toBe(true);
    expect(isWithinWorkingHours({ enabled: true, timezone: 'UTC', days: { wed: { from: '09:00', to: '17:00' } } }, wed10)).toBe(true);
    expect(isWithinWorkingHours({ enabled: true, timezone: 'UTC', days: { wed: null } }, wed10)).toBe(false);
  });
});

describe('knowledge processing', () => {
  it('chunks long text with overlap and keeps short text whole', () => {
    expect(chunkText('Short policy text here.')).toHaveLength(1);
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(20)}`).join('\n\n');
    const chunks = chunkText(long, 1000, 100);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 1100)).toBe(true);
  });
  it('strips scripts from HTML', () => {
    const { text, title } = htmlToText('<title>FAQ</title><script>alert(1)</script><p>Free shipping &amp; returns</p>');
    expect(title).toBe('FAQ');
    expect(text).toContain('Free shipping & returns');
    expect(text).not.toContain('alert');
  });
  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('blocks SSRF to private networks', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
  });
});

describe('WhatsApp message normalisation', () => {
  it('maps text, media and interactive replies', () => {
    expect(normalizeWhatsAppMessage({ id: 'w1', from: '1', type: 'text', text: { body: 'hi' } })).toMatchObject({ type: 'TEXT', body: 'hi', externalId: 'w1' });
    expect(normalizeWhatsAppMessage({ id: 'w2', from: '1', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'pic' } })).toMatchObject({ type: 'IMAGE', mediaId: 'm1', body: 'pic' });
    expect(normalizeWhatsAppMessage({ id: 'w3', from: '1', type: 'interactive', interactive: { button_reply: { id: 'b', title: 'Yes' } } })).toMatchObject({ type: 'INTERACTIVE', body: 'Yes' });
    expect(normalizeWhatsAppMessage({ id: 'w4', from: '1', type: 'weird' }).type).toBe('UNSUPPORTED');
  });
});

describe('commerce settings & templating', () => {
  it('matches delivery zones by city, then country, then catch-all', () => {
    const s = commerceSettingsSchema.parse({
      deliveryZones: [
        { name: 'NYC', cities: ['New York'], fee: 5 },
        { name: 'US', countries: ['united states'], fee: 10 },
      ],
    });
    expect(findDeliveryZone(s, 'new york')?.name).toBe('NYC');
    expect(findDeliveryZone(s, 'Boston', 'United States')?.name).toBe('US');
    expect(findDeliveryZone(s, 'Paris', 'France')).toBeUndefined();
  });
  it('renders templates and normalises phones', () => {
    expect(renderTemplate('Hi {{customer.name}}, order {{order.number}}{{missing}}', { customer: { name: 'Ann' }, order: { number: 'A-1' } })).toBe('Hi Ann, order A-1');
    expect(normalizePhone('+1 (212) 555-0101')).toBe('+12125550101');
    expect(normalizePhone('12')).toBeUndefined();
  });
});
