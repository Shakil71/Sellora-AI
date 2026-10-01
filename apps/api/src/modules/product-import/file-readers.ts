import * as ExcelJS from 'exceljs';
import { extractPdf } from '../ai/text-extraction';
import { ValidationError } from '../../common/errors';
import { ImportedProduct, ParsedCatalog, cleanText, dedupeSkus, generatedSku, parseCsvFeed, parseJsonFeed, parsePrice, parseXmlFeed } from './parsers';

type Row = Record<string, unknown>;

/** What a spreadsheet cell holds, as plain text or a number. */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return value;
  const v = value as unknown as Record<string, unknown>;
  if (Array.isArray(v.richText)) return (v.richText as Array<{ text: string }>).map((t) => t.text).join('');
  if ('result' in v) return cellValue(v.result as ExcelJS.CellValue); // formula
  if ('hyperlink' in v) {
    // Image cells are often links whose label is not the URL.
    const text = typeof v.text === 'string' ? v.text : '';
    return /^https?:\/\//i.test(text) ? text : String(v.hyperlink);
  }
  if ('text' in v) return String(v.text);
  if ('error' in v) return '';
  return '';
}

/** Turns table rows (first row = column names) into records keyed by column name. */
function rowsToRecords(rows: unknown[][]): Row[] {
  // The header is the first row with at least two filled cells; sheets often start with a title.
  const headerAt = rows.findIndex((r) => r.filter((c) => String(c ?? '').trim() !== '').length >= 2);
  if (headerAt < 0) return [];
  const header = rows[headerAt]!.map((h) => String(h ?? '').trim());
  const records: Row[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
    const rec: Row = {};
    header.forEach((h, i) => {
      if (h) rec[h] = r[i] ?? '';
    });
    records.push(rec);
  }
  return records;
}

async function parseExcel(buffer: Buffer): Promise<ParsedCatalog> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError('That Excel file could not be opened. Save it as .xlsx (Excel Workbook) and try again.');
  }
  const warnings: string[] = [];
  const products: ImportedProduct[] = [];
  let currency: string | null = null;
  for (const sheet of workbook.worksheets) {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: unknown[] = [];
      for (let c = 1; c <= Math.min(sheet.columnCount, 60); c++) values.push(cellValue(row.getCell(c).value));
      rows.push(values);
    });
    const parsed = parseJsonFeed(rowsToRecords(rows));
    if (!parsed?.products.length) continue;
    currency ??= parsed.currency;
    products.push(...parsed.products);
    parsed.warnings.forEach((w) => warnings.push(workbook.worksheets.length > 1 ? `${sheet.name}: ${w}` : w));
    if (products.length > 5000) break;
  }
  if (!products.length) {
    throw new ValidationError('No products found. The first row of the sheet must contain column names such as Name, SKU, Price, Image and Category.');
  }
  if (workbook.worksheets.length > 1) warnings.push(`Combined products from all sheets that have a name and a price column.`);
  warnings.push('Photos must be web links in a column such as Image. Pictures pasted inside Excel cells cannot be imported.');
  return { platform: 'excel', currency, products: dedupeSkus(products, warnings), warnings };
}

/** Product lists written as plain text (PDF, Word without a table): one product per line. */
export function parseTextCatalog(text: string): ParsedCatalog | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const cells = (l: string) => l.split(/\t+| {2,}| \| |;/).map((c) => c.trim()).filter(Boolean);
  const warnings = ['Read from document text. Check every product in the preview, because layouts differ.'];

  // 1) A header row followed by aligned rows ("Name   SKU   Price").
  const hasName = (c: string[]) => c.some((x) => /^(name|product|item|title|description)$/i.test(x));
  const hasPrice = (c: string[]) => c.some((x) => /^(price|rate|mrp|cost|amount|unit price)$/i.test(x));
  const headerAt = lines.findIndex((l) => {
    const c = cells(l);
    return c.length >= 2 && hasName(c) && hasPrice(c);
  });
  if (headerAt >= 0) {
    const header = cells(lines[headerAt]!);
    const records: Row[] = [];
    for (const l of lines.slice(headerAt + 1)) {
      const c = cells(l);
      if (c.length < 2) continue;
      records.push(Object.fromEntries(header.map((h, i) => [h, c[i] ?? ''])));
    }
    const parsed = parseJsonFeed(records);
    if (parsed?.products.length) return { ...parsed, platform: 'document', warnings: [...warnings, ...parsed.warnings] };
  }

  // 2) "Product name ..... $12.50" style lines.
  const products: ImportedProduct[] = [];
  const money = '(?:[$€£৳₹]|USD|EUR|GBP|BDT|INR|Tk\\.?)';
  const re = new RegExp(`^(?:\\d+[.)]\\s+)?(.{2,100}?)\\s*[-–—:.|]*\\s*${money}?\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s*${money}?$`, 'i');
  for (const l of lines) {
    const m = re.exec(l);
    if (!m) continue;
    const name = m[1]!.replace(/[.\s-]+$/, '').trim();
    const price = parsePrice(m[2]);
    if (!/[A-Za-zÀ-ɏঀ-৿]/.test(name) || price === null || name.length < 2) continue;
    const sku = generatedSku(name, name);
    products.push({
      key: sku,
      sku,
      skuFromSource: false,
      name: cleanText(name, 200) ?? name,
      description: null,
      price,
      salePrice: null,
      images: [],
      category: null,
      tags: [],
      attributes: {},
      stock: null,
      inStock: null,
      active: true,
      sourceUrl: null,
    });
  }
  if (!products.length) return null;
  return { platform: 'document', currency: null, products: dedupeSkus(products, warnings), warnings: [...warnings, 'Document lists carry no photos or SKUs; add them later or use a spreadsheet for full details.'] };
}

