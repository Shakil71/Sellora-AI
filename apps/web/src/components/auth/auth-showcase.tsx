'use client';

import * as React from 'react';
import {
  BadgeCheck,
  Bot,
  CheckCheck,
  Instagram,
  MessageCircle,
  MessageSquareMore,
  Mic,
  Paperclip,
  Plus,
  ShoppingBag,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Card = 'product' | 'order' | 'pay';
interface Line {
  from: 'customer' | 'ai';
  text: string;
  card?: Card;
  time: string;
}

/** Words shown inside the cards, in the shopper's language. */
interface Labels {
  inStock: string;
  order: string;
  confirmed: string;
  delivery: string;
  free: string;
  total: string;
  secure: string;
  payNow: string;
  online: string;
}

/** One shopper somewhere in the world. The phone replays each in turn. */
interface Scenario {
  flag: string;
  customer: string;
  country: string;
  city: string;
  item: string;
  qty: number;
  price: string;
  total: string;
  method: string;
  labels: Labels;
  chat: [string, string, string, string, string];
}

const SCENARIOS: Scenario[] = [
  {
    flag: '🇺🇸',
    customer: 'Sara',
    country: 'United States',
    city: 'Austin',
    item: 'Urban Runner · Black',
    qty: 2,
    price: '$59.00',
    total: '$118.00',
    method: 'Card · Apple Pay',
    labels: { inStock: 'Size 8 · 6 in stock', order: 'Order', confirmed: 'Confirmed', delivery: 'Delivery', free: 'Free', total: 'Total', secure: 'Secure link', payNow: 'Pay now', online: 'online · replying with AI' },
    chat: [
      'Hi! Do you have the black running shoes in size 8? 👟',
      'Hello Sara! Yes, the Urban Runner in black is in stock. Want me to reserve a pair?',
      'Yes please, 2 pairs. Ship to Austin.',
      'Done! Your order is confirmed. Here is the summary:',
      'You can pay securely right here 👇',
    ],
  },
  {
    flag: '🇧🇷',
    customer: 'Lucas',
    country: 'Brasil',
    city: 'São Paulo',
    item: 'Urban Runner · Preto',
    qty: 2,
    price: 'R$ 295,00',
    total: 'R$ 590,00',
    method: 'PIX · Cartão',
    labels: { inStock: 'Tam. 42 · 6 em estoque', order: 'Pedido', confirmed: 'Confirmado', delivery: 'Entrega', free: 'Grátis', total: 'Total', secure: 'Link seguro', payNow: 'Pagar agora', online: 'online · respondendo com IA' },
    chat: [
      'Oi! Vocês têm o tênis preto tamanho 42? 👟',
      'Olá Lucas! Sim, o Urban Runner preto está em estoque. Quer que eu reserve um par?',
      'Sim, 2 pares. Entrega em São Paulo.',
      'Pronto! Seu pedido está confirmado. Veja o resumo:',
      'Você pode pagar com segurança aqui 👇',
    ],
  },
  {
    flag: '🇮🇳',
    customer: 'Priya',
    country: 'India',
    city: 'Mumbai',
    item: 'Urban Runner · Black',
    qty: 2,
    price: '₹4,900',
    total: '₹9,800',
    method: 'UPI · Cards',
    labels: { inStock: 'Size 7 · 6 in stock', order: 'Order', confirmed: 'Confirmed', delivery: 'Delivery', free: 'Free', total: 'Total', secure: 'Secure link', payNow: 'Pay with UPI', online: 'online · replying with AI' },
    chat: [
      'Hi! Is the black running shoe available in size 7? 👟',
      'Hello Priya! Yes, it is in stock. Shall I reserve a pair for you?',
      'Yes, 2 pairs please. Deliver to Mumbai.',
      'All set! Your order is confirmed. Here is the summary:',
      'Pay instantly with UPI here 👇',
    ],
  },
  {
    flag: '🇪🇸',
    customer: 'Elena',
    country: 'España',
    city: 'Madrid',
    item: 'Urban Runner · Negro',
    qty: 2,
    price: '€55,00',
    total: '€110,00',
    method: 'Tarjeta · Bizum',
    labels: { inStock: 'Talla 42 · 6 en stock', order: 'Pedido', confirmed: 'Confirmado', delivery: 'Envío', free: 'Gratis', total: 'Total', secure: 'Enlace seguro', payNow: 'Pagar ahora', online: 'en línea · responde la IA' },
    chat: [
      '¡Hola! ¿Tenéis las zapatillas negras en talla 42? 👟',
      '¡Hola Elena! Sí, las Urban Runner negras están disponibles. ¿Te reservo un par?',
      'Sí, 2 pares. Enviar a Madrid, por favor.',
      '¡Listo! Tu pedido está confirmado. Este es el resumen:',
      'Puedes pagar de forma segura aquí 👇',
    ],
  },
  {
    flag: '🇰🇪',
    customer: 'Amani',
    country: 'Kenya',
    city: 'Nairobi',
    item: 'Urban Runner · Black',
    qty: 2,
    price: 'KSh 7,500',
    total: 'KSh 15,000',
    method: 'M-Pesa · Cards',
    labels: { inStock: 'Size 42 · 6 in stock', order: 'Order', confirmed: 'Confirmed', delivery: 'Delivery', free: 'Free', total: 'Total', secure: 'Secure link', payNow: 'Pay with M-Pesa', online: 'online · replying with AI' },
    chat: [
      'Hello! Do you have black running shoes in size 42? 👟',
      'Hi Amani! Yes, the Urban Runner in black is available. Should I reserve a pair?',
      'Yes please, 2 pairs. Deliver to Nairobi.',
      'Done! Your order is confirmed. Here is the summary:',
      'You can pay with M-Pesa right here 👇',
    ],
  },
];

const CARDS: Array<Card | undefined> = [undefined, 'product', undefined, 'order', 'pay'];

/** Flag emoji to its 2-letter code (Windows cannot draw flag emoji). */
function countryCode(flag: string): string {
  return [...flag].map((c) => String.fromCharCode(c.codePointAt(0)! - 127397)).join('');
}

function script(sc: Scenario): Line[] {
  const times = ['10:24', '10:24', '10:25', '10:25', '10:25'];
  return sc.chat.map((text, i) => ({
    from: i % 2 === 0 && i < 3 ? 'customer' : 'ai',
    text,
    card: CARDS[i],
    time: times[i]!,
  })) as Line[];
}

/** Doodle texture behind the chat, like the WhatsApp wallpaper. */
const DOODLE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='.05' stroke-width='1.4'%3E%3Ccircle cx='14' cy='16' r='5'/%3E%3Cpath d='M44 12l8 8m0-8l-8 8'/%3E%3Cpath d='M12 52c4-6 8-6 12 0'/%3E%3Crect x='50' y='48' width='12' height='9' rx='2'/%3E%3Cpath d='M66 14l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z'/%3E%3C/g%3E%3C/svg%3E\")";

function ProductCard({ sc }: { sc: Scenario }) {
  return (
    <div className="mt-2 flex gap-3 rounded-xl bg-black/20 p-2">
      <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-200 to-slate-400">
        <svg viewBox="0 0 64 40" className="w-10" aria-hidden>
          <path d="M4 28c0-6 4-9 9-9l10 2 8-9 6 4-5 7 17 3c5 1 7 3 7 6v2H4z" fill="#0f172a" />
          <path d="M4 33h56" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
      <div className="min-w-0 text-[11px] leading-tight">
        <p className="font-semibold">{sc.item}</p>
        <p className="mt-0.5 text-white/60">{sc.labels.inStock}</p>
        <p className="mt-1 font-semibold text-emerald-300">{sc.price}</p>
      </div>
    </div>
  );
}

function OrderCard({ sc }: { sc: Scenario }) {
  return (
    <div className="mt-2 space-y-1 rounded-xl bg-black/20 p-2.5 text-[11px]">
      <div className="flex items-center justify-between font-semibold">
        <span>{sc.labels.order} ORD-1042</span>
        <span className="flex items-center gap-1 text-emerald-300">
          <BadgeCheck className="size-3" aria-hidden /> {sc.labels.confirmed}
        </span>
      </div>
      <div className="flex justify-between text-white/65">
        <span>{sc.qty} × Urban Runner</span>
        <span>{sc.total}</span>
      </div>
      <div className="flex justify-between text-white/65">
        <span>{sc.labels.delivery} · {sc.city}</span>
        <span>{sc.labels.free}</span>
      </div>
    </div>
  );
}

function PayCard({ sc }: { sc: Scenario }) {
  return (
    <div className="mt-2 rounded-xl bg-black/20 p-2.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{sc.labels.total} {sc.total}</span>
        <span className="text-white/60">{sc.labels.secure}</span>
      </div>
      <div className="mt-2 rounded-lg bg-white py-1.5 text-center text-xs font-semibold text-[#075e54]">{sc.labels.payNow}</div>
      <p className="mt-1.5 text-center text-[10px] text-white/50">{sc.method}</p>
    </div>
  );
}

function Bubble({ line, sc }: { line: Line; sc: Scenario }) {
  const ai = line.from === 'ai';
  return (
    <div className={cn('flex animate-[auth-pop_0.35s_ease-out_both]', ai ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[84%] rounded-2xl px-3 py-2 text-[12px] leading-snug text-white shadow-sm',
          ai ? 'rounded-tr-sm bg-[#005c4b]' : 'rounded-tl-sm bg-[#202c33]',
        )}
      >
        {ai && (
          <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-violet-300">
            <Sparkles className="size-3" aria-hidden /> Sellora AI
          </span>
        )}
        <p>{line.text}</p>
        {line.card === 'product' && <ProductCard sc={sc} />}
        {line.card === 'order' && <OrderCard sc={sc} />}
        {line.card === 'pay' && <PayCard sc={sc} />}
        <span className="mt-1 flex items-center justify-end gap-1 text-[9px] text-white/50">
          {line.time}
          {ai && <CheckCheck className="size-3 text-sky-400" aria-hidden />}
        </span>
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex justify-end">
      <div className="flex items-center gap-1 rounded-2xl rounded-tr-sm bg-[#005c4b] px-3.5 py-3" aria-label="Sellora AI is typing">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-white" style={{ animation: `auth-dot 1.1s ${i * 0.15}s infinite` }} />
        ))}
      </div>
    </div>
  );
}

