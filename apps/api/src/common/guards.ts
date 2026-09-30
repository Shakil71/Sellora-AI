import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantStatus, UserStatus } from '@prisma/client';
import { ALL_PERMISSIONS } from '@sellora/shared';
import {
  ALLOW_NO_TENANT_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  SKIP_CSRF_KEY,
  SUPER_ADMIN_KEY,
  USER_ONLY_KEY,
} from './decorators';
import type { AppRequest, AuthContext } from './auth-context';
import { safeEqual } from './utils/crypto.util';
import { TokenService, COOKIE_ACCESS, COOKIE_CSRF } from '../modules/auth/token.service';
import { AccessService } from '../modules/auth/access.service';
import { ApiKeysService } from '../modules/api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const API_KEY_PREFIX = 'sk_';

function bearer(req: AppRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return undefined;
}

/**
 * Authenticates every request (unless @Public) using, in order:
 * 1. API key (x-api-key header or "Bearer sk_...")
 * 2. Access token (Bearer JWT or HTTP-only cookie)
 * Then resolves the active workspace membership and permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly apiKeys: ApiKeysService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    try {
      req.auth = await this.authenticate(req);
    } catch (err) {
      if (isPublic) return true;
      throw err;
    }
    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException('Authentication required');

    const auth = req.auth;
    if (auth.kind !== 'user' && this.reflector.getAllAndOverride<boolean>(USER_ONLY_KEY, targets)) {
      throw new ForbiddenException('API keys cannot access this endpoint');
    }
    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, targets) && !auth.isSuperAdmin) {
      throw new ForbiddenException('Platform administrator access required');
    }
    const allowNoTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_TENANT_KEY, targets);
    if (!auth.tenantId && !allowNoTenant) {
      throw new ForbiddenException({ code: 'NO_WORKSPACE', message: 'Select or create a workspace first.' });
    }
    return true;
  }

  private async authenticate(req: AppRequest): Promise<AuthContext | undefined> {
    const headerKey = req.headers['x-api-key'];
    const bearerToken = bearer(req);
    const apiKey = typeof headerKey === 'string' ? headerKey : bearerToken?.startsWith(API_KEY_PREFIX) ? bearerToken : undefined;
    if (apiKey) return this.authenticateApiKey(apiKey);

    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[COOKIE_ACCESS];
    const token = bearerToken ?? cookieToken;
    if (!token) return undefined;

    let payload;
    try {
      payload = this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Your session has expired.' });
    }
    if (await this.tokens.isSessionRevoked(payload.sid)) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Your session has ended.' });
    }

    const user = await this.redis.remember(`user:${payload.sub}`, 60, () =>
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, email: true, status: true, isSuperAdmin: true },
      }),
    );
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account is not active');

    const ctx: AuthContext = {
      kind: 'user',
      userId: user.id,
      tenantId: null,
      sessionId: payload.sid,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      permissions: new Set(),
      viaCookie: !bearerToken,
    };

    if (payload.tid) {
      const access = await this.access.getAccess(user.id, payload.tid);
      if (access) {
        if (access.tenantStatus === TenantStatus.SUSPENDED && !user.isSuperAdmin) {
          throw new ForbiddenException({ code: 'WORKSPACE_SUSPENDED', message: 'This workspace is suspended.' });
        }
        ctx.tenantId = payload.tid;
        ctx.roleId = access.roleId;
        ctx.roleKey = access.roleKey;
        ctx.permissions = new Set(access.permissions);
      }
    }
    return ctx;
  }

  private async authenticateApiKey(rawKey: string): Promise<AuthContext> {
    const key = await this.apiKeys.validate(rawKey);
    if (!key) throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' });
    const permissions = key.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
    return {
      kind: 'api_key',
      userId: key.createdById,
      apiKeyId: key.id,
      tenantId: key.tenantId,
      name: `API key: ${key.name}`,
      isSuperAdmin: false,
      permissions: new Set(permissions),
      viaCookie: false,
    };
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection for cookie-authenticated, state-changing
 * requests. Clients echo the readable `sellora_csrf` cookie in `x-csrf-token`.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()])) return true;
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    // Only cookie-based sessions are exposed to CSRF.
    const cookieAuthenticated = req.auth ? req.auth.viaCookie : Boolean(cookies[COOKIE_ACCESS]);
    if (!cookieAuthenticated) return true;
    const cookieToken = cookies[COOKIE_CSRF];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || typeof headerToken !== 'string' || !safeEqual(cookieToken, headerToken)) {
      throw new ForbiddenException({ code: 'CSRF_FAILED', message: 'Security check failed. Refresh the page and try again.' });
    }
    return true;
  }
}

/** Enforces @RequirePermissions in the active workspace. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException();
    const missing = required.filter((p) => !auth.permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to perform this action.',
        details: { missing },
      });
    }
    return true;
  }
}
