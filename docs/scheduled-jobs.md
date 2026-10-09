# Scheduled jobs

## How the hooks are called
pg_cron calls `/api/public/hooks/*` with `x-hook-secret`, a random secret kept in Vault
(`cron_hook_secret`). Hooks check it with `src/lib/hook-auth.server.ts` (the old
`x-worker-secret` env scheme still works). The public anon key is never accepted.
Exception: `payment-reminder-sms` uses its own Vault secret (`payment_reminder_hook_secret`).

| Job | Schedule | Calls |
|---|---|---|
| appointment-reminders-tick | every 5 min | appointment-reminders (appointment texts, PT session evening-before texts, PT session → Google Calendar sync) |
| birthday-notifications-hourly | :05 hourly | birthday-notifications (+ held pushes, 8am digest, monthly recap) |
| jf-cleanup-pending-signups-hourly | hourly | cleanup-pending-signups |
| lift-archive-tick-2m | every 2 min | lift-archive-tick |
| media-archive-nightly | 03:15 | media-archive (no-op while auto-archive is off) |
| nutrition-status-tick | 08:00 | nutrition-tick |
| sms-unread-reminders | every 10 min | sms-reminders |
| payment-setup-reminders / payment-reminder-sms | :07/:37, :12/:42 | see payment-links-and-reminders.md |
| scheduled-jobs-health | :23/:53 | SQL only (below) |

## Is it working?
`cron.job_run_details` says "succeeded" as soon as an HTTP call is queued, even if the app
rejected it. Look at the HTTP results instead:

    select * from cron_http_health(60);   -- status codes of scheduled calls, last 60 min

## Alert
`check_scheduled_jobs_health()` runs every 30 minutes in SQL (so it still works when the hooks
are broken). If 3+ scheduled calls failed, or 2+ cron runs errored, in the last hour it opens one
"Scheduled jobs failing" alert in Admin > Support Alerts (nav badge), refreshes it while the problem
lasts, and auto-resolves it with a note after a clean hour.

## Unread-message texts (sms-reminders)
Looks back ~72h (longest step + 1 day), one anchor message and at most one text per client per 24h,
only 9am-8pm client time, payment messages excluded.

## Session texts (appointment-reminders, PT part)
One text per session at 6 PM the evening before, in the session's time zone
(`src/lib/pt-session-reminders.ts`). None if the session was booked or moved after that
6 PM mark, if it's under 2 hours away, outside 9 AM-9 PM local, or the client opted out.
`pt_sessions.reminder_24h_sent_at` is claimed before sending, so a session is never texted
twice; moving a session clears it. Logged in `sms_log` with `kind = 'session'`, which the
unread-message texts ignore. A coach can also text a last-minute move or cancel (within
48 hours) from the session sheet.

## Google Calendar sync (appointment-reminders, PT part)
Any insert or edit of a PT session sets `pt_sessions.gcal_dirty` (trigger
`tg_pt_session_schedule_meta`). The tick (and a kick right after a coach saves) claims dirty
rows with `pt_gcal_claim()` and creates, updates or deletes the Google event on the coach's
selected calendar. Deleted sessions go through `pt_session_gcal_deletes`. Rows that fail 5
times stop and show under Calendar > Setup > Session sync, with a Retry button.

    select id, status, gcal_attempts, gcal_error from pt_sessions where gcal_dirty;  -- backlog
