## Goal

Turn the Action Centre into an intelligent, automated coaching task system: recurring schedules, client-local time zones, plain-language due status, smart priority, in-place completion, and per-athlete overrides. Keep the current visual style — only functionality changes.

Because this is a large surface, I'll ship it in **four incremental phases**, each shippable on its own. Please confirm before I start Phase 1.

---

## Phase 1 — Data foundation & schedules

New tables (RLS, GRANTs, service_role) via one migration:

- `coach_task_definitions` — global/coach-owned defaults per task type (weekly_checkin, nutrition_review, progress_photos, bodyweight, technique_review, monthly_assessment, custom_form). Fields: `frequency` (weekly, biweekly, monthly, custom_days), `interval_days`, `due_day_of_week`, `due_time_local`, `tz_mode` (client|coach|fixed), `fixed_tz`, `reminder_offsets` (int[] days), `enabled`, `form_id?`.
- `client_task_overrides` — per-athlete overrides of the same fields, `client_id + task_type` unique.
- `client_task_occurrences` — generated instances: `client_id`, `task_type`, `title`, `due_at_utc`, `due_local_date`, `client_tz`, `status` (upcoming|due_soon|due_today|overdue|completed|skipped), `completed_at`, `source_definition_id`, `source_override_id`, `payload_ref` (form submission id / photo submission id / etc.), `reminder_state jsonb`.
- `client_time_zone` on `clients` (nullable text) with auto-update from client device on portal load (unless user disables in Settings).

Server functions (`src/lib/action-centre.functions.ts`):

- `listActionCentre({ clientId })` — returns prioritized, non-completed occurrences + status labels ("Due Today", "2 Days Overdue", etc.), computed in client tz.
- `completeTaskOccurrence({ occurrenceId, payloadRef? })` — marks completed and schedules next occurrence per definition/override.
- `generateNextOccurrence({ clientId, taskType })` — internal helper.
- `getEffectiveSchedule({ clientId, taskType })` — merges override → definition → hard-coded defaults.

Cron (pg_cron → `/api/public/hooks/action-centre-tick`):
- Every 15 min: transition upcoming → due_soon → due_today → overdue using each row's `due_at_utc` and current UTC; fire reminder push per `reminder_offsets`.
- Nightly: back-generate any missing next-occurrences (self-healing).

Defaults seeded in migration exactly as spec (weekly check-in Sat 11:59 PM client local, bodyweight daily w/ reminder after 3 days & overdue after 5, progress photos 4w, nutrition 2w, monthly assessment 4w, technique manual).

---

## Phase 2 — Client Action Centre UX

Update `src/components/portal/action-centre.tsx` + `src/routes/_authenticated/portal/index.tsx`:

- Consume `listActionCentre` instead of ad-hoc props (keep same card aesthetic).
- Plain-language status chip ("Due Today", "2 Days Overdue"…) with tone colors:
  🟢 completed, 🟡 due tomorrow, 🟠 due today, 🔴 overdue.
- Priority sort: overdue coach-requested > coach replies > coach feedback > due today > due tomorrow > upcoming.
- Completed rows disappear immediately (optimistic).
- Empty state: "✅ You're all caught up."
- Every row opens a **premium bottom sheet** (`ActionTaskSheet`) rendering task-specific inline UI:
  - Weekly / Nutrition / Custom form → embed the existing form flow.
  - Progress photos → existing uploader.
  - Bodyweight → inline number entry (already exists as card, wire same mutation).
  - Coach Feedback (renamed from Lift Reviews) → video + notes + reply + mark viewed, swipeable between reviews.
- Success animation → auto-close → row removed → next occurrence appears if scheduled.

Time-zone capture: on portal load, if `clients.time_zone` differs from `Intl.DateTimeFormat().resolvedOptions().timeZone` and auto-detect is on, persist quietly.

---

## Phase 3 — Admin scheduling UI

New admin surface `src/routes/_authenticated/admin/coaching/schedules.tsx`:

- Grid of task types with the dummy-proof form (Automatic Scheduling toggle, Frequency, Default Due Day, Default Due Time, Time Zone mode, Reminder Timing checkboxes).
- Copy: "Changes only affect future occurrences."

Per-athlete override panel inside existing client workspace (`clients.$id.tsx`) → new "Task Schedule" tab:
- Shows effective schedule per task type with an "Override" toggle → same form scoped to that client.
- "Reset to default" clears the override row.

Coach view-mode toggle (`viewTz`: client|coach) persisted in `admin_dashboard_prefs`; formats all admin due dates accordingly.

---

## Phase 4 — Coach Feedback rename & polish

- Rename all client-facing "Lift Review" strings to "Coach Feedback" (labels only; DB names unchanged).
- Coach Feedback sheet: title like "Coach reviewed your squat", video, notes, exercise chip, reply box, "Mark as viewed" button.
- Swipe/paginate between multiple unseen feedback items.
- Final QA: iPhone SE, iPhone Pro Max, iPad; safe-area insets; 44px tap targets; screen-reader labels for status chips.

---

## Technical section

- All date math uses `date-fns-tz` (`formatInTimeZone`, `zonedTimeToUtc`) — add dependency.
- Status labels computed server-side (single source of truth) and re-checked client-side for optimistic updates.
- `completeTaskOccurrence` is idempotent (unique `(client_id, task_type, due_local_date)` partial index on non-completed rows) so double-taps and cron re-runs are safe.
- Cron endpoint under `/api/public/hooks/action-centre-tick` uses `apikey` header (Supabase anon) per house rules.
- No changes to workout completion, messaging, or analytics tables — pure additive.

---

## What I will NOT touch

- Visual design of the Action Centre card, dashboard order, workout/analytics pages.
- Existing `messages`, `lift_videos`, `nf_forms`, `progress_*` schemas — the new occurrence rows *reference* them via `payload_ref`, not replace them.

---

Reply **"go phase 1"** to start with the migration + server functions, or tell me to reshape scope first.
