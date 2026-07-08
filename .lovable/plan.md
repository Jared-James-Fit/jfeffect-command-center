
## Goal

Add a thin scheduling layer over the existing workout system so coaches can manually place any assigned workout onto any date, multiple workouts can live on the same date, and clients can move their scheduled workouts (with permission controls). Reuse `pl_blocks / pl_weeks / pl_days / pl_exercise_rows / pl_day_completions` — do not duplicate programs, exercises, or completions.

## What's already in place (reuse as-is)

- `pl_days.scheduled_date`, `schedule_source` (`auto`|`manual`), `schedule_locked` — move flow already writes these.
- `MoveWorkoutSheet` — single-workout move with same-day conflict + swap.
- `moveWorkout`, `swapWorkouts`, `undoScheduleChange`, `getMoveContext` server fns in `schedule-manager.functions.ts`.
- Calendar + selected-day list already renders multiple workouts per date (just fixed).
- Client impersonation for "Admin Client POV".

## Backend changes (one migration)

### 1. New table `pl_scheduled_workouts` (the scheduling layer)

Non-destructive additive record. Each row is one instance of a workout on a date.

```
id                  uuid pk
client_id           uuid → clients.id
source_day_id       uuid → pl_days.id       -- the prescription (block/week/day + rows)
scheduled_date      date
scheduled_time      time null               -- optional
order_index         int  default 0          -- ordering when 2+ share a date
schedule_source     text default 'manual'   -- 'program' | 'manual' | 'moved' | 'copied'
created_by          uuid → auth.users null
original_date       date null               -- first scheduled_date, kept when moved
note                text null
created_at / updated_at
UNIQUE(client_id, source_day_id, scheduled_date, order_index)  -- prevents dup submits
```

RLS: authenticated read/write scoped to `client_id = auth.uid()`'s own client OR admin/coach via existing `has_role`.

### 2. Backfill

One-time INSERT selecting every `pl_days` row that already has `scheduled_date` (the current program-derived schedule) as `schedule_source='program'`. Then existing calendar/workout queries can keep working during rollout because we also keep reading `pl_days.scheduled_date` — see rollout.

### 3. New table `client_schedule_permissions` (or column)

Simplest: add column `clients.workout_scheduling_permission text default 'move'` with allowed values `off | move | add_current_block | full_program`.

### 4. Extend `moveWorkout` server fn (minimum change)

- Continue to update `pl_days.scheduled_date` for program instances (single-instance case) so nothing breaks.
- When the target row is a manual instance, update `pl_scheduled_workouts` instead.
- Enforce `workout_scheduling_permission` when caller is the client.

### 5. New server fns in `schedule-manager.functions.ts`

- `scheduleWorkouts({ clientId, sourceDayIds[], date, time?, orderIndex? })` — coach/admin only; inserts N `pl_scheduled_workouts` rows in a single transaction. Rejects duplicates.
- `removeScheduledWorkout({ instanceId })` — coach/admin; only removes the manual instance, never the source day.
- `reorderScheduledWorkouts({ date, clientId, orderedInstanceIds[] })` — updates `order_index`.
- `updateScheduledTime({ instanceId, time })`.
- `copyScheduledWorkout({ instanceId, newDate })` — coach/admin.

All: middleware `requireSupabaseAuth`, permission-gated for client callers.

## Frontend changes

### 6. Calendar data source (`src/lib/calendar-sources.ts`, `WorkoutsExperience.tsx`)

- Fetch **both** program-derived days (existing query) **and** `pl_scheduled_workouts` for the client.
- Merge into the same `WorkoutItem` shape keyed by date. Each manual instance carries `instanceId` and resolves `day/week/block` via `source_day_id`.
- Sort within a date by `order_index` then created_at.
- Cardio/nutrition day resolver already handles multi-workout dates — no change.

### 7. `+ Schedule Workout` action (single new UI, reused everywhere)

New component `ScheduleWorkoutSheet.tsx` (bottom sheet, mobile-first):

Step 1 — Date (default: currently selected calendar date)
Step 2 — Program (assigned to client only)
Step 3 — Block (Active first, then other blocks in active program, then other assigned programs, then archived for admin only)
Step 4 — Workouts (multi-select, searchable, shows day title + est duration)
Step 5 — Optional time + order
Step 6 — Confirm with preview: "Friday · adds 2 workouts. Currently scheduled: Upper Body Day. Will be added as Workout 2, 3."

Entry points (reuse, no new pages):
- `WorkoutsExperience` header action row.
- Coach schedule manager toolbar.
- Admin messages thread quick-actions dropdown (open sheet pre-scoped to that client).

### 8. Client "Move Workout" action

- On any incomplete scheduled workout in `SelectedDayCard`, show only: **Start / Resume**, **Move Workout**, **Change Time or Order**. Hide Add/Copy/Replace/Remove.
- `MoveWorkoutSheet` gets a permission check: if `workout_scheduling_permission='off'`, show read-only message.
- Same-day landing dialog:
  ```
  Friday already has 1 workout.
  ○ Add this as Workout 2
  ○ Move Friday's workout to Saturday
  ○ Choose another date
  ```

### 9. Coach/admin "More" menu on a workout card

Extend the existing `DropdownMenu` on `SelectedDayCard` (coach mode) with: Add workout on this date, Copy to another date, Replace with…, Remove scheduled workout (only for manual instances), Change time, Change order.

### 10. Messages quick action

In the admin thread header/quick actions menu, add "Schedule Workout" — opens the same `ScheduleWorkoutSheet` with `clientId` prefilled. No new mutations.

## Permissions matrix (enforced in server fns)

| Permission | Move own | Add from current block | Add from any assigned program | Copy | Remove | Replace |
|---|---|---|---|---|---|---|
| off | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| move (default) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| add_current_block | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| full_program | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| coach/admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Remove/Replace are coach/admin only in every tier per spec.

## Safety invariants

- Manual scheduling never mutates `pl_days` rows other than `scheduled_date`/`order_index` on the specific instance.
- `pl_day_completions` and `pl_row_results` are never touched by scheduling operations.
- A completed instance's `source_day_id` stays locked; copies create a new instance with the same `source_day_id`, no completion copied.
- Move/add operations never advance `pl_blocks.status` or `pl_weeks`.

## Rollout order

1. Migration (table + column + backfill of existing `pl_days.scheduled_date` into `pl_scheduled_workouts` as `schedule_source='program'`).
2. Server fns (schedule/remove/reorder/copy) + extend `moveWorkout` permission check.
3. Update calendar merge in `calendar-sources.ts` / `WorkoutsExperience.tsx`.
4. Build `ScheduleWorkoutSheet` + wire into Workouts header, schedule manager, messages menu.
5. Restrict client `SelectedDayCard` menu based on permission.
6. Tests: multi-instance render, conflict handling, permission gating, completion preservation.

## Out of scope

- No redesign of calendar/week strip/month grid.
- No changes to `pl_row_results`, `pl_day_completions`, workout player, program assignment logic, or block progression.
- No new cardio/nutrition wiring — existing resolver already reads scheduled dates.

## Open question

Should the "add from current block" tier be enabled per-client from the client detail page, or globally off with per-client override? Spec implies per-client with `move` as the default; I'll add a select on the client profile.
