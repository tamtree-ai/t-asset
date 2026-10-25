#!/usr/bin/env bash
# Starts the dev stack in the background: Postgres (Docker), migrations, `pnpm dev`
# and `pnpm fake-tamtree`. Logs and PIDs go to .run/. Stop it with ./stop.sh.
set -euo pipefail
cd "$(dirname "$0")"

RUN_DIR=.run
mkdir -p "$RUN_DIR"

if [[ ! -f .env.local ]]; then
  echo "No .env.local. Copy .env.example to .env.local and fill it in (see README)." >&2
  exit 1
fi

running() { [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null; }

# Each background job gets its own process group, so stop.sh can kill its children too.
set -m

start() {
  local name=$1; shift
  if running "$name"; then
    echo "$name already running (pid $(cat "$RUN_DIR/$name.pid"))"
    return
  fi
  "$@" >"$RUN_DIR/$name.log" 2>&1 &
  echo $! >"$RUN_DIR/$name.pid"
  echo "$name started (pid $!, log $RUN_DIR/$name.log)"
}

echo "Starting Postgres on 5434..."
pnpm db:up
pnpm db:migrate

start dev pnpm dev
start fake-tamtree pnpm fake-tamtree

echo "App: http://localhost:3000  (tail -f $RUN_DIR/dev.log)"
