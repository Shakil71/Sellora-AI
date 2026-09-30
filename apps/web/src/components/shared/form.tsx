'use client';

import * as React from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge, Input, Label } from '@/components/ui/primitives';
import { errorMessage, uploadFile } from '@/lib/api';

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const id = htmlFor;
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-destructive" aria-hidden>*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p id={id ? `${id}-error` : undefined} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

/** Comma/enter separated tags. */
export function TagInput({
  value,
  onChange,
  placeholder = 'Add tag and press Enter',
  id,
  max = 30,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  id?: string;
  max?: number;
}) {
  const [draft, setDraft] = React.useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, max));
    setDraft('');
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
      {value.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded hover:bg-muted">
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/80"
      />
    </div>
  );
}

/** Image upload grid used for product and category images. */
export function ImageUpload({
  value,
  onChange,
  max = 6,
  purpose = 'product',
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  purpose?: 'product' | 'category' | 'avatar' | 'branding';
}) {
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const next = [...value];
      for (const file of Array.from(files).slice(0, max - value.length)) {
        const res = await uploadFile(file, purpose);
        next.push(res.url);
      }
      onChange(next);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <div className="flex flex-wrap gap-3">
      {value.map((url, i) => (
        <div key={url} className="group relative size-20 overflow-hidden rounded-lg border bg-muted sm:size-24">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Image ${i + 1}`} className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(value.filter((u) => u !== url))}
            className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
            aria-label="Remove image"
          >
            <X className="size-3.5" />
          </button>
          {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Cover</span>}
        </div>
      ))}
      {value.length < max && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition hover:border-primary hover:text-primary sm:size-24"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
          {busy ? 'Uploading' : 'Add image'}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}

export function MoneyInput({ value, onChange, currency, id, ...rest }: Omit<React.ComponentProps<'input'>, 'onChange' | 'value'> & { value: number | string | null | undefined; onChange: (v: number | null) => void; currency: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-muted-foreground">{currency}</span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="pl-12 tabular"
        value={value === null || value === undefined ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        {...rest}
      />
    </div>
  );
}
