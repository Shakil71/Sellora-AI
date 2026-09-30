import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Auth, CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor, AuthContext } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { TeamService } from './team.service';

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), roleId: z.string().uuid() });
const updateMemberSchema = z
  .object({ roleId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() })
  .refine((v) => v.roleId || v.status, 'Nothing to update');
const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(200),
});

@Controller('users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions('users.view')
  list(@TenantId() tenantId: string) {
    return this.team.list(tenantId);
  }

  /** Members available for assignment pickers (any workspace member). */
  @Get('assignable')
  assignable(@TenantId() tenantId: string) {
    return this.team.assignable(tenantId);
  }

  @Post('invite')
  @RequirePermissions('users.create')
  invite(@CurrentActor() actor: Actor, @Auth() auth: AuthContext, @Body(zBody(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.team.invite(actor, auth, body.email, body.roleId);
  }

  @Delete('invitations/:id')
  @RequirePermissions('users.create')
  revokeInvite(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.revokeInvitation(actor, id);
  }

  @Patch(':userId')
  @RequirePermissions('users.update')
  update(
    @CurrentActor() actor: Actor,
    @Auth() auth: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zBody(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>,
  ) {
    return this.team.updateMember(actor, auth, userId, body);
  }

  @Post(':userId/sign-out')
  @RequirePermissions('users.update')
  signOut(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.team.signOutMember(actor, userId);
  }

  @Delete(':userId')
  @RequirePermissions('users.delete')
  remove(@CurrentActor() actor: Actor, @Auth() auth: AuthContext, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.team.removeMember(actor, auth, userId);
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermissions('users.view')
  list(@TenantId() tenantId: string) {
    return this.team.listRoles(tenantId);
  }

  @Get('permissions')
  @RequirePermissions('users.view')
  catalog() {
    return this.team.permissionCatalog();
  }

  @Post()
  @RequirePermissions('roles.manage')
  create(@CurrentActor() actor: Actor, @Auth() auth: AuthContext, @Body(zBody(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.team.createRole(actor, auth, body);
  }

  @Patch(':id')
  @RequirePermissions('roles.manage')
  update(
    @CurrentActor() actor: Actor,
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zBody(roleSchema.partial())) body: Partial<z.infer<typeof roleSchema>>,
  ) {
    return this.team.updateRole(actor, auth, id, body);
  }

  @Delete(':id')
  @RequirePermissions('roles.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.team.deleteRole(actor, id);
  }
}
