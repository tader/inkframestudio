set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

run:
	if [ ! -d node_modules ]; then npm install; fi
	npm run build
	PORT="${PORT:-8099}" NODE_ENV=production node dist/addon-backend/server.cjs

build:
	if [ ! -d node_modules ]; then npm install; fi
	npm run build

dev:
	if [ ! -d node_modules ]; then npm install; fi
	npm run dev:backend

test:
	if [ ! -d node_modules ]; then npm install; fi
	npm test

typecheck:
	if [ ! -d node_modules ]; then npm install; fi
	npm run typecheck
