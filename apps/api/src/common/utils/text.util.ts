export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  );
}

/** Normalises a phone number to digits with optional leading + (E.164-like). */
export function normalizePhone(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 16) return undefined;
  return `+${digits}`;
}

export function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Rough token estimate (≈4 chars per token) for budgeting and chunking. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Replaces {{path.to.value}} placeholders using the provided context. */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, context);
    return value === undefined || value === null ? '' : String(value);
  });
}
