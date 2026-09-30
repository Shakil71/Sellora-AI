import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { MobileNav, ThemeToggle } from './header-controls';

const NAV = [
  { href: '/#product', label: 'Product' },
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <Link href="/" aria-label="Sellora AI home" className="justify-self-start">
          <Logo />
        </Link>
        <nav
          aria-label="Main"
          className="hidden items-center gap-1 text-sm text-muted-foreground lg:flex xl:gap-2"
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1.5 font-medium transition-colors hover:bg-muted hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 justify-self-end sm:gap-2 lg:ml-0">
          <ThemeToggle />
          <Button variant="ghost" asChild className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild className="hidden min-[400px]:inline-flex">
            <Link href="/register">Start free</Link>
          </Button>
          <MobileNav items={NAV} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            AI-powered WhatsApp sales and commerce automation for growing businesses.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Product</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="hover:text-foreground">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Company</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-foreground">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Sellora AI. WhatsApp is a trademark of its respective owner;
        Sellora AI uses the official WhatsApp Cloud API.
      </div>
    </footer>
  );
}
