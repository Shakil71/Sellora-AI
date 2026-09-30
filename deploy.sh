#!/usr/bin/env bash
# =============================================================================
# Sellora AI — repeatable production deployment (no Docker)
#
# Layout on the VPS:
#   /opt/sellora-ai/app       git checkout (this repository)
#   /opt/sellora-ai/.env      production configuration (never committed)
#   /opt/sellora-ai/nginx     nginx config copy
#   /opt/sellora-ai/backups   database backups
#   /opt/sellora-ai/logs      application logs (PM2)
#
# Usage:  cd /opt/sellora-ai/app && ./deploy.sh [branch]
# =============================================================================
set -Eeuo pipefail

BASE_DIR="${SELLORA_BASE_DIR:-/opt/sellora-ai}"
APP_DIR="${BASE_DIR}/app"
ENV_FILE="${BASE_DIR}/.env"
LOG_DIR="${BASE_DIR}/logs"
BRANCH="${1:-main}"

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }
trap 'fail "Deployment failed at line ${LINENO}. The previous release keeps running until PM2 is reloaded."' ERR

cd "${APP_DIR}"

# 1. Pull latest code ----------------------------------------------------------
log "Pulling latest code (${BRANCH})"
git fetch --prune origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

# 2. Validate environment --------------------------------------------------------
log "Validating environment"
[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}. Copy .env.example there and fill it in."
ln -sfn "${ENV_FILE}" "${APP_DIR}/.env"
required=(NODE_ENV APP_URL API_URL DATABASE_URL REDIS_URL JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY)
for key in "${required[@]}"; do
  value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '"')"
  [[ -n "${value}" ]] || fail "${key} is not set in ${ENV_FILE}"
done
grep -qE '^NODE_ENV=production' "${ENV_FILE}" || fail "NODE_ENV must be production"
[[ "$(grep -E '^ENCRYPTION_KEY=' "${ENV_FILE}" | cut -d= -f2 | tr -d '"' | wc -c)" -ge 65 ]] || fail "ENCRYPTION_KEY must be 64 hex characters"
env_get() { grep -E "^$1=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '"' ; }
API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-4000}"
WEB_PORT="$(env_get WEB_PORT)"; WEB_PORT="${WEB_PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${API_PORT}}"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20+ is required"
mkdir -p "${LOG_DIR}" "${BASE_DIR}/backups" "${APP_DIR}/storage/uploads"

# 3. Install & build -------------------------------------------------------------
log "Installing dependencies"
npm ci --no-audit --no-fund

log "Generating Prisma client"
npm run db:generate

log "Building shared package, API and web app"
npm run build

# 4. Database migrations (never destructive) -----------------------------------
log "Backing up database before migrating"
"${APP_DIR}/deploy/scripts/backup-db.sh" || log "Backup skipped (see message above)"
log "Running database migrations"
npm run db:deploy

# 5-6. Restart application and worker ---------------------------------------------
log "Restarting API, worker and web (zero-downtime reload when already running)"
export SELLORA_LOG_DIR="${LOG_DIR}"
if pm2 describe sellora-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production --update-env
else
  pm2 start ecosystem.config.cjs --env production
fi
pm2 save >/dev/null

# 7. Verify health ------------------------------------------------------------------
log "Waiting for health checks"
ok=0
for i in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL}/health/live" >/dev/null && curl -fsS "${HEALTH_URL}/health/ready" >/dev/null; then ok=1; break; fi
  sleep 2
done
curl -sS "${HEALTH_URL}/health" || true; echo
curl -sS "${HEALTH_URL}/health/ready" || true; echo
[[ "${ok}" == "1" ]] || fail "Health checks did not pass. Inspect: pm2 logs sellora-api --lines 100"
curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT}/" || fail "Web app is not responding on port ${WEB_PORT}"

# 8. Status ---------------------------------------------------------------------------
pm2 status
log "Deployment complete: $(git rev-parse --short HEAD)"
