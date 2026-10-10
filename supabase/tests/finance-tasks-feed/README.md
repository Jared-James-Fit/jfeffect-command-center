# Fionna's tasks and feed photos — database tests

Plain Postgres (16+) tests for `20261028090000_finance_tasks_and_feed.sql`:
the finance login adds, ticks off and removes tasks on the team board (not
the media board) with a password sign-in alone while coaches and the admin keep theirs;
and it can open the crew's posted photos and comment photos, but not a
birthday draft that hasn't gone out. Clients and strangers see what they did
before.

`schema.sql` stands in for the app tables and helpers (`has_permission` and
`is_admin_viewer` are the real ones); `auth.uid()` reads the `test.uid`
setting and `auth.jwt()` the `test.aal` setting (nothing asks for a second step).

```sh
createdb finance_tasks_test
psql -d finance_tasks_test -f supabase/tests/finance-tasks-feed/schema.sql
psql -d finance_tasks_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261028090000_finance_tasks_and_feed.sql
psql -d finance_tasks_test -v ON_ERROR_STOP=1 -f supabase/tests/finance-tasks-feed/scenario.sql
```

Run on a fresh database; the last line prints `ALL OK`.
