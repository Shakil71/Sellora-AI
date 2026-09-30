import { Body, Controller, Get, Patch, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { TenantsService } from './tenants.service';
import { commerceSettingsSchema } from './tenant-settings';
import { AuditService } from '../audit/audit.service';

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  businessName: z.string().trim().max(120).nullable().optional(),
  industry: z.string().trim().max(60).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  timezone: z.string().trim().max(60).optional(),
  locale: z.string().trim().max(20).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  website: z.string().url().max(300).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  address: z.string().trim().max(300).nullable().optional(),
});

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorId: z.string().uuid().optional(),
});

@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@TenantId() tenantId: string) {
    return this.tenants.getCurrent(tenantId);
  }

  @Patch()
  @RequirePermissions('settings.update')
  update(@CurrentActor() actor: Actor, @Body(zBody(updateWorkspaceSchema)) body: z.infer<typeof updateWorkspaceSchema>) {
    return this.tenants.update(actor, body);
  }

  @Get('commerce')
  commerce(@TenantId() tenantId: string) {
    return this.tenants.commerceSettings(tenantId);
  }

  @Put('commerce')
  @RequirePermissions('settings.update')
  updateCommerce(@CurrentActor() actor: Actor, @Body(zBody(commerceSettingsSchema.partial())) body: Partial<z.infer<typeof commerceSettingsSchema>>) {
    return this.tenants.updateCommerceSettings(actor, body);
  }

  @Get('audit-logs')
  @RequirePermissions('audit.view')
  auditLogs(@TenantId() tenantId: string, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.audit.list(tenantId, q);
  }
}
