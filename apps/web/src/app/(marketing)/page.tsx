import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Check,
  CheckCheck,
  Database,
  FileText,
  Globe,
  KeyRound,
  Languages,
  Lock,
  MessageCircle,
  MessagesSquare,
  Package,
  PackageCheck,
  Search,
  Server,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Target,
  UserRoundCheck,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';
import { PLANS, PLAN_KEYS } from '@sellora/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { BrowserFrame, PhoneFrame, ThemedShot } from '@/components/marketing/frames';
import { ProductTour } from '@/components/marketing/product-tour';

export const metadata: Metadata = {
  title: 'Sellora AI — Turn WhatsApp Conversations Into Revenue',
  description:
    'Sellora AI combines an AI sales agent, a WhatsApp team inbox, CRM, product catalog, orders and automation in one platform you can self-host.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Sellora AI — Turn WhatsApp Conversations Into Revenue',
    description: 'AI sales agent, WhatsApp inbox, CRM, orders and automation in one platform.',
    images: [
      {
        url: '/marketing/dashboard-light.webp',
        width: 1920,
        height: 1200,
        alt: 'Sellora AI dashboard',
      },
    ],
  },
};

/**
 * Social proof is configuration-driven. Leave these empty until you have
 * real, permissioned logos and quotes — the sections stay hidden.
 */
const TRUSTED_BY: Array<{ name: string; logoUrl: string }> = [];
const TESTIMONIALS: Array<{ quote: string; name: string; role: string }> = [];

const FOUNDATIONS = [
  { icon: MessageCircle, label: 'Official WhatsApp Cloud API' },
  { icon: Sparkles, label: 'Any OpenAI-compatible model' },
  { icon: Database, label: 'PostgreSQL & Redis' },
  { icon: Server, label: 'Self-host on your own server' },
  { icon: ShieldCheck, label: 'Role-based access & audit logs' },
];

const FLOW = [
  {
    icon: MessageCircle,
    step: 'Customer asks',
    text: 'A shopper messages your WhatsApp number at any hour.',
    detail: (
      <p className="w-fit max-w-full rounded-2xl rounded-tl-sm border bg-background px-3 py-2 text-xs shadow-xs">
        Do you have noise-cancelling headphones?
      </p>
    ),
  },
  {
    icon: Search,
    step: 'AI checks facts',
    text: 'The agent searches your catalog, stock and delivery zones through controlled tools.',
    detail: (
      <div className="space-y-1 font-mono text-[11px]">
        <p className="flex items-center gap-1.5 text-ai">
          <Zap className="size-3" /> searchProducts
        </p>
        <p className="flex items-center gap-1.5 text-ai">
          <Zap className="size-3" /> checkInventory
        </p>
      </div>
    ),
  },
  {
    icon: CheckCheck,
    step: 'Customer confirms',
    text: 'An itemised summary with real totals is sent, and nothing is ordered until they say yes.',
    detail: (
      <p className="w-fit rounded-md border bg-background px-2.5 py-1.5 text-[11px] shadow-xs">
        1 × Wireless Headphones · <span className="font-medium">Confirm?</span>
      </p>
    ),
  },
  {
    icon: PackageCheck,
    step: 'Order is created',
    text: 'Stock is reserved, the CRM is updated and your team is notified in real time.',
    detail: (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="success">Order created</Badge>
        <Badge variant="info">Stock reserved</Badge>
      </div>
    ),
  },
];

const FEATURES = [
  {
    icon: Target,
    title: 'CRM & pipelines',
    text: 'Leads captured from chats, customers with full history, and drag-and-drop deal pipelines.',
  },
  {
    icon: Package,
    title: 'Product catalog',
    text: 'Products, categories, images, stock levels and product knowledge the AI can use.',
  },
  {
    icon: Boxes,
    title: 'Inventory',
    text: 'Reserve on order, deduct on shipment, restock on cancellation, with low-stock alerts.',
  },
  {
    icon: FileText,
    title: 'Invoices & payments',
    text: 'Record payments, issue printable invoices, export PDFs and track deliveries.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    text: 'Sales, CRM, conversation and AI reports calculated from your real data.',
  },
  {
    icon: Bell,
    title: 'Realtime notifications',
    text: 'New messages, handoffs, orders and low stock reach the right people instantly.',
  },
];

