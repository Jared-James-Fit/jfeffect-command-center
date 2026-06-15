
# Nutrition Plan Due + Update Tracking

End-to-end nutrition update system: client submits, coach reviews and publishes, dashboard surfaces who's due/overdue/submitted, automation drives reminders and due-date recalculation.

Builds on existing `nutrition_targets` / `nutrition_target_days` tables — does NOT replace them. Adds cadence, submissions, review tasks, and notifications.

---

## 1. Database (one migration, additive)

### Extend `nutrition_targets`
Add columns (nullable, safe defaults):
- `cadence` text — `weekly | biweekly | monthly | custom | manual | paused`
- `cadence_interval_days` int — used when `cadence='custom'`
- `last_updated_date` date
- `next_due_date` date
- `status` text — `up_to_date | due_soon | due_today | overdue | submitted | under_review | published | paused | not_needed`
- `phase` text — `cut | bulk | maintenance | performance | lifestyle`
- `goal_direction` text
- `paused_at`, `paused_reason`
- `assigned_coach_id` uuid

### New table `nutrition_update_submissions`
- `id`, `client_id`, `submitted_at`, `status` (`submitted | under_review | published | dismissed`)
- Body: `current_bodyweight_kg`, `avg_bodyweight_kg`, `compliance_pct`, `hunger_rating` (1-5), `energy_rating`, `digestion_rating`, `sleep_rating`, `training_performance_rating`, `steps_completed`, `cardio_completed`, `missed_meals` text, `notes` text, `goal_direction`, `progress_photo_urls` text[]
- Snapshot: `previous_targets_json` jsonb
- Review: `reviewed_by`, `reviewed_at`, `published_at`, `coach_note`, `published_targets_json`
- Prevents spam: partial unique index on `(client_id)` where `status in ('submitted','under_review')` — one open submission at a time unless coach allows resubmit (`allow_resubmit boolean`).

### New table `nutrition_review_tasks`
- `id`, `submission_id`, `client_id`, `assigned_coach_id`, `created_at`, `due_at`, `completed_at`, `status` (`open | done | snoozed`)

### New table `nutrition_automation_settings` (single row per workspace)
- `default_cadence`, `reminder_lead_days` (default 2), `overdue_reminder_days` (default 1)
- `client_reminders_enabled`, `coach_reminders_enabled`
- `sms_enabled`, `email_enabled`, `push_enabled`
- `coach_review_sla_hours` (default 24)

### New table `nutrition_notification_log`
- channel, recipient, kind (`client_due_soon | client_due | client_overdue | coach_submitted | coach_review_sla`), sent_at, status, related ids

### SQL helpers
- `fn_recompute_nutrition_status(client_id)` — sets status based on `next_due_date` vs today and submission state.
- `fn_apply_nutrition_cadence(client_id)` — sets `next_due_date = last_updated_date + interval`.
- Daily `pg_cron` job calls a TanStack public hook `/api/public/hooks/nutrition-tick` which: (a) recomputes statuses, (b) sends due/overdue notifications, (c) flags coach SLA breaches.

All tables: GRANTs to `authenticated` + `service_role`, RLS scoped via `has_role()` for coach/admin, and `client_id = (select id from clients where auth_user_id = auth.uid())` for own-client reads.

---

## 2. Server functions (`src/lib/nutrition-updates/*.functions.ts`)

Client-facing:
- `getMyNutritionStatusFn` — current targets, status, last/next dates, cadence.
- `submitNutritionUpdateFn` — validates no open submission, inserts row, creates `nutrition_review_tasks`, sets status `submitted`, fires coach notification.

Coach/admin:
- `listNutritionDashboardFn({ filter, search })` — joined view (client + targets + open submission + coach).
- `getSubmissionDetailFn(submissionId)` — submission + previous targets + last 5 weight points.
- `publishNutritionReviewFn` — writes new targets, snapshots into submission, sets `status='published'`, computes `next_due_date`, notifies client.
- `pushDueDateFn`, `markNotNeededFn`, `pauseTrackingFn`, `resumeTrackingFn`, `changeCadenceFn`, `allowResubmitFn`.

All coach fns: `requireSupabaseAuth` + `has_role('coach'|'admin')`.

---

## 3. UI

### Client side — `/_authenticated/nutrition` (or extend existing tab)
- Large status card with color-coded badge (up_to_date green, due_soon amber, overdue red, submitted blue, updated purple).
- Targets grid: calories, P/C/F, cardio, steps, training/rest/high-day variants.
- Last updated + next due dates, cadence chip.
- `Submit Nutrition Update` CTA → drawer/modal form with all listed fields, photo upload (Supabase storage `progress-photos` bucket), zod validation.
- After submit → status flips to "Submitted — waiting for coach". CTA disabled until coach allows resubmit.
- When coach publishes → banner "Review your new plan" with diff vs previous.

### Coach Dashboard — `/_authenticated/admin/nutrition-dashboard`
- Top filters: All / Overdue / Due today / Submitted / Due this week / Up to date / Paused.
- Sort default per spec (overdue → due today → submitted → this week → up to date → paused).
- Table + mobile card view. Each row: name, goal, phase, current cals/macros, cardio target, last update, next due, cadence, status badge, coach.
- Row actions menu: Review Update, Update Nutrition Plan, Push Due Date (+1d/+3d/+7d/custom), Mark Not Needed, Pause Tracking, Change Cadence, Allow Resubmit.

### Review screen — `/_authenticated/admin/nutrition-dashboard/review/$submissionId`
Three panels:
1. Previous targets + weight trend sparkline (from `progress_metrics`).
2. Client submission (all fields, photos).
3. Coach decision panel with quick-adjust buttons (+/- 100 cal, etc.) and full editable target fields (cals, P/C/F, cardio, steps, training/rest/high day variants), coach note, **Publish Nutrition Update**.

### Admin Settings — `/_authenticated/admin/settings/nutrition-automation`
Form bound to `nutrition_automation_settings`: cadence default, reminder timings, channel toggles, coach SLA hours.

---

## 4. Reminders & automation

- `pg_cron` daily 08:00 UTC → POST `/api/public/hooks/nutrition-tick` (apikey header).
- Hook handler runs `fn_recompute_nutrition_status` for all active clients, then queries who needs which reminder.
- Reuses existing SMS (`sms.functions.ts`) and email (`email_send_log`) plumbing. Falls back to in-app notifications via existing `messages` / notification system already in project.
- Coach SLA: when submission age > `coach_review_sla_hours` and status still `submitted` → log + ping coach.

---

## 5. Tests

- Unit: status computation matrix (date vs cadence), cadence next-due math, anti-spam guard.
- Integration: submit → task created → publish → status flip → next_due_date recomputed.

---

## 6. Out of scope (call out, don't build)
- AI macro recommendations (button stub only).
- Multi-coach round-robin assignment beyond `assigned_coach_id`.
- Historical migration of legacy `nutrition_targets` rows — they'll show `status=up_to_date` with `cadence=manual` until coach sets it.

---

## Rollout order
1. Migration (tables, GRANTs, RLS, functions).
2. Server fns + nutrition tick hook + cron job.
3. Coach Dashboard + Review screen.
4. Client Nutrition tab update + submission form.
5. Admin Settings page.
6. Tests + QA.
