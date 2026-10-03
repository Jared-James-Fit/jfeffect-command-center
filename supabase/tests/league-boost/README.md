# Final Week Boost — database tests

Plain Postgres (16+) tests for `20261003180000_performance_league_final_week_boost.sql`.
`schema.sql` creates minimal stand-ins for the app tables plus helpers; the
scenario simulates a full October (time travel via the functions' `_now`
argument) and the security file checks privacy and staff-only tools.

```sh
createdb league_test
psql -d league_test -f supabase/tests/league-boost/schema.sql
psql -d league_test -f supabase/migrations/20261003180000_performance_league_final_week_boost.sql
psql -d league_test -v ON_ERROR_STOP=1 -f supabase/tests/league-boost/scenario.sql
psql -d league_test -v ON_ERROR_STOP=1 -f supabase/tests/league-boost/security.sql
```

Run on a fresh database: the scenario finalizes October, and a second run
(correctly) writes no new awards.
