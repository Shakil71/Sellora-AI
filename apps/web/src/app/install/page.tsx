'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Input } from '@/components/ui/primitives';
import { Field, FormGrid } from '@/components/shared/form';
import { cn } from '@/lib/utils';

interface Status {
  installed: boolean;
  tokenRequired: boolean;
  requirements: Array<{ key: string; label: string; ok: boolean; hint: string }>;
  migrated: boolean;
  hasAdmin: boolean;
  /** Database and Redis already work: connection settings are managed on the server. */
  serverConfigured: boolean;
  config: { appUrl: string; apiUrl: string; smtpConfigured: boolean; aiConfigured: boolean };
}

const STEPS = [
  'Requirements',
  'Database',
  'Environment',
  'Migration',
  'Administrator',
  'Configuration',
  'Finish',
];

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

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border px-4 py-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 text-success" />
      ) : (
        <XCircle className="mt-0.5 size-4 text-destructive" />
      )}
      <div>
        <p className="text-sm font-medium">{label}</p>
        {!ok && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </li>
  );
}

/**
 * Web installation wizard. The API refuses every step once installation has
 * finished, so this page becomes read-only afterwards.
 */
export default function InstallPage() {
  const [step, setStep] = React.useState(0);
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [db, setDb] = React.useState(
    'postgresql://sellora:password@localhost:5432/sellora?schema=public',
  );
  const [redis, setRedis] = React.useState('redis://localhost:6379');
  const [dbResult, setDbResult] = React.useState<string | null>(null);
  const [redisResult, setRedisResult] = React.useState<string | null>(null);
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
  const [admin, setAdmin] = React.useState({
    name: '',
    email: '',
    password: '',
    workspaceName: '',
  });
  const status = useQuery({
    queryKey: ['install-status'],
    queryFn: () => call<Status>('status', ''),
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    if (status.data)
      setEnvCfg((c) => ({
        ...c,
        appUrl: c.appUrl || window.location.origin,
        apiUrl: c.apiUrl || window.location.origin,
      }));
  }, [status.data]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="space-y-3">
            <h1 className="text-lg font-semibold">API not reachable</h1>
            <p className="text-sm text-muted-foreground">
              Start the Sellora AI API (npm run start:api) and reload. See INSTALLATION.md.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  const s = status.data!;
  if (s.installed) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="text-xl font-semibold">Sellora AI is installed</h1>
            <p className="text-sm text-muted-foreground">
              The installer is locked. Sign in with your administrator account.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <span className="text-sm text-muted-foreground">Installation</span>
        </div>
        <ol className="mb-6 flex scrollbar-thin gap-1 overflow-x-auto pb-1">
          {STEPS.map((t, i) => (
            <li
              key={t}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                i === step
                  ? 'bg-primary text-primary-foreground'
                  : i < step
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {i + 1}. {t}
            </li>
          ))}
        </ol>
        <Card>
          <CardContent className="space-y-5 p-6">
            {s.tokenRequired && (
              <Field
                label="Installer token"
                htmlFor="i-token"
                hint="Set by INSTALLER_TOKEN on the server."
              >
                <Input
                  id="i-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Field>
            )}

            {step === 0 && (
              <>
                <h1 className="text-xl font-semibold">System requirements</h1>
                <ul className="space-y-2">
                  {s.requirements.map((r) => (
                    <Check key={r.key} ok={r.ok} label={r.label} hint={r.hint} />
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => status.refetch()}>
                    Re-check
                  </Button>
                  <Button onClick={() => setStep(1)}>Continue</Button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="text-xl font-semibold">Database & Redis</h1>
                {s.serverConfigured ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      This server is already connected. The connection settings live in the
                      server&apos;s .env file and are not changed from the browser.
                    </p>
                    <ul className="space-y-2">
                      <Check ok label="PostgreSQL connected" />
                      <Check ok label="Redis connected" />
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Test the connections. PostgreSQL 14+ and Redis 6.2+ are recommended.
                    </p>
                    <Field label="PostgreSQL URL" htmlFor="i-db" hint={dbResult ?? undefined}>
                      <div className="flex gap-2">
                        <Input
                          id="i-db"
                          value={db}
                          onChange={(e) => setDb(e.target.value)}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          loading={busy}
                          onClick={() =>
                            act(async () => {
                              const r = await call<{
                                ok: boolean;
                                version?: string;
                                error?: string;
                              }>('test-database', token, { databaseUrl: db });
                              setDbResult(r.ok ? `Connected: ${r.version}` : `Failed: ${r.error}`);
                            })
                          }
                        >
                          Test
                        </Button>
                      </div>
                    </Field>
                    <Field label="Redis URL" htmlFor="i-redis" hint={redisResult ?? undefined}>
                      <div className="flex gap-2">
                        <Input
                          id="i-redis"
                          value={redis}
                          onChange={(e) => setRedis(e.target.value)}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          loading={busy}
                          onClick={() =>
                            act(async () => {
                              const r = await call<{
                                ok: boolean;
                                version?: string;
                                error?: string;
                              }>('test-redis', token, { redisUrl: redis });
                              setRedisResult(
                                r.ok ? `Connected: Redis ${r.version}` : `Failed: ${r.error}`,
                              );
                            })
                          }
                        >
                          Test
                        </Button>
                      </div>
                    </Field>
                  </>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  <Button onClick={() => setStep(2)}>Continue</Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="text-xl font-semibold">Environment</h1>
                <p className="text-sm text-muted-foreground">
                  {s.serverConfigured
                    ? 'Optional. Add email (SMTP) and AI settings now, or skip and configure them later in the .env file.'
                    : "Saved to the server's .env file. Missing security keys are generated automatically. Restart the API and worker afterwards (pm2 restart all)."}
                </p>
                <FormGrid>
                  {!s.serverConfigured && (
                    <>
                      <Field label="App URL" htmlFor="e-app">
                        <Input
                          id="e-app"
                          value={envCfg.appUrl}
                          onChange={(e) => setEnvCfg({ ...envCfg, appUrl: e.target.value })}
                        />
                      </Field>
                      <Field label="API URL" htmlFor="e-api">
                        <Input
                          id="e-api"
                          value={envCfg.apiUrl}
                          onChange={(e) => setEnvCfg({ ...envCfg, apiUrl: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  <Field label="SMTP host" htmlFor="e-smtp">
                    <Input
                      id="e-smtp"
                      value={envCfg.smtpHost}
                      onChange={(e) => setEnvCfg({ ...envCfg, smtpHost: e.target.value })}
                    />
                  </Field>
                  <Field label="SMTP port" htmlFor="e-port">
                    <Input
                      id="e-port"
                      value={envCfg.smtpPort}
                      onChange={(e) => setEnvCfg({ ...envCfg, smtpPort: e.target.value })}
                    />
                  </Field>
                  <Field label="SMTP user" htmlFor="e-user">
                    <Input
                      id="e-user"
                      value={envCfg.smtpUser}
                      onChange={(e) => setEnvCfg({ ...envCfg, smtpUser: e.target.value })}
                    />
                  </Field>
                  <Field label="SMTP password" htmlFor="e-pass">
                    <Input
                      id="e-pass"
                      type="password"
                      value={envCfg.smtpPassword}
                      onChange={(e) => setEnvCfg({ ...envCfg, smtpPassword: e.target.value })}
                    />
                  </Field>
                  <Field label="From address" htmlFor="e-from">
                    <Input
                      id="e-from"
                      value={envCfg.mailFrom}
                      onChange={(e) => setEnvCfg({ ...envCfg, mailFrom: e.target.value })}
                      placeholder="Sellora AI <no-reply@yourdomain.com>"
                    />
                  </Field>
                  <Field label="OpenAI API key (optional)" htmlFor="e-ai">
                    <Input
                      id="e-ai"
                      type="password"
                      value={envCfg.openaiApiKey}
                      onChange={(e) => setEnvCfg({ ...envCfg, openaiApiKey: e.target.value })}
                    />
                  </Field>
                </FormGrid>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button variant="outline" onClick={() => setStep(3)}>
                    Skip (already configured)
                  </Button>
                  <Button
                    loading={busy}
                    onClick={() =>
                      act(async () => {
                        const r = await call<{ written: string[]; restartRequired: boolean }>(
                          'environment',
                          token,
                          {
                            databaseUrl: s.serverConfigured ? undefined : db || undefined,
                            redisUrl: s.serverConfigured ? undefined : redis || undefined,
                            appUrl: s.serverConfigured ? undefined : envCfg.appUrl || undefined,
                            apiUrl: s.serverConfigured ? undefined : envCfg.apiUrl || undefined,
                            smtpHost: envCfg.smtpHost || undefined,
                            smtpPort: envCfg.smtpPort ? Number(envCfg.smtpPort) : undefined,
                            smtpUser: envCfg.smtpUser || undefined,
                            smtpPassword: envCfg.smtpPassword || undefined,
                            mailFrom: envCfg.mailFrom || undefined,
                            openaiApiKey: envCfg.openaiApiKey || undefined,
                          },
                        );
                        toast.success(
                          r.written.length === 0
                            ? 'Nothing to change.'
                            : `Saved ${r.written.length} settings. Restart the API and worker (pm2 restart all) to apply them.`,
                          { duration: 8000 },
                        );
                        setStep(3);
                      })
                    }
                  >
                    Save .env
                  </Button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="text-xl font-semibold">Database migration</h1>
                <p className="text-sm text-muted-foreground">
                  Creates the database tables with <code>prisma migrate deploy</code>. Existing data
                  is never reset.
                </p>
                {s.migrated && (
                  <p className="text-sm text-success">Migrations are already applied.</p>
                )}
                {migrateOutput && (
                  <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs">
                    {migrateOutput}
                  </pre>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button
                    variant="outline"
                    loading={busy}
                    onClick={() =>
                      act(async () => {
                        const r = await call<{ ok: boolean; output: string }>('migrate', token, {});
                        setMigrateOutput(r.output);
                        if (r.ok) {
                          toast.success('Database ready');
                          await status.refetch();
                        } else toast.error('Migration failed — see output');
                      })
                    }
                  >
                    Run migrations
                  </Button>
                  <Button onClick={() => setStep(4)} disabled={!s.migrated}>
                    Continue
                  </Button>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h1 className="text-xl font-semibold">Administrator account</h1>
                {s.hasAdmin ? (
                  <p className="text-sm text-success">An administrator already exists.</p>
                ) : (
                  <FormGrid>
                    <Field label="Your name" htmlFor="a-name">
                      <Input
                        id="a-name"
                        value={admin.name}
                        onChange={(e) => setAdmin({ ...admin, name: e.target.value })}
                      />
                    </Field>
                    <Field label="Email" htmlFor="a-email">
                      <Input
                        id="a-email"
                        type="email"
                        value={admin.email}
                        onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Password"
                      htmlFor="a-pw"
                      hint="8+ characters, a letter and a number"
                    >
                      <Input
                        id="a-pw"
                        type="password"
                        value={admin.password}
                        onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                      />
                    </Field>
                    <Field label="First workspace name" htmlFor="a-ws">
                      <Input
                        id="a-ws"
                        value={admin.workspaceName}
                        onChange={(e) => setAdmin({ ...admin, workspaceName: e.target.value })}
                      />
                    </Field>
                  </FormGrid>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(3)}>
                    Back
                  </Button>
                  {s.hasAdmin ? (
                    <Button onClick={() => setStep(5)}>Continue</Button>
                  ) : (
                    <Button
                      loading={busy}
                      onClick={() =>
                        act(async () => {
                          await call('admin', token, admin);
                          toast.success('Administrator created');
                          await status.refetch();
                          setStep(5);
                        })
                      }
                    >
                      Create administrator
                    </Button>
                  )}
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <h1 className="text-xl font-semibold">Application configuration</h1>
                <ul className="space-y-2">
                  <Check ok label={`App URL: ${s.config.appUrl}`} />
                  <Check
                    ok={s.config.smtpConfigured}
                    label="Email (SMTP)"
                    hint="Optional. Without SMTP, invitations and password resets must be shared manually."
                  />
                  <Check
                    ok={s.config.aiConfigured}
                    label="Platform AI key"
                    hint="Optional. Each workspace can add its own key in Settings → AI."
                  />
                </ul>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(4)}>
                    Back
                  </Button>
                  <Button onClick={() => setStep(6)}>Continue</Button>
                </div>
              </>
            )}

            {step === 6 && (
              <>
                <h1 className="text-xl font-semibold">Finish installation</h1>
                <p className="text-sm text-muted-foreground">
                  Finishing locks the installer permanently.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(5)}>
                    Back
                  </Button>
                  <Button
                    loading={busy}
                    onClick={() =>
                      act(async () => {
                        await call('finish', token, {});
                        toast.success('Installation complete');
                        await status.refetch();
                      })
                    }
                  >
                    Finish
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
