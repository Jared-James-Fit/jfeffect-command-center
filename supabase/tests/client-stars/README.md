# Starred clients: database tests

Plain Postgres (16+) tests for `20270519090000_staff_client_stars.sql`: a coach
stars only clients assigned to them (never another coach's, never as a
suspended coach), an admin stars any client, a client stars nobody, every
login reads and removes only its own stars (a second admin never sees the
owner's), stars are never updated, anonymous callers get nothing, and a star
goes with its client.

```sh
createdb stars_test
psql -d stars_test -f supabase/tests/client-stars/schema.sql
psql -d stars_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270519090000_staff_client_stars.sql
psql -d stars_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270519090000_staff_client_stars.sql   # safe to run twice
psql -d stars_test -f supabase/tests/client-stars/scenario.sql
```
