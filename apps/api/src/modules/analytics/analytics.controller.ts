import { Controller, Get, Query } from '@nestjs/common';
import { Auth, RequirePermissions, TenantId } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { AnalyticsService, Range } from './analytics.service';
import { SearchService } from './search.service';

const parseRange = (r?: string): Range => (['7d', '30d', '90d', '12m'].includes(r ?? '') ? (r as Range) : '30d');

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions('dashboard.view')
  dashboard(@TenantId() tenantId: string) {
    return this.analytics.dashboard(tenantId);
  }

  @Get('sales')
  @RequirePermissions('analytics.view')
  sales(@TenantId() tenantId: string, @Query('range') range?: string) {
    return this.analytics.sales(tenantId, parseRange(range));
  }

  @Get('crm')
  @RequirePermissions('analytics.view')
  crm(@TenantId() tenantId: string, @Query('range') range?: string) {
    return this.analytics.crm(tenantId, parseRange(range));
  }

  @Get('conversations')
  @RequirePermissions('analytics.view')
  conversations(@TenantId() tenantId: string, @Query('range') range?: string) {
    return this.analytics.conversations(tenantId, parseRange(range));
  }

  @Get('ai')
  @RequirePermissions('analytics.view')
  ai(@TenantId() tenantId: string, @Query('range') range?: string) {
    return this.analytics.ai(tenantId, parseRange(range));
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  query(@TenantId() tenantId: string, @Auth() auth: AuthContext, @Query('q') q = '') {
    return this.search.search(tenantId, String(q).slice(0, 100), auth.permissions);
  }
}
