/**
 * Subscription plans and usage limits. A limit of -1 means unlimited.
 * Prices are defaults for the pricing page and can be edited here.
 */
export const PLAN_KEYS = ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const USAGE_METRICS = [
  'aiMessages',
  'whatsappMessages',
  'users',
  'products',
  'workflows',
  'storageMb',
  'knowledgeDocuments',
  'aiAgents',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/** Metrics counted per calendar month. Others are counted as current totals. */
export const MONTHLY_METRICS: UsageMetric[] = ['aiMessages', 'whatsappMessages'];

export type PlanLimits = Record<UsageMetric, number>;

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  description: string;
  monthlyPrice: number | null;
  highlighted?: boolean;
  limits: PlanLimits;
  features: string[];
}

export const UNLIMITED = -1;

export const PLANS: Record<PlanKey, PlanDefinition> = {
  FREE: {
    key: 'FREE',
    name: 'Free',
    description: 'Explore Sellora AI with a single number and a small catalog.',
    monthlyPrice: 0,
    limits: {
      aiMessages: 100,
      whatsappMessages: 1000,
      users: 2,
      products: 50,
      workflows: 2,
      storageMb: 100,
      knowledgeDocuments: 5,
      aiAgents: 1,
    },
    features: ['1 WhatsApp number', '1 AI sales agent', 'CRM & orders', 'Community support'],
  },
  STARTER: {
    key: 'STARTER',
    name: 'Starter',
    description: 'For small shops starting to sell on WhatsApp.',
    monthlyPrice: 29,
    limits: {
      aiMessages: 2000,
      whatsappMessages: 10000,
      users: 5,
      products: 500,
      workflows: 10,
      storageMb: 1024,
      knowledgeDocuments: 50,
      aiAgents: 2,
    },
    features: ['Everything in Free', 'Knowledge base', 'Automation workflows', 'Email support'],
  },
  PRO: {
    key: 'PRO',
    name: 'Pro',
    description: 'For growing teams that run sales through conversations.',
    monthlyPrice: 79,
    highlighted: true,
    limits: {
      aiMessages: 10000,
      whatsappMessages: 50000,
      users: 15,
      products: 5000,
      workflows: 50,
      storageMb: 5120,
      knowledgeDocuments: 250,
      aiAgents: 5,
    },
    features: ['Everything in Starter', 'Advanced analytics', 'API access', 'Priority support'],
  },
  BUSINESS: {
    key: 'BUSINESS',
    name: 'Business',
    description: 'For multi-team operations with high message volume.',
    monthlyPrice: 199,
    limits: {
      aiMessages: 50000,
      whatsappMessages: 250000,
      users: 50,
      products: 50000,
      workflows: 200,
      storageMb: 20480,
      knowledgeDocuments: 1000,
      aiAgents: 20,
    },
    features: ['Everything in Pro', 'Custom roles', 'Audit logs', 'Onboarding assistance'],
  },
  ENTERPRISE: {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom limits, security reviews and dedicated support.',
    monthlyPrice: null,
    limits: {
      aiMessages: UNLIMITED,
      whatsappMessages: UNLIMITED,
      users: UNLIMITED,
      products: UNLIMITED,
      workflows: UNLIMITED,
      storageMb: UNLIMITED,
      knowledgeDocuments: UNLIMITED,
      aiAgents: UNLIMITED,
    },
    features: ['Everything in Business', 'Unlimited usage', 'SLA', 'Dedicated manager'],
  },
};

export const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  aiMessages: 'AI messages / month',
  whatsappMessages: 'WhatsApp messages / month',
  users: 'Team members',
  products: 'Products',
  workflows: 'Workflows',
  storageMb: 'Storage (MB)',
  knowledgeDocuments: 'Knowledge documents',
  aiAgents: 'AI agents',
};

export function isWithinLimit(limit: number, current: number, increment = 1): boolean {
  if (limit === UNLIMITED) return true;
  return current + increment <= limit;
}

export function currentUsagePeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
