'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Bot, FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { Badge, Card, CardContent, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';

interface KB {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  updatedAt: string;
  agents: Array<{ id: string; name: string }>;
}

export default function KnowledgePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const { data, isLoading } = useQuery({ queryKey: ['knowledge-bases'], queryFn: () => api.get<KB[]>('/ai/knowledge-bases') });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/ai/knowledge-bases', { name, description: description || null }),
    onSuccess: (kb) => {
      toast.success('Knowledge base created');
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
      router.push(`/ai/knowledge/${kb.id}`);
    },
  });
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Documents, FAQs and web pages your AI agents search before answering. Retrieval-augmented and scoped to your workspace."
        actions={
          can('ai.knowledge.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New knowledge base
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={BookOpen} title="No knowledge yet" description="Add your shipping policy, return policy, FAQs and product guides so the AI answers accurately." action={can('ai.knowledge.manage') ? <Button onClick={() => setOpen(true)}><Plus /> Create knowledge base</Button> : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((kb) => (
            <Link key={kb.id} href={`/ai/knowledge/${kb.id}`} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BookOpen className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{kb.name}</p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{kb.description ?? 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="size-3.5" /> {kb.documentCount} documents
                    </span>
                    <span>{kb.chunkCount} chunks</span>
                    <span>Updated {relative(kb.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {kb.agents.length ? (
                      kb.agents.map((a) => (
                        <Badge key={a.id} variant="ai">
                          <Bot /> {a.name}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="warning">Not used by any agent</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New knowledge base</DialogTitle>
            <DialogDescription>Group related documents, e.g. “Store policies” or “Product manuals”.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" htmlFor="kb-name" required>
              <Input id="kb-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="kb-desc">
              <Textarea id="kb-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
