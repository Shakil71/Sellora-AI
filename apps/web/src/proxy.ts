import { NextResponse, type NextRequest } from 'next/server';

/** Route prefixes that need a signed-in session. */
const PROTECTED = [
  '/dashboard', '/inbox', '/conversations', '/leads', '/customers', '/deals', '/pipelines', '/tasks',
  '/products', '/categories', '/inventory', '/orders', '/invoices', '/payments', '/deliveries',
  '/whatsapp', '/integrations', '/ai', '/automation', '/analytics', '/settings', '/notifications', '/profile', '/admin', '/onboarding',
];
const AUTH_PAGES = ['/login', '/register'];

/**
 * Lightweight redirect layer. The `sellora_auth` hint cookie only says a
 * session exists; real authorization is always enforced by the API.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has('sellora_auth') || request.cookies.has('sellora_at');

  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|health|socket\\.io|_next/static|_next/image|brand|icon.svg|favicon.ico|robots.txt|sitemap.xml).*)'],
};
