'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useSession } from '@/components/session';
import { Button } from '@/components/ui/button';

export function AiNotConfigured() {
  const { can } = useSession();
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center">
      <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-medium">AI is not configured</p>
        <p className="text-muted-foreground">Agents will hand conversations to your team until an OpenAI-compatible API key is added.</p>
      </div>
      {can('settings.update') && (
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/ai">Configure AI</Link>
        </Button>
      )}
    </div>
  );
}
