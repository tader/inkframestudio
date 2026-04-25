#!/usr/bin/with-contenv bashio
set -euo pipefail

cd /app
export NODE_ENV=production
export DATA_DIR="${DATA_DIR:-/config}"
exec dist/rust-backend/epd-backend-api
