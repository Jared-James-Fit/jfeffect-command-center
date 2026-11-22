#!/usr/bin/env bash
# Runs the coach-workspaces database tests on a local Postgres 16.
# Usage (as the postgres user): supabase/tests/coach-workspaces/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-coach_workspaces}
T=supabase/tests/coach-workspaces
FOUNDATION="20270507090000_organizations_foundation 20270509090000_coach_platform_early_access"
MIGRATION=20270510090000_coach_workspaces

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"

run() {
  local out
  if ! out=$($PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" 2>&1); then
    echo "$out" | grep -E "ok:|ASSERT|ERROR|LINE|DETAIL|CONTEXT" || echo "$out"
    echo "FAILED in $1" >&2
    exit 1
  fi
  echo "$out" | grep -E "ok:|passed|baseline|rolled|applied" | sed 's/^.*NOTICE: *//' || true
}
apply() {
  PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f supabase/migrations/$1.sql >/dev/null
}

run $T/schema.sql
for m in $FOUNDATION; do apply $m; done
run $T/baseline.sql
apply $MIGRATION
apply $MIGRATION   # twice: idempotent
run $T/scenario.sql
cp docs/rollback/2026-11-22-coach-workspaces-rollback.sql /tmp/cw_rollback.sql
run $T/rollback.sql
apply $MIGRATION   # and back on after a rollback
run $T/reapply.sql
