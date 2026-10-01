'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Mail,
  PartyPopper,
  Rocket,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  TriangleAlert,
  UserCog,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { passwordProblem } from '@sellora/shared';
import { api } from '@/lib/api';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Input, Progress } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/shared/form';
import { cn } from '@/lib/utils';

interface Status {
  installed: boolean;
  tokenRequired: boolean;
  tokenHint: string | null;
  requirements: Array<{ key: string; label: string; ok: boolean; hint: string }>;
  migrated: boolean;
  hasAdmin: boolean;
  /** Database and Redis already work: connection settings are managed on the server. */
  serverConfigured: boolean;
  config: {
    appUrl: string;
    apiUrl: string;
    smtpConfigured: boolean;
    aiConfigured: boolean;
    cookieSecure: boolean;
    trustProxy: boolean;
    envFile: string;
  };
}

interface StepDef {
  title: string;
  short: string;
  icon: LucideIcon;
}

const STEPS: StepDef[] = [
  { title: 'Check your server', short: 'Is everything ready?', icon: ClipboardCheck },
  { title: 'Database', short: 'Where your data lives', icon: Database },
  { title: 'Email & AI', short: 'Optional but recommended', icon: Settings2 },
  { title: 'Create tables', short: 'Prepare the database', icon: Table2 },
  { title: 'Your account', short: 'The platform owner', icon: UserCog },
  { title: 'Review', short: 'One last look', icon: ShieldCheck },
  { title: 'Finish', short: 'Launch your platform', icon: Rocket },
];

const SMTP_PRESETS: Record<string, { label: string; host: string; port: string; note: string }> = {
  gmail: {
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: '587',
    note: 'Use your full email as the user and an App Password (Google Account → Security → App passwords), not your normal password.',
  },
  brevo: {
    label: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: '587',
    note: 'Find the login and SMTP key under Brevo → SMTP & API.',
  },
  sendgrid: {
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: '587',
    note: 'The user is the word apikey and the password is your SendGrid API key.',
  },
  zoho: {
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: '587',
    note: 'Use your Zoho email and an application-specific password.',
  },
  hosting: {
    label: 'My web hosting (cPanel)',
    host: '',
    port: '587',
    note: 'In cPanel open Email Accounts → Connect Devices and copy the outgoing server and port.',
  },
  custom: { label: 'Other', host: '', port: '587', note: 'Ask your email provider for the SMTP host, port and login.' },
};

async function call<T>(path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/install/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-installer-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false)
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

function passwordChecks(pw: string) {
  return [
    { ok: pw.length >= 10, label: 'At least 10 characters' },
    { ok: !pw || passwordProblem(pw) === null || !passwordProblem(pw)!.includes('common'), label: 'Not a common password' },
    { ok: /[A-Za-z]/.test(pw), label: 'A letter' },
    { ok: /\d/.test(pw), label: 'A number' },
  ];
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Check({ ok, label, hint, warn }: { ok: boolean; label: string; hint?: string; warn?: boolean }) {
  const Icon = ok ? CheckCircle2 : warn ? TriangleAlert : XCircle;
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        !ok && !warn && 'border-destructive/30 bg-destructive/5',
        !ok && warn && 'border-warning/40 bg-warning/10',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', ok ? 'text-success' : warn ? 'text-warning' : 'text-destructive')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {!ok && hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </li>
  );
}

function Tip({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-3 text-sm',
        tone === 'info' ? 'border-primary/20 bg-primary/5' : 'border-warning/40 bg-warning/10',
      )}
    >
      {tone === 'info' ? (
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      )}
      <div className="min-w-0 space-y-1 text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </div>
  );
}

