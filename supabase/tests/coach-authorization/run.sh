#!/usr/bin/env bash
# Runs the coach-authorization database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/coach-authorization/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-coach_auth}
T=supabase/tests/coach-authorization
MIGRATIONS="20270507093000_cleo_actions_run_as_requester 20270507094000_coach_money_read_only 20270507094500_coach_client_data_scoped"

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"

# A file's assertions, printed; any error stops the run.
run() {
  local out
  if ! out=$($PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" 2>&1); then
    echo "$out" | grep -E "ok:|ASSERT|ERROR" || echo "$out"
    echo "FAILED in $1" >&2
    exit 1
  fi
  echo "$out" | grep -E "ok:|passed|holes|rolled" || true
}
migrate() {
  for m in $MIGRATIONS; do
    PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f supabase/migrations/$m.sql >/dev/null
  done
}

run $T/schema.sql
run $T/before.sql
migrate
migrate   # twice: the migrations are idempotent
run $T/scenario.sql
run $T/rollback.sql