const GUARDRAILS = [
  {
    icon: Database,
    title: 'Facts come from your data',
    text: 'Prices, stock, delivery fees and totals only come from live tool calls, never from the model’s imagination.',
  },
  {
    icon: UserRoundCheck,
    title: 'Confirmation before orders',
    text: 'The agent places an order only after the customer approves an itemised summary, and only if you allow it.',
  },
  {
    icon: Users,
    title: 'Graceful human handoff',
    text: 'Complex or sensitive cases go to your team with an AI-written summary of the conversation.',
  },
  {
    icon: Languages,
    title: 'Your tone, your rules',
    text: 'Set personality, language, working hours, escalation rules and a knowledge base per agent.',
  },
];

const TOOL_TRACE = [
  {
    tool: 'searchProducts',
    args: '"noise cancelling headphones"',
    result: '1 match · Wireless Headphones · $109',
  },
  { tool: 'checkInventory', args: 'Wireless Headphones · Black', result: 'In stock' },
  { tool: 'checkDeliveryAvailability', args: 'New York', result: 'Delivery zone found' },
  { tool: 'calculateOrderTotal', args: '1 item', result: 'Subtotal, tax and shipping calculated' },
  {
    tool: 'createOrder',
    args: 'customerConfirmed: true',
    result: 'Order created · stock reserved',
  },
];

const STEPS = [
  {
    icon: MessageCircle,
    title: 'Connect WhatsApp',
    text: 'Link your number through the official Meta Cloud API. Your number and account stay yours.',
  },
  {
    icon: Package,
    title: 'Add products & knowledge',
    text: 'Import your catalog, delivery zones and policies so the AI answers with facts.',
  },
  {
    icon: Bot,
    title: 'Let AI sell, your team steps in',
    text: 'The agent handles routine sales around the clock and hands complex cases to a human.',
  },
];

const SECURITY = [
  {
    icon: Lock,
    title: 'Encrypted secrets',
    text: 'WhatsApp tokens, AI keys and 2FA secrets are encrypted with AES-256-GCM.',
  },
  {
    icon: Users,
    title: 'Granular roles',
    text: 'Owner, Admin, Manager, Sales, Support, Agent and Viewer, plus custom roles.',
  },
  {
    icon: KeyRound,
    title: 'Strong sign-in',
    text: 'Argon2id passwords, two-factor authentication and rotating sessions.',
  },
  {
    icon: BadgeCheck,
    title: 'Verified webhooks',
    text: 'Every WhatsApp and Stripe webhook is signature-checked before processing.',
  },
  {
    icon: Globe,
    title: 'Workspace isolation',
    text: 'Every query is scoped to one workspace, so businesses never see each other’s data.',
  },
  {
    icon: FileText,
    title: 'Audit logs',
    text: 'Who changed what and when, with secrets automatically scrubbed.',
  },
];

const FAQ = [
  {
    q: 'Does Sellora AI use the official WhatsApp API?',
    a: 'Yes. Sellora AI connects through the Meta WhatsApp Cloud API. You keep ownership of your number and your WhatsApp Business Account.',
  },
  {
    q: 'Can the AI make up prices or stock?',
    a: 'No. Prices, availability, delivery fees and totals only come from live tool calls against your catalog. Orders are only placed after the customer confirms an itemised summary.',
  },
  {
    q: 'What happens when the AI cannot help?',
    a: 'It transfers the conversation to your team, notifies the right people and writes a short summary so nobody has to scroll back.',
  },
  {
    q: 'Which AI provider do you use?',
    a: 'Any OpenAI-compatible API. Each workspace can bring its own key; usage and estimated cost are tracked per agent.',
  },
  {
    q: 'Can my team use it on their phones?',
    a: 'Yes. The whole app, including the inbox, is fully responsive and works in any modern mobile browser.',
  },
  {
    q: 'Can I self-host it?',
    a: 'Yes. Sellora AI runs on a standard VPS with Node.js, PostgreSQL, Redis and Nginx or Apache. No Docker is required.',
  },
];

