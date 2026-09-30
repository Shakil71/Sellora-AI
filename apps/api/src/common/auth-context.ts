import type { Request } from 'express';

export type AuthKind = 'user' | 'api_key';

export interface AuthContext {
  kind: AuthKind;
  userId: string | null;
  apiKeyId?: string;
  tenantId: string | null;
  sessionId?: string;
  name: string;
  email?: string;
  roleKey?: string;
  roleId?: string;
  isSuperAdmin: boolean;
  permissions: Set<string>;
  /** true when authenticated via cookies (CSRF protection applies) */
  viaCookie: boolean;
}

/** Tenant-scoped actor passed into services for auditing and ownership. */
export interface Actor {
  tenantId: string;
  userId: string | null;
  name: string;
  type: 'USER' | 'API_KEY' | 'SYSTEM' | 'AI';
  ip?: string;
  userAgent?: string;
}

export interface AppRequest extends Request {
  auth?: AuthContext;
  rawBody?: Buffer;
}

export function systemActor(tenantId: string, name = 'System'): Actor {
  return { tenantId, userId: null, name, type: 'SYSTEM' };
}

export function aiActor(tenantId: string, agentName = 'AI Agent'): Actor {
  return { tenantId, userId: null, name: agentName, type: 'AI' };
}
