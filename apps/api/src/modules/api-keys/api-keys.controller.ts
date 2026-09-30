import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { Auth, CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor, AuthContext } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { ApiKeysService } from './api-keys.service';

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.string()).min(1).max(100),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

@Controller('api-keys')
@RequirePermissions('api_keys.manage')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.apiKeys.list(tenantId);
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @Auth() auth: AuthContext,
    @Body(zBody(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.apiKeys.create(actor, body, auth.permissions);
  }

  @Delete(':id')
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(actor, id);
  }
}
