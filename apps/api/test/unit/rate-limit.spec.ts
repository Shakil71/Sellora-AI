import { RedisThrottlerStorage } from '../../src/common/redis-throttler.storage';

/** In-memory stand-in for the ioredis commands the throttler uses. */
function fakeRedis() {
  const store = new Map<string, { v: number; exp: number }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.exp && e.exp < Date.now()) store.delete(k);
    return store.get(k);
  };
  const client = {
    pttl: async (k: string) => (live(k) ? live(k)!.exp - Date.now() : -2),
    pexpire: async (k: string, ms: number) => { const e = live(k); if (e) e.exp = Date.now() + ms; },
    set: async (k: string, _v: string, _px: string, ms: number) => { store.set(k, { v: 1, exp: Date.now() + ms }); },
    multi: () => {
      const ops: Array<() => unknown> = [];
      const chain = {
        incr: (k: string) => { ops.push(() => { const e = live(k) ?? { v: 0, exp: 0 }; e.v += 1; store.set(k, e); return e.v; }); return chain; },
        pttl: (k: string) => { ops.push(() => { const e = live(k); return e?.exp ? e.exp - Date.now() : -1; }); return chain; },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return chain;
    },
  };
  return { client } as never;
}

describe('rate limiting', () => {
  it('blocks after the limit within the window', async () => {
    const storage = new RedisThrottlerStorage(fakeRedis());
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await storage.increment('ip:1', 60_000, 3, 0, 'auth'));
    expect(results.slice(0, 3).every((r) => !r.isBlocked)).toBe(true);
    expect(results[3]!.isBlocked).toBe(true);
    expect((await storage.increment('ip:2', 60_000, 3, 0, 'auth')).isBlocked).toBe(false);
  });
  it('fails open when Redis is unavailable', async () => {
    const broken = { client: { pttl: async () => { throw new Error('down'); } } } as never;
    expect((await new RedisThrottlerStorage(broken).increment('k', 1000, 1, 0, 'x')).isBlocked).toBe(false);
  });
});
