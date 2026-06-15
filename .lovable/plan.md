
# Program Assignment Planner — Implementation Plan

## What I found in the codebase (so we don't duplicate anything)

**Existing programming architecture (reuse — do not replace):**

- `pl_templates` — Library programs. Structure lives in `payload jsonb` (schema_version 2) with `blocks → weeks → days → exercises`. Already supports tags / weight classes (added in the last batch).
- `pl_blocks` → `pl_weeks` → `pl_days` → `pl_exercise_rows` (+ `pl_exercise_blocks`, `pl_block_set_rows`, `pl_block_drop_stages`, `pl_exercise_notes`, `warmup_assignments`, `pl_row_results`) — the per-client materialized program.
- `pl_assignment_operations` — already records every template→client assignment with `idempotency_key`, `mode`, `selected_block_keys`, `created_block_ids`, `status`. This is our assignment-batch table.
- `pl_bulk_operations` — generic batch + undo log (action / scope / source / destination / created / meta). Used for undo.
- RPC `pl_assign_template_to_client(...)` — transactional template expand. Already supports `selectedBlockIds`, `startFromBlockId`, `placement`, dates.
- `pl_template_blocks.ts` — normalizes v2 payload, gives active blocks.
- `auto-scheduler.ts` + `AutoSchedulePanel` — places days onto real calendar dates using client training-day availability, conflict detect, schedule lock.
- `block-schedule.ts` — `findOverlappingBlock`, `suggestNextStartISO`.
- `QuickAssignTemplateDialog` — current (too narrow) entry point; we wrap, not delete.
- `client-programs.$clientId_.tsx`, `program-library.tsx`, `blocks.$blockId.tsx` — entry-point pages.
- `pl_client_maxes` + the 1RM/TM gate from the last batch — must still fire before the planner can confirm.
- RLS: every `pl_*` table already has admin / coach (via `is_assigned_coach`) / client policies. Members are blocked. We reuse `has_role` + `is_assigned_coach`, no new auth model.

**What's missing for the spec:**

