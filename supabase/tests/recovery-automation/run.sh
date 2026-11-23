#!/usr/bin/env bash
# Runs the capability-level, recovery-automation and coaching-automation-category database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/recovery-automation/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-recovery_auto}
T=supabase/tests/recovery-automation
M=supabase/migrations/20270509100000_cleo_capabilities_recovery_automation.sql
M2=supabase/migrations/20270510100000_coaching_automation_categories.sql

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
migrate() { for f in $M $M2; do PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f $f >/dev/null; done; }

run $T/schema.sql
migrate
migrate   # twice: the migration is idempotent
run $T/scenario.sql
run $T/scenario-categories.sql
run $T/rollback-categories.sql
run $T/rollback.sql
