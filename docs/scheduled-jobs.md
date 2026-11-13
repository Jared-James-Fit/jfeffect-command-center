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

## Unread-message nudges and SMS bookkeeping (sms-reminders)
Push first: a coach message unread for the step's delay gets a free push; only someone the push
didn't reach gets the text, and only for a message the coach wrote (automated prompts stop at the
push). Looks back ~72h (longest step + 1 day), one anchor message and at most one nudge per client
per 24h, only 9am-8pm client time, payment messages excluded
(`src/lib/sms-unread-reminders.server.ts`). The same tick reads back what Twilio did with recent
texts (status, price, STOP opt-outs; `src/lib/sms-status.server.ts`, 6 checks a text at most) and,
at most hourly, the month's real Twilio bill into `sms_settings.twilio_usage`.

## Every text: one sender, one guard
All SMS goes through `src/lib/sms-gateway.server.ts`, which calls `public.sms_claim` before Twilio
(switches, opt-out, +1 only, idempotency key, retries, per-client daily cap, the monthly budget and
its 2x hard cap). Settings → SMS → Cost this month shows the ledger. To see what was stopped:

    select blocked_reason, count(*) from sms_log
     where created_at >= sms_month_start(now()) and blocked_reason is not null group by 1;

## Session texts (appointment-reminders, PT part)
One text per session at 6 PM the evening before, in the session's time zone
(`src/lib/pt-session-reminders.ts`). None if the session was booked or moved after that
6 PM mark, if it's under 2 hours away, outside 9 AM-9 PM local, or the client opted out.
`pt_sessions.reminder_24h_sent_at` is claimed before sending, so a session is never texted
twice; moving a session clears it. Logged in `sms_log` with `kind = 'session'`, which the
unread-message texts ignore. Every reminder fits one SMS segment (`fitOneSegment`). A move or
cancel from the session sheet is texted only when the chat message's push may not reach them in
time (`changeTextDecision`: within 48 hours without push, 24 hours with it; never for a time the
client asked for when push reaches them).

## Google Calendar sync (appointment-reminders, PT part)
Any insert or edit of a PT session sets `pt_sessions.gcal_dirty` (trigger
`tg_pt_session_schedule_meta`). The tick (and a kick right after a coach saves) claims dirty
rows with `pt_gcal_claim()` and creates, updates or deletes the Google event on the coach's
selected calendar. Deleted sessions go through `pt_session_gcal_deletes`. Rows that fail 5
times stop and show under Calendar > Setup > Session sync, with a Retry button.

    select id, status, gcal_attempts, gcal_error from pt_sessions where gcal_dirty;  -- backlog
