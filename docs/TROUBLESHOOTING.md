# Troubleshooting

Every API error includes a `requestId`. Search the logs for it: `pm2 logs sellora-api --lines 500 | grep <requestId>`.

## Startup

**"Invalid environment configuration"** — the API lists the missing/invalid keys. Common: `ENCRYPTION_KEY` must be exactly 64 hex characters; JWT secrets need 32+ characters.

**`Cannot find module .../dist/main.js`** — run `npm run build` (or `./deploy.sh`). The API build deletes and re-creates `dist`.

**`/health/ready` returns 503** — check the `checks` object:
- `database: down` → verify `DATABASE_URL`, that PostgreSQL runs (`systemctl status postgresql`) and the user can connect (`psql "$DATABASE_URL"` without `?schema=`).
- `redis: down` → `systemctl status redis-server`, `redis-cli ping`.
- `worker: down` → `pm2 status`; start it with `pm2 start ecosystem.config.cjs --only sellora-worker`.

**Migrations fail** — never use `prisma migrate reset` in production. Read the error, restore the pre-deploy backup if needed, fix and re-run `npm run db:deploy`.

## Sign-in & sessions

**Signed out immediately / 401 loops** — `APP_URL`, `API_URL` and `CORS_ORIGINS` must match the address in the browser. Over HTTPS set `COOKIE_SECURE=true`; over plain HTTP it must be `false`. Behind Nginx set `TRUST_PROXY=true`.

**"Security check failed" (CSRF)** — the browser blocked cookies, or the page is served from a different origin than the API. Reload; check the points above.

**Account locked** — five failed attempts lock the account for 15 minutes. Use "Forgot password" (requires SMTP) or wait.

**No verification / reset emails** — SMTP is not configured (`SMTP_HOST`). Invitation links are then shown to the inviter to share manually.

## WhatsApp

**Webhook verification fails in Meta** — the callback URL must be public HTTPS and reach `/api/v1/webhooks/whatsapp`; the verify token must match the account (WhatsApp → Accounts) or `WHATSAPP_VERIFY_TOKEN`.

**Messages don't arrive** — open **WhatsApp → Webhooks**. No events: the `messages` field isn't subscribed or Meta can't reach the server. Events rejected with 401: the **app secret** is missing or wrong. Events `FAILED`: open the payload and check the worker logs.

**Replies fail with "24-hour window"** — WhatsApp only allows free-form messages within 24 hours of the customer's last message. Send an approved template.

**Account status ERROR** — the token expired or lacks permissions. Generate a permanent System User token and update the account.

## AI

**AI never replies / conversations go to humans** — the system message in the thread explains why: AI not configured (Settings → AI), monthly AI message limit reached, agent inactive, outside working hours, or provider errors (check `pm2 logs sellora-worker`). Use **Settings → AI → Test connection**.

**Knowledge documents stuck in "Queued"** — the worker isn't running. **Failed** — the error is shown on the document (scanned PDFs without text, private URLs, unsupported content). Documents marked "keyword" were indexed without embeddings; configure AI and re-index.

## Realtime

**Inbox doesn't update live** (grey dot in the top bar) — Nginx must proxy `/socket.io/` with the WebSocket upgrade headers from `deploy/nginx/sellora.conf`. When running more than one API instance, enable sticky sessions.

## Uploads

**"The uploaded file or request is too large"** — raise `MAX_UPLOAD_MB` and Nginx `client_max_body_size` together.

**Images don't load** — `API_URL` must be the public origin; with local storage the `storage/uploads` directory must be writable by the deploy user.

## Performance

- Keep PostgreSQL and Redis on the same host or private network.
- Watch queue depth in **Platform admin → Queues**; scale workers with `pm2 scale sellora-worker 2`.
- Analytics are cached for 60 seconds per workspace.

## Getting help

Collect: `pm2 status`, `curl -s localhost:4000/health/ready`, the `requestId`, and the last 200 lines of `pm2 logs`.
