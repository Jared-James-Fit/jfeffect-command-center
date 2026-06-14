# Multi-Block Exercise Prescriptions

This is a large structural change: schema, builder UI, client logger, copy/duplicate, calculations, and legacy migration. Posting the plan first because it touches the two largest files in the app (builder ~2.3k LOC, logger ~1.9k LOC) and the core `pl_exercise_rows` / `pl_row_results` / `member_set_logs` data model.

## Goals

- One exercise card holds an ordered list of **prescription blocks** (Straight, Top, Backoff, Ascending, Drop, Warm-up, Custom).
- Every block's inputs are visibly editable inline (no modal-only config, no note-only blocks).
- Every programmed set/drop produces its own client logging row with weight/reps/RPE/RIR/completion.
- Legacy single-prescription rows continue to work without data loss.

## Data Model

New tables, additive — `pl_exercise_rows` keeps its current columns so legacy reads still work.

```text
pl_exercise_blocks
  id uuid pk
  row_id uuid fk → pl_exercise_rows(id) on delete cascade
  sort_order int
  block_type text   -- straight|top|backoff|ascending|drop|warmup|custom
  label text
  -- prescription (nullable; only relevant fields used per type)
  sets int
  reps_text text
  rpe text, rir text
  load_type text    -- fixed|pct_1rm|rpe_choice|rir_choice|pct_below_ref|kg_below_ref|pct_of_ref|manual|none
  load_value numeric
  load_unit text    -- kg|lb|%
  reference_block_id uuid fk → pl_exercise_blocks(id) nullable
  rest_seconds_override int
  tempo text
  amrap bool
  notes text
  config jsonb      -- type-specific extras (ascending mode, generator params, etc.)
  created_at, updated_at

pl_block_set_rows         -- explicit ascending rows + warm-up rows
  id, block_id fk, sort_order, reps_text, load_value, load_unit, rpe, rir, amrap

pl_block_drop_stages       -- drop-set stages after the initial set
  id, block_id fk, sort_order, reduction_type, reduction_value,
  reps_text, rpe, rir, amrap, rest_seconds

member_set_logs           -- ADD nullable columns:
  block_id uuid (nullable, fk pl_exercise_blocks)
  set_row_id uuid (nullable, fk pl_block_set_rows)
  drop_stage_id uuid (nullable, fk pl_block_drop_stages)
  -- existing (row_id, set_index) stay populated for legacy/compat
```

All new tables get the standard `GRANT … TO authenticated` + `service_role`, RLS enabled, and policies mirroring `pl_exercise_rows` (coach owns via day→week→block→template; client reads via enrollment).

## Legacy Compatibility

- No backfill required at write time. On read, if a row has zero blocks, the UI materializes a virtual "Straight Sets" block from the existing `sets/reps_text/rpe/rir/load_*/rest_seconds/tempo/percentage*` columns.
- First time a coach edits that exercise, we persist that virtual block to `pl_exercise_blocks` and stop reading the legacy columns for that row (legacy columns retained as fallback / for old client logs).
- `member_set_logs` without `block_id` keep rendering against the legacy row (current behavior).

## Builder UI (`program-library_.$templateId.tsx`)

- Replace the single prescription grid inside `ExerciseCard` with a `<BlockList>` containing one `<BlockEditor>` per block.
- `BlockEditor` props: `block`, `siblings` (for reference dropdown), `onChange`, `onDuplicate`, `onDelete`, `onMove`.
- Header: drag handle, type selector, editable label, collapse toggle, ⋮ menu (duplicate / move up / move down / delete).
- Collapsed: one-line summary (e.g. `Backoff · 3 × 5 · −10% from Top Set · RPE 7`).
- Expanded: type-specific input grid using existing `Field` / compact input styling and the existing tokens (`bg-builder-inset`, `border-builder-card-border`).
- `+ Add Set Block` button at the bottom of the card.
- Per-type input matrices implemented exactly as spec:
  - Straight, Top, Backoff (with reference-block dropdown + reduction type + value), Ascending (Explicit Rows + Generated Progression w/ "Convert to Editable Rows"), Drop (initial + ordered drop stages with `+ Add Drop Stage`), Warm-up (explicit rows), Custom (full field set).
