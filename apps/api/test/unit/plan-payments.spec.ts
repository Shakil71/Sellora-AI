import { PlanPaymentStatus, SubscriptionPlan } from '@prisma/client';
import { addMonth, PlanPaymentsService } from '../../src/modules/billing/plan-payments.service';
import { effectivePlan, isLapsed } from '../../src/modules/billing/usage.service';

const auth = { userId: 'admin1', name: 'Admin' } as never;
const settings = { currency: 'BDT', prices: { STARTER: 3500 }, instructions: 'bKash 01XXXXXXXXX' };

function make(over: { pending?: unknown; reused?: unknown; payment?: Record<string, unknown>; sub?: Record<string, unknown> | null; updateCount?: number } = {}) {
  const prisma = {
    systemSetting: { findUnique: jest.fn(async () => ({ value: settings })) },
    planPayment: {
      findFirst: jest.fn(async (a: { where: { status?: unknown; reference?: unknown } }) => (a.where.reference ? over.reused ?? null : over.pending ?? null)),
      create: jest.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'pp1', ...a.data })),
      findUnique: jest.fn(async () => over.payment ?? null),
      findUniqueOrThrow: jest.fn(async () => over.payment),
      updateMany: jest.fn(async () => ({ count: over.updateCount ?? 1 })),
    },
    subscription: { findUnique: jest.fn(async () => over.sub ?? null), upsert: jest.fn(async () => ({})) },
  };
  const notifications = { notify: jest.fn() };
  return { svc: new PlanPaymentsService(prisma as never, { log: jest.fn() } as never, notifications as never), prisma, notifications };
}
const actor = { tenantId: 't1', userId: 'u1', name: 'Owner', type: 'USER' as const };
const pendingPayment = { id: 'pp1', tenantId: 't1', plan: SubscriptionPlan.STARTER, amount: 3500, currency: 'BDT', status: PlanPaymentStatus.PENDING };

describe('plan payments', () => {
  it('adds a month without overflowing short months', () => {
    expect(addMonth(new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonth(new Date('2026-10-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-15');
  });

  it('records a submitted payment at the configured price with an upper-cased reference', async () => {
    const { svc, prisma } = make();
    const row = await svc.submit(actor, { plan: 'STARTER', method: 'bKash', reference: 'ab12cd34' });
    expect(row).toMatchObject({ amount: 3500, currency: 'BDT', reference: 'AB12CD34' });
    expect(prisma.planPayment.create).toHaveBeenCalled();
  });

  it('refuses plans without a price, second pending payments and reused transaction ids', async () => {
    await expect(make().svc.submit(actor, { plan: 'PRO', method: 'bKash', reference: 'ab12cd34' })).rejects.toThrow('No price');
    await expect(make({ pending: { id: 'x' } }).svc.submit(actor, { plan: 'STARTER', method: 'bKash', reference: 'ab12cd34' })).rejects.toThrow('waiting');
    await expect(make({ reused: { id: 'x' } }).svc.submit(actor, { plan: 'STARTER', method: 'bKash', reference: 'ab12cd34' })).rejects.toThrow('already submitted');
  });

  it('approving activates the plan for a month and notifies the workspace', async () => {
    const { svc, prisma, notifications } = make({ payment: pendingPayment });
    await svc.approve(auth, 'pp1', {});
    const upsert = prisma.subscription.upsert.mock.calls[0]![0] as { update: { plan: string; provider: string; renewalDate: Date } };
    expect(upsert.update).toMatchObject({ plan: 'STARTER', provider: 'manual' });
    expect(upsert.update.renewalDate.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('renewing early extends from the current renewal date', async () => {
    const renewal = new Date(Date.now() + 10 * 86_400_000);
    const { svc, prisma } = make({ payment: pendingPayment, sub: { plan: 'STARTER', status: 'ACTIVE', renewalDate: renewal } });
    await svc.approve(auth, 'pp1', {});
    const upsert = prisma.subscription.upsert.mock.calls[0]![0] as { update: { renewalDate: Date } };
    expect(upsert.update.renewalDate.getTime()).toBeGreaterThan(renewal.getTime() + 27 * 86_400_000);
  });

  it('cannot approve the same payment twice', async () => {
    const { svc, prisma } = make({ payment: pendingPayment, updateCount: 0 });
    await expect(svc.approve(auth, 'pp1', {})).rejects.toThrow('already reviewed');
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });
});

describe('lapsed manual subscriptions', () => {
  const day = 86_400_000;
  it('keeps the plan through the grace period, then falls back to Free', () => {
    const sub = (offsetDays: number) => ({ plan: SubscriptionPlan.PRO, provider: 'manual', renewalDate: new Date(Date.now() + offsetDays * day) });
    expect(isLapsed(sub(5))).toBe(false);
    expect(isLapsed(sub(-2))).toBe(false);
    expect(isLapsed(sub(-4))).toBe(true);
    expect(effectivePlan(sub(-4))).toBe(SubscriptionPlan.FREE);
    expect(effectivePlan(sub(-1))).toBe(SubscriptionPlan.PRO);
  });

  it('never lapses plans assigned by an admin or paid through a gateway', () => {
    const old = new Date(Date.now() - 90 * day);
    expect(isLapsed({ plan: SubscriptionPlan.PRO, provider: null, renewalDate: old })).toBe(false);
    expect(isLapsed({ plan: SubscriptionPlan.PRO, provider: 'stripe', renewalDate: old })).toBe(false);
    expect(isLapsed({ plan: SubscriptionPlan.PRO, provider: 'manual', renewalDate: null })).toBe(false);
  });
});
