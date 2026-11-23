# Two-step sign-in by text, passkey and trusted device: database tests

Plain Postgres (16+) tests for `20270512090000_two_step_sms_passkeys.sql`, on
top of the two earlier two-step migrations (staff_mfa, staff_mfa_recovery):

- **Nothing changes until someone sets something up**: the authenticator
  app's aal2 works as before, a login with nothing set up keeps its rights,
  a client never has a second step.
- **Confirmed sessions**: a phone number or passkey enforces the login; only
  a session the server marked (and that belongs to the login and still
  exists) gets staff rights back; signing out or a session past its limit
  ends it at once; a token naming someone else's session gets nothing.
- **Texted codes**: one every 30 s, 5 an hour, 10 a day; 5 wrong tries kill a
  code; 10 wrong in an hour lock sending and checking; a code is for its own
  session and purpose, works once, expires, and a resend replaces it.
- **Trusted devices**: 30 days at most, 10 per login (the oldest go),
  someone else's token never works, forget one or all.
- **The owner's reset** removes every way, confirmed session and device.
- **Only the server** reads or writes any of it.
- **Rollback**: `docs/rollback/2026-11-23-two-step-sms-passkeys-rollback.sql`
  puts the authenticator-only checks back and keeps the record.

```sh
PSQL="psql -h /tmp/pgsec -p 54331 -U postgres" supabase/tests/two-step/run.sh
```

The migrations run twice (they're idempotent). The last lines are
`two-step: all assertions passed` and `two-step: rolled back cleanly`.
