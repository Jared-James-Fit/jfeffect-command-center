## Current state (what already works)

Reading the code, much of what you described is already in place:

- A `BlockMaxesButton` already shows in the client Block Builder toolbar (`blocks.$blockId.tsx`), opens a panel with the three SBD rows (Competition Squat / Bench / Deadlift), 1RM + Training Max inputs, kg/lb unit per row, scope (block-only vs save to profile), and an "Add another lift" picker for Pause Squat, Close Grip Bench, Block Pull, etc.
- Each program row already computes `75% TM = 162.5 kg` from the maxes (`computeRowLoad` → `RowEditor`).
- "No max set" warning + inline **Set Max** button already opens a max editor.
- The button is just **not labeled "Set 1RM / TM"** and the panel is missing the bulk unit controls and per-row load-mode controls you described.
- Note: the button only appears in the **client Block editor** (`/admin/blocks/:blockId`), not the **template editor** (`/admin/program-library/:id`). Templates have no client → no maxes; that's intentional.

## What I'll add

### 1. Rename + make prominent
`BlockMaxesButton` → label **"Set 1RM / TM"**, larger button size, kept beside the Compact / Zoom / Copy controls in the canvas toolbar.

### 2. Block Maxes panel — new controls at the top
- **Main lift unit** selector: `kg / lb`. One click sets the unit on Competition Squat, Bench, Deadlift rows in the draft.
- Below it, a clear two-option radio (no on/off):
  - "Yes — update existing Squat/Bench/Deadlift rows too"
  - "No — only update the max inputs"
- When the user changes a single row's unit and a number is present, prompt:
  - "Convert the value (100 kg → 220 lb)"
  - "Keep the number (100 kg → 100 lb)"

### 3. Row-level load mode (in `RowEditor`)
Add a 3-way segmented control above the Load basis / % / Load fields:

- **Percentage-based** — keeps current behavior (basis + % + maxes → computed load).
- **Manual target load** — clears %/basis, lets admin type exact load. Sets `percentage_basis = "manual"` (already supported).
- **No prescribed load** — new basis value `"none"`; client just logs what they used.

Plus an **Override calculated** affordance: when in Percentage mode and a load is computed, an admin can click "Override" to lock a manual number for that row only. Stored in payload as `manual_override: true` + manual load value; row shows a small "Manual override" label.

### 4. Per-row unit selector beside Load
Add `kg / lb` dropdown next to the Load input. (Bodyweight / machine / time are NOT in scope for this pass — they need schema work on `pl_exercise_rows` and the client logging view; I'd ship those in a follow-up.)

### 5. Client workout view
When a row uses `"none"` basis, show "Log the load used" instead of a target.
When override is set, show the override load instead of the calculated one.
Existing `pl_row_results` logs are never touched.

### 6. What I'm NOT doing in this pass (call-outs)
- **Bulk unit actions menu** ("set this day to kg", "set this week to lb", "set selected rows", "set all rows with this exercise") — needs a new row-selection model. Significant UI work.
- **Bodyweight / machine / time** row units — needs schema changes on `pl_exercise_rows` and updates to the client logger UI.
- **Block-level / week-level bulk convert** with the convert-or-keep prompt at scale — only the per-row case is included.

If you want any of the "NOT doing" items in this pass, say which and I'll add them — otherwise I'll ship the above and we can stack the bulk tools as a second turn.

## Technical notes

- `PERCENTAGE_BASES` (`src/lib/pl-programs.ts`) gets a new `"none"` value; `computeRowLoad` returns `status: "no-load"` for it.
- `manual_override` + override load are stored in the row payload JSON (templates) and as `load_kg`/`load_lb` with `percentage_basis = "manual"` on `pl_exercise_rows` (no schema change). A small `override_of_pct` numeric is added as a free key in payload JSON for templates; for client rows we read/write it via `notes`-adjacent metadata only if needed — most cases are covered by setting basis to manual + keeping the % field visible as "was: 75% TM".
- No changes to `pl_row_results`, completed flags, or any history.
