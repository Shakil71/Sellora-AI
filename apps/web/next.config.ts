import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// One .env at the repository root configures the API, worker and web app.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV !== 'production');

const apiInternal = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const isDev = process.env.NODE_ENV !== 'production';
const origin = (url?: string) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};
// Where the browser may connect: this site, the API (if on another origin) and live updates over WebSocket.
const connectSources = ["'self'", origin(process.env.API_URL), origin(process.env.NEXT_PUBLIC_SOCKET_URL), ...(isDev ? ['ws:', 'http://localhost:*'] : ['wss:'])].filter(Boolean);

/**
 * Content Security Policy: only this site's own scripts may run (plus the inline ones Next.js emits),
 * nothing can be framed, plugins are off, and forms can only post back to this site.
 * Images may come from any https address because product photos can be linked from other shops.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  `connect-src ${connectSources.join(' ')}`,
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: ['@sellora/shared'],
  env: {
    NEXT_PUBLIC_APP_URL: process.env.APP_URL || 'http://localhost:3000',
    NEXT_PUBLIC_APP_NAME: process.env.APP_NAME || 'Sellora AI',
    // Socket.IO connects to this origin; empty = same origin (behind Nginx).
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL ?? (process.env.NODE_ENV === 'production' ? '' : apiInternal),
  },
  images: { unoptimized: true },
  async headers() {
    return [
      // Every page refuses to be framed, except the website chat window that
      // businesses embed on their own sites through /widget.js.
      { source: '/((?!widget/).*)', headers: securityHeaders },
      {
        source: '/widget/:path*',
        headers: [
          ...securityHeaders.filter((h) => !['X-Frame-Options', 'Content-Security-Policy'].includes(h.key)),
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
      { source: '/(dashboard|inbox|settings|onboarding|install)(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
  // In development (and non-Nginx setups) the web server proxies the REST API,
  // so browser requests stay same-origin and cookies remain first-party.
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiInternal}/api/v1/:path*` },
      { source: '/health/:path*', destination: `${apiInternal}/health/:path*` },
    ];
  },
};

export default nextConfig;
