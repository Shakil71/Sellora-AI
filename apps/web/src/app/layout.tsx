import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Sellora AI — AI-Powered WhatsApp Sales & Commerce Automation',
    template: '%s · Sellora AI',
  },
  description:
    'Sellora AI combines AI sales automation, WhatsApp conversations, CRM, product management and order automation in one powerful platform.',
  applicationName: 'Sellora AI',
  keywords: ['WhatsApp sales', 'AI sales agent', 'WhatsApp CRM', 'conversational commerce', 'order automation', 'WhatsApp Business API'],
  openGraph: {
    type: 'website',
    siteName: 'Sellora AI',
    title: 'Sellora AI — Turn WhatsApp Conversations Into Revenue',
    description: 'AI sales agent, WhatsApp inbox, CRM, catalog and order automation in one platform.',
    url: appUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sellora AI — Turn WhatsApp Conversations Into Revenue',
    description: 'AI sales agent, WhatsApp inbox, CRM, catalog and order automation in one platform.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#16171b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
