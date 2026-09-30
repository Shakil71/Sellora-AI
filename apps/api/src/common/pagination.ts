import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paginate(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function toPaginated<T>(items: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> {
  return {
    items,
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
  };
}

/** Only allow sorting by whitelisted columns. */
export function sortBy<T extends string>(
  sort: string | undefined,
  allowed: readonly T[],
  fallback: T,
  order: 'asc' | 'desc' = 'desc',
): Record<string, 'asc' | 'desc'> {
  const field = (allowed as readonly string[]).includes(sort ?? '') ? (sort as T) : fallback;
  return { [field]: order };
}

export const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));

export const uuidSchema = z.string().uuid();
