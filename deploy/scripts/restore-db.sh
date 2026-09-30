#!/usr/bin/env bash
# Restore a Sellora AI backup created by backup-db.sh.
# Usage: deploy/scripts/restore-db.sh /opt/sellora-ai/backups/sellora-YYYYmmdd-HHMMSS.dump
# Stop the app first: pm2 stop sellora-api sellora-worker
set -Eeuo pipefail
FILE="${1:?Usage: restore-db.sh <backup.dump>}"
ENV_FILE="${ENV_FILE:-${SELLORA_BASE_DIR:-/opt/sellora-ai}/.env}"
URL="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '"')"
URL="${URL%%\?*}"
[[ -f "${FILE}.sha256" ]] && sha256sum -c "${FILE}.sha256"
read -r -p "This replaces the current database contents. Type RESTORE to continue: " answer
[[ "${answer}" == "RESTORE" ]] || { echo "Aborted"; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${URL}" "${FILE}"
echo "Restored. Start the app: pm2 start sellora-api sellora-worker"
