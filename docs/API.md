# REST API

Base URL: `https://your-domain.com/api/v1` (development: `http://localhost:4000/api/v1`).

## Conventions

**Success**

```json
{ "success": true, "data": { }, "message": "optional" }
```

**Error**

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "email: Enter a valid email address", "details": [{ "path": "email", "message": "…" }], "requestId": "7b90adac-…" } }
```

Quote `requestId` when contacting support; it matches the server logs.

| Status | Meaning |
| --- | --- |
| 200/201 | Success |
| 401 | Missing, expired or invalid credentials |
| 402 | Plan limit reached (`PLAN_LIMIT_REACHED`) |
| 403 | Permission denied, CSRF failure or no workspace |
| 404 | Not found (also returned for records of other workspaces) |
| 409 | Conflict (duplicate SKU, insufficient stock…) |
| 412 | Integration not configured (AI, WhatsApp, billing) |
| 422 | Validation error |
| 429 | Rate limited |

**Lists** accept `page`, `pageSize` (≤100), `search`, `sort`, `order` and return `{ items, meta: { page, pageSize, total, totalPages } }`. Conversations and messages use cursor pagination (`cursor` / `before`, `nextCursor`).

## Authentication

### API keys (server-to-server)

Create keys in **Settings → API**. Keys are scoped to one workspace and to the permissions you select; they are shown once and stored hashed.

```bash
curl https://your-domain.com/api/v1/products?search=watch -H "x-api-key: sk_live_…"
```

`Authorization: Bearer sk_live_…` also works. API keys cannot call `/auth/*` account endpoints.

### Browser sessions

The web app uses HTTP-only cookies (`sellora_at` access token, `sellora_rt` refresh token) plus a double-submit CSRF token: send the `sellora_csrf` cookie value in the `x-csrf-token` header on every non-GET request. Refresh tokens rotate on use; reuse of an old token revokes the session family.

## Endpoints

Permissions in brackets. All paths are relative to `/api/v1`.

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{ name, email, password, workspaceName }` |
| POST | `/auth/login` | Returns `{ twoFactorRequired, challengeToken }` when 2FA is on |
| POST | `/auth/login/2fa` | `{ challengeToken, code }` |
| POST | `/auth/refresh` · `/auth/logout` · `/auth/logout-all` | |
| GET | `/auth/me` | User, active workspace, role, permissions, workspaces |
| POST | `/auth/switch-workspace` · `/auth/workspaces` | Switch / create workspace |
| POST | `/auth/forgot-password` · `/auth/reset-password` · `/auth/verify-email` · `/auth/resend-verification` | |
| POST | `/auth/change-password` · PATCH `/auth/profile` | |
| GET/DELETE | `/auth/sessions[/:id]` | Active sessions |
| POST | `/auth/2fa/setup` · `/auth/2fa/enable` · `/auth/2fa/disable` | TOTP |
| POST | `/auth/invitations/preview` · `/auth/invitations/accept` | |

### Workspace, team & settings
| Method | Path | Permission |
| --- | --- | --- |
| GET/PATCH | `/workspace` | settings.update to change |
| GET/PUT | `/workspace/commerce` | tax, shipping, delivery zones, inventory mode |
| GET | `/workspace/audit-logs` | audit.view |
| GET | `/users` · POST `/users/invite` · PATCH/DELETE `/users/:userId` | users.* |
| GET | `/users/assignable` | any member |
| GET/POST/PATCH/DELETE | `/roles`, GET `/roles/permissions` | roles.manage |
| GET/POST/DELETE | `/api-keys` | api_keys.manage |
| GET | `/billing` · POST `/billing/change-plan` · GET `/billing/plans` (public) · GET `/billing/usage` | billing.* |
| GET/POST | `/notifications`, `/notifications/read`, `/notifications/read-all`, `/notifications/preferences` | own |
| POST | `/files/upload?purpose=product|category|avatar|branding|attachment|document` | multipart `file` |

### CRM
| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/customers` · GET/PATCH/DELETE `/customers/:id` · GET `/customers/tags` | contacts.* |
| GET/POST | `/leads` · GET/PATCH/DELETE `/leads/:id` · POST `/leads/:id/convert` | crm.leads.* |
| GET/POST | `/pipelines` · PATCH/DELETE `/pipelines/:id` · GET `/pipelines/:id/board` | crm.deals.view / crm.pipelines.manage |
| GET/POST | `/deals` · GET/PATCH/DELETE `/deals/:id` · POST `/deals/:id/move` | crm.deals.* |
| GET/POST | `/tasks` · PATCH/DELETE `/tasks/:id` | tasks.* |

### Commerce
| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/products` · GET `/products/search?q=` · GET/PATCH/DELETE `/products/:id` | products.* |
| GET/POST | `/categories` · PATCH/DELETE `/categories/:id` | products.* |
| GET | `/inventory` · `/inventory/movements` · POST `/inventory/:productId/adjust` | inventory.* |
| POST | `/orders/quote` | orders.create — server-side totals |
| GET/POST | `/orders` · GET/PATCH `/orders/:id` · POST `/orders/:id/status` | orders.* (cancel/refund need orders.cancel) |
| GET/POST | `/payments` · GET `/payments/methods` · POST `/payments/:id/status` · POST `/payments/:id/refund` | orders.update / orders.cancel |
| GET/POST | `/invoices` · GET `/invoices/:id` · GET `/invoices/:id/pdf` · POST `/invoices/:id/void` | orders.* |
| GET/POST | `/deliveries` · PATCH `/deliveries/:id` | orders.update |

Create an order:

```bash
curl -X POST https://your-domain.com/api/v1/orders \
  -H "x-api-key: sk_live_…" -H "Content-Type: application/json" \
  -d '{"customerId":"…","items":[{"productId":"…","quantity":2}],"shippingCity":"New York"}'
```

Prices always come from the catalog (overrides require `orders.update`); stock is reserved atomically.

### Conversations & WhatsApp
| Method | Path | Permission |
| --- | --- | --- |
| GET | `/conversations` · `/conversations/counts` · `/conversations/:id` · `/conversations/:id/messages` | conversations.view |
| POST | `/conversations/:id/messages` | conversations.reply — `{ text }`, `{ text, note: true }`, `{ attachment }`, `{ template }` |
| POST | `/conversations/:id/assign` · `/handler` · `/status` · `/read` | conversations.* |
| POST | `/conversations/test` · `/conversations/:id/simulate` | Test conversations (no WhatsApp) |
| GET/POST/PATCH/DELETE | `/whatsapp/accounts…`, `/whatsapp/templates…`, `/whatsapp/contacts`, `/whatsapp/webhook-events` | whatsapp.* |
| GET/POST | `/webhooks/whatsapp` | Public; signature-verified (Meta) |

### AI
| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/ai/agents` · GET/PATCH/DELETE `/ai/agents/:id` · POST `/ai/agents/:id/test` | ai.agents.* |
| GET/PUT | `/ai/settings` · POST `/ai/settings/test` · PUT `/ai/instructions` | settings.* |
| GET | `/ai/usage` · `/ai/tool-executions` · `/ai/tools` | ai.usage.view |
| … | `/ai/knowledge-bases…`, `/ai/documents/:id…` | ai.knowledge.* |

### Automation, analytics, search
| Method | Path | Permission |
| --- | --- | --- |
| GET | `/workflows/catalog` · `/workflows` · `/workflows/:id` · `/workflows/runs[/:id]` | automation.view |
| POST/PUT/DELETE | `/workflows`, `/workflows/:id`, `/workflows/:id/status`, `/workflows/:id/duplicate` | automation.create/update |
| POST | `/workflows/:id/run` · `/workflows/runs/:id/retry` | automation.execute |
| GET | `/analytics/dashboard` · `/analytics/sales|crm|conversations|ai?range=7d|30d|90d|12m` | dashboard.view / analytics.view |
| GET | `/search?q=` | results filtered by permission |

### Health (no prefix)
`GET /health`, `GET /health/live`, `GET /health/ready` (503 when the database or Redis is down).

## Realtime

Socket.IO at `/socket.io` (same origin, cookie-authenticated). Events: `message.new`, `message.status`, `conversation.updated`, `lead.updated`, `order.updated`, `notification.created`, `workflow.completed`, `document.updated`, `typing`. Join a conversation room with `conversation:join { conversationId }`.
