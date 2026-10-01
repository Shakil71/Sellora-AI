import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { loadEnv } from '../../src/config/env';
import { PrismaService } from '../../src/prisma/prisma.service';
import { encryptSecret, hmacSha256Hex } from '../../src/common/utils/crypto.util';

/**
 * End-to-end API behaviour against a real PostgreSQL test database and Redis:
 * authentication, tenant isolation, RBAC, commerce, CRM, webhooks and hostile input.
 */
type Agent = ReturnType<typeof request.agent>;

let app: NestExpressApplication;
let prisma: PrismaService;

function csrfOf(agent: Agent): string {
  const jar = (agent as unknown as { jar: { getCookie(name: string, opts: unknown): { value: string } | undefined } }).jar;
  return jar.getCookie('sellora_csrf', { domain: '127.0.0.1', path: '/', secure: false, script: false })?.value ?? '';
}

async function signUp(label: string) {
  const agent = request.agent(app.getHttpServer());
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  const res = await agent.post('/api/v1/auth/register').send({ name: `${label} Owner`, email, password: 'Tr1cky-Banana-77', workspaceName: `${label} Shop` });
  expect(res.status).toBe(201);
  return { agent, email, tenantId: res.body.data.workspace.id as string, write: (m: 'post' | 'patch' | 'put' | 'delete', url: string) => agent[m](url).set('x-csrf-token', csrfOf(agent)) };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app, loadEnv());
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe('health', () => {
  it('reports readiness of database and redis', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('up');
    expect(res.body.checks.redis).toBe('up');
  });
});

