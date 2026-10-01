import { htmlToText } from '../ai/text-extraction';

/** A product from any source, in the shape Sellora stores it. */
export interface ImportedProduct {
  /** Stable key for this row inside one import. Equals sku when the source has one. */
  key: string;
  sku: string;
  /** False when the SKU was generated because the source had none. */
  skuFromSource: boolean;
  name: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  images: string[];
  category: string | null;
  tags: string[];
  /** Everything else worth keeping: brand, color, size, shape, material, weight, barcode... */
  attributes: Record<string, string>;
  /** Units in stock when the source says; null when it does not. */
  stock: number | null;
  inStock: boolean | null;
  active: boolean;
  sourceUrl: string | null;
}

export interface ParsedCatalog {
  platform: 'shopify' | 'woocommerce' | 'structured-data' | 'feed' | 'csv';
  currency: string | null;
  products: ImportedProduct[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function cleanText(html: unknown, max = 10_000): string | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  const text = /<[a-z][\s\S]*>/i.test(html) ? htmlToText(html).text : html.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/** "$1,200.50", "12.00 USD", "1.200,50 €", "৳ 4500" -> number. Returns null when there is no number. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const m = /-?\d[\d.,\s']*/.exec(value.replace(/[^\S ]/g, ' '));
  if (!m) return null;
  let n = m[0].replace(/[\s']/g, '');
  const lastDot = n.lastIndexOf('.');
  const lastComma = n.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // The separator that comes last is the decimal one.
    n = lastDot > lastComma ? n.replace(/,/g, '') : n.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    n = /,\d{1,2}$/.test(n) ? n.replace(',', '.') : n.replace(/,/g, '');
  }
  const parsed = Number(n);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const CURRENCY_IN_TEXT = /\b([A-Z]{3})\b/;
export function currencyFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = CURRENCY_IN_TEXT.exec(value);
  return m ? m[1]! : null;
}

export function toSku(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .trim()
    .replace(/[^A-Za-z0-9._\-/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return s || null;
}

function slug(value: string, max = 24): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'ITEM'
  );
}

function shortHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/** Generates a stable SKU for products that have none, so re-importing updates instead of duplicating. */
export function generatedSku(name: string, seed: string): string {
  return `AUTO-${slug(name)}-${shortHash(seed || name)}`;
}

function absoluteUrl(src: unknown, base?: string): string | null {
  if (typeof src !== 'string' || !src.trim()) return null;
  try {
    const u = new URL(src.trim().startsWith('//') ? `https:${src.trim()}` : src.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

function imageList(value: unknown, base?: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') {
      // Feeds often join several URLs with commas or pipes.
      for (const part of v.split(/[|\n]|,(?=https?:)/)) {
        const u = absoluteUrl(part, base);
        if (u) out.push(u);
      }
    } else if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      push(o.src ?? o.url ?? o.contentUrl ?? o.image ?? o.original ?? o['@id']);
    }
  };
  push(value);
  return [...new Set(out)].slice(0, 10);
}

function attr(attributes: Record<string, string>, key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return;
  const v = Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'object' ? '' : String(value);
  const k = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!k || !v.trim() || Object.keys(attributes).length >= 30) return;
  attributes[k.charAt(0).toUpperCase() + k.slice(1)] = v.trim().slice(0, 300);
}

function finish(p: Omit<ImportedProduct, 'key' | 'sku' | 'skuFromSource'> & { sku: string | null; seed?: string }): ImportedProduct | null {
  const name = p.name.trim().slice(0, 200);
  if (!name || p.price === null || p.price === undefined) return null;
  const skuFromSource = Boolean(p.sku);
  const sku = p.sku ?? generatedSku(name, p.seed ?? p.sourceUrl ?? name);
  const salePrice = p.salePrice !== null && p.salePrice < p.price ? p.salePrice : null;
  const { seed: _seed, ...rest } = p;
  return { ...rest, name, sku, skuFromSource, key: sku, salePrice, tags: [...new Set(p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30).map((t) => t.slice(0, 40)) };
}

/** Makes SKUs unique inside one catalog (variants and sloppy feeds repeat them). */
export function dedupeSkus(products: ImportedProduct[], warnings: string[]): ImportedProduct[] {
  const seen = new Map<string, number>();
  let renamed = 0;
  const out = products.map((p) => {
    const n = (seen.get(p.sku) ?? 0) + 1;
    seen.set(p.sku, n);
    if (n === 1) return p;
    renamed++;
    const sku = `${p.sku.slice(0, 58)}-${n}`;
    return { ...p, sku, key: sku, skuFromSource: false };
  });
  if (renamed) warnings.push(`${renamed} products shared a SKU with another row, so they were given a numbered SKU.`);
  return out;
}

// ---------------------------------------------------------------------------
// Shopify  (/products.json, public)
// ---------------------------------------------------------------------------

interface ShopifyVariant {
  id: number;
  title?: string;
  sku?: string | null;
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
  inventory_quantity?: number;
  grams?: number;
  barcode?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  image_id?: number | null;
  featured_image?: { src?: string } | null;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle?: string;
  body_html?: string | null;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
  options?: Array<{ name: string; values?: string[] }>;
  images?: Array<{ id: number; src: string; variant_ids?: number[] }>;
}

export function parseShopify(pages: Array<{ products?: ShopifyProduct[] }>, origin: string, currency: string | null): ParsedCatalog {
  const warnings: string[] = [];
  const products: ImportedProduct[] = [];
  for (const p of pages.flatMap((pg) => pg.products ?? [])) {
    const variants = p.variants?.length ? p.variants : [];
    const multi = variants.length > 1 || (variants[0] && variants[0].title && variants[0].title !== 'Default Title');
    const tags = Array.isArray(p.tags) ? p.tags : typeof p.tags === 'string' ? p.tags.split(',') : [];
    for (const v of variants.length ? variants : [{ id: p.id } as ShopifyVariant]) {
      const attributes: Record<string, string> = {};
      attr(attributes, 'Brand', p.vendor);
      attr(attributes, 'Type', p.product_type);
      (p.options ?? []).forEach((o, i) => {
        const val = [v.option1, v.option2, v.option3][i];
        if (val && val !== 'Default Title') attr(attributes, o.name, val);
      });
      attr(attributes, 'Barcode', v.barcode);
      if (v.grams) attr(attributes, 'Weight', `${v.grams} g`);
      const own = p.images?.find((im) => im.id === v.image_id || im.variant_ids?.includes(v.id));
      const images = imageList([own?.src, v.featured_image?.src, ...(p.images ?? []).map((im) => im.src)]);
      const price = parsePrice(v.compare_at_price) ?? parsePrice(v.price);
      const current = parsePrice(v.price);
      const hasCompare = parsePrice(v.compare_at_price) !== null && (parsePrice(v.compare_at_price) ?? 0) > (current ?? 0);
      const variantLabel = multi && v.title && v.title !== 'Default Title' ? ` · ${v.title}` : '';
      const item = finish({
        sku: toSku(v.sku),
        seed: `shopify-${p.id}-${v.id}`,
        name: `${p.title}${variantLabel}`,
        description: cleanText(p.body_html),
        price: hasCompare ? (price ?? 0) : (current ?? 0),
        salePrice: hasCompare ? current : null,
        images,
        category: p.product_type?.trim() || null,
        tags,
        attributes,
        stock: typeof v.inventory_quantity === 'number' ? Math.max(0, v.inventory_quantity) : null,
        inStock: typeof v.available === 'boolean' ? v.available : null,
        active: true,
        sourceUrl: p.handle ? `${origin}/products/${p.handle}` : null,
      });
      if (item) products.push(item);
    }
  }
  if (!currency) warnings.push('The store did not say which currency its prices use. Check the prices before importing.');
  return { platform: 'shopify', currency, products: dedupeSkus(products, warnings), warnings };
}

// ---------------------------------------------------------------------------
// WooCommerce  (public Store API and authenticated REST API)
// ---------------------------------------------------------------------------

interface WooStoreProduct {
  id: number;
  name: string;
  sku?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  prices?: { price?: string; regular_price?: string; sale_price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: Array<{ src?: string }>;
  categories?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  attributes?: Array<{ name: string; terms?: Array<{ name: string }> }>;
  is_in_stock?: boolean;
}

export function parseWooStore(items: WooStoreProduct[]): ParsedCatalog {
  const warnings: string[] = [];
  let currency: string | null = null;
  const products: ImportedProduct[] = [];
  for (const p of items) {
    const minor = p.prices?.currency_minor_unit ?? 2;
    currency ??= p.prices?.currency_code ?? null;
    const conv = (v?: string) => (v && v !== '' ? Number(v) / 10 ** minor : null);
    const regular = conv(p.prices?.regular_price) ?? conv(p.prices?.price);
    const sale = conv(p.prices?.sale_price);
    const attributes: Record<string, string> = {};
    (p.attributes ?? []).forEach((a) => attr(attributes, a.name, (a.terms ?? []).map((t) => t.name)));
    const item = finish({
      sku: toSku(p.sku),
      seed: `woo-${p.id}`,
      name: cleanText(p.name, 200) ?? '',
      description: cleanText(p.description) ?? cleanText(p.short_description),
      price: regular ?? 0,
      salePrice: sale,
      images: imageList((p.images ?? []).map((i) => i.src)),
      category: p.categories?.[0]?.name ?? null,
      tags: (p.tags ?? []).map((t) => t.name),
      attributes,
      stock: null,
      inStock: typeof p.is_in_stock === 'boolean' ? p.is_in_stock : null,
      active: true,
      sourceUrl: p.permalink ?? null,
    });
    if (item) products.push(item);
  }
  return { platform: 'woocommerce', currency, products: dedupeSkus(products, warnings), warnings };
}

interface WooRestProduct {
  id: number;
  name: string;
  sku?: string;
  status?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_quantity?: number | null;
  stock_status?: string;
  manage_stock?: boolean;
  weight?: string;
  dimensions?: { length?: string; width?: string; height?: string };
  images?: Array<{ src?: string }>;
  categories?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  attributes?: Array<{ name: string; options?: string[] }>;
}

export function parseWooRest(items: WooRestProduct[], currency: string | null): ParsedCatalog {
  const warnings: string[] = [];
  const products: ImportedProduct[] = [];
  for (const p of items) {
    const attributes: Record<string, string> = {};
    (p.attributes ?? []).forEach((a) => attr(attributes, a.name, a.options));
    if (p.weight) attr(attributes, 'Weight', p.weight);
    const d = p.dimensions;
    if (d && (d.length || d.width || d.height)) attr(attributes, 'Dimensions', [d.length, d.width, d.height].filter(Boolean).join(' × '));
    const item = finish({
      sku: toSku(p.sku),
      seed: `woo-${p.id}`,
      name: cleanText(p.name, 200) ?? '',
      description: cleanText(p.description) ?? cleanText(p.short_description),
      price: parsePrice(p.regular_price) ?? parsePrice(p.price) ?? 0,
      salePrice: parsePrice(p.sale_price),
      images: imageList((p.images ?? []).map((i) => i.src)),
      category: p.categories?.[0]?.name ?? null,
      tags: (p.tags ?? []).map((t) => t.name),
      attributes,
      stock: typeof p.stock_quantity === 'number' ? Math.max(0, p.stock_quantity) : null,
      inStock: p.stock_status ? p.stock_status === 'instock' || p.stock_status === 'onbackorder' : null,
      active: !p.status || p.status === 'publish',
      sourceUrl: p.permalink ?? null,
    });
    if (item) products.push(item);
  }
  return { platform: 'woocommerce', currency, products: dedupeSkus(products, warnings), warnings };
}

// ---------------------------------------------------------------------------
// schema.org structured data on product pages (JSON-LD + OpenGraph)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function* walkLd(node: unknown): Generator<Json> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkLd(n);
  } else if (node && typeof node === 'object') {
    const o = node as Json;
    yield o;
    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item', 'hasVariant']) if (o[key]) yield* walkLd(o[key]);
  }
}

const isType = (o: Json, type: string) => (Array.isArray(o['@type']) ? (o['@type'] as unknown[]).includes(type) : o['@type'] === type);

function offerOf(o: Json): { price: number | null; currency: string | null; inStock: boolean | null } {
  const raw = o.offers;
  const offers = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Json[];
  let price: number | null = null;
  let currency: string | null = null;
  let inStock: boolean | null = null;
  for (const of of offers) {
    const p = parsePrice(of.price ?? of.lowPrice ?? (of.priceSpecification as Json | undefined)?.price);
    if (p !== null && (price === null || p < price)) price = p;
    currency ??= typeof of.priceCurrency === 'string' ? of.priceCurrency : null;
    if (typeof of.availability === 'string') inStock = /InStock|PreOrder|LimitedAvailability/i.test(of.availability) ? true : inStock === true ? true : false;
  }
  return { price, currency, inStock };
}

export function parseJsonLdProducts(html: string, pageUrl: string): { products: ImportedProduct[]; currency: string | null } {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.trim());
  const found: ImportedProduct[] = [];
  let currency: string | null = null;
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    for (const o of walkLd(data)) {
      if (!isType(o, 'Product') || typeof o.name !== 'string') continue;
      const offer = offerOf(o);
      currency ??= offer.currency;
      const attributes: Record<string, string> = {};
      const brand = o.brand as Json | string | undefined;
      attr(attributes, 'Brand', typeof brand === 'string' ? brand : brand?.name);
      for (const k of ['color', 'material', 'size', 'pattern', 'model', 'gtin', 'gtin13', 'gtin12', 'mpn', 'weight', 'width', 'height', 'depth']) {
        const v = o[k];
        attr(attributes, k, typeof v === 'object' && v && 'value' in v ? (v as Json).value : v);
      }
      for (const ap of (Array.isArray(o.additionalProperty) ? o.additionalProperty : []) as Json[]) attr(attributes, String(ap.name ?? ''), ap.value);
      const item = finish({
        sku: toSku(o.sku ?? o.mpn),
        seed: `${pageUrl}-${o.name}`,
        name: cleanText(o.name, 200) ?? '',
        description: cleanText(o.description),
        price: offer.price ?? 0,
        salePrice: null,
        images: imageList(o.image, pageUrl),
        category: typeof o.category === 'string' ? o.category.split(/[>/]/).pop()!.trim() || null : null,
        tags: [],
        attributes,
        stock: null,
        inStock: offer.inStock,
        active: true,
        sourceUrl: typeof o.url === 'string' ? (absoluteUrl(o.url, pageUrl) ?? pageUrl) : pageUrl,
      });
      if (item && offer.price !== null) found.push(item);
    }
  }
  if (found.length) return { products: found, currency };
  // OpenGraph fallback for pages without JSON-LD.
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1];
  const price = parsePrice(meta('product:price:amount') ?? meta('og:price:amount'));
  const title = meta('og:title');
  if (title && price !== null) {
    const item = finish({
      sku: null,
      seed: pageUrl,
      name: cleanText(title, 200) ?? '',
      description: cleanText(meta('og:description')),
      price,
      salePrice: null,
      images: imageList(meta('og:image'), pageUrl),
      category: null,
      tags: [],
      attributes: {},
      stock: null,
      inStock: null,
      active: true,
      sourceUrl: pageUrl,
    });
    if (item) return { products: [item], currency: meta('product:price:currency') ?? meta('og:price:currency') ?? null };
  }
  return { products: [], currency };
}

