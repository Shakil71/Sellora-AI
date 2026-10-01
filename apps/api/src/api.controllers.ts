import type { Type } from '@nestjs/common';
import { HealthController } from './modules/health/health.controller';
import { AuthController } from './modules/auth/auth.controller';
import { ApiKeysController } from './modules/api-keys/api-keys.controller';
import { BillingController } from './modules/billing/billing.controller';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { WorkspaceController } from './modules/tenants/workspace.controller';
import { RolesController, TeamController } from './modules/team/team.controller';
import { FilesController } from './modules/storage/files.controller';
import { CustomersController, DealsController, LeadsController, PipelinesController, TasksController } from './modules/crm/crm.controller';
import {
  CategoriesController,
  DeliveriesController,
  InventoryController,
  InvoicesController,
  OrdersController,
  PaymentsController,
  ProductsController,
} from './modules/commerce/commerce.controller';
import { WhatsAppController, WhatsAppWebhookController } from './modules/whatsapp/whatsapp.controller';
import { ConversationsController } from './modules/conversations/conversations.controller';
import { AIController } from './modules/ai/ai.controller';
import { WorkflowsController } from './modules/automation/automation.controller';
import { AnalyticsController, SearchController } from './modules/analytics/analytics.controller';
import { OnboardingController } from './modules/onboarding/onboarding.controller';
import { AdminController } from './modules/admin/admin.controller';
import { InstallController } from './modules/install/install.controller';
import { IntegrationsController, MetaWebhookController, WebChatPublicController } from './modules/integrations/integrations.controller';
import { PaymentGatewaysPublicController, PaymentMethodsController } from './modules/payment-gateways/payment-gateways.controller';

import { ProductImportController } from './modules/product-import/product-import.controller';

import { HomepageAdminController, SitePublicController } from './modules/site/site.controller';

export const API_CONTROLLERS: Type[] = [
  HealthController,
  AuthController,
  ApiKeysController,
  BillingController,
  NotificationsController,
  WorkspaceController,
  TeamController,
  RolesController,
  FilesController,
  CustomersController,
  LeadsController,
  PipelinesController,
  DealsController,
  TasksController,
  ProductImportController,
  ProductsController,
  CategoriesController,
  InventoryController,
  OrdersController,
  PaymentsController,
  InvoicesController,
  DeliveriesController,
  WhatsAppController,
  WhatsAppWebhookController,
  ConversationsController,
  AIController,
  WorkflowsController,
  AnalyticsController,
  SearchController,
  OnboardingController,
  AdminController,
  InstallController,
  IntegrationsController,
  WebChatPublicController,
  MetaWebhookController,
  PaymentMethodsController,
  PaymentGatewaysPublicController,
  SitePublicController,
  HomepageAdminController,
];
