# Coach authorization — database tests

Plain Postgres (16+) tests for the Nov 22 2026 coach authorization hardening:

- `20270507093000_cleo_actions_run_as_requester.sql`: a Cleo card runs as the
  person who asked for it. `cleo_action_target_allowed` (the requester's own
  roles and coach record, never the caller's session) and
  `cleo_mark_client_reviews_reviewed_as` are the server's only, and
  `cleo_actions.executed_as` can only ever be the requester.
- `20270507094000_coach_money_read_only.sql`: a coach reads their own
  clients' sales, member ledger, package enrollments and payment links, and
  writes none of them; the admin is unchanged.
- `20270507094500_coach_client_data_scoped.sql`: AI meal plans, support
  alerts, link reviews, warm-up and event assignments, broadcasts, submission
  reviews (and their children) and Fillout entries are a coach's own clients'
  only; rows that belong to no client are the admin's.

`schema.sql` stands in for the tables and helpers and puts each table's
policies back as production had them before (copied from the latest migration
that defined them), with a team: the owner (admin), Ana coaching Marc and Mia,
Ben coaching Nico, the finance login and Mia's own login. `before.sql` shows
the holes were real; `scenario.sql` checks every rule as each person (`set role
authenticated` + `t_as(uid)`), the server (`t_as_service()` + `service_role`)
and a suspended coach; `rollback.sql` runs
`docs/rollback/2026-11-22-coach-authorization-rollback.sql` and checks the old
rules are back.

```sh
PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/coach-authorization/run.sh
```

It applies the migrations twice (they're idempotent). The last lines printed
are `coach-authorization: all assertions passed` and
`coach-authorization: rolled back cleanly` (87 checks).
