import { Injectable } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import { ALL_PERMISSIONS } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../../common/utils/crypto.util';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

const KEY_PREFIX = 'sk_live_';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /** Validates a raw key. Keys are stored as SHA-256 hashes only. */
  async validate(rawKey: string): Promise<ApiKey | null> {
    if (!rawKey.startsWith(KEY_PREFIX) || rawKey.length > 200) return null;
    const hash = sha256(rawKey);
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
    // Throttle lastUsedAt writes to once per minute per key.
    const touchKey = `apikey:touch:${key.id}`;
    const fresh = await this.redis.client.set(touchKey, '1', 'EX', 60, 'NX').catch(() => null);
    if (fresh) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return key;
  }

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(actor: Actor, input: { name: string; permissions: string[]; expiresInDays?: number }, grantable: Set<string>) {
    const invalid = input.permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
    if (invalid.length) throw new ValidationError(`Unknown permissions: ${invalid.join(', ')}`);
    // A key can never carry more rights than its creator.
    const escalation = input.permissions.filter((p) => !grantable.has(p));
    if (escalation.length) throw new ValidationError(`You cannot grant permissions you do not have: ${escalation.join(', ')}`);

    const raw = `${KEY_PREFIX}${randomToken(32)}`;
    const key = await this.prisma.apiKey.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        prefix: raw.slice(0, 14),
        keyHash: sha256(raw),
        permissions: input.permissions,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
        createdById: actor.userId,
      },
    });
    await this.audit.log(actor, {
      action: 'api_key.created',
      entityType: 'ApiKey',
      entityId: key.id,
      metadata: { name: key.name, permissions: key.permissions },
    });
    // The raw key is returned exactly once.
    return { id: key.id, name: key.name, prefix: key.prefix, key: raw, permissions: key.permissions, expiresAt: key.expiresAt };
  }

  async revoke(actor: Actor, id: string) {
    const key = ensureFound(await this.prisma.apiKey.findFirst({ where: { id, tenantId: actor.tenantId } }), 'API key');
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await this.audit.log(actor, { action: 'api_key.revoked', entityType: 'ApiKey', entityId: key.id, metadata: { name: key.name } });
    return { id: key.id };
  }
}
