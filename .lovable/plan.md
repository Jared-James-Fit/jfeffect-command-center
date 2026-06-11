# Phase 6A — Smart Scheduling (Engine + Preview/Apply)

Scope: scheduling logic, admin preview UI, and apply flow only. No full calendar, no progress comparison. Client view reuses the existing scheduled-date display from Phase 4.

## What already exists (will be reused, not rebuilt)

- Client availability: `clients.available_training_days`, `committed_training_days`, `preferred_training_days`, `unavailable_training_days` (day-name arrays).
- Blocks: `pl_blocks.start_date`, `end_date`, `weeks`, `week_duration_days`.
- Workout days: `pl_days.scheduled_date`, `day_index`.
- Cardio: `cardio_targets.day_type` ("Training Day" | "Rest Day" | "High Day" | "General" | "Custom") and `frequency_per_week`.
- "Today's workout" already keys off `pl_days.scheduled_date` (`src/lib/workout-today.ts`).

## New schema (single migration)

Add to `pl_days`:
- `schedule_source text` — "auto" | "manual" (default "auto" when set, null otherwise).
- `schedule_locked boolean` — true after admin manually overrides; auto-rescheduler must not overwrite.

Add to `pl_blocks`:
- `last_scheduled_at timestamptz`.
- `last_scheduled_availability text[]` — snapshot of the availability array used at last generation (used to detect "availability changed").

No data migration. Existing rows behave as if never auto-scheduled. RLS is unchanged (columns added to tables that already have policies).

## Scheduling engine — `src/lib/auto-scheduler.ts`

Pure functions, then DB-touching wrappers. Inputs: block + weeks/days + client availability + cardio targets. Output: preview rows the UI renders.

```text
buildSchedulePreview(blockId) -> {
  rows: [
    { weekIndex, dayIndex, dayId, title,
      dateISO, weekday,                 // proposed placement
      dayType: "Training" | "Rest" | "High",
      cardio: [{ targetId, label, dayType }],
      manualOverride: boolean,          // existing schedule_locked=true
      warnings: string[]                // per-row
    },
  ],
  blockWarnings: string[],              // e.g. "3 available days, 4 workouts"
  availabilityUsed: string[],           // snapshot
}
```

Placement algorithm per week, in order:
1. Resolve weekday pool = `committed_training_days` ∪ `available_training_days` − `unavailable_training_days`. Fall back to `preferred_training_days` if first set is empty.
2. Anchor week to `pl_blocks.start_date` + (weekIndex × 7).
3. Walk workouts in `day_index` order. For each, take the next weekday from the pool; emit date for that weekday in the anchored week.
4. If a `pl_days` row has `schedule_locked = true`, keep its existing `scheduled_date` and skip the slot it occupies for that week.
5. After placement: schedule cardio onto the same dates.
   - Each active+visible `cardio_target`: assign on workout dates when `day_type = "Training Day"`, on non-workout dates in week when `day_type = "Rest Day"`, on `High Day` if a "high day" workout exists (`pl_days.focus ILIKE '%high%'` or future flag — for now, only attach if a workout in week has `focus` containing "high"), else attach to first available non-workout date. "General" cardio attaches to every day up to `frequency_per_week`.
6. Warnings:
   - workouts > available pool size → block-level warning.
   - locked day on a weekday no longer in availability → row warning.
   - cardio target with no eligible day for its type → block warning.

`applySchedule(blockId, preview)`:
- Wraps DB updates in `pl_days.update({ scheduled_date, schedule_source: "auto" })`, skipping rows where `schedule_locked = true`.
- Writes `pl_blocks.last_scheduled_at = now()`, `last_scheduled_availability = availabilityUsed`.
- Never touches `pl_day_completions`, `pl_row_results`, completion timestamps, or cardio target rows.

`markDayManual(dayId, date)`:
- Sets `pl_days.scheduled_date = date`, `schedule_source = "manual"`, `schedule_locked = true`.

`clearAutoSchedule(blockId, { keepManualOverrides: boolean })`:
- Nulls `scheduled_date` and resets `schedule_source` only for rows where `schedule_locked = false` (or always when `keepManualOverrides=false`).
- Nulls `pl_blocks.last_scheduled_at` / `last_scheduled_availability`.

`detectAvailabilityChange(blockId)`:
- Compare `clients.available_training_days` (and committed) to `pl_blocks.last_scheduled_availability`.
- Returns `{ changed: boolean, before, after }`.

Cardio placement reads `cardio_targets` filtered by `client_id`, `status = "Active"`, `visible_to_client = true`. Read-only; never updated by the scheduler.

## Admin UI — `src/components/auto-schedule-panel.tsx`

Renders inside the existing block editor route (`src/routes/_authenticated/admin/blocks.$blockId.tsx`), under the structure canvas / above warm-up panel.

States and quick actions (Part 9):
- Idle: shows last scheduled date (or "Not scheduled"), availability summary, and a yellow notice if `detectAvailabilityChange` returns changed.
  - Buttons: `Build Schedule From Availability`, `Preview Updated Schedule` (only when changed), `Edit Schedule Manually`, `Clear Auto Schedule`.
- Preview: opens a `Dialog` with a per-week table — columns: Day, Title, Date, Weekday, Day Type, Cardio, Override, Warnings.
  - Manual edits inline: a small date picker per row that flips the row to manual on change.
  - Buttons: `Apply Schedule`, `Cancel`, `Edit Manually` (closes preview and scrolls to per-day inline editor in the existing day list).
- Clear menu: `Clear Auto Schedule` opens a confirm dialog with checkbox `Keep manual overrides` (default checked).
- Each row with `schedule_locked` shows a `Manual Override` badge.

## Integration points

- New file `src/lib/auto-scheduler.ts` (pure logic + DB wrappers using `supabase` client; admin-only operations).
- New component `src/components/auto-schedule-panel.tsx`.
- Edit `src/routes/_authenticated/admin/blocks.$blockId.tsx` to mount the panel.
- Edit `src/integrations/supabase/types.ts` regenerated automatically after the migration.

## What stays untouched

- Workout flow, logs, completion records, and history (Phase 4).
- Warm-up resolver, cardio editor, nutrition targets.
- Client portal: still uses `pl_days.scheduled_date` it already reads. No new client UI in 6A.
- Group chat, messaging, billing, none of these are touched.

## Testing checklist (will be verified before reporting done)

- Build button appears in block editor.
- Preview reflects availability; reducing availability to 3 days for a 4-day program produces the expected warning.
- Apply writes `scheduled_date` and respects `schedule_locked`.
- Cardio rows align to day type (Training/Rest/High).
- Manual edit flips row to Manual Override badge and survives next preview build.
- Changing `clients.available_training_days` makes the notice appear; Preview Updated keeps locked days.
- `pl_day_completions` rowcount and timestamps unchanged across all flows.

## Out of scope (later phases)

- Full client calendar UI (Phase 6B).
- Progress comparison across blocks.
- Automatic per-week regeneration on availability save (admin must press Preview Updated).
- Push/email notifications when schedule changes.
