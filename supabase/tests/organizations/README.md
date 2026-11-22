# Organizations and team access — database tests

Plain Postgres (16+) tests for `20270507090000_organizations_foundation.sql`
and `20270507091000_team_access_hardening.sql`: JF Effect's organization and
its members read from staff roles (the owner, coaches, the finance login;
never a JF member), the backfills (a coach already suspended loses the role),
a coach's role following their record (suspend, restore, archive), client
assignments in the access record, the record being append-only, who reads
what (RLS: a coach sees only their own membership, the owner sees the team
and the record, a member sees nothing, nobody writes a membership directly),
and purchase term dates limited to the admin, the client's own coach and the
server.

```sh
createdb org_test
psql -d org_test -f supabase/tests/organizations/schema.sql
psql -d org_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270507090000_organizations_foundation.sql
psql -d org_test -v ON_ERROR_STOP=1 -f supabase/migrations/20270507091000_team_access_hardening.sql
psql -d org_test -f supabase/tests/organizations/scenario.sql
```

`schema.sql` seeds the team as it stands before the migrations, so the
backfills run on real rows. The last line printed is
`organizations: all assertions passed`.
