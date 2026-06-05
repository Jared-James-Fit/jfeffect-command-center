# Client Activity, Compliance & Notifications

A big feature surface. To keep it shippable and avoid a half-broken dashboard, I'll build it in 4 phases. You can stop me after any phase if you want to ship and iterate.

---

## Phase 1 — Activity tracking foundation (ship first)

The whole system rests on reliably knowing *when* a client did something. Build this first.

### Database

New columns on `public.clients`:
- `last_signed_in_at timestamptz`
- `last_active_at timestamptz`
- `last_active_route text` (e.g. "/portal/program")
- `compliance_status text default 'On Track'` — On Track | Watch | Needs Follow-Up | Non-Compliant | Paused
- `compliance_status_updated_at timestamptz`
- `compliance_tracking_enabled boolean default true`

New table `public.client_compliance_settings` (1:1 with clients) — per-client rules:
- check_in_required, check_in_due_day
- bodyweight_expected, bodyweight_frequency_per_week
- lift_videos_expected, lift_video_frequency_per_week
- progress_photos_expected
- inactivity_threshold_days (default 7)
- followup_threshold_days (default 14)
- notes

(Re-uses the existing `client_activity_log` table for the timeline — already exists.)

### Client → app heartbeat
- `useActivityHeartbeat()` hook mounted in the authenticated portal layout.
- On mount + route change + every 3 min while tab visible → calls a `pingActivity` server fn that updates `last_active_at` and `last_active_route` (throttled server-side to once / 60s).
- On successful sign-in / session restore → updates `last_signed_in_at`.

### Activity log writes
Hook the existing tables I already touch from server code so an `client_activity_log` row is inserted when:
- bodyweight logged, goal set/reached, lift video uploaded (incl. urgent), message sent, check-in submitted, progress metric logged, agreement signed, payment completed.

---

## Phase 2 — Client profile + clients list surfaces

### Client profile (admin + coach view)
New **App Activity** card on `clients.$id`:
- Status pill (Online now / Active today / Inactive Xd / Never signed in)
- Last signed in, Last active, Last viewed page
- Most recent action (pulled from `client_activity_log`)
- Compliance pill + "Follow-up needed: Yes/No"

New **Compliance Settings** card (collapsible) with the per-client toggles above.

New **Activity Timeline** card — last 20 entries from `client_activity_log`, simple list.

### Clients list
Add one new column: **Activity** showing a single compact badge — Online / Active today / Inactive 7d / Inactive 14d+ / Never signed in. Compliance shown only when not "On Track" to keep the table clean.

---

## Phase 3 — Compliance engine + Needs Follow-Up

### Compliance evaluator
Pure TS function `evaluateCompliance(client, settings, lastActions) → status + reasons[]`. Runs:
1. Server-side cron-ish: a scheduled server fn (called on admin dashboard load + nightly via `pg_cron` calling `/api/public/recompute-compliance` with a shared secret) recomputes every active client.
2. Inline: whenever a tracked event fires, recompute that one client.

Logic per request:
- Inactive 7d → Watch · Inactive 14d → Needs Follow-Up · Inactive 30d → Non-Compliant
- Check-in overdue past due_day → Needs Follow-Up
- Bodyweight/lift video frequency missed → Watch then Needs Follow-Up
- Unsigned agreement blocking service → Needs Follow-Up
- Paused/archived client → Paused (skip evaluation)

### Needs Follow-Up view
- New admin route `/admin/follow-up` + dashboard widget version.
- Lists clients with status ≠ On Track, sorted by severity then last_active.
- Each row: name, last active, missed item(s), status, **Message Client** button (opens existing message thread pre-filled with a template, admin edits before sending — no auto-send).
- Coach version filters to assigned clients automatically.

---

## Phase 4 — Notifications & milestones

### Notifications table
New `public.notifications`:
- recipient_user_id, recipient_role (admin|coach)
- client_id (nullable), priority (normal|important|urgent)
- type (e.g. `lift_video_uploaded`, `bodyweight_goal_reached`, `urgent_lift_video`, `compliance_changed`)
- title, body, link_to
- read_at, created_at

`notification_preferences` table — per-user toggles for each event type. Sensible defaults on.

### Wiring
Notifications written from the same server fns that already perform the action:
- lift video insert → `lift_video_uploaded` (+ `urgent_lift_video` if `is_urgent`)
- message insert from client → `client_message`
- check-in submit, bodyweight log, goal set/changed/**reached**, progress metric → respective types
- agreement signed, payment success/failure
- compliance status transitions → `compliance_changed`
- Milestone detection (new bodyweight low/high during phase, goal reached) — added to the bodyweight save server fn.
- PR detection (rep PR, est-1RM PR) — added when admin/client logs a lift in progress metrics. **Note:** PR/rep/volume PRs require structured set-level logging which we don't currently capture beyond freeform `load_text`. I'll support bodyweight + manually-tagged "PR" entries first; full automatic strength PR detection needs a separate dedicated logging surface — flagging as a follow-up.

Routing: admin gets everything they've opted into; assigned coach gets a copy for their clients only.

### Surfaces
- Extend existing `NotificationBell` to read from `notifications` table (currently it has different content — I'll merge).
- Badges on Lift Video Review, Check-Ins, Messages, Agreements, Payments — based on unread counts per type.
- Mark-as-read on view; "mark all read" action.

### Settings
`/admin/settings` → notification preferences toggles (already a page, will add a section).

---

## Out of scope / follow-ups

- True real-time presence ("typing now" / websocket online indicator) — heartbeat gives "online now" within ~3 min which matches your "2–5 min" spec; skipping presence websockets.
- Automatic strength PR detection (set-level rep/load/1RM history) — needs a dedicated lifting log; flagged above.
- Push notifications to phone — current scope is in-app only.
- Email digests of compliance — can layer on later using the existing email sender.

---

## What I'd like to confirm before coding

1. **Ship order** — OK to ship phase by phase (each phase is independently useful), or do you want everything in one drop?
2. **Coach scope** — coaches see assigned clients only by default. OK?
3. **PR detection** — confirm the limitation above is acceptable for v1 (bodyweight milestones + manually flagged PRs only).
4. **Heartbeat cost** — every 3 min while a client has the app open writes one row to `clients`. Across your client count this is negligible, but it does mean `clients.updated_at` will tick frequently. OK, or do you want activity stored on a separate `client_presence` table to keep `clients.updated_at` stable?
