# Multi-Select & Bulk Actions for Program Builders

One shared selection + bulk-action system used by:
- Program Library template builder (`admin/program-library_.$templateId.tsx`)
- Client program builder (`admin/client-programs.$clientId_.tsx`)
- Client-assigned training block / Full Block view (`admin/blocks.$blockId.tsx`)
- Weekly builder view inside the above

Nothing in the existing builder behavior (sticky week header, autosave delay, Full Block / Full Screen / Weekly modes, per-exercise reset, drag-and-drop, copy-to-future, kg/lb, suggested loads, analytics) changes.

---

## Scope of this plan

This is a large, multi-area change. I want your sign-off before writing code. I'll ship it in **3 PRs** in the order below — each PR leaves the app fully working.

### PR 1 — Foundation (schema + server functions + Undo)
- DB migration:
  - `pl_weeks`: add `archived boolean default false`, `archived_at`, `archived_by`, `deleted_at`, `deleted_by`.
  - `pl_days`: same set of columns.
  - `pl_bulk_operations` audit table (operation_id, action, scope, source_ids, destination_ids, created_ids, actor, status, created_at) for idempotency + Undo metadata.
  - Indexes on `(block_id, archived, deleted_at)` and `(week_id, archived, deleted_at)`.
  - RLS: same policies as parent rows; soft-deleted rows hidden from default selects via updated coach/admin policies.
- New file `src/lib/pl-bulk.functions.ts` (TanStack server functions, `requireSupabaseAuth`, role check via `has_role` / `is_assigned_coach`):
  - `bulkDuplicateWeeks({ blockId, weekIds, insertMode, anchorWeekId? })`
  - `bulkDuplicateDays({ sourceDayIds, targetWeekIds, insertMode, anchorDayId? })`
  - `bulkCopyWeeksToDestinations({ weekIds, destinations:[{kind, id, insertMode, anchor?}] })`
  - `bulkCopyDaysToDestinations({ dayIds, destinations:[{weekId, insertMode, anchor?}] })`
  - `bulkArchive({ scope:"week"|"day", ids })` / `bulkRestore` / `bulkSoftDelete` / `bulkRestoreFromTrash` / `bulkPermanentDelete`
  - All run inside one Postgres function (`pl_bulk_clone_weeks`, `pl_bulk_clone_days`, etc.) so a single failure rolls back the whole operation.
  - Idempotency: client passes `operationId` (uuid); server rejects duplicates via `pl_bulk_operations.operation_id` unique index.
  - Cloning strictly excludes client history: never touches `pl_row_results`, `pl_day_completions`, `lift_videos`, `manual_check_in_reviews`, `pl_client_maxes`, analytics. Copy fields are limited to programming columns on `pl_weeks` / `pl_days` / `pl_exercise_rows` / `pl_exercise_notes`.
  - Permanent-delete guard: server function checks for any `pl_row_results` / `pl_day_completions` rows under the targets; if found, returns `{ blocked: true, reason: "has_client_history" }` and the UI offers Archive instead.
- New `src/lib/bulk-undo.ts` (thin wrapper around existing global Undo system used by the builder — if none exists, a shared `useBulkUndoStore` Zustand store with one compound entry per operation; survives refresh by reading `pl_bulk_operations` rows from the last 24h).

### PR 2 — Shared selection UI (used by all three builder routes)
- New `src/components/builder/selection-provider.tsx`:
  - Context: `scope: "off" | "weeks" | "days"`, `selectedIds: Set<string>`, last-clicked anchor for shift-range.
  - Switching scope clears selection. Autosave does NOT clear selection.
  - Persists across scroll, settings panels, Full Screen toggle. Clears on route leave or explicit Clear/Done.
- New `src/components/builder/selection-toolbar.tsx`:
  - "Select" button + scope toggle (Weeks / Days), "Select all", "Clear", "Exit".
  - Live count: "3 weeks selected" / "5 training days selected".
- New `src/components/builder/bulk-action-bar.tsx` (sticky bottom on mobile, sticky top-of-canvas on desktop):
  - Weeks scope: Duplicate · Copy to… · Archive · Trash (delete) · Clear.
  - Days scope: Duplicate · Copy to… · Archive · Trash · Clear.
  - Destructive actions visually separated (right-aligned, destructive variant).
- New `src/components/builder/SelectableWeekHeader.tsx` and `SelectableDayHeader.tsx`:
  - Render checkbox + selected ring/background when scope is on; identical visuals across all three routes.
  - Click / Shift-click range / Cmd-Ctrl toggle on desktop; large tap target on mobile (no modifiers required).
  - Does not interfere with rename, drag, week notes, copy-to-future, day settings — those controls are wrapped in `data-no-select` and ignored by the selection handler.
