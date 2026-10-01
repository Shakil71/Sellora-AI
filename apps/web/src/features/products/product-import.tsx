'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  PackageCheck,
  Search,
  Store,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { Field, FormGrid } from '@/components/shared/form';
import { Badge, Card, CardContent, Checkbox, Input, Progress, Switch } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { ProductThumb } from './product-thumb';

type SourceKind = 'website' | 'woocommerce' | 'feed' | 'file';

interface PreviewProduct {
  key: string;
  sku: string;
  skuFromSource: boolean;
  name: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  image: string | null;
  imageCount: number;
  category: string | null;
  attributes: Record<string, string>;
  stock: number | null;
  inStock: boolean | null;
  exists: boolean;
}

interface Preview {
  importId: string;
  platform: string;
  currency: string | null;
  workspaceCurrency: string;
  total: number;
  summary: { new: number; existing: number; withImages: number; generatedSku: number; categories: number };
  warnings: string[];
  products: PreviewProduct[];
}

interface RunResult {
  results: Array<{ key: string; sku: string; name: string; outcome: 'created' | 'updated' | 'skipped' | 'failed'; error?: string }>;
  limitReached: boolean;
}

const SOURCES: Array<{ key: SourceKind; icon: LucideIcon; title: string; text: string; badge?: string }> = [
  {
    key: 'website',
    icon: Globe,
    title: 'Store or website link',
    text: 'Paste your shop address. Shopify and WooCommerce stores are detected automatically; other sites are read from their product pages.',
    badge: 'Easiest',
  },
  { key: 'woocommerce', icon: Store, title: 'WooCommerce API keys', text: 'Import everything from WooCommerce, including stock quantities, with read-only API keys.' },
  { key: 'feed', icon: Database, title: 'Product feed or API', text: 'Any web address that returns your products as JSON, XML (Google Merchant) or CSV, with an optional API key.' },
  {
    key: 'file',
    icon: FileSpreadsheet,
    title: 'Upload a file',
    text: 'Excel (.xlsx), CSV, Word (.docx), PDF, JSON or XML. Columns are matched by name, and tables or price lines inside documents are understood.',
  },
];

const SAMPLE_CSV = 'name,sku,price,sale_price,category,description,image_url,stock,brand,color,size,shape\nUrban Runner,UR-BLK-42,59.00,49.00,Shoes,Light running shoe,https://example.com/shoe.jpg,12,Acme,Black,42,\nCeramic Vase,VASE-1,30.00,,Home,Hand made vase,https://example.com/vase.jpg,5,Craft,White,,Round\n';

const BATCH = 25;
const PAGE_SIZE = 25;

function SourcePicker({ onPick }: { onPick: (s: SourceKind) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SOURCES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onPick(s.key)}
          className="group flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left transition hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="flex items-center justify-between">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <s.icon className="size-5" aria-hidden />
            </span>
            {s.badge && <Badge variant="success">{s.badge}</Badge>}
          </div>
          <div>
            <p className="font-semibold">{s.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </div>
          <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
            Choose <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold tabular', tone === 'good' && 'text-success', tone === 'warn' && 'text-warning')}>{value}</p>
    </div>
  );
}

