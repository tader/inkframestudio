#!/usr/bin/with-contenv bashio
set -euo pipefail

cd /app
export NODE_ENV=production
export DATA_DIR="${DATA_DIR:-/data/inkframe-studio}"
export LEGACY_DATA_DIR="${LEGACY_DATA_DIR:-/config}"

mkdir -p "$DATA_DIR"
if [ "$DATA_DIR" != "$LEGACY_DATA_DIR" ] && [ ! -e "$DATA_DIR/projects" ] && [ -d "$LEGACY_DATA_DIR/projects" ]; then
  echo "Migrating InkFrame Studio data from $LEGACY_DATA_DIR to $DATA_DIR"
  cp -a "$LEGACY_DATA_DIR/." "$DATA_DIR/"
fi

echo "InkFrame Studio data dir: $DATA_DIR"
exec dist/rust-backend/epd-backend-api
