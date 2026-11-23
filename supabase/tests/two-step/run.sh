#!/usr/bin/env bash
# Runs the two-step sign-in database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/two-step/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-two_step}
T=supabase/tests/two-step
MIGRATIONS="supabase/migrations/20270424091500_staff_mfa.sql supabase/migrations/20270424093000_staff_mfa_recovery.sql supabase/migrations/20270512090000_two_step_sms_passkeys.sql supabase/migrations/20270513100000_no_recovery_codes.sql supabase/migrations/20270515090000_two_step_email_backup.sql"

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
migrate() { for f in $MIGRATIONS; do PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -t -f $f >/dev/null; done; }

run $T/schema.sql
migrate
migrate   # twice: the migration is idempotent
run $T/scenario.sql
run $T/rollback-email.sql
run $T/rollback.sql
