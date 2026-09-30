'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LogOut, Mail, MoreVertical, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader } from '@/components/shared/page';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
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
import { Field } from '@/components/shared/form';

interface Team {
  members: Array<{ id: string; status: string; joinedAt: string; user: { id: string; name: string; email: string; avatarUrl: string | null; lastLoginAt: string | null; twoFactorEnabled: boolean }; role: { id: string; key: string; name: string } }>;
  invitations: Array<{ id: string; email: string; role: { id: string; name: string } | null; expiresAt: string; createdAt: string }>;
}
interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, me } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['team'], queryFn: () => api.get<Team>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const [invite, setInvite] = React.useState({ open: false, email: '', roleId: '' });
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['team'] });

  const sendInvite = useMutation({
    mutationFn: () => api.post<{ emailSent: boolean; inviteUrl?: string }>('/users/invite', { email: invite.email, roleId: invite.roleId }),
    onSuccess: (r) => {
      setInvite({ open: false, email: '', roleId: '' });
      invalidate();
      if (r.emailSent) toast.success('Invitation sent');
      else setInviteLink(r.inviteUrl ?? null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { userId: string; roleId?: string; status?: string }) => api.patch(`/users/${v.userId}`, { roleId: v.roleId, status: v.status }),
    onSuccess: () => {
      toast.success('Member updated');
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: (userId: string) => api.delete(`/users/${userId}`), onSuccess: () => { toast.success('Member removed'); invalidate(); } });
  const signOut = useMutation({ mutationFn: (userId: string) => api.post(`/users/${userId}/sign-out`), onSuccess: () => toast.success('Member signed out of all devices') });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/users/invitations/${id}`), onSuccess: () => { toast.success('Invitation revoked'); invalidate(); } });
  const assignable = (roles.data ?? []).filter((r) => r.key !== 'OWNER' || me.role?.key === 'OWNER');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]}
        title="Team members"
        description="Invite teammates and control what they can access with roles."
        actions={
          can('users.create') && (
            <Button onClick={() => setInvite({ open: true, email: '', roleId: roles.data?.find((r) => r.key === 'AGENT')?.id ?? '' })}>
              <UserPlus /> Invite member
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="px-0 py-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <ul className="divide-y">
              {data?.members.map((m) => {
                const self = m.user.id === me.user.id;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <Avatar name={m.user.name} src={m.user.avatarUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {m.user.name} {self && <Badge variant="secondary">You</Badge>}
                        {m.user.twoFactorEnabled && <ShieldCheck className="size-3.5 text-success" aria-label="2FA enabled" />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.user.email} · {m.user.lastLoginAt ? `active ${relative(m.user.lastLoginAt)}` : 'never signed in'}
                      </p>
                    </div>
                    {m.status === 'DISABLED' && <Badge variant="muted">Disabled</Badge>}
                    {can('users.update') && !self ? (
                      <Select value={m.role.id} onValueChange={(v) => update.mutate({ userId: m.user.id, roleId: v })}>
                        <SelectTrigger size="sm" className="w-36" aria-label={`Role of ${m.user.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignable.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{m.role.name}</Badge>
                    )}
                    {!self && (can('users.update') || can('users.delete')) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.user.name}`}>
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {can('users.update') && (
                            <>
                              <DropdownMenuItem onSelect={() => update.mutate({ userId: m.user.id, status: m.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' })}>
                                {m.status === 'DISABLED' ? 'Enable access' : 'Disable access'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => signOut.mutate(m.user.id)}>
                                <LogOut /> Sign out everywhere
                              </DropdownMenuItem>
                            </>
                          )}
                          {can('users.delete') && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem destructive onSelect={async () => (await confirm({ title: `Remove ${m.user.name}?`, description: 'They lose access to this workspace. Their conversations become unassigned.', destructive: true, confirmLabel: 'Remove' })) && remove.mutate(m.user.id)}>
                                <Trash2 /> Remove from workspace
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {!!data?.invitations.length && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <ul className="divide-y border-t">
              {data.invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.role?.name} · expires in {relative(i.expiresAt).replace(' ago', '')}
                    </p>
                  </div>
                  {can('users.create') && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Revoke invitation for ${i.email}`} onClick={() => revoke.mutate(i.id)}>
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={invite.open} onOpenChange={(o) => setInvite((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They receive an email with a link to join this workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Email" htmlFor="inv-email">
              <Input id="inv-email" type="email" autoFocus value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <Select value={invite.roleId} onValueChange={(v) => setInvite({ ...invite, roleId: v })}>
                <SelectTrigger id="inv-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {invite.roleId && <p className="text-xs text-muted-foreground">{roles.data?.find((r) => r.id === invite.roleId)?.description}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvite((s) => ({ ...s, open: false }))}>
              Cancel
            </Button>
            <Button onClick={() => sendInvite.mutate()} loading={sendInvite.isPending} disabled={!invite.email || !invite.roleId}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share the invitation link</DialogTitle>
            <DialogDescription>Email delivery is not configured on this server, so share this one-time link with your teammate securely. It expires in 7 days.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteLink ?? ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => inviteLink && navigator.clipboard.writeText(inviteLink).then(() => toast.success('Copied'))}>
              <Copy />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setInviteLink(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="mt-4 text-xs text-muted-foreground">
        Seats count active members and pending invitations against your plan.
      </p>
    </>
  );
}
