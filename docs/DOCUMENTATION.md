# Sellora AI — Product & Technical Documentation

## 1. Concepts

- **Workspace (tenant)** — a business. Every record (customers, products, orders, conversations, AI agents…) belongs to exactly one workspace, and every query is scoped by it on the server. Users can belong to several workspaces and switch from the top bar.
- **Roles** — Owner, Admin, Manager, Sales, Support, Agent, Viewer (system roles, not editable) plus custom roles built from ~55 granular permissions. **Super admin** is a platform-level flag for the installation operator (Platform admin page: workspaces, plans, queue health, dead-letter jobs).
- **Plans & limits** — Free, Starter, Pro, Business, Enterprise (edit `packages/shared/src/plans.ts`). Limits cover monthly AI and WhatsApp messages, members, products, workflows, storage, knowledge documents and AI agents. When a limit is reached the action is refused with a friendly message; background AI replies hand off to humans instead of failing.

## 2. Core flow

1. A customer writes on WhatsApp → Meta calls `POST /api/v1/webhooks/whatsapp`.
2. The API verifies `X-Hub-Signature-256` with the app secret, stores the event and queues it.
3. The worker creates/updates the customer, WhatsApp contact and conversation, stores the message (idempotent by WhatsApp message id) and broadcasts it to the inbox in realtime.
4. Automation events (`message.received`, `conversation.opened`) start matching workflows.
5. If the conversation is handled by AI, the AI job builds context (agent instructions, workspace instructions, customer profile, knowledge base excerpts, recent history) and calls the model with the enabled tools.
6. Tools run through the service layer (search, stock, quote, lead, order, task, handoff) — each authorized, validated and logged.
7. The reply is queued and sent through the channel; delivery/read receipts update the message status.
8. Orders reserve stock, update the customer's totals, emit `order.created`, notify the team and appear on the dashboard in realtime.

## 3. WhatsApp setup

1. Create an app at developers.facebook.com, add **WhatsApp**, and a WhatsApp Business Account with a phone number.
2. Create a **System User** with `whatsapp_business_messaging` and `whatsapp_business_management` permissions and generate a permanent token.
3. In Sellora AI: **WhatsApp → Accounts → Connect number** — enter Phone number ID, WABA ID, access token and **App secret** (App settings → Basic). Tokens are encrypted with `ENCRYPTION_KEY`.
4. Copy the **Callback URL** and **Verify token** into Meta → WhatsApp → Configuration → Webhook and subscribe to `messages`. HTTPS is required.
5. Use **Test connection**. Sync or create **Templates** to message customers outside the 24-hour window.

Without WhatsApp, use **Inbox → Test conversation** (flask icon) to try the full AI flow; nothing is sent externally.

## 3a. Integrations (website chat, Messenger, Instagram, webhooks, API)

Everything lives under **Integrations** in the sidebar (permission `integrations.view`; changes need `integrations.manage`, held by Owner and Admin). Every channel feeds the same inbox, AI agent, CRM, automations and analytics.

### Website chat
1. **Integrations → Website chat → Add website chat**: name, AI agent, title, greeting, brand colour, position, optional contact form and allowed websites.
2. Copy the one-line embed code and paste it before `</body>` on your site. Guides for WordPress, Shopify, Wix, Squarespace, Webflow and Google Tag Manager are built in.
3. Use **Preview** to try the real chat. Visitors appear as customers with source `web_chat`; the AI replies instantly and your team can take over from the inbox.

The widget runs in an isolated frame, so your site's styles cannot break it, and it opens full screen on phones. JavaScript API: `SelloraChat.open()`, `.close()`, `.toggle()`; add `data-open="true"` to the script tag to open it on load. **Allowed websites** hides the chat on other domains in normal browsers. It is not a security boundary: the widget key is public, like any live-chat key.

Security: visitors get a signed session token, only ever see their own conversation and never internal notes. Messages are rate limited per IP. A typed email is stored on the new customer but never merged into an existing customer automatically, because it is unverified.

