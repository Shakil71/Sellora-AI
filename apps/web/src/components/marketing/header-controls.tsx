'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export function MobileNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X /> : <Menu />}
      </Button>
      {open &&
        createPortal(
          <div
            id="mobile-menu"
            className="fixed inset-x-0 top-16 bottom-0 z-50 animate-in border-t bg-background/95 backdrop-blur duration-200 fade-in slide-in-from-top-2"
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 py-6">
              {items.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-lg font-medium hover:bg-muted"
                >
                  {n.label}
                </Link>
              ))}
              <div className="mt-6 grid gap-3">
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button size="lg" asChild>
                  <Link href="/register">Start free</Link>
                </Button>
              </div>
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
