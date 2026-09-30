'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader, PageSkeleton } from '@/components/shared/page';
import { Card, CardContent, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

type Pref = { type: string; inApp: boolean; email: boolean };

const LABELS: Record<string, { title: string; description: string }> = {
  NEW_LEAD: { title: 'New lead', description: 'A lead is created or assigned to your team.' },
  NEW_ORDER: { title: 'New order', description: 'An order is placed by a customer, the AI or your team.' },
  PAYMENT_RECEIVED: { title: 'Payment received', description: 'An order becomes fully paid.' },
  LOW_INVENTORY: { title: 'Low inventory', description: 'A product reaches its low-stock threshold.' },
  NEW_MESSAGE: { title: 'New message', description: 'A customer writes in a conversation assigned to you.' },
  ASSIGNMENT: { title: 'Assignments', description: 'A conversation, lead or task is assigned to you.' },
  WORKFLOW_FAILURE: { title: 'Workflow failures', description: 'An automation run fails after retries.' },
  AI_ESCALATION: { title: 'AI escalations', description: 'The AI agent hands a conversation to a human.' },
  SYSTEM: { title: 'Workflow notifications', description: 'Messages sent by your automations.' },
};

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<Pref[]>('/notifications/preferences') });
  const [prefs, setPrefs] = React.useState<Pref[]>([]);
  React.useEffect(() => data && setPrefs(data), [data]);
  const save = useMutation({
    mutationFn: () => api.put('/notifications/preferences', { items: prefs }),
    onSuccess: () => {
      toast.success('Preferences saved');
      qc.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
  });
  if (isLoading) return <PageSkeleton />;
  const set = (type: string, patch: Partial<Pref>) => setPrefs((p) => p.map((x) => (x.type === type ? { ...x, ...patch } : x)));
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Settings' }, { label: 'Notifications' }]} title="Notifications" description="Choose what you hear about in this workspace. Email requires SMTP to be configured on the server." />
      <Card>
        <CardContent className="px-0 py-0">
          <div className="hidden grid-cols-[1fr_80px_80px] border-b px-5 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Event</span>
            <span className="text-center">In-app</span>
            <span className="text-center">Email</span>
          </div>
          <ul className="divide-y">
            {prefs.map((p) => (
              <li key={p.type} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 sm:grid-cols-[1fr_80px_80px]">
                <div>
                  <p className="text-sm font-medium">{LABELS[p.type]?.title ?? p.type}</p>
                  <p className="text-xs text-muted-foreground">{LABELS[p.type]?.description}</p>
                </div>
                <div className="flex justify-center">
                  <Switch checked={p.inApp} onCheckedChange={(v) => set(p.type, { inApp: v })} aria-label={`${LABELS[p.type]?.title} in-app`} />
                </div>
                <div className="flex justify-center">
                  <Switch checked={p.email} onCheckedChange={(v) => set(p.type, { email: v })} aria-label={`${LABELS[p.type]?.title} email`} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save preferences
        </Button>
      </div>
    </>
  );
}