### Facebook Messenger and Instagram
1. In developers.facebook.com create (or reuse) an app with the **Messenger** product (and **Instagram** for Instagram). Link your Instagram professional account to your Facebook Page.
2. Generate a long-lived **Page access token** with `pages_messaging` (plus `instagram_manage_messages` for Instagram) and copy the **App secret**.
3. **Integrations → Messenger / Instagram → Connect**: Page ID (and Instagram account ID), token, app secret and AI agent. Sellora checks the token and subscribes the Page to webhooks.
4. Paste the shown **Callback URL** and **Verify token** into the app's webhook settings and subscribe to `messages` and `messaging_postbacks` (plus `message_deliveries` and `message_reads` for Messenger). HTTPS on a public domain is required.

Meta allows free-form replies for 24 hours after the customer's last message; after that the composer explains why it is locked. Long AI replies are split automatically (Messenger 2,000 and Instagram 1,000 characters).

### Outgoing webhooks
**Integrations → Webhooks → Add endpoint** with an HTTPS URL and the events to send (or all events). Each delivery is a `POST` with JSON `{ id, event, createdAt, workspaceId, data }`, where `data` includes readable details: the order with items and totals, the customer, the lead or the product. Headers: `X-Sellora-Event`, `X-Sellora-Delivery`, `X-Sellora-Timestamp` and `X-Sellora-Signature: t=<unix>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` with the endpoint secret. Reply 2xx within 10 seconds; failures are retried 6 times with exponential backoff (about an hour). After 20 consecutive failed events the endpoint is switched off and managers are notified. The delivery log shows status codes and response bodies and lets you redeliver. Private and LAN addresses are refused (SSRF protection).

### Developer API
**Integrations → Developer API** shows ready-to-copy cURL, JavaScript and PHP examples for syncing products and stock, sending contact forms as leads, creating customers and orders from your checkout and reading order status. Create keys in **Settings → API** with only the permissions each system needs.

## 4. AI configuration

- **Settings → AI**: API key (or platform `OPENAI_API_KEY`), base URL for OpenAI-compatible providers, chat and embedding models, **Test connection**.
- **AI → Agents**: name, tone, language, personality, instructions, business info, sales objectives, escalation rules, working hours, fallback behaviour, model override, temperature, enabled tools and knowledge bases. The **Test** tab is a playground that uses real data but runs write tools in dry-run mode.
- **AI → AI Instructions**: rules added to every agent.
- **AI → Product Knowledge**: FAQs and details per product used in recommendations.
- **AI → Usage**: tokens, estimated cost (from `AI_PRICE_*`), tool call log with inputs/outputs.

### Safety model

- The model never touches the database. Only the tools in `apps/api/src/modules/ai/ai-tools.service.ts` can act, always scoped to the conversation's customer and workspace.
- Prices, stock and totals must come from tool results (enforced in the system prompt and by tool design).
- `createOrder` requires `customerConfirmed: true`, delivery details and the workspace setting *Let AI agents place orders*.
- Replies are checked for leaked keys and system prompt text before sending.
- When unsure the agent asks or calls `transferToHuman`: the conversation switches to HUMAN, the team is notified and an AI summary is generated.
- If the provider is not configured, over quota or failing after retries, conversations are handed to humans automatically.

## 5. Knowledge base (RAG)

Upload PDF, DOCX, TXT or Markdown, paste text or import a public web page (SSRF-protected). The documents queue extracts text, splits it into overlapping ~3,000-character chunks and, when AI is configured, creates embeddings. Retrieval uses cosine similarity over embeddings, falling back to PostgreSQL full-text search. Embeddings are stored as `float8[]`; for very large knowledge bases switch `AIEmbedding.vector` to `pgvector` (the retrieval function is isolated in `KnowledgeService.search`). Use **Re-index** after changing the embedding model.

## 6. Commerce

