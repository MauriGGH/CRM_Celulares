#!/usr/bin/env bash
# Alerta de disco (S9). Cron cada 5 minutos:
#   */5 * * * * /opt/pos/scripts/disk-check.sh
# Usa un monitor "Push" de Uptime Kuma: el script hace ping solo si el disco está
# bajo el umbral. Si deja de llegar el ping, Uptime Kuma envía la alerta.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pos}"
set -a; . "$APP_DIR/.env"; set +a
: "${DISK_PUSH_URL:?falta DISK_PUSH_URL (URL del monitor Push de Uptime Kuma)}"
THRESHOLD="${DISK_ALERT_PERCENT:-80}"

USED="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if (( USED < THRESHOLD )); then
  curl -fsS -m 10 "${DISK_PUSH_URL}?status=up&msg=disco_${USED}pct" >/dev/null
else
  echo "$(date -u +%FT%TZ) disco al ${USED}% (umbral ${THRESHOLD}%)" >&2
fi
