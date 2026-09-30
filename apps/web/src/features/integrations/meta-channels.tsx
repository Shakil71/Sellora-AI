'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { CHANNEL_CONNECTION_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, StatusBadge } from '@/components/shared/page';
import { Field, FormGrid } from '@/components/shared/form';
import { AgentSelect } from '@/components/shared/pickers';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
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
} from '@/components/ui/overlays';
import { CopyField } from '@/features/whatsapp/accounts';
import { Steps, type ChannelConnection } from './common';

type MetaType = 'MESSENGER' | 'INSTAGRAM';

const COPY: Record<MetaType, { label: string; noun: string; empty: string; docs: string }> = {
  MESSENGER: {
    label: 'Facebook Messenger',
    noun: 'Facebook Page',
    empty:
      'Customers who message your Facebook Page are answered by your AI agent and appear in your inbox next to WhatsApp and website chats.',
    docs: 'https://developers.facebook.com/docs/messenger-platform/get-started',
  },
  INSTAGRAM: {
    label: 'Instagram',
    noun: 'Instagram account',
    empty:
      'Direct messages to your Instagram professional account are answered by your AI agent and appear in your inbox.',
    docs: 'https://developers.facebook.com/docs/messenger-platform/instagram',
  },
};

function ConnectDialog({
  type,
  open,
  onOpenChange,
  connection,
}: {
  type: MetaType;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection?: ChannelConnection | null;
}) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    name: '',
    pageId: '',
    instagramAccountId: '',
    accessToken: '',
    appSecret: '',
    defaultAgentId: null as string | null,
  });
  React.useEffect(() => {
    if (open)
      setV({
        name: connection?.name ?? (type === 'INSTAGRAM' ? 'Instagram' : 'Facebook Page'),
        pageId: connection?.pageId ?? '',
        instagramAccountId: type === 'INSTAGRAM' ? (connection?.externalId ?? '') : '',
        accessToken: '',
        appSecret: '',
        defaultAgentId: connection?.defaultAgentId ?? null,
      });
  }, [open, connection, type]);
  const save = useMutation({
    mutationFn: () =>
      connection
        ? api.patch<ChannelConnection>(`/integrations/channels/${connection.id}`, {
            name: v.name,
            defaultAgentId: v.defaultAgentId,
            ...(v.accessToken ? { accessToken: v.accessToken } : {}),
            ...(v.appSecret ? { appSecret: v.appSecret } : {}),
          })
        : api.post<ChannelConnection>('/integrations/channels/meta', {
            type,
            name: v.name,
            pageId: v.pageId,
            ...(type === 'INSTAGRAM' ? { instagramAccountId: v.instagramAccountId } : {}),
            accessToken: v.accessToken,
            appSecret: v.appSecret || undefined,
            defaultAgentId: v.defaultAgentId,
          }),
    onSuccess: (c) => {
      if (c.status === 'ERROR') toast.warning(c.lastError ?? 'Connected with a warning');
      else
        toast.success(
          connection
            ? 'Connection updated'
            : `${COPY[type].label} connected — finish the webhook step below`,
        );
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onOpenChange(false);
    },
  });
  const digits = (s: string) => s.replace(/\D/g, '');
  const valid = connection
    ? v.name.trim().length >= 2
    : v.name.trim().length >= 2 &&
      v.pageId.length >= 5 &&
      v.accessToken.length >= 20 &&
      (type === 'MESSENGER' || v.instagramAccountId.length >= 5);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {connection ? `Edit ${COPY[type].label}` : `Connect ${COPY[type].label}`}
          </DialogTitle>
          <DialogDescription>
            Values come from your Meta app (developers.facebook.com). Tokens and secrets are
            encrypted before they are stored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Display name" htmlFor="mc-name" required>
            <Input
              id="mc-name"
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </Field>
          <FormGrid>
            <Field
              label="Facebook Page ID"
              htmlFor="mc-page"
              required={!connection}
              hint="Page → About → Page transparency, or Meta Business Suite settings."
            >
              <Input
                id="mc-page"
                inputMode="numeric"
                disabled={!!connection}
                value={v.pageId}
                onChange={(e) => setV({ ...v, pageId: digits(e.target.value) })}
              />
            </Field>
            {type === 'INSTAGRAM' && (
              <Field
                label="Instagram account ID"
                htmlFor="mc-ig"
                required={!connection}
                hint="The Instagram professional account linked to this Page."
              >
                <Input
                  id="mc-ig"
                  inputMode="numeric"
                  disabled={!!connection}
                  value={v.instagramAccountId}
                  onChange={(e) => setV({ ...v, instagramAccountId: digits(e.target.value) })}
                />
              </Field>
            )}
          </FormGrid>
          <Field
            label="Page access token"
            htmlFor="mc-token"
            required={!connection}
            hint={
              connection
                ? 'Leave empty to keep the current token.'
                : 'A long-lived Page token with pages_messaging' +
                  (type === 'INSTAGRAM' ? ' and instagram_manage_messages' : '') +
                  ' permission.'
            }
          >
            <Input
              id="mc-token"
              type="password"
              autoComplete="off"
              value={v.accessToken}
              onChange={(e) => setV({ ...v, accessToken: e.target.value.trim() })}
            />
          </Field>
          <Field
            label="App secret"
            htmlFor="mc-secret"
            hint={
              connection?.hasAppSecret
                ? 'Configured. Leave empty to keep it.'
                : 'Required to verify that webhooks really come from Meta (App settings → Basic).'
            }
          >
            <Input
              id="mc-secret"
              type="password"
              autoComplete="off"
              value={v.appSecret}
              onChange={(e) => setV({ ...v, appSecret: e.target.value.trim() })}
            />
          </Field>
          <Field
            label="AI agent for new conversations"
            htmlFor="mc-agent"
            hint="Without an agent, conversations go straight to your team."
          >
            <AgentSelect
              id="mc-agent"
              value={v.defaultAgentId}
              onChange={(id) => setV({ ...v, defaultAgentId: id })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {connection ? 'Save changes' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MetaChannelSettings({ type, icon }: { type: MetaType; icon: LucideIcon }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('integrations.manage');
  const copy = COPY[type];
  const { data, isLoading } = useQuery({
    queryKey: ['integrations', 'channels', type],
    queryFn: () => api.get<ChannelConnection[]>('/integrations/channels', { type }),
  });
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    connection?: ChannelConnection | null;
  }>({ open: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const verify = useMutation({
    mutationFn: (id: string) => api.post<ChannelConnection>(`/integrations/channels/${id}/verify`),
    onSuccess: (c) => {
      if (c.status === 'CONNECTED') toast.success('Connection verified');
      else toast.error(c.lastError ?? 'Could not verify the connection');
      invalidate();
    },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/channels/${id}/rotate-verify-token`),
    onSuccess: () => {
      toast.success('Verify token rotated. Update it in your Meta app.');
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (c: ChannelConnection) =>
      api.patch(`/integrations/channels/${c.id}`, { enabled: c.status === 'DISABLED' }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/channels/${id}`),
    onSuccess: () => {
      toast.success('Disconnected');
      invalidate();
    },
  });
  const Icon = icon;

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-4">
      {manage && data && data.length > 0 && (
        <Button onClick={() => setDialog({ open: true })}>
          <Plus /> Connect another {copy.noun}
        </Button>
      )}
      {!data?.length ? (
        <Card>
          <EmptyState
            icon={Icon}
            title={`Connect ${copy.label}`}
            description={copy.empty}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {manage && (
                  <Button onClick={() => setDialog({ open: true })}>
                    <Plus /> Connect {copy.noun}
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <a href={copy.docs} target="_blank" rel="noreferrer">
                    Meta setup guide <ExternalLink />
                  </a>
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        data.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {c.name} <StatusBadge map={CHANNEL_CONNECTION_STATUS} value={c.status} />
                </CardTitle>
                <CardDescription className="mt-1">
                  {String((c.settings as { accountLabel?: string }).accountLabel ?? '')}
                  {(c.settings as { accountLabel?: string }).accountLabel ? ' · ' : ''}
                  Page ID {c.pageId} · {c.counts?.conversations ?? 0} conversations
                </CardDescription>
              </div>
              {manage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Connection actions">
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setDialog({ open: true, connection: c })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => verify.mutate(c.id)}>
                      <RefreshCw /> Test connection
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => rotate.mutate(c.id)}>
                      <KeyRound /> Rotate verify token
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => toggle.mutate(c)}>
                      <Power /> {c.status === 'DISABLED' ? 'Turn on' : 'Turn off'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={async () =>
                        (await confirm({
                          title: `Disconnect ${c.name}?`,
                          description:
                            'Conversations stay in your inbox, but new messages will no longer arrive or be sent.',
                          destructive: true,
                          confirmLabel: 'Disconnect',
                        })) && remove.mutate(c.id)
                      }
                    >
                      <Trash2 /> Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              {c.lastError && c.status === 'ERROR' && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {c.lastError}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <CopyField label="Callback URL" value={c.webhookUrl ?? ''} />
                <CopyField label="Verify token" value={c.verifyToken ?? ''} secret />
              </div>
              <Steps
                items={[
                  <>
                    In your Meta app open{' '}
                    <strong>
                      {type === 'INSTAGRAM'
                        ? 'Instagram → Webhooks'
                        : 'Messenger → Settings → Webhooks'}
                    </strong>{' '}
                    and paste the callback URL and verify token above.
                  </>,
                  <>
                    Subscribe to <code className="rounded bg-muted px-1">messages</code>,{' '}
                    <code className="rounded bg-muted px-1">messaging_postbacks</code>
                    {type === 'MESSENGER' && (
                      <>
                        , <code className="rounded bg-muted px-1">message_deliveries</code> and{' '}
                        <code className="rounded bg-muted px-1">message_reads</code>
                      </>
                    )}
                    .
                  </>,
                  'Send a test message to your ' +
                    copy.noun +
                    ' — it appears in the inbox within seconds.',
                ]}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Webhook signatures:{' '}
                  {c.hasAppSecret ? (
                    <span className="text-success">verified with app secret</span>
                  ) : (
                    <span className="text-destructive">app secret missing</span>
                  )}
                </span>
                {c.lastVerifiedAt && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-success" /> Checked{' '}
                    {relative(c.lastVerifiedAt)}
                  </span>
                )}
                <span>
                  Replies are allowed within 24 hours of the customer’s last message (Meta policy).
                </span>
              </div>
            </CardContent>
          </Card>
        ))
      )}
      <ConnectDialog
        type={type}
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        connection={dialog.connection}
      />
    </div>
  );
}
