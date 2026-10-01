import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { AllowNoTenant, Auth, Public, SuperAdminOnly } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { homeContentSchema, SiteService } from './site.service';

/** The home page content, readable by anyone. */
@Controller('site')
export class SitePublicController {
  constructor(private readonly site: SiteService) {}

  @Get('home')
  @Public()
  home() {
    return this.site.publicHome();
  }
}

/** Editing the home page: platform administrators only. */
@Controller('admin/homepage')
@SuperAdminOnly()
@AllowNoTenant()
export class HomepageAdminController {
  constructor(private readonly site: SiteService) {}

  @Get()
  get() {
    return this.site.content();
  }

  @Put()
  save(@Auth() auth: AuthContext, @Body(zBody(homeContentSchema)) body: z.infer<typeof homeContentSchema>) {
    return this.site.save(auth, body);
  }

  /** Back to the original text. */
  @Delete()
  reset(@Auth() auth: AuthContext) {
    return this.site.reset(auth);
  }
}
