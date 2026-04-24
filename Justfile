set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

run:
	if [ ! -d node_modules ]; then npm install; fi
	npm run build
	PORT="${PORT:-8099}" cargo run --release --manifest-path rust/backend-api/Cargo.toml

build:
	if [ ! -d node_modules ]; then npm install; fi
	npm run build

dev:
	if [ ! -d node_modules ]; then npm install; fi
	PORT="${PORT:-8099}" cargo run --manifest-path rust/backend-api/Cargo.toml

rust-api:
	if [ ! -d node_modules ]; then npm install; fi
	npm run generate:font-awesome
	PORT="${PORT:-8098}" cargo run --manifest-path rust/backend-api/Cargo.toml

smoke-health:
	if [ ! -d node_modules ]; then npm install; fi
	npm run build
	scripts/with-rust-backend.sh bash -lc 'curl -fsS "$EPD_BACKEND_BASE_URL/healthz"'

test:
	if [ ! -d node_modules ]; then npm install; fi
	npm test

typecheck:
	if [ ! -d node_modules ]; then npm install; fi
	npm run typecheck
