/**
 * Editable content of the public home page. The platform administrator changes it
 * under Platform admin → Home page; these defaults are used until they do, and for
 * any field that is missing.
 */

export const HOME_ICONS = [
  'message', 'sparkles', 'database', 'server', 'shield', 'target', 'package', 'boxes', 'file', 'chart', 'bell', 'users',
  'lock', 'key', 'globe', 'bot', 'check', 'zap', 'search', 'languages', 'cart', 'heart', 'star', 'rocket',
] as const;
export type HomeIcon = (typeof HOME_ICONS)[number];

export interface HomeLink {
  label: string;
  href: string;
}
export interface HomeItem {
  icon: HomeIcon;
  title: string;
  text: string;
}
export interface HomeHeading {
  eyebrow: string;
  title: string;
  text: string;
}

export const HOME_SECTION_KEYS = ['foundations', 'flow', 'tour', 'features', 'guardrails', 'steps', 'security', 'pricing', 'testimonials', 'faq', 'cta'] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export interface HomeContent {
  brandName: string;
  seo: { title: string; description: string };
  hero: {
    badgeLabel: string;
    badgeText: string;
    headlinePrefix: string;
    headlineHighlight: string;
    subheadline: string;
    primaryCta: HomeLink;
    secondaryCta: HomeLink;
    checks: string[];
  };
  foundations: Array<{ icon: HomeIcon; label: string }>;
  flow: HomeHeading;
  tour: HomeHeading;
  features: HomeHeading & { items: HomeItem[] };
  guardrails: HomeHeading & { items: HomeItem[] };
  steps: HomeHeading & { items: HomeItem[] };
  security: HomeHeading & { items: HomeItem[] };
  pricing: HomeHeading & { popularLabel: string; buyLabel: string; contactLabel: string };
  testimonials: Array<{ quote: string; name: string; role: string }>;
  faq: HomeHeading & { items: Array<{ q: string; a: string }> };
  cta: { headline: string; text: string; primaryCta: HomeLink; secondaryCta: HomeLink };
  footer: { description: string; legal: string };
  /** Turn whole sections off without deleting them. */
  sections: Record<HomeSectionKey, boolean>;
}

