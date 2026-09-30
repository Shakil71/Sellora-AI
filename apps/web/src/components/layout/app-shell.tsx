'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DesktopSidebar, SidebarNav, WorkspaceCard } from './sidebar';
import { Topbar } from './topbar';
import { CommandPaletteProvider } from './command-palette';
import { RealtimeProvider } from '@/components/realtime';
import { useSession } from '@/components/session';
import { ConfirmProvider } from '@/components/shared/confirm';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays';
import { Logo } from '@/components/brand/logo';
import { api } from '@/lib/api';

const COLLAPSE_KEY = 'sellora:sidebar-collapsed';

function Banners() {
  const { me } = useSession();
  const resend = useMutation({
    mutationFn: () => api.post<{ emailConfigured: boolean }>('/auth/resend-verification'),
    onSuccess: (r) => (r.emailConfigured ? toast.success('Verification email sent') : toast.info('Email delivery is not configured on this server yet.')),
  });
  return (
    <>
      {me.workspace?.status === 'SUSPENDED' && (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" /> This workspace is suspended. Contact the platform administrator.
        </div>
      )}
      {!me.user.emailVerified && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-info/8 px-4 py-2 text-sm">
          <Mail className="size-4 text-info" aria-hidden />
          <span>Please verify your email address to secure your account.</span>
          <button className="font-medium text-primary hover:underline" onClick={() => resend.mutate()} disabled={resend.isPending}>
            Resend email
          </button>
        </div>
      )}
      {me.workspace && !me.workspace.onboardingCompletedAt && !me.workspace.isDemo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-primary/6 px-4 py-2 text-sm">
          <span>Finish setting up Sellora AI to start selling on WhatsApp.</span>
          <Link href="/onboarding" className="font-medium text-primary hover:underline">
            Continue setup →
          </Link>
        </div>
      )}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  const fullBleed = pathname.startsWith('/inbox') || pathname.startsWith('/automation/workflows/');

  return (
    <RealtimeProvider workspaceId={me.workspace!.id}>
      <ConfirmProvider>
        <CommandPaletteProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow">
            Skip to content
          </a>
          <div className="flex min-h-dvh">
            <DesktopSidebar collapsed={collapsed} onToggle={toggle} />
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex h-14 items-center border-b px-4">
                  <Logo />
                </div>
                <React.Suspense>
                  <SidebarNav onNavigate={() => setMobileOpen(false)} />
                </React.Suspense>
                <WorkspaceCard />
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
              <div className="print:hidden">
                <Banners />
              </div>
              <main id="main" className={fullBleed ? 'min-w-0 flex-1' : 'mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8'}>
                {children}
              </main>
            </div>
          </div>
        </CommandPaletteProvider>
      </ConfirmProvider>
    </RealtimeProvider>
  );
}
