'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ArrowRight, Handshake, Loader2, MessagesSquare, Moon, Package, Plus, Search, ShoppingCart, Sun, Target, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { api } from '@/lib/api';
import { filterNav } from '@/lib/navigation';
import { useSession } from '@/components/session';
import { Kbd } from '@/components/ui/primitives';

interface SearchHit {
  type: 'customer' | 'lead' | 'conversation' | 'product' | 'order' | 'deal';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const TYPE_ICON = { customer: Users, lead: Target, conversation: MessagesSquare, product: Package, order: ShoppingCart, deal: Handshake };
const TYPE_LABEL = { customer: 'Customers', lead: 'Leads', conversation: 'Conversations', product: 'Products', order: 'Orders', deal: 'Deals' };

const CommandContext = React.createContext<{ open: () => void }>({ open: () => {} });
export const useCommandPalette = () => React.useContext(CommandContext);

/** Global search + navigation palette (Cmd/Ctrl + K). */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const router = useRouter();
  const { can } = useSession();
  const { setTheme, resolvedTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api.get<{ results: SearchHit[] }>('/search', { q: debounced }),
    enabled: open && debounced.length >= 2,
  });

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const grouped = React.useMemo(() => {
    const out: Partial<Record<SearchHit['type'], SearchHit[]>> = {};
    for (const hit of data?.results ?? []) (out[hit.type] ??= []).push(hit);
    return out;
  }, [data]);

  const quickActions = [
    { label: 'New order', href: '/orders/new', permission: 'orders.create' },
    { label: 'New product', href: '/products/new', permission: 'products.create' },
    { label: 'New lead', href: '/leads?new=1', permission: 'crm.leads.create' },
    { label: 'New customer', href: '/customers?new=1', permission: 'contacts.create' },
    { label: 'New workflow', href: '/automation/workflows/new', permission: 'automation.create' },
  ].filter((a) => can(a.permission));

  const itemClass = 'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground';

  return (
    <CommandContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
            <Command shouldFilter={!debounced || debounced.length < 2} loop>
              <div className="flex items-center gap-2 border-b px-4">
                <Search className="size-4 text-muted-foreground" aria-hidden />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search customers, orders, products… or jump to a page"
                  className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                />
                {isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Kbd>Esc</Kbd>}
              </div>
              <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
                <Command.Empty className="py-10 text-center text-sm text-muted-foreground">No results found.</Command.Empty>
                {debounced.length >= 2 &&
                  (Object.keys(grouped) as SearchHit['type'][]).map((type) => {
                    const Icon = TYPE_ICON[type];
                    return (
                      <Command.Group key={type} heading={TYPE_LABEL[type]} className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                        {grouped[type]!.map((hit) => (
                          <Command.Item key={`${type}-${hit.id}`} value={`${type}-${hit.id}-${hit.title}`} onSelect={() => go(hit.href)} className={itemClass}>
                            <Icon className="size-4 text-muted-foreground" />
                            <span className="truncate text-foreground">{hit.title}</span>
                            {hit.subtitle && <span className="ml-auto truncate text-xs text-muted-foreground">{hit.subtitle}</span>}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    );
                  })}
                {quickActions.length > 0 && (
                  <Command.Group heading="Create" className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {quickActions.map((a) => (
                      <Command.Item key={a.href} value={a.label} onSelect={() => go(a.href)} className={itemClass}>
                        <Plus className="size-4 text-muted-foreground" />
                        <span className="text-foreground">{a.label}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {filterNav(can).map((section) => (
                  <Command.Group key={section.title || 'main'} heading={section.title || 'Go to'} className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {section.items.map((item) => (
                      <Command.Item key={item.href} value={`${section.title} ${item.title}`} onSelect={() => go(item.href)} className={itemClass}>
                        <item.icon className="size-4 text-muted-foreground" />
                        <span className="text-foreground">{item.title}</span>
                        <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
                <Command.Group heading="Preferences" className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  <Command.Item value="toggle theme dark light" onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className={itemClass}>
                    {resolvedTheme === 'dark' ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
                    <span className="text-foreground">Toggle {resolvedTheme === 'dark' ? 'light' : 'dark'} mode</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </CommandContext.Provider>
  );
}
