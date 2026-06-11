## Phase 2 — Cardio Defaults + Nutrition Day Sync

Builds on Phase 1. No rewrite of Cardio Targets — adds new actions, a tiny sync layer, and small client-portal surface. Touches only cardio files plus one tiny add on the client portal.

### Data model (no schema changes)
Cardio already has `cardio_targets.day_type` with values `General / Training Day / Rest Day / High Day / Custom`. Nutrition already has `nutrition_target_days.day_label` with values like `Training Day / Rest Day / High Day / Low Day / Daily`. Sync is a **name match** between `cardio_targets.day_type` and `nutrition_target_days.day_label`. No DB migration needed.

Note on naming: the spec calls it "Non-Training Day"; the existing enum uses "Rest Day" (and nutrition matches on "Rest Day"). To keep sync working without forking enums, we'll keep the stored value as `Rest Day` and surface the friendly label "Non-Training Day" in the new defaults UI only.

### Part 1 — Apply Default Cardio
Add a new primary action `Apply Default Cardio` in `CardioTargetsPanel` header. On click, ensures one Active target exists for each of the three day types using these defaults:

- Training Day → Incline Walking · 25 min · Zone 2 · 4×/wk · ~150–200 cal · visible
- Rest Day (labeled "Non-Training Day") → Outdoor Walking · 25 min · Zone 1–2 · 3×/wk · visible
- High Day → Outdoor Walking · 20 min · Zone 1–2 · note "Keep fatigue low" · visible

A small confirm dialog before applying explains what will be created.

### Part 2 — No duplicates
Detection: a target counts as the "default" for a day type if `day_type` matches and `program_name` is null. On Apply:
- If none of the three defaults exist → insert all three.
- If some/all exist → open a confirm dialog with three options:
  - **Update existing defaults** (overwrite the defining fields, keep notes)
  - **Keep existing** (no-op)
  - **Create as new** (extra) — disabled by default to avoid clutter

### Part 3 — Sync with nutrition day types
A new helper `getNutritionDayLabels(clientId)` reads the client's latest active nutrition target + days and returns the list (e.g. `["Training Day","Rest Day","High Day"]`). The defaults dialog and Quick Actions use this to:
- Pre-check which defaults to apply (only for day types the nutrition plan actually uses).
- Skip "High Day" silently if nutrition doesn't include it (or warn admin).
- Drive a new `Sync With Nutrition Days` action that reconciles existing cardio targets: any cardio with `day_type` matching a current nutrition `day_label` gets its `program_name` cleared (so it's treated as the linked default) and a toast confirms `N synced`.

### Part 4 — Customization preserved
`CardioTargetDialog` already covers all editable fields; no change needed. Edit / Copy / Delete in the panel continue to work. Defaults are normal rows after insertion, fully editable.

### Part 5 — Link badge per row
In each panel row, add an inline indicator:
- `Linked to: Training Day nutrition` (green) when a same-named nutrition day exists for the client.
- `Not linked to nutrition day` (muted) when no match.

Computed client-side from the nutrition day labels we already fetch.

### Part 6 — Renamed day types
Add a one-shot check on the cardio admin route: after fetching cardio + nutrition, if there are cardio targets whose `day_type` doesn't appear in the current nutrition day labels AND the nutrition plan recently changed, show a single banner at the top:
> "Your nutrition day types changed. Sync cardio names? [Sync] [Dismiss]"

Sync opens a small dialog listing each orphaned target with two buttons per row: `Update Cardio Name → <closest nutrition label>` or `Keep Current Name`. We don't auto-rename anything without admin confirmation.

### Part 7 — Client view
The client portal already lists cardio inside the admin panel only. Add a compact "Cardio by Day" card on `/portal/nutrition-targets` (right under the nutrition day tabs) showing the active cardio targets grouped by `day_type` so the client knows which cardio applies to which nutrition day. Example row: `Training Day Cardio · Incline Walking · 25 min · Zone 2`. Hidden if no active cardio.

### Part 8 — Quick Actions
The panel header's button row becomes:

1. `Apply Default Cardio` (primary, new)
2. `Sync With Nutrition Days` (new)
3. `Create Custom Cardio` (renames the existing "Single" dropdown trigger)
4. `Assign Saved Cardio` (existing)

Existing `Create Program` stays in an overflow menu so the row stays clean on mobile.

### Part 9 — Performance
- All writes go through a single `applyDefaultCardio({clientId, mode})` helper using one bulk `upsert` per mode, then a single `invalidateQueries(["cardio-targets", clientId])`.
- No page reload; existing query cache drives the re-render.
- Nutrition day labels reuse the existing `my-nutrition-targets` query when available; admin route adds a `["client-nutrition-days", clientId]` query that's cached.

### Files changed
- `src/lib/nutrition-cardio.ts` — add `DEFAULT_CARDIO_PRESETS`, `applyDefaultCardio()`, `syncCardioWithNutritionDays()`, `getNutritionDayLabels()`, `findOrphanedCardio()`.
- `src/components/cardio-targets-panel.tsx` — new header actions, linked-badge per row, orphan banner, defaults confirm dialog.
- `src/components/cardio-apply-defaults-dialog.tsx` (new) — confirm + per-day-type checkboxes + update/keep mode.
- `src/components/cardio-sync-rename-dialog.tsx` (new) — per-row rename prompts.
- `src/routes/_authenticated/portal/nutrition-targets.tsx` — add "Cardio by Day" summary card.

### Out of scope this phase
- Frequency enforcement against client's training-days-per-week (already a separate concept).
- Mid-week auto-rotation of cardio per day of week.
- Phase-3 items: workout warm-up protocols, FAQ buttons, history view, etc.

### Testing checklist (covered)
All 16 checklist items from the request are covered by the steps above. Mobile layout from Phase 1 stays — only adding rows/badges that already use `flex-wrap` patterns.
