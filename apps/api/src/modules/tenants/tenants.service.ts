import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MembershipStatus, Prisma, StageType } from '@prisma/client';
import { PERMISSION_GROUPS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, SystemRoleKey } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../../common/utils/text.util';
import { ensureFound } from '../../common/errors';
import type { Actor } from '../../common/auth-context';
import { commerceSettingsSchema, readCommerceSettings, CommerceSettings } from './tenant-settings';

export interface ProvisionInput {
  name: string;
  businessName?: string;
  industry?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  isDemo?: boolean;
}

export const DEFAULT_PIPELINE_STAGES: Array<{ name: string; probability: number; type: StageType; color: string }> = [
  { name: 'New Lead', probability: 10, type: StageType.OPEN, color: '#64748b' },
  { name: 'Contacted', probability: 20, type: StageType.OPEN, color: '#0ea5e9' },
  { name: 'Qualified', probability: 40, type: StageType.OPEN, color: '#6366f1' },
  { name: 'Proposal', probability: 60, type: StageType.OPEN, color: '#f59e0b' },
  { name: 'Negotiation', probability: 80, type: StageType.OPEN, color: '#f97316' },
  { name: 'Won', probability: 100, type: StageType.WON, color: '#10b981' },
  { name: 'Lost', probability: 0, type: StageType.LOST, color: '#ef4444' },
];

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(name: string, tx: Prisma.TransactionClient) {
    const base = slugify(name);
    let slug = base;
    for (let i = 0; i < 20; i++) {
      const exists = await tx.tenant.findUnique({ where: { slug } });
      if (!exists) return slug;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  /** Creates a workspace with system roles, default pipeline, subscription and owner membership. */
  async provision(ownerUserId: string, input: ProvisionInput, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient) => {
      const tenant = await db.tenant.create({
        data: {
          name: input.name,
          slug: await this.uniqueSlug(input.name, db),
          businessName: input.businessName ?? input.name,
          industry: input.industry,
          country: input.country,
          currency: input.currency ?? 'USD',
          timezone: input.timezone ?? 'UTC',
          isDemo: input.isDemo ?? false,
          settings: { commerce: commerceSettingsSchema.parse({}) } as Prisma.InputJsonValue,
        },
      });
      const permissions = await db.permission.findMany({ select: { id: true, key: true } });
      const permId = new Map(permissions.map((p) => [p.key, p.id]));
      const roleIds: Partial<Record<SystemRoleKey, string>> = {};
      for (const key of SYSTEM_ROLE_KEYS) {
        const def = SYSTEM_ROLES[key];
        const role = await db.role.create({
          data: {
            tenantId: tenant.id,
            key,
            name: def.name,
            description: def.description,
            isSystem: true,
            permissions: {
              create: def.permissions.filter((p) => permId.has(p)).map((p) => ({ permissionId: permId.get(p)! })),
            },
          },
        });
        roleIds[key] = role.id;
      }
      await db.userRole.create({
        data: { tenantId: tenant.id, userId: ownerUserId, roleId: roleIds.OWNER!, status: MembershipStatus.ACTIVE },
      });
      await db.subscription.create({ data: { tenantId: tenant.id } });
      await db.pipeline.create({
        data: {
          tenantId: tenant.id,
          name: 'Sales Pipeline',
          isDefault: true,
          stages: {
            create: DEFAULT_PIPELINE_STAGES.map((s, i) => ({ ...s, tenantId: tenant.id, position: i })),
          },
        },
      });
      await db.user.update({ where: { id: ownerUserId }, data: { lastTenantId: tenant.id } });
      return tenant;
    };
    return tx ? run(tx) : this.prisma.$transaction(run, { timeout: 20_000 });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.userRole.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      include: { tenant: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } }, role: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.tenant, role: m.role }));
  }

  async getCurrent(tenantId: string) {
    const tenant = ensureFound(
      await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } }),
      'Workspace',
    );
    const { aiConfigEnc: _secret, ...safe } = tenant;
    return { ...safe, commerce: readCommerceSettings(tenant.settings) };
  }

  async update(actor: Actor, data: Prisma.TenantUpdateInput) {
    const tenant = await this.prisma.tenant.update({ where: { id: actor.tenantId }, data });
    await this.audit.log(actor, { action: 'workspace.updated', entityType: 'Tenant', entityId: tenant.id, metadata: { fields: Object.keys(data) } });
    return this.getCurrent(actor.tenantId);
  }

  async commerceSettings(tenantId: string): Promise<CommerceSettings> {
    const tenant = ensureFound(await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }), 'Workspace');
    return readCommerceSettings(tenant.settings);
  }

  async updateCommerceSettings(actor: Actor, patch: Partial<CommerceSettings>) {
    const tenant = ensureFound(await this.prisma.tenant.findUnique({ where: { id: actor.tenantId } }), 'Workspace');
    const current = readCommerceSettings(tenant.settings);
    const next = commerceSettingsSchema.parse({ ...current, ...patch });
    const settings = { ...((tenant.settings as Record<string, unknown>) ?? {}), commerce: next };
    await this.prisma.tenant.update({ where: { id: tenant.id }, data: { settings: settings as Prisma.InputJsonValue } });
    await this.audit.log(actor, { action: 'workspace.commerce_settings_updated', entityType: 'Tenant', entityId: tenant.id, metadata: { fields: Object.keys(patch) } });
    return next;
  }

  async invalidateAccess(tenantId: string) {
    await this.access.invalidateTenant(tenantId);
  }
}

/**
 * Keeps the permission catalog and system roles in the database in sync with
 * the code on every API start. Idempotent and safe to run repeatedly.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.sync();
    } catch (err) {
      this.logger.warn(`Permission sync skipped: ${(err as Error).message}`);
    }
  }

  async sync() {
    for (const group of PERMISSION_GROUPS) {
      for (const p of group.permissions) {
        await this.prisma.permission.upsert({
          where: { key: p.key },
          create: { key: p.key, group: group.group, description: p.description },
          update: { group: group.group, description: p.description },
        });
      }
    }
    const permissions = await this.prisma.permission.findMany({ select: { id: true, key: true } });
    const permId = new Map(permissions.map((p) => [p.key, p.id]));
    const roles = await this.prisma.role.findMany({
      where: { isSystem: true },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });
    const touchedTenants = new Set<string>();
    for (const role of roles) {
      const def = SYSTEM_ROLES[role.key as SystemRoleKey];
      if (!def) continue;
      const current = new Set(role.permissions.map((rp) => rp.permission.key));
      const desired = new Set(def.permissions.filter((p) => permId.has(p)));
      const same = current.size === desired.size && [...desired].every((p) => current.has(p));
      if (same) continue;
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        this.prisma.rolePermission.createMany({
          data: [...desired].map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
        }),
      ]);
      touchedTenants.add(role.tenantId);
    }
    for (const t of touchedTenants) await this.access.invalidateTenant(t);
    if (touchedTenants.size) this.logger.log(`Updated system roles in ${touchedTenants.size} workspace(s)`);
  }
}
