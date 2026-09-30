'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Building2, Check, MessageCircle, Package, PartyPopper, Settings2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Me } from '@/lib/types';
import { useMe } from '@/components/session';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Input, Textarea } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, MoneyInput } from '@/components/shared/form';

const STEPS = [
  { key: 'business', title: 'Business', icon: Building2 },
  { key: 'workspace', title: 'Workspace', icon: Settings2 },
  { key: 'whatsapp', title: 'WhatsApp', icon: MessageCircle },
  { key: 'products', title: 'Products', icon: Package },
  { key: 'ai', title: 'AI agent', icon: Bot },
  { key: 'team', title: 'Team', icon: Users },
  { key: 'complete', title: 'Done', icon: PartyPopper },
] as const;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'BDT', 'AED', 'SAR', 'PKR', 'NGN', 'KES', 'ZAR', 'BRL', 'MXN', 'IDR', 'MYR', 'PHP', 'SGD', 'AUD', 'CAD'];

interface Status {
  step: number;
  completed: boolean;
  checklist: Record<string, boolean>;
}

function CreateWorkspace() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const create = useMutation({
    mutationFn: () => api.post<Me>('/auth/workspaces', { name }),
    onSuccess: (me) => {
      qc.setQueryData(['me'], me);
      router.replace('/onboarding');
    },
  });
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardContent className="space-y-4">
        <h1 className="text-xl font-semibold">Create a workspace</h1>
        <p className="text-sm text-muted-foreground">A workspace holds your team, catalog, customers and WhatsApp numbers.</p>
        <Field label="Business name" htmlFor="ws-name">
          <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending} disabled={name.trim().length < 2}>
          Create workspace
        </Button>
      </CardContent>
    </Card>
  );
}

