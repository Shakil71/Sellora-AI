import { z } from 'zod';
import { passwordProblem } from '@sellora/shared';

export const passwordSchema = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  email,
  password: passwordSchema,
  workspaceName: z.string().trim().min(2, 'Enter your business name').max(100),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(10).max(2000),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(500), password: passwordSchema });
export const tokenSchema = z.object({ token: z.string().min(10).max(500) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
  logoutOtherSessions: z.boolean().default(true),
});
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});
export const switchWorkspaceSchema = z.object({ tenantId: z.string().uuid() });
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  industry: z.string().trim().max(60).optional(),
  country: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  timezone: z.string().trim().max(60).optional(),
});
export const twoFactorCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(500),
  name: z.string().trim().min(2).max(100).optional(),
  password: z.string().min(1).max(128),
});
