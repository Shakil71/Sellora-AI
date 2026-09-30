import type { Metadata } from 'next';
import { WebChatWidget } from './widget-client';

export const metadata: Metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
};

/** Website chat window, embedded on business websites by /widget.js. */
export default async function WidgetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <WebChatWidget widgetKey={key} />;
}
