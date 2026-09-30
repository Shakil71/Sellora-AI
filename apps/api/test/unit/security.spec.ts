import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { decryptSecret, encryptSecret, hmacSha256Hex, maskSecret, safeEqual, sha256 } from '../../src/common/utils/crypto.util';
import { scrubSecrets } from '../../src/modules/audit/audit.service';
import { CsrfGuard, PermissionsGuard } from '../../src/common/guards';
import { PERMISSIONS_KEY } from '../../src/common/decorators';
import { parseDurationSeconds } from '../../src/modules/auth/token.service';
import { passwordSchema, registerSchema } from '../../src/modules/auth/auth.schemas';
import type { AuthContext } from '../../src/common/auth-context';

function ctx(req: Record<string, unknown>, handlerMeta: Record<string, unknown> = {}): ExecutionContext {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(handlerMeta)) Reflect.defineMetadata(k, v, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const auth = (perms: string[], viaCookie = true): AuthContext => ({
  kind: 'user',
  userId: 'u1',
  tenantId: 't1',
  name: 'Test',
  isSuperAdmin: false,
  permissions: new Set(perms),
  viaCookie,
});

describe('secret encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const enc = encryptSecret('EAAG-super-secret-token');
    expect(enc).not.toContain('super-secret');
    expect(decryptSecret(enc)).toBe('EAAG-super-secret-token');
  });
  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });
  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('value');
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
  it('masks secrets and compares in constant time', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('••••••••abcd');
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(sha256('a')).toHaveLength(64);
    expect(hmacSha256Hex('k', 'body')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('audit log scrubbing', () => {
  it('removes secret-looking keys at any depth', () => {
    const out = scrubSecrets({ name: 'x', accessToken: 'abc', nested: { password: 'p', apiKey: 'k', roleKey: 'OWNER' } }) as Record<string, any>;
    expect(out.accessToken).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.apiKey).toBe('[redacted]');
    expect(out.nested.roleKey).toBe('OWNER');
  });
});

describe('authentication inputs', () => {
  it('parses token lifetimes', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('2h')).toBe(7200);
    expect(parseDurationSeconds('bogus')).toBe(900);
  });
  it('enforces the password policy', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('Passw0rdOK').success).toBe(true);
  });
  it('normalises registration email and rejects malformed input', () => {
    const ok = registerSchema.parse({ name: 'Ann', email: '  ANN@Example.com ', password: 'Passw0rd1', workspaceName: 'Shop' });
    expect(ok.email).toBe('ann@example.com');
    expect(registerSchema.safeParse({ name: 'A', email: 'not-an-email', password: 'x', workspaceName: '' }).success).toBe(false);
  });
});

describe('PermissionsGuard (RBAC)', () => {
  const guard = new PermissionsGuard(new Reflector());
  it('allows when all required permissions are present', () => {
    expect(guard.canActivate(ctx({ auth: auth(['products.view', 'products.create']) }, { [PERMISSIONS_KEY]: ['products.create'] }))).toBe(true);
  });
  it('denies privilege escalation (missing permission)', () => {
    expect(() => guard.canActivate(ctx({ auth: auth(['products.view']) }, { [PERMISSIONS_KEY]: ['products.delete'] }))).toThrow(ForbiddenException);
  });
  it('rejects unauthenticated requests', () => {
    expect(() => guard.canActivate(ctx({}, { [PERMISSIONS_KEY]: ['products.view'] }))).toThrow(UnauthorizedException);
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());
  it('lets safe methods through', () => {
    expect(guard.canActivate(ctx({ method: 'GET', auth: auth([]), cookies: {} }))).toBe(true);
  });
  it('blocks cookie-authenticated writes without a matching token', () => {
    expect(() => guard.canActivate(ctx({ method: 'POST', auth: auth([]), cookies: { sellora_csrf: 'a'.repeat(32) }, headers: {} }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ method: 'POST', auth: auth([]), cookies: { sellora_csrf: 'a'.repeat(32) }, headers: { 'x-csrf-token': 'b'.repeat(32) } }))).toThrow(ForbiddenException);
  });
  it('accepts a matching double-submit token', () => {
    const t = 'c'.repeat(32);
    expect(guard.canActivate(ctx({ method: 'POST', auth: auth([]), cookies: { sellora_csrf: t }, headers: { 'x-csrf-token': t } }))).toBe(true);
  });
  it('does not apply to API-key / bearer requests', () => {
    expect(guard.canActivate(ctx({ method: 'POST', auth: auth([], false), cookies: {}, headers: {} }))).toBe(true);
  });
});