export const DEFAULT_HOME_CONTENT: HomeContent = {
  brandName: 'Sellora AI',
  seo: {
    title: 'Sellora AI: Turn WhatsApp Conversations Into Revenue',
    description: 'Sellora AI combines an AI sales agent, a WhatsApp team inbox, CRM, product catalog, orders and automation in one platform you can self-host.',
  },
  hero: {
    badgeLabel: 'New',
    badgeText: 'AI sales agent for WhatsApp commerce',
    headlinePrefix: 'Turn WhatsApp conversations into',
    headlineHighlight: 'revenue.',
    subheadline:
      'Sellora AI answers customers, recommends products from your real catalog, takes orders and keeps your CRM up to date, while your team handles the conversations that need a human.',
    primaryCta: { label: 'Start selling smarter', href: '/register' },
    secondaryCta: { label: 'See the product', href: '/#product' },
    checks: ['Free plan available', 'No credit card to start', 'Self-hostable'],
  },
  foundations: [
    { icon: 'message', label: 'Official WhatsApp Cloud API' },
    { icon: 'sparkles', label: 'Any OpenAI-compatible model' },
    { icon: 'database', label: 'PostgreSQL & Redis' },
    { icon: 'server', label: 'Self-host on your own server' },
    { icon: 'shield', label: 'Role-based access & audit logs' },
  ],
  flow: {
    eyebrow: 'From chat to checkout',
    title: 'A complete sale, without leaving WhatsApp',
    text: 'Here is what happens when a customer writes to your number and the AI agent is on duty.',
  },
  tour: { eyebrow: 'Product tour', title: 'See Sellora AI in action', text: 'Real screens from the demo workspace. Pick an area to explore.' },
  features: {
    eyebrow: 'Features',
    title: 'Everything you need to sell on WhatsApp',
    text: 'One platform for conversations, customers, catalog and orders, so nothing falls between tools.',
    items: [
      { icon: 'target', title: 'CRM & pipelines', text: 'Leads captured from chats, customers with full history, and drag-and-drop deal pipelines.' },
      { icon: 'package', title: 'Product catalog', text: 'Products, categories, images, stock levels and product knowledge the AI can use.' },
      { icon: 'boxes', title: 'Inventory', text: 'Reserve on order, deduct on shipment, restock on cancellation, with low-stock alerts.' },
      { icon: 'file', title: 'Invoices & payments', text: 'Record payments, issue printable invoices, export PDFs and track deliveries.' },
      { icon: 'chart', title: 'Analytics', text: 'Sales, CRM, conversation and AI reports calculated from your real data.' },
      { icon: 'bell', title: 'Realtime notifications', text: 'New messages, handoffs, orders and low stock reach the right people instantly.' },
    ],
  },
  guardrails: {
    eyebrow: 'Responsible AI',
    title: 'Sells with facts, not guesses',
    text: 'The model never touches your database. Every action goes through a tool that is authorised, validated and logged, so you can see exactly why the AI said what it said.',
    items: [
      { icon: 'database', title: 'Facts come from your data', text: 'Prices, stock, delivery fees and totals only come from live tool calls, never from the model’s imagination.' },
      { icon: 'check', title: 'Confirmation before orders', text: 'The agent places an order only after the customer approves an itemised summary, and only if you allow it.' },
      { icon: 'users', title: 'Graceful human handoff', text: 'Complex or sensitive cases go to your team with an AI-written summary of the conversation.' },
      { icon: 'languages', title: 'Your tone, your rules', text: 'Set personality, language, working hours, escalation rules and a knowledge base per agent.' },
    ],
  },
  steps: {
    eyebrow: 'How it works',
    title: 'Live in an afternoon',
    text: 'Three steps from sign-up to your first AI-assisted sale.',
    items: [
      { icon: 'message', title: 'Connect WhatsApp', text: 'Link your number through the official Meta Cloud API. Your number and account stay yours.' },
      { icon: 'package', title: 'Add products & knowledge', text: 'Import your catalog, delivery zones and policies so the AI answers with facts.' },
      { icon: 'bot', title: 'Let AI sell, your team steps in', text: 'The agent handles routine sales around the clock and hands complex cases to a human.' },
    ],
  },
  security: {
    eyebrow: 'Security & ownership',
    title: 'Your data, your server',
    text: 'Run Sellora AI on your own VPS with PostgreSQL and Redis, behind your own domain. No Docker needed, and nothing leaves your infrastructure except the APIs you connect.',
    items: [
      { icon: 'lock', title: 'Encrypted secrets', text: 'WhatsApp tokens, AI keys and 2FA secrets are encrypted with AES-256-GCM.' },
      { icon: 'users', title: 'Granular roles', text: 'Owner, Admin, Manager, Sales, Support, Agent and Viewer, plus custom roles.' },
      { icon: 'key', title: 'Strong sign-in', text: 'Argon2id passwords, two-factor authentication and rotating sessions.' },
      { icon: 'check', title: 'Verified webhooks', text: 'Every WhatsApp and payment webhook is signature-checked before processing.' },
      { icon: 'globe', title: 'Workspace isolation', text: 'Every query is scoped to one workspace, so businesses never see each other’s data.' },
      { icon: 'file', title: 'Audit logs', text: 'Who changed what and when, with secrets automatically scrubbed.' },
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'Simple, usage-based plans',
    text: 'Start free. Upgrade when your conversations grow.',
    popularLabel: 'Most popular',
    buyLabel: 'Get started',
    contactLabel: 'Contact us',
  },
  testimonials: [],
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions, answered',
    text: 'Can’t find what you need? Sign up for free and explore the demo workspace.',
    items: [
      { q: 'Does Sellora AI use the official WhatsApp API?', a: 'Yes. Sellora AI connects through the Meta WhatsApp Cloud API. You keep ownership of your number and your WhatsApp Business Account.' },
      { q: 'Can the AI make up prices or stock?', a: 'No. Prices, availability, delivery fees and totals only come from live tool calls against your catalog. Orders are only placed after the customer confirms an itemised summary.' },
      { q: 'What happens when the AI cannot help?', a: 'It transfers the conversation to your team, notifies the right people and writes a short summary so nobody has to scroll back.' },
      { q: 'Which AI provider do you use?', a: 'Any OpenAI-compatible API. Each workspace can bring its own key; usage and estimated cost are tracked per agent.' },
      { q: 'Can my team use it on their phones?', a: 'Yes. The whole app, including the inbox, is fully responsive and works in any modern mobile browser.' },
      { q: 'Can I self-host it?', a: 'Yes. Sellora AI runs on a standard VPS with Node.js, PostgreSQL, Redis and Nginx or Apache. No Docker is required.' },
    ],
  },
  cta: {
    headline: 'Your next customer is already typing.',
    text: 'Set up Sellora AI and let your AI sales agent answer, recommend and sell, while your team focuses on the conversations that matter.',
    primaryCta: { label: 'Start selling smarter', href: '/register' },
    secondaryCta: { label: 'Sign in', href: '/login' },
  },
  footer: {
    description: 'AI-powered WhatsApp sales and commerce automation for growing businesses.',
    legal: 'WhatsApp is a trademark of its respective owner; Sellora AI uses the official WhatsApp Cloud API.',
  },
  sections: { foundations: true, flow: true, tour: true, features: true, guardrails: true, steps: true, security: true, pricing: true, testimonials: true, faq: true, cta: true },
};

/** Fills anything missing in `stored` from the defaults, one level at a time (lists are taken as stored). */
export function mergeHomeContent(stored: unknown): HomeContent {
  const out: Record<string, unknown> = {};
  const src = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  for (const [key, def] of Object.entries(DEFAULT_HOME_CONTENT)) {
    const value = src[key];
    if (value === undefined || value === null) out[key] = def;
    else if (def && typeof def === 'object' && !Array.isArray(def) && typeof value === 'object' && !Array.isArray(value)) out[key] = { ...(def as object), ...(value as object) };
    else out[key] = value;
  }
  return out as unknown as HomeContent;
}
