# Cardio workspace: database tests

Plain Postgres (16+) tests for `20270521090000_cardio_workspace.sql`, applied
on top of the cardio sync it changes (`20270115090000_cardio_one_plan.sql`,
`20270117090000_cardio_row_notes_short.sql`): a workout's cardio comes from the
session in force on that workout's own date (a change scheduled for next week
reaches only next week's workouts), the workout note says the effort in the
client's speed unit, the new tables are read by staff for their own clients only
and written by nobody but the server, and a published version can't be rewritten.

```sh
createdb cardio_test
psql -d cardio_test -f supabase/tests/cardio-workspace/schema.sql
psql -d cardio_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270115090000_cardio_one_plan.sql
psql -d cardio_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270117090000_cardio_row_notes_short.sql
psql -d cardio_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270521090000_cardio_workspace.sql
psql -d cardio_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270521090000_cardio_workspace.sql   # safe to run twice
psql -d cardio_test -f supabase/tests/cardio-workspace/scenario.sql
```
