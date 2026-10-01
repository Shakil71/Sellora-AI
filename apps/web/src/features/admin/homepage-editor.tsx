'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { HOME_ICONS, HOME_SECTION_KEYS, type HomeContent, type HomeIcon, type HomeSectionKey } from '@sellora/shared';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/shared/confirm';
import { Field, FormGrid } from '@/components/shared/form';
import { HOME_ICON_MAP } from '@/components/marketing/home-icons';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';

const SECTION_LABELS: Record<HomeSectionKey, { label: string; hint: string }> = {
  foundations: { label: 'Built-on strip', hint: 'The row of short facts under the top banner.' },
  flow: { label: 'Chat to checkout', hint: 'The four-step example of a sale.' },
  tour: { label: 'Product tour', hint: 'Screenshots with tabs.' },
  features: { label: 'Features', hint: 'Feature cards.' },
  guardrails: { label: 'Responsible AI', hint: 'The dark section about the AI.' },
  steps: { label: 'How it works', hint: 'The three steps.' },
  security: { label: 'Security & ownership', hint: 'Security points next to the analytics screenshot.' },
  pricing: { label: 'Pricing', hint: 'Plan cards. Prices come from Platform admin → Plan payments.' },
  testimonials: { label: 'Testimonials', hint: 'Customer quotes. Hidden when there are none.' },
  faq: { label: 'FAQ', hint: 'Questions and answers.' },
  cta: { label: 'Final call to action', hint: 'The big green banner at the bottom.' },
};

