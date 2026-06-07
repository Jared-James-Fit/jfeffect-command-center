# Program Builder Sheet-Style Rebuild

Goal: make the Program Builder (block editor + Program Library template editor) feel like a compact coaching spreadsheet — fast inline editing, drag-and-drop exercises from a sticky library panel, copy-week-forward, and multi-week side-by-side view. Coach edits never overwrite client logs.

## Scope

In scope (admin/coach surfaces only):
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` (live client blocks)
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx` (templates)
- Shared builder components under `src/components/program-builder/`
- Helpers in `src/lib/pl-programs.ts` (copy week with options, row defaults from exercise)

Out of scope (do not touch):
- Client workout view (`portal/workouts.$dayId.tsx`) stays clean/spacious
- Training Intelligence, Phases, analytics
- DB schema (current `pl_rows` already supports coach fields; client results live in separate `pl_set_logs` / completions and are never written by builder)

## Layout

Desktop:
```
┌─────────────┬───────────────────────────────────────────────┐
│ Exercise    │ Top bar: weeks | view (1/2/4/all) | copy week │
│ Library     │ density | save state                          │
│ (sticky)    ├───────────────────────────────────────────────┤
│ search      │ Week N                       [copy ▾][+ day]  │
│ filters     │ ┌─ Day 1 (Squat)  ~62 min ─────────────────┐  │
│ recent      │ │ pri | movement | s | reps | %/RPE | load │  │
│ list (drag) │ │ ... inline-edit rows, drag handles       │  │
│             │ └──────────────────────────────────────────┘  │
│             │ ┌─ Day 2 ... ┐                                │
└─────────────┴───────────────────────────────────────────────┘
```
- Multi-week mode: render N weeks horizontally with shared sticky column headers.
- iPad: collapsible library panel; one week default.
- iPhone: redirect message — "Use desktop/iPad for builder; client view available."

## Compact grid

- New `<ProgramGrid>` component: dense table, ~28px row height in Compact, ~36px in Comfortable. Toggle in top bar, persisted in localStorage (`pb.density`).
- Columns (configurable, hidden by default if empty across day): Priority chip · Movement · Sets · Reps · %·Basis · RPE · RIR · Load · Rest · Tempo · Notes.
- Inline inputs use shared `<CellInput>` with: Tab → next cell, Shift+Tab → prev, Enter → cell below, Esc → revert. Save on blur + debounced autosave (existing `updateRow`).
- Left priority chip uses color tokens: `--accent-squat`, `--accent-bench`, `--accent-dl`, `--muted` for accessory. Defined in `src/styles.css` as oklch tokens; JF red stays brand accent.

## Exercise library panel

- New `<ExerciseLibraryPanel>`: search input, quick-filter chips (Squat/Bench/DL/Chest/Back/Shoulders/Quads/Hams/Glutes/Arms/Accessories/Mobility), Recent (last 10 used in this block, from rows), Favorites (localStorage `pb.fav`).
- HTML5 drag-and-drop (no new dep): `draggable` items with `dataTransfer.setData("application/x-pb-exercise", id)`.
- Drop zones:
  - Day body → append row with defaults pulled from exercise (rest, tempo, notes if present on `exercises` table; otherwise blanks).
  - Between rows → insert at position.
  - Row drag handles use same dnd for reorder + cross-day move (`dataTransfer` carries row id + source day id).
- Reuses existing `addRow` / `moveRow` / new `moveRowToDay(rowId, dayId, position)`.

## Copy week

- New helper `copyWeek(sourceWeekId, targetWeekId, opts)` in `pl-programs.ts`:
  - opts: `{ exercises: true, prescriptions: bool, notes: bool, clearClientResults: true (always) }`
  - Implementation: read source days+rows, upsert into target week (replace target days). Never touches `pl_day_completions` / `pl_set_logs`.
- UI: "Copy Week ▾" menu in week header — Copy Forward (next week, creating if needed), Copy To… (dialog with target week + options checkboxes). Default: exercises + prescriptions + notes; client results never copied.

## Multi-week view

- Top bar toggle: 1 / 2 / 4 / All weeks. State in URL search param `?view=2`.
- Grid container uses CSS grid with `grid-template-columns: repeat(var(--cols), minmax(560px, 1fr))` and horizontal scroll.
- Sticky column headers per week; sticky week header row at top of scroll container.

## Coach vs client separation

- Builder only edits `pl_rows` (programmed fields). Client logs live in `pl_set_logs` / completion tables — builder never reads/writes them. Add a read-only "Logged" indicator badge on rows that already have client logs in the current block (small dot + tooltip "Client has logged this row — edits won't affect past logs").

## Save state

- Top-right pill: Saved / Saving… / Unsaved / Error. Driven by a small `useSaveState` hook wrapping mutation lifecycle.

## Template editor parity

- `program-library_.$templateId.tsx` reuses the same `<ProgramGrid>` + `<ExerciseLibraryPanel>` + copy-week. New template opens directly in builder with Week 1 / Day 1 seeded.

## Files

New:
- `src/components/program-builder/ProgramGrid.tsx`
- `src/components/program-builder/ExerciseLibraryPanel.tsx`
- `src/components/program-builder/CellInput.tsx`
- `src/components/program-builder/CopyWeekDialog.tsx`
- `src/components/program-builder/use-save-state.ts`
- `src/components/program-builder/dnd.ts` (drag payload helpers)

Edited:
- `src/lib/pl-programs.ts` — add `copyWeek`, `moveRowToDay`, `insertRowAt`, `getExerciseDefaults`.
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` — replace current week tabs with new builder shell.
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx` — same shell.
- `src/styles.css` — priority/movement accent tokens.

## Testing checklist (manual against preview)

1. Open template → builder loads with library panel + grid.
2. Search "squat" → drag onto Day 1 → row appears with defaults.
3. Edit sets/reps/%/load via Tab+Enter without mouse.
4. Drag row up/down within day; drag row to Day 2.
5. Copy Week 1 → Week 2 with default options; client results untouched.
6. Switch to 2-week view; edit Week 2 micro-adjustments.
7. Toggle Compact/Comfortable density; persists on reload.
8. Save state pill cycles Saving → Saved.
9. Client view of an assigned day still renders the clean spacious layout.
10. Template assign → client sees workout; coach edits to future week don't overwrite client's logged sets.

## Notes / non-goals

- Using native HTML5 DnD (no `dnd-kit` install) to keep bundle lean; if reorder UX feels rough during QA, swap to `@dnd-kit/core` in a follow-up.
- Keyboard arrow-key cell navigation is best-effort; Tab/Enter are guaranteed.
- Mobile builder is intentionally minimal — iPhone shows "open on larger screen" notice; client workout view is unchanged.
