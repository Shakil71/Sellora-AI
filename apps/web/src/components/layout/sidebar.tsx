'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { filterNav, type NavItem } from '@/lib/navigation';
import { useSession } from '@/components/session';
import { Logo, LogoMark } from '@/components/brand/logo';
import { Badge, Tooltip } from '@/components/ui/primitives';

function isActive(item: NavItem, pathname: string, search: string) {
  if (item.href.includes('?')) {
    const [path, query] = item.href.split('?');
    return pathname === path && search.includes(query!);
  }
  if (item.href === '/inbox') return pathname === '/inbox' && !search.includes('channel=');
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { can } = useSession();
  const sections = filterNav(can);
  return (
    <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scrollbar-thin">
      {sections.map((section) => (
        <div key={section.title || 'main'}>
          {section.title && !collapsed && <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{section.title}</p>}
          {section.title && collapsed && <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" />}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(item, pathname, search);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  )}
                >
                  <item.icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip content={item.title} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceCard({ collapsed }: { collapsed?: boolean }) {
  const { me } = useSession();
  const ws = me.workspace!;
  if (collapsed) return null;
  return (
    <div className="m-2 rounded-lg border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{ws.name}</p>
        {ws.subscription && <Badge variant="secondary">{ws.subscription.plan}</Badge>}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {me.role?.name} · {ws.currency}
      </p>
      {ws.isDemo && <p className="mt-2 text-xs text-warning">Demo workspace — sample data</p>}
    </div>
  );
}

export function DesktopSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex print:hidden',
        collapsed ? 'w-[60px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-14 items-center border-b px-3', collapsed ? 'justify-center' : 'justify-between')}>
        <Link href="/dashboard" aria-label="Sellora AI dashboard">
          {collapsed ? <LogoMark size={28} /> : <Logo />}
        </Link>
        {!collapsed && (
          <button onClick={onToggle} className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Collapse sidebar">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <React.Suspense>
        <SidebarNav collapsed={collapsed} />
      </React.Suspense>
      <WorkspaceCard collapsed={collapsed} />
      {collapsed && (
        <button onClick={onToggle} className="mx-auto mb-3 rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent" aria-label="Expand sidebar">
          <PanelLeftOpen className="size-4" />
        </button>
      )}
    </aside>
  );
}
