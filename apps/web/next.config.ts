import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// One .env at the repository root configures the API, worker and web app.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV !== 'production');

const apiInternal = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const securityHeaders = [
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
          ...securityHeaders.filter((h) => h.key !== 'X-Frame-Options'),
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
