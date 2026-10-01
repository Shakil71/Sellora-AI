#!/usr/bin/env bash
# =============================================================================
# Sellora AI — one-time VPS preparation for Ubuntu 22.04 / 24.04 (no Docker).
# Installs Node.js 22, PostgreSQL, Redis, Nginx, PM2 and certbot, creates the
# database and the /opt/sellora-ai layout.
#
#   sudo bash setup-server.sh <git-repo-url> [domain-or-ip] [deploy-user]
# Example:
#   sudo bash setup-server.sh https://github.com/Shakil71/Sellora-AI.git 192.168.197.100 sellora
# =============================================================================
set -Eeuo pipefail
REPO="${1:?Repository URL required}"
DOMAIN="${2:-_}"
DEPLOY_USER="${3:-sellora}"
BASE=/opt/sellora-ai
DB_NAME=sellora
DB_USER=sellora

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git build-essential nginx postgresql postgresql-contrib redis-server certbot python3-certbot-nginx ufw logrotate fail2ban unattended-upgrades
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest

echo "==> Redis (local only, persistent, no eviction for queues)"
sed -i 's/^#\?\s*supervised .*/supervised systemd/' /etc/redis/redis.conf
sed -i 's/^#\?\s*maxmemory-policy .*/maxmemory-policy noeviction/' /etc/redis/redis.conf
grep -q '^bind 127.0.0.1' /etc/redis/redis.conf || sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf
# Redis answers only to this server and only with a password.
REDIS_PASS="$(openssl rand -hex 24)"
if grep -q '^requirepass' /etc/redis/redis.conf; then
  REDIS_PASS=""   # keep the password already set; REDIS_URL must already contain it
else
  echo "requirepass ${REDIS_PASS}" >> /etc/redis/redis.conf
fi
chmod 640 /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl restart redis-server

echo "==> PostgreSQL"
systemctl enable --now postgresql
DB_PASS="$(openssl rand -hex 24)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  NEW_DB=1
else
  NEW_DB=0
fi

echo "==> Deploy user and directories"
id -u "${DEPLOY_USER}" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
mkdir -p "${BASE}"/{nginx,backups,logs}
[[ -d "${BASE}/app/.git" ]] || git clone "${REPO}" "${BASE}/app"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${BASE}"
chmod 750 "${BASE}" "${BASE}/backups"

if [[ ! -f "${BASE}/.env" ]]; then
  echo "==> Generating ${BASE}/.env"
  URL="http://${DOMAIN}"; [[ "${DOMAIN}" == "_" ]] && URL="http://$(hostname -I | awk '{print $1}')"
  cp "${BASE}/app/.env.example" "${BASE}/.env"
  sed -i \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    -e "s|^APP_URL=.*|APP_URL=${URL}|" \
    -e "s|^API_URL=.*|API_URL=${URL}|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${URL}|" \
    -e "s|^TRUST_PROXY=.*|TRUST_PROXY=true|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" \
    -e "s|^INSTALLER_TOKEN=.*|INSTALLER_TOKEN=$(openssl rand -hex 16)|"     ${REDIS_PASS:+-e "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASS}@127.0.0.1:6379|"} \
    -e "s|^STORAGE_LOCAL_PATH=.*|STORAGE_LOCAL_PATH=${BASE}/app/storage/uploads|" \
    "${BASE}/.env"
  if [[ "${NEW_DB}" == "1" ]]; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public|" "${BASE}/.env"
  else
    echo "!! Existing database role kept — set DATABASE_URL in ${BASE}/.env manually."
  fi
  grep -q '^BACKUP_PASSPHRASE=.\+' "${BASE}/.env" || echo "BACKUP_PASSPHRASE=$(openssl rand -hex 24)" >> "${BASE}/.env"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${BASE}/.env"
  chmod 600 "${BASE}/.env"
fi

echo "==> Nginx"
cp "${BASE}/app/deploy/nginx/sellora.conf" "${BASE}/nginx/sellora.conf"
sed -i "s/server_name your-domain.com;/server_name ${DOMAIN};/" "${BASE}/nginx/sellora.conf"
ln -sfn "${BASE}/nginx/sellora.conf" /etc/nginx/sites-enabled/sellora
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall (only SSH, HTTP and HTTPS are reachable from outside)"
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null

echo "==> Brute-force protection (fail2ban) and automatic security updates"
cat > /etc/fail2ban/jail.d/sellora.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h

[nginx-limit-req]
enabled = true
logpath = /var/log/nginx/sellora.error.log
maxretry = 10
findtime = 10m
bantime = 1h
JAIL
systemctl enable --now fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "==> PM2 startup and log rotation"
env PATH="$PATH" pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" >/dev/null
sudo -u "${DEPLOY_USER}" pm2 install pm2-logrotate >/dev/null 2>&1 || true
sudo -u "${DEPLOY_USER}" pm2 set pm2-logrotate:retain 14 >/dev/null 2>&1 || true

echo "==> Daily database backup (02:15)"
( crontab -u "${DEPLOY_USER}" -l 2>/dev/null | grep -v backup-db.sh; echo "15 2 * * * ${BASE}/app/deploy/scripts/backup-db.sh >> ${BASE}/logs/backup.log 2>&1" ) | crontab -u "${DEPLOY_USER}" -

chmod +x "${BASE}/app/deploy.sh" "${BASE}/app/deploy/scripts/"*.sh
cat <<EOF

Server ready.
Next steps (as ${DEPLOY_USER}):
  sudo -iu ${DEPLOY_USER}
  nano ${BASE}/.env            # SMTP, OpenAI, WhatsApp, etc. (optional)
  cd ${BASE}/app && ./deploy.sh
IMPORTANT: copy BACKUP_PASSPHRASE from ${BASE}/.env to a password manager NOW. Database backups are encrypted with it and cannot be restored without it.
Installer token (needed at /install): $(grep -E '^INSTALLER_TOKEN=' ${BASE}/.env | cut -d= -f2)
Then open the site and create your administrator at /install (or: cd apps/api && npm run db:seed -- --admin you@example.com 'StrongPass1').
HTTPS: sudo certbot --nginx -d your-domain.com  and set COOKIE_SECURE=true in ${BASE}/.env, then ./deploy.sh
EOF