- Load type selector always renders its dependent value/unit inputs immediately.
- Inline validation: zero sets, negative reps, ≥100% reductions, self-reference, forward-reference, empty ascending, drop without initial.

## Client Logger (`portal/workouts.$dayId.tsx` + `client-block-view.tsx`)

For each exercise:
1. Load blocks for the row. If none → synthesize one Straight block from legacy fields.
2. For each block, expand to logging rows:
   - Straight/Top/Backoff: N rows (`sets` count), each `{ block_id, set_index }`.
   - Ascending explicit: one row per `pl_block_set_rows` entry, keyed by `set_row_id`.
   - Ascending generated: rows derived from generator (then on save coach should convert; for now we materialize N transient rows by set_index).
   - Drop: 1 initial row + one row per `pl_block_drop_stages`, keyed by `drop_stage_id`.
   - Warm-up: rows from `pl_block_set_rows`, visually de-emphasized; not counted as working volume.
3. Each row renders the same input cluster currently used (weight / reps / RPE / RIR / complete) — reusing existing completion + autosave + unit-toggle + suggested-load helpers.
4. Suggested-load calculation:
   - Resolve reference block's first completed logged set (or its prescribed weight).
   - Apply reduction (`pct_below_ref`, `kg_below_ref`, `pct_of_ref`, etc.) using existing rounding helper.
   - Show "Complete Top Set to calculate backoff load" placeholder when the reference has no completed load yet.
   - Do not overwrite the client's manually entered weight on recompute.

## Copy / Duplicate / Reorder

Extend the existing template/day/week copy paths (`pl-bulk.functions.ts`, `pl-template-blocks.ts`, duplicate-exercise/day handlers) to:
- Deep-copy `pl_exercise_blocks`, `pl_block_set_rows`, `pl_block_drop_stages` per copied row.
- Build an `oldBlockId → newBlockId` map and remap every `reference_block_id` so copied backoffs point at the copied top set, never the original.

## Files (high-level)

- New migration: `supabase/migrations/<ts>_exercise_blocks.sql` (tables + RLS + grants).
- `src/integrations/supabase/types.ts` — regenerate types (already a generated file; will be edited).
- New: `src/lib/exercise-blocks.ts` — types, legacy synthesizer, suggested-load resolver, validation, copy helpers.
- New: `src/components/builder/block-editor.tsx`, `block-list.tsx`, `block-type-fields/*.tsx` (one per type).
- Edit: `src/routes/_authenticated/admin/program-library_.$templateId.tsx` — swap single prescription grid for `<BlockList>`.
- Edit: `src/routes/_authenticated/portal/workouts.$dayId.tsx` and `src/components/client-block-view.tsx` — per-block logging rows + suggested-load.
- Edit: `src/lib/pl-bulk.functions.ts`, `src/lib/pl-template-blocks.ts`, any duplicate/copy server fns — deep-copy + remap references.
- Edit: `src/lib/exercise-metadata.ts` is **not** touched — purpose/colour logic stays.

## Out of Scope (explicit)

- No change to competition-lift colour grouping or Primary/Secondary/Tertiary derivation.
- No change to exercise selection, video, substitutions, instructions, accent colours, autosave cadence, or unit-toggle behaviour beyond plumbing per-row.
- Block-level rest/tempo override only — exercise-level defaults stay where they are; "Inherited from exercise" affordance added.

## Rollout / Risk

- Builder file is 2.3k LOC and logger is 1.9k LOC; the safer path is to land this as **one PR that ships behind nothing** because the schema is additive and the UI swap is contained to the prescription grid inside each card. No feature flag — legacy synthesizer guarantees existing exercises render identically until the coach edits them.
- Heaviest risks: copy/remap correctness and suggested-load recompute not stomping on user input. Both have explicit handling above and will be exercised by the required test cases.

## Estimated Effort

This is roughly a full day of focused work (migration + ~1500 new LOC + ~600 LOC of edits in the two big files + the copy paths). I want to confirm scope before I start — once I begin, the intermediate states will be large.

**Approve this plan and I'll implement it end-to-end, or tell me which slice to ship first** (e.g. "schema + builder only, logger next turn", or "Straight + Top + Backoff first, Ascending/Drop/Warm-up after").
