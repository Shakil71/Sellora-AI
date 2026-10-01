import { Injectable } from '@nestjs/common';
import { MembershipStatus, SubscriptionPlan } from '@prisma/client';
import {
  currentUsagePeriod,
  isWithinLimit,
  MONTHLY_METRICS,
  PlanLimits,
  PLANS,
  UNLIMITED,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  UsageMetric,
} from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LimitExceededError } from '../../common/errors';

/** Days a manually paid workspace keeps its plan after the paid month ends. */
const GRACE_DAYS = 3;

/** True when a manually paid subscription ran out (plus grace) without a renewal. */
export function isLapsed(sub: { plan: SubscriptionPlan; provider: string | null; renewalDate: Date | null } | null | undefined, now = new Date()): boolean {
  if (!sub || sub.plan === SubscriptionPlan.FREE || sub.provider !== 'manual' || !sub.renewalDate) return false;
  return sub.renewalDate.getTime() + GRACE_DAYS * 86_400_000 < now.getTime();
}

/** The plan whose limits apply right now. */
export function effectivePlan(sub: { plan: SubscriptionPlan; provider: string | null; renewalDate: Date | null } | null | undefined): SubscriptionPlan {
  if (!sub) return SubscriptionPlan.FREE;
  return isLapsed(sub) ? SubscriptionPlan.FREE : sub.plan;
}

/**
 * Tracks usage against plan limits. Monthly metrics are counters; the rest are
 * computed from live data so they can never drift.
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async limitsFor(tenantId: string): Promise<{ plan: SubscriptionPlan; limits: PlanLimits }> {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    const plan = effectivePlan(sub);
    const base = PLANS[plan].limits;
    const override = (sub?.limitsOverride ?? {}) as Partial<PlanLimits>;
    return { plan, limits: { ...base, ...override } };
  }

  async current(tenantId: string, metric: UsageMetric): Promise<number> {
    if (MONTHLY_METRICS.includes(metric)) {
      const row = await this.prisma.usageCounter.findUnique({
        where: { tenantId_metric_period: { tenantId, metric, period: currentUsagePeriod() } },
      });
      return row?.value ?? 0;
    }
    switch (metric) {
      case 'users':
        return this.prisma.userRole.count({
          where: { tenantId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] } },
        });
      case 'products':
        return this.prisma.product.count({ where: { tenantId } });
      case 'workflows':
        return this.prisma.workflow.count({ where: { tenantId } });
      case 'knowledgeDocuments':
        return this.prisma.aIDocument.count({ where: { tenantId } });
      case 'aiAgents':
        return this.prisma.aIAgent.count({ where: { tenantId } });
      case 'storageMb': {
        const agg = await this.prisma.storedFile.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } });
        return Math.ceil((agg._sum.sizeBytes ?? 0) / (1024 * 1024));
      }
      default:
        return 0;
    }
  }

  /** Throws a friendly 402 error when the action would exceed the plan. */
  async assertWithin(tenantId: string, metric: UsageMetric, increment = 1): Promise<void> {
    const { limits } = await this.limitsFor(tenantId);
    const limit = limits[metric];
    if (limit === UNLIMITED) return;
    const used = await this.current(tenantId, metric);
    if (!isWithinLimit(limit, used, increment)) {
      throw new LimitExceededError(USAGE_METRIC_LABELS[metric].toLowerCase(), limit);
    }
  }

  /** Non-throwing check used by background jobs (they log and skip instead). */
  async hasCapacity(tenantId: string, metric: UsageMetric, increment = 1): Promise<boolean> {
    try {
      await this.assertWithin(tenantId, metric, increment);
      return true;
    } catch {
      return false;
    }
  }

  async increment(tenantId: string, metric: UsageMetric, by = 1): Promise<void> {
    if (!MONTHLY_METRICS.includes(metric)) return;
    const period = currentUsagePeriod();
    await this.prisma.usageCounter.upsert({
      where: { tenantId_metric_period: { tenantId, metric, period } },
      create: { tenantId, metric, period, value: by },
      update: { value: { increment: by } },
    });
  }

  async summary(tenantId: string) {
    const { plan, limits } = await this.limitsFor(tenantId);
    const metrics = await Promise.all(
      USAGE_METRICS.map(async (metric) => {
        const used = await this.current(tenantId, metric);
        const limit = limits[metric];
        const percent = limit === UNLIMITED ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
        return { metric, label: USAGE_METRIC_LABELS[metric], used, limit, percent, warning: percent >= 80 };
      }),
    );
    return { plan, period: currentUsagePeriod(), metrics };
  }
}
