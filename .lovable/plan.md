## Phase 4 — All workouts anytime + previous blocks / history access

### Scope guardrails
- Do NOT rebuild the workout system, the block/week/day flow, or the existing completion logic.
- Keep `SmartTodayCard`, `BlockSummaryCard`, `BlockWeekColumns`, `WorkoutArchiveSection`, and `workouts.$dayId.tsx` intact.
- Only ADD: a tabbed client workouts screen, an "outside-scheduled-day" notice, status labels, and admin previous-blocks/history surfacing. Reuse existing data — no schema rewrites.

### Existing data we'll reuse
- `pl_blocks` (start_date / end_date / status — already supports current vs prior)
- `pl_weeks`, `pl_days` (scheduled_date + day_index + training_days)
- `pl_day_completions` (already has `completed_at`)
- `pl_row_results` (logged weights/reps/RPE/notes per set)
- `getClientWorkouts(clientId)` already returns full items grouped by block

So no migration is required for v1.

---

### PART 1 — Client tabs (Today | All | Calendar | History)

Refactor `src/routes/_authenticated/portal/workouts.index.tsx` to:
- Keep all existing top sections (FAQ widgets, TrainingScheduleCard, SmartTodayCard, "Open My Program" card).
- Below that, add a `Tabs` (segmented control) with 4 tabs:
  - **Today** — current `SmartTodayCard` summary + next/up workouts (default).
  - **All Workouts** — current block only: list every assigned day with status badge. Tap → existing `/portal/workouts/$dayId`.
  - **Calendar** — keep existing `BlockWeekColumns` view (already a per-week schedule).
  - **History** — new `<ClientPreviousBlocks clientId=…/>` component (see Part 4).

Group blocks via `block.status` + `block.end_date`: "current" = active or latest with no end_date in past; everything else = history.

### PART 2 — Allow completion outside scheduled day

In `src/routes/_authenticated/portal/workouts.$dayId.tsx`:
- Compute the day's scheduled date using existing helper `dayScheduledDate` (see `src/lib/workout-today.ts`; export it if not already exported).
- If `today !== scheduledDate` AND not yet completed, render a small `Alert`:
  > "This workout is scheduled for **{Mon, Mar 10}**, but you can still complete it today."
- Do NOT block submit. Completion already writes `completed_at = now()` (actual date) and never touches `scheduled_date`. No DB change needed.

### PART 3 — Status display

Add `src/lib/workout-status.ts` exporting `getWorkoutStatus(item, today)` returning:
- `today` | `upcoming` | `completed_today` | `completed_on_scheduled` | `completed_different_day` | `missed` | `available`

Used by new `WorkoutListCard` (All Workouts tab) and reused in History. Wording: "Completed Tue", "Scheduled Thu", "Missed Mon", "Completed Fri instead of Mon".

### PART 4 — Previous blocks / Training history (client)

New `src/components/client-previous-blocks.tsx`:
- Query: list blocks for client where `status = 'Completed'` OR `end_date < today` (summary only — id, name, dates, completed count from existing `BlockSummaryCard` data path). Lazy.
- Each row → expandable to show weeks → days. Clicking a day opens **read-only** existing `/portal/workouts/$dayId` with `?readonly=1` search param.
- In `workouts.$dayId.tsx`, when `readonly` is true OR the day's block is `Completed`/in the past, disable inputs and hide "Complete" / "Save" actions. Show logged values from `pl_row_results`.

(Admin can flip the readonly flag from their side — see Part 5 — by passing `?readonly=0`.)

### PART 5 — Admin: previous blocks + history

`src/routes/_authenticated/admin/client-programs.$clientId.tsx` already lists blocks. Add a `Tabs` view:
- **Current Block** (existing default content)
- **Previous Blocks** — reuse `ClientPreviousBlocks` with `mode="admin"` (no readonly enforcement; admin can navigate into the block builder `/admin/blocks/$blockId`).
- **Workout History** — flat list of completed workouts across blocks (date, block, day, completion status). Reuses the existing `client-programs.$clientId.history.tsx` route via a tab link if it already exists; otherwise embed a lightweight history table.

No schema change.

### PART 6 — Simple progress comparison (v1)

New `src/components/exercise-progress-compare.tsx` (admin-only, in the new History tab):
- Pick an exercise → query `pl_row_results` joined to `pl_exercise_rows` filtered by `exercise_id` and client → group by `block_id` → show top set per block (max load × reps, last logged RPE).
- One small "Block completion" stat: `completed_days / total_days` per block.

Loaded only when the tab is opened. Skip the client side for v1.

### PART 7 — Search / filter in history

In the admin History tab and client History tab, add lightweight client-side filters over the already-loaded summary list: free-text search (exercise/day title), block dropdown, status (completed / missed). No server pagination for v1.

### PART 8 — Data rules

- Never write to old `pl_day_completions` from the readonly view.
- Never modify `scheduled_date`; `completed_at` is the only field touched on completion (already the case).
- No deletes, no dedupe writes.

### PART 9 — Mobile / tablet UX

- Use shadcn `Tabs` with `grid-cols-4` on mobile (icons + short label), full row on desktop.
- All workout cards full-width on mobile, `pb-32` to clear bottom nav (already done in the page).
- History rows use `Accordion` (collapsible) so they don't feel buried.

### PART 10 — Performance

- Tabs render lazy: each tab's heavy content is mounted only when active (conditional render).
- `getClientWorkouts` is already loaded once for the page; Today/All/Calendar all derive from that single fetch (no extra round-trips).
- Previous Blocks issues a single summary query; details fetched only when a row is expanded.
- Progress comparison query runs only when the comparator is opened.

### PART 11 — Files to change / add

Create:
- `src/lib/workout-status.ts`
- `src/components/workout-list-card.tsx` (All Workouts row)
- `src/components/client-previous-blocks.tsx`
- `src/components/exercise-progress-compare.tsx`

Edit:
- `src/routes/_authenticated/portal/workouts.index.tsx` (wrap existing content in tabs)
- `src/routes/_authenticated/portal/workouts.$dayId.tsx` (outside-day alert + readonly mode via `?readonly=1`)
- `src/routes/_authenticated/admin/client-programs.$clientId.tsx` (tabs: Current / Previous / History)
- `src/lib/workout-today.ts` (export `dayScheduledDate` if not exported)

### Out of scope (deferred)
- Client-side progress comparison UI
- Reordering / rescheduling workouts
- Permission flag to let a client edit an old block
- Detailed per-set diff charts
