#!/usr/bin/env bash
# =============================================================================
# Sellora AI — PostgreSQL backup with retention.
#
# Daily cron (as the deploy user):
#   15 2 * * * /opt/sellora-ai/app/deploy/scripts/backup-db.sh >> /opt/sellora-ai/logs/backup.log 2>&1
#
# Settings are read from /opt/sellora-ai/.env:
#   DATABASE_URL, BACKUP_DIR (default /opt/sellora-ai/backups), BACKUP_RETENTION_DAYS (default 14)
# Restore: deploy/scripts/restore-db.sh <file.dump>
# =============================================================================
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-${SELLORA_BASE_DIR:-/opt/sellora-ai}/.env}"
[[ -f "${ENV_FILE}" ]] || ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/.env"
[[ -f "${ENV_FILE}" ]] || { echo "No .env found"; exit 1; }

getenv() { grep -E "^$1=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DATABASE_URL="$(getenv DATABASE_URL)"
BACKUP_DIR="$(getenv BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/opt/sellora-ai/backups}"
RETENTION="$(getenv BACKUP_RETENTION_DAYS)"; RETENTION="${RETENTION:-14}"

command -v pg_dump >/dev/null || { echo "pg_dump not installed (apt install postgresql-client)"; exit 1; }
[[ -n "${DATABASE_URL}" ]] || { echo "DATABASE_URL missing"; exit 1; }

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/sellora-${STAMP}.dump"
# pg_dump does not understand Prisma's ?schema= parameter.
URL="${DATABASE_URL%%\?*}"

echo "[backup] $(date -Is) writing ${FILE}"
pg_dump --format=custom --no-owner --no-privileges --file="${FILE}.partial" "${URL}"
mv "${FILE}.partial" "${FILE}"
chmod 600 "${FILE}"
sha256sum "${FILE}" > "${FILE}.sha256"

# Keep several backups: delete only those older than the retention window.
find "${BACKUP_DIR}" -name 'sellora-*.dump*' -type f -mtime +"${RETENTION}" -print -delete
echo "[backup] done ($(du -h "${FILE}" | cut -f1)); kept $(ls "${BACKUP_DIR}"/sellora-*.dump 2>/dev/null | wc -l) backups"
