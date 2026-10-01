import {
  generatedSku,
  parseCsvFeed,
  parseJsonFeed,
  parseJsonLdProducts,
  parsePrice,
  parseShopify,
  parseWooRest,
  parseWooStore,
  parseXmlFeed,
} from '../../src/modules/product-import/parsers';

describe('parsePrice', () => {
  it('reads prices written in many styles', () => {
    expect(parsePrice('$1,200.50')).toBe(1200.5);
    expect(parsePrice('12.00 USD')).toBe(12);
    expect(parsePrice('1.200,50 €')).toBe(1200.5);
    expect(parsePrice('৳ 4500')).toBe(4500);
    expect(parsePrice('19,99')).toBe(19.99);
    expect(parsePrice('1,500')).toBe(1500);
    expect(parsePrice(42)).toBe(42);
    expect(parsePrice('free')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('Shopify products.json', () => {
  const shop = {
    products: [
      {
        id: 1,
        title: 'Urban Runner',
        handle: 'urban-runner',
        body_html: '<p>Light <strong>running</strong> shoe.</p>',
        vendor: 'Acme',
        product_type: 'Shoes',
        tags: ['running', 'Summer'],
        options: [{ name: 'Color' }, { name: 'Size' }],
        images: [
          { id: 10, src: 'https://cdn.example/a.jpg', variant_ids: [100] },
          { id: 11, src: 'https://cdn.example/b.jpg', variant_ids: [] },
        ],
        variants: [
          { id: 100, title: 'Black / 42', sku: 'UR-BLK-42', price: '49.00', compare_at_price: '59.00', available: true, option1: 'Black', option2: '42', grams: 800, image_id: 10 },
          { id: 101, title: 'Black / 43', sku: '', price: '59.00', compare_at_price: null, available: false, option1: 'Black', option2: '43' },
        ],
      },
      { id: 2, title: 'Gift card', variants: [{ id: 200, title: 'Default Title', sku: 'GIFT', price: '25.00' }], images: [] },
    ],
  };

  it('creates one product per variant with price, sale price, images and attributes', () => {
    const { products, platform } = parseShopify([shop], 'https://shop.example', 'USD');
    expect(platform).toBe('shopify');
    expect(products).toHaveLength(3);
    const first = products[0]!;
    expect(first).toMatchObject({ sku: 'UR-BLK-42', name: 'Urban Runner · Black / 42', price: 59, salePrice: 49, category: 'Shoes', inStock: true, skuFromSource: true });
    expect(first.images[0]).toBe('https://cdn.example/a.jpg');
    expect(first.attributes).toMatchObject({ Brand: 'Acme', Color: 'Black', Size: '42', Weight: '800 g' });
    expect(first.description).toBe('Light running shoe.');
    expect(first.tags).toEqual(['running', 'summer']);
  });

  it('generates a stable SKU when the source has none and keeps single-variant names clean', () => {
    const { products } = parseShopify([shop], 'https://shop.example', 'USD');
    expect(products[1]!.sku).toMatch(/^AUTO-URBAN-RUNNER-BLACK-43-[0-9A-Z]{4}$/);
    expect(products[1]!.skuFromSource).toBe(false);
    expect(products[2]).toMatchObject({ name: 'Gift card', sku: 'GIFT', price: 25 });
    expect(parseShopify([shop], 'https://shop.example', 'USD').products[1]!.sku).toBe(products[1]!.sku);
  });
});

describe('WooCommerce', () => {
  it('reads the public Store API (prices in minor units)', () => {
    const { products, currency } = parseWooStore([
      {
        id: 7,
        name: 'Ceramic Vase',
        sku: 'VASE-1',
        permalink: 'https://woo.example/vase',
        description: '<p>Hand made.</p>',
        prices: { price: '2500', regular_price: '3000', sale_price: '2500', currency_code: 'EUR', currency_minor_unit: 2 },
        images: [{ src: 'https://woo.example/vase.jpg' }],
        categories: [{ name: 'Home' }],
        attributes: [{ name: 'Shape', terms: [{ name: 'Round' }, { name: 'Tall' }] }],
        is_in_stock: true,
      },
    ]);
    expect(currency).toBe('EUR');
    expect(products[0]).toMatchObject({ sku: 'VASE-1', price: 30, salePrice: 25, category: 'Home', inStock: true });
    expect(products[0]!.attributes.Shape).toBe('Round, Tall');
  });

  it('reads the authenticated REST API including stock and dimensions', () => {
    const { products } = parseWooRest(
      [{ id: 8, name: 'Lamp', sku: 'LAMP', status: 'draft', regular_price: '80.00', sale_price: '', stock_quantity: 12, stock_status: 'instock', weight: '2', dimensions: { length: '10', width: '10', height: '30' } }],
      'GBP',
    );
    expect(products[0]).toMatchObject({ price: 80, salePrice: null, stock: 12, active: false });
    expect(products[0]!.attributes).toMatchObject({ Weight: '2', Dimensions: '10 × 10 × 30' });
  });
});

describe('structured data on product pages', () => {
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite' },
      {
        '@type': 'Product',
        name: 'Leather Wallet',
        sku: 'WAL-9',
        description: 'Slim wallet',
        image: ['/img/w1.jpg', { '@type': 'ImageObject', url: 'https://x.example/w2.jpg' }],
        brand: { '@type': 'Brand', name: 'Craft' },
        color: 'Brown',
        offers: { '@type': 'Offer', price: '39.90', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      },
    ],
  };
  const page = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;

  it('extracts name, sku, price, currency, images and attributes', () => {
    const { products, currency } = parseJsonLdProducts(page, 'https://x.example/p/wallet');
    expect(currency).toBe('USD');
    expect(products[0]).toMatchObject({ sku: 'WAL-9', name: 'Leather Wallet', price: 39.9, inStock: true });
    expect(products[0]!.images).toEqual(['https://x.example/img/w1.jpg', 'https://x.example/w2.jpg']);
    expect(products[0]!.attributes).toMatchObject({ Brand: 'Craft', Color: 'Brown' });
  });

  it('falls back to OpenGraph product tags', () => {
    const html =
      '<meta property="og:title" content="Desk Lamp"><meta property="og:image" content="https://x.example/l.jpg"><meta property="product:price:amount" content="45.00"><meta property="product:price:currency" content="EUR">';
    const { products, currency } = parseJsonLdProducts(html, 'https://x.example/lamp');
    expect(currency).toBe('EUR');
    expect(products[0]).toMatchObject({ name: 'Desk Lamp', price: 45 });
  });
});

describe('JSON, CSV and XML feeds', () => {
  it('maps common field names from any JSON API and keeps the rest as attributes', () => {
    const parsed = parseJsonFeed({
      data: { items: [{ product_name: 'Mug', item_sku: 'MUG-1', mrp: '15', special_price: '12', image_url: 'https://c.example/m.jpg', category: 'Kitchen', qty: 30, material: 'Ceramic', shape: 'Round', currency: 'USD' }] },
    });
    expect(parsed?.currency).toBe('USD');
    expect(parsed?.products[0]).toMatchObject({ sku: 'MUG-1', name: 'Mug', price: 15, salePrice: 12, stock: 30, category: 'Kitchen' });
    expect(parsed?.products[0]!.attributes).toMatchObject({ Material: 'Ceramic', Shape: 'Round' });
  });

  it('skips rows without a name or price and renames duplicate SKUs', () => {
    const parsed = parseJsonFeed([
      { name: 'A', sku: 'X', price: 1 },
      { name: 'B', sku: 'X', price: 2 },
      { name: 'No price', sku: 'Y' },
    ])!;
    expect(parsed.products.map((p) => p.sku)).toEqual(['X', 'X-2']);
    expect(parsed.warnings.join(' ')).toMatch(/skipped/);
  });

  it('reads CSV with quotes, commas and semicolon separators', () => {
    const csv = 'Title,SKU,Price,Image Link,Description\n"Mug, large",M-1,"1,200.00",https://c.example/m.jpg,"Says ""hi"""\nPlate,P-1,8.5,,Plain\n';
    const parsed = parseCsvFeed(csv)!;
    expect(parsed.platform).toBe('csv');
    expect(parsed.products[0]).toMatchObject({ name: 'Mug, large', price: 1200, description: 'Says "hi"' });
    expect(parseCsvFeed('name;price\nCup;4,50\n')!.products[0]).toMatchObject({ name: 'Cup', price: 4.5 });
  });

  it('reads Google Merchant style XML', () => {
    const xml =
      '<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>SKU-1</g:id><title><![CDATA[Desk Lamp]]></title><g:price>45.00 EUR</g:price><g:image_link>https://c.example/1.jpg</g:image_link><g:additional_image_link>https://c.example/2.jpg</g:additional_image_link><g:availability>in stock</g:availability><g:brand>Lumi</g:brand></item></channel></rss>';
    const parsed = parseXmlFeed(xml)!;
    expect(parsed.currency).toBe('EUR');
    expect(parsed.products[0]).toMatchObject({ sku: 'SKU-1', name: 'Desk Lamp', price: 45, inStock: true });
    expect(parsed.products[0]!.images).toHaveLength(2);
    expect(parsed.products[0]!.attributes.Brand).toBe('Lumi');
  });

  it('generates deterministic SKUs', () => {
    expect(generatedSku('Blue Mug', 'a')).toBe(generatedSku('Blue Mug', 'a'));
    expect(generatedSku('Blue Mug', 'a')).not.toBe(generatedSku('Blue Mug', 'b'));
  });
});