1. Selection below the block level (week / day / exercise) at assignment time.
2. A real visual calendar that spans current + future months with conflict / gap / draft / published status.
3. Conflict review UI with keep / merge / replace / move / skip decisions.
4. Full preview before commit.
5. Draft vs published distinction at the assignment-batch level (existing `pl_blocks.status = 'Draft' | 'Published'` is per block, plus `client_visible` — we'll use these, no new field needed).
6. Schedule publishing (later date).
7. Undo-batch UI on top of `pl_assignment_operations` + `pl_bulk_operations`.
8. Persisted draft of an in-progress assignment (refresh restore).

## Architecture

One reusable component, three entry points, one server function family. **No second programming system.**

```text
                ┌────────────────────────────────┐
  Library  ───▶ │                                │
  Client   ───▶ │  <ProgramAssignmentPlanner />  │  ──▶ planAssignment(...)  (server fn, dry-run)
  Calendar ───▶ │   (full-screen workflow)       │      └─▶ returns Preview + Conflicts
                └────────────────────────────────┘  ──▶ commitAssignment(...) (server fn, txn)
                                                        └─▶ pl_assign_template_to_client (existing)
                                                            + per-day pl_days.scheduled_date writes
                                                            + pl_assignment_operations row
                                                            + pl_bulk_operations row (for undo)
```

### Files to add

```text
src/lib/program-planner/
  types.ts                     # PlannerSelection, AssignmentMethod, ConflictDecision, Preview, Batch
  selection.ts                 # tri-state selection over template payload (block/week/day/exercise)
  placement.ts                 # map selected days → dates given method + training weekdays
  conflicts.ts                 # detect existing pl_blocks/pl_days/completion conflicts
  coverage.ts                  # "programmed through" date, gaps, weeks-ahead
  draft-store.ts               # localStorage persistence keyed by clientId+templateId
  planner.functions.ts         # planAssignmentFn (dry-run) + commitAssignmentFn + undoAssignmentBatchFn

src/components/program-planner/
  ProgramAssignmentPlanner.tsx # shell + step router + sticky summary
  steps/
    SelectClientStep.tsx
    SelectContentStep.tsx      # tri-state tree, fast actions, live summary
    ChooseMethodStep.tsx       # 5 methods + training weekday picker
    CalendarStep.tsx           # month/week/timeline, today/jump, range select, drag
    ConflictReviewStep.tsx     # per-conflict actions + bulk apply
    PreviewStep.tsx            # full preview, edit shortcuts, draft/publish
    SuccessScreen.tsx
  AssignmentCalendar.tsx       # reusable month/week grid w/ legend, status pills
  CoverageHeader.tsx
  AssignmentHistoryPanel.tsx   # under client profile

src/routes/_authenticated/admin/program-assign.$clientId.tsx   # full-screen launcher (drafted client)
src/routes/_authenticated/admin/program-assign.tsx             # full-screen launcher (pick client)
```

### Entry-point wiring

- `program-library.tsx` row menu → "Assign to Client" → opens planner with `templateId` set, no client.
- `program-library_.$templateId.tsx` header → "Assign to Client".
- `client-programs.$clientId_.tsx` → "Add From Library" replaces today's `QuickAssignTemplateDialog` trigger; keep `QuickAssignTemplateDialog` as a "Quick assign" shortcut so we don't break existing workflows.
- Client calendar / active-program page → "Add Programming".

### Server functions

All in `program-planner/planner.functions.ts`, all `createServerFn().middleware([requireSupabaseAuth])`, all `await authorizeClient(...)` first (admin OR `is_assigned_coach`).

- `planAssignmentFn({ clientId, templateId, selection, method, startDate, trainingDays, manualDateMap?, replaceRange? })`
  - Dry run. Reads template payload + client's existing `pl_blocks`/`pl_weeks`/`pl_days`/completions. Returns:
    - `placements: [{ templateDayKey, date, sourceBlockKey, sourceWeekIndex, sourceDayIndex, title }]`
    - `conflicts: [{ type, date, existing, incoming }]` — date-occupied / completed-protected / overlap / duplicate-incoming.
    - `coverage: { programmedThrough, futureWeeks, gaps[], workoutsThisMonth, drafts, published }`
    - `summary: { selectedBlocks, weeks, days, exercises }`
  - Does **not** write.

- `commitAssignmentFn({ ...same input, conflictDecisions, status: "draft" | "publish" | { publishAt } , idempotencyKey })`
  - Server-side: re-run plan, apply decisions, then in **one transaction** (via a new SQL function `pl_commit_planner_assignment`):
    1. Insert `pl_assignment_operations` (status=`pending`).
    2. Call existing `pl_assign_template_to_client` per block subset to materialize `pl_blocks/weeks/days/rows` with full metadata, returning created ids.
    3. Apply per-day `scheduled_date` updates derived from placements.
    4. Apply conflict decisions (skip / merge / replace / move existing day) — every mutation logged to `pl_bulk_operations` so undo is possible.
    5. Set `client_visible` and `pl_blocks.status` based on draft/publish.
    6. Update `pl_assignment_operations.status = 'completed'`, `created_block_ids`, write `pl_bulk_operations` parent row `meta = { plannerBatch: true, decisions, placements }`.
  - Idempotency: the existing `pl_assignment_ops_idem_uniq (client_id, template_id, idempotency_key)` already protects double-click.

- `undoAssignmentBatchFn({ batchId })`
  - Removes `created_block_ids`, restores anything tracked in `pl_bulk_operations.meta.restoreOps`. Warns + refuses if any `pl_row_results` were logged after assignment unless `force: true`.

- `scheduledPublishWorker` — extend the existing `scheduled-send-worker` route to flip `pl_blocks.client_visible` / `status` at `publish_at`. (Schema: add `publish_at timestamptz` + `published_at timestamptz` to `pl_assignment_operations`.)

### Database changes (one migration, additive only)

```sql
ALTER TABLE public.pl_assignment_operations
  ADD COLUMN IF NOT EXISTS selected_week_keys  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS selected_day_keys   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS selected_exercise_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assignment_method   text,
  ADD COLUMN IF NOT EXISTS training_weekdays   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS conflict_decisions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_status      text NOT NULL DEFAULT 'published'
    CHECK (publish_status IN ('draft','published','scheduled')),
  ADD COLUMN IF NOT EXISTS publish_at          timestamptz,
  ADD COLUMN IF NOT EXISTS published_at        timestamptz,
  ADD COLUMN IF NOT EXISTS workouts_added      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_merged     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_replaced   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_skipped    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workouts_moved      int NOT NULL DEFAULT 0;
```

A new SQL function `pl_commit_planner_assignment(...)` (transactional). Existing RPCs and tables remain untouched — no destructive migration, no rename. RLS unchanged (existing admin/coach policies already cover the new columns).

### Selection model

In-memory tri-state tree mirrors the template payload (`block.key → week.index → day.index → exercise.key`). Helpers in `selection.ts`:

- `selectAll`, `clearAll`, `selectBlock(key)`, `toggle(node)`, `getState(node) → 'on' | 'off' | 'partial'`
- `summarize(selection) → { blocks, weeks, days, exercises }`
- `materializeSelectedDays(payload, selection) → SelectedDay[]` — only the days actually selected, preserving order and full metadata. This object is what placement + commit operate on.

Important: when only some exercises of a day are selected, commit materializes the day with **only** those exercises (filtering `payload.blocks[].weeks[].days[].exercises[]` server-side before calling the expand RPC). Everything else (rest, supersets, tempo, RPE, colours, video URLs, instructions, notes) flows through unchanged because we never re-serialize — we forward the original exercise object.

### Calendar

`AssignmentCalendar` is one component that powers month / week / timeline.

- Data: `pl_days` with `scheduled_date`, joined to `pl_blocks` (status, client_visible) and `pl_day_completions`. Cached in TanStack Query.
- Each cell shows: status badge (Completed / Scheduled / Draft / Missed / Empty), icon, optional pattern stripe for "incoming preview".
- Interaction: tap = select day; shift-click / drag = range; tap week header = week; tap month header = month. Mobile uses long-press for range.
- Navigation: prev / next / Today / Jump-to-month / Jump-to-last-programmed.
- Conflict + gap markers come from `coverage.ts` overlay, not stored fields.
- Legend always visible above the calendar.

### Conflict handling

Decisions modeled per-conflict in state, plus a "Apply to all similar" toggle. Completed-day conflicts are gated behind a second confirm dialog and never auto-resolved. Decisions are persisted into the commit payload and into `pl_assignment_operations.conflict_decisions` for audit.

### Draft persistence

`draft-store.ts` writes `{ step, selection, method, trainingDays, startDate, conflictDecisions, scroll, calendarMonth, idempotencyKey }` to `localStorage` keyed by `assignment-draft:${clientId}:${templateId}`. Restored on mount. `useBlocker` warns before leaving with unsaved changes. The same `idempotencyKey` is reused on retry so double-clicks/refreshes hit the unique index.

### Permissions (all enforced server-side)

- Every server fn calls `authorizeClient` (admin OR `is_assigned_coach`).
- Client search server fn filters by `is_assigned_coach` when caller is a coach.
- Members and clients have no UI entry point and the planner routes live under `_authenticated/admin/` — additionally the gate route already requires admin/coach role via the existing layout.

### Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Breaking existing assignment flow | `QuickAssignTemplateDialog` and `pl_assign_template_to_client` stay; planner calls the same RPC. Add columns are nullable / defaulted. |
| Overwriting completed workouts | Completion check uses `pl_day_completions` + `pl_row_results`; replace is blocked without explicit second-confirm; undo refuses when results exist post-assignment. |
| Duplicate workouts on double-click | Existing unique `(client_id, template_id, idempotency_key)` + client-generated key. |
| Partial writes | All mutations inside `pl_commit_planner_assignment` SQL function (single transaction). |
| Template drift after assignment | We already snapshot via materialized `pl_blocks/weeks/days/rows`; no live binding to template. Source recorded via `source_template_id` + `source_template_block_key` + `template_payload_revision`. |
| RLS leaks for drafts | Drafts use `pl_blocks.client_visible = false`; existing client-read policy already requires `client_visible`. Confirmed in current `pl_weeks` policy. |
| Mobile drag-and-drop UX | Mobile uses explicit "Move workout" sheet, not drag. |
| Scope creep | Phase the work (below) so we always have a shippable increment. |

## Phased delivery (each phase is independently usable)

1. **Migration + planner server functions** — `planAssignmentFn`, `commitAssignmentFn` calling existing RPC for block-only selection, `undoAssignmentBatchFn`. No new UI yet; smoke-tested via `invoke-server-function`.
2. **Planner shell + selection + method + preview + commit (block/week granularity)** — usable replacement for current dialog. Three entry points wired.
3. **Visual calendar + coverage header + conflict review (keep/skip/replace)**.
4. **Day + exercise-level selection, exercise-into-existing-workout flow, merge/move conflict actions, manual date map**.
5. **Draft/publish/schedule-publish, assignment history panel, mobile polish, draft restore**.

## Acceptance test mapping

Each of the spec's 45 acceptance items maps to a step or a server-function unit test (`src/test/program-planner.*.test.ts`). I'll add `planner-selection.test.ts`, `planner-placement.test.ts`, `planner-conflicts.test.ts`, `planner-undo.test.ts` covering tri-state selection, weekday mapping, conflict decisions, undo correctness, completed-day protection, and idempotency.

## What I will NOT do

- Will not delete `QuickAssignTemplateDialog`, `AutoSchedulePanel`, or any existing route.
- Will not change RLS on existing tables.
- Will not migrate or alter existing `pl_blocks`, `pl_weeks`, `pl_days`, `pl_exercise_rows` rows.
- Will not introduce a parallel "client_workout_assignments" table.
- Will not auto-sync templates into already-assigned client programs.

---

**On approval, I'll start with Phase 1 (migration + server functions) and return for confirmation before each subsequent phase — this is the safe way to land a feature this large without risking existing client programming.**
