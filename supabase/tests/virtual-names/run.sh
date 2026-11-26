#!/usr/bin/env bash
# The virtual account names migration's database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pg -p 54377 -U postgres" supabase/tests/virtual-names/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-virtual_names}
T=supabase/tests/virtual-names
M=supabase/migrations/20270602090000_virtual_account_names.sql

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
run() {
  local out
  if ! out=$($PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" 2>&1); then
    echo "$out" | grep -E "ok:|ASSERT|ERROR|NOTICE" || echo "$out"
    echo "FAILED in $1" >&2
    exit 1
  fi
  echo "$out" | grep -vE "^\s*$" || true
}
apply() { PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f "$1" >/dev/null; }

run $T/schema.sql
apply $M
apply $M   # twice: idempotent
run $T/cases.sql
run $T/scenario.sql
