'use client';

import * as React from 'react';

/** Page, search and filter state for list screens. Changing a filter resets to page 1. */
export function useListState<F extends Record<string, string | undefined>>(initialFilters: F = {} as F, urlKeys: Array<keyof F | 'search'> = []) {
  const [page, setPage] = React.useState(1);
  const [search, setSearchState] = React.useState('');
  const [filters, setFiltersState] = React.useState<F>(initialFilters);
  // Seed filters from the URL (e.g. /products?categoryId=...) once on mount.
  React.useEffect(() => {
    if (!urlKeys.length || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const seeded: Partial<F> = {};
    for (const key of urlKeys) {
      const value = params.get(String(key));
      if (!value) continue;
      if (key === 'search') setSearchState(value);
      else (seeded as Record<string, string>)[String(key)] = value;
    }
    if (Object.keys(seeded).length) setFiltersState((f) => ({ ...f, ...seeded }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSearch = React.useCallback((v: string) => {
    setSearchState(v);
    setPage(1);
  }, []);
  const setFilter = React.useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFiltersState((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);
  return { page, setPage, search, setSearch, filters, setFilter, query: { page, search: search || undefined, ...filters } };
}

/** Opens a "create" dialog when the URL contains ?new=1 (used by the command palette). */
export function useOpenFromQuery(setOpen: (o: boolean) => void) {
  React.useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1') setOpen(true);
  }, [setOpen]);
}
