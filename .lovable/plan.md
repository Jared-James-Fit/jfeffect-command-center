
# Training Schedule Manager — Phased Plan

This is a large feature (~3–5 phases). Each phase below is independently shippable and tested before the next starts. I want your go-ahead on **the scope and phase order** before I begin — and confirmation on a few decisions in the "Open Questions" section at the bottom.

## Architectural foundation (all phases respect this)

The schema already separates structure from schedule:
- **Program structure** lives in `pl_blocks → pl_weeks → pl_days → pl_exercise_rows`. These never change during a reschedule.
- **Calendar date** is `pl_days.scheduled_date` (date) + `pl_days.schedule_source` (`auto` | `manual` | `coach`) + `pl_days.schedule_locked`.
- **Completion** is a separate row in `pl_day_completions` (with `completed_at`, `started_at`). Logs live in `pl_row_results` / `member_set_logs` and are keyed by `day_id`, not by date — so moving a date never touches logs.

Every move in this feature is a single `UPDATE pl_days SET scheduled_date=$new, schedule_source='manual' WHERE id=$dayId`. Bulk moves are wrapped in a server-fn transaction; on any failure none are persisted.

Templates in `pl_templates` are never touched by the schedule manager. The current `auto-scheduler.ts` writes to client-instance `pl_days` only — confirmed safe.

## Phase 1 — Core single-workout move (the 80% case)

Goal: every user can tap any workout and move it to a new date, with conflicts handled, undo, and history.

1. **DB migration**
   - `pl_schedule_audit` table: `id, day_id, client_id, previous_date, new_date, previous_source, new_source, scope ('single'|'week'|'pattern'|'block'|'program'|'custom'), changed_by, changed_by_role, batch_id (uuid, groups bulk changes), created_at`.
   - RLS: clients can SELECT their own rows; coaches/admins SELECT all for assigned clients; INSERT via server fn only.

2. **Server functions** in `src/lib/schedule-manager.functions.ts`:
   - `moveWorkout({ dayId, newDate, allowConflict, conflictResolution })` — single move, returns `{ conflicts, applied, batchId }`.
   - `undoScheduleChange({ batchId })` — reverses every row in a batch back to its `previous_date`.
   - `getScheduleHistory({ clientId, limit })` — paginated audit log.
   - All gated by `requireSupabaseAuth`; coach/admin access via existing `has_role` + client-coach link check.

3. **UI — "Manage Schedule" entry points**
   - Add a primary `<Button>` on the Workouts page header, Block View toolbar, Calendar/Week view, and the upcoming-workout card.
   - Add "Move workout" to the existing workout card overflow menu and to the workout-detail page (`/portal/workouts/$dayId`).

4. **Move sheet** (`<MoveWorkoutSheet>` — mobile bottom sheet / desktop dialog)
   - Current date, calendar picker, "Today" / "Tomorrow" quick chips, suggested nearby training days from `pl_weeks.training_days`.
   - Conflict preview line ("You already have Upper Body scheduled here — Keep both / Swap / Pick another day").
   - Completed/in-progress warning copy as specified.
   - Confirm → optimistic update → success toast with **Undo** button (5s) → server invalidates queries.

5. **Conflict resolution**
   - Pure helper `detectConflicts({ targetDate, dayId, blockId })` returning `{ sameDayWorkouts, appointments, adjacentFatigue, pastDate, sequenceBreak }`.
   - "Swap" performs a two-row UPDATE in one transaction.

6. **History tab**
   - New `<ScheduleHistoryDrawer>` reachable from Manage Schedule. Read-only for clients (their own changes), full audit for coach/admin.

**Acceptance for phase 1:** tap-to-move works on mobile + desktop, swap works, completed workouts show the warning copy, undo restores, logs and template untouched.

## Phase 2 — Calendar surface + drag & drop

1. **New route** `/_authenticated/portal/schedule` (client) and `/_authenticated/clients/$clientId/schedule` (coach/admin) — same component, different data source.
2. **`<ScheduleCalendar>`** with Month / Week / List tabs (default Month on desktop, List on mobile).
   - Cell shows: workout name, "Block N · Week N · Day N", status badge (Not started / In progress / Completed / Rescheduled / Overdue) with icon + text (not color-only).
   - Today button, prev/next month, current-block indicator banner.
3. **Drag & drop** with `@dnd-kit` (lighter than react-dnd, mobile-friendly):
   - Long-press to initiate on mobile; pointer drag on desktop.
   - Auto-scroll near edges, visible drop ghost, "Cancel" zone at the bottom of the sheet.
   - On drop: opens the same `<MoveWorkoutSheet>` pre-filled with the target date so the user still confirms — no silent moves.
4. **Status sources**
   - "Overdue" = `scheduled_date < today AND no completion`.
   - "Rescheduled" = `schedule_source = 'manual'` (badge only, not blocking).

**Acceptance for phase 2:** drag works on iOS Safari, Android Chrome, iPad, desktop; calendar reflects status correctly; all moves still go through the confirmation sheet.

## Phase 3 — Scope picker & bulk preview

1. **Scope step** added to the move flow when the user picks a new date:
   - "This workout only" *(default, pre-selected)*
   - "This week"
   - "This workout + future matching Day N" (e.g. all future Day 2s)
   - "All remaining weeks in this block"
   - "All remaining program weeks"
   - "Choose specific weeks/workouts" (opens Advanced Selection)

2. **Preview screen** (`<BulkMovePreview>`):
   - Table of `original → new` rows grouped by week, with names + block/week/day labels.
   - Conflict column inline, total count at top, Confirm / Back buttons.

