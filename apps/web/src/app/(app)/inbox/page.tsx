'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { InboxView } from './inbox-view';

function InboxRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get('conversation');
  const channel = params.get('channel') ?? undefined;
  const select = React.useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('conversation', id);
      else next.delete('conversation');
      router.replace(`/inbox${next.toString() ? `?${next}` : ''}`, { scroll: false });
    },
    [params, router],
  );
  return <InboxView selectedId={selected} onSelect={select} channel={channel} />;
}

export default function InboxPage() {
  return (
    <React.Suspense>
      <InboxRoute />
    </React.Suspense>
  );
}
