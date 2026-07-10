
## Goal

Split the current combined `pl_days.title` (which today mixes "Day 1", weekday, date, and coach notes like "Final Heavy") into three clearly separated pieces of information, consistently across builder, weekly, and client views:

1. **Day label** — derived from ordering, never stored as text.
2. **Workout subtitle** — optional coach label (e.g. "Final Heavy").
3. **Training date** — prominent, human-readable date card with picker.

## Data model decision

Current `pl_days` columns of interest:
- `day_index` (number) → source of truth for "Day N"
- `title` (nullable text) → currently overloaded
- `focus` (nullable text) → short focus tag (e.g. "Squat", "Upper"), semantically different from a per-workout subtitle
- `notes` (nullable text) → long-form coach notes
- `scheduled_date` (nullable date)

`focus` is already used elsewhere as a small tag next to the day (see `ScheduleWorkoutSheet`, `MissedWorkoutCard`) and is not the "Final Heavy" concept. `notes` is long-form. Neither cleanly matches "workout subtitle".

**Decision:** add a new nullable column `pl_days.subtitle text`. Keep `title` for backward compatibility but stop writing generated date/day text into it — new writes leave it null and reads treat any legacy content as fallback.

## Migration

Single SQL migration:
1. `ALTER TABLE pl_days ADD COLUMN subtitle text` (nullable, no default).
2. Backfill via safe parser on existing `title`:
   - Strip a leading `Day\s*\d+` token.
   - Strip a weekday word (`Mon…Sun` / full names) and any following date token (`Aug 31`, `August 31, 2026`, `2026-08-31`, ISO, etc.).
   - Strip separators (`—`, `–`, `-`, `·`, `|`).
   - Whatever non-empty coach text remains → `subtitle` (only if `subtitle` is currently NULL).
   - If the remainder is empty or the whole title matches only "Day N" / date pattern → set `title = NULL`.
   - If parsing is ambiguous (unknown extra tokens) → leave `title` untouched and do not populate `subtitle`; those rows are logged into a temporary `pl_days_title_migration_log` table for review.

Migration is idempotent and touches only rows where `subtitle IS NULL`.

## Types / server

- Regenerated Supabase types will surface `subtitle`.
- Any server function that writes `title` today (create day, duplicate day, copy week, program templates) is updated to write `subtitle` instead when the value is coach-specific and to leave `title` alone.
- Reordering already updates `day_index`; no change needed — the visible label is derived.

## UI: builder (coach)

`WorkoutDayView.tsx` and related builder rows:
- Header block, in order:
  1. `DAY {day_index}` — bold, primary heading, always derived.
  2. `{subtitle}` — smaller, only rendered when non-empty; input placeholder `Optional — e.g. Final Heavy or Technique Day`, label `Workout subtitle`. Autosaves using the existing autosave pattern.
  3. Training date card — full-width tap target ≥44px, calendar icon, `TRAINING DATE` eyebrow, weekday on one line, full readable date on the next; clicking anywhere opens the existing date popover. When `scheduled_date` is null, renders `Unscheduled` with a "Set date" affordance. A small "Clear" action is available when clearing is currently permitted by existing guards.
  4. Existing focus / notes / duration below.
- Collapsed day cards (Full Block, Weekly): show `Day N`, subtitle on a second line only if present, and the readable date on a third line. No blank subtitle space when empty.

## UI: client / member

`WorkoutDayView` client-facing header, `week-schedule-view`, `MemberBlockWeekColumns`, `MemberPlanCalendar`:
- Same three-line structure, shorter date format on narrow widths (`Mon, Aug 31`).
- No merged heading, no ISO date shown as primary.

## Views audited and updated

Builder / coach:
- `src/components/workout-day/WorkoutDayView.tsx` (main header, full-screen header, exercise sheet subtitles)
- `src/components/schedule/WeeklyScheduleEditor.tsx`
- `src/components/schedule/ScheduleCalendar.tsx`
- `src/components/schedule/ScheduleWorkoutSheet.tsx`
- `src/components/schedule/MissedWorkoutCard.tsx`
- `src/components/schedule/MoveWorkoutSheet.tsx`
- `src/components/schedule/BulkMoveDialog.tsx`
- `src/components/schedule/ScheduleHistoryDrawer.tsx`
- `src/components/program-planner/ProgramAssignmentPlanner.tsx` (preview list)
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` (Full Block view)

Member / client:
- `src/components/member/member-block-week-columns.tsx`
- `src/components/member/member-plan-calendar.tsx`
- `src/routes/_authenticated/m/my-plans.$enrollmentId.tsx` (next-workout card)
- `src/routes/_authenticated/portal/workouts.$dayId.tsx` (opens `WorkoutDayView`, inherits new header)

Shared helper:
- Introduce `src/lib/workout-day-label.ts` exporting `formatDayLabel({ dayIndex })`, `formatSubtitle(day)`, `formatTrainingDate(dateISO, { long | short })`, and a `parseLegacyTitle(title)` fallback used only for reads on rows the migration could not safely clean up.

## Scheduling guardrails

- No change to `pl_scheduled_workouts`, completion writes, client rescheduled instances, or program copy semantics.
- The date card writes `pl_days.scheduled_date` exactly like the current small input — it is a display swap, not a write-path change.
- When the row already backs completed logs or client-rescheduled instances, existing `schedule_locked` / mutation guards continue to apply; the date card respects them (disabled state with tooltip).
- Confirm builder date represents source-program date vs scheduled instance in-context per the current call site (client adapter passes instance id when applicable) — no cross-write.

## Reporting

At the end I will report: field decision, backfill result counts (rows updated, rows left for manual review), how Day numbers are computed, views updated, guardrail verification, typecheck + build results, files changed.

## Sequencing

1. Migration (adds `subtitle`, backfills, log table). Stops for approval.
2. After types regenerate: shared helper + builder header + collapsed card refactor.
3. Weekly, schedule, planner, client/member views.
4. Typecheck, build, brief live smoke test on one block.

## Out of scope

- Changing scheduling / completion write logic.
- PDF export format (only reused if it already renders the same header component; otherwise deferred).
- Redesigning `focus`/`notes` fields.
