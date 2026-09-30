'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { dateTime, relative, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Notification } from '@/lib/types';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { FilterChips, Pagination, Toolbar } from '@/components/shared/data-table';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', page, filter],
    queryFn: () => api.get<Paginated<Notification> & { unread: number }>('/notifications', { page, pageSize: 25, unread: filter === 'unread' ? 'true' : undefined }),
    placeholderData: (p) => p,
  });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const markOne = useMutation({ mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <>
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} unread` : undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings/notifications">
                <Settings /> Preferences
              </Link>
            </Button>
            <Button variant="outline" onClick={() => markAll.mutate()} disabled={!data?.unread}>
              <CheckCheck /> Mark all read
            </Button>
          </>
        }
      />
      <Toolbar>
        <FilterChips value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: data?.unread }]} />
      </Toolbar>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState icon={Bell} title="You're all caught up" description="New leads, orders, escalations and alerts will appear here." />
        ) : (
          <ul className="divide-y">
            {data.items.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? '#'} onClick={() => !n.readAt && markOne.mutate(n.id)} className={cn('flex gap-3 px-5 py-3.5 hover:bg-muted/40', !n.readAt && 'bg-primary/[0.03]')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-label={n.readAt ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                      <Badge variant="outline" className="text-[10px]">{titleCase(n.type)}</Badge>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt} title={dateTime(n.createdAt)}>
                    {relative(n.createdAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} label="notifications" />}
      </Card>
    </>
  );
}
