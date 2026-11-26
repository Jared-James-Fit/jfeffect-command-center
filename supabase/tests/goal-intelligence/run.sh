#!/usr/bin/env bash
# The goal ledger's database tests (20270601095000_goal_intelligence.sql and its fixes) on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pggoal -p 54339 -U postgres" supabase/tests/goal-intelligence/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-goal_intel}
T=supabase/tests/goal-intelligence
M=supabase/migrations/20270601095000_goal_intelligence.sql
F=supabase/migrations/20270602130000_goal_intelligence_fixes.sql

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
apply $M
apply $M   # twice: the migration is idempotent (the backfill adds nothing the second time)
apply $F
apply $F   # the fixes too
run $T/scenario.sql
run $T/fixes.sql
run $T/rollback.sql
