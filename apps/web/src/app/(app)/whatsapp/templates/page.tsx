'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileStack, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { TEMPLATE_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardContent, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/shared/form';
import { useWaAccounts } from '@/features/whatsapp/accounts';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string | null;
  components: Array<{ type: string; text?: string; format?: string }>;
  updatedAt: string;
  account: { id: string; name: string };
}

export default function TemplatesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const accounts = useWaAccounts();
  const { data, isLoading } = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/whatsapp/templates') });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ accountId: '', name: '', language: 'en_US', category: 'UTILITY', header: '', body: '', footer: '' });
  const sync = useMutation({
    mutationFn: async () => {
      let total = 0;
      for (const a of accounts.data?.accounts ?? []) total += (await api.post<{ synced: number }>(`/whatsapp/accounts/${a.id}/sync-templates`)).synced;
      return total;
    },
    onSuccess: (n) => {
      toast.success(`Synced ${n} templates from Meta`);
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  const create = useMutation({
    mutationFn: () => api.post('/whatsapp/templates', { ...form, header: form.header || undefined, footer: form.footer || undefined }),
    onSuccess: () => {
      toast.success('Template submitted to Meta for review');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/whatsapp/templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }) });
  const hasAccounts = (accounts.data?.accounts.length ?? 0) > 0;
  const manage = can('whatsapp.manage');

  return (
    <>
      <PageHeader
        title="Message templates"
        description="Pre-approved messages required to contact customers outside the 24-hour customer service window."
        actions={
          manage &&
          hasAccounts && (
            <>
              <Button variant="outline" onClick={() => sync.mutate()} loading={sync.isPending}>
                <RefreshCw /> Sync from Meta
              </Button>
              <Button
                onClick={() => {
                  setForm((f) => ({ ...f, accountId: accounts.data!.accounts[0]!.id }));
                  setOpen(true);
                }}
              >
                <Plus /> New template
              </Button>
            </>
          )
        }
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={FileStack} title="No templates yet" description={hasAccounts ? 'Sync your approved templates from Meta or submit a new one.' : 'Connect a WhatsApp account first.'} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.language} · {t.category.toLowerCase()} · {t.account.name}
                    </p>
                  </div>
                  <StatusBadge map={TEMPLATE_STATUS} value={t.status} />
                </div>
                <div className="flex-1 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-line">
                  {t.components.find((c) => c.type === 'HEADER')?.text && <p className="mb-1 font-semibold">{t.components.find((c) => c.type === 'HEADER')!.text}</p>}
                  {t.components.find((c) => c.type === 'BODY')?.text ?? <span className="text-muted-foreground">No body text</span>}
                  {t.components.find((c) => c.type === 'FOOTER')?.text && <p className="mt-1 text-xs text-muted-foreground">{t.components.find((c) => c.type === 'FOOTER')!.text}</p>}
                </div>
                {t.rejectedReason && <Badge variant="destructive">Rejected: {t.rejectedReason}</Badge>}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Updated {relative(t.updatedAt)}</span>
                  {manage && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.name}`} onClick={async () => (await confirm({ title: `Delete template ${t.name}?`, description: 'The template is also deleted in Meta.', destructive: true, confirmLabel: 'Delete' })) && remove.mutate(t.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New message template</DialogTitle>
            <DialogDescription>Meta reviews templates, usually within minutes. Use {'{{1}}'}, {'{{2}}'} for variables.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormGrid>
              <Field label="Account" htmlFor="tp-account">
                <Select value={form.accountId} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                  <SelectTrigger id="tp-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.data?.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Category" htmlFor="tp-cat">
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger id="tp-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UTILITY">Utility (order updates)</SelectItem>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Name" htmlFor="tp-name" hint="lowercase_with_underscores">
                <Input id="tp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              </Field>
              <Field label="Language code" htmlFor="tp-lang">
                <Input id="tp-lang" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
              </Field>
            </FormGrid>
            <Field label="Header (optional)" htmlFor="tp-header">
              <Input id="tp-header" maxLength={60} value={form.header} onChange={(e) => setForm({ ...form, header: e.target.value })} />
            </Field>
            <Field label="Body" htmlFor="tp-body" required>
              <Textarea id="tp-body" rows={4} maxLength={1024} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hi {{1}}, your order {{2}} has shipped!" />
            </Field>
            <Field label="Footer (optional)" htmlFor="tp-footer">
              <Input id="tp-footer" maxLength={60} value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name || !form.body || !form.accountId}>
              Submit for review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
