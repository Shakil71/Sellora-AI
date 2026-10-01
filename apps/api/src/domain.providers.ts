import type { Provider } from '@nestjs/common';
import { ActivityService, EventsService } from './modules/events/events.service';
import { CustomersService } from './modules/crm/customers.service';
import { LeadsService } from './modules/crm/leads.service';
import { DealsService } from './modules/crm/deals.service';
import { TasksService } from './modules/crm/tasks.service';
import { InventoryService } from './modules/commerce/inventory.service';
import { ProductsService } from './modules/commerce/products.service';
import { OrdersService } from './modules/commerce/orders.service';
import { PaymentsService } from './modules/commerce/payments.service';
import { InvoicesService } from './modules/commerce/invoices.service';
import { DeliveriesService } from './modules/commerce/deliveries.service';
import { WhatsAppGraphClient } from './modules/whatsapp/whatsapp-graph.client';
import { WhatsAppService } from './modules/whatsapp/whatsapp.service';
import { WhatsAppWebhookService } from './modules/whatsapp/webhook.service';
import { ChannelsService } from './modules/channels/channels.service';
import { ConversationsService } from './modules/conversations/conversations.service';
import { MessagingService } from './modules/conversations/messaging.service';
import { InboundService } from './modules/conversations/inbound.service';
import { MediaService } from './modules/conversations/media.service';
import { AIProviderService } from './modules/ai/ai-provider.service';
import { KnowledgeService } from './modules/ai/knowledge.service';
import { AIToolsService } from './modules/ai/ai-tools.service';
import { AgentRuntimeService } from './modules/ai/agent-runtime.service';
import { AgentsService } from './modules/ai/agents.service';
import { WorkflowsService } from './modules/automation/workflows.service';
import { WorkflowEngineService } from './modules/automation/workflow-engine.service';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { SearchService } from './modules/analytics/search.service';
import { OnboardingService } from './modules/onboarding/onboarding.controller';
import { MetaGraphClient } from './modules/integrations/meta-graph.client';
import { ChannelConnectionsService } from './modules/integrations/channel-connections.service';
import { MetaWebhookService } from './modules/integrations/meta-webhook.service';
import { WebChatService } from './modules/integrations/webchat.service';
import { WebhooksService } from './modules/integrations/webhooks.service';
import { PlanPaymentsService } from './modules/billing/plan-payments.service';
import { PaymentMethodsService } from './modules/payment-gateways/payment-methods.service';

/** Business services registered in DomainModule (shared by API and worker). */
import { ProductImportService } from './modules/product-import/product-import.service';

export const DOMAIN_PROVIDERS: Provider[] = [
  EventsService,
  ActivityService,
  CustomersService,
  LeadsService,
  DealsService,
  TasksService,
  InventoryService,
  ProductsService,
  OrdersService,
  PaymentsService,
  InvoicesService,
  DeliveriesService,
  WhatsAppGraphClient,
  WhatsAppService,
  WhatsAppWebhookService,
  ChannelsService,
  ConversationsService,
  MessagingService,
  InboundService,
  MediaService,
  AIProviderService,
  KnowledgeService,
  AIToolsService,
  AgentRuntimeService,
  AgentsService,
  WorkflowsService,
  WorkflowEngineService,
  AnalyticsService,
  SearchService,
  OnboardingService,
  MetaGraphClient,
  ChannelConnectionsService,
  MetaWebhookService,
  WebChatService,
  WebhooksService,
  PaymentMethodsService,
  PlanPaymentsService,
  ProductImportService,
];
