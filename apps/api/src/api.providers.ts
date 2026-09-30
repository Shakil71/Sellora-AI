import type { Provider } from '@nestjs/common';
import { AdminService } from './modules/admin/admin.controller';
import { InstallService } from './modules/install/install.controller';

/** Providers that only run inside the HTTP API process. */
export const API_EXTRA_PROVIDERS: Provider[] = [AdminService, InstallService];
