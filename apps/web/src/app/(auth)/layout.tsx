import Link from 'next/link';
import { Bot, MessageCircle, ShoppingBag } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

const points = [
  { icon: Bot, title: 'AI sales agent', text: 'Answers questions, recommends products and takes orders 24/7.' },
  { icon: MessageCircle, title: 'WhatsApp inbox', text: 'Every conversation in one realtime inbox with human handoff.' },
  { icon: ShoppingBag, title: 'Commerce built in', text: 'Catalog, inventory, orders and invoices connected to your CRM.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)] xl:grid-cols-[1fr_minmax(0,620px)]">
      <aside className="relative hidden overflow-hidden border-r bg-[oklch(0.22_0.04_190)] p-10 text-white lg:flex lg:flex-col">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden />
        <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-[oklch(0.6_0.12_180)] opacity-25 blur-3xl" aria-hidden />
        <Link href="/" className="relative">
          <span className="inline-flex items-center gap-2 text-white">
            <Logo className="[&_span]:text-white" />
          </span>
        </Link>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance">Turn WhatsApp conversations into revenue.</h2>
          <ul className="mt-8 space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <p.icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="text-sm text-white/70">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/50">© {new Date().getFullYear()} Sellora AI</p>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <div className="lg:hidden">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
