#!/usr/bin/env bash
# OpenIPF discovery database tests on a local Postgres 16.
# Usage: PSQL="psql -h /tmp/pgopl -p 54341 -U postgres" supabase/tests/openipf/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
PSQL=${PSQL:-psql}
DB=${DB:-openipf_test}
M=supabase/migrations/20270525090000_openipf_discovery.sql
$PSQL -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/openipf/schema.sql >/dev/null
PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f $M >/dev/null
PGOPTIONS='-c client_min_messages=warning' $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f $M >/dev/null   # twice: idempotent
out=$($PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/openipf/scenario.sql 2>&1) || { echo "$out" | grep -E "ok:|ASSERT|ERROR|CONTEXT|LINE"; echo FAILED >&2; exit 1; }
echo "$out" | grep -E "ok:|passed"
