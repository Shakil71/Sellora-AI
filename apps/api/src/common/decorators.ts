import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { Permission } from '@sellora/shared';
import type { Actor, AppRequest, AuthContext } from './auth-context';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route does not require authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Route requires ALL listed permissions in the active workspace. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ALLOW_NO_TENANT_KEY = 'allowNoTenant';
/** Authenticated route that works without an active workspace (profile, workspace creation). */
export const AllowNoTenant = () => SetMetadata(ALLOW_NO_TENANT_KEY, true);

export const SUPER_ADMIN_KEY = 'superAdmin';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);

export const RAW_RESPONSE_KEY = 'rawResponse';
/** Skip the { success, data } response envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

export const RESPONSE_MESSAGE_KEY = 'responseMessage';
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new UnauthorizedException();
  return req.auth;
});

/** Active tenant id; throws if the request has no workspace selected. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth?.tenantId) throw new ForbiddenException('No active workspace');
  return req.auth.tenantId;
});

/** Actor for audit logging and ownership, bound to the active tenant. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  const auth = req.auth;
  if (!auth?.tenantId) throw new ForbiddenException('No active workspace');
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    name: auth.name,
    type: auth.kind === 'api_key' ? 'API_KEY' : 'USER',
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300),
  };
});

/** Authenticated user id; rejects API-key requests without an owning user. */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth?.userId || req.auth.kind !== 'user') {
    throw new ForbiddenException('This action requires a signed-in user');
  }
  return req.auth.userId;
});

export const USER_ONLY_KEY = 'userOnly';
/** Route cannot be called with an API key (account and session management). */
export const UserOnly = () => SetMetadata(USER_ONLY_KEY, true);
