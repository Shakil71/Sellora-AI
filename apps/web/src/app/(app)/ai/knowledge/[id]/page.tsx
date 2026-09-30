'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Globe, Loader2, RefreshCw, Search, Trash2, Type, Upload, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { fileSize, number, relative } from '@/lib/format';
import { DOCUMENT_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/shared/form';

interface Doc {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  error: string | null;
  chunkCount: number;
  embeddedCount: number;
  tokenCount: number;
  processedAt: string | null;
  createdAt: string;
}
interface KbDetail {
  id: string;
  name: string;
  description: string | null;
  documents: Doc[];
  aiConfigured: boolean;
}

export default function KnowledgeBasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('ai.knowledge.manage');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState({ title: '', content: '' });
  const [url, setUrl] = React.useState('');
  const [query, setQuery] = React.useState('');
  const { data: kb, isLoading, error, refetch } = useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: () => api.get<KbDetail>(`/ai/knowledge-bases/${id}`),
    refetchInterval: (q) => (q.state.data?.documents.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING') ? 3000 : false),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['knowledge-base', id] });
    qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload(`/ai/knowledge-bases/${id}/documents/file`, form);
    },
    onSuccess: () => {
      toast.success('Uploaded — processing started');
      invalidate();
    },
    onSettled: () => fileRef.current && (fileRef.current.value = ''),
  });
  const addText = useMutation({
    mutationFn: () => api.post(`/ai/knowledge-bases/${id}/documents/text`, text),
    onSuccess: () => {
      toast.success('Added — processing started');
      setText({ title: '', content: '' });
      invalidate();
    },
  });
  const addUrl = useMutation({
    mutationFn: () => api.post(`/ai/knowledge-bases/${id}/documents/url`, { url }),
    onSuccess: () => {
      toast.success('Page queued for import');
      setUrl('');
      invalidate();
    },
  });
  const reindex = useMutation({ mutationFn: (docId: string) => api.post(`/ai/documents/${docId}/reindex`), onSuccess: invalidate });
  const reindexAll = useMutation({ mutationFn: () => api.post(`/ai/knowledge-bases/${id}/reindex`), onSuccess: () => { toast.success('Re-indexing started'); invalidate(); } });
  const remove = useMutation({ mutationFn: (docId: string) => api.delete(`/ai/documents/${docId}`), onSuccess: () => { toast.success('Document deleted'); invalidate(); } });
  const removeKb = useMutation({ mutationFn: () => api.delete(`/ai/knowledge-bases/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-bases'] }); router.push('/ai/knowledge'); } });
  const search = useMutation({ mutationFn: () => api.post<Array<{ id: string; content: string; documentTitle: string; score: number }>>(`/ai/knowledge-bases/${id}/search`, { query }), meta: { silent: true } });

  if (isLoading) return <PageSkeleton />;
  if (error || !kb) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Knowledge base', href: '/ai/knowledge' }, { label: kb.name }]}
        title={kb.name}
        description={kb.description ?? undefined}
        actions={
          manage && (
            <>
              <Button variant="outline" onClick={() => reindexAll.mutate()} loading={reindexAll.isPending} disabled={!kb.documents.length}>
                <RefreshCw /> Re-index all
              </Button>
              <Button variant="ghost" size="icon" aria-label="Delete knowledge base" onClick={async () => (await confirm({ title: `Delete ${kb.name}?`, description: 'All documents and their indexed content are deleted.', destructive: true, confirmLabel: 'Delete' })) && removeKb.mutate()}>
                <Trash2 />
              </Button>
            </>
          )
        }
      />
      {!kb.aiConfigured && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>AI is not configured, so documents are indexed for keyword search only. Add an API key in Settings → AI and re-index to enable semantic search.</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Documents ({kb.documents.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!kb.documents.length ? (
              <EmptyState icon={FileText} title="No documents yet" description="Upload files, paste text or import a web page." />
            ) : (
              <ul className="divide-y border-t">
                {kb.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{d.sourceType === 'WEBSITE' ? <Globe className="size-4" /> : d.sourceType === 'TEXT' ? <Type className="size-4" /> : <FileText className="size-4" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.sourceType.toLowerCase()} · {d.status === 'READY' ? `${d.chunkCount} chunks · ${number(d.tokenCount)} tokens${d.embeddedCount ? ' · semantic' : ' · keyword'}` : relative(d.createdAt)}
                        {d.sizeBytes ? ` · ${fileSize(d.sizeBytes)}` : ''}
                      </p>
                      {d.error && <p className={d.status === 'FAILED' ? 'mt-1 text-xs text-destructive' : 'mt-1 text-xs text-warning'}>{d.error}</p>}
                    </div>
                    <span className="flex items-center gap-1">
                      {(d.status === 'PROCESSING' || d.status === 'PENDING') && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                      <StatusBadge map={DOCUMENT_STATUS} value={d.status} />
                    </span>
                    {manage && (
                      <span className="flex">
                        <Button variant="ghost" size="icon-sm" aria-label="Re-index" onClick={() => reindex.mutate(d.id)}>
                          <RefreshCw />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Delete document" onClick={async () => (await confirm({ title: `Delete "${d.title}"?`, destructive: true, confirmLabel: 'Delete' })) && remove.mutate(d.id)}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {manage && (
            <Card>
              <CardHeader>
                <CardTitle>Add knowledge</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="file">
                  <TabsList className="w-full">
                    <TabsTrigger value="file" className="flex-1">
                      <Upload /> File
                    </TabsTrigger>
                    <TabsTrigger value="text" className="flex-1">
                      <Type /> Text
                    </TabsTrigger>
                    <TabsTrigger value="url" className="flex-1">
                      <Globe /> Web page
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="file" className="space-y-3">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={upload.isPending}
                      className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground transition hover:border-primary hover:text-primary"
                    >
                      {upload.isPending ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
                      {upload.isPending ? 'Uploading…' : 'Choose a PDF, DOCX, TXT or Markdown file'}
                    </button>
                    <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
                  </TabsContent>
                  <TabsContent value="text" className="space-y-3">
                    <Field label="Title" htmlFor="kt-title">
                      <Input id="kt-title" value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} placeholder="e.g. Return policy" />
                    </Field>
                    <Field label="Content" htmlFor="kt-content">
                      <Textarea id="kt-content" rows={6} value={text.content} onChange={(e) => setText({ ...text, content: e.target.value })} />
                    </Field>
                    <Button className="w-full" onClick={() => addText.mutate()} loading={addText.isPending} disabled={!text.title || text.content.length < 20}>
                      Add text
                    </Button>
                  </TabsContent>
                  <TabsContent value="url" className="space-y-3">
                    <Field label="Public page URL" htmlFor="ku-url" hint="Only public http(s) pages are imported.">
                      <Input id="ku-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/faq" />
                    </Field>
                    <Button className="w-full" onClick={() => addUrl.mutate()} loading={addUrl.isPending} disabled={!/^https?:\/\//.test(url)}>
                      Import page
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="size-4" /> Test retrieval
              </CardTitle>
              <CardDescription>See which passages the AI would read for a question.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query.length > 1 && search.mutate()} placeholder="How long does shipping take?" aria-label="Test question" />
                <Button variant="outline" size="icon" onClick={() => search.mutate()} disabled={query.length < 2} loading={search.isPending} aria-label="Search">
                  {!search.isPending && <Search />}
                </Button>
              </div>
              {search.isError && <p className="text-sm text-destructive">{errorMessage(search.error)}</p>}
              {search.data && !search.data.length && <p className="text-sm text-muted-foreground">No relevant passages found.</p>}
              {search.data?.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{r.documentTitle}</span>
                    <Badge variant="secondary">{(r.score * 100).toFixed(0)}%</Badge>
                  </div>
                  <p className="line-clamp-4 text-muted-foreground">{r.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
