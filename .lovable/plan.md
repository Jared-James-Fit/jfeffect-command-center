## What's done already (this turn)

The Meal Plan upgrade is shipped — no plan needed:
- Admin nutrition dialog: "Notes for this day" → **Meal Plan** label, taller monospace textarea (10 rows), helper text, paste placeholder showing expected format. Data column unchanged (`nutrition_target_days.notes`), so no migration.
- New `<MealPlanDisplay />` component (`src/components/meal-plan-display.tsx`) — light parser that groups by blank-line blocks and styles **Meal N**, **Daily Total**, **Approx / macro** lines, and ingredient bullets. Mobile-first spacing.
- Client portal nutrition page now renders each day's meal plan via `<MealPlanDisplay />` instead of a muted paragraph.

High Day "changes only" paste works — the parser doesn't require full meals.

## What needs your approval — autosave

Autosave is large enough that I want to lock the approach before touching all the builders. Here's the plan.

### 1. Shared autosave primitives (new — one place, reused everywhere)

`src/hooks/use-autosave.ts`
- `useAutosave({ value, onSave, delay = 800, key })` — debounces, tracks `idle | saving | saved | error | offline`, deduplicates if value unchanged, retries on failure with exponential backoff (1s → 5s → 15s cap).
- Listens to `navigator.onLine`; queues while offline and flushes on reconnect.
- Mirrors latest value into `localStorage` under `lov:draft:<key>` until server confirms; clears on success.
- `flush()` for blur/unmount, `discard()` for "discard draft".

`src/hooks/use-local-draft.ts`
- On mount, reads `lov:draft:<key>`; if present and differs from server value + server `updated_at` is newer than local → exposes `{ hasConflict, localValue, serverValue }` so the page can render the **"Unsaved draft found — Restore / Discard"** banner.

`src/components/save-status.tsx`
- Tiny inline pill: "Saved · 2s ago", "Saving…", "Unsaved changes", "Offline — will sync", "Save failed · Retry". No modals.

### 2. Client workout autosave

Targets: `src/routes/_authenticated/portal/workouts.$dayId.tsx` (and any set-row component it uses).

- Each set row keeps **local input state** (load / reps / RPE / RIR / notes). Local state is the source of truth while focused — never overwritten by refetch.
- `useAutosave` per row keyed by `set_id` → calls a new `saveWorkoutSet` server fn that updates only changed fields.
- Workout-level fields (workout notes, duration, pain notes) — single autosave instance keyed by `workout_log_id`.
- **"Mark Complete" stays an explicit button.** Autosave only writes draft fields, never `completed_at`.
- React Query: `setQueryData` to merge saved row instead of full refetch; no `invalidateQueries` on autosave success.

### 3. Admin program builder autosave

Targets:
- `src/routes/_authenticated/admin/blocks.$blockId.tsx` (Full Block Builder, weeks/days/rows, block notes)
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx` (template editor)
- Plan Library editor (`src/lib/member-plans.functions.ts` consumers under `/admin/member-plans.*`)
- Exercise row fields: sets, reps, RPE, RIR, %, %-basis, load, rest, tempo, notes
- Block / week / day metadata: names, prep/phase notes, plan description, settings

Approach:
- Same `useAutosave` per row keyed by `row_id`. Row component is `React.memo`'d on `row_id` so a sibling save doesn't re-render the focused row.
- New focused server fns that accept partial diffs: `updateProgramRow`, `updateProgramDay`, `updateProgramWeek`, `updateBlockMeta`. Each takes `{ id, patch, expected_updated_at }` and returns the new `updated_at`. If `expected_updated_at` mismatches the DB row → returns `{ conflict: true, server }`; the UI surfaces "Keep mine / Use server" inline (no destructive overwrite).
- **Linked weeks safety:** autosave path writes to the current row only — it never propagates. If the user makes a change that the existing edit-scope modal currently catches ("this week / future weeks / entire block / break link"), the autosave is deferred until the scope is picked. Concretely: the row component knows whether it's linked; for linked rows we delay the autosave timer and surface "Pending scope choice" instead of saving.
- **Publish / visibility / archive stay explicit.** Autosave writes drafts only; toggling `published`, `visible_to_*`, archive, delete, deactivate require the existing confirmation flow.

### 4. Status indicator placement

- Workout page: pinned at top-right of the workout card.
- Block builder & template editors: in the page header next to the manual Save button (kept for confidence).
- Per-row inline status only appears on error/conflict; the success state is summarized at the page level to avoid noise.

### 5. Performance rules baked into `useAutosave`

- 800ms debounce default; 1200ms for builder rows; 500ms for short fields like names.
- Patch only changed fields (`useRef` of last-saved snapshot).
- No `invalidateQueries` on autosave success — `setQueryData` only.
- Save queue is per-key; concurrent saves to the same key collapse to the latest value.

### 6. Tests (manual, in the testing checklist you wrote)

I'll run through the full Client Workout, Typing Experience, Program Builder, Network Failure, Offline, and Destructive Action checklists in the preview before declaring done.

### What I will NOT do

- Won't add a real-time multi-user CRDT layer (out of scope; basic `updated_at` conflict guard is enough).
- Won't change any current DB schema except adding `updated_at` triggers to any program-builder tables that don't already have one (I'll audit first; if all present, zero migrations).
- Won't touch the meal-plan field, FAQ, or coach-notes structure.

### Files I expect to add / edit

Add:
- `src/hooks/use-autosave.ts`
- `src/hooks/use-local-draft.ts`
- `src/components/save-status.tsx`
- `src/lib/program-builder.functions.ts` (focused diff serverFns + conflict response)
- `src/lib/workout-log.functions.ts` (per-set diff serverFn)
- One migration **only if** any target table lacks `updated_at` + `tg_set_updated_at` trigger.

Edit:
- `src/routes/_authenticated/portal/workouts.$dayId.tsx` + its set-row component
- `src/routes/_authenticated/admin/blocks.$blockId.tsx`
- `src/routes/_authenticated/admin/program-library_.$templateId.tsx`
- Plan-library editors under `src/routes/_authenticated/admin/member-plans.*` (notes/description fields)

Approve and I'll build it. If you want me to start with just **client workout autosave** first and ship admin builder autosave in a second pass, say so and I'll scope this PR down.
