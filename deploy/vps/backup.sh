#!/usr/bin/env bash
# Daily backup on the VPS (setup.sh adds it to the gtt user's crontab).
# Backs up the database and invoices with `npm run backup`, then deletes
# backups older than KEEP_DAYS so the disk never fills up.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
KEEP_DAYS="${KEEP_DAYS:-30}"

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

cd "$APP_DIR/backend"
npm run --silent backup
find "$APP_DIR/data/backups" -maxdepth 1 -type d -name 'backup_*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
