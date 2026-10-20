#!/usr/bin/env bash
# Prepara la Raspberry Pi 5 (Raspberry Pi OS Lite 64 bits o Ubuntu Server 24.04 arm64).
# Ejecutar UNA vez como root:
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA... tu-laptop" bash provision.sh
# Opcional, para registrar el runner de GitHub Actions en el mismo paso:
#   RUNNER_TOKEN=<token de Settings → Actions → Runners → New self-hosted runner>
#
# Deja: usuario "deploy" con llave SSH, root y contraseñas deshabilitados en SSH,
# firewall que solo deja entrar SSH (el tráfico web llega por Cloudflare Tunnel,
# sin abrir puertos en el router), Docker + compose, fail2ban, actualizaciones
# automáticas, rclone para respaldos, /opt/crm y el keyFile de MongoDB.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIRS="${APP_DIRS:-/opt/crm}"          # agregar /opt/crm-staging si habrá staging en la misma Pi
REPO_URL="${REPO_URL:-https://github.com/MauriGGH/CRM_Celulares}"
LAN_CIDR="${LAN_CIDR:-}"                   # p. ej. 192.168.1.0/24: SSH solo desde la red local
DOCKER_DATA_ROOT="${DOCKER_DATA_ROOT:-}"   # p. ej. /srv/docker si el SSD está montado en /srv
: "${DEPLOY_PUBKEY:?Define DEPLOY_PUBKEY con la(s) llave(s) públicas SSH permitidas}"

if [[ $EUID -ne 0 ]]; then echo "Ejecutar como root" >&2; exit 1; fi

# --- Requisitos de hardware para MongoDB 5+ ---
if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "Se necesita un sistema de 64 bits (aarch64); este es $(uname -m)" >&2; exit 1
fi
# MongoDB 5+ en ARM requiere ARMv8.2-A (instrucciones LSE "atomics"): Pi 5 sí, Pi 4 no.
if ! grep -qw atomics /proc/cpuinfo; then
  echo "AVISO: este CPU no es ARMv8.2-A (¿Raspberry Pi 4?). mongo:8.0 no arrancará aquí;" >&2
  echo "       ver infra/README.md (sección Raspberry Pi 4) antes de desplegar." >&2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl gnupg openssl rsync ufw fail2ban unattended-upgrades rclone jq procps

# --- Usuario de despliegue ---
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
printf '%s\n' "$DEPLOY_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# --- SSH: solo llaves, sin root ---
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
CONF
systemctl reload ssh || systemctl reload sshd

# --- Firewall: solo SSH entrante (desde la red local; desde fuera, por Cloudflare Access) ---
ufw default deny incoming
ufw default allow outgoing
if [[ -n "$LAN_CIDR" ]]; then
  ufw allow from "$LAN_CIDR" to any port 22 proto tcp
else
  ufw allow 22/tcp
fi
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# --- Docker Engine + compose plugin (repo oficial; Debian o Ubuntu) ---
. /etc/os-release
DISTRO="$ID"; [[ "$DISTRO" == "raspbian" ]] && DISTRO=debian
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DISTRO} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

# Rotación de logs por defecto para cualquier contenedor (S10); y, si se pide,
# datos de Docker (imágenes y volúmenes, incluido Mongo) en el SSD.
if [[ -n "$DOCKER_DATA_ROOT" ]]; then
  install -d -m 710 "$DOCKER_DATA_ROOT"
  DATA_ROOT_JSON="\"data-root\": \"$DOCKER_DATA_ROOT\","
else
  DATA_ROOT_JSON=""
fi
cat > /etc/docker/daemon.json <<JSON
{
  $DATA_ROOT_JSON
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
systemctl restart docker

# --- Directorios de la aplicación y keyFile de MongoDB ---
for APP_DIR in $APP_DIRS; do
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/backups" \
    "$APP_DIR/infra" "$APP_DIR/frontend" "$APP_DIR/frontend/dist"
  install -d -m 700 "$APP_DIR/infra/secrets"
  # Obligatorio con --replSet + --auth. Lo lee el contenedor como uid 999 (mongodb).
  KEYFILE="$APP_DIR/infra/secrets/mongo-keyfile"
  [[ -s "$KEYFILE" ]] || openssl rand -base64 756 > "$KEYFILE"
  chown 999:999 "$KEYFILE"
  chmod 400 "$KEYFILE"
done

# --- Runner de GitHub Actions (deploy sin abrir puertos) ---
if [[ -n "${RUNNER_TOKEN:-}" ]]; then
  RUNNER_DIR="/home/$DEPLOY_USER/actions-runner"
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$RUNNER_DIR"
  curl -fsSL "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-arm64-${VERSION}.tar.gz" \
    | sudo -u "$DEPLOY_USER" tar xz -C "$RUNNER_DIR"
  sudo -u "$DEPLOY_USER" "$RUNNER_DIR/config.sh" --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$(hostname)" --labels crm-pi --replace
  (cd "$RUNNER_DIR" && ./svc.sh install "$DEPLOY_USER" && ./svc.sh start)
fi

echo
echo "Listo. Siguientes pasos (ver infra/README.md):"
echo "  1. Crear el .env en cada directorio de $APP_DIRS (chmod 600) con TUNNEL_TOKEN y secretos"
echo "  2. Lanzar el primer deploy desde GitHub (Actions → Deploy → Run workflow)"
echo "  3. Agregar los cron de backup.sh y health-check.sh"
