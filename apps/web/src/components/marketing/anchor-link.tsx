'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const KEY = 'sellora:scroll-to';

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  return true;
}

/**
 * A link to a section of the home page ("/#pricing") that scrolls there
 * without leaving "#pricing" in the address bar. The href keeps the hash so
 * opening the link in a new tab still works.
 */
export function AnchorLink({ href, onClick, ...rest }: React.ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const router = useRouter();
  const target = typeof href === 'string' ? href : '';
  const id = target.includes('#') ? target.split('#')[1] : undefined;
  if (!id) return <Link href={href} onClick={onClick} {...rest} />;
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (pathname === '/') {
          scrollToId(id);
          window.history.replaceState(null, '', '/');
        } else {
          try {
            sessionStorage.setItem(KEY, id);
          } catch {
            /* the page simply opens at the top */
          }
          router.push('/');
        }
      }}
    />
  );
}

/** Home page helper: finishes a scroll started on another page, and tidies a pasted "/#section" address. */
export function ScrollToAnchor() {
  React.useEffect(() => {
    let id: string | undefined;
    try {
      id = sessionStorage.getItem(KEY) ?? undefined;
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    if (!id && window.location.hash) id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const t = setTimeout(() => {
      scrollToId(id!);
      if (window.location.hash) window.history.replaceState(null, '', '/');
    }, 120);
    return () => clearTimeout(t);
  }, []);
  return null;
}
