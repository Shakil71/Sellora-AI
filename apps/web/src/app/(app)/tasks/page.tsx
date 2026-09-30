'use client';

import * as React from 'react';
import Link from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { date } from '@/lib/format';
import { PRIORITY, TASK_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared/page';
import { FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Avatar, Card, Checkbox, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/shared/form';
import { CustomerPicker, MemberSelect } from '@/components/shared/pickers';
import { useListState, useOpenFromQuery } from '@/hooks/use-list-state';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedUserId: string | null;
  customerId: string | null;
  assignedUser: { id: string; name: string; avatarUrl: string | null } | null;
  customer: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  order: { id: string; number: string } | null;
}

interface Values {
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  assignedUserId: string | null;
  customerId: string | null;
}

function TaskDialog({ open, onOpenChange, task }: { open: boolean; onOpenChange: (o: boolean) => void; task?: Task | null }) {
  const qc = useQueryClient();
  const form = useForm<Values>();
  React.useEffect(() => {
    if (open)
      form.reset({
        title: task?.title ?? '',
        description: task?.description ?? '',
        status: task?.status ?? 'TODO',
        priority: task?.priority ?? 'MEDIUM',
        dueDate: task?.dueDate?.slice(0, 10) ?? '',
        assignedUserId: task?.assignedUserId ?? null,
        customerId: task?.customerId ?? null,
      });
  }, [open, task, form]);
  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { ...v, description: v.description || null, dueDate: v.dueDate ? new Date(`${v.dueDate}T17:00:00`).toISOString() : null };
      return task ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body);
    },
    onSuccess: () => {
      toast.success(task ? 'Task updated' : 'Task created');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
  });
  const selectField = (name: 'status' | 'priority', map: Record<string, { label: string }>) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select value={field.value} onValueChange={field.onChange}>
          <SelectTrigger id={`t-${name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(map).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <form id="task-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <Field label="Title" htmlFor="t-title" required error={form.formState.errors.title?.message}>
            <Input id="t-title" autoFocus {...form.register('title', { required: 'Title is required' })} />
          </Field>
          <FormGrid>
            <Field label="Status" htmlFor="t-status">
              {selectField('status', TASK_STATUS)}
            </Field>
            <Field label="Priority" htmlFor="t-priority">
              {selectField('priority', PRIORITY)}
            </Field>
            <Field label="Due date" htmlFor="t-due">
              <Input id="t-due" type="date" {...form.register('dueDate')} />
            </Field>
            <Field label="Assignee" htmlFor="t-assignee">
              <Controller control={form.control} name="assignedUserId" render={({ field }) => <MemberSelect id="t-assignee" value={field.value} onChange={field.onChange} />} />
            </Field>
            <Field label="Customer" htmlFor="t-customer" className="sm:col-span-2">
              <Controller control={form.control} name="customerId" render={({ field }) => <CustomerPicker id="t-customer" value={field.value} selectedLabel={task?.customer?.name} onChange={(v) => field.onChange(v)} />} />
            </Field>
          </FormGrid>
          <Field label="Description" htmlFor="t-desc">
            <Textarea id="t-desc" rows={3} {...form.register('description')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={save.isPending}>
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TasksPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const [dialog, setDialog] = React.useState<{ open: boolean; task?: Task | null }>({ open: false });
  const openNew = React.useCallback((o: boolean) => setDialog({ open: o }), []);
  useOpenFromQuery(openNew);
  const list = useListState<{ view?: string }>({ view: 'open' });
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', list.query],
    queryFn: () => api.get<Paginated<Task>>('/tasks', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const toggle = useMutation({
    mutationFn: (t: Task) => api.patch(`/tasks/${t.id}`, { status: t.status === 'DONE' ? 'TODO' : 'DONE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/tasks/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const manage = can('tasks.manage');

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups for your team, including tasks created by the AI agent and automations."
        actions={
          manage && (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus /> New task
            </Button>
          )
        }
      />
      <Toolbar>
        <FilterChips
          value={list.filters.view ?? 'open'}
          onChange={(v) => list.setFilter('view', v)}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'mine', label: 'Assigned to me' },
            { value: 'today', label: 'Due today' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'all', label: 'All' },
          ]}
        />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search tasks" className="sm:ml-auto" />
      </Toolbar>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState icon={CalendarCheck} title="No tasks here" description="Tasks keep follow-ups from slipping. Create one or let automations create them for you." action={manage ? <Button onClick={() => setDialog({ open: true })}><Plus /> New task</Button> : undefined} />
        ) : (
          <ul className="divide-y">
            {data.items.map((t) => {
              const overdue = t.dueDate && t.status !== 'DONE' && new Date(t.dueDate) < new Date();
              return (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
                  <Checkbox className="mt-0.5" checked={t.status === 'DONE'} disabled={!manage} onCheckedChange={() => toggle.mutate(t)} aria-label={`Mark "${t.title}" ${t.status === 'DONE' ? 'not done' : 'done'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', t.status === 'DONE' && 'text-muted-foreground line-through')}>{t.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <StatusBadge map={PRIORITY} value={t.priority} />
                      {t.status !== 'TODO' && t.status !== 'DONE' && <StatusBadge map={TASK_STATUS} value={t.status} />}
                      {t.dueDate && <span className={cn(overdue && 'font-medium text-destructive')}>Due {date(t.dueDate)}</span>}
                      {t.customer && <Link href={`/customers/${t.customer.id}`} className="hover:text-foreground">{t.customer.name}</Link>}
                      {t.lead && <Link href={`/leads/${t.lead.id}`} className="hover:text-foreground">Lead: {t.lead.name}</Link>}
                      {t.order && <Link href={`/orders/${t.order.id}`} className="hover:text-foreground">{t.order.number}</Link>}
                    </div>
                  </div>
                  {t.assignedUser && <Avatar name={t.assignedUser.name} src={t.assignedUser.avatarUrl} size={26} />}
                  {manage && (
                    <div className="flex">
                      <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, task: t })} aria-label="Edit task">
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete task" onClick={async () => (await confirm({ title: 'Delete this task?', destructive: true, confirmLabel: 'Delete' })) && remove.mutate(t.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="tasks" />}
      </Card>
      <TaskDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} task={dialog.task} />
    </>
  );
}
