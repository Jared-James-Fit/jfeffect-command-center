# Coach workspaces — database tests

Plain Postgres (16+) tests for `20270510090000_coach_workspaces.sql` (on top
of `20270507090000_organizations_foundation.sql` and
`20270509090000_coach_platform_early_access.sql`).

`schema.sql` stands in for the tables and helpers, with JF Effect's policies
written the way production has them (the admin reads everything, a coach
their own clients, a client their own rows) plus one deliberately loose
policy (any signed-in person reads every crew post), so the fence is tested
against the worst case. The people: Jared (owner, admin), Ana (a JF coach)
and her client Marc, Mia (a free member), Olivia (a JF member who runs her
own business, A) and Cole on her team, Priya and Quinn (her clients), Bo
(business B) and Bea (his client), and Sam (a login and nothing else).

- `baseline.sql` records what every JF Effect person sees before the
  migration runs.
- `scenario.sql`: the fence is a no-op with no business (every count the
  same); the pilot is off, then refuses to turn on while a table is
  unfenced; only the owner makes a workspace, at the platform's frozen price,
  with no JF role or coach record; invitations (a coach's are theirs, a
  forwarded link, an unconfirmed email, a JF client, the owner as her own
  client, consent required, used twice, locked after 5 wrong logins);
  isolation as all nine people, JF Effect's counts unchanged with two
  businesses running; writes (team writes programs only for its own
  clients, logs stay the client's); seats (pending, paused, archived, each
  change one revision); a billing lapse leaves reading and stops writing;
  permissions and taking someone off the team; support access (asked,
  approved by the business's owner only, run out); the client ending it;
  the record guard; the access record; the AI meter (reserve, settle once,
  credits back on failure, bought credits, both caps, server only).
- `rollback.sql`: the rollback refuses while a business holds records, then
  puts JF Effect back exactly as it was; `reapply.sql` applies it again.

```sh
su postgres -c "bash supabase/tests/coach-workspaces/run.sh"
```

The last lines are `all assertions passed`, `rolled back cleanly` and
`re-applied cleanly` (131 checks).
