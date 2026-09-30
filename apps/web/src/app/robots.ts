import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/register', '/login', '/privacy', '/terms'],
        disallow: ['/api/', '/dashboard', '/inbox', '/settings', '/admin', '/install', '/onboarding', '/orders', '/customers', '/leads', '/products', '/ai', '/automation', '/analytics'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
