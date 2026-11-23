#!/usr/bin/env bash
# The admin intelligence migration's database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/admin-intelligence/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-admin_intelligence}
T=supabase/tests/admin-intelligence
M=supabase/migrations/20270517090000_admin_intelligence.sql

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
run() {
  local out
  if ! out=$($PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" 2>&1); then
    echo "$out" | grep -E "ok:|ASSERT|ERROR" || echo "$out"
    echo "FAILED in $1" >&2
    exit 1
  fi
  echo "$out" | grep -E "ok:|passed|rolled" || true
}
apply() { PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" >/dev/null; }

run $T/schema.sql
apply $M
apply $M   # twice: idempotent
run $T/scenario.sql
apply docs/rollback/2026-11-23-admin-intelligence-rollback.sql
run $T/rollback.sql