/** Reads the tables of a Word document (Word tables are the usual way price lists are written). */
async function parseDocx(buffer: Buffer): Promise<ParsedCatalog> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    convertToHtml(input: { buffer: Buffer }): Promise<{ value: string }>;
    extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
  };
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const strip = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const products: ImportedProduct[] = [];
  const warnings: string[] = [];
  let currency: string | null = null;
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => strip(td[1]!)));
    const parsed = parseJsonFeed(rowsToRecords(rows));
    if (!parsed?.products.length) continue;
    currency ??= parsed.currency;
    products.push(...parsed.products);
    warnings.push(...parsed.warnings);
  }
  if (products.length) {
    warnings.push('Read from the tables in your document. Photos inside Word cannot be imported; use image links in a column instead.');
    return { platform: 'document', currency, products: dedupeSkus(products, warnings), warnings };
  }
  const { value: text } = await mammoth.extractRawText({ buffer });
  const fromText = parseTextCatalog(text);
  if (!fromText) {
    throw new ValidationError('No products found in this Word document. Put your products in a table with columns such as Name, SKU and Price, or one product per line with its price.');
  }
  return fromText;
}

async function parsePdf(buffer: Buffer): Promise<ParsedCatalog> {
  let text: string;
  try {
    text = await extractPdf(buffer);
  } catch {
    throw new ValidationError('That PDF could not be read. It may be a scan or protected. Export it as text or use a spreadsheet.');
  }
  if (text.trim().length < 10) throw new ValidationError('This PDF has no readable text (it looks like a scanned image). Use a spreadsheet or CSV instead.');
  const parsed = parseTextCatalog(text);
  if (!parsed) throw new ValidationError('No products found in this PDF. Lines should look like “Product name  12.50”, or a table with Name and Price columns. A spreadsheet works best.');
  return { ...parsed, platform: 'document' };
}

/** Text based formats: JSON, XML, CSV/TSV, or a plain text list. */
function parseTextFile(text: string): ParsedCatalog {
  const trimmed = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    json = undefined;
  }
  const parsed =
    (json !== undefined ? parseJsonFeed(json) : null) ??
    (/^<\?xml|<rss|<feed|<item|<product/i.test(trimmed.slice(0, 400)) ? parseXmlFeed(trimmed) : null) ??
    (json === undefined ? parseCsvFeed(trimmed) : null) ??
    parseTextCatalog(trimmed);
  if (!parsed?.products.length) {
    throw new ValidationError('No products found in this file. It needs a name and a price for each product.');
  }
  return parsed;
}

export const SUPPORTED_FILES = ['xlsx', 'xlsm', 'csv', 'tsv', 'txt', 'json', 'xml', 'docx', 'pdf'] as const;

/** Reads a product list from an uploaded file of any common type. */
export async function parseProductFile(fileName: string, buffer: Buffer): Promise<ParsedCatalog> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'xlsx':
    case 'xlsm':
      return parseExcel(buffer);
    case 'xls':
      throw new ValidationError('Old .xls files are not supported. In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.');
    case 'docx':
      return parseDocx(buffer);
    case 'doc':
      throw new ValidationError('Old .doc files are not supported. In Word choose File → Save As → Word Document (.docx), then upload that.');
    case 'pdf':
      return parsePdf(buffer);
    case 'csv':
    case 'tsv':
    case 'txt':
    case 'json':
    case 'xml':
      return parseTextFile(buffer.toString('utf8'));
    default:
      throw new ValidationError(`“.${ext}” files are not supported. Upload ${SUPPORTED_FILES.map((e) => `.${e}`).join(', ')}.`);
  }
}
