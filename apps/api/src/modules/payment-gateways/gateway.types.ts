/**
 * Payment gateway adapter contract.
 *
 * A gateway is described by data (`fields` drive the setup form in the web app)
 * plus two small functions: create a hosted payment page for an order, and turn
 * the gateway's webhook into a paid/failed outcome. Adding a gateway means
 * writing one adapter and registering it in gateways.ts; no other code changes.
 */

export interface GatewayField {
  key: string;
  label: string;
  /** Secrets are encrypted at rest and never sent back to the browser. */
  secret?: boolean;
  required?: boolean;
  /** Only known after the webhook is registered with the gateway, so it can be added after saving. */
  later?: boolean;
  placeholder?: string;
  help?: string;
  type?: 'text' | 'select' | 'textarea';
  options?: Array<{ value: string; label: string }>;
  default?: string;
}

export interface GatewayInfo {
  key: string;
  label: string;
  description: string;
  /** 'Global', or the countries/regions the gateway is mainly used in. */
  regions: string[];
  /** ISO country codes used to suggest a gateway for a country; empty = worldwide. */
  countries: string[];
  /** Currencies the gateway can charge in; empty = any. */
  currencies: string[];
  fields: GatewayField[];
  /** Where the owner finds the keys and where to register the webhook. */
  setupSteps: string[];
  docsUrl?: string;
  /** True when the gateway reports payments back by webhook. */
  webhook: boolean;
}

export interface PaymentRequest {
  /** Our payment id: sent to the gateway as the merchant reference. */
  reference: string;
  amount: number;
  currency: string;
  description: string;
  orderNumber: string;
  customer: { name: string; email?: string | null; phone?: string | null; city?: string | null; country?: string | null; address?: string | null };
  /** Public URLs the gateway should send the customer / its notifications to. */
  returnUrl: (outcome: 'success' | 'cancelled' | 'failed') => string;
  notifyUrl: string;
}

export interface GatewayContext {
  credentials: Record<string, string>;
  config: Record<string, string>;
}

export interface WebhookInput extends GatewayContext {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export type WebhookOutcome =
  | { reference: string; status: 'PAID'; transactionId?: string; amount?: number; currency?: string }
  | { reference: string; status: 'FAILED'; reason?: string };

export interface PaymentGatewayAdapter extends GatewayInfo {
  /** Throws a readable Error if the saved credentials are rejected by the gateway. */
  verify?(ctx: GatewayContext): Promise<void>;
  /** Creates the hosted payment page. Absent for manual methods. */
  createPayment?(ctx: GatewayContext, req: PaymentRequest): Promise<{ url: string; providerRef?: string }>;
  /**
   * Verifies the webhook signature and maps it to an outcome.
   * Throws when the signature is invalid; returns null for events we ignore.
   */
  parseWebhook?(input: WebhookInput): Promise<WebhookOutcome | null>;
}

export class GatewayError extends Error {}