// ---------------------------------------------------------------------------
// Generic JSON / CSV feeds
// ---------------------------------------------------------------------------

const FIELDS = {
  name: ['name', 'title', 'product_name', 'productname', 'item_name', 'product_title', 'label'],
  sku: ['sku', 'item_sku', 'product_sku', 'article_number', 'mpn', 'code', 'product_code', 'item_code', 'id', 'product_id', 'item_id'],
  price: ['regular_price', 'compare_at_price', 'list_price', 'mrp', 'price', 'unit_price', 'amount', 'selling_price'],
  sale: ['sale_price', 'special_price', 'discount_price', 'offer_price'],
  description: ['description', 'body_html', 'body', 'details', 'long_description', 'content', 'short_description', 'summary'],
  image: ['image', 'images', 'image_url', 'image_link', 'imageurl', 'img', 'photo', 'picture', 'thumbnail', 'main_image', 'featured_image', 'additional_image_link', 'image_urls'],
  category: ['category', 'product_type', 'categories', 'type', 'collection', 'product_category', 'google_product_category'],
  tags: ['tags', 'keywords', 'labels'],
  stock: ['stock', 'stock_quantity', 'quantity', 'qty', 'inventory', 'inventory_quantity', 'available_quantity', 'on_hand'],
  availability: ['availability', 'in_stock', 'instock', 'stock_status', 'available'],
  status: ['status', 'published', 'active', 'visible'],
  url: ['url', 'link', 'product_url', 'permalink', 'page_url'],
  currency: ['currency', 'currency_code', 'price_currency'],
};
const NON_ATTRIBUTE = new Set(Object.values(FIELDS).flat());

