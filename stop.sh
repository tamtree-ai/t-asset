#!/usr/bin/env bash
# Stops what start.sh started. Postgres is stopped, not removed: its data volume stays.
# Pass --keep-db to leave Postgres running.
set -uo pipefail
cd "$(dirname "$0")"

RUN_DIR=.run

stop() {
  local name=$1 pidfile="$RUN_DIR/$1.pid"
  if [[ ! -f "$pidfile" ]]; then
    echo "$name not running"
    return
  fi
  local pid; pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    # Kill the whole process group (pnpm -> next / tsx).
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for _ in {1..20}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -KILL -- "-$pid" 2>/dev/null
    echo "$name stopped"
  else
    echo "$name not running (stale pid file)"
  fi
  rm -f "$pidfile"
}

stop dev
stop fake-tamtree

if [[ "${1:-}" != "--keep-db" ]]; then
  docker compose -f compose.dev.yml stop
fi
