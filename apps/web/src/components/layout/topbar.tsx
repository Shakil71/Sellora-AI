'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  Bell,
  BookOpen,
  Check,
  ChevronsUpDown,
  CircleHelp,
  LogOut,
  Laptop,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  UserRound,
  Keyboard,
  LifeBuoy,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import type { Me, Notification } from '@/lib/types';
import { useSession } from '@/components/session';
import { useRealtime } from '@/components/realtime';
import { useCommandPalette } from './command-palette';
import { Button } from '@/components/ui/button';
import { Avatar, Kbd } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/overlays';
import { cn } from '@/lib/utils';

function WorkspaceSwitcher() {
  const { me } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const switchWs = useMutation({
    mutationFn: (tenantId: string) => api.post<Me>('/auth/switch-workspace', { tenantId }),
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(['me'], data);
      router.push('/dashboard');
      toast.success(`Switched to ${data.workspace?.name}`);
    },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 max-w-[200px] min-w-0 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-accent" aria-label="Switch workspace">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{me.workspace!.name[0]?.toUpperCase()}</span>
          <span className="hidden truncate sm:inline">{me.workspace!.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {me.workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => w.id !== me.workspace!.id && switchWs.mutate(w.id)}>
            <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold">{w.name[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === me.workspace!.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?create=1">
            <Plus /> Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const { data } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications', { pageSize: 8 }),
    refetchInterval: 60_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button className="text-xs font-medium text-primary hover:underline" onClick={() => markAll.mutate()}>
              Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto scrollbar-thin">
          {!data?.items.length && <p className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {data?.items.map((n) => (
            <Link
              key={n.id}
              href={n.link ?? '/notifications'}
              onClick={() => {
                if (!n.readAt) markOne.mutate(n.id);
                setOpen(false);
              }}
              className="flex gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/50"
            >
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">{relative(n.createdAt)}</p>
              </div>
            </Link>
          ))}
        </div>
        <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted/50">
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const Icon = !mounted ? Sun : theme === 'dark' ? Moon : theme === 'light' ? Sun : Laptop;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {[
          { v: 'light', label: 'Light', icon: Sun },
          { v: 'dark', label: 'Dark', icon: Moon },
          { v: 'system', label: 'System', icon: Laptop },
        ].map((o) => (
          <DropdownMenuItem key={o.v} onSelect={() => setTheme(o.v)}>
            <o.icon /> {o.label}
            {mounted && theme === o.v && <Check className="ml-auto size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HelpMenu() {
  const { open } = useCommandPalette();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help" className="hidden sm:inline-flex">
          <CircleHelp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onSelect={open}>
          <Keyboard /> Command palette <Kbd className="ml-auto">Ctrl K</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <BookOpen /> Setup guide
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/workspace">
            <LifeBuoy /> Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Account menu">
          <Avatar name={me.user.name} src={me.user.avatarUrl} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{me.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/security">
            <Shield /> Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/workspace">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        {me.user.isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> Platform admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} destructive>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { open } = useCommandPalette();
  const { connected } = useRealtime();
  return (
    <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu />
      </Button>
      <WorkspaceSwitcher />
      <button
        onClick={open}
        className="ml-1 hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs transition hover:text-foreground md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={open} aria-label="Search">
          <Search />
        </Button>
        <span
          className={cn('mx-1 hidden size-2 rounded-full sm:block', connected ? 'bg-success' : 'bg-muted-foreground/40')}
          title={connected ? 'Live updates connected' : 'Live updates reconnecting'}
          aria-label={connected ? 'Live updates connected' : 'Live updates reconnecting'}
        />
        <HelpMenu />
        <ThemeMenu />
        <NotificationsBell />
        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
