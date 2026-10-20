#!/usr/bin/env bash
# Provisiona un VPS Ubuntu 24.04 recién creado (S4). Ejecutar UNA vez como root:
#   curl -fsSL <url-raw-de-este-script> | DEPLOY_PUBKEY="ssh-ed25519 AAAA... ci" bash
# o copiarlo y correr: DEPLOY_PUBKEY="..." bash provision-vps.sh
# Deja: usuario "deploy" con sudo y llave SSH, root y contraseñas deshabilitados
# en SSH, firewall 22/80/443, Docker + compose, fail2ban, actualizaciones
# automáticas de seguridad, rclone para respaldos y /opt/pos listo.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/pos}"
: "${DEPLOY_PUBKEY:?Define DEPLOY_PUBKEY con la(s) llave(s) públicas SSH permitidas}"

if [[ $EUID -ne 0 ]]; then echo "Ejecutar como root" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl gnupg ufw fail2ban unattended-upgrades rclone jq

# --- Usuario de despliegue ---
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
printf '%s\n' "$DEPLOY_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
# sudo sin contraseña solo para docker y systemctl; el resto pide contraseña.
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl, /usr/bin/docker" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

# --- SSH: solo llaves, sin root ---
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $DEPLOY_USER
CONF
systemctl reload ssh

# --- Firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# --- Docker Engine + compose plugin (repo oficial) ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

# Rotación de logs por defecto para cualquier contenedor (S9).
cat > /etc/docker/daemon.json <<JSON
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
systemctl restart docker

# Ojo: Docker publica puertos saltándose ufw. Por eso en docker-compose.prod.yml
# solo web (80/443) publica hacia afuera y lo demás escucha en 127.0.0.1 o en la
# red interna.

# --- Directorio de la aplicación ---
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/backups"

echo
echo "Listo. Siguiente paso (como $DEPLOY_USER):"
echo "  1. Copiar .env a $APP_DIR/.env (chmod 600)"
echo "  2. Configurar rclone para respaldos: rclone config  (remoto llamado 'backups')"
echo "  3. Lanzar el primer deploy desde GitHub Actions"
