# Crew private accounts, Close Friends and follow requests: database test

`scenario.sql` checks `20261130090000_crew_private_accounts_close_friends.sql`
as five people, inside one transaction that rolls back:

- **Pia**, a member who goes private
- **Fred**, who asks to follow her
- **Stan**, a stranger
- **Vic**, a public member
- **Coach Cole**, plus Jay, a coach whose athlete login is his main account

It covers 70 checks:
- follow → request → bell / Activity → confirm or delete (silently), and cancelling a request;
- who sees followers-only and Close Friends posts in the feed, the profile grid, opened by id, through RLS on the table, and for reacting and commenting;
- the automatic workout Pulse staying crew-wide;
- counts and lists on a private profile;
- removing a follower, blocking and unblocking;
- edit, archive and restore;
- League post points for a private account;
- DMs and story replies (a chat when the person written to follows you, otherwise a request), and the daily request cap counting only real requests;
- coaches staying public;
- private → public flipping old posts back and approving waiting requests.

## Running it

It needs a database built from **every** migration, not stand-ins. It was run
on Postgres 16, locally and never against production:

1. Load `supabase-stand-ins.sql`: roles, `auth.uid()` from `request.jwt.claims`, `auth.users`, `storage`, `realtime`.
2. Add stub `pg_cron`, `pg_net`, `supabase_vault` and `pgmq` extensions with the functions the migrations call.
3. Replay `supabase/migrations/*.sql` in order, each file as one transaction. A file that fails is re-run statement by statement, which is how production ended up: a few early migrations never applied cleanly there either.
4. Copy the objects production has that no migration creates, reading definitions only from its catalog: `athlete_xp_events` and the achievement tables, the XP functions and triggers, and the one-version `community_message_author`.
5. Snapshot that database, apply the migration, then run:

```sh
psql -d crew_test -v ON_ERROR_STOP=1 -f supabase/tests/crew-private-accounts/scenario.sql
# list every failure instead of stopping at the first one:
(echo "SET t.soft = 'on';"; cat supabase/tests/crew-private-accounts/scenario.sql) | psql -d crew_test
```

The last line it prints is `ALL CREW PRIVATE-ACCOUNT CHECKS PASSED`.
