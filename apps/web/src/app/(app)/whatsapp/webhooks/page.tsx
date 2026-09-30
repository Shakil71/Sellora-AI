'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Webhook } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PageHeader } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, Toolbar } from '@/components/shared/data-table';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { CopyField, useWaAccounts } from '@/features/whatsapp/accounts';
import { useListState } from '@/hooks/use-list-state';

interface WebhookEvent {
  id: string;
  eventType: string;
  status: string;
  signatureValid: boolean;
  error: string | null;
  payload: unknown;
  createdAt: string;
  processedAt: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'destructive' | 'info'> = { PROCESSED: 'success', IGNORED: 'muted', FAILED: 'destructive', RECEIVED: 'info' };

export default function WebhooksPage() {
  const accounts = useWaAccounts();
  const list = useListState<{ status?: string }>();
  const [selected, setSelected] = React.useState<WebhookEvent | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['webhook-events', list.query],
    queryFn: () => api.get<Paginated<WebhookEvent>>('/whatsapp/webhook-events', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader title="Webhooks" description="Events Meta delivers to Sellora AI. Every request is verified with your app secret before it is processed." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" /> Webhook endpoint
          </CardTitle>
          <CardDescription>Configure this URL in Meta for Developers → WhatsApp → Configuration and subscribe to the &quot;messages&quot; field.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {accounts.data && <CopyField label="Callback URL" value={accounts.data.webhookUrl} />}
          {accounts.data?.accounts[0] && <CopyField label={`Verify token (${accounts.data.accounts[0].name})`} value={accounts.data.accounts[0].verifyToken} secret />}
        </CardContent>
      </Card>
      <Toolbar>
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'PROCESSED', label: 'Processed' },
            { value: 'FAILED', label: 'Failed' },
            { value: 'IGNORED', label: 'Ignored' },
            { value: 'RECEIVED', label: 'Queued' },
          ]}
        />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={setSelected}
        empty={{ icon: Webhook, title: 'No webhook events yet', description: 'Events appear here as soon as Meta starts delivering messages and delivery receipts.' }}
        mobileCard={(e) => (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{e.eventType}</p>
              <p className="text-xs text-muted-foreground">{dateTime(e.createdAt)}</p>
            </div>
            <Badge variant={STATUS_VARIANT[e.status] ?? 'muted'}>{e.status.toLowerCase()}</Badge>
          </div>
        )}
        columns={[
          { key: 'time', header: 'Received', cell: (e) => <span className="text-muted-foreground">{dateTime(e.createdAt)}</span> },
          { key: 'type', header: 'Type', cell: (e) => <span className="font-medium">{e.eventType}</span> },
          { key: 'sig', header: 'Signature', hideBelow: 'md', cell: (e) => (e.signatureValid ? <Badge variant="success">Valid</Badge> : <Badge variant="destructive">Invalid</Badge>) },
          { key: 'status', header: 'Status', cell: (e) => <Badge variant={STATUS_VARIANT[e.status] ?? 'muted'}>{e.status.toLowerCase()}</Badge> },
          { key: 'error', header: 'Error', hideBelow: 'lg', cell: (e) => <span className="line-clamp-1 text-xs text-destructive">{e.error ?? ''}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="events" />}
      />
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Webhook payload</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(selected?.payload, null, 2)}</pre>
            <Button variant="outline" className="mt-3" onClick={() => navigator.clipboard.writeText(JSON.stringify(selected?.payload, null, 2))}>
              Copy JSON
            </Button>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