function StepHeader({ step, title, intro }: { step: number; title: string; intro: React.ReactNode }) {
  const Icon = STEPS[step]!.icon;
  return (
    <header className="space-y-2">
      <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{intro}</p>
    </header>
  );
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={cn('pr-10', props.className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide' : 'Show'}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function Shell({ children, step }: { children: React.ReactNode; step?: number }) {
  const total = STEPS.length;
  const current = step ?? total; // no step = finished or standalone message: everything shows as done
  const percent = Math.round((Math.min(current, total) / total) * 100);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.3fr)]">
      <aside className="relative hidden flex-col overflow-hidden bg-[oklch(0.2_0.045_190)] p-10 text-white lg:flex xl:p-12">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden />
        <div className="pointer-events-none absolute -top-32 -left-24 size-[480px] rounded-full bg-[#14b8a6] opacity-30 blur-[110px]" style={{ animation: 'auth-aurora 14s ease-in-out infinite' }} aria-hidden />
        <div className="pointer-events-none absolute right-[-120px] bottom-[-80px] size-[420px] rounded-full bg-[#8b5cf6] opacity-30 blur-[110px]" style={{ animation: 'auth-aurora 18s ease-in-out infinite reverse' }} aria-hidden />
        <div className="pointer-events-none absolute top-1/2 left-1/3 size-56 rounded-full bg-[#25d366] opacity-15 blur-[100px]" aria-hidden />

        <div className="relative z-10 [&_*]:!text-white">
          <Logo />
        </div>

        <div className="relative z-10 mt-10" style={{ animation: 'auth-rise 0.7s ease-out both' }}>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5 text-violet-300" aria-hidden /> Guided setup · about 5 minutes
          </span>
          <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance">
            Launch your{' '}
            <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-violet-300 bg-[length:200%_auto] bg-clip-text text-transparent" style={{ animation: 'auth-shimmer 6s linear infinite' }}>
              AI sales platform
            </span>
          </h2>
          <p className="mt-2 text-sm text-white/70">
            WhatsApp, website chat, Messenger and Instagram, answered by your AI agent, with orders and payments built in.
          </p>
        </div>

        <ol className="relative z-10 mt-8 space-y-1.5" style={{ animation: 'auth-rise 0.9s 0.1s ease-out both' }}>
          {STEPS.map((t, i) => {
            const active = i === step;
            const done = i < current;
            return (
              <li
                key={t.title}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5 backdrop-blur transition',
                  active ? 'border-white/25 bg-white/15 shadow-lg' : done ? 'border-white/10 bg-white/5' : 'border-transparent opacity-70',
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    done ? 'bg-emerald-400 text-emerald-950' : active ? 'bg-white text-[#0f3f3c]' : 'border border-white/35',
                  )}
                >
                  {done ? <CheckCircle2 className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-white/60">{t.short}</span>
                </span>
                <t.icon className={cn('size-4 shrink-0', active ? 'text-white' : 'text-white/40')} aria-hidden />
              </li>
            );
          })}
        </ol>

        <div className="relative z-10 mt-auto pt-8">
          <div className="flex items-center justify-between text-xs text-white/70">
            <span>Setup progress</span>
            <span className="tabular">{percent}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-teal-200 transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-4 text-xs text-white/55">Stuck? Each step explains what it does and how to fix common problems. Full guide: docs/INSTALLATION.md.</p>
        </div>
      </aside>

      <main className="relative overflow-hidden bg-background px-4 py-6 sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[420px] rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-32 size-[380px] rounded-full bg-ai/10 blur-3xl" aria-hidden />
        <div className="relative mb-5 flex items-center justify-between lg:hidden">
          <Logo />
          {step !== undefined && (
            <span className="text-xs text-muted-foreground">
              Step {step + 1} of {total}
            </span>
          )}
        </div>
        {step !== undefined && <Progress value={((step + 1) / total) * 100} className="relative mb-6 h-1.5 lg:hidden" aria-label="Installation progress" />}
        <div className="relative mx-auto flex min-h-full max-w-2xl flex-col justify-center lg:min-h-[calc(100dvh-5rem)]" style={{ animation: 'auth-rise 0.6s ease-out both' }}>
          {children}
        </div>
      </main>
    </div>
  );
}

