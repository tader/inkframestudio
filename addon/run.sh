#!/usr/bin/with-contenv bashio
set -euo pipefail

cd /app
export NODE_ENV=production
exec dist/rust-backend/epd-backend-api
