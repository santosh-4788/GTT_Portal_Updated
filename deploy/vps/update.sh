#!/usr/bin/env bash
# Pull the latest code, rebuild and restart the portal. Run on the VPS as the
# gtt user:
#   bash ~/app/deploy/vps/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

cd "$APP_DIR"
# The TypeScript build cache was once committed; every build here rewrites it,
# which would otherwise make the pull refuse to run.
git checkout -- frontend/tsconfig.tsbuildinfo 2>/dev/null || true
git pull --ff-only

# A backup first, so a bad update can always be rolled back.
bash "$APP_DIR/deploy/vps/backup.sh" || echo "  ! backup failed - continuing"

npm ci --include=dev --prefix backend
npm ci --include=dev --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
(cd backend && npm run migrate)

pm2 reload gtt --update-env
echo "Updated. Health check:"
curl -fsS "http://127.0.0.1:$(grep -E '^PORT=' backend/.env | cut -d= -f2 || echo 4100)/api/health" || true
echo
