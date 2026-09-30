'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import { ApiError, errorMessage } from '@/lib/api';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && [401, 403, 404, 422].includes(err.status)) && count < 2,
      },
    },
    mutationCache: new MutationCache({
      // Mutations show a friendly toast unless they handle errors themselves.
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.options.meta?.silent) return;
        toast.error(errorMessage(err));
      },
    }),
  });
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster position="top-right" richColors closeButton toastOptions={{ className: 'text-sm' }} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
