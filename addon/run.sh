#!/usr/bin/with-contenv bashio
export PORT=8099
export NODE_ENV=production
cd /app
node dist/addon-backend/server.js
