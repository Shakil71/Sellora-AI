'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, MoreVertical, Plus, RefreshCw, Server, Smartphone, Trash2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { WA_ACCOUNT_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/shared/form';
import { AgentSelect } from '@/components/shared/pickers';

export interface WaAccount {
  id: string;
  name: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  verifyToken: string;
  status: string;
  qualityRating: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
  isDefault: boolean;
  defaultAgentId: string | null;
  defaultAgent: { id: string; name: string } | null;
  accessTokenHint: string | null;
  hasAppSecret: boolean;
}
export interface AccountsResponse {
  accounts: WaAccount[];
  webhookUrl: string;
  environment: { hasPhoneNumberId: boolean; hasBusinessAccountId: boolean; hasAccessToken: boolean; hasAppSecret: boolean; hasVerifyToken: boolean };
}

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [show, setShow] = React.useState(!secret);
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={show ? value : '•'.repeat(Math.min(24, value.length))} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        {secret && (
          <Button variant="outline" size="sm" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => toast.success('Copied'));
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function ConnectDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: WaAccount | null }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ name: '', phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '', defaultAgentId: null as string | null, isDefault: false });
  React.useEffect(() => {
    if (open)
      setV({
        name: account?.name ?? 'Main WhatsApp number',
        phoneNumberId: account?.phoneNumberId ?? '',
        wabaId: account?.wabaId ?? '',
        accessToken: '',
        appSecret: '',
        defaultAgentId: account?.defaultAgentId ?? null,
        isDefault: account?.isDefault ?? false,
      });
  }, [open, account]);
  const save = useMutation({
    mutationFn: () =>
      account
        ? api.patch(`/whatsapp/accounts/${account.id}`, {
            name: v.name,
            ...(v.accessToken ? { accessToken: v.accessToken } : {}),
            ...(v.appSecret ? { appSecret: v.appSecret } : {}),
            defaultAgentId: v.defaultAgentId,
            isDefault: v.isDefault,
          })
        : api.post('/whatsapp/accounts', { ...v, appSecret: v.appSecret || undefined }),
    onSuccess: () => {
      toast.success(account ? 'Account updated' : 'WhatsApp account added — check its connection status below');
      qc.invalidateQueries({ queryKey: ['wa-accounts'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit WhatsApp account' : 'Connect WhatsApp Cloud API'}</DialogTitle>
          <DialogDescription>
            Find these values in Meta for Developers → your app → WhatsApp → API Setup. Tokens are encrypted before they are stored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Display name" htmlFor="wa-name">
            <Input id="wa-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <FormGrid>
            <Field label="Phone number ID" htmlFor="wa-pnid" required>
              <Input id="wa-pnid" inputMode="numeric" disabled={!!account} value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value.trim() })} />
            </Field>
            <Field label="WhatsApp Business Account ID" htmlFor="wa-waba" required>
              <Input id="wa-waba" inputMode="numeric" disabled={!!account} value={v.wabaId} onChange={(e) => setV({ ...v, wabaId: e.target.value.trim() })} />
            </Field>
          </FormGrid>
          <Field label="Permanent access token" htmlFor="wa-token" required={!account} hint={account ? `Current: ${account.accessTokenHint ?? '—'}. Leave empty to keep it.` : 'Use a System User token with whatsapp_business_messaging permission.'}>
            <Input id="wa-token" type="password" autoComplete="off" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value.trim() })} />
          </Field>
          <Field label="App secret" htmlFor="wa-secret" hint={account?.hasAppSecret ? 'Configured. Leave empty to keep it.' : 'Required to verify webhook signatures (App settings → Basic).'}>
            <Input id="wa-secret" type="password" autoComplete="off" value={v.appSecret} onChange={(e) => setV({ ...v, appSecret: e.target.value.trim() })} />
          </Field>
          <Field label="AI agent for new conversations" htmlFor="wa-agent" hint="Without an agent, conversations go straight to your team.">
            <AgentSelect id="wa-agent" value={v.defaultAgentId} onChange={(id) => setV({ ...v, defaultAgentId: id })} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="wa-default">Default account</Label>
            <Switch id="wa-default" checked={v.isDefault} onCheckedChange={(c) => setV({ ...v, isDefault: c })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.phoneNumberId || !v.wabaId || (!account && v.accessToken.length < 20)}>
            {account ? 'Save changes' : 'Connect account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useWaAccounts() {
  return useQuery({ queryKey: ['wa-accounts'], queryFn: () => api.get<AccountsResponse>('/whatsapp/accounts') });
}

