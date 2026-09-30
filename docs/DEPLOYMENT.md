# Deployment (VPS, no Docker)

Sellora AI runs as three Node.js processes managed by **PM2**, behind **Nginx**, with **PostgreSQL** and **Redis** installed on the server.

```
Internet
   │
   ▼
 Nginx :80/:443
   ├── /            → sellora-web     (Next.js, 127.0.0.1:3000)
   ├── /api/        → sellora-api     (NestJS, 127.0.0.1:4000)
   ├── /socket.io/  → sellora-api     (realtime WebSocket)
   └── /health      → sellora-api
                         │
          ┌──────────────┼──────────────┐
      PostgreSQL       Redis        sellora-worker (BullMQ jobs)
```

## Directory layout

```
/opt/sellora-ai
├── app        # git checkout of this repository
├── .env       # production configuration (chmod 600, never committed)
├── nginx      # active Nginx site config
├── backups    # PostgreSQL backups
└── logs       # PM2 application logs
```

`deploy.sh` symlinks `/opt/sellora-ai/app/.env → /opt/sellora-ai/.env`. The server IP or domain is only configured in `.env` and Nginx — never in source code.

## 1. Prepare the server (once)

On a fresh Ubuntu 22.04/24.04 server (for example `192.168.197.100`):

```bash
curl -fsSLO https://raw.githubusercontent.com/Shakil71/Sellora-AI/main/deploy/scripts/setup-server.sh
sudo bash setup-server.sh https://github.com/Shakil71/Sellora-AI.git 192.168.197.100 sellora
```

The script installs Node.js 22, PostgreSQL, Redis (bound to localhost, `noeviction`), Nginx, PM2, certbot and a firewall; creates the database with a random password; generates `/opt/sellora-ai/.env` with fresh secrets; enables the Nginx site; configures PM2 startup and log rotation; and schedules a daily database backup.

Review `/opt/sellora-ai/.env` afterwards (SMTP, OpenAI, WhatsApp, S3 are optional).

## 2. Deploy

```bash
sudo -iu sellora
cd /opt/sellora-ai/app
./deploy.sh            # or ./deploy.sh <branch>
```

`deploy.sh` performs, in order:

1. `git pull --ff-only`
2. Validates `.env` (required keys, production mode, key lengths, Node version)
3. `npm ci`
4. Generates the Prisma client
5. Builds shared package, API and web
6. Backs up the database, then runs `prisma migrate deploy` (never destructive)
7. Reloads or starts `sellora-api`, `sellora-worker`, `sellora-web` with PM2
8. Waits for `/health/live` and `/health/ready`, checks the web app
9. Prints `pm2 status`

Re-run it for every update.

## Alternative: RHEL-family server with Apache already running

On Oracle Linux, Rocky, Alma or RHEL servers where Apache (httpd) already serves other sites, keep Apache and give Sellora its own port:

1. Install PostgreSQL 16 (`dnf module enable -y postgresql:16 && dnf install -y postgresql-server postgresql-contrib && postgresql-setup --initdb`), enable password auth (`scram-sha-256`) for `127.0.0.1` in `pg_hba.conf`, start it, then create the `sellora` role and database.
2. Install PM2 (`npm install -g pm2`) and create a `sellora` user that owns `/opt/sellora-ai`.
3. In `/opt/sellora-ai/.env`, choose free ports with `API_PORT` and `WEB_PORT`, set `API_INTERNAL_URL=http://127.0.0.1:<API_PORT>`, and use a spare Redis database number (for example `REDIS_URL=redis://127.0.0.1:6379/3`) if other apps share Redis.
4. Copy `deploy/apache/sellora.conf` to `/etc/httpd/conf.d/`, replace the placeholders, run `apachectl configtest && systemctl reload httpd`, and open the port in firewalld (`firewall-cmd --permanent --add-port=<port>/tcp && firewall-cmd --reload`).
5. Run `./deploy.sh` as the `sellora` user, then `pm2 startup systemd -u sellora --hp /home/sellora` as root.

## Continuous deployment (GitHub Actions)

