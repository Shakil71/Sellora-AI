'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader } from '@/components/shared/page';
import { Badge, Card, CardContent, Checkbox, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}
type Catalog = Array<{ group: string; permissions: Array<{ key: string; description: string }> }>;

function RoleDialog({ role, open, onOpenChange, catalog, readOnly }: { role?: Role | null; open: boolean; onOpenChange: (o: boolean) => void; catalog: Catalog; readOnly: boolean }) {
  const qc = useQueryClient();
  const { me } = useSession();
  const mine = new Set(me.permissions);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [perms, setPerms] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setPerms(new Set(role?.permissions ?? ['dashboard.view']));
  }, [open, role]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || undefined, permissions: [...perms] };
      return role ? api.patch(`/roles/${role.id}`, body) : api.post('/roles', body);
    },
    onSuccess: () => {
      toast.success('Role saved');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
    },
  });
  const toggle = (k: string, on: boolean) => setPerms((p) => {
    const next = new Set(p);
    if (on) next.add(k);
    else next.delete(k);
    return next;
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? role?.name : role ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>{readOnly ? 'System roles are managed by Sellora AI and cannot be edited.' : 'You can only grant permissions you have yourself.'}</DialogDescription>
        </DialogHeader>
        {!readOnly && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name" htmlFor="r-name" required>
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="r-desc">
              <Textarea id="r-desc" rows={1} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid max-h-[50vh] gap-4 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
          {catalog.map((g) => (
            <fieldset key={g.group} className="rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">{g.group}</legend>
              <div className="space-y-2">
                {g.permissions.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm">
                    <Checkbox checked={perms.has(p.key)} disabled={readOnly || !mine.has(p.key)} onCheckedChange={(c) => toggle(p.key, Boolean(c))} className="mt-0.5" />
                    <span>
                      {p.description}
                      <span className="block font-mono text-[10px] text-muted-foreground">{p.key}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2}>
              Save role
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RolesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => api.get<Catalog>('/roles/permissions') });
  const [dialog, setDialog] = React.useState<{ open: boolean; role?: Role | null }>({ open: false });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/roles/${id}`), onSuccess: () => { toast.success('Role deleted'); qc.invalidateQueries({ queryKey: ['roles'] }); } });
  const manage = can('roles.manage');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }, { label: 'Roles' }]}
        title="Roles & permissions"
        description="Control access with built-in roles or create custom ones. Permissions are enforced by the API for every request."
        actions={
          manage && (
            <Button onClick={() => setDialog({ open: true, role: null })}>
              <Plus /> New role
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="size-4 text-primary" />
                    <p className="font-semibold">{r.name}</p>
                    {r.isSystem && (
                      <Badge variant="secondary">
                        <Lock /> System
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{r.memberCount} members</span>
                </div>
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{r.description ?? 'Custom role'}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{r.permissions.length} permissions</span>
                  <div className="flex">
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, role: r })}>
                      {r.isSystem || !manage ? 'View' : <><Pencil /> Edit</>}
                    </Button>
                    {!r.isSystem && manage && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={async () => (await confirm({ title: `Delete role ${r.name}?`, description: r.memberCount ? 'Reassign its members first.' : undefined, destructive: true, confirmLabel: 'Delete' })) && remove.mutate(r.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {catalog.data && <RoleDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} role={dialog.role} catalog={catalog.data} readOnly={Boolean(dialog.role?.isSystem) || !manage} />}
    </>
  );
}
