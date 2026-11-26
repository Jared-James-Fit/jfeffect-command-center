# Specialists (game day coach, performance specialist) — database tests

Plain Postgres (16+) tests for `20270603090000_specialist_login_kind.sql` and
`20270603090100_team_specialists.sql`, on top of the organizations foundation:
the seeded Jesse draft invite, invite shapes, a specialist login becoming a
specialist member, the athlete's consent (agreed at once when the owner shares
their own athlete account, otherwise waiting for the athlete), what a
specialist sees per category, suspension, archiving, revocation, two-step,
notes private to their author and shared ones reaching only the athlete, and
that nobody writes these tables directly.

```sh
createdb spec_test
psql -d spec_test -f supabase/tests/team-specialists/schema.sql
psql -d spec_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270507090000_organizations_foundation.sql
psql -d spec_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270603090000_specialist_login_kind.sql
psql -d spec_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270603090100_team_specialists.sql
psql -d spec_test -f supabase/tests/team-specialists/scenario.sql
```

The last line printed is `team specialists: all assertions passed`.