function flatten(record: Json): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const visit = (o: Json, prefix = '', depth = 0) => {
    for (const [k, v] of Object.entries(o)) {
      const key = (prefix + k).toLowerCase().replace(/[\s-]+/g, '_');
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) visit(v as Json, `${key}_`, depth + 1);
      else map.set(key, v);
    }
  };
  visit(record);
  return map;
}

function pick(map: Map<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    const v = map.get(n);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function availabilityToBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return typeof v === 'number' ? v > 0 : null;
  const s = v.toLowerCase();
  if (/out[\s_-]?of[\s_-]?stock|outofstock|sold[\s_-]?out|unavailable|^no$|^false$|^0$/.test(s)) return false;
  if (/in[\s_-]?stock|instock|available|^yes$|^true$|^1$|preorder|backorder/.test(s)) return true;
  return null;
}

export function mapFeedRecord(record: Json, base?: string): ImportedProduct | null {
  const map = flatten(record);
  const name = cleanText(pick(map, FIELDS.name), 200);
  if (!name) return null;
  const rawPrice = pick(map, FIELDS.price);
  const rawSale = pick(map, FIELDS.sale);
  let price = parsePrice(rawPrice);
  let salePrice = parsePrice(rawSale);
  // Shopify-style feeds: "price" is the current price and "compare_at_price" the original one.
  const compare = parsePrice(map.get('compare_at_price'));
  const current = parsePrice(map.get('price'));
  if (compare !== null && current !== null && compare > current) {
    price = compare;
    salePrice = current;
  }
  if (price === null) return null;
  const attributes: Record<string, string> = {};
  for (const [k, v] of map) {
    if (NON_ATTRIBUTE.has(k) || v === null || typeof v === 'object' || String(v).length > 300) continue;
    attr(attributes, k, v);
  }
  const rawStock = pick(map, FIELDS.stock);
  const stockNumber = typeof rawStock === 'number' ? rawStock : typeof rawStock === 'string' && /^\d+$/.test(rawStock.trim()) ? Number(rawStock) : null;
  const availability = availabilityToBool(pick(map, FIELDS.availability));
  const status = pick(map, FIELDS.status);
  const rawCategory = pick(map, FIELDS.category);
  const category = Array.isArray(rawCategory)
    ? String((rawCategory[0] as Json)?.name ?? rawCategory[0] ?? '')
    : typeof rawCategory === 'string'
      ? rawCategory.split(/[>,|/]/).pop()!.trim()
      : '';
  const rawTags = pick(map, FIELDS.tags);
  const tags = Array.isArray(rawTags) ? rawTags.map(String) : typeof rawTags === 'string' ? rawTags.split(/[,|]/) : [];
  const sourceSku = pick(map, FIELDS.sku);
  return finish({
    sku: toSku(sourceSku),
    seed: String(sourceSku ?? name),
    name,
    description: cleanText(pick(map, FIELDS.description)),
    price,
    salePrice,
    images: imageList(FIELDS.image.map((n) => map.get(n)), base),
    category: category || null,
    tags,
    attributes,
    stock: stockNumber !== null ? Math.max(0, stockNumber) : null,
    inStock: stockNumber !== null ? stockNumber > 0 : availability,
    active: status === undefined ? true : !/^(draft|hidden|inactive|false|0|private|archived|unpublished)$/i.test(String(status)),
    sourceUrl: absoluteUrl(pick(map, FIELDS.url), base),
  });
}

