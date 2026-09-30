import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response, CookieOptions } from 'express';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../common/utils/crypto.util';

export const COOKIE_ACCESS = 'sellora_at';
export const COOKIE_REFRESH = 'sellora_rt';
export const COOKIE_CSRF = 'sellora_csrf';
export const COOKIE_AUTH_HINT = 'sellora_auth';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Refresh token reuse within this window after rotation is treated as a benign race (e.g. two tabs). */
const ROTATION_GRACE_MS = 30_000;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  tid: string | null;
  typ: 'access';
}

export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 900;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit];
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class TokenService {
  readonly accessTtlSeconds = parseDurationSeconds(env.JWT_ACCESS_TTL);
  readonly refreshTtlMs = env.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  signAccessToken(userId: string, sessionId: string, tenantId: string | null): string {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, tid: tenantId, typ: 'access' };
    return this.jwt.sign(payload, { secret: env.JWT_SECRET, expiresIn: this.accessTtlSeconds });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.jwt.verify<AccessTokenPayload>(token, { secret: env.JWT_SECRET });
    if (payload.typ !== 'access') throw new UnauthorizedException('Invalid token');
    return payload;
  }

  /** Short-lived token proving the password step succeeded when 2FA is required. */
  signTwoFactorChallenge(userId: string): string {
    return this.jwt.sign({ sub: userId, typ: '2fa' }, { secret: env.JWT_REFRESH_SECRET, expiresIn: 300 });
  }

  verifyTwoFactorChallenge(token: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; typ: string }>(token, { secret: env.JWT_REFRESH_SECRET });
      if (payload.typ !== '2fa') throw new Error('wrong type');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Your sign-in attempt expired. Please sign in again.');
    }
  }

  private newRefreshToken(sessionId: string) {
    const token = `${sessionId}.${randomToken(48)}`;
    return { token, hash: sha256(token) };
  }

  async createSession(userId: string, meta: SessionMeta, familyId: string = randomUUID()) {
    const sessionId = randomUUID();
    const { token, hash } = this.newRefreshToken(sessionId);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        familyId,
        refreshTokenHash: hash,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return { sessionId, refreshToken: token };
  }

  /**
   * Rotates a refresh token. Reusing an already-rotated token outside the grace
   * window revokes the whole session family (token theft detection).
   */
  async rotate(refreshToken: string, meta: SessionMeta) {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!session) throw new UnauthorizedException('Session not found');
    if (session.revokedAt) {
      const benign =
        session.revokedReason === 'rotated' && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!benign) {
        await this.revokeFamily(session.familyId, 'reuse_detected');
        throw new UnauthorizedException('Session expired. Please sign in again.');
      }
    }
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Session expired. Please sign in again.');

    if (!session.revokedAt) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'rotated', lastUsedAt: new Date() },
      });
    }
    const next = await this.createSession(session.userId, meta, session.familyId);
    return { userId: session.userId, ...next };
  }

  async revokeSession(sessionId: string, reason = 'logout') {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;
    await this.prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.markRevokedInCache([sessionId, ...(await this.familySessionIds(session.familyId))]);
  }

  async revokeFamily(familyId: string, reason: string) {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.markRevokedInCache(await this.familySessionIds(familyId));
  }

  async revokeAllForUser(userId: string, reason = 'logout_all', exceptFamilyId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    // Access tokens reference the session id they were issued with; families
    // share lineage, so mark every session of the user as revoked.
    const recent = await this.prisma.session.findMany({
      where: { userId, createdAt: { gte: this.accessWindowStart() } },
      select: { id: true },
    });
    await this.markRevokedInCache([...sessions.map((s) => s.id), ...recent.map((s) => s.id)]);
  }

  /** Sessions created recently enough that access tokens issued for them may still be valid. */
  private accessWindowStart() {
    return new Date(Date.now() - (this.accessTtlSeconds + 60) * 1000);
  }

  private async familySessionIds(familyId: string) {
    const rows = await this.prisma.session.findMany({
      where: { familyId, createdAt: { gte: this.accessWindowStart() } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async markRevokedInCache(sessionIds: string[]) {
    if (!sessionIds.length) return;
    try {
      const pipeline = this.redis.client.pipeline();
      for (const id of sessionIds) pipeline.set(`session:revoked:${id}`, '1', 'EX', this.accessTtlSeconds + 60);
      await pipeline.exec();
    } catch {
      /* Redis outage: access tokens expire on their own shortly */
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(`session:revoked:${sessionId}`)) === 1;
    } catch {
      return false;
    }
  }

  /** Returns the session family id for an access token session. */
  async familyOf(sessionId: string): Promise<string | undefined> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { familyId: true } });
    return s?.familyId;
  }

  private baseCookie(): CookieOptions {
    return {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      domain: env.COOKIE_DOMAIN,
    };
  }

  /** Sets session cookies. An existing CSRF token is kept so other open tabs keep working. */
  setAuthCookies(res: Response, accessToken: string, refreshToken: string, existingCsrf?: string) {
    const base = this.baseCookie();
    const csrf = existingCsrf && /^[A-Za-z0-9_-]{20,64}$/.test(existingCsrf) ? existingCsrf : randomToken(24);
    res.cookie(COOKIE_ACCESS, accessToken, { ...base, path: '/', maxAge: this.accessTtlSeconds * 1000 });
    res.cookie(COOKIE_REFRESH, refreshToken, { ...base, path: REFRESH_COOKIE_PATH, maxAge: this.refreshTtlMs });
    res.cookie(COOKIE_CSRF, csrf, { ...base, httpOnly: false, path: '/', maxAge: this.refreshTtlMs });
    res.cookie(COOKIE_AUTH_HINT, '1', { ...base, httpOnly: false, path: '/', maxAge: this.refreshTtlMs });
  }

  setAccessCookie(res: Response, accessToken: string) {
    res.cookie(COOKIE_ACCESS, accessToken, { ...this.baseCookie(), path: '/', maxAge: this.accessTtlSeconds * 1000 });
  }

  clearAuthCookies(res: Response) {
    const base = this.baseCookie();
    res.clearCookie(COOKIE_ACCESS, { ...base, path: '/' });
    res.clearCookie(COOKIE_REFRESH, { ...base, path: REFRESH_COOKIE_PATH });
    res.clearCookie(COOKIE_CSRF, { ...base, httpOnly: false, path: '/' });
    res.clearCookie(COOKIE_AUTH_HINT, { ...base, httpOnly: false, path: '/' });
  }
}
