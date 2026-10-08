# All-Time Strength Board — database tests

Plain Postgres (16+) tests for `20261016090000_all_time_strength_board.sql`,
modeled on real logging patterns (including typos seen in production): the
typo shield, bodyweight-at-the-time, absolute (Men/Women) and pound-for-pound
(DOTS) ranking, top-10 + viewer visibility, unranked athletes, and the coach
review tools.

```sh
createdb strength_board_test
psql -d strength_board_test -f supabase/tests/strength-board/schema.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261016090000_all_time_strength_board.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261016100000_strength_board_faster.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/tests/strength-board/scenario.sql
```

The supabase roles (`anon`, `authenticated`, `service_role`) must exist in the
cluster. Run on a fresh database.
