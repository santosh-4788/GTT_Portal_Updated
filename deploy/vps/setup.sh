#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time setup of the Gupta Tours & Travels portal on a fresh Ubuntu
# 22.04 / 24.04 VPS (Hostinger KVM, Bluehost VPS, or any other).
#
#   sudo bash setup.sh <domain> <email> [git-repo-url] [branch]
#
#   sudo bash setup.sh guptatours.in vinaykumar87674@gmail.com
#
# What it does:
#   - installs Nginx, Certbot, Git, build tools, LibreOffice (invoice PDFs)
#   - opens only SSH, HTTP and HTTPS in the firewall
#   - creates a "gtt" user, installs Node 22 for it with nvm, and pm2
#   - clones and builds the portal in /home/gtt/app
#   - writes backend/.env with a fresh random JWT secret
#   - creates the SQLite database and the admin user
#   - starts the portal with pm2 so it survives crashes and reboots
#   - puts Nginx in front of it and gets a free Let's Encrypt certificate
#   - schedules a daily backup at 02:30
#
# Safe to run again: existing code is pulled, the .env and database are kept.
# Point the domain's A record (and www) at this server's IP BEFORE running it,
# otherwise only the certificate step fails - re-run it later (see README).
# ---------------------------------------------------------------------------
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${3:-https://github.com/santosh-4788/GTT_Portal_Updated.git}"
BRANCH="${4:-main}"
APP_USER=gtt
APP_HOME="/home/$APP_USER"
APP_DIR="$APP_HOME/app"
PORT=4100
NODE_VERSION=22
WITH_LIBREOFFICE="${WITH_LIBREOFFICE:-1}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash setup.sh <domain> <email> [git-repo-url] [branch]"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run it with sudo (or as root)."
  exit 1
fi

step() { echo; echo "==> $*"; }
# Run a command as the app user with its nvm-installed Node on the PATH.
as_app() {
  sudo -u "$APP_USER" -H bash -c "export NVM_DIR=\$HOME/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; cd \$HOME; $1"
}

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git build-essential python3 nginx certbot python3-certbot-nginx ufw sqlite3 openssl cron
if [[ "$WITH_LIBREOFFICE" == "1" ]]; then
  apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer fonts-dejavu fonts-noto-core
fi

step "Firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

step "Swap (keeps npm builds from running out of memory on small plans)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "App user '$APP_USER'"
id "$APP_USER" &>/dev/null || useradd -m -s /bin/bash "$APP_USER"

step "Node $NODE_VERSION (nvm) and pm2"
if [[ ! -s "$APP_HOME/.nvm/nvm.sh" ]]; then
  as_app "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
fi
as_app "nvm install $NODE_VERSION && nvm alias default $NODE_VERSION && npm install -g pm2"

step "Code ($REPO, branch $BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  as_app "cd $APP_DIR && git fetch origin && git checkout $BRANCH && git pull --ff-only"
else
  as_app "git clone --branch $BRANCH $REPO $APP_DIR"
fi

step "backend/.env"
ENV_FILE="$APP_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  JWT=$(openssl rand -hex 48)
  cat > "$ENV_FILE" <<EOF
# Written by deploy/vps/setup.sh. Edit, then: pm2 restart gtt --update-env
PORT=$PORT
NODE_ENV=production
JWT_SECRET=$JWT
JWT_EXPIRES_IN=8h
SESSION_TIMEOUT_MINUTES=60
PUBLIC_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
DB_FILE=$APP_DIR/database/gtt.db
INVOICE_FORMAT_SOURCE=$APP_DIR/templates
MAX_UPLOAD_BYTES=15728640
LIBREOFFICE_PATH=/usr/bin/soffice

# Email - paste the Gmail app password (see backend/.env.example)
MAIL_APP_PASSWORD=
MAIL_FROM=vinaykumar87674@gmail.com
MAIL_FROM_NAME=Gupta Tours & Travels
MAIL_USER=vinaykumar87674@gmail.com
MAIL_REPLY_TO=vinaykumar87674@gmail.com
MAIL_ADMIN_INBOX=vinaykumar87674@gmail.com
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
MAIL_SECURE=true

# Optional: Google sign-in for customers
# GOOGLE_CLIENT_ID=

# Optional: keep the data in Turso instead of the local SQLite file
# TURSO_DATABASE_URL=
# TURSO_AUTH_TOKEN=
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  created with a new random JWT secret"
else
  echo "  kept the existing file"
fi

step "Install and build"
as_app "cd $APP_DIR && npm ci --include=dev --prefix backend && npm ci --include=dev --prefix frontend"
as_app "cd $APP_DIR && npm run build --prefix backend && npm run build --prefix frontend"

step "Database (tables + admin user; existing data is left alone)"
as_app "cd $APP_DIR/backend && npm run setup"

step "Start with pm2"
as_app "cd $APP_DIR && (pm2 describe gtt >/dev/null 2>&1 && pm2 reload gtt --update-env || pm2 start deploy/vps/ecosystem.config.cjs) && pm2 save"
NODE_BIN=$(as_app "dirname \$(command -v node)")
env PATH="$PATH:$NODE_BIN" "$NODE_BIN/pm2" startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null
as_app "pm2 install pm2-logrotate >/dev/null 2>&1 || true"

step "Nginx"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP_DIR/deploy/vps/nginx.conf" > /etc/nginx/sites-available/gtt
ln -sf /etc/nginx/sites-available/gtt /etc/nginx/sites-enabled/gtt
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

step "HTTPS certificate (Let's Encrypt, renews itself)"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  CERT_OK=1
else
  CERT_OK=0
  echo "  ! Certificate not issued - usually the domain does not point at this server yet."
  echo "    Fix the DNS, then run:"
  echo "    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -m $EMAIL --agree-tos --redirect"
fi

step "Daily backup at 02:30"
chmod +x "$APP_DIR/deploy/vps/"*.sh
CRON_LINE="30 2 * * * bash $APP_DIR/deploy/vps/backup.sh >> $APP_DIR/data/logs/backup.log 2>&1"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v 'deploy/vps/backup.sh' ; echo "$CRON_LINE" ) | crontab -u "$APP_USER" -

echo
echo "------------------------------------------------------------"
echo " Done."
if [[ "$CERT_OK" == "1" ]]; then
  echo " Open        : https://$DOMAIN"
else
  echo " Open        : http://$DOMAIN   (HTTPS once the certificate is issued)"
fi
echo " Health      : curl http://127.0.0.1:$PORT/api/health"
echo " Logs        : sudo -u $APP_USER -i pm2 logs gtt"
echo " Settings    : $ENV_FILE"
echo " First login : Admin@gmail.com / Pass@123 (you must change it at first sign-in)"
echo "------------------------------------------------------------"