function Phone({ onScenario }: { onScenario: (sc: Scenario) => void }) {
  const [index, setIndex] = React.useState(0);
  const sc = SCENARIOS[index]!;
  const lines = React.useMemo(() => script(sc), [sc]);
  const [shown, setShown] = React.useState(0);
  const [typing, setTyping] = React.useState(false);

  React.useEffect(() => {
    onScenario(sc);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(lines.length);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, ms));
      });
    (async () => {
      {
        setShown(0);
        await wait(900);
        for (let i = 0; i < lines.length && !cancelled; i++) {
          if (lines[i]!.from === 'ai') {
            setTyping(true);
            await wait(1200);
            setTyping(false);
          } else {
            await wait(700);
          }
          if (cancelled) return;
          setShown(i + 1);
          await wait(1100);
        }
        await wait(4200);
        if (!cancelled) setIndex((i) => (i + 1) % SCENARIOS.length);
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [sc, lines, onScenario]);

  return (
    <div className="relative mx-auto w-[300px] rounded-[2.4rem] border border-white/15 bg-[#0b141a] p-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
      <div className="absolute top-3 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" aria-hidden />
      <div className="flex h-[520px] flex-col overflow-hidden rounded-[2rem] bg-[#0b141a]">
        <div className="flex items-center gap-2.5 bg-[#202c33] px-3 pt-8 pb-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 text-xs font-bold text-white">{sc.customer[0]}</span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-[13px] font-semibold text-white">
              {sc.customer} <span className="rounded bg-white/15 px-1 text-[9px] font-medium tracking-wide text-white/80">{countryCode(sc.flag)}</span> <BadgeCheck className="size-3.5 text-sky-400" aria-hidden />
            </p>
            <p className="text-[10px] text-emerald-400">{sc.labels.online}</p>
          </div>
          <MessageCircle className="size-4 text-white/60" aria-hidden />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-2.5 py-3" style={{ backgroundImage: DOODLE }}>
          {lines.slice(0, shown).map((l, i) => (
            <Bubble key={`${index}-${i}`} line={l} sc={sc} />
          ))}
          {typing && <Typing />}
        </div>
        <div className="flex items-center gap-2 bg-[#202c33] px-2.5 py-2">
          <Plus className="size-4 text-white/50" aria-hidden />
          <div className="flex-1 rounded-full bg-[#2a3942] px-3 py-1.5 text-[11px] text-white/40">Message</div>
          <Paperclip className="size-4 text-white/50" aria-hidden />
          <span className="flex size-7 items-center justify-center rounded-full bg-[#00a884]">
            <Mic className="size-3.5 text-white" aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

function Float({ className, delay = 0, children }: { className?: string; delay?: number; children: React.ReactNode }) {
  return (
    <div
      className={cn('absolute z-20 rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2.5 shadow-xl backdrop-blur-md', className)}
      style={{ animation: `auth-float 6s ${delay}s ease-in-out infinite` }}
    >
      {children}
    </div>
  );
}

const STATS = [
  { value: '24/7', label: 'Always replying' },
  { value: '< 3s', label: 'Average reply' },
  { value: '50+', label: 'Languages' },
];

/** Animated marketing panel for the sign-in and sign-up pages: WhatsApp-style chat run by the AI agent. */
export function AuthShowcase() {
  const [sc, setSc] = React.useState<Scenario>(SCENARIOS[0]!);
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[oklch(0.2_0.045_190)] p-10 text-white xl:p-12">
      {/* Aurora background */}
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden />
      <div className="pointer-events-none absolute -top-32 -left-24 size-[520px] rounded-full bg-[#14b8a6] opacity-30 blur-[110px]" style={{ animation: 'auth-aurora 14s ease-in-out infinite' }} aria-hidden />
      <div className="pointer-events-none absolute right-[-120px] bottom-[-80px] size-[460px] rounded-full bg-[#8b5cf6] opacity-30 blur-[110px]" style={{ animation: 'auth-aurora 18s ease-in-out infinite reverse' }} aria-hidden />
      <div className="pointer-events-none absolute top-1/3 right-1/4 size-64 rounded-full bg-[#25d366] opacity-20 blur-[100px]" aria-hidden />

      <div className="relative z-10 mx-auto max-w-lg text-center" style={{ animation: 'auth-rise 0.7s ease-out both' }}>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          WhatsApp + AI sales agent
        </span>
        <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
          Turn every chat into{' '}
          <span
            className="bg-gradient-to-r from-emerald-300 via-teal-200 to-violet-300 bg-[length:200%_auto] bg-clip-text text-transparent"
            style={{ animation: 'auth-shimmer 6s linear infinite' }}
          >
            a sale
          </span>
          , on autopilot.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-white/70">
          Your AI agent answers in your customers&apos; language, takes orders and sends payment links on WhatsApp, your website, Messenger and Instagram, wherever in the world they are.
        </p>
      </div>

      <div className="relative z-10 my-auto py-8" style={{ animation: 'auth-rise 0.9s 0.15s ease-out both' }}>
        <Phone onScenario={setSc} />
        <Float className="top-6 left-0 hidden xl:block" delay={0.4}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/30">
              <Bot className="size-4 text-violet-200" aria-hidden />
            </span>
            <div className="text-xs">
              <p className="font-semibold">AI replied in 2.1s</p>
              <p className="text-white/60">No human needed</p>
            </div>
          </div>
        </Float>
        <Float className="top-1/3 right-0 hidden xl:block" delay={1.2}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/30">
              <ShoppingBag className="size-4 text-emerald-200" aria-hidden />
            </span>
            <div className="text-xs">
              <p className="font-semibold">New order · {sc.total}</p>
              <p className="text-white/60">{sc.city}, {sc.country}</p>
            </div>
          </div>
        </Float>
        <Float className="bottom-10 left-2 hidden xl:block" delay={2}>
          <div className="flex items-center gap-2 text-xs">
            <Zap className="size-4 text-amber-300" aria-hidden />
            <span className="font-semibold">{sc.method.split(' · ')[0]} link sent</span>
          </div>
        </Float>
        <div className="mt-6 flex items-center justify-center gap-2 text-white/80">
          {[
            { icon: MessageCircle, label: 'WhatsApp', c: 'text-[#25d366]' },
            { icon: MessageSquareMore, label: 'Messenger', c: 'text-[#4da3ff]' },
            { icon: Instagram, label: 'Instagram', c: 'text-[#ff6fa5]' },
          ].map((ch) => (
            <span key={ch.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] backdrop-blur">
              <ch.icon className={cn('size-3.5', ch.c)} aria-hidden /> {ch.label}
            </span>
          ))}
        </div>
      </div>

      <dl className="relative z-10 mx-auto grid w-full max-w-lg grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center backdrop-blur">
            <dt className="sr-only">{s.label}</dt>
            <dd className="text-lg font-semibold">{s.value}</dd>
            <p className="text-[11px] text-white/60" aria-hidden>
              {s.label}
            </p>
          </div>
        ))}
      </dl>
    </div>
  );
}
