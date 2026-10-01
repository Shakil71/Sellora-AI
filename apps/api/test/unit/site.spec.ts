import { DEFAULT_HOME_CONTENT, mergeHomeContent } from '@sellora/shared';
import { homeContentSchema, SiteService } from '../../src/modules/site/site.service';

const clone = () => JSON.parse(JSON.stringify(DEFAULT_HOME_CONTENT)) as typeof DEFAULT_HOME_CONTENT;

describe('home page content', () => {
  it('the built-in text is valid, so a reset always works', () => {
    expect(homeContentSchema.safeParse(DEFAULT_HOME_CONTENT).success).toBe(true);
  });

  it('refuses dangerous links', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAA', '//evil.example', 'ftp://x.example', 'vbscript:x']) {
      const c = clone();
      c.hero.primaryCta.href = bad;
      expect(homeContentSchema.safeParse(c).success).toBe(false);
    }
    for (const good of ['/register', 'https://example.com/x', 'http://example.com', 'mailto:hi@example.com', '/#pricing', 'tel:+8801700000000']) {
      const c = clone();
      c.hero.primaryCta.href = good;
      expect(homeContentSchema.safeParse(c).success).toBe(true);
    }
  });

  it('limits sizes and unknown icons, and allows empty optional lists', () => {
    const c = clone();
    c.faq.items = Array.from({ length: 31 }, () => ({ q: 'q', a: 'a' }));
    expect(homeContentSchema.safeParse(c).success).toBe(false);
    const d = clone();
    d.features.items[0]!.icon = 'not-an-icon' as never;
    expect(homeContentSchema.safeParse(d).success).toBe(false);
    const e = clone();
    e.testimonials = [];
    e.faq.items = [];
    e.hero.checks = [];
    expect(homeContentSchema.safeParse(e).success).toBe(true);
  });

  it('fills missing fields from the defaults', () => {
    const merged = mergeHomeContent({ hero: { headlinePrefix: 'Hello' }, faq: { items: [] } });
    expect(merged.hero.headlinePrefix).toBe('Hello');
    expect(merged.hero.primaryCta).toEqual(DEFAULT_HOME_CONTENT.hero.primaryCta);
    expect(merged.faq.items).toEqual([]);
    expect(merged.brandName).toBe('Sellora AI');
    expect(mergeHomeContent(null)).toEqual(DEFAULT_HOME_CONTENT);
  });

  it('serves defaults when nothing is saved or the saved text is damaged, and never crashes', async () => {
    const find = jest.fn();
    const svc = new SiteService({ systemSetting: { findUnique: find } } as never, { log: jest.fn() } as never, {} as never);
    find.mockResolvedValueOnce(null);
    expect(await svc.content()).toEqual(DEFAULT_HOME_CONTENT);
    const svc2 = new SiteService({ systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: { hero: 'broken' } }) } } as never, { log: jest.fn() } as never, {} as never);
    expect(await svc2.content()).toEqual(DEFAULT_HOME_CONTENT);
    const svc3 = new SiteService({ systemSetting: { findUnique: jest.fn().mockRejectedValue(new Error('db down')) } } as never, { log: jest.fn() } as never, {} as never);
    expect(await svc3.content()).toEqual(DEFAULT_HOME_CONTENT);
  });
});