describe('authentication', () => {
  it('registers, reads the session, refreshes and logs out', async () => {
    const a = await signUp('auth');
    const me = await a.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.role.key).toBe('OWNER');
    expect(me.body.data.permissions).toContain('billing.manage');

    const refresh = await a.write('post', '/api/v1/auth/refresh');
    expect(refresh.status).toBe(200);

    const out = await a.write('post', '/api/v1/auth/logout');
    expect(out.status).toBe(200);
    const after = await a.agent.get('/api/v1/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects wrong passwords without revealing whether the email exists', async () => {
    const a = await signUp('pw');
    const wrong = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: a.email, password: 'Wrong12345' });
    const unknown = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: 'Wrong12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects missing, invalid and forged tokens', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/api/v1/products')).status).toBe(401);
    expect((await request(server).get('/api/v1/products').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
    const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwic2lkIjoieCIsInRpZCI6IngiLCJ0eXAiOiJhY2Nlc3MifQ.invalidsignature';
    expect((await request(server).get('/api/v1/products').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  it('blocks cookie-authenticated writes without a CSRF token', async () => {
    const a = await signUp('csrf');
    const res = await a.agent.post('/api/v1/products').send({ name: 'X', sku: 'X-1', price: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects malformed input with field details', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: 'bad', password: '1' });
    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});

describe('commerce & tenant isolation', () => {
  it('creates products, prices orders server-side and reserves stock', async () => {
    const a = await signUp('shop');
    const product = await a.write('post', '/api/v1/products').send({ name: 'Smart Watch', sku: 'SW-1', price: 199, salePrice: 179, initialStock: 5 });
    expect(product.status).toBe(201);
    const customer = await a.write('post', '/api/v1/customers').send({ name: 'Ann Buyer', whatsappNumber: '+14155550100' });
    expect(customer.status).toBe(201);

    // Client-supplied price overrides are ignored for users without orders.update? (owner has it) → verify catalog price is used when omitted
    const order = await a.write('post', '/api/v1/orders').send({ customerId: customer.body.data.id, items: [{ productId: product.body.data.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    expect(Number(order.body.data.subtotal)).toBe(358);
    expect(order.body.data.number).toMatch(/^ORD-\d{6}$/);

    const after = await a.agent.get(`/api/v1/products/${product.body.data.id}`);
    expect(after.body.data.inventory.reserved).toBe(2);
    expect(after.body.data.available).toBe(3);

    const tooMany = await a.write('post', '/api/v1/orders').send({ customerId: customer.body.data.id, items: [{ productId: product.body.data.id, quantity: 50 }] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_STOCK');

    const cancel = await a.write('post', `/api/v1/orders/${order.body.data.id}/status`).send({ status: 'CANCELLED', note: 'test' });
    expect(cancel.status).toBe(201);
    const released = await a.agent.get(`/api/v1/products/${product.body.data.id}`);
    expect(released.body.data.inventory.reserved).toBe(0);

    const dupSku = await a.write('post', '/api/v1/products').send({ name: 'Dup', sku: 'SW-1', price: 1 });
    expect(dupSku.status).toBe(409);
  });

  it("never exposes one workspace's records to another", async () => {
    const a = await signUp('tenantA');
    const b = await signUp('tenantB');
    const product = await a.write('post', '/api/v1/products').send({ name: 'Secret product', sku: 'SEC-1', price: 10 });
    const customer = await a.write('post', '/api/v1/customers').send({ name: 'Private Customer' });

    expect((await b.agent.get(`/api/v1/products/${product.body.data.id}`)).status).toBe(404);
    expect((await b.agent.get(`/api/v1/customers/${customer.body.data.id}`)).status).toBe(404);
    const list = await b.agent.get('/api/v1/products');
    expect(list.body.data.items).toHaveLength(0);
    expect((await b.write('patch', `/api/v1/products/${product.body.data.id}`).send({ name: 'hacked' })).status).toBe(404);
    expect((await b.write('delete', `/api/v1/customers/${customer.body.data.id}`)).status).toBe(404);
    // Cross-tenant references are rejected when creating records.
    const order = await b.write('post', '/api/v1/orders').send({ customerId: customer.body.data.id, items: [{ productId: product.body.data.id, quantity: 1 }] });
    expect(order.status).toBe(404);
    // Mass-assignment of tenantId is ignored.
    const sneaky = await b.write('post', '/api/v1/customers').send({ name: 'Sneaky', tenantId: a.tenantId });
    const row = await prisma.customer.findUnique({ where: { id: sneaky.body.data.id } });
    expect(row?.tenantId).toBe(b.tenantId);
    // Switching to a workspace you do not belong to is refused.
    expect((await b.write('post', '/api/v1/auth/switch-workspace').send({ tenantId: a.tenantId })).status).toBe(403);
  });

  it('treats SQL and script payloads as plain data', async () => {
    const a = await signUp('inject');
    const search = await a.agent.get('/api/v1/customers').query({ search: "'; DROP TABLE \"Customer\"; --" });
    expect(search.status).toBe(200);
    const xss = await a.write('post', '/api/v1/customers').send({ name: '<img src=x onerror=alert(1)>' });
    expect(xss.status).toBe(201);
    expect(xss.body.data.name).toBe('<img src=x onerror=alert(1)>');
    expect(await prisma.customer.count()).toBeGreaterThan(0);
  });
});

describe('RBAC', () => {
  it('limits API keys to granted permissions', async () => {
    const a = await signUp('rbac');
    const key = await a.write('post', '/api/v1/api-keys').send({ name: 'Read only', permissions: ['products.view'] });
    expect(key.status).toBe(201);
    const raw = key.body.data.key as string;
    const server = app.getHttpServer();
    expect((await request(server).get('/api/v1/products').set('x-api-key', raw)).status).toBe(200);
    const denied = await request(server).post('/api/v1/products').set('x-api-key', raw).send({ name: 'x', sku: 'k-1', price: 1 });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
    // API keys cannot manage accounts or sessions.
    expect((await request(server).post('/api/v1/auth/logout-all').set('x-api-key', raw)).status).toBe(403);
    expect((await request(server).get('/api/v1/products').set('x-api-key', 'sk_live_invalid')).status).toBe(401);
  });

  it('prevents granting permissions you do not have and removing the last owner', async () => {
    const a = await signUp('roles');
    const me = await a.agent.get('/api/v1/auth/me');
    const self = await a.write('patch', `/api/v1/users/${me.body.data.user.id}`).send({ status: 'DISABLED' });
    expect(self.status).toBe(422);
    const unknownPermission = await a.write('post', '/api/v1/roles').send({ name: 'Weird', permissions: ['root.everything'] });
    expect(unknownPermission.status).toBe(422);
  });
});

describe('CRM', () => {
  it('creates a lead and converts it into a customer and deal', async () => {
    const a = await signUp('crm');
    const lead = await a.write('post', '/api/v1/leads').send({ name: 'Big Buyer', company: 'Buyer Co', value: 1200 });
    expect(lead.status).toBe(201);
    const converted = await a.write('post', `/api/v1/leads/${lead.body.data.id}/convert`).send({ createDeal: true });
    expect(converted.status).toBe(201);
    expect(converted.body.data.customerId).toBeTruthy();
    expect(converted.body.data.dealId).toBeTruthy();
    const deals = await a.agent.get('/api/v1/deals');
    expect(deals.body.data.items[0].name).toContain('Buyer Co');
  });
});

describe('WhatsApp webhook', () => {
  it('verifies the subscription handshake and signatures', async () => {
    const a = await signUp('wa');
    const phoneNumberId = String(Date.now());
    await prisma.whatsAppAccount.create({
      data: { tenantId: a.tenantId, name: 'Test', phoneNumberId, wabaId: '1', accessTokenEnc: encryptSecret('token-token-token-token'), appSecretEnc: encryptSecret('secret'), verifyToken: 'verify-me-123' },
    });
    const server = app.getHttpServer();
    const ok = await request(server).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me-123', 'hub.challenge': 'abc123' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    expect((await request(server).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'x' })).status).toBe(403);

    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: '14155550123', profile: { name: 'Wa Customer' } }], messages: [{ id: `wamid.${Date.now()}`, from: '14155550123', type: 'text', text: { body: 'Hello' } }] } }] }] });
    const spoofed = await request(server).post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('x-hub-signature-256', 'sha256=deadbeef').send(body);
    expect(spoofed.status).toBe(401);
    const signed = await request(server).post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('x-hub-signature-256', `sha256=${hmacSha256Hex('secret', body)}`).send(body);
    expect(signed.status).toBe(200);
    const events = await prisma.webhookEvent.count({ where: { tenantId: a.tenantId, signatureValid: true } });
    expect(events).toBe(1);
  });
});

describe('integrations', () => {
  it('runs a website chat conversation and keeps it inside its workspace', async () => {
    const a = await signUp('webchat');
    const other = await signUp('webchat-other');
    const created = await a.write('post', '/api/v1/integrations/channels/web-chat').send({ name: 'Main site', settings: { title: 'Talk to us', allowedDomains: ['shop.example.com'] } });
    expect(created.status).toBe(201);
    const key: string = created.body.data.externalId;
    expect(created.body.data.embedCode).toContain(key);

    const server = app.getHttpServer();
    const origin = { 'x-embed-origin': 'https://shop.example.com' };
    expect((await request(server).get(`/api/v1/public/webchat/${key}/config`).set('x-embed-origin', 'https://other.example')).status).toBe(403);
    const config = await request(server).get(`/api/v1/public/webchat/${key}/config`).set(origin);
    expect(config.status).toBe(200);
    expect(config.body.data.title).toBe('Talk to us');

    const session = await request(server).post(`/api/v1/public/webchat/${key}/sessions`).set(origin).send({ name: 'Visitor', email: 'visitor@test.local' });
    expect(session.status).toBe(200);
    const token: string = session.body.data.token;
    const sent = await request(server).post(`/api/v1/public/webchat/${key}/messages`).set(origin).set('x-visitor-token', token).send({ text: 'Do you ship abroad?' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.from).toBe('visitor');

    const list = await a.agent.get('/api/v1/conversations').query({ channel: 'WEB_CHAT' });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body.data)).toContain('Do you ship abroad?');
    const leak = await other.agent.get('/api/v1/conversations').query({ channel: 'WEB_CHAT' });
    expect(JSON.stringify(leak.body.data)).not.toContain('Do you ship abroad?');

    const forged = await request(server).get(`/api/v1/public/webchat/${key}/messages`).set(origin).set('x-visitor-token', `${token.split('.')[0]}.${'0'.repeat(64)}`);
    expect(forged.status).toBe(401);
    expect((await other.agent.get(`/api/v1/integrations/channels/${created.body.data.id}`)).status).toBe(404);
  });

  it('validates webhook endpoints and keeps the secret out of listings', async () => {
    const a = await signUp('hooks');
    expect((await a.write('post', '/api/v1/integrations/webhooks').send({ url: 'ftp://example.com/x', events: ['*'] })).status).toBe(422);
    expect((await a.write('post', '/api/v1/integrations/webhooks').send({ url: 'https://example.com/hook', events: ['nope.event'] })).status).toBe(422);
    const ok = await a.write('post', '/api/v1/integrations/webhooks').send({ url: 'https://example.com/hook', events: ['order.created', 'lead.created'] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.secret).toMatch(/^whsec_/);
    const list = await a.agent.get('/api/v1/integrations/webhooks');
    expect(list.body.data[0].secret).toBeUndefined();
    expect(JSON.stringify(list.body.data)).not.toContain('secretEnc');
  });
});
