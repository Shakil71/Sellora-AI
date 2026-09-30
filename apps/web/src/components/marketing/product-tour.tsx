'use client';

import * as React from 'react';
import {
  BarChart3,
  Check,
  Inbox,
  KanbanSquare,
  ShoppingCart,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrowserFrame, ThemedShot, type ShotName } from './frames';

interface TourTab {
  id: ShotName;
  label: string;
  icon: LucideIcon;
  title: string;
  text: string;
  points: string[];
  url: string;
  alt: string;
}

const TABS: TourTab[] = [
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    title: 'One inbox for your AI agent and your team',
    text: 'Every WhatsApp conversation in real time, with the customer’s profile, orders and leads beside the chat.',
    points: [
      'AI and human handoff in one click',
      'Internal notes, assignments and templates',
      'Delivery and read receipts',
    ],
    url: 'your-domain.com/inbox',
    alt: 'Sellora AI inbox showing an AI agent answering a customer about wireless headphones, with the customer’s orders on the right',
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: ShoppingCart,
    title: 'Orders that manage themselves',
    text: 'Orders from WhatsApp, the AI agent, your team and the API, with payments, invoices and deliveries attached.',
    points: [
      'Server-side totals, tax and shipping',
      'Stock reserved and released automatically',
      'Printable invoices and PDF export',
    ],
    url: 'your-domain.com/orders',
    alt: 'Sellora AI orders list with status filters, payment status and totals',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: KanbanSquare,
    title: 'A CRM that fills itself',
    text: 'Leads are captured from conversations and move through a drag-and-drop pipeline your team actually uses.',
    points: [
      'Custom pipelines and stages',
      'Owners, priorities and expected close dates',
      'Won and lost stages close deals automatically',
    ],
    url: 'your-domain.com/pipelines',
    alt: 'Sellora AI sales pipeline board with deals in New Lead, Contacted, Qualified and Proposal stages',
  },
  {
    id: 'workflow',
    label: 'Automation',
    icon: Workflow,
    title: 'Automations you can see',
    text: 'Build trigger → condition → action workflows on a visual canvas, then follow every run step by step.',
    points: [
      'Triggers for messages, orders, leads and stock',
      'Yes/no branches, delays and retries',
      'Full run history with errors and inputs',
    ],
    url: 'your-domain.com/automation',
    alt: 'Sellora AI workflow builder with an Order created trigger, an order amount condition and two actions',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    title: 'Numbers you can trust',
    text: 'Revenue, orders, conversion and AI performance, calculated from your own data, never estimated.',
    points: [
      '7-day to 12-month ranges',
      'Top products and revenue by channel',
      'AI resolution and escalation rates',
    ],
    url: 'your-domain.com/analytics',
    alt: 'Sellora AI sales analytics with revenue and order charts, top products and revenue by channel',
  },
];

export function ProductTour() {
  const [active, setActive] = React.useState(0);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const tab = TABS[active];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (active + delta + TABS.length) % TABS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product areas"
        onKeyDown={onKeyDown}
        className="mx-auto flex w-full max-w-full snap-x [scrollbar-width:none] gap-1 overflow-x-auto rounded-xl border bg-card p-1 sm:w-fit"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tour-tab-${t.id}`}
            aria-selected={i === active}
            aria-controls={`tour-panel-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              i === active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`tour-panel-${tab.id}`}
        aria-labelledby={`tour-tab-${tab.id}`}
        className="mt-10 grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,12fr)] lg:gap-12"
      >
        <div
          key={tab.id}
          className="animate-in duration-500 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
        >
          <h3 className="text-2xl font-semibold tracking-tight text-balance">{tab.title}</h3>
          <p className="mt-3 text-muted-foreground">{tab.text}</p>
          <ul className="mt-6 space-y-3 text-sm">
            {tab.points.map((p) => (
              <li key={p} className="flex gap-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                  <Check className="size-3.5" aria-hidden />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div
          key={`${tab.id}-shot`}
          className="animate-in duration-500 fade-in zoom-in-[0.98] motion-reduce:animate-none"
        >
          <BrowserFrame url={tab.url}>
            <ThemedShot name={tab.id} alt={tab.alt} sizes="(min-width: 1024px) 760px, 100vw" />
          </BrowserFrame>
        </div>
      </div>
    </div>
  );
}
