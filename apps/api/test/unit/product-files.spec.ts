import * as ExcelJS from 'exceljs';
import { parseProductFile, parseTextCatalog } from '../../src/modules/product-import/file-readers';

async function workbook(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Excel files', () => {
  it('reads products, prices, photo links and extra details from a sheet', async () => {
    const buf = await workbook({
      Products: [
        ['Name', 'SKU', 'Price', 'Sale Price', 'Image', 'Category', 'Color', 'Shape', 'Stock'],
        ['Round Table', 'TBL-1', 250, 199.5, 'https://img.example/t.jpg', 'Furniture', 'Oak', 'Round', 4],
        ['Square Table', 'TBL-2', '$300.00', null, 'https://img.example/s.jpg', 'Furniture', 'Pine', 'Square', 0],
      ],
    });
    const parsed = await parseProductFile('catalog.xlsx', buf);
    expect(parsed.platform).toBe('excel');
    expect(parsed.products).toHaveLength(2);
    expect(parsed.products[0]).toMatchObject({ sku: 'TBL-1', name: 'Round Table', price: 250, salePrice: 199.5, category: 'Furniture', stock: 4 });
    expect(parsed.products[0]!.images).toEqual(['https://img.example/t.jpg']);
    expect(parsed.products[0]!.attributes).toMatchObject({ Color: 'Oak', Shape: 'Round' });
    expect(parsed.products[1]).toMatchObject({ price: 300, inStock: false });
  });

  it('skips a title row above the headers and reads link and formula cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Price list');
    ws.addRow(['ACME price list 2026']);
    ws.addRow(['Product', 'Price', 'Photo']);
    const row = ws.addRow(['Lamp', { formula: '20*2', result: 40 }, { text: 'view', hyperlink: 'https://img.example/lamp.png' }]);
    expect(row.getCell(2).value).toBeTruthy();
    const parsed = await parseProductFile('list.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(parsed.products[0]).toMatchObject({ name: 'Lamp', price: 40 });
    expect(parsed.products[0]!.images).toEqual(['https://img.example/lamp.png']);
    expect(parsed.products[0]!.skuFromSource).toBe(false);
  });

  it('combines several sheets and explains empty files', async () => {
    const buf = await workbook({
      Shoes: [['Name', 'Price'], ['Runner', 50]],
      Bags: [['Name', 'Price'], ['Tote', 30]],
      Notes: [['Remember to call supplier']],
    });
    const parsed = await parseProductFile('multi.xlsx', buf);
    expect(parsed.products.map((p) => p.name).sort()).toEqual(['Runner', 'Tote']);
    await expect(parseProductFile('empty.xlsx', await workbook({ A: [['hello']] }))).rejects.toThrow('No products found');
  });

  it('gives a clear message for legacy and unsupported files', async () => {
    await expect(parseProductFile('old.xls', Buffer.from('x'))).rejects.toThrow('.xlsx');
    await expect(parseProductFile('old.doc', Buffer.from('x'))).rejects.toThrow('.docx');
    await expect(parseProductFile('photo.png', Buffer.from('x'))).rejects.toThrow('not supported');
    await expect(parseProductFile('bad.xlsx', Buffer.from('not a workbook'))).rejects.toThrow('could not be opened');
  });
});

describe('text based files', () => {
  it('detects JSON, XML and CSV by content, whatever the extension', async () => {
    const json = await parseProductFile('a.txt', Buffer.from(JSON.stringify({ products: [{ title: 'Pen', price: 2 }] })));
    expect(json.products[0]).toMatchObject({ name: 'Pen', price: 2 });
    const csv = await parseProductFile('a.csv', Buffer.from('name,price\nCup,4.5\n'));
    expect(csv.products[0]).toMatchObject({ name: 'Cup', price: 4.5 });
    const xml = await parseProductFile('feed.xml', Buffer.from('<rss><channel><item><title>Mug</title><price>9.00</price></item></channel></rss>'));
    expect(xml.products[0]).toMatchObject({ name: 'Mug', price: 9 });
  });
});

describe('plain document text (PDF and Word without tables)', () => {
  it('reads a header row followed by aligned rows', () => {
    const text = 'Product Catalog\n\nName      SKU     Price\nBlue Mug  MUG-B   12.50\nRed Mug   MUG-R   13.00\n';
    const parsed = parseTextCatalog(text)!;
    expect(parsed.platform).toBe('document');
    expect(parsed.products.map((p) => [p.sku, p.price])).toEqual([['MUG-B', 12.5], ['MUG-R', 13]]);
  });

  it('reads one product per line with its price', () => {
    const text = '1. Leather Wallet ..... $39.90\n2) Canvas Bag - 24.00\nBlack Belt: USD 15\nCall us on 555 0100 for orders\n';
    const parsed = parseTextCatalog(text)!;
    expect(parsed.products.map((p) => [p.name, p.price])).toEqual([
      ['Leather Wallet', 39.9],
      ['Canvas Bag', 24],
      ['Black Belt', 15],
    ]);
    expect(parsed.products.every((p) => p.sku.startsWith('AUTO-'))).toBe(true);
  });

  it('returns null when there are no prices', () => {
    expect(parseTextCatalog('Just some words\nand more words\n')).toBeNull();
  });
});

describe('Word documents', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip') as new () => { file(name: string, data: string): void; generateAsync(o: { type: 'nodebuffer' }): Promise<Buffer> };
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  async function docx(body: string) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('reads a product table', async () => {
    const buf = await docx(`<w:tbl>${row(['Name', 'SKU', 'Price', 'Color'])}${row(['Desk Lamp', 'LMP-1', '$45.00', 'Black'])}${row(['Floor Lamp', 'LMP-2', '$80.00', 'White'])}</w:tbl>`);
    const parsed = await parseProductFile('price-list.docx', buf);
    expect(parsed.platform).toBe('document');
    expect(parsed.products.map((p) => [p.sku, p.price])).toEqual([['LMP-1', 45], ['LMP-2', 80]]);
    expect(parsed.products[0]!.attributes.Color).toBe('Black');
  });

  it('falls back to one product per line', async () => {
    const buf = await docx('<w:p><w:r><w:t>Leather Wallet - $39.90</w:t></w:r></w:p><w:p><w:r><w:t>Canvas Bag - $24.00</w:t></w:r></w:p>');
    const parsed = await parseProductFile('list.docx', buf);
    expect(parsed.products.map((p) => p.name)).toEqual(['Leather Wallet', 'Canvas Bag']);
  });

  it('explains when there is nothing to import', async () => {
    await expect(parseProductFile('letter.docx', await docx('<w:p><w:r><w:t>Dear customer, thank you.</w:t></w:r></w:p>'))).rejects.toThrow('No products found');
  });
});
