## Goal

The client's assigned block (`/admin/blocks/$blockId`) should edit with the **same layout, toolbar, compact mode, zoom, undo/redo, copy/paste, single-line rows, and collapsible library** as the Program Library template editor.

## Approach

### 1. Extract shared editor into its own component file
Move these pieces out of `src/routes/_authenticated/admin/program-library_.$templateId.tsx` into `src/components/payload-block-editor.tsx`:
- `EditorChrome` (top sticky header + Save / SaveStatus)
- `StructureCanvas` (compact-mode toolbar, zoom controls, undo/redo, sidebar)
- `BlockPayloadEditor`, `WeekEditor`, `DayEditor`, `RowEditor`
- Prefs (`PREFS_KEY` / `readPrefs` / `writePrefs`)

Re-import them in the template editor route — behavior stays identical.

### 2. Rewrite the client block editor
`src/routes/_authenticated/admin/blocks.$blockId.tsx` (1402 lines → ~250). The new file:
1. Loads the block tree (`getBlockTree`).
2. Converts to a JSON payload `{ weeks_data: [{ week_index, notes, days: [{ day_index, title, focus, notes, rows: [...] }] }] }`. Each entity keeps its DB `id` in a hidden `_dbId` field so the diff can match.
3. Renders the shared `StructureCanvas` / `BlockPayloadEditor` with `compact` / `zoom` / undo / redo / copy / paste.
4. On save (autosave + Save Now), runs a non-destructive diff:
   - Match weeks / days / rows by `_dbId` first, then by index.
   - Update fields in place via existing `updateBlock`, `updateDay`, `updateRow`.
   - Create new entities via `addWeek`, `addDay`, `addRow` / `addRowFromExercise`.
   - Delete only entities the user explicitly removed.
   - Reordering: update `sort_order` via `updateRow`.

### 3. What changes for the user
- Same look/feel as the library editor: compact mode, zoom (saved per browser), undo/redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z), copy/paste exercise rows, collapsible exercise library, side-by-side week cards with snap, dense single-line row inputs.
- Block name, week notes, day title/focus/notes, all row fields (sets / reps / RPE / RIR / % / basis / load / rest / tempo / time_profile / exercise / custom name) editable.
- Add / delete / duplicate weeks and days, drag exercises onto days, paste rows.

### 4. Features that will be REMOVED from the client block editor

You picked "Full replacement with JSON editor", so these admin-only block features will no longer be in this screen:

| Removed | Impact |
|---|---|
| Linked-day editing + scope dialog ("this day / future weeks / entire block") | Edits affect only the single day; future weeks no longer auto-update |
| `relinkDay` / `breakDayLink` / `breakAllLinks` controls | Existing links remain in the DB but UI to manage them is gone |
| Per-week date controls (start date / week dates) | Block start date stays editable elsewhere (block summary card); per-week date overrides removed from this screen |
| `applyProgression` (auto weekly progression rules) | No progression UI |
| `copyDayToFutureWeeks` / `copyWeekToAll` with scope options | Replaced by the simpler "copy week → future weeks" button from the library editor |
| Day-level archive / completion toggles | Completions still tracked by client, but no admin override here |

Existing `pl_row_results` and `pl_day_completions` rows are **preserved** as long as the underlying row/day isn't deleted. The diff-based save keeps DB IDs whenever it can. Rows you delete in the UI **will** cascade-delete their completion history.

### 5. Files touched
- New: `src/components/payload-block-editor.tsx`
- Edited: `src/routes/_authenticated/admin/program-library_.$templateId.tsx` (imports from new module instead of defining inline)
- Rewritten: `src/routes/_authenticated/admin/blocks.$blockId.tsx`

### 6. Not touched
- `src/lib/pl-programs.ts` (uses existing functions only)
- Client-facing workout / portal screens
- Database schema / migrations

## Confirm before I build

Reply **"go"** to proceed, or tell me which removed feature you want kept.