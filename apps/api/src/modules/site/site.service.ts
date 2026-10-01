import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_HOME_CONTENT, HOME_ICONS, HOME_SECTION_KEYS, HomeContent, mergeHomeContent } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlanPaymentsService } from '../billing/plan-payments.service';
import type { AuthContext } from '../../common/auth-context';

const KEY = 'homepage';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1, 'This field cannot be empty').max(max);
/** Only addresses inside the site or plain http(s)/mailto links: no javascript: or data: links. */
const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^(\/(?!\/)|https?:\/\/|mailto:|tel:|#)/i.test(v), 'Use a link such as /register, https://example.com or mailto:you@example.com');
const link = z.object({ label: required(60), href });
const icon = z.enum(HOME_ICONS);
const item = z.object({ icon, title: required(80), text: text(400) });
const heading = { eyebrow: text(60), title: required(140), text: text(500) };

export const homeContentSchema = z.object({
  brandName: required(40),
  seo: z.object({ title: required(120), description: text(300) }),
  hero: z.object({
    badgeLabel: text(20),
    badgeText: text(80),
    headlinePrefix: required(120),
    headlineHighlight: text(40),
    subheadline: text(500),
    primaryCta: link,
    secondaryCta: link,
    checks: z.array(required(60)).max(6),
  }),
  foundations: z.array(z.object({ icon, label: required(60) })).max(10),
  flow: z.object(heading),
  tour: z.object(heading),
  features: z.object({ ...heading, items: z.array(item).max(12) }),
  guardrails: z.object({ ...heading, items: z.array(item).max(8) }),
  steps: z.object({ ...heading, items: z.array(item).max(6) }),
  security: z.object({ ...heading, items: z.array(item).max(12) }),
  pricing: z.object({ ...heading, popularLabel: text(30), buyLabel: required(30), contactLabel: required(30) }),
  testimonials: z.array(z.object({ quote: required(400), name: required(60), role: text(80) })).max(9),
  faq: z.object({ ...heading, items: z.array(z.object({ q: required(200), a: required(1500) })).max(30) }),
  cta: z.object({ headline: required(140), text: text(400), primaryCta: link, secondaryCta: link }),
  footer: z.object({ description: text(200), legal: text(300) }),
  sections: z.object(Object.fromEntries(HOME_SECTION_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof HOME_SECTION_KEYS)[number], z.ZodBoolean>),
});

@Injectable()
export class SiteService {
  private cache?: { at: number; value: HomeContent };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planPayments: PlanPaymentsService,
  ) {}

  /** What the home page shows: saved content over the defaults. Cached for a few seconds, since every visitor asks for it. */
  async content(): Promise<HomeContent> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } }).catch(() => null);
    const parsed = row ? homeContentSchema.safeParse(mergeHomeContent(row.value)) : null;
    const value = parsed?.success ? (parsed.data as HomeContent) : DEFAULT_HOME_CONTENT;
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** Public payload: content plus the plan prices the platform owner charges, so the pricing section matches Billing. */
  async publicHome() {
    const [content, billing] = await Promise.all([this.content(), this.planPayments.settings()]);
    return {
      content,
      pricing: {
        currency: billing.currency,
        prices: Object.fromEntries(['STARTER', 'PRO', 'BUSINESS'].map((p) => [p, this.planPayments.priceFor(billing, p as 'STARTER').amount])),
        custom: Object.keys(billing.prices).length > 0,
      },
    };
  }

  async save(auth: AuthContext, input: z.infer<typeof homeContentSchema>) {
    const value = homeContentSchema.parse(input);
    await this.prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    this.cache = undefined;
    await this.audit.log({ userId: auth.userId, name: auth.name, type: 'USER' }, { action: 'platform.homepage_changed' });
    return value;
  }

  async reset(auth: AuthContext) {
    await this.prisma.systemSetting.deleteMany({ where: { key: KEY } });
    this.cache = undefined;
    await this.audit.log({ userId: auth.userId, name: auth.name, type: 'USER' }, { action: 'platform.homepage_reset' });
    return DEFAULT_HOME_CONTENT;
  }
}
