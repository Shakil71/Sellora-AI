'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_GROUPS } from '@sellora/shared';
import { api } from '@/lib/api';
import { date, relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';

interface Key {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { me } = useSession();
  const mine = new Set(me.permissions);
  const { data, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<Key[]>('/api-keys') });
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [expires, setExpires] = React.useState('never');
  const [perms, setPerms] = React.useState<Set<string>>(new Set(['products.view', 'orders.view', 'orders.create', 'contacts.view', 'contacts.create']));
  const [created, setCreated] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ key: string }>('/api-keys', { name, permissions: [...perms], expiresInDays: expires === 'never' ? undefined : Number(expires) }),
    onSuccess: (r) => {
      setOpen(false);
      setCreated(r.key);
      setName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/api-keys/${id}`), onSuccess: () => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['api-keys'] }); } });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }, { label: 'API' }]}
        title="API keys"
        description="Connect your store, website or ERP with the Sellora AI REST API."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Create key
          </Button>
        }
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>Send the key in the <code className="rounded bg-muted px-1">x-api-key</code> header. Responses use {'{ success, data }'}.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`curl ${origin}/api/v1/products?search=watch \\
  -H "x-api-key: sk_live_..."`}</pre>
        </CardContent>
      </Card>
      <Card>
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.length ? (
          <EmptyState icon={KeyRound} title="No API keys" description="Keys are shown once when created and stored only as a secure hash." />
        ) : (
          <ul className="divide-y">
            {data.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <KeyRound className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {k.name}
                    {k.revokedAt ? <Badge variant="muted">Revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge variant="warning">Expired</Badge> : <Badge variant="success">Active</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{k.prefix}…</span> · {k.permissions.length} permissions · created {date(k.createdAt)} by {k.createdBy?.name ?? '—'} · {k.lastUsedAt ? `used ${relative(k.lastUsedAt)}` : 'never used'}
                    {k.expiresAt && ` · expires ${date(k.expiresAt)}`}
                  </p>
                </div>
                {!k.revokedAt && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${k.name}`} onClick={async () => (await confirm({ title: `Revoke ${k.name}?`, description: 'Applications using this key stop working immediately.', destructive: true, confirmLabel: 'Revoke' })) && revoke.mutate(k.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Grant only what the integration needs. You cannot grant permissions you don&apos;t have.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="k-name" required>
              <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website checkout" />
            </Field>
            <Field label="Expires" htmlFor="k-exp">
              <Select value={expires} onValueChange={setExpires}>
                <SelectTrigger id="k-exp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">In 30 days</SelectItem>
                  <SelectItem value="90">In 90 days</SelectItem>
                  <SelectItem value="365">In 1 year</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid max-h-[45vh] gap-3 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
            {PERMISSION_GROUPS.filter((g) => g.group !== 'Team' && g.group !== 'Settings').map((g) => (
              <fieldset key={g.group} className="rounded-lg border p-3">
                <legend className="px-1 text-sm font-semibold">{g.group}</legend>
                {g.permissions.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 py-0.5 text-sm">
                    <Checkbox
                      checked={perms.has(p.key)}
                      disabled={!mine.has(p.key)}
                      onCheckedChange={(c) =>
                        setPerms((s) => {
                          const n = new Set(s);
                          if (c) n.add(p.key);
                          else n.delete(p.key);
                          return n;
                        })
                      }
                    />
                    {p.description}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={name.trim().length < 2 || !perms.size}>
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> This is the only time the key is shown. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={created ?? ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" aria-label="Copy key" onClick={() => created && navigator.clipboard.writeText(created).then(() => toast.success('Copied'))}>
              <Copy />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
