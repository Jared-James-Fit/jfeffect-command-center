# Coach platform early access: database tests

Plain Postgres (16+) tests for `20270509090000_coach_platform_early_access.sql`:
the public view says no price until the owner publishes one and always says
registration is closed; nobody but the server reads or writes the waitlist;
only an admin reads the settings, publishes or changes the price (bounded,
with a history row per change); and the waitlist's own rules (one open
application per email, consent recorded with its words, known values only).

```sh
createdb coach_platform_test
psql -d coach_platform_test -f supabase/tests/coach-platform/schema.sql
psql -d coach_platform_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270509090000_coach_platform_early_access.sql
psql -d coach_platform_test -f supabase/tests/coach-platform/scenario.sql
```

The last line printed is `coach platform: all assertions passed`.
