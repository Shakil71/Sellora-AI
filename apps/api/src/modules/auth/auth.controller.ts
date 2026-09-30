import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { AllowNoTenant, Auth, Public, ResponseMessage, UserOnly } from '../../common/decorators';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { env } from '../../config/env';
import { AuthService, AuthResult } from './auth.service';
import { TokenService, COOKIE_CSRF, COOKIE_REFRESH } from './token.service';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  createWorkspaceSchema,
  disableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
  switchWorkspaceSchema,
  tokenSchema,
  twoFactorCodeSchema,
  twoFactorLoginSchema,
} from './auth.schemas';

const strict = { default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: 60_000 } };

function meta(req: AppRequest) {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
}

@Controller('auth')
@UserOnly()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private async respond(res: Response, result: AuthResult) {
    this.tokens.setAuthCookies(res, result.accessToken, result.refreshToken);
    return this.auth.me(result.userId, result.tenantId);
  }

  @Post('register')
  @Public()
  @Throttle(strict)
  async register(@Body(zBody(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(body, meta(req)));
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  async login(@Body(zBody(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.auth.login(body.email, body.password, meta(req));
    if (outcome.twoFactorRequired) return { twoFactorRequired: true, challengeToken: outcome.challengeToken };
    return { twoFactorRequired: false, ...(await this.respond(res, outcome)) };
  }

  @Post('login/2fa')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  async loginTwoFactor(@Body(zBody(twoFactorLoginSchema)) body: z.infer<typeof twoFactorLoginSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.loginWithTwoFactor(body.challengeToken, body.code, meta(req)));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
    if (!token) {
      // Clear the hint cookie too, otherwise the web proxy would keep treating the browser as signed in.
      this.tokens.clearAuthCookies(res);
      throw new UnauthorizedException({ code: 'NO_SESSION', message: 'Please sign in.' });
    }
    try {
      const result = await this.auth.refresh(token, meta(req));
      const csrf = (req.cookies as Record<string, string> | undefined)?.[COOKIE_CSRF];
      this.tokens.setAuthCookies(res, result.accessToken, result.refreshToken, csrf);
      return { refreshed: true };
    } catch (err) {
      this.tokens.clearAuthCookies(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @AllowNoTenant()
  @ResponseMessage('Signed out')
  async logout(@Auth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.sessionId, { userId: auth.userId!, name: auth.name, tenantId: auth.tenantId, ip: req.ip });
    this.tokens.clearAuthCookies(res);
    return { signedOut: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @AllowNoTenant()
  @ResponseMessage('Signed out from all devices')
  async logoutAll(@Auth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(auth.userId!, { name: auth.name, tenantId: auth.tenantId, ip: req.ip });
    this.tokens.clearAuthCookies(res);
    return { signedOut: true };
  }

  @Get('me')
  @AllowNoTenant()
  me(@Auth() auth: AuthContext) {
    if (auth.kind !== 'user' || !auth.userId) throw new UnauthorizedException();
    return this.auth.me(auth.userId, auth.tenantId);
  }

  @Patch('profile')
  @AllowNoTenant()
  updateProfile(@Auth() auth: AuthContext, @Body(zBody(profileSchema)) body: z.infer<typeof profileSchema>) {
    return this.auth.updateProfile(auth.userId!, body);
  }

  @Post('change-password')
  @AllowNoTenant()
  @Throttle(strict)
  changePassword(@Auth() auth: AuthContext, @Req() req: AppRequest, @Body(zBody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    return this.auth.changePassword(auth.userId!, auth.sessionId, body, { name: auth.name, tenantId: auth.tenantId, ip: req.ip });
  }

  @Get('sessions')
  @AllowNoTenant()
  sessions(@Auth() auth: AuthContext) {
    return this.auth.listSessions(auth.userId!, auth.sessionId);
  }

  @Delete('sessions/:id')
  @AllowNoTenant()
  revokeSession(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSessionById(auth.userId!, id);
  }

  @Post('switch-workspace')
  @AllowNoTenant()
  @HttpCode(200)
  async switchWorkspace(@Auth() auth: AuthContext, @Body(zBody(switchWorkspaceSchema)) body: z.infer<typeof switchWorkspaceSchema>, @Res({ passthrough: true }) res: Response) {
    const token = await this.auth.switchWorkspace(auth.userId!, auth.sessionId!, body.tenantId);
    this.tokens.setAccessCookie(res, token);
    return this.auth.me(auth.userId!, body.tenantId);
  }

  @Post('workspaces')
  @AllowNoTenant()
  async createWorkspace(@Auth() auth: AuthContext, @Body(zBody(createWorkspaceSchema)) body: z.infer<typeof createWorkspaceSchema>, @Res({ passthrough: true }) res: Response) {
    const { tenant, accessToken } = await this.auth.createWorkspace(auth.userId!, auth.sessionId!, body);
    this.tokens.setAccessCookie(res, accessToken);
    return this.auth.me(auth.userId!, tenant.id);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  forgot(@Body(zBody(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  reset(@Body(zBody(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  verifyEmail(@Body(zBody(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @AllowNoTenant()
  @HttpCode(200)
  @Throttle(strict)
  resend(@Auth() auth: AuthContext) {
    return this.auth.resendVerification(auth.userId!);
  }

  @Post('invitations/preview')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  previewInvitation(@Body(zBody(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.auth.previewInvitation(body.token);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(200)
  @Throttle(strict)
  async acceptInvitation(@Body(zBody(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.acceptInvitation(body, meta(req)));
  }

  @Post('2fa/setup')
  @AllowNoTenant()
  setup2fa(@Auth() auth: AuthContext) {
    return this.auth.setupTwoFactor(auth.userId!);
  }

  @Post('2fa/enable')
  @AllowNoTenant()
  @Throttle(strict)
  enable2fa(@Auth() auth: AuthContext, @Body(zBody(twoFactorCodeSchema)) body: z.infer<typeof twoFactorCodeSchema>) {
    return this.auth.enableTwoFactor(auth.userId!, body.code, { name: auth.name, tenantId: auth.tenantId });
  }

  @Post('2fa/disable')
  @AllowNoTenant()
  @Throttle(strict)
  disable2fa(@Auth() auth: AuthContext, @Body(zBody(disableTwoFactorSchema)) body: z.infer<typeof disableTwoFactorSchema>) {
    return this.auth.disableTwoFactor(auth.userId!, body.password, body.code, { name: auth.name, tenantId: auth.tenantId });
  }
}
