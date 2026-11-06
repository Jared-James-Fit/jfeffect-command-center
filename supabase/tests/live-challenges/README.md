# Live challenges — database tests

Plain Postgres (16+) tests for `20270205090000_live_challenges.sql`.
`schema.sql` creates Supabase stand-ins (anon / authenticated roles, `auth.users`,
`auth.uid()` from `request.jwt.claim.sub`, `has_role`, `storage.objects`);
`scenario.sql` runs an event from draft to final results as every role: the
public, registration staff, a judge, a manager, the owner and an athlete who
claims their profile. It checks privacy (no contact detail ever reaches a
public function), ties (shared unless the published tie-break separates
everyone tied), prize splits, locks after the start and after final results,
idempotent score retries, the audit trail, analytics de-duplication and photo
upload permissions.

```sh
createdb challenges_test
psql -d challenges_test -f supabase/tests/live-challenges/schema.sql
psql -d challenges_test -f supabase/migrations/20270205090000_live_challenges.sql
psql -d challenges_test -v ON_ERROR_STOP=1 -f supabase/tests/live-challenges/scenario.sql
```

It ends with `ALL LIVE CHALLENGE TESTS PASSED`.
