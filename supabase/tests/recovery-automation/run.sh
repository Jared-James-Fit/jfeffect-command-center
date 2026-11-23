#!/usr/bin/env bash
# Runs the capability-level, recovery-automation, coaching-automation-category and video / progress reply database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/recovery-automation/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-recovery_auto}
T=supabase/tests/recovery-automation
M=supabase/migrations/20270509100000_cleo_capabilities_recovery_automation.sql
M2=supabase/migrations/20270510100000_coaching_automation_categories.sql
M3=supabase/migrations/20270511090000_coaching_automation_videos_progress.sql

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
apply() { for f in "$@"; do PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f $f >/dev/null; done; }

run $T/schema.sql
apply $M $M2
apply $M $M2   # twice: the migrations are idempotent
run $T/scenario.sql
run $T/scenario-categories.sql
apply $M3
apply $M3      # twice
run $T/scenario-videos-progress.sql
run $T/rollback-videos-progress.sql
run $T/rollback-categories.sql
run $T/rollback.sql
