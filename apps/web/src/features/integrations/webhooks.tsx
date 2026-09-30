'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  History,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { WEBHOOK_EVENTS } from '@sellora/shared';
import { api, type Paginated } from '@/lib/api';
import { relative } from '@/lib/format';
import { WEBHOOK_DELIVERY_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, StatusBadge } from '@/components/shared/page';
import { Field } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Switch,
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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/overlays';
import { CodeBlock } from './common';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
  consecutiveFailures: number;
  secret?: string;
}

interface Delivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: unknown;
}

const SELECTABLE = WEBHOOK_EVENTS.filter((e) => e.key !== 'webhook.test');

function EndpointDialog({
  open,
  onOpenChange,
  endpoint,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  endpoint?: Endpoint | null;
  onCreated: (e: Endpoint) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [all, setAll] = React.useState(true);
  const [events, setEvents] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setUrl(endpoint?.url ?? 'https://');
    setDescription(endpoint?.description ?? '');
    setAll(!endpoint || endpoint.events.includes('*'));
    setEvents(
      endpoint && !endpoint.events.includes('*')
        ? endpoint.events
        : ['order.created', 'lead.created'],
    );
  }, [open, endpoint]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        url: url.trim(),
        description: description.trim() || null,
        events: all ? ['*'] : events,
      };
      return endpoint
        ? api.patch<Endpoint>(`/integrations/webhooks/${endpoint.id}`, body)
        : api.post<Endpoint>('/integrations/webhooks', body);
    },
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['integrations', 'webhooks'] });
      onOpenChange(false);
      if (!endpoint) onCreated(e);
      else toast.success('Webhook updated');
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{endpoint ? 'Edit webhook' : 'Add webhook endpoint'}</DialogTitle>
          <DialogDescription>
            Sellora sends a signed HTTPS POST to this URL whenever a selected event happens.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label="Endpoint URL"
            htmlFor="wh-url"
            required
            hint="Must be a public HTTPS address, for example https://yourshop.com/webhooks/sellora."
          >
            <Input
              id="wh-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </Field>
          <Field label="Description" htmlFor="wh-desc">
            <Input
              id="wh-desc"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Sync orders to our ERP"
            />
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="wh-all">Send all events</Label>
                <p className="text-xs text-muted-foreground">
                  Includes events added in future versions.
                </p>
              </div>
              <Switch id="wh-all" checked={all} onCheckedChange={setAll} />
            </div>
            {!all && (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {SELECTABLE.map((e) => (
                  <label key={e.key} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={events.includes(e.key)}
                      onCheckedChange={(c) =>
                        setEvents((list) =>
                          c ? [...list, e.key] : list.filter((k) => k !== e.key),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      {e.label}
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {e.key}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!/^https?:\/\/.+\..+/.test(url.trim()) || (!all && !events.length)}
          >
            {endpoint ? 'Save changes' : 'Add endpoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({
  secret,
  onClose,
}: {
  secret: { value: string; created?: boolean } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(secret)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{secret?.created ? 'Webhook added' : 'Signing secret'}</DialogTitle>
          <DialogDescription>
            Use this secret on your server to verify that requests come from Sellora. Keep it
            private.
          </DialogDescription>
        </DialogHeader>
        {secret && <CodeBlock code={secret.value} label="Signing secret" />}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesSheet({
  endpoint,
  onOpenChange,
}: {
  endpoint: Endpoint | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['integrations', 'webhooks', 'deliveries', endpoint?.id],
    queryFn: () =>
      api.get<Paginated<Delivery>>(`/integrations/webhooks/${endpoint!.id}/deliveries`, {
        pageSize: 50,
      }),
    enabled: Boolean(endpoint),
    refetchInterval: 5000,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/webhooks/deliveries/${id}/redeliver`),
    onSuccess: () => {
      toast.success('Redelivery queued');
      qc.invalidateQueries({ queryKey: ['integrations', 'webhooks'] });
    },
  });
  return (
    <Sheet open={Boolean(endpoint)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Recent deliveries</SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">
            {endpoint?.url}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data?.items.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No deliveries yet. Use “Send test event” to try the endpoint.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.items.map((d) => (
                <li key={d.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge map={WEBHOOK_DELIVERY_STATUS} value={d.status} />
                    <code className="font-mono text-xs">{d.event}</code>
                    <span className="text-xs text-muted-foreground">{relative(d.createdAt)}</span>
                    <span className="tabular ml-auto text-xs text-muted-foreground">
                      {d.responseStatus ? `HTTP ${d.responseStatus}` : '—'} · {d.attempts} attempt
                      {d.attempts === 1 ? '' : 's'}
                      {d.durationMs !== null ? ` · ${d.durationMs} ms` : ''}
                    </span>
                  </div>
                  {d.error && <p className="mt-1.5 text-xs text-destructive">{d.error}</p>}
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded((x) => (x === d.id ? null : d.id))}
                    >
                      <Eye /> {expanded === d.id ? 'Hide payload' : 'Payload'}
                    </Button>
                    {can('integrations.manage') && d.status !== 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => redeliver.mutate(d.id)}
                        loading={redeliver.isPending && redeliver.variables === d.id}
                      >
                        <RotateCcw /> Redeliver
                      </Button>
                    )}
                  </div>
                  {expanded === d.id && (
                    <CodeBlock className="mt-2" code={JSON.stringify(d.payload, null, 2)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function WebhookSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('integrations.manage');
  const { data, isLoading } = useQuery({
    queryKey: ['integrations', 'webhooks'],
    queryFn: () => api.get<Endpoint[]>('/integrations/webhooks'),
    refetchInterval: 15000,
  });
  const [dialog, setDialog] = React.useState<{ open: boolean; endpoint?: Endpoint | null }>({
    open: false,
  });
  const [secret, setSecret] = React.useState<{ value: string; created?: boolean } | null>(null);
  const [logFor, setLogFor] = React.useState<Endpoint | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations', 'webhooks'] });
  const toggle = useMutation({
    mutationFn: (e: Endpoint) =>
      api.patch(`/integrations/webhooks/${e.id}`, { isActive: !e.isActive }),
    onSuccess: () => invalidate(),
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/webhooks/${id}/test`),
    onSuccess: () => {
      toast.success('Test event sent — check the delivery log');
      setTimeout(invalidate, 1500);
    },
  });
  const reveal = useMutation({
    mutationFn: (id: string) => api.post<{ secret: string }>(`/integrations/webhooks/${id}/secret`),
    onSuccess: (r) => setSecret({ value: r.secret }),
  });
  const roll = useMutation({
    mutationFn: (id: string) =>
      api.post<{ secret: string }>(`/integrations/webhooks/${id}/roll-secret`),
    onSuccess: (r) => {
      setSecret({ value: r.secret });
      toast.success('New secret generated — update your server');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook deleted');
      invalidate();
    },
  });
  const label = (key: string) => WEBHOOK_EVENTS.find((e) => e.key === key)?.label ?? key;

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;

  return (
    <div className="space-y-4">
      {manage && data && data.length > 0 && (
        <Button onClick={() => setDialog({ open: true })}>
          <Plus /> Add endpoint
        </Button>
      )}
      {!data?.length ? (
        <Card>
          <EmptyState
            icon={Send}
            title="Send Sellora events to your own systems"
            description="Notify your website, ERP, accounting or delivery software the moment an order is created, paid or cancelled, a lead arrives or stock runs low."
            action={
              manage ? (
                <Button onClick={() => setDialog({ open: true })}>
                  <Plus /> Add endpoint
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        data.map((e) => (
          <Card key={e.id} className={e.isActive ? '' : 'opacity-75'}>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm break-all">
                  {e.url}
                  {!e.isActive && <Badge variant="muted">Off</Badge>}
                  {e.isActive && e.consecutiveFailures > 0 && (
                    <Badge variant="warning">{e.consecutiveFailures} failed in a row</Badge>
                  )}
                </CardTitle>
                <CardDescription className="mt-1">
                  {e.description ? `${e.description} · ` : ''}
                  {e.lastDeliveryAt
                    ? `Last delivery ${relative(e.lastDeliveryAt)}${e.lastStatus ? ` (HTTP ${e.lastStatus})` : ''}`
                    : 'No deliveries yet'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {manage && (
                  <Switch
                    checked={e.isActive}
                    onCheckedChange={() => toggle.mutate(e)}
                    aria-label={e.isActive ? 'Turn off endpoint' : 'Turn on endpoint'}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Webhook actions">
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setLogFor(e)}>
                      <History /> Delivery log
                    </DropdownMenuItem>
                    {manage && (
                      <>
                        <DropdownMenuItem onSelect={() => test.mutate(e.id)}>
                          <Send /> Send test event
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ open: true, endpoint: e })}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => reveal.mutate(e.id)}>
                          <Eye /> Show signing secret
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={async () =>
                            (await confirm({
                              title: 'Generate a new secret?',
                              description:
                                'The old secret stops working immediately. Update your server with the new one.',
                              confirmLabel: 'Generate',
                            })) && roll.mutate(e.id)
                          }
                        >
                          <KeyRound /> Roll secret
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={async () =>
                            (await confirm({
                              title: 'Delete this webhook?',
                              description: 'Events will no longer be sent to this URL.',
                              destructive: true,
                              confirmLabel: 'Delete',
                            })) && remove.mutate(e.id)
                          }
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {e.lastError && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                  Last error: {e.lastError}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {e.events.includes('*') ? (
                  <Badge variant="secondary">All events</Badge>
                ) : (
                  e.events.map((k) => (
                    <Badge key={k} variant="outline">
                      {label(k)}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Verify signatures on your server</CardTitle>
            <CardDescription className="mt-1">
              Each request carries{' '}
              <code className="rounded bg-muted px-1">X-Sellora-Signature: t=timestamp,v1=hex</code>
              . Compute HMAC-SHA256 of <code className="rounded bg-muted px-1">timestamp.body</code>{' '}
              with your secret and compare. Reply with any 2xx status within 10 seconds; failures
              are retried for about an hour.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <CodeBlock
            label="Node.js (Express)"
            code={`import crypto from 'node:crypto';

app.post('/webhooks/sellora', express.raw({ type: 'application/json' }), (req, res) => {
  const [t, v1] = req.get('X-Sellora-Signature').split(',').map((p) => p.split('=')[1]);
  const expected = crypto.createHmac('sha256', process.env.SELLORA_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  if (!fresh || !crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body);
  // event.event = 'order.created', event.data.order, event.data.customer ...
  res.sendStatus(200);
});`}
          />
          <CodeBlock
            label="PHP"
            code={`<?php
$body = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_X_SELLORA_SIGNATURE']), $sig);
$expected = hash_hmac('sha256', $sig['t'] . '.' . $body, getenv('SELLORA_WEBHOOK_SECRET'));
if (abs(time() - (int) $sig['t']) > 300 || !hash_equals($expected, $sig['v1'])) {
    http_response_code(401);
    exit;
}
$event = json_decode($body, true);
// $event['event'] === 'order.created', $event['data']['order'] ...
http_response_code(200);`}
          />
        </CardContent>
      </Card>

      <EndpointDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        endpoint={dialog.endpoint}
        onCreated={(e) => e.secret && setSecret({ value: e.secret, created: true })}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <DeliveriesSheet endpoint={logFor} onOpenChange={(o) => !o && setLogFor(null)} />
    </div>
  );
}
