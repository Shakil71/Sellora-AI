'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';

interface SessionValue {
  me: Me;
  can: (permission?: string | string[]) => boolean;
  currency: string;
  refresh: () => Promise<unknown>;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && count < 2,
  });
}

/** Loads the signed-in user and active workspace for the app shell. */
export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, error, isLoading } = useMe();

  React.useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [error, router]);

  React.useEffect(() => {
    if (data && !data.workspace) router.replace('/onboarding?create=1');
  }, [data, router]);

  const value = React.useMemo<SessionValue | null>(() => {
    if (!data) return null;
    const set = new Set(data.permissions);
    return {
      me: data,
      currency: data.workspace?.currency ?? 'USD',
      can: (permission) => {
        if (!permission) return true;
        const list = Array.isArray(permission) ? permission : [permission];
        return list.every((p) => set.has(p));
      },
      refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    };
  }, [data, qc]);

  if (isLoading || !value || !value.me.workspace) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Renders children only when the user has the permission(s). */
export function Can({ permission, children, fallback = null }: { permission?: string | string[]; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useSession();
  return <>{can(permission) ? children : fallback}</>;
}
