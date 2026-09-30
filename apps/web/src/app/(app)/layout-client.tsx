'use client';

import { SessionProvider } from '@/components/session';
import { AppShell } from '@/components/layout/app-shell';
import { LogoMark } from '@/components/brand/logo';

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true" aria-label="Loading Sellora AI">
      <LogoMark size={40} className="animate-pulse" />
      <p className="text-sm text-muted-foreground">Loading your workspace…</p>
    </div>
  );
}

export function AppLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<FullScreenLoader />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
