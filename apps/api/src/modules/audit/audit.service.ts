import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, toPaginated } from '../../common/pagination';

const SECRET_KEY_PATTERN = /(password|secret|token|api_?key|private_?key|secret_?key|authorization|credentials?)$/i;

/** Remove anything that looks like a secret before persisting metadata. */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : scrubSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Who performed an action. Tenant may be null for platform-level events (e.g. failed login). */
export interface AuditActor {
  tenantId?: string | null;
  userId?: string | null;
  name?: string | null;
  type?: 'USER' | 'API_KEY' | 'SYSTEM' | 'AI';
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an audit entry. Never throws: auditing must not break business actions. */
  async log(actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: actor.tenantId ?? null,
          actorId: actor.userId ?? null,
          actorType: (actor.type as ActorType) ?? ActorType.USER,
          actorName: actor.name ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          ip: actor.ip,
          userAgent: actor.userAgent,
          metadata: entry.metadata ? (scrubSecrets(entry.metadata) as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }

  async list(
    tenantId: string,
    q: { page: number; pageSize: number; search?: string; action?: string; actorId?: string; entityType?: string },
  ) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.search
        ? {
            OR: [
              { action: { contains: q.search, mode: 'insensitive' } },
              { actorName: { contains: q.search, mode: 'insensitive' } },
              { entityId: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }
}