3. **Server fn** `applyBulkScheduleChange({ moves[], scope, allowConflicts })`:
   - One transaction. Updates `pl_days.scheduled_date` for every selected row, inserts one audit row per change sharing a `batch_id`.
   - On any error: rollback, return per-row diagnostics to the UI, keep the user's selection.
   - Idempotent: re-running with the same payload is a no-op (skips rows already at target date).

4. **Undo** — `undoScheduleChange({ batchId })` works for the whole batch.

5. **Notifications & cache**
   - `router.invalidate()` + `queryClient.invalidateQueries({ predicate: ... })` on schedule-related keys.
   - Existing reminder hook (`appointment_reminders` is unrelated; workout reminders are derived from `scheduled_date` so they auto-refresh — confirmed).
   - Coach notification: one summary row in `support_alerts` ("X changed 6 dates in Block 2") on bulk; suppressed for single one-day moves unless coach opted in.

**Acceptance for phase 3:** every bulk option produces an accurate preview, transactional save, single undo, single coach notification per batch.

## Phase 4 — Quick Weekly Schedule Editor + Advanced Selection

1. **`<WeeklyScheduleEditor>`** — large day buttons Mon–Sun with cards showing each workout slot; drag a workout card from one weekday to another, or use the "I train N days per week" simple selector with N dropdowns mapping Workout 1..N → weekday.
2. **Apply scope**: This week / Next week / Selected weeks / Remaining weeks in block / All future program weeks / Custom date range — with affected-date summary under each ("June 22 – July 13 · 12 workouts will move").
3. **`<AdvancedSelection>`** sheet (hidden by default, behind toggle):
   - Filters by block / week / day-of-week / individual workouts, with Select All / Clear All / Select remaining / "Select this block" / weekday quick picks.
   - Live "8 workouts selected" counter feeding into the same `<BulkMovePreview>` and `applyBulkScheduleChange`.
4. **Sequence-break warning** ("This puts Day 3 before Day 2") with "Move only this", "Shift following workouts by same N days" (opt-in), Cancel.

**Acceptance for phase 4:** weekly editor reuses the same preview + transaction; advanced selection counts correctly; shift-following is opt-in.

## Phase 5 — Coach/admin overrides + missed-workout actions

1. **Coach/admin view** at `/clients/$clientId/schedule` — same UI with extra controls:
   - Override completed-workout date (requires explicit "I understand this rewrites history" confirmation; logged with `scope='completed-override'`).
   - Lock schedule editing per client (`clients.schedule_locked` boolean — new column, defaults false).
   - "Reset to coach plan" — re-runs existing `auto-scheduler.ts` for selected weeks.
2. **Missed-workout card** on the portal home for any overdue not-started workout: Do It Today / Move to Another Day / Skip / Ask Coach (uses existing message thread).

**Acceptance for phase 5:** override path requires explicit confirm; client lock blocks the client's UI with explanatory message; missed-workout shortcuts work.

## Files to add / change (rough inventory)

```text
supabase/migrations/<ts>_schedule_manager.sql         (new) audit table, schedule_locked col
src/lib/schedule-manager.functions.ts                 (new) move/bulk/undo/history server fns
src/lib/schedule-conflicts.ts                         (new) pure conflict detection
src/components/schedule/MoveWorkoutSheet.tsx          (new) phase 1
src/components/schedule/ScheduleHistoryDrawer.tsx     (new) phase 1
src/components/schedule/ScheduleCalendar.tsx          (new) phase 2
src/components/schedule/ScheduleCalendarDnd.tsx       (new) phase 2
src/components/schedule/ScopePicker.tsx               (new) phase 3
src/components/schedule/BulkMovePreview.tsx           (new) phase 3
src/components/schedule/WeeklyScheduleEditor.tsx      (new) phase 4
src/components/schedule/AdvancedSelection.tsx         (new) phase 4
src/components/schedule/CoachOverridePanel.tsx        (new) phase 5
src/routes/_authenticated/portal/schedule.tsx         (new) phase 2
src/routes/_authenticated/clients.$clientId.schedule.tsx (new) phase 5
src/components/workout-list-card.tsx                  (edit) add Move entry
src/components/client-block-view.tsx                  (edit) add Manage Schedule button
src/routes/_authenticated/portal/workouts.$dayId.tsx  (edit) add Move button
src/routes/_authenticated/portal/workouts.index.tsx   (edit) Manage Schedule entry
src/components/smart-today-card.tsx                   (edit) Move quick-action
```

## Open questions (please answer before I start)

1. **Phase order** — Phase 1 (core single move with undo + history) is the most useful first ship. Do you want me to start there, or skip straight to Phase 2 (calendar + drag-drop)?
2. **Drag-drop library** — OK to add `@dnd-kit/core` + `@dnd-kit/sortable` (~30kb gz, the standard modern choice, mobile-friendly)?
3. **Member portal** — do members (the `/m/...` workout flow on `member_plan_enrollments`) need the same scheduler in this round, or coaching clients only first? (Members use a different schema path, so it's a separate ~1 phase of work.)
4. **Coach notifications channel** — OK to write summary entries into the existing `support_alerts` table, or do you want a dedicated `schedule_change_notifications` table?
5. **Completed-workout move policy for clients** — confirm: clients see the warning copy and **can** proceed, but the move is logged as `scope='single'` with `completed_at` left untouched (only the scheduled date moves). Coach override is the only path that edits `completed_at`. Correct?

Once you confirm I'll start Phase 1 immediately.
