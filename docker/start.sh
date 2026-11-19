#!/usr/bin/env bash
set -euo pipefail

case "${APP_MODE:-}" in
  demo|pilot) ;;
  *) echo "APP_MODE debe ser demo o pilot." >&2; exit 1 ;;
esac

socket=/var/run/postgresql
if [ "$(id -u)" -eq 0 ]; then
  install -d -m 0700 -o postgres -g postgres "$PGDATA"
  install -d -m 3775 -o postgres -g postgres "$socket"
  exec gosu postgres /bin/bash "$0" "$@"
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" --username=postgres --auth-local=peer --auth-host=scram-sha-256
fi

node_pid=
stop_services() {
  trap '' TERM INT
  if [ -n "$node_pid" ]; then
    kill -TERM "$node_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
  fi
  if kill -0 "$postgres_pid" 2>/dev/null; then
    pg_ctl -D "$PGDATA" -s -m fast -w stop || kill -INT "$postgres_pid" 2>/dev/null || true
  fi
  wait "$postgres_pid" 2>/dev/null || true
}

postgres -D "$PGDATA" -c listen_addresses='' -c unix_socket_directories="$socket" &
postgres_pid=$!
trap stop_services EXIT
trap 'exit 0' TERM INT

for attempt in {1..60}; do
  if pg_isready -q -h "$socket" -U postgres -d postgres; then break; fi
  if ! kill -0 "$postgres_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
if ! pg_isready -q -h "$socket" -U postgres -d postgres; then
  echo 'PostgreSQL no inició a tiempo.' >&2
  exit 1
fi

if [ "$(psql -X -Atq -v ON_ERROR_STOP=1 -h "$socket" -d postgres -c "SELECT 1 FROM pg_database WHERE datname='aurora'")" != 1 ]; then
  createdb -h "$socket" aurora
fi

if [ "$APP_MODE" = demo ]; then
  node scripts/admin.js demo
fi
node src/start.js &
node_pid=$!

# Docker detiene el contenedor cuando cualquiera de los dos servicios termina.
wait -n "$postgres_pid" "$node_pid"
exit 1