/** Replaces one value inside the draft without mutating it. */
function useDraft(initial: HomeContent | undefined) {
  const [draft, setDraft] = React.useState<HomeContent | null>(null);
  React.useEffect(() => {
    if (initial) setDraft(structuredClone(initial));
  }, [initial]);
  const set = React.useCallback(<K extends keyof HomeContent>(key: K, value: HomeContent[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d)), []);
  return { draft, setDraft, set };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function ListEditor<T>({
  items,
  onChange,
  makeNew,
  max,
  addLabel,
  render,
  empty,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  makeNew: () => T;
  max: number;
  addLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="space-y-3">
      {items.length === 0 && empty && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{empty}</p>}
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 rounded-xl border bg-card p-3">
          <div className="min-w-0 flex-1 space-y-3">{render(item, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}</div>
          <div className="flex shrink-0 flex-col gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))}>
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete" className="text-destructive hover:text-destructive" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" disabled={items.length >= max} onClick={() => onChange([...items, makeNew()])}>
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}

function IconSelect({ value, onChange, id }: { value: HomeIcon; onChange: (v: HomeIcon) => void; id?: string }) {
  const Current = HOME_ICON_MAP[value];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as HomeIcon)}>
      <SelectTrigger id={id} className="w-full sm:w-40" aria-label="Icon">
        <span className="flex items-center gap-2">
          <Current className="size-4" aria-hidden />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {HOME_ICONS.map((name) => {
          const Icon = HOME_ICON_MAP[name];
          return (
            <SelectItem key={name} value={name}>
              <span className="flex items-center gap-2">
                <Icon className="size-4" aria-hidden /> {name}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function IconItems({ items, onChange, max, noun }: { items: Array<{ icon: HomeIcon; title: string; text: string }>; onChange: (v: Array<{ icon: HomeIcon; title: string; text: string }>) => void; max: number; noun: string }) {
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      max={max}
      addLabel={`Add ${noun}`}
      makeNew={() => ({ icon: 'check' as HomeIcon, title: 'New title', text: 'Describe it in a sentence.' })}
      render={(it, update) => (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <IconSelect value={it.icon} onChange={(icon) => update({ icon })} />
            <Input value={it.title} maxLength={80} onChange={(e) => update({ title: e.target.value })} aria-label="Title" placeholder="Title" />
          </div>
          <Textarea value={it.text} rows={2} maxLength={400} onChange={(e) => update({ text: e.target.value })} aria-label="Text" placeholder="Short description" />
        </>
      )}
    />
  );
}

function Heading({ value, onChange }: { value: { eyebrow: string; title: string; text: string }; onChange: (v: { eyebrow: string; title: string; text: string }) => void }) {
  return (
    <div className="space-y-3">
      <FormGrid>
        <Field label="Small label above the title" htmlFor="h-eyebrow">
          <Input id="h-eyebrow" value={value.eyebrow} maxLength={60} onChange={(e) => onChange({ ...value, eyebrow: e.target.value })} />
        </Field>
        <Field label="Title" htmlFor="h-title" required>
          <Input id="h-title" value={value.title} maxLength={140} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </Field>
      </FormGrid>
      <Field label="Text under the title" htmlFor="h-text">
        <Textarea id="h-text" rows={2} value={value.text} maxLength={500} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      </Field>
    </div>
  );
}

function LinkFields({ value, onChange, label }: { value: { label: string; href: string }; onChange: (v: { label: string; href: string }) => void; label: string }) {
  return (
    <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
      <p className="text-sm font-medium sm:col-span-2">{label}</p>
      <Field label="Button text" htmlFor={`${label}-l`} required>
        <Input id={`${label}-l`} value={value.label} maxLength={60} onChange={(e) => onChange({ ...value, label: e.target.value })} />
      </Field>
      <Field label="Link" htmlFor={`${label}-h`} hint="/register, /login, /#pricing, https://… or mailto:…" required>
        <Input id={`${label}-h`} value={value.href} maxLength={300} className="font-mono text-sm" onChange={(e) => onChange({ ...value, href: e.target.value })} />
      </Field>
    </div>
  );
}

function Card2({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">{children}</CardContent>
    </Card>
  );
}

export function HomepageEditor() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['admin-homepage'], queryFn: () => api.get<HomeContent>('/admin/homepage') });
  const { draft, setDraft, set } = useDraft(data);
  const dirty = React.useMemo(() => Boolean(draft && data && JSON.stringify(draft) !== JSON.stringify(data)), [draft, data]);
  const save = useMutation({
    mutationFn: () => api.put<HomeContent>('/admin/homepage', draft),
    onSuccess: (saved) => {
      qc.setQueryData(['admin-homepage'], saved);
      toast.success('Saved. Visitors see the change within 30 seconds.');
    },
  });
  const reset = useMutation({
    mutationFn: () => api.delete<HomeContent>('/admin/homepage'),
    onSuccess: (original) => {
      qc.setQueryData(['admin-homepage'], original);
      setDraft(structuredClone(original));
      toast.success('The home page is back to the original text.');
    },
  });

  // Warn before leaving with unsaved edits.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (isLoading || !draft) return <Skeleton className="h-96" />;
  const d = draft;

  return (
    <div className="space-y-5">
      <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur sm:top-16">
        {dirty ? <Badge variant="warning">Unsaved changes</Badge> : <Badge variant="success">All changes saved</Badge>}
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <a href="/" target="_blank" rel="noreferrer">
            <ExternalLink /> View home page
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={reset.isPending}
          onClick={async () => {
            if (await confirm({ title: 'Restore the original text?', description: 'Everything you changed on the home page is replaced by the text that came with the product.', confirmLabel: 'Restore original', destructive: true })) reset.mutate();
          }}
        >
          <RotateCcw /> Restore original
        </Button>
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          <Save /> Save changes
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="hero">Top banner</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="steps">How it works</TabsTrigger>
          <TabsTrigger value="trust">AI &amp; security</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="proof">Testimonials</TabsTrigger>
          <TabsTrigger value="cta">Bottom banner</TabsTrigger>
          <TabsTrigger value="sections">Show or hide</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card2 title="Brand and search engines" description="The name in the header and footer, and what Google shows for your home page.">
            <Field label="Brand name" htmlFor="g-brand" required hint="The last word is shown in the brand colour.">
              <Input id="g-brand" value={d.brandName} maxLength={40} onChange={(e) => set('brandName', e.target.value)} />
            </Field>
            <Field label="Page title (Google and browser tab)" htmlFor="g-title" required>
              <Input id="g-title" value={d.seo.title} maxLength={120} onChange={(e) => set('seo', { ...d.seo, title: e.target.value })} />
            </Field>
            <Field label="Page description (Google)" htmlFor="g-desc" hint="About 150 characters works best.">
              <Textarea id="g-desc" rows={2} value={d.seo.description} maxLength={300} onChange={(e) => set('seo', { ...d.seo, description: e.target.value })} />
            </Field>
          </Card2>
          <Card2 title="Footer">
            <Field label="Short description" htmlFor="f-desc">
              <Input id="f-desc" value={d.footer.description} maxLength={200} onChange={(e) => set('footer', { ...d.footer, description: e.target.value })} />
            </Field>
            <Field label="Small print" htmlFor="f-legal" hint="Shown after the copyright line.">
              <Textarea id="f-legal" rows={2} value={d.footer.legal} maxLength={300} onChange={(e) => set('footer', { ...d.footer, legal: e.target.value })} />
            </Field>
          </Card2>
        </TabsContent>

        <TabsContent value="hero" className="space-y-4">
          <Card2 title="Top banner" description="The first thing visitors read.">
            <FormGrid>
              <Field label="Small tag" htmlFor="hb-label" hint="For example New. Leave empty to hide.">
                <Input id="hb-label" value={d.hero.badgeLabel} maxLength={20} onChange={(e) => set('hero', { ...d.hero, badgeLabel: e.target.value })} />
              </Field>
              <Field label="Tag text" htmlFor="hb-text">
                <Input id="hb-text" value={d.hero.badgeText} maxLength={80} onChange={(e) => set('hero', { ...d.hero, badgeText: e.target.value })} />
              </Field>
              <Field label="Headline" htmlFor="hh-1" required>
                <Input id="hh-1" value={d.hero.headlinePrefix} maxLength={120} onChange={(e) => set('hero', { ...d.hero, headlinePrefix: e.target.value })} />
              </Field>
              <Field label="Highlighted last word(s)" htmlFor="hh-2" hint="Shown with a colour gradient.">
                <Input id="hh-2" value={d.hero.headlineHighlight} maxLength={40} onChange={(e) => set('hero', { ...d.hero, headlineHighlight: e.target.value })} />
              </Field>
            </FormGrid>
            <Field label="Sub-headline" htmlFor="hh-3">
              <Textarea id="hh-3" rows={3} value={d.hero.subheadline} maxLength={500} onChange={(e) => set('hero', { ...d.hero, subheadline: e.target.value })} />
            </Field>
            <LinkFields label="Main button" value={d.hero.primaryCta} onChange={(v) => set('hero', { ...d.hero, primaryCta: v })} />
            <LinkFields label="Second button" value={d.hero.secondaryCta} onChange={(v) => set('hero', { ...d.hero, secondaryCta: v })} />
            <div>
              <p className="mb-2 text-sm font-medium">Short promises under the buttons</p>
              <ListEditor
                items={d.hero.checks.map((t) => ({ t }))}
                onChange={(list) => set('hero', { ...d.hero, checks: list.map((x) => x.t) })}
                max={6}
                addLabel="Add promise"
                makeNew={() => ({ t: 'New promise' })}
                render={(it, update) => <Input value={it.t} maxLength={60} onChange={(e) => update({ t: e.target.value })} aria-label="Promise" />}
              />
            </div>
          </Card2>
          <Card2 title="Built-on strip" description="Short facts shown in a row under the banner.">
            <ListEditor
              items={d.foundations}
              onChange={(v) => set('foundations', v)}
              max={10}
              addLabel="Add fact"
              makeNew={() => ({ icon: 'check' as HomeIcon, label: 'New fact' })}
              render={(it, update) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <IconSelect value={it.icon} onChange={(icon) => update({ icon })} />
                  <Input value={it.label} maxLength={60} onChange={(e) => update({ label: e.target.value })} aria-label="Text" />
                </div>
              )}
            />
          </Card2>
        </TabsContent>

        <TabsContent value="features" className="space-y-4">
          <Card2 title="Features section">
            <Heading value={d.features} onChange={(h) => set('features', { ...d.features, ...h })} />
          </Card2>
          <Card2 title="Feature cards" description="Add, edit, reorder or delete cards.">
            <IconItems items={d.features.items} onChange={(items) => set('features', { ...d.features, items })} max={12} noun="feature" />
          </Card2>
        </TabsContent>

        <TabsContent value="steps" className="space-y-4">
          <Card2 title="Chat to checkout and product tour headings">
            <Heading value={d.flow} onChange={(h) => set('flow', h)} />
            <Heading value={d.tour} onChange={(h) => set('tour', h)} />
          </Card2>
          <Card2 title="How it works">
            <Heading value={d.steps} onChange={(h) => set('steps', { ...d.steps, ...h })} />
            <IconItems items={d.steps.items} onChange={(items) => set('steps', { ...d.steps, items })} max={6} noun="step" />
          </Card2>
        </TabsContent>

        <TabsContent value="trust" className="space-y-4">
          <Card2 title="Responsible AI section">
            <Heading value={d.guardrails} onChange={(h) => set('guardrails', { ...d.guardrails, ...h })} />
            <IconItems items={d.guardrails.items} onChange={(items) => set('guardrails', { ...d.guardrails, items })} max={8} noun="point" />
          </Card2>
          <Card2 title="Security and ownership section">
            <Heading value={d.security} onChange={(h) => set('security', { ...d.security, ...h })} />
            <IconItems items={d.security.items} onChange={(items) => set('security', { ...d.security, items })} max={12} noun="point" />
          </Card2>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <Card2 title="Pricing section" description="Plan names, features and limits come from the product. Monthly prices and the currency come from Platform admin → Plan payments, so the home page always matches your Billing page.">
            <Heading value={d.pricing} onChange={(h) => set('pricing', { ...d.pricing, ...h })} />
            <FormGrid>
              <Field label="“Most popular” label" htmlFor="p-pop">
                <Input id="p-pop" value={d.pricing.popularLabel} maxLength={30} onChange={(e) => set('pricing', { ...d.pricing, popularLabel: e.target.value })} />
              </Field>
              <Field label="Buy button text" htmlFor="p-buy" required>
                <Input id="p-buy" value={d.pricing.buyLabel} maxLength={30} onChange={(e) => set('pricing', { ...d.pricing, buyLabel: e.target.value })} />
              </Field>
              <Field label="Enterprise button text" htmlFor="p-contact" required>
                <Input id="p-contact" value={d.pricing.contactLabel} maxLength={30} onChange={(e) => set('pricing', { ...d.pricing, contactLabel: e.target.value })} />
              </Field>
            </FormGrid>
          </Card2>
        </TabsContent>

        <TabsContent value="faq" className="space-y-4">
          <Card2 title="FAQ section">
            <Heading value={d.faq} onChange={(h) => set('faq', { ...d.faq, ...h })} />
          </Card2>
          <Card2 title="Questions" description="Add, edit, reorder or delete questions.">
            <ListEditor
              items={d.faq.items}
              onChange={(items) => set('faq', { ...d.faq, items })}
              max={30}
              addLabel="Add question"
              makeNew={() => ({ q: 'New question?', a: 'Your answer.' })}
              render={(it, update) => (
                <>
                  <Input value={it.q} maxLength={200} onChange={(e) => update({ q: e.target.value })} aria-label="Question" placeholder="Question" />
                  <Textarea value={it.a} rows={3} maxLength={1500} onChange={(e) => update({ a: e.target.value })} aria-label="Answer" placeholder="Answer" />
                </>
              )}
            />
          </Card2>
        </TabsContent>

        <TabsContent value="proof" className="space-y-4">
          <Card2 title="Testimonials" description="Only add real quotes from customers who agreed. The section stays hidden while the list is empty.">
            <ListEditor
              items={d.testimonials}
              onChange={(v) => set('testimonials', v)}
              max={9}
              addLabel="Add testimonial"
              empty="No testimonials yet."
              makeNew={() => ({ quote: 'What the customer said.', name: 'Customer name', role: 'Business, city' })}
              render={(it, update) => (
                <>
                  <Textarea value={it.quote} rows={3} maxLength={400} onChange={(e) => update({ quote: e.target.value })} aria-label="Quote" placeholder="Quote" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={it.name} maxLength={60} onChange={(e) => update({ name: e.target.value })} aria-label="Name" placeholder="Name" />
                    <Input value={it.role} maxLength={80} onChange={(e) => update({ role: e.target.value })} aria-label="Role" placeholder="Role, company" />
                  </div>
                </>
              )}
            />
          </Card2>
        </TabsContent>

        <TabsContent value="cta" className="space-y-4">
          <Card2 title="Bottom banner">
            <Field label="Headline" htmlFor="c-h" required>
              <Input id="c-h" value={d.cta.headline} maxLength={140} onChange={(e) => set('cta', { ...d.cta, headline: e.target.value })} />
            </Field>
            <Field label="Text" htmlFor="c-t">
              <Textarea id="c-t" rows={3} value={d.cta.text} maxLength={400} onChange={(e) => set('cta', { ...d.cta, text: e.target.value })} />
            </Field>
            <LinkFields label="Main button" value={d.cta.primaryCta} onChange={(v) => set('cta', { ...d.cta, primaryCta: v })} />
            <LinkFields label="Second button" value={d.cta.secondaryCta} onChange={(v) => set('cta', { ...d.cta, secondaryCta: v })} />
          </Card2>
        </TabsContent>

        <TabsContent value="sections">
          <Card2 title="Show or hide whole sections" description="Hidden sections are not deleted; turn them back on any time.">
            <ul className="divide-y rounded-xl border">
              {HOME_SECTION_KEYS.map((k) => (
                <li key={k} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{SECTION_LABELS[k].label}</p>
                    <p className="text-xs text-muted-foreground">{SECTION_LABELS[k].hint}</p>
                  </div>
                  <Switch checked={d.sections[k]} onCheckedChange={(v) => set('sections', { ...d.sections, [k]: v })} aria-label={`Show ${SECTION_LABELS[k].label}`} />
                </li>
              ))}
            </ul>
          </Card2>
        </TabsContent>
      </Tabs>
    </div>
  );
}
