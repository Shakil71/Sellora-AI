'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Globe2,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState } from '@/components/shared/page';
import { Field, FormGrid, TagInput } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  Input,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import { CopyField } from '@/features/whatsapp/accounts';
import { Steps } from './common';

interface GatewayField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  later?: boolean;
  placeholder?: string;
  help?: string;
  type?: 'text' | 'select' | 'textarea';
  options?: Array<{ value: string; label: string }>;
  default?: string;
}

interface Gateway {
  key: string;
  label: string;
  description: string;
  regions: string[];
  countries: string[];
  currencies: string[];
  fields: GatewayField[];
  setupSteps: string[];
  docsUrl?: string;
  webhook: boolean;
  online: boolean;
}

interface Preset {
  key: string;
  name: string;
  regions: string[];
  countries: string[];
  instructions: string;
}

interface Catalog {
  gateways: Gateway[];
  presets: Preset[];
}

export interface PaymentMethodView {
  id: string;
  provider: string;
  providerLabel: string;
  methodKey: string;
  name: string;
  instructions: string | null;
  countries: string[];
  currencies: string[];
  isActive: boolean;
  lastError: string | null;
  online: boolean;
  webhookUrl: string | null;
  values: Record<string, string>;
  secretsSet: string[];
  missingSetup: string[];
}

/** What the owner picked in the catalog. */
type Choice =
  | { kind: 'gateway'; gateway: Gateway }
  | { kind: 'manual'; name: string; methodKey?: string; instructions: string; countries: string[] };

const CUSTOM_MANUAL: Choice = {
  kind: 'manual',
  name: '',
  instructions: '',
  countries: [],
};

function usePaymentCatalog() {
  return useQuery({
    queryKey: ['payment-methods', 'catalog'],
    queryFn: () => api.get<Catalog>('/payment-methods/catalog'),
    staleTime: 10 * 60_000,
  });
}

function CatalogTile({
  icon: Icon,
  title,
  description,
  badges,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badges: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="line-clamp-3 text-xs text-muted-foreground">{description}</p>
      <div className="mt-auto flex flex-wrap gap-1">
        {badges.map((b) => (
          <Badge key={b} variant="muted">
            {b}
          </Badge>
        ))}
      </div>
    </button>
  );
}

function PickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (c: Choice) => void;
}) {
  const { data, isLoading } = usePaymentCatalog();
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const match = (...parts: string[]) => parts.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  const gateways = (data?.gateways ?? []).filter(
    (g) => g.key !== 'manual' && match(g.label, g.description, ...g.regions),
  );
  const presets = (data?.presets ?? []).filter((p) => match(p.name, ...p.regions));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
          <DialogDescription>
            Connect an online gateway so customers can pay by link, or add a local method such as
            bKash, UPI or bank transfer that you confirm yourself.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or country, e.g. Bangladesh"
            className="pl-9"
            aria-label="Search payment methods"
          />
        </div>
        {isLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="space-y-6">
            {gateways.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <Zap className="size-3.5" /> Online gateways: customers pay by link, payments
                  confirm automatically
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {gateways.map((g) => (
                    <CatalogTile
                      key={g.key}
                      icon={g.key === 'custom_link' ? Link2 : Globe2}
                      title={g.label}
                      description={g.description}
                      badges={g.regions.slice(0, 3)}
                      onClick={() => onPick({ kind: 'gateway', gateway: g })}
                    />
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <Wallet className="size-3.5" /> Manual and local methods: you confirm each payment
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map((p) => (
                  <CatalogTile
                    key={p.key}
                    icon={Banknote}
                    title={p.name}
                    description={p.instructions.split('\n')[0]!}
                    badges={p.regions.slice(0, 2)}
                    onClick={() =>
                      onPick({
                        kind: 'manual',
                        name: p.name,
                        methodKey: p.key,
                        instructions: p.instructions,
                        countries: p.countries,
                      })
                    }
                  />
                ))}
                {match('custom other method') && (
                  <CatalogTile
                    icon={Plus}
                    title="Other method"
                    description="Any payment method not listed: name it and write the instructions."
                    badges={['Custom']}
                    onClick={() => onPick(CUSTOM_MANUAL)}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MethodDialog({
  open,
  onOpenChange,
  choice,
  method,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  choice: Choice | null;
  method: PaymentMethodView | null;
  onSaved: (m: PaymentMethodView, created: boolean) => void;
}) {
  const qc = useQueryClient();
  const catalog = usePaymentCatalog();
  const gateway: Gateway | undefined =
    choice?.kind === 'gateway'
      ? choice.gateway
      : method
        ? catalog.data?.gateways.find((g) => g.key === method.provider)
        : catalog.data?.gateways.find((g) => g.key === 'manual');
  const isManual = (choice?.kind === 'manual' || method?.provider === 'manual') ?? false;
  const [name, setName] = React.useState('');
  const [instructions, setInstructions] = React.useState('');
  const [countries, setCountries] = React.useState<string[]>([]);
  const [currencies, setCurrencies] = React.useState<string[]>([]);
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    if (method) {
      setName(method.name);
      setInstructions(method.instructions ?? '');
      setCountries(method.countries);
      setCurrencies(method.currencies);
      setValues({ ...method.values });
    } else if (choice?.kind === 'manual') {
      setName(choice.name);
      setInstructions(choice.instructions);
      setCountries(choice.countries);
      setCurrencies([]);
      setValues({});
    } else if (choice?.kind === 'gateway') {
      setName(choice.gateway.label);
      setInstructions('');
      setCountries(choice.gateway.countries);
      setCurrencies([]);
      setValues(
        Object.fromEntries(
          choice.gateway.fields.filter((f) => f.default).map((f) => [f.key, f.default!]),
        ),
      );
    }
  }, [open, choice, method]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        instructions: isManual ? instructions.trim() : instructions.trim() || null,
        countries: countries.map((c) => c.toUpperCase()),
        currencies: currencies.map((c) => c.toUpperCase()),
        values,
      };
      if (method) return api.patch<PaymentMethodView>(`/payment-methods/${method.id}`, body);
      const preset = choice?.kind === 'manual' ? choice.methodKey : undefined;
      return api.post<PaymentMethodView>('/payment-methods', {
        ...body,
        provider: choice?.kind === 'gateway' ? choice.gateway.key : 'manual',
        ...(preset ? { methodKey: preset.replace(/-/g, '_') } : {}),
      });
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['payment-methods'] });
      qc.invalidateQueries({ queryKey: ['integrations', 'overview'] });
      onOpenChange(false);
      onSaved(m, !method);
    },
  });

  const fields = gateway?.fields ?? [];
  const missingRequired = fields.some(
    (f) => f.required && !f.later && !values[f.key]?.trim() && !method?.secretsSet.includes(f.key),
  );
  const valid =
    name.trim().length >= 2 && (!isManual || instructions.trim().length > 0) && !missingRequired;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {method ? `Edit ${method.name}` : `Set up ${gateway?.label ?? 'payment method'}`}
          </DialogTitle>
          <DialogDescription>
            {isManual
              ? 'Customers get these instructions with their order. You mark the payment as received.'
              : gateway?.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name customers see" htmlFor="pm-name" required>
            <Input
              id="pm-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {isManual && (
            <Field
              label="How to pay"
              htmlFor="pm-instructions"
              required
              hint="Use {order_number} and {amount} and they are filled in for each order."
            >
              <Textarea
                id="pm-instructions"
                rows={6}
                maxLength={1000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
          )}
          {fields.map((f) => {
            const saved = method?.secretsSet.includes(f.key);
            return (
              <Field
                key={f.key}
                label={
                  <>
                    {f.label}
                    {f.later && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        (add after registering the webhook)
                      </span>
                    )}
                  </>
                }
                htmlFor={`pm-${f.key}`}
                required={f.required && !f.later}
                hint={saved ? 'Saved. Leave blank to keep it, or type a new value.' : f.help}
              >
                {f.type === 'select' ? (
                  <Select
                    value={values[f.key] ?? f.default ?? ''}
                    onValueChange={(v) => setValues({ ...values, [f.key]: v })}
                  >
                    <SelectTrigger id={`pm-${f.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options?.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`pm-${f.key}`}
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={values[f.key] ?? ''}
                    placeholder={saved ? '••••••••' : f.placeholder}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className={f.secret ? 'font-mono' : undefined}
                  />
                )}
              </Field>
            );
          })}
          <FormGrid>
            <Field
              label="Offer only in these countries"
              htmlFor="pm-countries"
              hint="2-letter codes such as BD, IN, US. Empty means everywhere."
            >
              <TagInput id="pm-countries" value={countries} onChange={setCountries} max={60} />
            </Field>
            <Field
              label="Accept only these currencies"
              htmlFor="pm-currencies"
              hint={
                gateway?.currencies.length
                  ? `Defaults to ${gateway.currencies.join(', ')}.`
                  : 'Codes such as USD, BDT. Empty means any.'
              }
            >
              <TagInput id="pm-currencies" value={currencies} onChange={setCurrencies} max={20} />
            </Field>
          </FormGrid>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {method ? 'Save changes' : 'Add payment method'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupGuide({ method, onClose }: { method: PaymentMethodView | null; onClose: () => void }) {
  const { data } = usePaymentCatalog();
  const gateway = data?.gateways.find((g) => g.key === method?.provider);
  return (
    <Dialog open={Boolean(method)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{method?.name} added: finish the webhook</DialogTitle>
          <DialogDescription>
            So Sellora can mark orders as paid the moment a customer pays, register this address
            with {method?.providerLabel}.
          </DialogDescription>
        </DialogHeader>
        {method?.webhookUrl && <CopyField label="Webhook URL" value={method.webhookUrl} />}
        {gateway && <Steps items={gateway.setupSteps} />}
        {method && method.missingSetup.length > 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            When you have the {method.missingSetup.join(' and ').toLowerCase()}, open{' '}
            <strong>Edit</strong> on this method and paste it in. Payment links stay disabled until
            then.
          </p>
        )}
        <DialogFooter>
          {gateway?.docsUrl && (
            <Button variant="outline" asChild>
              <a href={gateway.docsUrl} target="_blank" rel="noreferrer">
                Gateway docs
              </a>
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentMethodSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('integrations.manage');
  const { data, isLoading } = useQuery({
    queryKey: ['payment-methods', 'list'],
    queryFn: () => api.get<PaymentMethodView[]>('/payment-methods'),
  });
  const [picker, setPicker] = React.useState(false);
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    choice: Choice | null;
    method: PaymentMethodView | null;
  }>({ open: false, choice: null, method: null });
  const [guide, setGuide] = React.useState<PaymentMethodView | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payment-methods'] });
    qc.invalidateQueries({ queryKey: ['integrations', 'overview'] });
  };
  const toggle = useMutation({
    mutationFn: (m: PaymentMethodView) =>
      api.patch(`/payment-methods/${m.id}`, { isActive: !m.isActive }),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; error: string | null }>(`/payment-methods/${id}/test`),
    onSuccess: (r) => {
      if (r.ok) toast.success('Credentials accepted by the gateway');
      else toast.error(r.error ?? 'The gateway rejected these credentials');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/payment-methods/${id}`),
    onSuccess: () => {
      toast.success('Payment method removed');
      invalidate();
    },
  });

  return (
    <div className="space-y-4">
      {manage && (
        <div className="flex justify-end">
          <Button onClick={() => setPicker(true)}>
            <Plus /> Add payment method
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No payment methods yet"
            description="Add the ways your customers pay: Stripe or PayPal for international cards, SSLCOMMERZ, Razorpay or Paystack for local payments, or manual methods like bKash, UPI and bank transfer."
            action={
              manage ? (
                <Button onClick={() => setPicker(true)}>
                  <Plus /> Add payment method
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((m) => (
            <Card key={m.id} className={m.isActive ? undefined : 'opacity-70'}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {m.online ? <Zap className="size-5" /> : <Banknote className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.providerLabel} · {m.online ? 'Online, pays by link' : 'You confirm payments'}
                    </p>
                  </div>
                  {manage && (
                    <>
                      <Switch
                        checked={m.isActive}
                        onCheckedChange={() => toggle.mutate(m)}
                        aria-label={`${m.name} enabled`}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="More actions">
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() => setDialog({ open: true, choice: null, method: m })}
                          >
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          {m.online && (
                            <DropdownMenuItem onSelect={() => test.mutate(m.id)}>
                              <RefreshCw /> Test credentials
                            </DropdownMenuItem>
                          )}
                          {m.webhookUrl && (
                            <DropdownMenuItem onSelect={() => setGuide(m)}>
                              <Link2 /> Webhook setup
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={async () => {
                              if (
                                await confirm({
                                  title: `Remove ${m.name}?`,
                                  description:
                                    'Customers will no longer see this method. Existing payments are kept. Unpaid links created with it stop confirming automatically.',
                                  confirmLabel: 'Remove',
                                  destructive: true,
                                })
                              )
                                remove.mutate(m.id);
                            }}
                          >
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.countries.length ? (
                    m.countries.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="muted">All countries</Badge>
                  )}
                  {m.currencies.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
                {m.instructions && (
                  <p className="line-clamp-3 text-xs whitespace-pre-line text-muted-foreground">
                    {m.instructions}
                  </p>
                )}
                {m.lastError ? (
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {m.lastError}
                  </p>
                ) : m.missingSetup.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setGuide(m)}
                    className="flex items-start gap-1.5 text-left text-xs text-warning-foreground underline-offset-2 hover:underline"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    Finish setup: add the {m.missingSetup.join(' and ').toLowerCase()} to start
                    taking payments.
                  </button>
                ) : m.online ? (
                  <p className="flex items-center gap-1.5 text-xs text-success">
                    <CheckCircle2 className="size-3.5" /> Ready to take payments
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PickerDialog
        open={picker}
        onOpenChange={setPicker}
        onPick={(choice) => {
          setPicker(false);
          setDialog({ open: true, choice, method: null });
        }}
      />
      <MethodDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        choice={dialog.choice}
        method={dialog.method}
        onSaved={(m, created) => {
          if (created && m.webhookUrl) setGuide(m);
          else toast.success(created ? 'Payment method added' : 'Payment method updated');
        }}
      />
      <SetupGuide method={guide} onClose={() => setGuide(null)} />
    </div>
  );
}
