#!/usr/bin/env bash
# Chequeo de salud de la Raspberry Pi (S10). Cron cada 5 minutos:
#   */5 * * * * /opt/crm/infra/scripts/health-check.sh >> /opt/crm/backups/health.log 2>&1
# Usa un monitor "Push" de Uptime Kuma (o de UptimeRobot): el script hace ping
# solo si todo está bien. Si deja de llegar el ping, el monitor envía la alerta.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
set -a; . "$APP_DIR/.env"; set +a
: "${HEALTH_PUSH_URL:?falta HEALTH_PUSH_URL (URL del monitor Push)}"

MAX_DISK="${DISK_ALERT_PERCENT:-80}"
MAX_TEMP="${TEMP_ALERT_C:-75}"
MAX_MEM="${MEM_ALERT_PERCENT:-90}"

problems=()

disk="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
(( disk < MAX_DISK )) || problems+=("disco_${disk}pct")
docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)"
ddisk="$(df --output=pcent "$docker_root" | tail -1 | tr -dc '0-9')"
(( ddisk < MAX_DISK )) || problems+=("disco_docker_${ddisk}pct")

if command -v vcgencmd >/dev/null; then
  temp="$(vcgencmd measure_temp | tr -dc '0-9.' | cut -d. -f1)"
else
  temp="$(( $(cat /sys/class/thermal/thermal_zone0/temp) / 1000 ))"
fi
(( temp < MAX_TEMP )) || problems+=("temp_${temp}C")

mem="$(free | awk '/^Mem:/ { printf "%d", ($2 - $7) * 100 / $2 }')"
(( mem < MAX_MEM )) || problems+=("memoria_${mem}pct")

if (( ${#problems[@]} == 0 )); then
  curl -fsS -m 10 "${HEALTH_PUSH_URL}?status=up&msg=ok_disco${disk}_temp${temp}_mem${mem}" >/dev/null
else
  echo "$(date -u +%FT%TZ) ALERTA: ${problems[*]}" >&2
fi
