
# Program Builder v2 — Faster Library, Tighter Rows, Linked Weeks

The current builder already has drag-and-drop, a left library panel, compact rows, and a Copy Week dialog. This plan closes the remaining gaps so it actually feels like a coaching sheet.

## 1. Exercise Library + Add-to-Day flow

**Library item (left panel)** — show more useful info, faster to add:

- Two-line item: name (top), muscles · category (bottom)
- Always-visible drag handle, plus a `+` button on hover that calls "Add to selected day"
- Search filters across name, muscle, category, equipment, tags

**Selected day state** — new global per-block selection:

- Clicking a day card sets it as "selected" (subtle primary ring)
- Library `+` button and double-click add into the selected day
- If none selected, toast: "Select a day first" and briefly pulse the first day

**Auto-fill on add** — `addRowFromExercise` already inserts an `exercise_id`. Extend it to also seed:

- `time_profile` from the exercise category (squat/bench/dead → `main_lift`, accessory mapping)
- `rest_seconds` from `TIME_PROFILES` defaults
- The cues/demo come from the joined `exercises` row, so no DB change needed for display

## 2. Compact row polish

- Default row height stays one line in Compact density (current ~28px is fine)
- Add a tiny chevron at the row start to expand → reveals Notes, Tempo, Time profile, % basis, advanced calc on a second line
- Move Tempo + Notes out of the always-visible columns into the expand panel; default visible columns: Movement | Sets | Reps | RPE | % | Load | Rest | (⋯ menu)
- Day-notes input collapses to a "Add note" pill when empty; expands to a textarea when clicked

## 3. Linked weeks (piggyback)

**Schema (new migration)** — add to `pl_days`:

- `source_day_id uuid null references pl_days(id) on delete set null` — the day this one is linked to
- `is_custom boolean default false` — true once the user breaks the link / edits independently

The `copyWeek` helper already wipes + recreates target days. Update it to write `source_day_id` on each new day pointing to the matching source day (by `day_index`), with `is_custom = false`.

**UI on the day header:**

- Linked badge: `Linked to W{n} D{n}` (clickable → focuses the source day)
- "Custom" badge once `is_custom = true`
- Menu items: `Break link`, `Re-link to previous week`

**Edit-scope modal** — when a coach edits a row/day field on a *linked* day, show:

- This day only (sets `is_custom = true` on this day; future linked days stop following it because they link to the *previous* week's day chain, but we still preserve their content)
- This day + future weeks (cascades the same patch to all downstream days whose `source_day_id` chain reaches this day and that are not `is_custom`)
- All matching days in block (every day with same `day_index` regardless of link)
- Cancel

Implement once in a `useEditScope` helper that wraps `updateRow` / `updateDay` / row insert / row delete and resolves the affected day IDs server-side via a small `expandLinkedDays(dayId, scope)` function in `pl-programs.ts`.

If any downstream day is `is_custom = true`, show a confirmation: "Some future weeks have custom edits — overwrite or preserve?".

## 4. Block-wide shortcuts

Top toolbar additions next to existing Copy Week:

- **Copy Week 1 → All weeks** (single click; uses existing `copyWeek` in a loop, sets links)
- **Apply progression…** dialog: pick lift filter + rule (+2.5kg/wk, +5lb/wk, +2.5%, repeat, deload -10%); writes new `load_kg` / `percentage` per week
- **Break all links** (sets `is_custom = true` everywhere)

Empty-day state updates: instead of just "Drag exercise here", add buttons:

- Add Row · Copy from Week 1 Day N · Copy from previous week

## 5. Files

**New / changed:**

- `supabase/migrations/<ts>_pl_day_links.sql` — `source_day_id`, `is_custom`, indexes, plus grant noop (table already granted)
- `src/lib/pl-programs.ts` — extend `addRowFromExercise` to seed time_profile/rest from exercise category; add `linkDay`, `breakDayLink`, `expandLinkedDays`, `copyWeekAll`, `applyProgression`; update `copyWeek` to set links
- `src/components/program-builder.tsx` — selected-day context, library `+` button, expandable row chevron, edit-scope dialog component, link badges
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` — wire selected-day state, replace direct `updateRow`/`updateDay` calls with scope-aware wrappers, add toolbar buttons and empty-state actions
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx` — minor: same library `+` / select-day works inside the in-memory JSON editor too (best-effort, no linking — templates stay simple)

## 6. Out of scope (kept simple this pass)

- Per-row template save / row library — not part of "faster builder", separate feature
- Full formula engine (Week2 = Week1 + 2.5kg as a live computed field) — the "apply progression" button writes the values, which is what coaches actually want and avoids stale formulas
- Mobile drag rebuild — desktop drag + tap-to-add via the `+` button already covers iPad

## Acceptance checklist

1. Click Day 1 → ring highlight; library `+` adds rows into Day 1 with correct time_profile/rest
2. Drag from library still works; drop on a row inserts at that position
3. Row chevron expands to show Notes/Tempo/% basis; collapsed default is one line
4. Build Week 1 → click "Copy Week 1 → All weeks" → Weeks 2–N populated, each day shows "Linked to W1 D{n}"
5. Edit a set count on W2 D1 → scope modal appears → "This day only" sets W2 D1 to Custom, W3 D1 stays linked to W1
6. Same edit with "This + future weeks" → W3/W4 update, W2 still linked
7. "Apply progression: +2.5kg/wk to Squat" updates loads across weeks; custom days are skipped with toast
8. Break link on W3 D1 → badge flips to Custom; subsequent cascades skip it