function SectionHeading({
  eyebrow,
  title,
  text,
  align = 'center',
}: {
  eyebrow?: string;
  title: string;
  text?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto mb-12 max-w-2xl text-center' : 'mb-10 max-w-xl'}>
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
      )}
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-lg text-muted-foreground">{text}</p>}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)] opacity-70"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)] blur-2xl"
        aria-hidden
      />
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Link
            href="/#product"
            className="group mx-auto inline-flex max-w-full items-center gap-2 rounded-full border bg-card/80 py-1 pr-3 pl-1 text-xs font-medium shadow-xs backdrop-blur transition hover:border-primary/40 sm:text-sm"
          >
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">
              New
            </span>
            <span className="truncate">AI sales agent for WhatsApp commerce</span>
            <ArrowRight
              className="size-3.5 shrink-0 transition group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
          <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
            Turn WhatsApp conversations into{' '}
            <span className="bg-gradient-to-r from-primary via-[color-mix(in_oklch,var(--primary)_60%,var(--ai))] to-ai bg-clip-text text-transparent">
              revenue.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Sellora AI answers customers, recommends products from your real catalog, takes orders
            and keeps your CRM up to date, while your team handles the conversations that need a
            human.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="shadow-lg shadow-primary/25">
              <Link href="/register">
                Start selling smarter <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/#product">See the product</Link>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {['Free plan available', 'No credit card to start', 'Self-hostable'].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-14 max-w-6xl pb-10 sm:mt-16 md:pr-16 lg:pr-24">
          <BrowserFrame
            url="your-domain.com/dashboard"
            className="animate-in duration-700 fade-in slide-in-from-bottom-6 motion-reduce:animate-none"
          >
            <ThemedShot
              name="dashboard"
              alt="Sellora AI dashboard with revenue, orders, leads and conversation charts for a demo store"
              priority
            />
          </BrowserFrame>

          <div className="absolute right-0 bottom-0 hidden w-[23%] max-w-[240px] min-w-[170px] animate-in delay-200 duration-700 fade-in slide-in-from-right-6 motion-reduce:animate-none md:block">
            <PhoneFrame>
              <ThemedShot
                name="mobile-inbox"
                width={780}
                height={1688}
                sizes="240px"
                priority
                alt="Sellora AI inbox on a phone, showing the AI agent answering a customer"
              />
            </PhoneFrame>
          </div>

          <div
            className="absolute top-[18%] -left-3 hidden animate-in delay-300 duration-700 fade-in slide-in-from-left-4 motion-reduce:animate-none lg:block xl:-left-10"
            aria-hidden
          >
            <div className="flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-xl backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-lg bg-ai-soft text-ai">
                <Bot className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">AI agent replied</p>
                <p className="text-xs text-muted-foreground">Checked stock &amp; price</p>
              </div>
            </div>
          </div>
          <div
            className="absolute bottom-[14%] -left-3 hidden animate-in delay-500 duration-700 fade-in slide-in-from-left-4 motion-reduce:animate-none lg:block xl:-left-10"
            aria-hidden
          >
            <div className="flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-xl backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-lg bg-success/12 text-success">
                <ShoppingCart className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">New order · $429.84</p>
                <p className="text-xs text-muted-foreground">Stock reserved automatically</p>
              </div>
            </div>
          </div>
        </div>
        <p className="pb-4 text-center text-xs text-muted-foreground">
          Screens from the built-in demo workspace with sample data.
        </p>
      </div>
    </section>
  );
}

