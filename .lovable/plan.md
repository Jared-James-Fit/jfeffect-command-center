
# Program Builder v3 — Full-Block View, View Toggle, True Drag/Drop, Propagation

The current builder still feels week-tab-bound. v3 turns it into a true full-block workspace, while keeping focused views available.

## 1. View toggle (Full Block · Weekly · Day · Client Preview)

Add a segmented toggle at the top of the block editor next to the existing density / collapse controls.

- `view = "block" | "week" | "day" | "preview"`
- Default to last used view, stored in `localStorage` per-user under `pl.builder.view` (and `pl.builder.weekIndex`, `pl.builder.dayId`).
- Replaces the existing `view: 1 | 2 | 4 | 0` "columns" toggle. Column count becomes a sub-option of Weekly view only ("Show 1 / 2 / 4 weeks side-by-side" stays available there for power users).

Behavior per view:
- **Full Block**: vertical stack — Week 1 panel → Week 2 panel → … Each week panel renders all its days as compact day cards in a horizontal scrollable strip (or grid on wide screens). Fully editable. Sticky week headers.
- **Weekly**: current behavior. Week tabs (W1 / W2 / W3 / W4) live inside this view. Single week, all days, max editing comfort.
- **Day**: pick a single day (selected day). Wide layout, full row chevron auto-expanded, ideal for fine-tuning.
- **Client Preview**: read-only render that matches the client portal `workouts.$dayId` layout, navigable week → day. Reuses existing card components in read-only mode.

The Exercise Library panel stays mounted on the left in Full Block / Weekly / Day views; hidden in Client Preview.

## 2. Full Block view internals

- Renders all weeks via `tree.weeks.map`.
- Week header: title + linked/custom summary chips + per-week actions menu (Copy → All weeks, Copy → Next, Apply progression…, Clear, Insert week after).
- Day cards inside each week use the same `CompactRow` table already built; row interactions reuse `onRowPatch`/`onDayPatch` scope-aware wrappers — no behavior regression.
- Selected day highlight (ring) is global across all weeks; clicking any day in any week sets it as the library `+` target.
- Sticky horizontal "Day 1 / Day 2 / Day 3" column header per week so coaches can scan down a column.
- New "Column compare" toggle (Full Block only): switch a week panel to "stacked by day index" mode so Day 1 across Weeks 1-4 stacks vertically — implements the user's "Option 2" layout for progression scanning. Cheap to add as a CSS grid flip.

## 3. Drag-and-drop overhaul

Current drag works exercise → row insert but the insertion line / empty-day drop zones need polish.

- Library items: keep `draggable=true` with `setDragRow`. Also keep `+` hover button (selected-day add) and double-click.
- Each day card gets explicit drop zones:
  - **Empty day**: big dashed "Drop exercise here" zone (already exists, polish styling and `dragover` highlight).
  - **Between rows**: 6px gap line per row boundary, shows a 2px primary-colored insertion bar on `dragover`.
  - **Above first row / below last row**: zones at the top and bottom of the row list.
- Implementation: wrap row list in a single `<div>` with `onDragOver` → compute insertion index from `event.clientY` vs each row's `getBoundingClientRect`. Show insertion bar via state `dropIndex`.
- On drop: insert at computed index (no extra click). Reuses existing `addRowFromExercise(dayId, exerciseId, position)` — extend to accept an `insertIndex`.
- Existing rows remain draggable for reorder via `GripVertical` (already implemented). Same insertion-line logic applies to row→row drag.

## 4. Copy / propagation toolkit

Most plumbing already exists (`copyWeekToAll`, `applyProgression`, `expandLinkedDays`, `breakDayLink`). v3 adds the UI surfaces and the one-click day-copy flow.

Per-day actions menu (⋯ on day card):
- **Copy day → same day in all future weeks** (new helper `copyDayToFutureWeeks(dayId)`).
- **Copy day → selected weeks…** (small dialog with week checkboxes).
- **Copy day → another day** (existing duplicate, retargeted).
- **Break link / Re-link** (existing `breakDayLink` / `relinkDay`).
- **Clear day** (delete all rows, keep day).

Per-week actions menu (existing) gains:
- **Copy Week → all future weeks** (already `copyWeekToAll`).
- **Copy Week → next week only**.
- **Apply progression…** (already wired; surface in this menu too).
- **Clear future weeks**.

Block-level toolbar (Full Block view only):
- "Copy Week 1 → entire block" (single click).
- "Apply progression…" dialog (already implemented).
- "Break all links" (already in pl-programs).

All cascading writes that touch linked days route through the existing `EditScopeDialog` when targets contain `is_custom = true` (warning: "Some future weeks have custom edits — overwrite or preserve?"). Default action is **Preserve**.

## 5. Edit-scope dialog refinements

Wording matches the user's spec exactly:
- "This day only"
- "This day and future weeks"
- "Entire block"
- "Break link / make custom"
- "Cancel"

When future weeks contain custom days and the user picks "future" or "entire block", append a second confirmation step inside the same dialog:
- Preserve custom edits (default)
- Overwrite custom edits
- Cancel

## 6. Compactness pass

- Default row height: keep one line. Move Tempo + Notes columns off the always-visible set in Full Block view; reveal via existing row chevron.
- Day-notes input becomes "Add note" pill until clicked.
- Week header collapses to a single 32px bar in Full Block view, expanding on click.
- Library item: two-line layout (name / muscle · category).

## 7. Client Preview view

- Read-only.
- Renders each week → each day using the same compact table but with inputs swapped for plain text.
- Adds a "View as client" notice banner.
- Reuses existing portal `workouts.$dayId` styling for fidelity.

## 8. Files

Changed:
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` — replace `ViewMode` with `BuilderView`, add view toggle, render Full Block / Weekly / Day / Client Preview layouts, wire localStorage persistence, add per-day actions menu, drop-zone wiring at day level.
- `src/components/program-builder.tsx` — extend drag/drop helpers with insertion-index calculation, add `InsertionLine`, `DropZone`, `DayActionsMenu`, `ClientPreviewDay`, `CopyDayDialog` components; keep existing exports stable.
- `src/lib/pl-programs.ts` — add `copyDayToFutureWeeks(dayId)`, `copyDayToWeeks(dayId, weekIndexes)`, `clearFutureWeeks(blockId, fromWeekIndex)`, extend `addRowFromExercise` with `insertIndex`.

No DB schema changes (the v2 migration with `source_day_id` / `is_custom` already covers linked-week state).

## 9. Out of scope

- Real-time multi-coach editing.
- Mobile drag rebuild (tap-to-add via `+` still covers iPad).
- Per-row template library (separate feature).

## Acceptance checklist

1. View toggle visible at top; switching persists across reloads.
2. Full Block view shows all weeks; every row editable inline; selected day works across weeks.
3. Weekly view still shows week tabs and focused editing.
4. Day view shows one day full-width with expanded rows.
5. Client Preview is read-only and matches portal styling.
6. Drag library exercise into empty day → row appears, no `+` click.
7. Drag between rows → insertion bar appears at exact gap, drop lands there.
8. Day ⋯ menu → "Copy day → all future weeks" populates W2/W3/W4 same day; linked badges appear.
9. Editing a linked W2 D1 prompts edit-scope dialog; "This day only" sets W2 D1 to Custom; W3 D1 stays linked.
10. "Apply progression: +2.5kg/wk Squat" skips custom days with toast.
11. Toolbar "Copy Week 1 → entire block" populates W2–W4; "Break all links" flips everything to Custom.
12. Save → refresh → view, week, day, linked/custom states all persist.
