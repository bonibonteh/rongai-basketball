#!/usr/bin/env bash
# Runs the migrations and security tests on a throwaway local Postgres that imitates Supabase roles/auth.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; BIN=/usr/lib/postgresql/16/bin
D=$(mktemp -d); chown postgres "$D"; PORT=54329
su postgres -c "$BIN/initdb -D $D/data -A trust >/dev/null"
su postgres -c "$BIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true' EXIT
P="psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
P="$P -d t"
$P -f "$HERE/supabase_stub.sql"
for f in "$HERE"/../migrations/*.sql; do echo "migration: $(basename "$f")"; $P -f "$f"; done
$P -f "$HERE/security_tests.sql"