function Foundations() {
  return (
    <section aria-label="Built on" className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {TRUSTED_BY.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-10 opacity-80">
            {TRUSTED_BY.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.name} src={c.logoUrl} alt={c.name} className="h-7 w-auto grayscale" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm font-medium text-muted-foreground min-[480px]:grid-cols-2 md:flex md:flex-wrap md:justify-center">
            {FOUNDATIONS.map((f) => (
              <li key={f.label} className="flex items-center gap-2.5">
                <f.icon className="size-4.5 text-primary" aria-hidden /> {f.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ConversationToOrder() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <SectionHeading
        eyebrow="From chat to checkout"
        title="A complete sale, without leaving WhatsApp"
        text="Here is what happens when a customer writes to your number and the AI agent is on duty."
      />
      <ol className="relative grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div
          className="absolute top-8 right-[12%] left-[12%] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
          aria-hidden
        />
        {FLOW.map((f, i) => (
          <li
            key={f.step}
            className="relative flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-4 ring-background">
                <f.icon className="size-5" aria-hidden />
              </span>
              <span className="text-xs font-semibold text-muted-foreground">Step {i + 1}</span>
            </div>
            <h3 className="mt-4 font-semibold">{f.step}</h3>
            <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{f.text}</p>
            <div className="mt-4 rounded-xl border border-dashed bg-muted/40 p-3" aria-hidden>
              {f.detail}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FeatureBento() {
  return (
    <section id="features" className="scroll-mt-20 border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="Features"
          title="Everything you need to sell on WhatsApp"
          text="One platform for conversations, customers, catalog and orders, so nothing falls between tools."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8 lg:col-span-2">
            <Badge variant="ai" className="px-2 py-1">
              <Bot /> AI Sales Agent
            </Badge>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight">
              An agent that knows your store
            </h3>
            <p className="mt-2 max-w-lg text-muted-foreground">
              It answers questions, recommends products, checks stock and delivery, creates leads
              and tasks, and places confirmed orders through twelve audited tools.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                'searchProducts',
                'checkInventory',
                'calculateOrderTotal',
                'checkDeliveryAvailability',
                'createLead',
                'createOrder',
                'createTask',
                'transferToHuman',
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 sm:p-8 lg:row-span-2">
            <Badge className="px-2 py-1">
              <MessagesSquare /> Team inbox
            </Badge>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight">Reply from anywhere</h3>
            <p className="mt-2 text-muted-foreground">
              A realtime inbox with AI handoff, notes, assignments and templates, on desktop or
              phone.
            </p>
            <div className="relative mt-8 -mb-24 flex flex-1 items-start justify-center sm:-mb-28">
              <PhoneFrame className="w-[210px] sm:w-[230px]">
                <ThemedShot
                  name="mobile-inbox"
                  width={780}
                  height={1688}
                  sizes="230px"
                  alt="Sellora AI mobile inbox with a customer conversation"
                />
              </PhoneFrame>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card lg:col-span-2">
            <div className="p-6 pb-0 sm:p-8 sm:pb-0">
              <Badge variant="info" className="px-2 py-1">
                <Workflow /> Automation
              </Badge>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">
                Workflows on a visual canvas
              </h3>
              <p className="mt-2 max-w-lg text-muted-foreground">
                Tag VIP customers, follow up on abandoned conversations or alert your team about low
                stock, with retries and full run logs.
              </p>
            </div>
            <div className="mt-6 ml-6 overflow-hidden rounded-tl-xl border-t border-l sm:ml-8">
              <div className="relative aspect-[16/9] overflow-hidden">
                <div className="absolute top-[-48%] left-[-40%] w-[170%] max-w-none">
                  <ThemedShot
                    name="workflow"
                    alt="Sellora AI workflow builder canvas"
                    sizes="(min-width: 1024px) 1220px, 170vw"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border bg-card p-6 transition hover:border-primary/30 hover:shadow-md motion-reduce:transition-none"
            >
              <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:scale-105 motion-reduce:transition-none">
                <f.icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Guardrails() {
  return (
    <section className="relative isolate overflow-hidden bg-[oklch(0.2_0.03_200)] text-white">
      <div
        className="pointer-events-none absolute -top-32 -right-32 -z-10 size-[36rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.6_0.15_285/0.35),transparent)]"
        aria-hidden
      />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-semibold tracking-wide text-[oklch(0.8_0.12_180)] uppercase">
            Responsible AI
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Sells with facts, not guesses
          </h2>
          <p className="mt-4 text-lg text-white/70">
            The model never touches your database. Every action goes through a tool that is
            authorised, validated and logged, so you can see exactly why the AI said what it said.
          </p>
          <dl className="mt-10 grid gap-6 sm:grid-cols-2">
            {GUARDRAILS.map((g) => (
              <div key={g.title}>
                <dt className="flex items-center gap-2 font-medium">
                  <g.icon className="size-4.5 text-[oklch(0.8_0.12_180)]" aria-hidden /> {g.title}
                </dt>
                <dd className="mt-1.5 text-sm text-white/65">{g.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between rounded-t-xl border-b border-white/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Bot className="size-4 text-[oklch(0.78_0.14_285)]" aria-hidden /> Tool trace
            </p>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
              Example
            </span>
          </div>
          <ol className="divide-y divide-white/10 font-mono text-[12px]">
            {TOOL_TRACE.map((t, i) => (
              <li key={t.tool} className="grid gap-1 px-4 py-3 sm:grid-cols-[auto_1fr] sm:gap-4">
                <span className="text-white/40">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="text-[oklch(0.8_0.12_180)]">{t.tool}</span>
                    <span className="text-white/50">({t.args})</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-white/60">
                    <Check className="size-3 shrink-0 text-[oklch(0.75_0.15_150)]" aria-hidden />{' '}
                    {t.result}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <figcaption className="px-4 pt-2 pb-3 text-xs text-white/50">
            Every call is stored with its input and output in AI → Usage.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24"
    >
      <SectionHeading
        eyebrow="How it works"
        title="Live in an afternoon"
        text="Three steps from sign-up to your first AI-assisted sale."
      />
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-7"
          >
            <span
              className="absolute -top-4 -right-1 text-8xl font-bold text-primary/[0.07] select-none"
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25">
              <s.icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-5 font-semibold">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Security() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[2fr_3fr]">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Security & ownership"
            title="Your data, your server"
            text="Run Sellora AI on your own VPS with PostgreSQL and Redis, behind your own domain. No Docker needed, and nothing leaves your infrastructure except the APIs you connect."
          />
          <BrowserFrame url="your-domain.com/analytics" className="hidden lg:block">
            <ThemedShot name="analytics" alt="Sellora AI sales analytics" sizes="440px" />
          </BrowserFrame>
        </div>
        <div className="grid gap-4 self-start sm:grid-cols-2">
          {SECURITY.map((s) => (
            <div key={s.title} className="rounded-2xl border bg-card p-5">
              <s.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple, usage-based plans"
        text="Start free. Upgrade when your conversations grow. Prices in USD per month."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {PLAN_KEYS.map((k) => {
          const p = PLANS[k];
          return (
            <div
              key={k}
              className={`relative flex flex-col rounded-2xl border bg-card p-6 ${p.highlighted ? 'border-primary shadow-xl ring-1 shadow-primary/10 ring-primary/40 xl:-mt-3 xl:mb-3' : ''}`}
            >
              {p.highlighted && (
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                  Most popular
                </span>
              )}
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 min-h-10 text-xs text-muted-foreground">{p.description}</p>
              <p className="my-5 text-4xl font-semibold tracking-tight">
                {p.monthlyPrice === null ? 'Custom' : `$${p.monthlyPrice}`}
                {p.monthlyPrice !== null && (
                  <span className="text-sm font-normal text-muted-foreground"> /mo</span>
                )}
              </p>
              <ul className="mb-6 flex-1 space-y-2.5 text-sm">
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{' '}
                  {p.limits.aiMessages === -1
                    ? 'Unlimited'
                    : p.limits.aiMessages.toLocaleString('en-US')}{' '}
                  AI messages / mo
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{' '}
                  {p.limits.users === -1 ? 'Unlimited' : p.limits.users} team members
                </li>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <Button variant={p.highlighted ? 'default' : 'outline'} asChild>
                <Link href="/register">
                  {p.monthlyPrice === null ? 'Contact us' : 'Get started'}
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Testimonials() {
  if (TESTIMONIALS.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <div className="grid gap-4 md:grid-cols-3">
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className="rounded-2xl border bg-card p-6">
            <blockquote className="text-sm">“{t.quote}”</blockquote>
            <figcaption className="mt-4 text-sm font-medium">
              {t.name} <span className="font-normal text-muted-foreground">· {t.role}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[2fr_3fr]">
        <SectionHeading
          align="left"
          eyebrow="FAQ"
          title="Questions, answered"
          text="Can’t find what you need? Sign up for free and explore the demo workspace."
        />
        <div className="divide-y rounded-2xl border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-5 sm:p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition group-open:rotate-45 group-open:border-primary/40 group-open:text-primary"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <div className="relative isolate overflow-hidden rounded-3xl bg-[oklch(0.3_0.07_185)] px-6 pt-14 text-white sm:px-12 sm:pt-16 lg:grid lg:grid-cols-2 lg:gap-10 lg:pt-0">
        <div
          className="pointer-events-none absolute -bottom-40 -left-20 -z-10 size-[32rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.7_0.14_175/0.45),transparent)]"
          aria-hidden
        />
        <div className="text-center lg:py-20 lg:text-left">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Your next customer is already typing.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-white/75 lg:mx-0">
            Set up Sellora AI and let your AI sales agent answer, recommend and sell, while your
            team focuses on the conversations that matter.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Button
              size="lg"
              asChild
              className="bg-white text-[oklch(0.3_0.07_185)] hover:bg-white/90"
            >
              <Link href="/register">
                Start selling smarter <ArrowRight />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
        <div className="relative mt-12 h-64 sm:h-80 lg:mt-0 lg:h-auto">
          <div className="absolute top-0 left-0 w-[160%] overflow-hidden rounded-t-xl border border-white/15 shadow-2xl sm:w-[130%] lg:top-16 lg:w-[180%]">
            <ThemedShot
              name="inbox"
              alt="Sellora AI inbox"
              sizes="(min-width: 1024px) 900px, 130vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sellora AI',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: 'AI-powered WhatsApp sales and commerce automation platform.',
    offers: PLAN_KEYS.filter((k) => PLANS[k].monthlyPrice !== null).map((k) => ({
      '@type': 'Offer',
      name: PLANS[k].name,
      price: PLANS[k].monthlyPrice,
      priceCurrency: 'USD',
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <Foundations />
      <ConversationToOrder />
      <section id="product" className="scroll-mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHeading
            eyebrow="Product tour"
            title="See Sellora AI in action"
            text="Real screens from the demo workspace. Pick an area to explore."
          />
          <ProductTour />
        </div>
      </section>
      <FeatureBento />
      <Guardrails />
      <HowItWorks />
      <Security />
      <Pricing />
      <Testimonials />
      <Faq />
      <FinalCta />
    </>
  );
}
