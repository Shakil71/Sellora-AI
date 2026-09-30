/**
 * Browser API client. Authentication uses HTTP-only cookies set by the API;
 * this client only reads the non-secret CSRF cookie and echoes it back.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors from validation responses, keyed by path. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: string; message?: string }>) {
        if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 */
  noRefresh?: boolean;
}

const API_BASE = '/api/v1';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh so parallel 401s trigger only one refresh call. */
async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': readCookie('sellora_csrf') ?? '' },
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

function onSessionLost() {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite', '/install'].some((p) => path.startsWith(p))) return;
  // A full reload is intentional: it drops every cached query of the lost session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/login?next=${encodeURIComponent(path + window.location.search)}`;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!isForm && opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = readCookie('sellora_csrf') ?? '';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      signal: opts.signal,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  if (res.status === 401 && !opts.noRefresh && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const ok = await refreshSession();
    if (ok) return request<T>(method, path, { ...opts, noRefresh: true });
    onSessionLost();
  }

  const text = await res.text();
  let json: { success?: boolean; data?: T; error?: { code: string; message: string; details?: unknown; requestId?: string } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.ok ? 'Unexpected response from server' : `Request failed (${res.status})`, res.status, 'BAD_RESPONSE');
  }
  if (!res.ok || json.success === false) {
    const e = json.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, res.status, e?.code ?? 'ERROR', e?.details, e?.requestId);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData, query?: Query) => request<T>('POST', path, { body: form, query }),
};

/** Friendly message for toasts and inline errors. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.status >= 500 && err.requestId) return `${err.message} (ref ${err.requestId.slice(0, 8)})`;
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Uploads a file for a given purpose and returns its public URL. */
export async function uploadFile(file: File, purpose: 'product' | 'category' | 'avatar' | 'branding' | 'attachment' | 'document') {
  const form = new FormData();
  form.append('file', file);
  return api.upload<{ id: string; url: string; mimeType: string; name: string; size: number }>('/files/upload', form, { purpose });
}
