## Goal

Make time-based exercises simple end-to-end:
1. Coach: pick **Reps** or **Time**, enter a number, pick `sec` / `min`. Done.
2. Client: see the prescribed duration, tap it, countdown runs, one tap completes the set.

Seconds remain the single source of truth in the DB.

## What's already in place (reuse, don't rebuild)

- `pl_exercise_rows.measurement_type` + `duration_seconds`
- `pl_block_set_rows.duration_seconds` (per-set override)
- `pl_row_results.completed_duration_seconds`, `member_set_logs.completed_duration_seconds`
- `exercises.default_measurement_type`
- `src/lib/duration.ts` (`parseDurationInput`, `formatDuration`, `formatDurationShort`)
- Reps/Time toggle on the builder row (already redesigned as a subtle label)
- `CountdownTimerButton` (small inline timer in builder)

## What's wrong today

- Coach builder uses `parseDurationInput` against a freeform text field → coaches can type `1:30`, `1m 30s`, bare numbers that mean seconds, etc. Too many ways to be wrong.
- No `sec` / `min` unit selector — the spec wants exactly that.
- No per-set duration UI, no "apply to all sets".
- No completed-set persistence for time: `completed_duration_seconds` exists but `SetRow` never writes it.
- Client logger has no tap-to-start; it just reuses the rep input layout.
- No full-screen countdown sheet, no "Complete Set" flow, no finish-early handling, no add-time.
- Workout history doesn't surface completed vs prescribed time.

## Files to change

### Coach builder
- `src/lib/duration.ts` — keep parsers; add `secondsFromUnit(value, unit)` + `splitForUnit(seconds, unit)` (preserves value when switching units).
- `src/components/duration-input.tsx` *(new)* — controlled `Duration [ number ] [ sec ▼ / min ▼ ]` with numeric keypad, validation, decimals only in `min`, no zero, no negatives. Emits `seconds: number | null`.
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx`
  - Replace freeform duration cell with `<DurationInput>`.
  - Per-set duration: in the set-rows editor, add `<DurationInput>` for each set when `measurement_type === 'time'`, plus a small **"Apply to all sets"** button that pushes the row-level duration to every `pl_block_set_rows.duration_seconds`.
  - Default the row's `measurement_type` from `exercises.default_measurement_type` when an exercise is added (override is per-row only, never writes back to the library).

### Client logger
- `src/components/workout-timer-sheet.tsx` *(new)* — full-screen mobile sheet / desktop modal:
  - Header: exercise name, "Set N of M", prescribed duration.
  - Big `mm:ss` countdown driven by `endsAt` timestamp (background-safe).
  - Buttons: Start / Pause / Resume / Restart / Finish early / Close.
  - On reach-zero: vibration + soft beep + "Time complete" + **Complete Set** (primary), with secondary `+10s` / `+30s` / Redo.
  - Keeps screen awake via `navigator.wakeLock` when available; falls back gracefully.
  - Stopwatch toggle (small secondary control) for the count-up case.
  - Returns `{ completed_seconds, method: "countdown_timer" | "stopwatch" | "manual_entry", finished_early: boolean }`.
- `src/routes/_authenticated/portal/workouts.$dayId.tsx`
  - `SetRow`: when row is time-based, replace reps input with a large tappable **"45 sec"** chip → opens `WorkoutTimerSheet` for that set.
  - One-tap **Complete Set** path uses prescribed duration; secondary **"Edit actual time"** opens a small `<DurationInput>` (yes / edit / cancel pattern).
  - Persist `completed_duration_seconds`, `timer_started_at`, `timer_completed_at`, `completion_method` to `member_set_logs` (columns already exist for the duration; add the three timestamp/method columns — see migration).
  - Skip reps validation when `measurement_type === 'time'`; weight / RPE / RIR / notes stay optional and untouched.
- Rest timer (`active-rest-timer`) is **unchanged** and only fires after a set is marked complete, with its existing "Rest" label.

### Workout history / display
- `src/lib/workout-status.ts` (or wherever set summaries render) — when a set has `completed_duration_seconds`, show `"38 sec completed · 45 sec prescribed"`; when equal, show `"45 sec completed"`. Reuse `formatDuration` so client-facing strings never show `1.5 min` or `90 sec`.

### Tests
- `src/test/duration.test.ts` *(new)* — unit tests for `secondsFromUnit`, `splitForUnit`, `formatDuration` covering: `30 sec → 30`, `1 min → 60`, `1.5 min → 90`, round-trip `90 → 1.5 min / 30 sec`, decimals rejected for `sec`, zero / negative / NaN rejected, history string formatting.

## Database migrations

One new migration:
- `member_set_logs`: add `timer_started_at timestamptz`, `timer_completed_at timestamptz`, `completion_method text check (completion_method in ('countdown_timer','stopwatch','prescribed_quick_confirm','manual_entry'))` — all nullable so existing reps logs are unaffected.
- (`completed_duration_seconds` already exists from the prior migration.)
- No data backfill needed — every existing row defaults `measurement_type='reps'`, so reps logging is unchanged.

## Behavior guarantees (acceptance gates)

- Reps mode unchanged: rep ranges, weight, RPE, RIR, rest timer, supersets, autosave, duplication, assignment, competition styling, history — all preserved.
- `measurement_type` is per row; switching one row never mutates another.
- Unit switch preserves seconds: `90 sec ↔ 1.5 min` is non-destructive.
- Client never sees `1.5 min`; `formatDuration(90) === "1 min 30 sec"`.
- Per-set override stored on `pl_block_set_rows.duration_seconds`; null falls back to the row's `duration_seconds`.
- Timer remains accurate after lock/background because remaining is computed from `endsAt - now()`, not interval counts.
- Closing/reopening the sheet during an active countdown resumes the same `endsAt` (cached in `sessionStorage` keyed by `completionId:setIndex`).
- Offline: completion writes go through the existing `workout-offline-queue` so the durable record + sync semantics already in place catch the new fields; queue key already prevents dupes.

## Out of scope (intentionally)

- No alert-type config, no timer templates, no per-program timer settings.
- No changes to rest-timer behavior beyond labeling.
- No edit to the exercise-library admin UI in this pass (the default field is already on the table; we'll respect it on insert and add a small toggle later if needed).

## Completion report (will deliver at the end)

Files changed, migration added, coach input demo, client timer demo (countdown + stopwatch), quick-confirm vs edit-actual flows, finish-early flow, rest-timer separation note, background-accuracy note, offline-queue note, history string examples, regression check across reps-only rows, and mobile / iPad / desktop layout check.
