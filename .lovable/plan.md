## Training Block System Overhaul

Large change touching DB, admin builder, client portal, and a new Archive section. Breaking into 5 phases so we can ship and validate each piece. I'll start phase 1 immediately on approval and continue straight through unless you stop me.

### Phase 1 — Data model (one migration)

Add to `pl_blocks`:
- `status` text — `Draft | Active | Completed | Archived`
- `archived_at`, `completed_at` timestamps
- `completion_method` — `auto | manual`
- `est_minutes_per_workout` int (optional fallback)
- (already have `start_date`, `end_date`, `weeks`, `week_duration_days`)

Add to `pl_weeks`:
- `status` text — `Not Started | In Progress | Completed | Manually Completed`
- `manually_completed` bool
- `manual_completed_at`, `manual_completed_by`
- `est_minutes` int (per-week override)
- `training_days` text[] (Mon, Tue, …)
- `notes` text

New helpers (SQL functions):
- `pl_week_required_workouts(week_id)` and `pl_week_completed_workouts(week_id, client_id)` for status calc.

RLS: keep existing (client read own, admin all); add policies for the new toggle write paths.

### Phase 2 — Shared block card

A reusable `<BlockCard>` (admin + client) showing:
Name · Status badge · Duration (weeks) · Start → End · Current week · Progress % · Week strip with status pips.

Progress = completed workouts / total workouts in block.

### Phase 3 — Admin: editable dates + horizontal weeks

- "Edit Dates" button on each block card → dialog with start/end date pickers.
  - Changing start → recompute end from weeks × duration.
  - Manually editing end → respect, mark `date_source=manual` on block.
- In `blocks.$blockId.tsx`, switch week list to a horizontal scroll/grid (Week 1 | 2 | 3 | 4 …), cards expanded by default, each showing week #, range, training days, est time, notes, status, workouts.
- Current week auto-highlighted via `isCurrentWeek` (already in `block-dates.ts`).

### Phase 4 — Client portal + manual completion

- Client block view mirrors admin layout (read-only on dates).
- Per-week "Mark Week Complete" toggle:
  - ON → status `Manually Completed`, stamp `manual_completed_at/by`.
  - OFF → recompute from workout completions.
- Status auto-rolls to `Completed` when all required workouts done.
- Block auto-rolls to `Completed` when all weeks complete; record `completion_method`.

### Phase 5 — Workout Archive

New route `/_authenticated/admin/archives/blocks` and a "Workout Archive" section on the client program page.

- Archive triggers:
  - All weeks completed → auto-archive
  - Admin "Mark block complete" → archive
  - End date passed → admin gets "Archive now?" prompt
- Archived card shows: name, range, duration, completion status, completed/total workouts, archived date.
- Click → read-only block detail (weeks, workouts, weights, reps, RPE, notes, missed, manual flags).
- Admin gets "Edit Archived Block" toggle that unlocks editing; client never can.
- Sort dropdown: Newest, Oldest, Name, Date range, Completion status.

### Files I expect to touch

- `supabase/migrations/<new>.sql` (phase 1)
- `src/lib/block-dates.ts` (extend with status calc)
- `src/lib/blocks.functions.ts` (new — toggle/complete/archive serverFns)
- `src/components/block-card.tsx` (new)
- `src/components/block-week-strip.tsx` (new)
- `src/components/edit-block-dates-dialog.tsx` (new)
- `src/routes/_authenticated/admin/blocks.$blockId.tsx`
- `src/routes/_authenticated/admin/client-programs.$clientId.tsx`
- `src/routes/_authenticated/admin/archives.tsx` (add blocks tab) OR new `archives.blocks.tsx`
- `src/routes/_authenticated/portal/program.tsx` and `portal/workouts.index.tsx`

### Open questions before I start

1. **End-date "passed" archive prompt** — should it appear as a banner on the admin block card, or as a notification in the bell? (I'll default to a banner on the card unless you say otherwise.)
2. **Client manual toggle** — confirm clients can toggle this themselves with no admin approval. (I'll assume yes.)
3. **Archive location** — extend the existing `admin/archives.tsx` with a "Blocks" tab, or create a separate `archives.blocks.tsx`? (I'll extend the existing page.)

If those defaults are fine just say "go" and I'll start phase 1. Otherwise answer the 3 questions and I'll adjust.