export function ProductImporter() {
  const { currency } = useSession();
  const [kind, setKind] = React.useState<SourceKind | null>(null);
  const [form, setForm] = React.useState({ url: '', consumerKey: '', consumerSecret: '', headerName: '', headerValue: '' });
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [opts, setOpts] = React.useState({ mode: 'skip' as 'skip' | 'update', downloadImages: true, defaultStock: 10, status: 'source' as 'source' | 'ACTIVE' | 'DRAFT' });
  const [progress, setProgress] = React.useState<{ done: number; total: number; counts: Record<string, number>; failures: RunResult['results']; limitReached: boolean } | null>(null);
  const [finished, setFinished] = React.useState(false);
  const cancel = React.useRef(false);

  const body = () => {
    if (kind === 'website') return { source: 'website', url: form.url.trim() };
    if (kind === 'woocommerce') return { source: 'woocommerce', url: form.url.trim(), consumerKey: form.consumerKey.trim(), consumerSecret: form.consumerSecret.trim() };
    if (kind === 'feed') return { source: 'feed', url: form.url.trim(), ...(form.headerName && form.headerValue ? { headerName: form.headerName.trim(), headerValue: form.headerValue.trim() } : {}) };
    return { source: 'website', url: form.url.trim() };
  };

  const load = useMutation({
    mutationFn: () => {
      if (kind === 'file') {
        const data = new FormData();
        data.append('file', file!);
        return api.upload<Preview>('/products/import/preview-file', data);
      }
      return api.post<Preview>('/products/import/preview', body());
    },
    onSuccess: (p) => {
      setPreview(p);
      setSelected(new Set(p.products.filter((x) => !x.exists).map((x) => x.key)));
      setPage(1);
      setFilter('');
      setFinished(false);
      setProgress(null);
    },
  });

  const pickFile = (f: File) => {
    if (f.size > 10 * 1024 * 1024) {
      toast.error('That file is larger than 10 MB. Split it into smaller files.');
      return;
    }
    if (!/\.(xlsx|xlsm|csv|tsv|txt|json|xml|docx|pdf)$/i.test(f.name)) {
      toast.error(/\.(xls|doc)$/i.test(f.name) ? 'Please save old .xls/.doc files as .xlsx/.docx first.' : 'This file type is not supported. Use Excel, CSV, Word, PDF, JSON or XML.');
      return;
    }
    setFile(f);
  };

  const canLoad =
    kind === 'file'
      ? file !== null
      : kind === 'woocommerce'
        ? /^https?:\/\//i.test(form.url.trim()) && form.consumerKey.trim().length >= 8 && form.consumerSecret.trim().length >= 8
        : /^https?:\/\//i.test(form.url.trim());

  const run = async () => {
    if (!preview) return;
    const keys = preview.products.filter((p) => selected.has(p.key) && (opts.mode === 'update' || !p.exists)).map((p) => p.key);
    if (!keys.length) {
      toast.info('Nothing to import. Select at least one new product.');
      return;
    }
    cancel.current = false;
    const state = { done: 0, total: keys.length, counts: { created: 0, updated: 0, skipped: 0, failed: 0 } as Record<string, number>, failures: [] as RunResult['results'], limitReached: false };
    setProgress({ ...state });
    try {
      for (let i = 0; i < keys.length && !cancel.current && !state.limitReached; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);
        const r = await api.post<RunResult>('/products/import/run', { importId: preview.importId, keys: batch, ...opts });
        for (const row of r.results) {
          state.counts[row.outcome] = (state.counts[row.outcome] ?? 0) + 1;
          if (row.outcome === 'failed') state.failures.push(row);
        }
        state.done += batch.length;
        state.limitReached = r.limitReached;
        setProgress({ ...state, counts: { ...state.counts }, failures: [...state.failures] });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
    setFinished(true);
  };

  const visible = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = preview?.products ?? [];
    return q ? all.filter((p) => `${p.name} ${p.sku} ${p.category ?? ''}`.toLowerCase().includes(q)) : all;
  }, [preview, filter]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const importable = preview ? preview.products.filter((p) => selected.has(p.key) && (opts.mode === 'update' || !p.exists)).length : 0;
  const importing = progress !== null && !finished;

  // ----------------------------------------------------------------- finished
  if (progress && finished) {
    const c = progress.counts;
    return (
      <Card>
        <CardContent className="space-y-6 p-8 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/12 text-success">
            <PackageCheck className="size-7" aria-hidden />
          </span>
          <div>
            <h2 className="text-2xl font-semibold">Import finished</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your products are in your catalog with their photos, prices, SKUs and details.</p>
          </div>
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Added" value={c.created ?? 0} tone="good" />
            <Stat label="Updated" value={c.updated ?? 0} />
            <Stat label="Skipped" value={c.skipped ?? 0} />
            <Stat label="Failed" value={c.failed ?? 0} tone={c.failed ? 'warn' : undefined} />
          </div>
          {progress.limitReached && (
            <p className="mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-left text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                Your plan&apos;s product limit was reached, so the rest were not imported.{' '}
                <Link href="/settings/billing" className="font-medium text-primary hover:underline">
                  Upgrade your plan
                </Link>{' '}
                and import again. Products already added are skipped.
              </span>
            </p>
          )}
          {progress.failures.length > 0 && (
            <div className="mx-auto max-w-xl rounded-lg border p-3 text-left text-sm">
              <p className="mb-1 font-medium">Why some failed</p>
              <ul className="max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                {progress.failures.slice(0, 30).map((f) => (
                  <li key={f.key}>
                    <span className="font-medium text-foreground">{f.name}</span>: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/products">View products</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/categories">See categories</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setProgress(null);
                setFinished(false);
                setKind(null);
              }}
            >
              Import more
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ------------------------------------------------------------------ preview
  if (preview) {
    const s = preview.summary;
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Products found" value={preview.total} />
          <Stat label="New" value={s.new} tone="good" />
          <Stat label="Already in catalog" value={s.existing} />
          <Stat label="With photos" value={`${s.withImages}/${preview.total}`} />
          <Stat label="Categories" value={s.categories} />
        </div>
        <p className="text-xs text-muted-foreground">
          Detected: <span className="font-medium capitalize text-foreground">{preview.platform.replace('-', ' ')}</span>
          {preview.currency && <> · prices in {preview.currency}</>}
        </p>
        {preview.warnings.map((w) => (
          <p key={w} className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {w}
          </p>
        ))}
        {s.generatedSku > 0 && (
          <p className="text-xs text-muted-foreground">
            {s.generatedSku} products had no SKU, so a stable one marked <Badge variant="muted">auto</Badge> was created for them. Importing again will update, not duplicate.
          </p>
        )}

        <Card>
          <CardContent className="space-y-4 p-5">
            <h3 className="font-semibold">Import settings</h3>
            <FormGrid>
              <Field label="Products already in your catalog" htmlFor="o-mode" hint="Matched by SKU.">
                <Select value={opts.mode} onValueChange={(v) => setOpts({ ...opts, mode: v as 'skip' | 'update' })}>
                  <SelectTrigger id="o-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip them (safe)</SelectItem>
                    <SelectItem value="update">Update name, price, photos and details</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Product status" htmlFor="o-status">
                <Select value={opts.status} onValueChange={(v) => setOpts({ ...opts, status: v as typeof opts.status })}>
                  <SelectTrigger id="o-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="source">Same as the source (hidden stays draft)</SelectItem>
                    <SelectItem value="ACTIVE">Everything active, the AI can sell it</SelectItem>
                    <SelectItem value="DRAFT">Everything draft, review first</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Stock when the source does not say" htmlFor="o-stock" hint="Products marked out of stock are set to 0.">
                <Input id="o-stock" type="number" min={0} value={opts.defaultStock} onChange={(e) => setOpts({ ...opts, defaultStock: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
              <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <ImageIcon className="size-4" aria-hidden /> Save photos to your account
                  </p>
                  <p className="text-xs text-muted-foreground">Keeps images working even if the original shop changes. Slower for big catalogs.</p>
                </div>
                <Switch checked={opts.downloadImages} onCheckedChange={(v) => setOpts({ ...opts, downloadImages: v })} aria-label="Save photos" />
              </div>
            </FormGrid>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Search the preview"
              className="pl-9"
              aria-label="Search the preview"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(preview.products.filter((p) => opts.mode === 'update' || !p.exists).map((p) => p.key)))}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>

        <Card className="overflow-hidden">
          <ul className="divide-y">
            {rows.map((p) => (
              <li key={p.key} className={cn('flex items-start gap-3 p-3 sm:p-4', p.exists && opts.mode === 'skip' && 'opacity-60')}>
                <Checkbox
                  className="mt-4"
                  checked={selected.has(p.key)}
                  onCheckedChange={(c) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (c) next.add(p.key);
                      else next.delete(p.key);
                      return next;
                    })
                  }
                  aria-label={`Select ${p.name}`}
                />
                <ProductThumb src={p.image ?? undefined} name={p.name} size={56} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{p.name}</p>
                    {p.exists ? <Badge variant="muted">In catalog</Badge> : <Badge variant="success">New</Badge>}
                    {p.inStock === false && <Badge variant="warning">Out of stock</Badge>}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="font-mono">{p.sku}</span>
                    {!p.skuFromSource && <Badge variant="muted">auto</Badge>}
                    {p.category && <span>{p.category}</span>}
                    {p.imageCount > 1 && <span>{p.imageCount} photos</span>}
                    {p.stock !== null && <span>{p.stock} in stock</span>}
                  </p>
                  {Object.keys(p.attributes).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(p.attributes)
                        .slice(0, 5)
                        .map(([k, v]) => (
                          <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {k}: {v}
                          </span>
                        ))}
                    </div>
                  )}
                  {p.description && <p className="line-clamp-1 text-xs text-muted-foreground">{p.description}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium tabular">{money(p.salePrice ?? p.price, preview.currency ?? currency)}</p>
                  {p.salePrice !== null && <p className="text-xs text-muted-foreground tabular line-through">{money(p.price, preview.currency ?? currency)}</p>}
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No products match your search.</li>}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        {progress && importing && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Importing…
                </span>
                <span className="tabular text-muted-foreground">
                  {progress.done} of {progress.total}
                </span>
              </div>
              <Progress value={(progress.done / progress.total) * 100} aria-label="Import progress" />
              <p className="text-xs text-muted-foreground">
                Added {progress.counts.created ?? 0} · Updated {progress.counts.updated ?? 0} · Failed {progress.counts.failed ?? 0}. Keep this page open.
              </p>
              <Button variant="outline" size="sm" onClick={() => (cancel.current = true)}>
                Stop after this batch
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
          <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>
            Back
          </Button>
          <span className="text-sm text-muted-foreground">
            <strong className="text-foreground">{importable}</strong> products will be imported
          </span>
          <Button className="ml-auto" size="lg" onClick={run} disabled={importing || importable === 0} loading={importing}>
            Import {importable} products <ArrowRight />
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- source
  if (!kind) return <SourcePicker onPick={setKind} />;

  const chosen = SOURCES.find((s) => s.key === kind)!;
  return (
    <Card>
      <CardContent className="space-y-5 p-6 sm:p-8">
        <button type="button" onClick={() => setKind(null)} className="text-sm text-muted-foreground hover:text-foreground">
          ← Choose a different way
        </button>
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <chosen.icon className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{chosen.title}</h2>
            <p className="text-sm text-muted-foreground">{chosen.text}</p>
          </div>
        </div>

        {kind === 'website' && (
          <Field label="Store or product page address" htmlFor="i-url" hint="Examples: https://myshop.com or https://myshop.myshopify.com. Nothing is changed on your store.">
            <div className="relative">
              <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="i-url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://yourshop.com" className="h-11 pl-9" />
            </div>
          </Field>
        )}

        {kind === 'woocommerce' && (
          <>
            <Field label="Store address" htmlFor="w-url">
              <Input id="w-url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://yourshop.com" />
            </Field>
            <FormGrid>
              <Field label="Consumer key" htmlFor="w-key">
                <Input id="w-key" value={form.consumerKey} onChange={(e) => setForm({ ...form, consumerKey: e.target.value })} placeholder="ck_…" className="font-mono" autoComplete="off" />
              </Field>
              <Field label="Consumer secret" htmlFor="w-secret">
                <Input id="w-secret" type="password" value={form.consumerSecret} onChange={(e) => setForm({ ...form, consumerSecret: e.target.value })} placeholder="cs_…" className="font-mono" autoComplete="off" />
              </Field>
            </FormGrid>
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              In WordPress open WooCommerce → Settings → Advanced → REST API → Add key, choose permission <strong className="text-foreground">Read</strong>. The keys are used once for this import and are not saved.
            </p>
          </>
        )}

        {kind === 'feed' && (
          <>
            <Field label="Product data address" htmlFor="f-url" hint="A link that returns your products as JSON, XML (Google Merchant) or CSV.">
              <Input id="f-url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://api.yourshop.com/products" className="font-mono text-sm" />
            </Field>
            <FormGrid>
              <Field label="API key header name (optional)" htmlFor="f-hn" hint="For example Authorization or X-API-Key.">
                <Input id="f-hn" value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} placeholder="Authorization" />
              </Field>
              <Field label="API key value (optional)" htmlFor="f-hv" hint="For example Bearer abc123.">
                <Input id="f-hv" type="password" value={form.headerValue} onChange={(e) => setForm({ ...form, headerValue: e.target.value })} autoComplete="off" />
              </Field>
            </FormGrid>
            <p className="text-xs text-muted-foreground">
              We recognise common field names automatically (name, title, sku, price, sale_price, image, category, stock, description…) and keep every other field, such as brand, color, size or shape, as product details.
            </p>
          </>
        )}

        {kind === 'file' && (
          <>
            <label
              htmlFor="c-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pickFile(f);
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition hover:border-primary/60 hover:bg-primary/5',
                dragging && 'border-primary bg-primary/5',
                file && 'border-success/50 bg-success/5',
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {file ? <CheckCircle2 className="size-6 text-success" aria-hidden /> : <UploadCloud className="size-6" aria-hidden />}
              </span>
              {file ? (
                <>
                  <span className="font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · click to choose a different file</span>
                </>
              ) : (
                <>
                  <span className="font-medium">Drop your file here, or click to choose</span>
                  <span className="text-xs text-muted-foreground">Excel, CSV, Word, PDF, JSON, XML or text · up to 10 MB</span>
                </>
              )}
              <input
                id="c-file"
                type="file"
                className="sr-only"
                accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,.xml,.docx,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
            </label>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {[
                ['Excel or CSV', 'First row = column names (Name, SKU, Price, Image, Category…). Any extra column becomes a product detail.'],
                ['Word', 'Put products in a table with a header row, or one product per line with its price.'],
                ['PDF', 'Works when the text can be selected. Lines like “Blue Mug  12.50” or a table with Name and Price.'],
                ['Photos', 'Use web links in an Image column. Pictures pasted inside Excel or Word cannot be read.'],
              ].map(([t, d]) => (
                <p key={t} className="rounded-lg border bg-muted/30 p-2.5">
                  <strong className="text-foreground">{t}.</strong> {d}
                </p>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'sellora-products-sample.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download a sample file (opens in Excel)
            </Button>
          </>
        )}

        <div className="flex items-center gap-3 border-t pt-5">
          <Button size="lg" onClick={() => load.mutate()} loading={load.isPending} disabled={!canLoad}>
            {load.isPending ? 'Reading your products…' : 'Find my products'} <ArrowRight />
          </Button>
          {load.isPending && <span className="text-xs text-muted-foreground">This can take up to a minute for large shops.</span>}
        </div>
        {load.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden /> Nothing is saved yet. You will review everything first.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
