import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../commerce/products.service';
import { UploadsService } from '../storage/uploads.service';
import { assertPublicUrl } from '../ai/text-extraction';
import { AppException, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';
import {
  ImportedProduct,
  ParsedCatalog,
  parseCsvFeed,
  parseJsonFeed,
  parseJsonLdProducts,
  parseShopify,
  parseWooRest,
  parseWooStore,
  parseXmlFeed,
} from './parsers';

/** Most products one import reads. Bigger catalogs can be imported in several rounds. */
const MAX_PRODUCTS = 500;
const CACHE_TTL_SECONDS = 30 * 60;
const BATCH_MAX = 25;

export const importSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('website'), url: z.string().trim().url().max(500) }),
  z.object({
    source: z.literal('woocommerce'),
    url: z.string().trim().url().max(500),
    consumerKey: z.string().trim().min(8).max(200),
    consumerSecret: z.string().trim().min(8).max(200),
  }),
  z.object({
    source: z.literal('feed'),
    url: z.string().trim().url().max(1000),
    /** Optional API key sent as a header, e.g. Authorization: Bearer ... or X-API-Key: ... */
    headerName: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,60}$/, 'Header names can contain letters, numbers and dashes')
      .optional(),
    headerValue: z.string().trim().max(1000).optional(),
  }),
  z.object({ source: z.literal('csv'), csv: z.string().min(10).max(5 * 1024 * 1024) }),
]);
export type ImportSource = z.infer<typeof importSourceSchema>;

export const runImportSchema = z.object({
  importId: z.string().uuid(),
  /** Keys (SKUs) from the preview to import in this batch. */
  keys: z.array(z.string().max(80)).min(1).max(BATCH_MAX),
  mode: z.enum(['skip', 'update']).default('skip'),
  /** Copy product photos into your own storage so they never break. */
  downloadImages: z.boolean().default(true),
  /** Stock given to products whose source does not say how many are available. */
  defaultStock: z.number().int().min(0).max(1_000_000).default(0),
  status: z.enum(['source', 'ACTIVE', 'DRAFT']).default('source'),
});

interface FetchResult {
  status: number;
  body: Buffer;
  text: string;
  contentType: string;
  finalUrl: string;
  headers: Headers;
}

interface FetchOptions {
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
}

/** Fetches a public URL with SSRF protection, redirect, size and time limits. */
async function fetchPublic(raw: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'SelloraAI-ProductImport/1.0', Accept: 'application/json,text/html,text/csv,application/xml,*/*;q=0.5', ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    const max = opts.maxBytes ?? 12 * 1024 * 1024;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          break;
        }
        parts.push(value);
      }
    }
    const body = Buffer.concat(parts);
    return { status: res.status, body, text: body.toString('utf8'), contentType: res.headers.get('content-type') ?? '', finalUrl: url.toString(), headers: res.headers };
  }
  throw new Error('Too many redirects');
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const friendly = (err: unknown, what: string) =>
  new ValidationError(`${what}: ${err instanceof Error ? err.message : 'something went wrong'}`);

