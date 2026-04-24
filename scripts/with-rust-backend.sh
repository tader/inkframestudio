#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>" >&2
  exit 64
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8139}"
LOG_FILE="${LOG_FILE:-/tmp/epd-rust-${PORT}.log}"
BACKEND_CMD="${BACKEND_CMD:-cargo run --manifest-path rust/backend-api/Cargo.toml}"

cleanup() {
  if [ -n "${backend_pid:-}" ]; then
    kill "$backend_pid" >/dev/null 2>&1 || true
    wait "$backend_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

: >"$LOG_FILE"
(
  cd "$ROOT_DIR"
  PORT="$PORT" bash -lc "$BACKEND_CMD"
) >"$LOG_FILE" 2>&1 &
backend_pid=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    export EPD_BACKEND_PORT="$PORT"
    export EPD_BACKEND_BASE_URL="http://127.0.0.1:${PORT}"
    "$@"
    exit $?
  fi
  if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
    echo "backend exited early" >&2
    tail -50 "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.25
done

echo "backend failed health check" >&2
tail -50 "$LOG_FILE" >&2 || true
exit 1
