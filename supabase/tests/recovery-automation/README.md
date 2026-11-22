# Capability levels and recovery automation: database tests

Plain Postgres (16+) tests for `20270509100000_cleo_capabilities_recovery_automation.sql`:

- **Levels**: the owner (business_owners) has every capability; an active
  coach and a second admin have Assist; a suspended coach, the finance login
  and a member have nothing. An owner capability is never a grant (not from
  the app, the owner or the server), a grant goes only to a coach or admin,
  revoked and expired grants stop at once, and every paid capability together
  still leaves the owner level out. Owner controls need the second step
  (`caller_mfa_ok`).
- **Settings**: only through the checked functions, only within the coach's
  level (automatic needs auto-send, follow-ups need follow-ups), rules only for
  their own clients, and a mode a lapsed level no longer allows steps down.
- **Queue**: one reply per review whatever is edited, nothing for an archived
  client, a client switched off, a paused coach or check-in pain; each coach
  reads only their own items (a second admin reads none of the owner's), only
  the server changes items, the worker claims an item once, and the record is
  append-only.
- **Rollback**: `docs/rollback/2026-11-22-recovery-automation-rollback.sql`
  removes it all and leaves every pain report.

```sh
PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/recovery-automation/run.sh
```

The migration runs twice (it's idempotent). The last lines are
`recovery-automation: all assertions passed` and
`recovery-automation: rolled back cleanly` (64 checks).