`.github/workflows/ci-cd.yml` runs on every push and pull request: install, lint, typecheck, unit tests, integration tests against real PostgreSQL and Redis, and a production build. No Docker is used.

Pushes to `main` are then deployed by the **Deploy to VPS** job, which runs `deploy.sh` on the server through a **self-hosted runner**. The runner connects out to GitHub, so it works for servers on private networks without opening SSH.

### Enable it (once)

1. On GitHub: **Settings → Actions → Runners → New self-hosted runner → Linux x64**. Copy the registration token it shows.
2. On the VPS, as root:

   ```bash
   sudo -iu sellora bash -c 'mkdir -p ~/actions-runner && cd ~/actions-runner &&
     curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz &&
     tar xzf runner.tgz && rm runner.tgz'
   cd /home/sellora/actions-runner && ./bin/installdependencies.sh
   sudo -u sellora ./config.sh --unattended --url https://github.com/<owner>/<repo>      --token <REGISTRATION_TOKEN> --name sellora-vps --labels sellora-vps --work _work
   ./svc.sh install sellora && ./svc.sh start
   ```

3. On GitHub: **Settings → Secrets and variables → Actions → Variables**, add `DEPLOY_ENABLED` = `true` (and `PRODUCTION_URL`, shown on the deployment).

From then on every push to `main` that passes CI is deployed automatically. **Actions → CI/CD → Run workflow** redeploys on demand.

### Security

- The runner runs as the unprivileged `sellora` user, never root.
- The deploy job only runs for pushes to `main` of this repository, never for pull requests.
- For a **public** repository, keep **Settings → Actions → Fork pull request workflows** on "Require approval for all external contributors" and review workflow changes in pull requests before approving them, because a workflow file decides which runner it uses. Making the repository private removes this risk.

## 3. Create the administrator

Open `http://<server>/install` and complete the wizard, or run:

```bash
cd /opt/sellora-ai/app/apps/api && npm run db:seed -- --admin you@example.com 'StrongPassw0rd'
```

## 4. HTTPS

```bash
sudo certbot --nginx -d your-domain.com
```

Then in `/opt/sellora-ai/.env` set:

```
APP_URL=https://your-domain.com
API_URL=https://your-domain.com
CORS_ORIGINS=https://your-domain.com
COOKIE_SECURE=true
TRUST_PROXY=true
```

and run `./deploy.sh` (the web app embeds `APP_URL` at build time). Uncomment the `Strict-Transport-Security` header in the Nginx config once HTTPS works.

WhatsApp webhooks require a public HTTPS URL: `https://your-domain.com/api/v1/webhooks/whatsapp`.

## 5. Operations

| Task | Command |
| --- | --- |
| Status | `pm2 status` |
| Logs | `pm2 logs sellora-api --lines 200` (also `sellora-worker`, `sellora-web`) |
| Restart | `pm2 reload ecosystem.config.cjs --env production` |
| Health | `curl -s localhost:4000/health/ready` |
| Backup now | `deploy/scripts/backup-db.sh` |
| Restore | `pm2 stop sellora-api sellora-worker && deploy/scripts/restore-db.sh <file>` |

### Backups

`deploy/scripts/backup-db.sh` writes compressed `pg_dump` files (`sellora-YYYYmmdd-HHMMSS.dump` plus a SHA-256 checksum) to `BACKUP_DIR` and deletes only files older than `BACKUP_RETENTION_DAYS` (default 14), so several backups are always kept. It runs daily at 02:15 via cron and before every deployment. Copy backups off the server as well, and keep `ENCRYPTION_KEY` in a password manager — backups are useless for encrypted secrets without it.

Also back up `/opt/sellora-ai/app/storage/uploads` when using local storage.

### Scaling

- Increase the API with a second PM2 instance only together with sticky sessions (Nginx `ip_hash`) because of Socket.IO; the Redis adapter already synchronises events across instances.
- Run additional workers freely (`pm2 scale sellora-worker 2`); BullMQ distributes jobs.
- Move uploads to S3-compatible storage before running on multiple servers.

## Upgrading

```bash
cd /opt/sellora-ai/app && ./deploy.sh
```

Migrations are forward-only and applied automatically after a backup. Read the release notes before major upgrades.
