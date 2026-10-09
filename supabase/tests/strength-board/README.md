# All-Time Strength Board — database tests

Plain Postgres (16+) tests for `20261016090000_all_time_strength_board.sql`,
modeled on real logging patterns (including typos seen in production): the
typo shield, which exercises count, bodyweight-at-the-time, absolute
(All/Men/Women) and pound-for-pound (x bodyweight) ranking, top-10 + viewer
visibility, unranked athletes, the coach review tools, the JF Effect meet
history boards (`scenario-meets.sql`), the all-time board that merges
training and meets for everyone ever coached (`scenario-all-time.sql`), and
powerlifting careers synced from OpenPowerlifting (`scenario-opl.sql`, on real
lifter CSV exports in `opl/`; `schema.sql` stands in for pg_net).

```sh
createdb strength_board_test
psql -d strength_board_test -f supabase/tests/strength-board/schema.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261016090000_all_time_strength_board.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261016100000_strength_board_faster.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261017110000_strength_board_everyone.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261017120000_hall_of_strength_meets.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261024090000_hall_of_strength_all_time.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261029090000_powerlifting_careers_opl_sync.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261030090000_powerlifting_opl_sync_reused_ids.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/tests/strength-board/scenario.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/tests/strength-board/scenario-meets.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/tests/strength-board/scenario-all-time.sql
psql -d strength_board_test -v ON_ERROR_STOP=1 -f supabase/tests/strength-board/scenario-opl.sql
```

Run from the repo root (`scenario-opl.sql` reads the CSVs by relative path).
The supabase roles (`anon`, `authenticated`, `service_role`) must exist in the
cluster. Run on a fresh database.