function Wizard({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<Status>('/onboarding') });
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (status.data) setStep(Math.min(status.data.step, STEPS.length - 1));
  }, [status.data]);
  const [biz, setBiz] = React.useState({ businessName: me.workspace?.name ?? '', industry: '', country: '', website: '', phone: '' });
  const [ws, setWs] = React.useState({ currency: me.workspace?.currency ?? 'USD', timezone: me.workspace?.timezone ?? 'UTC', taxRatePercent: 0, defaultShippingFee: 0 as number | null });
  const [product, setProduct] = React.useState({ name: '', sku: '', price: null as number | null, stock: 10, description: '' });
  const [agent, setAgent] = React.useState({ name: 'Sales Assistant', tone: 'friendly', businessInfo: '' });
  const [invite, setInvite] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setWs((w) => ({ ...w, timezone: me.workspace?.timezone === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone : w.timezone }));
  }, [me.workspace?.timezone]);

  const progress = useMutation({ mutationFn: (v: { step: number; complete?: boolean }) => api.post<Status>('/onboarding/progress', v), meta: { silent: true } });

  const goto = async (next: number) => {
    setStep(next);
    await progress.mutateAsync({ step: next }).catch(() => undefined);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await goto(step + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await progress.mutateAsync({ step: STEPS.length - 1, complete: true });
    await qc.invalidateQueries({ queryKey: ['me'] });
    router.replace('/dashboard');
  };

  const current = STEPS[step]!;
  const next = (optional?: boolean) => (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
      <Button variant="ghost" onClick={() => goto(Math.max(0, step - 1))} disabled={step === 0}>
        Back
      </Button>
      {optional && (
        <Button variant="outline" onClick={() => goto(step + 1)}>
          Skip for now
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <ol className="mb-8 flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => i <= (status.data?.step ?? 0) + 1 && setStep(i)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium',
                i < step ? 'bg-primary/10 text-primary' : i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
              {s.title}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>
      <Card>
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {
                {
                  business: 'Tell us about your business',
                  workspace: 'Set up your workspace',
                  whatsapp: 'Connect WhatsApp',
                  products: 'Add your first product',
                  ai: 'Configure your AI Sales Agent',
                  team: 'Invite your team',
                  complete: "You're ready to sell",
                }[current.key]
              }
            </h1>
          </div>

          {current.key === 'business' && (
            <>
              <FormGrid>
                <Field label="Business name" htmlFor="b-name">
                  <Input id="b-name" value={biz.businessName} onChange={(e) => setBiz({ ...biz, businessName: e.target.value })} />
                </Field>
                <Field label="Industry" htmlFor="b-ind">
                  <Input id="b-ind" value={biz.industry} onChange={(e) => setBiz({ ...biz, industry: e.target.value })} placeholder="e.g. Electronics retail" />
                </Field>
                <Field label="Country" htmlFor="b-country">
                  <Input id="b-country" value={biz.country} onChange={(e) => setBiz({ ...biz, country: e.target.value })} />
                </Field>
                <Field label="Website" htmlFor="b-web">
                  <Input id="b-web" type="url" value={biz.website} onChange={(e) => setBiz({ ...biz, website: e.target.value })} placeholder="https://" />
                </Field>
              </FormGrid>
              <Button className="w-full sm:w-auto" loading={busy} onClick={() => run(() => api.patch('/workspace', { businessName: biz.businessName, industry: biz.industry || null, country: biz.country || null, website: biz.website || null }))}>
                Continue
              </Button>
              {next()}
            </>
          )}

          {current.key === 'workspace' && (
            <>
              <FormGrid>
                <Field label="Currency" htmlFor="w-cur">
                  <Select value={ws.currency} onValueChange={(v) => setWs({ ...ws, currency: v })}>
                    <SelectTrigger id="w-cur">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([ws.currency, ...CURRENCIES])].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Timezone" htmlFor="w-tz">
                  <Input id="w-tz" value={ws.timezone} onChange={(e) => setWs({ ...ws, timezone: e.target.value })} />
                </Field>
                <Field label="Tax rate (%)" htmlFor="w-tax">
                  <Input id="w-tax" type="number" min={0} max={100} step="0.01" value={ws.taxRatePercent} onChange={(e) => setWs({ ...ws, taxRatePercent: Number(e.target.value) })} />
                </Field>
                <Field label="Default shipping fee" htmlFor="w-ship">
                  <MoneyInput id="w-ship" currency={ws.currency} value={ws.defaultShippingFee} onChange={(v) => setWs({ ...ws, defaultShippingFee: v })} />
                </Field>
              </FormGrid>
              <Button
                loading={busy}
                onClick={() =>
                  run(async () => {
                    await api.patch('/workspace', { currency: ws.currency, timezone: ws.timezone });
                    await api.put('/workspace/commerce', { taxRatePercent: ws.taxRatePercent, defaultShippingFee: ws.defaultShippingFee ?? 0 });
                  })
                }
              >
                Continue
              </Button>
              {next()}
            </>
          )}

          {current.key === 'whatsapp' && (
            <>
              <p className="text-sm text-muted-foreground">
                Sellora AI uses the official WhatsApp Cloud API from Meta. You need a Meta developer app, a WhatsApp Business Account and a permanent access token.
              </p>
              {status.data?.checklist.whatsapp ? (
                <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
                  <Check className="size-4" /> A WhatsApp number is connected.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href="/whatsapp/accounts">Connect WhatsApp now</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">
                      Meta setup guide
                    </a>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">You can try everything first with a test conversation from the inbox — no WhatsApp needed.</p>
              {next(true)}
              {status.data?.checklist.whatsapp && <Button onClick={() => goto(step + 1)}>Continue</Button>}
            </>
          )}

          {current.key === 'products' && (
            <>
              {status.data?.checklist.products ? (
                <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
                  <Check className="size-4" /> You already have products. Add more anytime from Products.
                </p>
              ) : (
                <>
                  <FormGrid>
                    <Field label="Product name" htmlFor="p-name">
                      <Input id="p-name" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
                    </Field>
                    <Field label="SKU" htmlFor="p-sku">
                      <Input id="p-sku" value={product.sku} onChange={(e) => setProduct({ ...product, sku: e.target.value.replace(/\s/g, '-') })} />
                    </Field>
                    <Field label="Price" htmlFor="p-price">
                      <MoneyInput id="p-price" currency={ws.currency} value={product.price} onChange={(v) => setProduct({ ...product, price: v })} />
                    </Field>
                    <Field label="Stock" htmlFor="p-stock">
                      <Input id="p-stock" type="number" min={0} value={product.stock} onChange={(e) => setProduct({ ...product, stock: Number(e.target.value) })} />
                    </Field>
                  </FormGrid>
                  <Field label="Description" htmlFor="p-desc">
                    <Textarea id="p-desc" rows={2} value={product.description} onChange={(e) => setProduct({ ...product, description: e.target.value })} />
                  </Field>
                </>
              )}
              <Button
                loading={busy}
                disabled={!status.data?.checklist.products && (!product.name || !product.sku || product.price === null)}
                onClick={() =>
                  run(async () => {
                    if (!status.data?.checklist.products) {
                      await api.post('/products', { name: product.name, sku: product.sku, price: product.price, description: product.description || null, initialStock: product.stock });
                    }
                  })
                }
              >
                Continue
              </Button>
              {next(true)}
            </>
          )}

          {current.key === 'ai' && (
            <>
              <p className="text-sm text-muted-foreground">Your agent answers questions, recommends products and takes orders — only with real catalog data. You can refine everything later.</p>
              <FormGrid>
                <Field label="Agent name" htmlFor="a-name">
                  <Input id="a-name" value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} />
                </Field>
                <Field label="Tone" htmlFor="a-tone">
                  <Select value={agent.tone} onValueChange={(v) => setAgent({ ...agent, tone: v })}>
                    <SelectTrigger id="a-tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['friendly', 'professional', 'enthusiastic', 'concise', 'empathetic'].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FormGrid>
              <Field label="About your business" htmlFor="a-info" hint="Opening hours, delivery areas, return policy, anything customers ask often.">
                <Textarea id="a-info" rows={4} value={agent.businessInfo} onChange={(e) => setAgent({ ...agent, businessInfo: e.target.value })} />
              </Field>
              <Button loading={busy} onClick={() => run(() => api.post('/onboarding/ai-agent', { name: agent.name, tone: agent.tone, businessInfo: agent.businessInfo || undefined }))}>
                Save agent & continue
              </Button>
              {next(true)}
            </>
          )}

          {current.key === 'team' && (
            <>
              <p className="text-sm text-muted-foreground">Invite a teammate to handle conversations. You can manage roles later in Settings → Users.</p>
              <Field label="Teammate email" htmlFor="t-email">
                <Input id="t-email" type="email" value={invite} onChange={(e) => setInvite(e.target.value)} />
              </Field>
              <Button
                loading={busy}
                disabled={!invite.includes('@')}
                onClick={() =>
                  run(async () => {
                    const roles = await api.get<Array<{ id: string; key: string }>>('/roles');
                    const role = roles.find((r) => r.key === 'AGENT') ?? roles[0];
                    const res = await api.post<{ emailSent: boolean; inviteUrl?: string }>('/users/invite', { email: invite, roleId: role!.id });
                    toast.success(res.emailSent ? 'Invitation sent' : 'Invitation created — share the link from Settings → Users');
                  })
                }
              >
                Send invitation
              </Button>
              {next(true)}
            </>
          )}

          {current.key === 'complete' && (
            <>
              <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s set up. You can come back to this guide from the help menu.</p>
              <ul className="space-y-2">
                {[
                  ['whatsapp', 'WhatsApp connected', '/whatsapp/accounts'],
                  ['products', 'Products added', '/products'],
                  ['ai', 'AI agent configured', '/ai/agents'],
                  ['team', 'Team invited', '/settings/users'],
                ].map(([k, label, href]) => (
                  <li key={k} className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2">
                      {status.data?.checklist[k!] ? <Check className="size-4 text-success" /> : <span className="size-4 rounded-full border" />}
                      {label}
                    </span>
                    {!status.data?.checklist[k!] && (
                      <Link href={href!} className="text-xs font-medium text-primary hover:underline">
                        Set up
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <Button size="lg" className="w-full" onClick={finish} loading={progress.isPending}>
                Go to dashboard
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingInner() {
  const params = useSearchParams();
  const { data: me, isLoading } = useMe();
  const creating = params.get('create') === '1' || (me && !me.workspace);
  return (
    <div className="min-h-dvh bg-muted/30 px-4 py-8">
      <div className="mx-auto mb-8 flex max-w-2xl items-center justify-between">
        <Logo />
        {me?.workspace && (
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Skip setup
          </Link>
        )}
      </div>
      {isLoading || !me ? null : creating ? <CreateWorkspace /> : <Wizard me={me} />}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <React.Suspense>
      <OnboardingInner />
    </React.Suspense>
  );
}
