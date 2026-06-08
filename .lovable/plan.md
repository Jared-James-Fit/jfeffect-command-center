# Plan: Block Date Ranges + Committed Training Schedule

Two related features. I'll split into phases so each ships testable.

---

## Phase 1 — Block Date Ranges

### Data model
Add columns to `pl_blocks`:
- `start_date date`
- `end_date date` (auto-computed display only; stored for convenience)
- `week_duration_days int default 7`

Add columns to `pl_weeks`:
- `start_date date`
- `end_date date`
- `date_source text default 'auto'` — `'auto'` | `'manual'`

When `pl_blocks.start_date` changes: auto-recompute `pl_weeks.start_date/end_date` for all weeks where `date_source = 'auto'`. Rows with `date_source = 'manual'` are preserved. Admin gets a confirm dialog before recompute if any manual rows exist.

### Admin UI (Program Builder / Block editor)
In `src/routes/_authenticated/admin/blocks.$blockId.tsx`:
- "Block Start Date" date picker at top of block header
- Auto-shown End Date + duration (weeks × 7)
- Under each week card: date range line (e.g., `Jun 8 – Jun 14`) + small badge `Auto` or `Custom`
- Per-week "Edit dates" popover to override → sets `date_source='manual'`
- "Reset to automatic" button per week and at block level

### Client UI
In `src/routes/_authenticated/portal/workouts.index.tsx`:
- Under each week heading show `Jun 8 – Jun 14` when dates exist
- "Current Week" badge when today falls in range
- "Starts <date>" / "Ended <date>" states for pre/post block
- Day labels also include date when `committed_training_days` (Phase 2) maps cleanly; otherwise just `Day 1`, `Day 2`

---

## Phase 2 — Mandatory Committed Training Schedule

### Data model
Add columns to `clients`:
- `committed_training_frequency int` (1–7)
- `committed_training_days text[]` (Mon..Sun)
- `available_training_days text[]`
- `unavailable_training_days text[]`
- `preferred_training_time text` (Morning/Midday/Afternoon/Evening/Late night/Varies)
- `schedule_changes_weekly boolean`
- `schedule_notes text`
- `training_schedule_completed boolean default false`
- `training_schedule_last_updated timestamptz`
- `training_schedule_updated_by uuid` (user id)

(Existing `training_schedule_card` shows weekly training days but is separate — keep, but mark these new fields as the source of truth and migrate display.)

### Client intake/edit
New component `TrainingScheduleDialog` with the exact question wording:
- "How many days per week are you committed to training?" (1–7)
- "What days are you committed to training?" (multi-select Mon–Sun)
- "What days are you available to train if adjustments are needed?" (multi)
- "Preferred training time" (single select)
- "Days you cannot train" (multi + None)
- "Does your schedule change week to week?" (Yes/No)
- "Schedule notes" (textarea)

Save → set `training_schedule_completed=true`, stamp updated fields, log activity row (admin notification surface).

### Where it appears
- Top of Workouts tab: schedule summary card + "Update Training Schedule" button. If incomplete: red "Training Schedule Required → Set Training Schedule" prompt.
- Account/Profile settings: same dialog entry point.
- Admin client profile (`admin/clients.$clientId`): summary card near status/goals showing all fields + Last Updated / Updated By, with admin "Edit" button using the same dialog (admin-mode flag).

### Admin notification
On client-side save, write to `client_activity_log` with action `training_schedule_updated` containing before/after. (Admin notification bell already reads activity.)

### Frequency mismatch warning
On admin block view, if `committed_training_frequency` and the block's days/week (count of `pl_days` per week) differ, show a yellow banner: "Client committed to N days/week; this program has M workouts/week."

---

## Technical notes
- Use existing `training-schedule.ts` `WEEK_DAYS` for day enums.
- Date math via `date-fns` (already in project) — `addDays`, `format`, `isWithinInterval`.
- `date_source='manual'` blocks recompute; show confirm dialog listing affected weeks.
- All new columns get appropriate defaults; RLS unchanged (existing `pl_blocks`/`pl_weeks`/`clients` policies cover the new columns).
- No silent program rewrites when schedule changes — only the warning banner.

---

## Build order
1. Migration: `pl_blocks` + `pl_weeks` date columns; `clients` schedule columns.
2. Block date logic + admin block editor UI.
3. Client workouts tab week date ranges + Current Week badge.
4. `TrainingScheduleDialog` component.
5. Wire dialog into client Workouts tab + Account; wire admin profile display + edit.
6. Activity log entry + frequency mismatch banner.

Ready to proceed?