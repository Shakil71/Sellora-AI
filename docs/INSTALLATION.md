# Installation

This guide installs Sellora AI on a development machine or a server. For a production VPS follow [DEPLOYMENT.md](DEPLOYMENT.md), which automates most of these steps.

## 1. System requirements

| Component | Minimum | Recommended |
| --- | --- | --- |
| Node.js | 20.11 | 22 LTS |
| PostgreSQL | 14 | 16 or newer |
| Redis | 5.0 (works) | 6.2 or newer |
| RAM | 2 GB | 4 GB |
| Disk | 10 GB | 20 GB+ (uploads, backups) |
| OS | Linux, macOS or Windows (development) | Ubuntu 22.04 / 24.04 (production) |

Nginx is needed in production as the reverse proxy. Docker is **not** required.

## 2. Get the code

```bash
git clone https://github.com/Shakil71/Sellora-AI.git
cd Sellora-AI
npm install
```

## 3. Database setup

Create a database and a user:

```sql
CREATE ROLE sellora LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE sellora OWNER sellora;
```

## 4. Environment variables

```bash
cp .env.example .env
```

Fill in at least:

- `DATABASE_URL=postgresql://sellora:PASSWORD@localhost:5432/sellora?schema=public`
- `REDIS_URL=redis://localhost:6379`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — `openssl rand -hex 48`
- `ENCRYPTION_KEY` — `openssl rand -hex 32` (exactly 64 hex characters; **back it up** — it decrypts stored WhatsApp tokens and AI keys)

All variables are described in [ENVIRONMENT.md](ENVIRONMENT.md). One `.env` in the project root configures the API, worker and web app.

## 5. Create the tables

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`, which never resets data. (During development of new schema changes use `npm run db:migrate`.)

## 6. Create the administrator

Choose one:

- **Web installer** — start the app (step 7), open `/install` and follow the wizard (requirements check, database test, environment, migrations, administrator, finish). The installer locks itself when finished. Set `INSTALLER_TOKEN` to require a token.
- **Command line**:

  ```bash
  cd apps/api && npm run db:seed -- --admin you@example.com 'StrongPassw0rd'
  ```

  Then register or sign in; platform administrators see **Platform admin** in the user menu.

Optional demo data (clearly marked "Demo"):

```bash
npm run db:seed:demo
```

## 7. Run

Development (hot reload):

```bash
npm run dev
```

Production build without PM2:

```bash
npm run build
npm run start:api      # port 4000
npm run start:worker   # background jobs
npm run start:web      # port 3000
```

Open http://localhost:3000. The web server proxies `/api/v1/*` to the API during development; in production Nginx routes it (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## 8. Verify

```bash
curl http://localhost:4000/health
curl http://localhost:4000/health/ready   # database, redis, storage, worker
```

## 9. Configure integrations

- **WhatsApp**: Settings → WhatsApp (see DOCUMENTATION.md → WhatsApp).
- **AI**: Settings → AI, or set `OPENAI_API_KEY` for all workspaces.
- **Email**: set the `SMTP_*` variables and restart.
- **Storage**: local disk by default; set `STORAGE_DRIVER=s3` and the `STORAGE_*` variables for S3-compatible storage.

## Non-Docker production summary

1. Install Node.js 22, PostgreSQL, Redis, Nginx, PM2.
2. Clone to `/opt/sellora-ai/app`, place `.env` at `/opt/sellora-ai/.env`.
3. `./deploy.sh` — installs, builds, migrates, starts PM2 processes and checks health.
4. Copy `deploy/nginx/sellora.conf` into Nginx and enable HTTPS with certbot.
