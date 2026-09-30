import { HttpStatus, Injectable } from '@nestjs/common';
import { MembershipStatus, TokenType } from '@prisma/client';
import { PERMISSION_GROUPS, isPermission } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { MailService } from '../mail/mail.service';
import { UsageService } from '../billing/usage.service';
import { AppException, ConflictError, ensureFound, ValidationError } from '../../common/errors';
import type { Actor, AuthContext } from '../../common/auth-context';
import { env } from '../../config/env';
import { slugify } from '../../common/utils/text.util';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly usage: UsageService,
  ) {}

  async list(tenantId: string) {
    const [members, invitations] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true, twoFactorEnabled: true } },
          role: { select: { id: true, key: true, name: true } },
        },
      }),
      this.prisma.verificationToken.findMany({
        where: { tenantId, type: TokenType.INVITATION, usedAt: null, expiresAt: { gt: new Date() } },
        include: { role: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      members: members.map((m) => ({ id: m.id, status: m.status, joinedAt: m.joinedAt, user: m.user, role: m.role })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    };
  }

  /** Active members for assignment pickers. */
  assignable(tenantId: string) {
    return this.prisma.user.findMany({
      where: { memberships: { some: { tenantId, status: MembershipStatus.ACTIVE } } },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Prevents granting a role that carries permissions the actor does not have. */
  private async assertCanAssign(auth: AuthContext, tenantId: string, roleId: string) {
    const role = ensureFound(
      await this.prisma.role.findFirst({
        where: { id: roleId, tenantId },
        include: { permissions: { include: { permission: { select: { key: true } } } } },
      }),
      'Role',
    );
    if (role.key === 'OWNER' && auth.roleKey !== 'OWNER') {
      throw new AppException('FORBIDDEN_ROLE', 'Only workspace owners can assign the Owner role.', HttpStatus.FORBIDDEN);
    }
    const escalation = role.permissions.map((p) => p.permission.key).filter((k) => !auth.permissions.has(k));
    if (escalation.length) {
      throw new AppException('FORBIDDEN_ROLE', 'You cannot assign a role with more permissions than your own.', HttpStatus.FORBIDDEN);
    }
    return role;
  }

  async invite(actor: Actor, auth: AuthContext, email: string, roleId: string) {
    const role = await this.assertCanAssign(auth, actor.tenantId, roleId);
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const member = await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: existingUser.id } } });
      if (member) throw new ConflictError('This person is already a member of the workspace.');
    }
    const pending = await this.prisma.verificationToken.count({
      where: { tenantId: actor.tenantId, type: TokenType.INVITATION, usedAt: null, expiresAt: { gt: new Date() } },
    });
    await this.usage.assertWithin(actor.tenantId, 'users', pending + 1);
    const raw = await this.auth.createInvitationToken(email, actor.tenantId, role.id, actor.userId!);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    const url = `${env.APP_URL}/accept-invite?token=${raw}`;
    const mail = await this.mail.queue(email, 'team-invitation', { workspace: tenant?.name, inviter: actor.name, role: role.name, url });
    await this.audit.log(actor, { action: 'team.member_invited', entityType: 'User', metadata: { email, role: role.key } });
    // Without SMTP the admin shares the link manually; it is only returned to the inviter.
    return { invited: true, emailSent: mail.queued, inviteUrl: mail.queued ? undefined : url };
  }

  async revokeInvitation(actor: Actor, id: string) {
    const token = ensureFound(
      await this.prisma.verificationToken.findFirst({ where: { id, tenantId: actor.tenantId, type: TokenType.INVITATION, usedAt: null } }),
      'Invitation',
    );
    await this.prisma.verificationToken.delete({ where: { id: token.id } });
    await this.audit.log(actor, { action: 'team.invitation_revoked', entityType: 'Invitation', entityId: id, metadata: { email: token.email } });
    return { revoked: true };
  }

  private async ownerCount(tenantId: string) {
    return this.prisma.userRole.count({ where: { tenantId, status: MembershipStatus.ACTIVE, role: { key: 'OWNER' } } });
  }

  async updateMember(actor: Actor, auth: AuthContext, userId: string, input: { roleId?: string; status?: 'ACTIVE' | 'DISABLED' }) {
    if (userId === actor.userId) throw new ValidationError('You cannot change your own role or status.');
    const member = ensureFound(
      await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } }, include: { role: true } }),
      'Member',
    );
    if (member.role.key === 'OWNER' && auth.roleKey !== 'OWNER') {
      throw new AppException('FORBIDDEN_ROLE', 'Only owners can change another owner.', HttpStatus.FORBIDDEN);
    }
    if (input.roleId) await this.assertCanAssign(auth, actor.tenantId, input.roleId);
    const demotingOwner =
      member.role.key === 'OWNER' &&
      ((input.roleId && input.roleId !== member.roleId) || input.status === 'DISABLED');
    if (demotingOwner && (await this.ownerCount(actor.tenantId)) <= 1) {
      throw new ValidationError('A workspace must keep at least one active owner.');
    }
    const updated = await this.prisma.userRole.update({
      where: { id: member.id },
      data: { ...(input.roleId ? { roleId: input.roleId } : {}), ...(input.status ? { status: input.status as MembershipStatus } : {}) },
      include: { role: true },
    });
    await this.access.invalidateUser(actor.tenantId, userId);
    await this.audit.log(actor, {
      action: input.roleId ? 'team.role_changed' : 'team.member_status_changed',
      entityType: 'User',
      entityId: userId,
      metadata: { from: member.role.key, to: updated.role.key, status: updated.status },
    });
    return { id: updated.id, role: { id: updated.role.id, key: updated.role.key, name: updated.role.name }, status: updated.status };
  }

  async removeMember(actor: Actor, auth: AuthContext, userId: string) {
    if (userId === actor.userId) throw new ValidationError('You cannot remove yourself. Transfer ownership first.');
    const member = ensureFound(
      await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } }, include: { role: true } }),
      'Member',
    );
    if (member.role.key === 'OWNER') {
      if (auth.roleKey !== 'OWNER') throw new AppException('FORBIDDEN_ROLE', 'Only owners can remove an owner.', HttpStatus.FORBIDDEN);
      if ((await this.ownerCount(actor.tenantId)) <= 1) throw new ValidationError('A workspace must keep at least one owner.');
    }
    await this.prisma.$transaction([
      this.prisma.conversation.updateMany({ where: { tenantId: actor.tenantId, assignedUserId: userId }, data: { assignedUserId: null } }),
      this.prisma.userRole.delete({ where: { id: member.id } }),
    ]);
    await this.access.invalidateUser(actor.tenantId, userId);
    await this.audit.log(actor, { action: 'team.member_removed', entityType: 'User', entityId: userId, metadata: { role: member.role.key } });
    return { removed: true };
  }

  // ------------------------------------------------------------------ roles

  permissionCatalog() {
    return PERMISSION_GROUPS;
  }

  async listRoles(tenantId: string) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { members: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      memberCount: r._count.members,
      permissions: r.permissions.map((p) => p.permission.key),
    }));
  }

  private async validatePermissions(auth: AuthContext, permissions: string[]) {
    const unknown = permissions.filter((p) => !isPermission(p));
    if (unknown.length) throw new ValidationError(`Unknown permissions: ${unknown.join(', ')}`);
    const escalation = permissions.filter((p) => !auth.permissions.has(p));
    if (escalation.length) throw new AppException('FORBIDDEN_ROLE', 'You cannot grant permissions you do not have.', HttpStatus.FORBIDDEN);
    const rows = await this.prisma.permission.findMany({ where: { key: { in: permissions } }, select: { id: true } });
    return rows.map((r) => ({ permissionId: r.id }));
  }

  async createRole(actor: Actor, auth: AuthContext, input: { name: string; description?: string; permissions: string[] }) {
    const perms = await this.validatePermissions(auth, input.permissions);
    const role = await this.prisma.role.create({
      data: {
        tenantId: actor.tenantId,
        key: `CUSTOM_${slugify(input.name).toUpperCase().replace(/-/g, '_')}_${Date.now().toString(36).toUpperCase()}`,
        name: input.name,
        description: input.description,
        permissions: { create: perms },
      },
    });
    await this.audit.log(actor, { action: 'role.created', entityType: 'Role', entityId: role.id, metadata: { name: role.name, permissions: input.permissions } });
    return role;
  }

  async updateRole(actor: Actor, auth: AuthContext, id: string, input: { name?: string; description?: string; permissions?: string[] }) {
    const role = ensureFound(await this.prisma.role.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Role');
    if (role.isSystem) throw new ValidationError('System roles cannot be edited. Create a custom role instead.');
    const perms = input.permissions ? await this.validatePermissions(auth, input.permissions) : undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: input.name, description: input.description } });
      if (perms) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ ...p, roleId: id })) });
      }
    });
    await this.access.invalidateTenant(actor.tenantId);
    await this.audit.log(actor, { action: 'role.permissions_changed', entityType: 'Role', entityId: id, metadata: { name: input.name ?? role.name, permissions: input.permissions } });
    return { id };
  }

  async deleteRole(actor: Actor, id: string) {
    const role = ensureFound(
      await this.prisma.role.findFirst({ where: { id, tenantId: actor.tenantId }, include: { _count: { select: { members: true } } } }),
      'Role',
    );
    if (role.isSystem) throw new ValidationError('System roles cannot be deleted.');
    if (role._count.members > 0) throw new ValidationError('Reassign members of this role before deleting it.');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log(actor, { action: 'role.deleted', entityType: 'Role', entityId: id, metadata: { name: role.name } });
    return { deleted: true };
  }

  /** Revokes all sessions of a member (security action). */
  async signOutMember(actor: Actor, userId: string) {
    ensureFound(await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } } }), 'Member');
    await this.tokens.revokeAllForUser(userId, 'revoked_by_admin');
    await this.audit.log(actor, { action: 'team.member_signed_out', entityType: 'User', entityId: userId });
    return { signedOut: true };
  }
}
