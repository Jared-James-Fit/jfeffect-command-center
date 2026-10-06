# Coaching Agreement — database tests

Plain Postgres (16+) tests for `20261006030000_coaching_agreement.sql`.
`schema.sql` creates minimal stand-ins for the app tables (including a copy of the
`clients` guard trigger, so the tests prove the server path passes it while a
client's own session is refused). `scenario.sql` exercises signing, idempotency,
the `clients.agreement_*` mirror, immutability and account deletion.
`security.sql` checks who can read and write what.

```sh
createdb coaching_agreement_test
psql -d coaching_agreement_test -f supabase/tests/coaching-agreement/schema.sql
psql -d coaching_agreement_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261006030000_coaching_agreement.sql
psql -d coaching_agreement_test -v ON_ERROR_STOP=1 -f supabase/tests/coaching-agreement/scenario.sql
psql -d coaching_agreement_test -v ON_ERROR_STOP=1 -f supabase/tests/coaching-agreement/security.sql
```

Run on a fresh database (the roles are created only if missing, so any number of fresh
databases can share one cluster). Re-running the migration file itself is safe
(idempotent); the scenario and security files insert fixed fixtures, so use a new database
for them.