/** Finds the product array inside whatever JSON the API returned. */
export function findRecords(data: unknown, depth = 0): Json[] | null {
  if (Array.isArray(data)) return data.length && typeof data[0] === 'object' ? (data as Json[]) : null;
  if (!data || typeof data !== 'object' || depth > 3) return null;
  const o = data as Json;
  for (const k of ['products', 'items', 'data', 'results', 'records', 'rows', 'entries', 'catalog', 'list']) {
    const hit = findRecords(o[k], depth + 1);
    if (hit) return hit;
  }
  for (const v of Object.values(o)) {
    const hit = Array.isArray(v) ? findRecords(v, depth + 1) : null;
    if (hit) return hit;
  }
  return null;
}

export function parseJsonFeed(data: unknown, base?: string): ParsedCatalog | null {
  const records = findRecords(data);
  if (!records) return null;
  const warnings: string[] = [];
  const products = records.map((r) => mapFeedRecord(r, base)).filter((p): p is ImportedProduct => p !== null);
  const skipped = records.length - products.length;
  if (skipped) warnings.push(`${skipped} rows were skipped because they have no name or no price.`);
  const first = records[0] ? flatten(records[0]) : new Map();
  const currency = currencyFrom(pick(first, FIELDS.currency)) ?? currencyFrom(pick(first, FIELDS.price));
  return { platform: 'feed', currency, products: dedupeSkus(products, warnings), warnings };
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes, ; or , or tab separators). */
export function parseCsv(text: string): Json[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]?.trim() ?? ''])).valueOf() as Json);
}

export function parseCsvFeed(text: string, base?: string): ParsedCatalog | null {
  const records = parseCsv(text);
  if (!records.length) return null;
  const parsed = parseJsonFeed(records, base);
  return parsed ? { ...parsed, platform: 'csv' } : null;
}

/** Google Merchant / RSS style XML feeds: <item> or <entry> blocks with simple child tags. */
export function parseXmlFeed(xml: string, base?: string): ParsedCatalog | null {
  const blocks = [...xml.matchAll(/<(item|entry|product)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!);
  if (!blocks.length) return null;
  const records: Json[] = blocks.map((b) => {
    const rec: Record<string, string> = {};
    for (const m of b.matchAll(/<([\w:.-]+)(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g)) {
      const key = m[1]!.replace(/^g:/, '');
      const value = m[2]!.trim();
      if (!value || /^</.test(value)) continue;
      rec[key] = rec[key] ? `${rec[key]}|${value}` : value;
    }
    return rec;
  });
  const parsed = parseJsonFeed(records, base);
  return parsed ? { ...parsed, platform: 'feed' } : null;
}