export function WhatsAppAccounts() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('whatsapp.manage');
  const { data, isLoading } = useWaAccounts();
  const [dialog, setDialog] = React.useState<{ open: boolean; account?: WaAccount | null }>({ open: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['wa-accounts'] });
  const verify = useMutation({
    mutationFn: (id: string) => api.post<WaAccount>(`/whatsapp/accounts/${id}/verify`),
    onSuccess: (a) => {
      if (a.status === 'CONNECTED') toast.success('Connection verified');
      else toast.error(a.lastError ?? 'Could not verify the connection');
      invalidate();
    },
  });
  const rotate = useMutation({ mutationFn: (id: string) => api.post(`/whatsapp/accounts/${id}/rotate-verify-token`), onSuccess: () => { toast.success('Verify token rotated. Update it in Meta.'); invalidate(); } });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/whatsapp/accounts/${id}`), onSuccess: () => { toast.success('Account removed'); invalidate(); } });
  const importEnv = useMutation({ mutationFn: () => api.post('/whatsapp/accounts/import-env'), onSuccess: () => { toast.success('Imported from server configuration'); invalidate(); } });
  const envReady = data && data.environment.hasPhoneNumberId && data.environment.hasAccessToken && data.environment.hasBusinessAccountId;

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      {manage && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog({ open: true })}>
            <Plus /> Connect number
          </Button>
          {envReady && !data!.accounts.length && (
            <Button variant="outline" onClick={() => importEnv.mutate()} loading={importEnv.isPending}>
              <Server /> Import from server config
            </Button>
          )}
        </div>
      )}
      {!data?.accounts.length ? (
        <Card>
          <EmptyState
            icon={Smartphone}
            title="WhatsApp is not connected"
            description="Connect a WhatsApp Cloud API number to receive customer messages. Until then, use a test conversation from the inbox to try your AI agent."
            action={
              <Button variant="outline" asChild>
                <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">
                  Meta setup guide <ExternalLink />
                </a>
              </Button>
            }
          />
        </Card>
      ) : (
        data.accounts.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <div className="min-w-0 flex-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {a.name}
                  <StatusBadge map={WA_ACCOUNT_STATUS} value={a.status} />
                  {a.isDefault && <Badge variant="secondary">Default</Badge>}
                </CardTitle>
                <CardDescription className="mt-1">
                  {a.displayPhoneNumber ?? `Phone number ID ${a.phoneNumberId}`}
                  {a.verifiedName && ` · ${a.verifiedName}`}
                  {a.qualityRating && ` · Quality ${a.qualityRating}`}
                </CardDescription>
              </div>
              {manage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Account actions">
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setDialog({ open: true, account: a })}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => verify.mutate(a.id)}>
                      <RefreshCw /> Test connection
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => rotate.mutate(a.id)}>
                      <KeyRound /> Rotate verify token
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={async () => (await confirm({ title: `Disconnect ${a.name}?`, description: 'Conversations stay in your inbox, but you will not receive or send new WhatsApp messages from this number.', destructive: true, confirmLabel: 'Disconnect' })) && remove.mutate(a.id)}>
                      <Trash2 /> Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {a.lastError && a.status === 'ERROR' && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{a.lastError}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <CopyField label="Callback URL" value={data.webhookUrl} />
                <CopyField label="Verify token" value={a.verifyToken} secret />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>AI agent: {a.defaultAgent?.name ?? 'none (human inbox)'}</span>
                <span>Webhook signatures: {a.hasAppSecret ? <span className="text-success">verified with app secret</span> : <span className="text-destructive">app secret missing</span>}</span>
                {a.lastVerifiedAt && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="size-3 text-success" /> Verified {relative(a.lastVerifiedAt)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                In Meta: WhatsApp → Configuration → Webhook, paste the callback URL and verify token, then subscribe to the <code className="rounded bg-muted px-1">messages</code> field.
              </p>
            </CardContent>
          </Card>
        ))
      )}
      <ConnectDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} account={dialog.account} />
    </div>
  );
}
