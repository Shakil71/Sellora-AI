import { DEFAULT_HOME_CONTENT, mergeHomeContent, type HomeContent } from '@sellora/shared';

export interface HomePricing {
  currency: string;
  prices: Record<string, number | null>;
  custom: boolean;
}

export interface HomeData {
  content: HomeContent;
  pricing: HomePricing;
}

const FALLBACK: HomeData = { content: DEFAULT_HOME_CONTENT, pricing: { currency: 'USD', prices: {}, custom: false } };

/**
 * Home page text and plan prices, fetched by the web server from the API.
 * Cached for 30 seconds, so a saved change shows up within half a minute,
 * and the page still renders from the built-in text if the API is unreachable.
 */
export async function getHome(): Promise<HomeData> {
  const base = process.env.API_INTERNAL_URL || 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/api/v1/site/home`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as { data?: { content?: unknown; pricing?: HomePricing } };
    if (!json.data) return FALLBACK;
    return { content: mergeHomeContent(json.data.content), pricing: json.data.pricing ?? FALLBACK.pricing };
  } catch {
    return FALLBACK;
  }
}
