import { Injectable } from '@nestjs/common';
import { MembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface MembershipAccess {
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  tenantStatus: TenantStatus;
}

const ACCESS_TTL_SECONDS = 300;

/**
 * Resolves a user's role and permissions inside a workspace. Results are cached
 * in Redis and invalidated whenever roles or memberships change.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private key(tenantId: string, userId: string) {
    return `access:${tenantId}:${userId}`;
  }

  async getAccess(userId: string, tenantId: string): Promise<MembershipAccess | null> {
    const cached = await this.redis.getJson<MembershipAccess | { none: true }>(this.key(tenantId, userId));
    if (cached) return 'none' in cached ? null : cached;

    const membership = await this.prisma.userRole.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: {
        tenant: { select: { status: true } },
        role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
      },
    });
    const access: MembershipAccess | null =
      membership && membership.status === MembershipStatus.ACTIVE
        ? {
            membershipId: membership.id,
            roleId: membership.roleId,
            roleKey: membership.role.key,
            roleName: membership.role.name,
            permissions: membership.role.permissions.map((rp) => rp.permission.key),
            tenantStatus: membership.tenant.status,
          }
        : null;
    await this.redis.setJson(this.key(tenantId, userId), access ?? { none: true }, ACCESS_TTL_SECONDS);
    return access;
  }

  async invalidateUser(tenantId: string, userId: string) {
    await this.redis.del(this.key(tenantId, userId));
  }

  async invalidateTenant(tenantId: string) {
    await this.redis.delByPattern(`access:${tenantId}:*`);
  }
}
