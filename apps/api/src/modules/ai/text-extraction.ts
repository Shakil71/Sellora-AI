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

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
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
