import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Boxes,
  Check,
  CheckCheck,
  Inbox,
  MessageCircle,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Target,
  Workflow,
  Zap,
} from 'lucide-react';
import { PLANS, PLAN_KEYS } from '@sellora/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Sellora AI — Turn WhatsApp Conversations Into Revenue',
  description:
    'Sellora AI combines AI sales automation, WhatsApp conversations, CRM, product management and order automation in one powerful platform.',
  alternates: { canonical: '/' },
};

/**
 * Social proof is configuration-driven. Leave these empty until you have
 * real, permissioned logos and quotes — the sections stay hidden.
 */
const TRUSTED_BY: Array<{ name: string; logoUrl: string }> = [];
const TESTIMONIALS: Array<{ quote: string; name: string; role: string }> = [];

const FEATURES = [
  { icon: Bot, title: 'AI Sales Agent', text: 'Answers questions, recommends products from your real catalog, checks stock and places orders after the customer confirms.' },
  { icon: Inbox, title: 'WhatsApp Inbox', text: 'A realtime team inbox with AI and human handoff, internal notes, assignments, templates and delivery receipts.' },
  { icon: Target, title: 'CRM', text: 'Leads, customers, deals and a drag-and-drop pipeline — captured automatically from conversations.' },
  { icon: Package, title: 'Product Catalog', text: 'Products, categories, images and AI product knowledge, searchable in milliseconds.' },
  { icon: ShoppingCart, title: 'Order Management', text: 'Orders, payments, invoices and deliveries with inventory that reserves and deducts stock correctly.' },
  { icon: Workflow, title: 'Automation', text: 'Visual workflows that react to messages, leads, orders and stock — with retries and full run logs.' },
  { icon: BarChart3, title: 'Analytics', text: 'Revenue, conversion, response times and AI performance, calculated from your real data.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'Workspace isolation, granular roles, audit logs, encrypted secrets and verified webhooks.' },
];

const STEPS = [
  { title: 'Connect WhatsApp', text: 'Link your number through the official Meta Cloud API in a few minutes.' },
  { title: 'Add products & knowledge', text: 'Import your catalog and policies so the AI answers with facts, not guesses.' },
  { title: 'Let AI sell — your team steps in', text: 'The AI handles routine sales 24/7 and hands complex cases to a human with a summary.' },
];

const FAQ = [
  { q: 'Does Sellora AI use the official WhatsApp API?', a: 'Yes. Sellora AI connects through the Meta WhatsApp Cloud API. You keep ownership of your number and your WhatsApp Business Account.' },
  { q: 'Can the AI make up prices or stock?', a: 'No. Prices, availability, delivery fees and totals only come from live tool calls against your catalog. Orders are only placed after the customer confirms an itemised summary.' },
  { q: 'What happens when the AI cannot help?', a: 'It transfers the conversation to your team, notifies the right people and writes a short summary so nobody has to scroll back.' },
  { q: 'Which AI provider do you use?', a: 'Any OpenAI-compatible API. Each workspace can bring its own key; usage and estimated cost are tracked per agent.' },
  { q: 'Can I self-host it?', a: 'Yes. Sellora AI runs on a standard VPS with Node.js, PostgreSQL, Redis and Nginx — no Docker required.' },
];

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_60%)]" />
      <div className="rounded-2xl border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2 border-b pb-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">CU</span>
          <div>
            <p className="text-sm font-medium">Customer</p>
            <p className="flex items-center gap-1 text-[11px] text-ai">
              <Bot className="size-3" /> Sales Assistant is replying
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <p className="w-fit max-w-[80%] rounded-2xl rounded-tl-sm border bg-background px-3 py-2">Do you have a smart watch that works with Android?</p>
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm border border-ai/20 bg-ai-soft px-3 py-2">
            Yes! Our Smart Watch works with Android and iOS, has 7-day battery and GPS. Would you like me to check delivery to your city?
          </p>
          <p className="w-fit max-w-[80%] rounded-2xl rounded-tl-sm border bg-background px-3 py-2">Yes please, I&apos;ll take one.</p>
          <div className="ml-auto w-fit max-w-[85%] rounded-xl border bg-background p-3 text-xs">
            <p className="mb-1 flex items-center gap-1 font-medium">
              <ShoppingCart className="size-3.5 text-primary" /> Order summary
            </p>
            <p className="text-muted-foreground">1 × Smart Watch · shipping · tax</p>
            <p className="mt-1 flex items-center gap-1 text-success">
              <CheckCheck className="size-3.5" /> Waiting for your confirmation
            </p>
          </div>
        </div>
      </div>
      <div className="absolute -right-4 -bottom-6 hidden rounded-xl border bg-card px-4 py-3 shadow-lg sm:block">
        <p className="flex items-center gap-2 text-xs font-medium">
          <Zap className="size-3.5 text-primary" /> Lead created · Task assigned
        </p>
      </div>
    </div>
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
    offers: PLAN_KEYS.filter((k) => PLANS[k].monthlyPrice !== null).map((k) => ({ '@type': 'Offer', name: PLANS[k].name, price: PLANS[k].monthlyPrice, priceCurrency: 'USD' })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] opacity-60" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div className="space-y-6">
            <Badge variant="default" className="px-2.5 py-1">
              <Sparkles /> AI-Powered WhatsApp Sales & Commerce Automation
            </Badge>
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">Turn WhatsApp Conversations Into Revenue.</h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Sellora AI combines AI sales automation, WhatsApp conversations, CRM, product management and order automation in one powerful platform.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/register">
                  Start Selling Smarter <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">View Demo</Link>
              </Button>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {['Official WhatsApp Cloud API', 'No credit card to start', 'Self-hostable'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="size-4 text-primary" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </div>
      </section>

      {TRUSTED_BY.length > 0 && (
        <section aria-label="Trusted by" className="border-y bg-muted/30">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-10 px-4 py-8 opacity-80">
            {TRUSTED_BY.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.name} src={c.logoUrl} alt={c.name} className="h-7 w-auto grayscale" />
            ))}
          </div>
        </section>
      )}

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Everything you need to sell on WhatsApp</h2>
          <p className="mt-3 text-muted-foreground">One platform for conversations, customers, catalog and orders — with an AI agent that actually closes sales.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-5">
              <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Badge variant="ai">
              <Bot /> AI Sales Agent
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">An agent that sells with facts, not guesses</h2>
            <p className="text-muted-foreground">Every action goes through controlled tools — search products, check inventory, calculate totals, create leads and orders — each authorized, validated and logged.</p>
            <ul className="space-y-2 text-sm">
              {['Uses your catalog, stock and delivery zones in real time', 'Retrieves answers from your knowledge base', 'Asks for confirmation before placing an order', 'Hands off to your team with an AI summary'].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: MessageCircle, t: 'WhatsApp Inbox', d: 'AI and human conversations side by side, updated in real time.' },
              { icon: Boxes, t: 'Inventory', d: 'Reserve on order, deduct on shipment, alerts on low stock.' },
              { icon: Workflow, t: 'Automation', d: 'Trigger → condition → action, visually.' },
              { icon: BarChart3, t: 'Analytics', d: 'AI resolution rate, escalations and cost per agent.' },
            ].map((c) => (
              <div key={c.t} className="rounded-xl border bg-card p-5">
                <c.icon className="mb-3 size-5 text-primary" />
                <p className="font-medium">{c.t}</p>
                <p className="mt-1 text-sm text-muted-foreground">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="mb-10 text-center text-3xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border bg-card p-6">
              <span className="mb-4 flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {TESTIMONIALS.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <figure key={t.name} className="rounded-xl border bg-card p-6">
                <blockquote className="text-sm">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-sm font-medium">
                  {t.name} <span className="font-normal text-muted-foreground">· {t.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section id="pricing" className="scroll-mt-20 border-y bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Simple, usage-based plans</h2>
            <p className="mt-3 text-muted-foreground">Start free. Upgrade when your conversations grow.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PLAN_KEYS.map((k) => {
              const p = PLANS[k];
              return (
                <div key={k} className={`flex flex-col rounded-xl border bg-card p-5 ${p.highlighted ? 'border-primary ring-1 ring-primary/30' : ''}`}>
                  <p className="flex items-center justify-between font-semibold">
                    {p.name} {p.highlighted && <Badge>Popular</Badge>}
                  </p>
                  <p className="mt-1 min-h-10 text-xs text-muted-foreground">{p.description}</p>
                  <p className="my-4 text-3xl font-semibold">
                    {p.monthlyPrice === null ? 'Custom' : `$${p.monthlyPrice}`}
                    {p.monthlyPrice !== null && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                  </p>
                  <ul className="mb-6 flex-1 space-y-2 text-sm">
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /> {p.limits.aiMessages === -1 ? 'Unlimited' : p.limits.aiMessages.toLocaleString()} AI messages / mo</li>
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /> {p.limits.users === -1 ? 'Unlimited' : p.limits.users} team members</li>
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button variant={p.highlighted ? 'default' : 'outline'} asChild>
                    <Link href="/register">{p.monthlyPrice === null ? 'Contact us' : 'Get started'}</Link>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="mb-8 text-center text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
        <div className="divide-y rounded-xl border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-muted-foreground transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="rounded-2xl bg-[oklch(0.25_0.05_190)] px-6 py-14 text-center text-white sm:px-12">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">Your next customer is already typing.</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/70">Set up Sellora AI in minutes and let your AI Sales Agent answer, recommend and sell — while your team focuses on what matters.</p>
          <Button size="lg" asChild className="mt-8 bg-white text-[oklch(0.25_0.05_190)] hover:bg-white/90">
            <Link href="/register">
              Start Selling Smarter <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
