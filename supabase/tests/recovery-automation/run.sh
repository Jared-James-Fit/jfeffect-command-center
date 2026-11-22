#!/usr/bin/env bash
# Runs the capability-level and recovery-automation database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/recovery-automation/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-recovery_auto}
T=supabase/tests/recovery-automation
M=supabase/migrations/20270509100000_cleo_capabilities_recovery_automation.sql

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
migrate() { PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f $M >/dev/null; }

run $T/schema.sql
migrate
migrate   # twice: the migration is idempotent
run $T/scenario.sql
run $T/rollback.sql
