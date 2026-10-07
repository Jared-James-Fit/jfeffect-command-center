# Scheduled jobs

## How the hooks are called
pg_cron calls `/api/public/hooks/*` with `x-hook-secret`, a random secret kept in Vault
(`cron_hook_secret`). Hooks check it with `src/lib/hook-auth.server.ts` (the old
`x-worker-secret` env scheme still works). The public anon key is never accepted.
Exception: `payment-reminder-sms` uses its own Vault secret (`payment_reminder_hook_secret`).

| Job | Schedule | Calls |
|---|---|---|
| appointment-reminders-tick | every 5 min | appointment-reminders |
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
