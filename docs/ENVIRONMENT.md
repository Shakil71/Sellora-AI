# Environment variables

All processes read a single `.env` file in the project root (production: `/opt/sellora-ai/.env`, symlinked into the app). Values already present in the process environment take precedence. The API refuses to start with a clear error if a required value is missing or invalid.

Never commit `.env`. Never put secrets in the web app: only variables prefixed `NEXT_PUBLIC_` reach the browser, and Sellora AI defines none that are secret.

## Application

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `development` | `production` on servers |
| `APP_NAME` | no | `Sellora AI` | Used in emails and 2FA |
| `APP_URL` | yes | `http://localhost:3000` | Public URL of the web app, no trailing slash |
| `API_URL` | yes | `http://localhost:4000` | Public API origin (same as `APP_URL` behind Nginx). Used for file URLs and the webhook URL |
| `API_INTERNAL_URL` | no | `http://localhost:4000` | Where the web server proxies `/api` when Nginx is not in front |
| `API_PORT` | no | `4000` | API listen port |
| `WEB_PORT` | no | `3000` | Web listen port |
| `CORS_ORIGINS` | yes | `http://localhost:3000` | Comma-separated browser origins allowed to call the API |
| `COOKIE_SECURE` | prod | `false` | `true` when served over HTTPS |
| `COOKIE_DOMAIN` | no | — | Share cookies across subdomains, e.g. `.example.com` |
| `TRUST_PROXY` | prod | `false` | `true` behind Nginx so client IPs are correct |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace` |

## Database & Redis

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db?schema=public` |
| `DATABASE_URL_TEST` | tests | Database for integration tests (defaults to `<db>_test`) |
| `REDIS_URL` | yes | `redis://[:password@]host:6379[/db]`; `rediss://` for TLS |

## Security

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | yes | ≥32 chars. Signs 15-minute access tokens. `openssl rand -hex 48` |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars. Signs 2FA challenges. `openssl rand -hex 48` |
| `JWT_ACCESS_TTL` | no | Access token lifetime, default `15m` |
| `JWT_REFRESH_TTL_DAYS` | no | Session lifetime, default `30` |
| `ENCRYPTION_KEY` | yes | 64 hex chars (AES-256-GCM) for WhatsApp tokens, AI keys, 2FA secrets. `openssl rand -hex 32`. **Changing it makes stored secrets unreadable.** |
| `INSTALLER_TOKEN` | no | Required by the web installer when set |

## AI

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Platform key used when a workspace has none. Leave empty to require per-workspace keys |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `AI_DEFAULT_MODEL` | `gpt-4o-mini` | Chat model |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for the knowledge base |
| `AI_PRICE_INPUT_PER_1M` / `AI_PRICE_OUTPUT_PER_1M` | `0.15` / `0.60` | USD per million tokens for cost estimates |

## WhatsApp (Meta Cloud API)

Accounts are normally connected per workspace in the UI. These act as platform defaults or single-tenant setup:

| Variable | Description |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Permanent System User token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID (templates) |
| `WHATSAPP_APP_SECRET` | App secret used to verify webhook signatures |
| `WHATSAPP_VERIFY_TOKEN` | Accepted webhook verify token |
| `WHATSAPP_GRAPH_API_VERSION` | Default `v21.0` |

With all of the first three set, **WhatsApp → Accounts → Import from server config** creates the account.

## Messenger, Instagram & webhooks

Businesses connect their own Facebook Page or Instagram account in **Integrations**; these are optional platform-wide fallbacks.

| Variable | Default | Description |
| --- | --- | --- |
| `META_APP_SECRET` | — | App secret used to verify Messenger/Instagram webhook signatures when a connection has none (`WHATSAPP_APP_SECRET` is also accepted) |
| `META_VERIFY_TOKEN` | — | Extra verify token accepted by `GET /api/v1/webhooks/meta` |
| `WEBHOOKS_ALLOW_PRIVATE` | `false` | Allow outgoing webhooks to private/LAN addresses and plain HTTP. **Development only**: keep `false` in production |

## Email (SMTP)

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_HOST` | — | Leave empty to disable email (invite links are then shown to the inviter) |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for port 465 |
| `SMTP_USER` / `SMTP_PASSWORD` | — | |
| `MAIL_FROM` | `Sellora AI <no-reply@example.com>` | Sender |

## Storage

| Variable | Default | Description |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_PATH` | `./storage/uploads` | Relative to the app root |
| `STORAGE_ENDPOINT` | — | S3-compatible endpoint (MinIO, R2, Spaces…) |
| `STORAGE_REGION` | `us-east-1` | |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | — | |
| `STORAGE_BUCKET` | — | Required for `s3` |
| `STORAGE_PUBLIC_URL` | — | CDN/public base URL for public files |
| `STORAGE_FORCE_PATH_STYLE` | `true` | Needed by MinIO |
| `MAX_UPLOAD_MB` | `10` | Per-file upload limit (keep Nginx `client_max_body_size` above it) |

## Billing

| Variable | Description |
| --- | --- |
| `STRIPE_SECRET_KEY` | Enables online plan checkout. Without it, platform admins assign plans |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/v1/billing/webhooks/stripe` |

## Rate limiting & backups

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX` | `60` / `300` | Per-IP API limit |
| `AUTH_RATE_LIMIT_MAX` | `10` | Per-minute limit on login, register, reset and 2FA |
| `BACKUP_DIR` | `/opt/sellora-ai/backups` | Used by `backup-db.sh` |
| `BACKUP_RETENTION_DAYS` | `14` | Days to keep backups |