function Nav({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t pt-5">{children}</div>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Web installation wizard. The API refuses every step once installation has
 * finished, so this page becomes read-only afterwards.
 */
export default function InstallPage() {
  const [step, setStep] = React.useState(0);
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ signedIn: boolean } | null>(null);
  const [origin, setOrigin] = React.useState('');
  const [db, setDb] = React.useState('postgresql://sellora:password@localhost:5432/sellora?schema=public');
  const [redis, setRedis] = React.useState('redis://localhost:6379');
  const [dbResult, setDbResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [redisResult, setRedisResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [smtpPreset, setSmtpPreset] = React.useState('');
  const [smtpResult, setSmtpResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [aiResult, setAiResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [envCfg, setEnvCfg] = React.useState({
    appUrl: '',
    apiUrl: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    mailFrom: '',
    openaiApiKey: '',
  });
  const [migrateOutput, setMigrateOutput] = React.useState('');
  const [migrateOk, setMigrateOk] = React.useState<boolean | null>(null);
  const [admin, setAdmin] = React.useState({
    name: '',
    email: '',
    password: '',
    confirm: '',
    workspaceName: '',
  });
  const [adminCreated, setAdminCreated] = React.useState(false);
  const status = useQuery({
    queryKey: ['install-status'],
    queryFn: () => call<Status>('status', ''),
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (done) return <SuccessScreen signedIn={done.signedIn} />;

  if (status.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 p-6">
            <h1 className="text-xl font-semibold">We can&apos;t reach the Sellora AI server</h1>
            <p className="text-sm text-muted-foreground">
              The website is running, but the API (the part that does the work) is not answering.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Start it with <code className="rounded bg-muted px-1">pm2 start ecosystem.config.cjs</code> or{' '}
                <code className="rounded bg-muted px-1">npm run start:api</code>.
              </li>
              <li>
                Check its log with <code className="rounded bg-muted px-1">pm2 logs sellora-api</code>.
              </li>
              <li>Then reload this page.</li>
            </ul>
            <Button variant="outline" onClick={() => status.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  const s = status.data!;
  if (s.installed) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <h1 className="text-2xl font-semibold">Sellora AI is installed</h1>
            <p className="text-sm text-muted-foreground">
              The installer is now locked for your security. Sign in with the administrator account you
              created to open your platform admin dashboard.
            </p>
            <Button asChild size="lg" className="w-full">
              <Link href="/login?next=/admin">
                Sign in to the admin dashboard <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const appUrl = envCfg.appUrl || origin;
  const pwChecks = passwordChecks(admin.password);
  const pwOk = pwChecks.every((c) => c.ok);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email.trim());
  const adminValid =
    admin.name.trim().length >= 2 &&
    emailOk &&
    pwOk &&
    admin.password === admin.confirm &&
    admin.workspaceName.trim().length >= 2;
  const requirementsOk = s.requirements.every((r) => r.ok || r.key === 'envFile');
  const failing = s.requirements.filter((r) => !r.ok).length;
  const httpsOrigin = origin.startsWith('https://');
  const warnings: string[] = [];
  if (origin && s.serverConfigured && s.config.appUrl.replace(/\/$/, '') !== origin)
    warnings.push(
      `APP_URL in your .env is ${s.config.appUrl}, but you are visiting ${origin}. Sign-in can fail until they match. Edit APP_URL and CORS_ORIGINS in ${s.config.envFile}, then restart (pm2 restart all).`,
    );
  if (httpsOrigin && !s.config.cookieSecure)
    warnings.push('You are using https:// but COOKIE_SECURE is false. Set COOKIE_SECURE=true in .env so sign-in cookies are protected.');
  if (httpsOrigin && !s.config.trustProxy)
    warnings.push('Behind Nginx or a proxy, set TRUST_PROXY=true in .env so rate limits and security checks see real visitor addresses.');

  const applyPreset = (key: string) => {
    setSmtpPreset(key);
    const p = SMTP_PRESETS[key]!;
    setEnvCfg((c) => ({ ...c, smtpHost: p.host || c.smtpHost, smtpPort: p.port }));
    setSmtpResult(null);
  };

  const testSmtp = () =>
    act('smtp', async () => {
      const r = await call<{ ok: boolean; error?: string }>('test-smtp', token, {
        smtpHost: envCfg.smtpHost,
        smtpPort: Number(envCfg.smtpPort),
        smtpUser: envCfg.smtpUser || undefined,
        smtpPassword: envCfg.smtpPassword || undefined,
      });
      setSmtpResult({ ok: r.ok, text: r.ok ? 'Connected and signed in. Emails will work.' : `Failed: ${r.error}` });
    });

  const testAi = () =>
    act('ai', async () => {
      const r = await call<{ ok: boolean; error?: string }>('test-openai', token, { openaiApiKey: envCfg.openaiApiKey });
      setAiResult({ ok: r.ok, text: r.ok ? 'Key accepted.' : (r.error ?? 'Failed') });
    });

  const finish = () =>
    act('finish', async () => {
      await call('finish', token, {});
      let signedIn = false;
      if (adminCreated && admin.email && admin.password) {
        try {
          await api.post('/auth/login', { email: admin.email.trim(), password: admin.password });
          signedIn = true;
        } catch {
          signedIn = false;
        }
      }
      setDone({ signedIn });
    });

  return (
    <Shell step={step}>
      <Card className="border-border/70 bg-card/85 shadow-xl shadow-primary/5 backdrop-blur">
        <CardContent className="space-y-6 p-6 sm:p-8">
          {s.tokenRequired && (
            <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <ShieldCheck className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">Security check</p>
                  <p className="text-xs text-muted-foreground">Only someone with access to this server can install. This stops strangers from taking over a fresh site.</p>
                </div>
              </div>
              <Field label="Installer token" htmlFor="i-token" hint={s.tokenHint ?? undefined}>
                <PasswordInput id="i-token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
              </Field>
            </section>
          )}

          {step === 0 && (
            <>
              <StepHeader
                step={0}
                title="Let’s check your server"
                intro="Sellora AI needs a few things on your server. We test each one now so there are no surprises later."
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { icon: Database, title: 'Server basics', text: 'Node.js, PostgreSQL and Redis, already installed by your host or setup script.' },
                  { icon: Mail, title: 'Email account', text: 'Optional. Any SMTP login lets Sellora send invitations and receipts.' },
                  { icon: Bot, title: 'AI key', text: 'Optional. An OpenAI key powers the sales agent. Businesses can add their own later.' },
                ].map((n) => (
                  <div key={n.title} className="rounded-xl border bg-muted/30 p-3">
                    <n.icon className="size-4 text-primary" aria-hidden />
                    <p className="mt-1.5 text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.text}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                {requirementsOk ? (
                  <span className="flex items-center gap-1.5 font-medium text-success">
                    <CheckCircle2 className="size-4" /> Everything looks good
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-destructive">
                    <XCircle className="size-4" /> {failing} thing{failing === 1 ? '' : 's'} need attention
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {s.requirements.map((r) => (
                  <Check key={r.key} ok={r.ok} label={r.label} hint={r.hint} warn={r.key === 'envFile'} />
                ))}
              </ul>
              {!requirementsOk && (
                <Tip tone="warn">
                  <p>
                    Fix the items marked in red, then press <strong>Check again</strong>. Not sure how? The
                    <strong> Troubleshooting</strong> guide (docs/TROUBLESHOOTING.md) lists the exact commands.
                  </p>
                </Tip>
              )}
              <Nav>
                <Button variant="outline" onClick={() => status.refetch()} loading={status.isFetching}>
                  Check again
                </Button>
                <Button
                  onClick={() =>
                    act('token', async () => {
                      if (s.tokenRequired) await call('check-token', token, {});
                      setStep(1);
                    })
                  }
                  loading={busy === 'token'}
                  disabled={!requirementsOk || (s.tokenRequired && token.trim().length < 8)}
                  className="ml-auto"
                >
                  Continue <ArrowRight />
                </Button>
              </Nav>
            </>
          )}

          {step === 1 && (
            <>
              <StepHeader
                step={1}
                title="Database and Redis"
                intro="PostgreSQL stores your customers, orders and messages. Redis keeps background jobs and live chat fast."
              />
              {s.serverConfigured ? (
                <>
                  <Tip>
                    <p>
                      <strong>Already connected.</strong> Your server&apos;s connection settings are stored safely in{' '}
                      <code>.env</code> and are intentionally not editable from the browser, so a typo cannot take the site
                      offline.
                    </p>
                  </Tip>
                  <ul className="space-y-2">
                    <Check ok label="PostgreSQL connected" />
                    <Check ok label="Redis connected" />
                  </ul>
                </>
              ) : (
                <>
                  <Tip>
                    <p>
                      Format: <code>postgresql://USER:PASSWORD@HOST:5432/DATABASE</code>. Special characters in the
                      password (such as @ or #) must be URL-encoded.
                    </p>
                  </Tip>
                  <Field label="PostgreSQL address" htmlFor="i-db">
                    <div className="flex gap-2">
                      <Input id="i-db" value={db} onChange={(e) => setDb(e.target.value)} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        loading={busy === 'db'}
                        onClick={() =>
                          act('db', async () => {
                            const r = await call<{ ok: boolean; version?: string; error?: string }>('test-database', token, {
                              databaseUrl: db,
                            });
                            setDbResult({ ok: r.ok, text: r.ok ? `Connected: ${r.version}` : `Failed: ${r.error}` });
                          })
                        }
                      >
                        Test
                      </Button>
                    </div>
                    {dbResult && (
                      <p className={cn('mt-1.5 text-xs', dbResult.ok ? 'text-success' : 'text-destructive')}>{dbResult.text}</p>
                    )}
                  </Field>
                  <Field label="Redis address" htmlFor="i-redis">
                    <div className="flex gap-2">
                      <Input id="i-redis" value={redis} onChange={(e) => setRedis(e.target.value)} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        loading={busy === 'redis'}
                        onClick={() =>
                          act('redis', async () => {
                            const r = await call<{ ok: boolean; version?: string; error?: string }>('test-redis', token, {
                              redisUrl: redis,
                            });
                            setRedisResult({ ok: r.ok, text: r.ok ? `Connected: Redis ${r.version}` : `Failed: ${r.error}` });
                          })
                        }
                      >
                        Test
                      </Button>
                    </div>
                    {redisResult && (
                      <p className={cn('mt-1.5 text-xs', redisResult.ok ? 'text-success' : 'text-destructive')}>{redisResult.text}</p>
                    )}
                  </Field>
                </>
              )}
              <Nav>
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!s.serverConfigured && !(dbResult?.ok && redisResult?.ok)}
                  className="ml-auto"
                >
                  Continue <ArrowRight />
                </Button>
              </Nav>
            </>
          )}

          {step === 2 && (
            <>
              <StepHeader
                step={2}
                title="Email and AI"
                intro="Both are optional now and can be added later, but without them password resets, team invitations and the AI sales agent will not work."
              />
              <section className="space-y-4 rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-primary" aria-hidden />
                  <h2 className="font-semibold">Email (SMTP)</h2>
                  {s.config.smtpConfigured && <span className="text-xs text-success">already configured</span>}
                </div>
                <p className="text-xs text-muted-foreground">Used for verification emails, password resets, invitations and order receipts.</p>
                <Field label="Email provider" htmlFor="e-preset">
                  <Select value={smtpPreset} onValueChange={applyPreset}>
                    <SelectTrigger id="e-preset">
                      <SelectValue placeholder="Choose your provider to fill in the settings" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SMTP_PRESETS).map(([k, p]) => (
                        <SelectItem key={k} value={k}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {smtpPreset && <Tip><p>{SMTP_PRESETS[smtpPreset]!.note}</p></Tip>}
                <FormGrid>
                  <Field label="Server (host)" htmlFor="e-smtp">
                    <Input id="e-smtp" value={envCfg.smtpHost} placeholder="smtp.example.com" onChange={(e) => setEnvCfg({ ...envCfg, smtpHost: e.target.value })} />
                  </Field>
                  <Field label="Port" htmlFor="e-port" hint="587 is the most common. Use 465 for SSL.">
                    <Input id="e-port" inputMode="numeric" value={envCfg.smtpPort} onChange={(e) => setEnvCfg({ ...envCfg, smtpPort: e.target.value })} />
                  </Field>
                  <Field label="Username" htmlFor="e-user">
                    <Input id="e-user" autoComplete="off" value={envCfg.smtpUser} onChange={(e) => setEnvCfg({ ...envCfg, smtpUser: e.target.value })} />
                  </Field>
                  <Field label="Password" htmlFor="e-pass">
                    <PasswordInput id="e-pass" autoComplete="new-password" value={envCfg.smtpPassword} onChange={(e) => setEnvCfg({ ...envCfg, smtpPassword: e.target.value })} />
                  </Field>
                  <Field label="Send emails from" htmlFor="e-from" className="sm:col-span-2" hint="The name and address customers see.">
                    <Input id="e-from" value={envCfg.mailFrom} onChange={(e) => setEnvCfg({ ...envCfg, mailFrom: e.target.value })} placeholder="Your Company <no-reply@yourdomain.com>" />
                  </Field>
                </FormGrid>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={testSmtp} loading={busy === 'smtp'} disabled={!envCfg.smtpHost || !envCfg.smtpPort}>
                    Test email connection
                  </Button>
                  {smtpResult && <span className={cn('text-xs', smtpResult.ok ? 'text-success' : 'text-destructive')}>{smtpResult.text}</span>}
                </div>
              </section>

              <section className="space-y-4 rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-primary" aria-hidden />
                  <h2 className="font-semibold">AI key (OpenAI)</h2>
                  {s.config.aiConfigured && <span className="text-xs text-success">already configured</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Powers the AI sales agent for every business on your platform. Skip it if each business should bring its own key
                  (they add it under Settings → AI).
                </p>
                <Field label="OpenAI API key" htmlFor="e-ai" hint={<>Create one at platform.openai.com → API keys. It starts with <code>sk-</code>.</>}>
                  <div className="flex gap-2">
                    <PasswordInput id="e-ai" autoComplete="off" value={envCfg.openaiApiKey} onChange={(e) => { setEnvCfg({ ...envCfg, openaiApiKey: e.target.value }); setAiResult(null); }} />
                    <Button variant="outline" onClick={testAi} loading={busy === 'ai'} disabled={envCfg.openaiApiKey.trim().length < 10}>
                      <KeyRound /> Test
                    </Button>
                  </div>
                  {aiResult && <p className={cn('mt-1.5 text-xs', aiResult.ok ? 'text-success' : 'text-destructive')}>{aiResult.text}</p>}
                </Field>
              </section>

              {!s.serverConfigured && (
                <section className="space-y-3 rounded-xl border p-4">
                  <h2 className="font-semibold">Website addresses</h2>
                  <FormGrid>
                    <Field label="Website address" htmlFor="e-app" hint="Where people open Sellora AI.">
                      <Input id="e-app" value={envCfg.appUrl} placeholder={origin} onChange={(e) => setEnvCfg({ ...envCfg, appUrl: e.target.value })} />
                    </Field>
                    <Field label="API address" htmlFor="e-api" hint="Usually the same as the website address.">
                      <Input id="e-api" value={envCfg.apiUrl} placeholder={origin} onChange={(e) => setEnvCfg({ ...envCfg, apiUrl: e.target.value })} />
                    </Field>
                  </FormGrid>
                </section>
              )}

              <Tip>
                <p>
                  Settings are saved to <code>{s.config.envFile}</code>. Security keys are generated automatically. After
                  installing, restart with <strong>pm2 restart all</strong> so new settings apply.
                </p>
              </Tip>
              <Nav>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="outline" onClick={() => setStep(3)} className="ml-auto">
                  Skip for now
                </Button>
                <Button
                  loading={busy === 'env'}
                  onClick={() =>
                    act('env', async () => {
                      const r = await call<{ written: string[]; restartRequired: boolean }>('environment', token, {
                        databaseUrl: s.serverConfigured ? undefined : db || undefined,
                        redisUrl: s.serverConfigured ? undefined : redis || undefined,
                        appUrl: s.serverConfigured ? undefined : appUrl || undefined,
                        apiUrl: s.serverConfigured ? undefined : envCfg.apiUrl || origin || undefined,
                        smtpHost: envCfg.smtpHost || undefined,
                        smtpPort: envCfg.smtpHost && envCfg.smtpPort ? Number(envCfg.smtpPort) : undefined,
                        smtpUser: envCfg.smtpUser || undefined,
                        smtpPassword: envCfg.smtpPassword || undefined,
                        mailFrom: envCfg.mailFrom || undefined,
                        openaiApiKey: envCfg.openaiApiKey || undefined,
                      });
                      toast.success(r.written.length === 0 ? 'Nothing to change.' : `Saved ${r.written.length} settings.`);
                      setStep(3);
                    })
                  }
                >
                  Save and continue <ArrowRight />
                </Button>
              </Nav>
            </>
          )}

          {step === 3 && (
            <>
              <StepHeader
                step={3}
                title="Create the database tables"
                intro="This prepares the empty tables Sellora AI needs. It is safe to run more than once and never deletes existing data."
              />
              {s.migrated || migrateOk ? (
                <Check ok label="Database tables are ready" />
              ) : (
                <Tip>
                  <p>Press <strong>Create tables</strong> and wait up to a minute. You will see the result below.</p>
                </Tip>
              )}
              {migrateOk === false && (
                <Tip tone="warn">
                  <p>
                    <strong>It did not finish.</strong> Read the last lines below. The most common causes are a wrong database password or a
                    database user without permission to create tables.
                  </p>
                </Tip>
              )}
              {migrateOutput && (
                <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{migrateOutput}</pre>
              )}
              <Nav>
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  variant={s.migrated || migrateOk ? 'outline' : 'default'}
                  loading={busy === 'migrate'}
                  onClick={() =>
                    act('migrate', async () => {
                      const r = await call<{ ok: boolean; output: string }>('migrate', token, {});
                      setMigrateOutput(r.output);
                      setMigrateOk(r.ok);
                      if (r.ok) {
                        toast.success('Database ready');
                        await status.refetch();
                      } else toast.error('Setup failed. See the details below.');
                    })
                  }
                  className="ml-auto"
                >
                  {s.migrated || migrateOk ? 'Run again' : 'Create tables'}
                </Button>
                <Button onClick={() => setStep(4)} disabled={!s.migrated && !migrateOk}>
                  Continue <ArrowRight />
                </Button>
              </Nav>
            </>
          )}

          {step === 4 && (
            <>
              <StepHeader
                step={4}
                title="Create your administrator account"
                intro="This is the platform owner account. It can manage every business on your platform, set plan prices and approve payments."
              />
              {s.hasAdmin ? (
                <>
                  <Check ok label="An administrator already exists" />
                  <Tip>
                    <p>You will sign in with that account after finishing.</p>
                  </Tip>
                </>
              ) : (
                <>
                  <FormGrid>
                    <Field label="Your name" htmlFor="a-name" required>
                      <Input id="a-name" autoComplete="name" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
                    </Field>
                    <Field label="Email" htmlFor="a-email" required error={admin.email && !emailOk ? 'Enter a valid email address' : undefined} hint="You will sign in with this.">
                      <Input id="a-email" type="email" autoComplete="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
                    </Field>
                    <Field label="Password" htmlFor="a-pw" required>
                      <PasswordInput id="a-pw" autoComplete="new-password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
                    </Field>
                    <Field label="Repeat password" htmlFor="a-pw2" required error={admin.confirm && admin.confirm !== admin.password ? 'Passwords do not match' : undefined}>
                      <PasswordInput id="a-pw2" autoComplete="new-password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />
                    </Field>
                    <Field label="Your first business (workspace) name" htmlFor="a-ws" required className="sm:col-span-2" hint="Your own shop or company. You can create or rename workspaces later.">
                      <Input id="a-ws" value={admin.workspaceName} onChange={(e) => setAdmin({ ...admin, workspaceName: e.target.value })} />
                    </Field>
                  </FormGrid>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {pwChecks.map((c) => (
                      <li key={c.label} className={cn('flex items-center gap-1', c.ok ? 'text-success' : 'text-muted-foreground')}>
                        <CheckCircle2 className="size-3.5" aria-hidden /> {c.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Nav>
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Back
                </Button>
                {s.hasAdmin ? (
                  <Button onClick={() => setStep(5)} className="ml-auto">
                    Continue <ArrowRight />
                  </Button>
                ) : (
                  <Button
                    className="ml-auto"
                    loading={busy === 'admin'}
                    disabled={!adminValid}
                    onClick={() =>
                      act('admin', async () => {
                        await call('admin', token, {
                          name: admin.name.trim(),
                          email: admin.email.trim(),
                          password: admin.password,
                          workspaceName: admin.workspaceName.trim(),
                        });
                        setAdminCreated(true);
                        toast.success('Administrator created');
                        await status.refetch();
                        setStep(5);
                      })
                    }
                  >
                    Create account <ArrowRight />
                  </Button>
                )}
              </Nav>
            </>
          )}

          {step === 5 && (
            <>
              <StepHeader step={5} title="Review before launching" intro="Here is what will be set up. Anything marked in yellow is optional and can be done later." />
              <ul className="space-y-2">
                <Check ok label={`Website address: ${s.config.appUrl}`} />
                <Check ok={s.migrated} label="Database tables created" hint="Go back to the Create tables step." />
                <Check ok={s.hasAdmin} label={s.hasAdmin ? `Administrator ready${adminCreated ? `: ${admin.email}` : ''}` : 'Administrator account'} hint="Go back and create the account." />
                <Check ok={s.config.smtpConfigured} warn label="Email (SMTP)" hint="Without email, invitations and password resets must be shared by hand. Add SMTP_* in .env later." />
                <Check ok={s.config.aiConfigured} warn label="Platform AI key" hint="Optional. Each business can add its own key in Settings → AI." />
              </ul>
              {warnings.length > 0 && (
                <Tip tone="warn">
                  <p className="font-medium text-foreground">Fix these for a smooth first sign-in:</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Tip>
              )}
              <Nav>
                <Button variant="ghost" onClick={() => setStep(4)}>
                  Back
                </Button>
                <Button onClick={() => setStep(6)} disabled={!s.migrated || !s.hasAdmin} className="ml-auto">
                  Continue <ArrowRight />
                </Button>
              </Nav>
            </>
          )}

          {step === 6 && (
            <>
              <StepHeader step={6} title="Ready to launch" intro="Finishing locks this installer permanently so nobody else can run it." />
              <Tip>
                <p>
                  {adminCreated
                    ? 'We will sign you in automatically and open your platform admin dashboard.'
                    : 'You will be taken to the sign-in page, then to your admin dashboard.'}
                </p>
              </Tip>
              <Nav>
                <Button variant="ghost" onClick={() => setStep(5)}>
                  Back
                </Button>
                <Button size="lg" loading={busy === 'finish'} onClick={finish} className="ml-auto">
                  <Rocket /> Finish installation
                </Button>
              </Nav>
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function SuccessScreen({ signedIn }: { signedIn: boolean }) {
  const next = [
    { icon: Wallet, title: 'Set how customers pay you', text: 'Platform admin → Plan payments: add your bKash / bank details and plan prices.', href: '/admin' },
    { icon: LayoutDashboard, title: 'Set up your own business', text: 'Your dashboard has a “Get ready to sell” checklist: products, AI, channels and payments.', href: '/dashboard' },
    { icon: Mail, title: 'Add email later if you skipped it', text: 'Set SMTP_* in the .env file so invitations and password resets work.', href: undefined },
  ];
  const go = (path: string) => (signedIn ? path : `/login?next=${encodeURIComponent(path)}`);
  return (
    <Shell>
      <Card>
        <CardContent className="space-y-6 p-6 text-center sm:p-8">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/12 text-success">
            <PartyPopper className="size-7" aria-hidden />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Sellora AI is installed!</h1>
            <p className="text-sm text-muted-foreground">
              {signedIn
                ? 'You are signed in as the platform administrator.'
                : 'Sign in with the administrator account you just created.'}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button asChild size="lg">
              <a href={go('/admin')}>
                <ShieldCheck /> Open admin dashboard
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={go('/dashboard')}>
                <LayoutDashboard /> Open my workspace
              </a>
            </Button>
          </div>
          <div className="space-y-2 border-t pt-5 text-left">
            <h2 className="text-sm font-semibold">What to do next</h2>
            <ul className="space-y-2">
              {next.map((n) => (
                <li key={n.title} className="flex items-start gap-3 rounded-lg border p-3">
                  <n.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.text}</p>
                  </div>
                  {n.href && (
                    <a href={go(n.href)} className="text-xs font-medium text-primary hover:underline">
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              If you changed any settings, restart the services once: <code className="rounded bg-muted px-1">pm2 restart all</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
