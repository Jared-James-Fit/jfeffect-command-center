# Unify the workout day view (Option 2)

Goal: members and coaching clients use the **same** workout day component — same logging flow, calendar, exercise inputs, substitutions, timers, history, schedule controls. Member data stays in `member_*` tables; client data stays in `pl_*`. The adapter is the only thing that knows which one.

No data migration. No simplification. Existing logs untouched.

## Scope of "shared"

Reused as-is for both kinds:
- Workout day shell + header (block / week / day, status, sticky CTA)
- Exercise rows (target chips, set rows, autosave, RPE/RIR/load/reps, units, drop sets, warmups, timers)
- Workout complete sheet, summary, submission summary
- Exercise history sheet, rest timer, undo, offline queue, sync banner
- Calendar (week/month), schedule reschedule sheet, schedule history drawer
- Workout review / summary screen

Gated to coach/admin only (capability flags, not new branches):
- Editing the **master program template** (`canEditTemplate`)
- Coach **feedback** tools (`canLeaveCoachFeedback`)
- **Admin notes** (`canSeeAdminNotes`)
- **Assigning** programs to other users (`canAssignPrograms`)
- Coach-only **analytics** and pain/risk flags (`canSeeCoachIntel`)
- "Coach POV" audit trail (already keyed by impersonation, kept)

Members keep `canSubstituteExercise = false` only if substitution requires alternate exercises that don't exist in their static plan payload — see Phase 4 below.

## Architecture

```text
src/components/workout-day/
  WorkoutDayView.tsx        ← single shared component (current client logger body)
  ExerciseRow.tsx           ← extracted from monolith
  WorkoutDayHeader.tsx
  CompleteSheet.tsx         ← wraps existing WorkoutCompleteSheet
  ...
src/lib/workout-context/
  types.ts                  ← extend WorkoutContextAdapter
  client-adapter.ts         ← fill in logSet/completeDay/notes/results/blocks
  member-adapter.ts         ← same surface, member_* tables
  index.ts
src/routes/_authenticated/portal/workouts.$dayId.tsx
  ← thin: build client adapter from dayId, render <WorkoutDayView adapter={...} />
src/routes/_authenticated/m/workouts.$enrollmentId.$week.$day.tsx
  ← thin: build member adapter from (enrollmentId, week, day), render same view
```

`WorkoutDayView` never imports `supabase` directly and never references `pl_*` or `member_*` names. Every read/write goes through `adapter.*`.

## Adapter surface (extension of current `types.ts`)

Add the methods the logger actually needs. All return plain DTOs.

```ts
// Reads
getDay(dayId): Promise<WorkoutDay>            // title, focus, target duration, week/block context
listRows(dayId): Promise<ExerciseRow[]>        // exercise meta, targets, sort, block grouping
listRowResults(dayId): Promise<RowResult[]>    // logged sets for THIS trainee
listExerciseNotes(dayId): Promise<ExerciseNote[]>
listExerciseHistory(exerciseId, opts): Promise<HistoryEntry[]>
listClientMaxes(): Promise<MaxEntry[]>
getDayCompletion(dayId): Promise<DayCompletion | null>
getRowBlockSummaries(rowIds): Promise<RowBlockSummary[]>   // already a server fn
listCoachPainFlags?(dayId)                      // only when capabilities.canSeeCoachIntel

// Writes
upsertRowResult(input): Promise<RowResultId>
deleteRowResult(id): Promise<void>
upsertExerciseNote(input): Promise<void>
updateDayCompletion(patch): Promise<void>       // started_at / in_progress_at / completed_at / notes / actual_minutes
saveExerciseUnitPref(input): Promise<void>
notifyCoachOfFailure(input): Promise<void>      // no-op for members or routes to member support
```

Capabilities grow:
```ts
canEditTemplate: false
canEditOwnLogs: boolean
canReschedule: boolean
canSubstituteExercise: boolean
canSeeCoachNotes: boolean        // existing
canSeeCoachIntel: boolean        // NEW: pain flags, coach analytics widgets
canLeaveCoachFeedback: boolean   // NEW
canSeeAdminNotes: boolean        // NEW
canAssignPrograms: boolean       // NEW (always false in this view)
```

Members get all `canEditOwnLogs/canReschedule/canSeeCoachNotes(=false)/canSeeCoachIntel(=false)/canLeaveCoachFeedback(=false)/canSeeAdminNotes(=false)/canAssignPrograms(=false)`.

## Phases

### Phase A — Adapter surface
Extend `types.ts` with the methods above + new capability flags. Both adapters compile (member methods stub `NotImplemented` where Phase B fills them).

### Phase B — Extract `WorkoutDayView`
Move the body of `portal/workouts.$dayId.tsx` into `src/components/workout-day/WorkoutDayView.tsx`. Replace every direct `supabase.from("pl_*")` with `adapter.*`. Replace `usePortalUserId` / `client.id` lookups with `adapter.ref`. The current portal route becomes ~40 lines: resolve `dayId` → `clientId` → build client adapter → render view.

Validation: portal workout day pixel-identical to today. No member route changes yet. Build green.

### Phase C — Fill the member adapter
Implement every method against `member_plan_enrollments` / `member_set_logs` / `member_workout_completions` / `published_payload`. Encode `dayId` as `"w:d"` (already in place). Row id is `"ex:<index>"` (already in place). Stub `listClientMaxes` → `[]` (no maxes for members), `listCoachPainFlags` → `[]`, `notifyCoachOfFailure` → member support thread.

### Phase D — Switch the member route
Replace `m/workouts.$enrollmentId.$week.$day.tsx` body with: build member adapter → `<WorkoutDayView adapter={...} dayId={encodeDayId(week, day)} />`. Keep route file path/URL identical. Keep existing offline queue handlers (now driven by adapter writes).

### Phase E — Substitutions, reschedule scopes, history
- Substitutions: add `adapter.substituteExercise(rowId, newExerciseId)`. Client: existing flow. Member: gated off via `canSubstituteExercise=false` (the menu item hides). Re-enable later if/when member plans support alternates.
- Reschedule scopes: fill `this_week_only / all_future_weeks / entire_schedule` on both adapters (already wired for `this_workout_only`).
- `ExerciseHistorySheet` already accepts an adapter prop — confirm and clean.

### Phase F — Flag flip + cleanup
- Delete dead code paths in the old member tracker.
- Keep both legacy data tables. Keep both log tables. No data migration.
- Smoke test: log a member workout end-to-end and a client workout end-to-end against the same component.

## What stays untouched

- `pl_*` tables, `member_*` tables, RLS, GRANTs, server functions for actual writes.
- `WorkoutsExperience` calendar (already shared shape, but unused for members today — wire in Phase D).
- Auth, role gating, route gates.
- Existing member set logs and client set logs.

## Risk + mitigation

- **2300-line file split.** Do it mechanically — move blocks, replace `sb.from(...)` with `adapter.*`, keep behaviour. No re-styling, no UX changes in this pass.
- **Member feature parity gaps** (no maxes, no substitutions, no coach notes). Surfaced via capability flags; UI hides the affected controls rather than crashing.
- **Offline queue**: keep the existing `m_*` and client queue handlers; adapter calls them. No protocol change.
- **Coach POV / impersonation**: shared view honors `useClientImpersonation()` exactly as today; the adapter is built from the impersonated user when active.

## Out of scope for this batch

- Sharing the *coach-side* workout editor.
- Member program library / "assign program" UI.
- New analytics widgets for members.

After approval I'll execute Phase A + B in the next turn (adapter extension + extracting `WorkoutDayView` with portal still pointing at it), then C/D, then E/F.
