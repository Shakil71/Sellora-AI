import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptJson, encryptJson, randomToken } from '../../common/utils/crypto.util';
import { slugify } from '../../common/utils/text.util';
import { ConflictError, ensureFound, ValidationError } from '../../common/errors';
import { env } from '../../config/env';
import type { Actor } from '../../common/auth-context';
import { GatewayContext, GatewayError, PaymentGatewayAdapter } from './gateway.types';
import { GATEWAYS, getGateway } from './gateways';
import { MANUAL_PRESETS } from './presets';

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use 2-letter country codes such as BD, IN or US');
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use 3-letter currency codes such as USD or BDT');

const baseFields = {
  name: z.string().trim().min(2).max(60),
  instructions: z.string().trim().max(1000).nullable().optional(),
  countries: z.array(countryCode).max(250).optional(),
  currencies: z.array(currencyCode).max(50).optional(),
  isActive: z.boolean().optional(),
  /** Gateway field values. Blank secrets keep the saved value when editing. */
  values: z.record(z.string().max(2000)).optional(),
};

export const createPaymentMethodSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  methodKey: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,40}$/, 'Use letters, numbers and underscores')
    .optional(),
  ...baseFields,
});

export const updatePaymentMethodSchema = z.object({ ...baseFields, name: baseFields.name.optional() });

export type PaymentMethodView = ReturnType<PaymentMethodsService['present']>;

type Values = Record<string, string>;

