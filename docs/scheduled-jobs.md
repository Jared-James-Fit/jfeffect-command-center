# Scheduled jobs

## How the hooks are called
pg_cron calls `/api/public/hooks/*` with `x-hook-secret`, a random secret kept in Vault
(`cron_hook_secret`). Hooks check it with `src/lib/hook-auth.server.ts` (the old
`x-worker-secret` env scheme still works). The public anon key is never accepted.
Exception: `payment-reminder-sms` uses its own Vault secret (`payment_reminder_hook_secret`).

| Job | Schedule | Calls |
|---|---|---|
| appointment-reminders-tick | every 5 min (:04, :09, …) | appointment-reminders (appointment texts, PT session evening-before texts, PT session → Google Calendar sync) |
| birthday-notifications-hourly | :05 hourly | birthday-notifications (+ held pushes, 8am digest, monthly recap) |
| jf-cleanup-pending-signups-hourly | hourly | cleanup-pending-signups |
| lift-archive-tick-2m | every 2 min while a lift video waits to be copied | lift-archive-tick |
| media-archive-nightly | 03:15 | media-archive (no-op while auto-archive is off) |
| nutrition-status-tick | 08:00 | nutrition-tick |
| nutrition-roadmap-tick | 13:17 UTC (8:17 Winnipeg) | nutrition-roadmap-tick: every roadmap (coaching clients with a goal or a plan, and anyone with a roadmap) read against the day's data; status and next check-in kept; a reforecast proposed only for a changed goal, 14+ days off plan or 2 missed check-ins; a self-coached athlete's due check-in pushed once (every 2 days at most); the coach pushed only for a change to approve or a real risk (every 3 days at most, never a first draft). `{ clientId }` reads one athlete |
| messenger-checkin-reminders | every 15 min | SQL only: `run_messenger_checkin_automation()` seeds each coaching client's next weekly check-in and sends the card 2 days before it's due (Friday) from 7am in the client's own time; one card per 4 days, a check-in sent by hand included; archived, deactivated and non-coaching clients skipped; one run at a time (advisory lock). Its only reminder is the 8am digest line (checkin-coordination/plan.ts) |
| nutrition-update-monthly | :07, :22, :37, :52 | SQL only: `enqueue_monthly_nutrition_updates()` asks for the Nutrition Update in the week the plan is due its review (`nutrition_review_due`: its Next update due, else 4 / 6 / 8 weeks by phase), through that week's check-in: folded into the open check-in for a client who has sent one before (`messenger_checkins.nutrition_requested_at`), else the form in their chat (a first one, or no check-in coming: on the due day from 9am); never within 21 days of their last update or 25 of the last request, never for a plan marked not needed; one run at a time |
| competition-intel-tick | every minute while `competition_intel_due()` | competition-intel-tick: competitions whose date / status / results changed get their milestones worked out again; due milestones are written one at a time (the brief, Cleo's write-up on the OpenAI key, a new assessment version, the coach pushed; a routine update released only under the coach's auto policy). `{ milestoneId }` runs one |
| competition-intel-daily | 12:41 UTC (7:41 Winnipeg) | competition-intel-tick `{ "scan": "daily" }`: each upcoming competition's live numbers and concerns, competitors' OpenPowerlifting records refreshed (weekly, daily in the last 3 weeks), results picked up after the meet, an interim update queued for a 3%+ forecast shift or a new serious concern (at most every 10 days) |
| meet-checklist-reminders | 14:11 UTC daily (9:11 Winnipeg) | meet-checklist-reminders (push only, each client's own calendar day: 2 weeks out if the meet checklist isn't sent, 2–3 days out while something's open, the day before for must-haves) |
| openipf-tick | every minute | SQL only: `openipf_tick()` sends the next OpenIPF lookups (8 a minute at most), reads their answers into suggestions, closes finished searches, and wakes `openipf-notify` (at most every 15 min) when matches or new meets are ready to tell; costs nothing while the queue is empty |
| openipf-monthly-scan | 15:41 UTC on the 1st (10:41 Winnipeg) | SQL only: `_openipf_scan_start(NULL, NULL, NULL)` looks up every current coaching client and alumni record with no OpenIPF profile linked (never a free member); the tick does the rest |
| sms-unread-reminders | every 10 min (:08, :18, …) | sms-reminders |
| ai-health-tick | every 5 min (:02, :07, …) | ai-health-tick (AI provider health, alerts, recovery; its hourly parts run at :02) |
| training-roadmap-tick | every 5 min (:03, :08, …) while a roadmap waits | training-roadmap-tick |
| payment-setup-reminders / payment-reminder-sms | :07/:37, :12/:42 | see payment-links-and-reminders.md |
| scheduled-jobs-health | :23/:53 | SQL only (below) |

## Taking turns
The app's server runs requests in a shared worker, and several landing in the same second can run
it out of memory, which kills every request in it (Cloudflare 1102). So a job that calls a hook:
- asks the database first and calls only when there's work (`select net.http_post(...) where exists (...)`),
  like program-intel-tick, lift-archive-tick-2m and training-roadmap-tick;
- and, when it has to call every time, takes a minute of its own (`2-59/5`, `8-59/10`), never the
  :00 / :x0 / quarter-hour minutes the every-5 and every-15 jobs already share. At most two
  always-on calls start in any minute (20270531090000_cron_hooks_spread_out.sql).

To see when calls start together:

    select date_trunc('minute', d.start_time) m, string_agg(j.jobname, ', ')
      from cron.job_run_details d join cron.job j using (jobid)
     where d.start_time > now() - interval '1 hour' and d.return_message like '1 row%'
     group by 1 having count(*) > 2 order by 1;

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