- **Inventory modes** (Settings → Workspace): *Reserve* (default) holds stock when an order is placed and deducts it when shipped/delivered; *Deduct* removes it immediately. Cancelling releases or restocks. Backorders are optional. Every change is an `InventoryMovement`; low/out-of-stock transitions notify the team and emit `inventory.low`.
- **Pricing**: totals are computed server-side in integer cents (`packages/shared/src/money.ts`): line discounts, order discount, tax on the discounted subtotal, then shipping (delivery zone fee, default fee or free-shipping threshold).
- **Order lifecycle**: PENDING → CONFIRMED → PROCESSING → PACKED → SHIPPED → DELIVERED, with CANCELLED and REFUNDED. Invalid transitions are rejected; every change is recorded in the status history; the customer can be notified on WhatsApp.
- **Payments** are recorded against orders (methods are configurable data). Online payment gateways plug in through the `PaymentGateway` interface; subscription billing uses the `PaymentProvider` interface (Stripe implementation included).
- **Invoices** are created from orders, printable from the browser and downloadable as PDF (`InvoicePdfRenderer`).

## 7. Automation

Workflows are graphs of one **trigger**, **conditions** (yes/no branches) and **actions**, edited on the visual canvas. Catalog: `packages/shared/src/automation.ts` — add a new trigger/condition/action there and implement it in `WorkflowEngineService`.

Execution: domain events are queued → matching active workflows create a `WorkflowRun` → the worker executes steps, logging each `WorkflowRunStep`. Failed steps are retried (3 attempts, exponential backoff) without repeating completed side effects. Delays schedule a delayed job. After final failure the run is marked failed, admins are notified and the job goes to the dead-letter queue. A per-record loop guard prevents workflows from re-triggering themselves in tight loops. `customer.inactive` is evaluated daily.

## 8. Security

- Passwords hashed with Argon2id; account lockout after 5 failures; optional TOTP 2FA.
- 15-minute access JWT + rotating refresh tokens in HTTP-only, SameSite=Lax cookies; reuse detection revokes the session family; logout everywhere; admin can sign members out.
- Double-submit CSRF tokens for cookie sessions; Helmet headers; strict CORS; Redis-backed rate limits (tighter on auth endpoints).
- Zod validation with unknown keys stripped (no mass assignment of `tenantId`); Prisma parameterised queries.
- Tenant isolation on every query; cross-tenant IDs return 404.
- Uploads: size limit, content-sniffed MIME allow-list per purpose, no SVG, private folders require a session in the same workspace.
- Secrets (WhatsApp tokens, app secrets, AI keys, 2FA secrets) encrypted with AES-256-GCM; API keys stored as SHA-256 hashes; audit logs scrub secret-like fields.
- Webhooks: WhatsApp HMAC-SHA256 signature, Stripe signature with timestamp tolerance.
- Errors never expose stack traces in production; every response carries a request id.

## 9. Architecture & extension points

- **Channels**: `MessagingChannel` interface (`apps/api/src/modules/channels/channel.types.ts`). WhatsApp, website chat, Messenger, Instagram and the internal test channel are implemented. To add another (for example Telegram): add a `ChannelType` enum value (migration), implement the interface, register it in `ChannelsService`, store a `ChannelConnection` and `ChannelContact`, and pass incoming messages to `InboundService.receiveOnConnection`.
- **AI providers**: `LLMProvider` interface in `ai-provider.service.ts`.
- **Storage**: `StorageProvider` (local, S3-compatible).
- **Email**: `EmailProvider` (SMTP).
- **Billing**: `PaymentProvider` (subscriptions) and `PaymentGateway` (order payments).
- **Queues** (BullMQ, prefix `sellora`): `whatsapp` (also sends replies on every channel), `ai`, `notifications`, `documents`, `automation`, `analytics`, `integrations` (Meta webhooks and outgoing webhook deliveries), `dead-letter`.

## 10. Observability

Structured JSON logs (pino) with timestamp, level, service (`sellora-api` / `sellora-worker`), request id, user id and tenant id; authorization, cookies and secrets are redacted. Health endpoints: `/health`, `/health/live`, `/health/ready` (database, Redis, storage, worker presence). Queue depths and dead-letter jobs are visible in **Platform admin**.

## 11. Demo data

`npm run db:seed:demo` creates the fictional "Acme Commerce" workspace (flagged `isDemo`, tagged `demo`) with products, customers, orders, leads, deals, conversations (internal test channel), a knowledge base, an AI agent and two workflows. Sign in with `demo@sellora.test` / `SelloraDemo2026`. Do not run it against production data you care about.

## 12. Backup, restore, upgrade

See [DEPLOYMENT.md](DEPLOYMENT.md#5-operations).
