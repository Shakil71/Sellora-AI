import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

export function money(value: number | string | null | undefined, currency = 'USD', opts: { compact?: boolean } = {}) {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: opts.compact && Math.abs(amount) >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: opts.compact && Math.abs(amount) >= 10000 ? 1 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function number(value: number | string | null | undefined, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat('en-US', opts).format(Number(value ?? 0));
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function percent(value: number, digits = 1) {
  return `${Number(value ?? 0).toFixed(digits).replace(/\.0$/, '')}%`;
}

export function date(value: string | Date | null | undefined, pattern = 'MMM d, yyyy') {
  if (!value) return '—';
  return format(new Date(value), pattern);
}

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return format(new Date(value), 'MMM d, yyyy · h:mm a');
}

export function relative(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Date.now() - d.getTime() < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

/** Compact timestamp for lists (10:24 AM, Yesterday, Mar 4). */
export function shortTime(value: string | Date | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  if (Date.now() - d.getTime() < 6 * 86400_000) return format(d, 'EEE');
  return format(d, 'MMM d');
}

export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1).replace(/\.0$/, '')}h`;
  return `${(seconds / 86400).toFixed(1).replace(/\.0$/, '')}d`;
}

export function fileSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function titleCase(value: string | null | undefined) {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[_\.]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
