# Client Training Program Hub + Program Editor Clarity

Goal: one simple "Training Program" section per client (Trainerize-style) and
an accurate, non-confusing program editor. Purely additive — no routes,
dialogs, or storage keys removed.

## A. Training Program hub (admin client profile → Training tab)
- New `src/components/clients/training-program-hub.tsx`, pinned to the top of
  the Training tab.
- "Current Program" card: prep/block name, Active block + week X of Y, started
  date, next scheduled workout, missing-dates warning chip.
- Primary actions: Open Program, Edit Program, View Schedule.
- "Schedule" card: scheduled count, missing dates, next workout, Manage/Fix
  Schedule + Schedule Workout.
- Empty state: Create Program / Assign Existing Program.
- Secondary "Program tools" row: Program History, Workout Archive, Download
  Training Report.

## B. Canonical block status (fixes misleading "Active" pills)
- New `src/lib/block-status.ts`: `deriveBlockStatuses()` derives exactly one
  Active block from dates + sort_order (stored `status` used only as a
  tiebreak); others become Upcoming / Draft / Completed / Archived.
- Block editor header strip: "Current active block: X · Editing block: Y
  (status)" + an amber safety note when editing a non-active block.
- `block-switcher.tsx` pills: current block shows "Editing", others show the
  derived status badge; pills with no dates get a warning icon; title shows
  the date range.

## C. Basic vs Advanced editor layout
- Full-block week header now shows: Week chip · day/row/est stats · phase chip
  (if set) · duplicate · delete.
- "Advanced" per-week toggle reveals: phase/label select, week notes, copy to
  future weeks, weekly volume summary.
- Day header: Focus input and copy-day-to-future moved behind a per-day
  "Day options" toggle; saved focus values stay visible.
- Clearer placeholders ("Week notes (optional) — coach reference only",
  "No phase label", "Focus (optional) — e.g. Squat, Upper").

## D. Quick actions cleanup
- Client row dropdown: "Training Program" group = Open/Edit Program + View
  Schedule; everything else under "Program Tools".

## Technical details
- All hub actions reuse existing routes/dialogs (AssignProgramDialog,
  WorkoutArchiveDialog, ScheduleWorkoutSheet, download report util).
- Status derivation is client-side only; no DB writes.

## E. Editor ↔ schedule ↔ calendar sync fix
Root cause: the calendar/Schedule Manager treat `pl_scheduled_workouts`
instances as canonical (`pl_days.scheduled_date` is only a legacy fallback
for days with no instance), but the program editor's Training Date wrote
ONLY the legacy field — so editor edits were invisible on the calendar and
calendar moves were invisible in the editor.

- `src/lib/program-schedule-status.ts`: canonical per-day resolver
  (On Calendar / Missing Date / Calendar Issue / Completed / In Progress).
  Instance date always wins; "Calendar Issue" = legacy mirror disagrees with
  the canonical instance date.
- `syncProgramDaySchedule` server fn: the editor's Training Date write path.
  Instance-first update (or delete-incomplete-instances when clearing) +
  legacy mirror; refuses to touch COMPLETED days (history locked).
- `reconcileDayScheduleMirror` server fn: one-click "Fix" on a Calendar
  Issue badge — aligns the legacy mirror TO the calendar, never the reverse.
- Editor day cards show the status badge + canonical date in the date
  picker; Missing Date shows an inline amber hint.
- `src/lib/schedule-invalidate.ts`: shared invalidation fan-out so editor,
  Schedule Manager, calendar, portal, and hub converge without refresh.
- Training hub "missing dates" count now uses the same canonical resolver.
