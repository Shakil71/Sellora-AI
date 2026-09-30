'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, LogOut, Monitor, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader, Section } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Badge, Card, CardContent, Input, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';
import { useListState } from '@/hooks/use-list-state';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
interface Audit {
  id: string;
  action: string;
  actorName: string | null;
  actorType: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

function AccountSecurity() {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { me, refresh } = useSession();
  const [pw, setPw] = React.useState({ currentPassword: '', newPassword: '', logoutOtherSessions: true });
  const [setup, setSetup] = React.useState<{ qrCodeDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [disable, setDisable] = React.useState({ open: false, password: '', code: '' });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', pw),
    onSuccess: () => {
      toast.success('Password changed');
      setPw({ currentPassword: '', newPassword: '', logoutOtherSessions: true });
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const startSetup = useMutation({ mutationFn: () => api.post<{ qrCodeDataUrl: string; secret: string }>('/auth/2fa/setup'), onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api.post('/auth/2fa/enable', { code }),
    onSuccess: () => {
      toast.success('Two-factor authentication enabled');
      setSetup(null);
      setCode('');
      refresh();
    },
  });
  const disable2fa = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { password: disable.password, code: disable.code }),
    onSuccess: () => {
      toast.success('Two-factor authentication disabled');
      setDisable({ open: false, password: '', code: '' });
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const logoutAll = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  return (
    <Card>
      <CardContent>
        <Section title="Password" description="Use at least 8 characters with a letter and a number.">
          <div className="max-w-md space-y-3">
            <Field label="Current password" htmlFor="pw-current">
              <Input id="pw-current" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new">
              <Input id="pw-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={pw.logoutOtherSessions} onCheckedChange={(v) => setPw({ ...pw, logoutOtherSessions: v })} /> Sign out other devices
            </label>
            <Button onClick={() => changePassword.mutate()} loading={changePassword.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
              Update password
            </Button>
          </div>
        </Section>
        <Section title="Two-factor authentication" description="Protect your account with a code from an authenticator app.">
          {me.user.twoFactorEnabled ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">
                <ShieldCheck /> Enabled
              </Badge>
              <Button variant="outline" size="sm" onClick={() => setDisable({ open: true, password: '', code: '' })}>
                <ShieldOff /> Disable
              </Button>
            </div>
          ) : setup ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrCodeDataUrl} alt="Scan with your authenticator app" className="size-44 rounded-lg border bg-white p-2" />
              <div className="space-y-3">
                <p className="text-sm">Scan the QR code with Google Authenticator, 1Password or Authy, then enter the 6-digit code.</p>
                <p className="text-xs text-muted-foreground">
                  Can&apos;t scan? Enter this key: <code className="rounded bg-muted px-1 break-all">{setup.secret}</code>
                </p>
                <div className="flex gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="123456" className="w-32 tabular" aria-label="Verification code" />
                  <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length !== 6}>
                    Enable
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => startSetup.mutate()} loading={startSetup.isPending}>
              <Smartphone /> Set up two-factor
            </Button>
          )}
        </Section>
        <Section
          title="Active sessions"
          description="Devices signed in to your account."
          actions={
            <Button variant="outline" size="sm" onClick={async () => (await confirm({ title: 'Sign out of all devices?', description: 'Including this one.', confirmLabel: 'Sign out everywhere', destructive: true })) && logoutAll.mutate()}>
              <LogOut /> Sign out everywhere
            </Button>
          }
        >
          <ul className="divide-y rounded-lg border">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Monitor className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {device(s.userAgent)} {s.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ip ?? 'Unknown IP'} · active {relative(s.lastUsedAt)} · signed in {dateTime(s.createdAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </CardContent>
      <Dialog open={disable.open} onOpenChange={(o) => setDisable((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>Confirm with your password and a current code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Password" htmlFor="d-pw">
              <Input id="d-pw" type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
            </Field>
            <Field label="Code" htmlFor="d-code">
              <Input id="d-code" inputMode="numeric" value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisable((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => disable2fa.mutate()} loading={disable2fa.isPending} disabled={!disable.password || disable.code.length !== 6}>
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AuditLog() {
  const list = useListState();
  const [selected, setSelected] = React.useState<Audit | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['audit', list.query], queryFn: () => api.get<Paginated<Audit>>('/workspace/audit-logs', { ...list.query, pageSize: 25 }), placeholderData: (p) => p });
  return (
    <>
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search action, person or record ID" className="sm:w-96" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={setSelected}
        empty={{ icon: History, title: 'No audit entries' }}
        mobileCard={(a) => (
          <div>
            <p className="font-mono text-xs font-medium">{a.action}</p>
            <p className="text-xs text-muted-foreground">
              {a.actorName ?? a.actorType} · {relative(a.createdAt)}
            </p>
          </div>
        )}
        columns={[
          { key: 'when', header: 'When', cell: (a) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(a.createdAt)}</span> },
          { key: 'actor', header: 'Actor', cell: (a) => <span>{a.actorName ?? a.actorType.toLowerCase()}</span> },
          { key: 'action', header: 'Action', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
          { key: 'entity', header: 'Record', hideBelow: 'lg', cell: (a) => <span className="text-xs text-muted-foreground">{a.entityType ? `${a.entityType} ${a.entityId?.slice(0, 8) ?? ''}` : '—'}</span> },
          { key: 'ip', header: 'IP', hideBelow: 'md', cell: (a) => <span className="text-xs text-muted-foreground">{a.ip ?? '—'}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="entries" />}
      />
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{selected?.action}</DialogTitle>
            <DialogDescription>
              {selected?.actorName} · {dateTime(selected?.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify({ entityType: selected?.entityType, entityId: selected?.entityId, ip: selected?.ip, metadata: selected?.metadata }, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SecurityPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Settings' }, { label: 'Security' }]} title="Security" description="Your sign-in protection, active sessions and the workspace audit trail." />
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account security</TabsTrigger>
          {can('audit.view') && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        <TabsContent value="account">
          <AccountSecurity />
        </TabsContent>
        {can('audit.view') && (
          <TabsContent value="audit">
            <AuditLog />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