- New `src/components/builder/destination-modal.tsx` (one modal used by Copy to…):
  - Destination tabs: Template library · Client program · Client block · New template.
  - Search by program/template/block/client name (debounced server-side function).
  - Multi-destination chips with per-destination insert-position picker.
  - Summary screen: "Copy 2 weeks to 3 programs?" with what-will-not-be-copied notice.
- New `src/components/builder/duplicate-position-popover.tsx`: After / Before / End / Choose week.
- New `src/components/builder/trash-archive-filters.tsx`: Active / Archived / Trash tabs in the builder header.
- New `src/components/builder/keyboard-shortcuts.ts` integration: S, A, Esc, Shift-click, Delete, Cmd/Ctrl-D. Hooks into the existing builder shortcuts dialog rather than creating a second one. Ignored while typing.

### PR 3 — Wire into each builder + QA
- `program-library_.$templateId.tsx`, `blocks.$blockId.tsx`, `client-programs.$clientId_.tsx`:
  - Wrap canvas in `<SelectionProvider>`.
  - Replace existing week / day header containers with `SelectableWeekHeader` / `SelectableDayHeader`.
  - Mount `<SelectionToolbar>` next to existing builder controls, `<BulkActionBar>` once at the bottom.
  - Add Active / Archived / Trash filter chips.
- Conflict handling in copies: server returns `{ conflicts: [...] }`; UI prompts Insert as new (default with "Copy of …" rename) · Rename · Choose another location · Cancel.
- Sonner toasts for every operation with one-tap Undo; Undo restores prior order, prior week numbers, prior archive/trash state, removes only newly-created clone IDs.
- Idempotency: action buttons disable while in-flight; per-click `operationId` UUID generated up front.

---

## Items I'm proceeding with as defaults (call out anything you want changed)

1. **Renumbering after duplication**: keep current builder rule (sequential week_index / day_index renumber within parent). Inserted copies labeled "Copy of Week N".
2. **Archive vs Trash UX**: two separate filters (Active default, Archived, Trash). Archive is reversible without expiry. Trash auto-empties after 30 days for template-only items with no client history; items with history can never be permanently deleted (Archive only).
3. **Permission rules**: admins see everything; coaches only see clients where `is_assigned_coach(clientId)` is true and only see templates they own or that are shared. Enforced in every bulk server function — not just in UI.
4. **Multi-destination copy**: all-or-nothing transaction at the destination level — if one destination fails, the whole multi-destination operation rolls back and the toast surfaces which destination failed.
5. **Undo window**: 24h server-side via `pl_bulk_operations`; toast Undo for ~10s, then user can find recent ops in the Trash/Archive panel's "Recent operations" list.
6. **Cmd/Ctrl-D mapping**: only when selection mode is active and focus isn't in an input.
7. **Mobile**: bulk action bar pinned above the bottom nav, never under it; destination modal is full-sheet on mobile.

---

## Files touched (high-level)

```text
supabase/migrations/<ts>_pl_bulk_selection.sql      # new
src/lib/pl-bulk.functions.ts                        # new
src/lib/pl-bulk.server.ts                           # new (admin-side helpers)
src/lib/bulk-undo.ts                                # new
src/components/builder/selection-provider.tsx       # new
src/components/builder/selection-toolbar.tsx        # new
src/components/builder/bulk-action-bar.tsx          # new
src/components/builder/SelectableWeekHeader.tsx     # new
src/components/builder/SelectableDayHeader.tsx     # new
src/components/builder/destination-modal.tsx        # new
src/components/builder/duplicate-position-popover.tsx # new
src/components/builder/trash-archive-filters.tsx    # new
src/components/builder/keyboard-shortcuts.ts        # new (extends existing dialog)
src/routes/_authenticated/admin/program-library_.$templateId.tsx  # wire in
src/routes/_authenticated/admin/blocks.$blockId.tsx               # wire in
src/routes/_authenticated/admin/client-programs.$clientId_.tsx    # wire in
```

No changes to autosave delay, sticky week header, per-exercise reset, kg/lb, suggested loads, drag-and-drop, copy-to-future, or analytics.

---

## What I need from you before I start

1. Approve the 3-PR sequence (Foundation → Shared UI → Wire-in + QA). Each PR ships independently.
2. Approve the defaults in the section above, or tell me what to change.
3. Confirm "Trash auto-empties after 30 days for template-only items" — or you'd rather keep Trash forever until manually emptied.
4. Confirm Undo window of 24h is acceptable (vs 7d).

Reply "go" (with any default overrides) and I'll start with PR 1.
