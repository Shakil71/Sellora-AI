import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** Splits text into overlapping chunks on paragraph / sentence boundaries. */
export function chunkText(text: string, maxChars = 3000, overlapChars = 300): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = current.length > overlapChars ? current.slice(-overlapChars) : '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      // Break very long paragraphs by sentences, then hard-split.
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (sentence.length > maxChars) {
          for (let i = 0; i < sentence.length; i += maxChars - overlapChars) {
            if (current.length + Math.min(maxChars, sentence.length - i) > maxChars) flush();
            current += `${sentence.slice(i, i + maxChars - overlapChars)} `;
          }
          continue;
        }
        if (current.length + sentence.length + 1 > maxChars) flush();
        current += `${sentence} `;
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) flush();
    current += `${paragraph}\n\n`;
  }
  if (current.trim() && (chunks.length === 0 || !chunks[chunks.length - 1]!.endsWith(current.trim()))) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 20 || chunks.length === 1);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1)) || 32) : m))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
  return { title: title ? htmlToText(title).text : undefined, text: body };
}

/** Expands an IPv6 address into its 8 groups (an embedded dotted IPv4 becomes 2 groups). */
function ipv6Groups(ip: string): number[] {
  let v = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number);
    v = `${v.slice(0, -dotted[1]!.length)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const [head, tail] = v.includes('::') ? v.split('::') : [v, undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (g.length !== 8 || g.some((n) => Number.isNaN(n))) return true; // unparseable: refuse
    const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    const zeroPrefix = g.slice(0, 5).every((n) => n === 0);
    // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) reach IPv4 hosts.
    // :: and ::1 land in 0.0.0.0/8 here and are refused with it.
    if (zeroPrefix && (g[5] === 0xffff || g[5] === 0)) return isPrivateAddress(embeddedV4());
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isPrivateAddress(embeddedV4());
    const first = g[0]!;
    return (
      (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (first & 0xffc0) === 0xfec0 || // site-local fec0::/10 (deprecated)
      first >= 0xff00 // multicast
    );
  }
  if (isIP(ip) !== 4) return true; // unparseable: refuse
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

/** Rejects URLs that resolve to internal networks (SSRF protection). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('This address is not publicly reachable');
  }
  return url;
}

/** Fetches a public web page with size, time and redirect limits. */
export async function fetchPublicPage(raw: string, maxBytes = 2 * 1024 * 1024): Promise<{ title?: string; text: string; finalUrl: string }> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'SelloraAI-KnowledgeBot/1.0 (+knowledge base import)', Accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error(`Unsupported content type: ${type || 'unknown'}`);
    const reader = res.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        parts.push(value);
      }
    }
    const body = Buffer.concat(parts).toString('utf8');
    if (type.includes('text/plain')) return { text: body, finalUrl: url.toString() };
    return { ...htmlToText(body), finalUrl: url.toString() };
  }
  throw new Error('Too many redirects');
}

export async function extractPdf(buffer: Buffer): Promise<string> {
  // Import the implementation directly: the package entry runs a debug harness.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text;
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as { extractRawText(input: { buffer: Buffer }): Promise<{ value: string }> };
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