/** Reads products from a store, API, feed or file, shows a preview, then imports them with their photos. */
@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly uploads: UploadsService,
  ) {}

  // ------------------------------------------------------------------ sources

  private async loadShopify(origin: string): Promise<ParsedCatalog | null> {
    const pages: Array<{ products?: unknown[] }> = [];
    for (let page = 1; page <= 4; page++) {
      const res = await fetchPublic(`${origin}/products.json?limit=250&page=${page}`, { timeoutMs: 15_000 }).catch(() => null);
      const json = res?.status === 200 ? (tryJson(res.text) as { products?: unknown[] } | undefined) : undefined;
      if (!json?.products) return page === 1 ? null : parseShopify(pages as never, origin, null);
      pages.push(json);
      if (json.products.length < 250) break;
    }
    const meta = await fetchPublic(`${origin}/meta.json`, { timeoutMs: 8_000 }).catch(() => null);
    const currency = (tryJson(meta?.text ?? '') as { currency?: string } | undefined)?.currency ?? null;
    return parseShopify(pages as never, origin, currency);
  }

  private async loadWooStore(origin: string): Promise<ParsedCatalog | null> {
    const all: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetchPublic(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { timeoutMs: 15_000 }).catch(() => null);
      const json = res?.status === 200 ? tryJson(res.text) : undefined;
      if (!Array.isArray(json)) return page === 1 ? null : parseWooStore(all as never);
      all.push(...json);
      if (page >= Number(res!.headers.get('x-wp-totalpages') ?? 1)) break;
    }
    return all.length ? parseWooStore(all as never) : null;
  }

  private async loadSitemapPages(origin: string, started: number): Promise<ParsedCatalog | null> {
    const locs = async (xmlUrl: string) => {
      const res = await fetchPublic(xmlUrl, { timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 }).catch(() => null);
      return res?.status === 200 ? [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, '&')) : [];
    };
    let urls: string[] = [];
    const roots = await locs(`${origin}/sitemap.xml`);
    const children = roots.filter((u) => /\.xml(\.gz)?(\?|$)/i.test(u));
    if (children.length) {
      const preferred = children.filter((u) => /product|shop|item|catalog/i.test(u)).slice(0, 3);
      for (const c of preferred.length ? preferred : children.slice(0, 2)) urls.push(...(await locs(c)));
    } else urls = roots;
    const looksLikeProduct = (u: string) => /product|\/p\/|\/item|\/shop\/|\/goods|\/buy/i.test(u) && !/\.(jpg|png|webp|xml)$/i.test(u);
    urls = [...new Set(urls.filter(looksLikeProduct))].slice(0, 60);
    if (!urls.length) return null;
    const found: ImportedProduct[] = [];
    let currency: string | null = null;
    const queue = [...urls];
    const worker = async () => {
      while (queue.length && Date.now() - started < 50_000) {
        const url = queue.shift()!;
        const res = await fetchPublic(url, { timeoutMs: 10_000, maxBytes: 3 * 1024 * 1024 }).catch(() => null);
        if (res?.status !== 200) continue;
        const parsed = parseJsonLdProducts(res.text, res.finalUrl);
        currency ??= parsed.currency;
        found.push(...parsed.products);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return found.length ? { platform: 'structured-data', currency, products: found, warnings: [`Read ${urls.length} product pages from the sitemap. Stock levels are not shown on web pages.`] } : null;
  }

  /** Tries the platform APIs first (best data), then product-page markup. */
  private async loadWebsite(rawUrl: string): Promise<ParsedCatalog> {
    const started = Date.now();
    let url: URL;
    try {
      url = await assertPublicUrl(rawUrl);
    } catch (err) {
      throw friendly(err, 'That address cannot be used');
    }
    const origin = url.origin;
    const catalog = (await this.loadShopify(origin)) ?? (await this.loadWooStore(origin));
    if (catalog?.products.length) return catalog;
    const page = await fetchPublic(url.toString(), { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 }).catch(() => null);
    if (page && page.status === 200) {
      const parsed = parseJsonLdProducts(page.text, page.finalUrl);
      if (parsed.products.length) {
        return { platform: 'structured-data', currency: parsed.currency, products: parsed.products, warnings: ['Read from the product details on this page. Stock levels are not shown on web pages.'] };
      }
    } else if (page && page.status >= 400) {
      throw new ValidationError(`The website answered with an error (HTTP ${page.status}). Check the address.`);
    }
    const viaSitemap = await this.loadSitemapPages(origin, started);
    if (viaSitemap) return viaSitemap;
    throw new ValidationError(
      'We could not find products at that address. Shopify and WooCommerce stores work with just the store link. For other sites, use “Product feed or API” with your product data URL, or upload a CSV file.',
    );
  }

  private async loadWooRest(src: Extract<ImportSource, { source: 'woocommerce' }>): Promise<ParsedCatalog> {
    const origin = new URL(src.url).origin;
    const auth = `Basic ${Buffer.from(`${src.consumerKey}:${src.consumerSecret}`).toString('base64')}`;
    const all: unknown[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetchPublic(`${origin}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`, { headers: { Authorization: auth }, timeoutMs: 20_000 }).catch((e) => {
        throw friendly(e, 'Could not reach your WooCommerce store');
      });
      if (res.status === 401 || res.status === 403) throw new ValidationError('WooCommerce rejected these keys. Create a key with Read permission under WooCommerce → Settings → Advanced → REST API.');
      if (res.status === 404) throw new ValidationError('The WooCommerce REST API was not found. Check the store address and that WooCommerce is active.');
      const json = tryJson(res.text);
      if (!Array.isArray(json)) throw new ValidationError('WooCommerce returned an unexpected answer.');
      all.push(...json);
      if (page >= Number(res.headers.get('x-wp-totalpages') ?? 1)) break;
    }
    let currency: string | null = null;
    const cur = await fetchPublic(`${origin}/wp-json/wc/v3/data/currencies/current`, { headers: { Authorization: auth }, timeoutMs: 8_000 }).catch(() => null);
    currency = (tryJson(cur?.text ?? '') as { code?: string } | undefined)?.code ?? null;
    return parseWooRest(all as never, currency);
  }

  private async loadFeed(src: Extract<ImportSource, { source: 'feed' }>): Promise<ParsedCatalog> {
    const headers: Record<string, string> = src.headerName && src.headerValue ? { [src.headerName]: src.headerValue } : {};
    const res = await fetchPublic(src.url, { headers }).catch((e) => {
      throw friendly(e, 'Could not read that address');
    });
    if (res.status === 401 || res.status === 403) throw new ValidationError('The server refused access. Add the API key header it expects.');
    if (res.status >= 400) throw new ValidationError(`The server answered with an error (HTTP ${res.status}).`);
    const text = res.text.trim();
    const json = tryJson(text);
    const parsed =
      (json !== undefined ? parseJsonFeed(json, res.finalUrl) : null) ??
      (/^<\?xml|<rss|<feed|<item/i.test(text.slice(0, 300)) ? parseXmlFeed(text, res.finalUrl) : null) ??
      (json === undefined ? parseCsvFeed(text, res.finalUrl) : null);
    if (!parsed?.products.length) {
      throw new ValidationError('We could read the address but found no products in it. It should return a JSON list, an XML product feed or a CSV file with at least a name and a price per product.');
    }
    return parsed;
  }

  // ------------------------------------------------------------------ preview

  async preview(actor: Actor, source: ImportSource) {
    let catalog: ParsedCatalog;
    switch (source.source) {
      case 'website':
        catalog = await this.loadWebsite(source.url);
        break;
      case 'woocommerce':
        catalog = await this.loadWooRest(source);
        break;
      case 'feed':
        catalog = await this.loadFeed(source);
        break;
      case 'csv': {
        const parsed = parseCsvFeed(source.csv);
        if (!parsed?.products.length) throw new ValidationError('No products found in the file. The first row must be column names, and each product needs at least a name and a price.');
        catalog = parsed;
        break;
      }
    }
    const warnings = [...catalog.warnings];
    let products = catalog.products;
    if (products.length > MAX_PRODUCTS) {
      warnings.push(`This catalog has ${products.length} products. The first ${MAX_PRODUCTS} are shown; import again afterwards to bring in the rest (already imported products are skipped).`);
      products = products.slice(0, MAX_PRODUCTS);
    }
    const [tenant, existing] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { currency: true } }),
      this.prisma.product.findMany({ where: { tenantId: actor.tenantId, sku: { in: products.map((p) => p.sku) } }, select: { sku: true } }),
    ]);
    const workspaceCurrency = tenant?.currency ?? 'USD';
    if (catalog.currency && catalog.currency !== workspaceCurrency) {
      warnings.push(`Prices are in ${catalog.currency} but your workspace uses ${workspaceCurrency}. Prices are imported as they are, without conversion.`);
    }
    const existingSkus = new Set(existing.map((e) => e.sku));
    const importId = randomUUID();
    await this.redis.setJson(this.cacheKey(actor.tenantId, importId), { products }, CACHE_TTL_SECONDS);
    return {
      importId,
      platform: catalog.platform,
      currency: catalog.currency,
      workspaceCurrency,
      total: products.length,
      summary: {
        new: products.filter((p) => !existingSkus.has(p.sku)).length,
        existing: products.filter((p) => existingSkus.has(p.sku)).length,
        withImages: products.filter((p) => p.images.length).length,
        generatedSku: products.filter((p) => !p.skuFromSource).length,
        categories: new Set(products.map((p) => p.category).filter(Boolean)).size,
      },
      warnings,
      products: products.map((p) => ({
        key: p.key,
        sku: p.sku,
        skuFromSource: p.skuFromSource,
        name: p.name,
        description: p.description?.slice(0, 220) ?? null,
        price: p.price,
        salePrice: p.salePrice,
        image: p.images[0] ?? null,
        imageCount: p.images.length,
        category: p.category,
        attributes: p.attributes,
        stock: p.stock,
        inStock: p.inStock,
        exists: existingSkus.has(p.sku),
      })),
    };
  }

  private cacheKey(tenantId: string, importId: string) {
    return `product-import:${tenantId}:${importId}`;
  }

  // --------------------------------------------------------------------- run

  private async downloadImage(actor: Actor, url: string): Promise<string | null> {
    try {
      const res = await fetchPublic(url, { timeoutMs: 10_000, maxBytes: 6 * 1024 * 1024, headers: { Accept: 'image/*' } });
      if (res.status !== 200 || !/^image\//i.test(res.contentType)) return null;
      const buffer = res.body;
      if (buffer.length >= 6 * 1024 * 1024 || buffer.length < 100) return null;
      const target = new URL(res.finalUrl);
      const name = decodeURIComponent(target.pathname.split('/').pop() || 'image').slice(0, 100) || 'image';
      const stored = await this.uploads.store(actor, { buffer, originalname: /\.\w{2,5}$/.test(name) ? name : `${name}.jpg`, size: buffer.length }, 'product');
      return stored.url;
    } catch (err) {
      this.logger.debug(`Image not copied (${url}): ${(err as Error).message}`);
      return null;
    }
  }

  private async resolveImages(actor: Actor, urls: string[], download: boolean): Promise<string[]> {
    if (!download) return urls.slice(0, 10);
    const out: string[] = [];
    const queue = urls.slice(0, 6);
    let index = 0;
    const results: Array<string | null> = new Array(queue.length).fill(null);
    const worker = async () => {
      while (index < queue.length) {
        const i = index++;
        results[i] = await this.downloadImage(actor, queue[i]!);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    results.forEach((r, i) => out.push(r ?? queue[i]!)); // keep the original link when copying fails
    return out.slice(0, 10);
  }

  private async categoryId(actor: Actor, name: string | null, cache: Map<string, string>): Promise<string | null> {
    const clean = name?.trim().slice(0, 80);
    if (!clean) return null;
    const hit = cache.get(clean.toLowerCase());
    if (hit) return hit;
    const found = await this.prisma.category.findFirst({ where: { tenantId: actor.tenantId, name: { equals: clean, mode: 'insensitive' } } });
    const id = found?.id ?? (await this.products.createCategory(actor, { name: clean })).id;
    cache.set(clean.toLowerCase(), id);
    return id;
  }

  /** Imports one batch of products from a previous preview. */
  async run(actor: Actor, input: z.infer<typeof runImportSchema>) {
    const cached = await this.redis.getJson<{ products: ImportedProduct[] }>(this.cacheKey(actor.tenantId, input.importId));
    if (!cached) throw new AppException('IMPORT_EXPIRED', 'This preview expired. Load your products again.', 410);
    const byKey = new Map(cached.products.map((p) => [p.key, p]));
    const categories = new Map<string, string>();
    const results: Array<{ key: string; sku: string; name: string; outcome: 'created' | 'updated' | 'skipped' | 'failed'; error?: string }> = [];
    let limitReached = false;

    for (const key of input.keys) {
      const p = byKey.get(key);
      if (!p) continue;
      const base = { key, sku: p.sku, name: p.name };
      if (limitReached) {
        results.push({ ...base, outcome: 'failed', error: 'Your plan’s product limit was reached.' });
        continue;
      }
      try {
        const existing = await this.prisma.product.findFirst({ where: { tenantId: actor.tenantId, sku: p.sku } });
        if (existing && input.mode === 'skip') {
          results.push({ ...base, outcome: 'skipped' });
          continue;
        }
        const images = await this.resolveImages(actor, p.images, input.downloadImages);
        const categoryId = await this.categoryId(actor, p.category, categories);
        const status = input.status === 'source' ? (p.active ? 'ACTIVE' : 'DRAFT') : input.status;
        if (existing) {
          await this.products.update(actor, existing.id, {
            name: p.name,
            description: p.description,
            price: p.price,
            salePrice: p.salePrice,
            categoryId,
            ...(images.length ? { images } : {}),
            tags: p.tags,
            attributes: Object.keys(p.attributes).length ? p.attributes : undefined,
          });
          results.push({ ...base, outcome: 'updated' });
        } else {
          const stock = p.stock ?? (p.inStock === false ? 0 : input.defaultStock);
          await this.products.create(actor, {
            name: p.name,
            sku: p.sku,
            description: p.description,
            price: p.price,
            salePrice: p.salePrice,
            categoryId,
            images,
            status,
            tags: p.tags,
            attributes: Object.keys(p.attributes).length ? p.attributes : undefined,
            trackInventory: true,
            initialStock: stock,
          });
          results.push({ ...base, outcome: 'created' });
        }
      } catch (err) {
        if (err instanceof AppException && err.code === 'PLAN_LIMIT_REACHED') limitReached = true;
        results.push({ ...base, outcome: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : 'Unknown error' });
      }
    }
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    await this.audit.log(actor, {
      action: 'product.imported',
      entityType: 'Product',
      metadata: { created: count('created'), updated: count('updated'), skipped: count('skipped'), failed: count('failed') },
    });
    return { results, limitReached };
  }

  async discard(actor: Actor, importId: string) {
    await this.redis.del(this.cacheKey(actor.tenantId, importId));
    return { discarded: true };
  }
}
