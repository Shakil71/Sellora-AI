import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, TokenType, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsageService } from '../billing/usage.service';
import { TokenService, SessionMeta } from './token.service';
import { AccessService } from './access.service';
import { AppException, ConflictError, ensureFound, ValidationError } from '../../common/errors';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../../common/utils/crypto.util';
import { env } from '../../config/env';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  createWorkspaceSchema,
  passwordSchema,
  profileSchema,
  registerSchema,
} from './auth.schemas';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string | null;
}

export type LoginOutcome = { twoFactorRequired: true; challengeToken: string } | ({ twoFactorRequired: false } & AuthResult);

// Dummy hash used to equalise timing when an account does not exist.
let dummyHash: string | undefined;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tenants: TenantsService,
    private readonly usage: UsageService,
  ) {}

  hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  private async verifyPassword(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private async issue(userId: string, tenantId: string | null, meta: SessionMeta, familyId?: string): Promise<AuthResult> {
    const { sessionId, refreshToken } = await this.tokens.createSession(userId, meta, familyId);
    return { accessToken: this.tokens.signAccessToken(userId, sessionId, tenantId), refreshToken, userId, tenantId };
  }

  /** Picks the workspace to open: last used if still a member, else the first membership. */
  private async resolveTenant(userId: string, preferred?: string | null): Promise<string | null> {
    if (preferred) {
      const m = await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId: preferred, userId } } });
      if (m?.status === MembershipStatus.ACTIVE) return preferred;
    }
    const first = await this.prisma.userRole.findFirst({
      where: { userId, status: MembershipStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });
    return first?.tenantId ?? null;
  }

  async register(input: z.infer<typeof registerSchema>, meta: SessionMeta): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictError('An account with this email already exists. Try signing in instead.');
    const passwordHash = await this.hashPassword(input.password);
    const { user, tenant } = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
        const tenant = await this.tenants.provision(user.id, { name: input.workspaceName }, tx);
        return { user, tenant };
      },
      { timeout: 20_000 },
    );
    await this.audit.log(
      { tenantId: tenant.id, userId: user.id, name: user.name, type: 'USER', ip: meta.ip, userAgent: meta.userAgent },
      { action: 'auth.registered', entityType: 'User', entityId: user.id },
    );
    await this.sendVerification(user.id, user.email, user.name);
    await this.mail.queue(user.email, 'welcome', { name: user.name, workspace: tenant.name });
    return this.issue(user.id, tenant.id, meta);
  }

  async login(email: string, password: string, meta: SessionMeta): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      dummyHash ??= await this.hashPassword(randomToken(16));
      await this.verifyPassword(dummyHash, password);
      await this.audit.log({ name: email, type: 'USER', ip: meta.ip, userAgent: meta.userAgent }, { action: 'auth.login_failed', metadata: { reason: 'unknown_email' } });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const valid = await this.verifyPassword(user.passwordHash, password);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.audit.log(
        { tenantId: user.lastTenantId, userId: user.id, name: user.name, type: 'USER', ip: meta.ip, userAgent: meta.userAgent },
        { action: 'auth.login_failed', entityType: 'User', entityId: user.id, metadata: { reason: 'bad_password', attempt: failed } },
      );
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' });
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException('ACCOUNT_SUSPENDED', 'This account is suspended. Contact your administrator.', HttpStatus.FORBIDDEN);
    }
    if (user.twoFactorEnabled) {
      return { twoFactorRequired: true, challengeToken: this.tokens.signTwoFactorChallenge(user.id) };
    }
    return { twoFactorRequired: false, ...(await this.completeLogin(user.id, meta)) };
  }

  async loginWithTwoFactor(challengeToken: string, code: string, meta: SessionMeta): Promise<AuthResult> {
    const userId = this.tokens.verifyTwoFactorChallenge(challengeToken);
    const user = ensureFound(await this.prisma.user.findUnique({ where: { id: userId } }), 'User');
    const attemptsKey = `2fa:attempts:${userId}`;
    const attempts = await this.redis.client.incr(attemptsKey).catch(() => 1);
    await this.redis.client.expire(attemptsKey, 300).catch(() => undefined);
    if (attempts > 5) throw new AppException('TOO_MANY_ATTEMPTS', 'Too many attempts. Sign in again.', HttpStatus.TOO_MANY_REQUESTS);
    if (!user.twoFactorSecret || !authenticator.check(code, decryptSecret(user.twoFactorSecret))) {
      throw new UnauthorizedException({ code: 'INVALID_2FA_CODE', message: 'The verification code is incorrect.' });
    }
    await this.redis.del(attemptsKey);
    return this.completeLogin(user.id, meta);
  }

  private async completeLogin(userId: string, meta: SessionMeta) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tenantId = await this.resolveTenant(user.id, user.lastTenantId);
    await this.audit.log(
      { tenantId, userId: user.id, name: user.name, type: 'USER', ip: meta.ip, userAgent: meta.userAgent },
      { action: 'auth.login', entityType: 'User', entityId: user.id },
    );
    return this.issue(user.id, tenantId, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthResult> {
    const rotated = await this.tokens.rotate(refreshToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account is not active');
    const tenantId = await this.resolveTenant(user.id, user.lastTenantId);
    return {
      accessToken: this.tokens.signAccessToken(user.id, rotated.sessionId, tenantId),
      refreshToken: rotated.refreshToken,
      userId: user.id,
      tenantId,
    };
  }

  async logout(sessionId: string | undefined, actor: { userId: string; name: string; tenantId: string | null; ip?: string }) {
    if (sessionId) await this.tokens.revokeSession(sessionId, 'logout');
    await this.audit.log({ ...actor, type: 'USER' }, { action: 'auth.logout', entityType: 'User', entityId: actor.userId });
  }

  async logoutAll(userId: string, actor: { name: string; tenantId: string | null; ip?: string }) {
    await this.tokens.revokeAllForUser(userId, 'logout_all');
    await this.audit.log({ ...actor, userId, type: 'USER' }, { action: 'auth.logout_all', entityType: 'User', entityId: userId });
  }

  // ---------------------------------------------------------------- profile

  async me(userId: string, tenantId: string | null) {
    const user = ensureFound(
      await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          phone: true,
          emailVerifiedAt: true,
          twoFactorEnabled: true,
          isSuperAdmin: true,
          createdAt: true,
        },
      }),
      'User',
    );
    const workspaces = await this.tenants.listForUser(userId);
    let workspace = null;
    let role = null;
    let permissions: string[] = [];
    if (tenantId) {
      const access = await this.access.getAccess(userId, tenantId);
      if (access) {
        workspace = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            currency: true,
            timezone: true,
            locale: true,
            onboardingStep: true,
            onboardingCompletedAt: true,
            isDemo: true,
            status: true,
            subscription: { select: { plan: true, status: true } },
          },
        });
        role = { id: access.roleId, key: access.roleKey, name: access.roleName };
        permissions = access.permissions;
      }
    }
    return { user: { ...user, emailVerified: Boolean(user.emailVerifiedAt) }, workspace, role, permissions, workspaces };
  }

  async updateProfile(userId: string, input: z.infer<typeof profileSchema>) {
    await this.prisma.user.update({ where: { id: userId }, data: input });
    await this.redis.del(`user:${userId}`);
    return { updated: true };
  }

  async changePassword(userId: string, sessionId: string | undefined, input: z.infer<typeof changePasswordSchema>, actor: { name: string; tenantId: string | null; ip?: string }) {
    const user = ensureFound(await this.prisma.user.findUnique({ where: { id: userId } }), 'User');
    if (!(await this.verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new ValidationError('Your current password is incorrect.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(input.newPassword) } });
    if (input.logoutOtherSessions && sessionId) {
      const familyId = await this.tokens.familyOf(sessionId);
      await this.tokens.revokeAllForUser(userId, 'password_changed', familyId);
    }
    await this.audit.log({ ...actor, userId, type: 'USER' }, { action: 'auth.password_changed', entityType: 'User', entityId: userId });
    return { updated: true };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const currentFamily = currentSessionId ? await this.tokens.familyOf(currentSessionId) : undefined;
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, familyId: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      take: 50,
    });
    return sessions.map(({ familyId, ...s }) => ({ ...s, current: familyId === currentFamily }));
  }

  async revokeSessionById(userId: string, sessionId: string) {
    const session = ensureFound(await this.prisma.session.findFirst({ where: { id: sessionId, userId } }), 'Session');
    await this.tokens.revokeSession(session.id, 'revoked_by_user');
    return { revoked: true };
  }

  // ------------------------------------------------------------ workspaces

  async switchWorkspace(userId: string, sessionId: string, tenantId: string) {
    const access = await this.access.getAccess(userId, tenantId);
    if (!access) throw new AppException('NOT_A_MEMBER', 'You are not a member of this workspace.', HttpStatus.FORBIDDEN);
    await this.prisma.user.update({ where: { id: userId }, data: { lastTenantId: tenantId } });
    return this.tokens.signAccessToken(userId, sessionId, tenantId);
  }

  async createWorkspace(userId: string, sessionId: string, input: z.infer<typeof createWorkspaceSchema>) {
    const owned = await this.prisma.userRole.count({ where: { userId, role: { key: 'OWNER' } } });
    if (owned >= 10) throw new AppException('WORKSPACE_LIMIT', 'You can own up to 10 workspaces.');
    const tenant = await this.tenants.provision(userId, input);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.audit.log({ tenantId: tenant.id, userId, name: user?.name, type: 'USER' }, { action: 'workspace.created', entityType: 'Tenant', entityId: tenant.id });
    return { tenant, accessToken: this.tokens.signAccessToken(userId, sessionId, tenant.id) };
  }

  // ------------------------------------------------- verification & reset

  private async createToken(type: TokenType, email: string, ttlMs: number, extra: { userId?: string; tenantId?: string; roleId?: string } = {}) {
    const raw = randomToken(32);
    await this.prisma.verificationToken.create({
      data: { type, email, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs), ...extra },
    });
    return raw;
  }

  private async consumeToken(type: TokenType, raw: string) {
    const token = await this.prisma.verificationToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
      throw new AppException('INVALID_TOKEN', 'This link is invalid or has expired.', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    return token;
  }

  async sendVerification(userId: string, email: string, name: string) {
    await this.prisma.verificationToken.deleteMany({ where: { userId, type: TokenType.EMAIL_VERIFICATION, usedAt: null } });
    const raw = await this.createToken(TokenType.EMAIL_VERIFICATION, email, VERIFY_TTL_MS, { userId });
    return this.mail.queue(email, 'verify-email', { name, url: `${env.APP_URL}/verify-email?token=${raw}` });
  }

  async resendVerification(userId: string) {
    const user = ensureFound(await this.prisma.user.findUnique({ where: { id: userId } }), 'User');
    if (user.emailVerifiedAt) return { alreadyVerified: true, emailConfigured: this.mail.isConfigured() };
    const res = await this.sendVerification(user.id, user.email, user.name);
    return { alreadyVerified: false, emailConfigured: res.queued };
  }

  async verifyEmail(raw: string) {
    const token = await this.consumeToken(TokenType.EMAIL_VERIFICATION, raw);
    if (!token.userId) throw new AppException('INVALID_TOKEN', 'This link is invalid or has expired.');
    await this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.log({ userId: token.userId, type: 'USER' }, { action: 'auth.email_verified', entityType: 'User', entityId: token.userId });
    return { verified: true };
  }

  /** Always succeeds to avoid leaking which emails are registered. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === UserStatus.ACTIVE) {
      await this.prisma.verificationToken.deleteMany({ where: { userId: user.id, type: TokenType.PASSWORD_RESET, usedAt: null } });
      const raw = await this.createToken(TokenType.PASSWORD_RESET, email, RESET_TTL_MS, { userId: user.id });
      await this.mail.queue(email, 'password-reset', { name: user.name, url: `${env.APP_URL}/reset-password?token=${raw}` });
      await this.audit.log({ tenantId: user.lastTenantId, userId: user.id, name: user.name, type: 'USER' }, { action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id });
    }
    return { sent: true, emailConfigured: this.mail.isConfigured() };
  }

  async resetPassword(raw: string, password: string) {
    const token = await this.consumeToken(TokenType.PASSWORD_RESET, raw);
    if (!token.userId) throw new AppException('INVALID_TOKEN', 'This link is invalid or has expired.');
    await this.prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash: await this.hashPassword(password), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(token.userId, 'password_reset');
    await this.audit.log({ userId: token.userId, type: 'USER' }, { action: 'auth.password_reset', entityType: 'User', entityId: token.userId });
    return { reset: true };
  }

  // ------------------------------------------------------------ invitations

  async createInvitationToken(email: string, tenantId: string, roleId: string, invitedById: string) {
    await this.prisma.verificationToken.deleteMany({ where: { email, tenantId, type: TokenType.INVITATION, usedAt: null } });
    return this.createToken(TokenType.INVITATION, email, 7 * 24 * 3600 * 1000, { tenantId, roleId, userId: invitedById });
  }

  async previewInvitation(raw: string) {
    const token = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { tenant: { select: { name: true } }, role: { select: { name: true } } },
    });
    if (!token || token.type !== TokenType.INVITATION || token.usedAt || token.expiresAt < new Date()) {
      throw new AppException('INVALID_TOKEN', 'This invitation is invalid or has expired.');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: token.email }, select: { id: true } });
    return { email: token.email, workspace: token.tenant?.name, role: token.role?.name, accountExists: Boolean(existing) };
  }

  async acceptInvitation(input: z.infer<typeof acceptInvitationSchema>, meta: SessionMeta): Promise<AuthResult> {
    const preview = await this.prisma.verificationToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!preview || preview.type !== TokenType.INVITATION || preview.usedAt || preview.expiresAt < new Date() || !preview.tenantId || !preview.roleId) {
      throw new AppException('INVALID_TOKEN', 'This invitation is invalid or has expired.');
    }
    let user = await this.prisma.user.findUnique({ where: { email: preview.email } });
    if (user) {
      if (!(await this.verifyPassword(user.passwordHash, input.password))) {
        throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Incorrect password for this account.' });
      }
    } else {
      if (!input.name) throw new ValidationError('Enter your name to create your account.');
      const pwd = passwordSchema.safeParse(input.password);
      if (!pwd.success) throw new ValidationError(pwd.error.issues[0]!.message);
      await this.usage.assertWithin(preview.tenantId, 'users', 1);
      user = await this.prisma.user.create({
        data: { email: preview.email, name: input.name, passwordHash: await this.hashPassword(input.password), emailVerifiedAt: new Date() },
      });
    }
    const alreadyMember = await this.prisma.userRole.findUnique({
      where: { tenantId_userId: { tenantId: preview.tenantId, userId: user.id } },
    });
    if (!alreadyMember && preview.email !== user.email) throw new AppException('INVALID_TOKEN', 'This invitation is invalid.');
    if (!alreadyMember) await this.usage.assertWithin(preview.tenantId, 'users', 1);
    await this.consumeToken(TokenType.INVITATION, input.token);
    await this.prisma.userRole.upsert({
      where: { tenantId_userId: { tenantId: preview.tenantId, userId: user.id } },
      create: { tenantId: preview.tenantId, userId: user.id, roleId: preview.roleId, status: MembershipStatus.ACTIVE, invitedById: preview.userId },
      update: { status: MembershipStatus.ACTIVE, roleId: preview.roleId },
    });
    await this.access.invalidateUser(preview.tenantId, user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastTenantId: preview.tenantId } });
    await this.audit.log(
      { tenantId: preview.tenantId, userId: user.id, name: user.name, type: 'USER', ip: meta.ip },
      { action: 'team.invitation_accepted', entityType: 'User', entityId: user.id },
    );
    return this.issue(user.id, preview.tenantId, meta);
  }

  // -------------------------------------------------------------------- 2FA

  async setupTwoFactor(userId: string) {
    const user = ensureFound(await this.prisma.user.findUnique({ where: { id: userId } }), 'User');
    if (user.twoFactorEnabled) throw new AppException('ALREADY_ENABLED', 'Two-factor authentication is already enabled.');
    const secret = authenticator.generateSecret();
    await this.redis.client.set(`2fa:setup:${userId}`, encryptSecret(secret), 'EX', 600);
    const otpauthUrl = authenticator.keyuri(user.email, env.APP_NAME, secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  }

  async enableTwoFactor(userId: string, code: string, actor: { name: string; tenantId: string | null }) {
    const pending = await this.redis.client.get(`2fa:setup:${userId}`);
    if (!pending) throw new AppException('SETUP_EXPIRED', 'Setup expired. Start again.');
    if (!authenticator.check(code, decryptSecret(pending))) throw new ValidationError('The verification code is incorrect.');
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true, twoFactorSecret: pending } });
    await this.redis.del(`2fa:setup:${userId}`);
    await this.audit.log({ ...actor, userId, type: 'USER' }, { action: 'auth.2fa_enabled', entityType: 'User', entityId: userId });
    return { enabled: true };
  }

  async disableTwoFactor(userId: string, password: string, code: string, actor: { name: string; tenantId: string | null }) {
    const user = ensureFound(await this.prisma.user.findUnique({ where: { id: userId } }), 'User');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return { enabled: false };
    if (!(await this.verifyPassword(user.passwordHash, password))) throw new ValidationError('Your password is incorrect.');
    if (!authenticator.check(code, decryptSecret(user.twoFactorSecret))) throw new ValidationError('The verification code is incorrect.');
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    await this.audit.log({ ...actor, userId, type: 'USER' }, { action: 'auth.2fa_disabled', entityType: 'User', entityId: userId });
    return { enabled: false };
  }
}