/** Public description of the catalog: no functions, safe to send to the browser. */
function describe(a: PaymentGatewayAdapter) {
  const { verify: _v, createPayment: _c, parseWebhook: _p, ...info } = a;
  return { ...info, online: Boolean(a.createPayment) };
}

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalog() {
    return {
      gateways: GATEWAYS.map(describe),
      presets: MANUAL_PRESETS,
      webhookBaseUrl: `${env.API_URL}/api/v1/payment-gateways/webhooks`,
    };
  }

  /** Decrypted gateway values (keys, mode, link template…). Server-side only. */
  private values(method: PaymentMethod): Values {
    return decryptJson<Values>(method.credentialsEnc) ?? {};
  }

  /** The adapter and credentials needed to talk to a method's gateway. */
  context(method: PaymentMethod): { adapter: PaymentGatewayAdapter; ctx: GatewayContext } {
    const adapter = ensureFound(getGateway(method.provider), 'Payment gateway');
    const values = this.values(method);
    return { adapter, ctx: { credentials: values, config: values } };
  }

  present(m: PaymentMethod) {
    const adapter = getGateway(m.provider);
    const values = this.values(m);
    const secretKeys = (adapter?.fields ?? []).filter((f) => f.secret).map((f) => f.key);
    return {
      id: m.id,
      provider: m.provider,
      providerLabel: adapter?.label ?? m.provider,
      methodKey: m.methodKey,
      name: m.name,
      instructions: m.instructions,
      countries: m.countries,
      currencies: m.currencies,
      isActive: m.isActive,
      lastError: m.lastError,
      online: Boolean(adapter?.createPayment),
      webhookUrl: adapter?.webhook ? this.webhookUrl(m) : null,
      values: Object.fromEntries(Object.entries(values).filter(([k]) => !secretKeys.includes(k))),
      secretsSet: secretKeys.filter((k) => Boolean(values[k])),
      /** Fields still needed before the gateway can confirm payments (webhook secrets). */
      missingSetup: this.missingSetup(adapter, values),
      createdAt: m.createdAt,
    };
  }

  /** Labels of webhook-related fields that have not been filled in yet. */
  missingSetup(adapter: PaymentGatewayAdapter | undefined, values: Values): string[] {
    return (adapter?.fields ?? []).filter((f) => f.later && !values[f.key]).map((f) => f.label);
  }

  webhookUrl(m: Pick<PaymentMethod, 'webhookToken'>) {
    return `${env.API_URL}/api/v1/payment-gateways/webhooks/${m.webhookToken}`;
  }

  async list(tenantId: string) {
    const rows = await this.prisma.paymentMethod.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((m) => this.present(m));
  }

  async byWebhookToken(token: string) {
    return this.prisma.paymentMethod.findUnique({ where: { webhookToken: token } });
  }

  async get(tenantId: string, id: string) {
    return ensureFound(await this.prisma.paymentMethod.findFirst({ where: { id, tenantId } }), 'Payment method');
  }

  /** Keeps only the adapter's fields, enforcing required fields and select options. */
  private cleanValues(adapter: PaymentGatewayAdapter, input: Values | undefined, saved: Values): Values {
    const out: Values = {};
    for (const f of adapter.fields) {
      const given = input?.[f.key]?.trim();
      // A blank secret on edit means "keep what is saved"; other fields can be cleared.
      const value = f.secret ? given || saved[f.key] : input && f.key in input ? given : saved[f.key];
      const final = value || f.default || '';
      if (f.required && !f.later && !final) throw new ValidationError(`${f.label} is required.`);
      if (f.options && final && !f.options.some((o) => o.value === final)) throw new ValidationError(`Choose a valid ${f.label}.`);
      if (final) out[f.key] = final;
    }
    return out;
  }

  private async verify(adapter: PaymentGatewayAdapter, values: Values) {
    if (!adapter.verify) return;
    try {
      await adapter.verify({ credentials: values, config: values });
    } catch (err) {
      if (err instanceof GatewayError) throw new ValidationError(err.message);
      throw err;
    }
  }

  private async uniqueKey(tenantId: string, wanted: string) {
    const base = wanted.replace(/-/g, '_');
    for (let i = 0; i < 20; i++) {
      const key = i === 0 ? base : `${base}_${i + 1}`;
      if (!(await this.prisma.paymentMethod.findUnique({ where: { tenantId_methodKey: { tenantId, methodKey: key } }, select: { id: true } }))) return key;
    }
    throw new ConflictError('Choose a different name for this payment method.');
  }

  async create(actor: Actor, input: z.infer<typeof createPaymentMethodSchema>) {
    const adapter = getGateway(input.provider);
    if (!adapter) throw new ValidationError('Unknown payment gateway.');
    if (adapter.key === 'manual' && !input.instructions) throw new ValidationError('Tell customers how to pay, for example the account number to send money to.');
    const values = this.cleanValues(adapter, input.values, {});
    await this.verify(adapter, values);
    let methodKey: string;
    if (input.methodKey) {
      const taken = await this.prisma.paymentMethod.findUnique({ where: { tenantId_methodKey: { tenantId: actor.tenantId, methodKey: input.methodKey } }, select: { id: true } });
      if (taken) throw new ConflictError('You already have a payment method with this key.');
      methodKey = input.methodKey;
    } else {
      methodKey = await this.uniqueKey(actor.tenantId, slugify(input.name));
    }
    const count = await this.prisma.paymentMethod.count({ where: { tenantId: actor.tenantId } });
    const row = await this.prisma.paymentMethod.create({
      data: {
        tenantId: actor.tenantId,
        provider: adapter.key,
        methodKey,
        name: input.name,
        instructions: input.instructions || null,
        countries: input.countries ?? [],
        currencies: input.currencies ?? [],
        isActive: input.isActive ?? true,
        sortOrder: count,
        credentialsEnc: Object.keys(values).length ? encryptJson(values) : null,
        webhookToken: randomToken(24),
      },
    });
    await this.audit.log(actor, { action: 'payment_method.created', entityType: 'PaymentMethod', entityId: row.id, metadata: { provider: adapter.key, name: row.name } });
    return this.present(row);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof updatePaymentMethodSchema>) {
    const existing = await this.get(actor.tenantId, id);
    const adapter = ensureFound(getGateway(existing.provider), 'Payment gateway');
    const saved = this.values(existing);
    const values = input.values ? this.cleanValues(adapter, input.values, saved) : saved;
    const changed = input.values && JSON.stringify(values) !== JSON.stringify(saved);
    if (changed) await this.verify(adapter, values);
    const instructions = input.instructions === undefined ? existing.instructions : input.instructions || null;
    if (adapter.key === 'manual' && !instructions) throw new ValidationError('Tell customers how to pay, for example the account number to send money to.');
    const row = await this.prisma.paymentMethod.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        instructions,
        ...(input.countries ? { countries: input.countries } : {}),
        ...(input.currencies ? { currencies: input.currencies } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(changed ? { credentialsEnc: encryptJson(values), lastError: null } : {}),
      },
    });
    await this.audit.log(actor, { action: 'payment_method.updated', entityType: 'PaymentMethod', entityId: id, metadata: { name: row.name, credentialsChanged: Boolean(changed), isActive: row.isActive } });
    return this.present(row);
  }

  async remove(actor: Actor, id: string) {
    const existing = await this.get(actor.tenantId, id);
    await this.prisma.paymentMethod.delete({ where: { id } });
    await this.audit.log(actor, { action: 'payment_method.deleted', entityType: 'PaymentMethod', entityId: id, metadata: { name: existing.name } });
    return { deleted: true };
  }

  /** Re-checks the saved credentials with the gateway and records the result. */
  async test(actor: Actor, id: string) {
    const method = await this.get(actor.tenantId, id);
    const { adapter, ctx } = this.context(method);
    let error: string | null = null;
    try {
      if (adapter.verify) await adapter.verify(ctx);
    } catch (err) {
      error = err instanceof GatewayError ? err.message : 'The gateway check failed.';
    }
    const row = await this.prisma.paymentMethod.update({ where: { id }, data: { lastError: error } });
    return { ok: !error, error, method: this.present(row) };
  }
}
