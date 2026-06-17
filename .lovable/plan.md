## Phase 4a — Unify `WorkoutDayView` via the existing adapter seam

The good news: the abstraction is already designed. `WorkoutDayView` accepts an `adapter: WorkoutContextAdapter` prop, but line 257 does `void adapter;` and the component runs a hardcoded `kind: "client"` + `sb.from("pl_*")` path. Both `client-adapter.ts` and `member-adapter.ts` are fully implemented and unused. The member app currently duplicates the entire UI in `workouts.$enrollmentId.$week.$day.tsx`.

This phase wires the adapter through without behavior change for the portal, then deletes the member duplicate.

### Steps

1. **Make `adapter` required.** Change the prop from optional to required. Remove `void adapter;`.

2. **Replace direct queries with adapter calls** (~12 `useQuery` blocks in `WorkoutDay`):
   - `pl-day`, `pl-day-block`, `pl-day-results`, `pl-day-completion`, `pl-day-exercise-notes`, `pl-workout-feedback` → `adapter.getDay`, `adapter.getDayBlock`, `adapter.listRowResults`, `adapter.getCompletion`, `adapter.listExerciseNotes`, `adapter.getFeedback`
   - `client-exercise-unit-prefs`, `client-exercise-unit-history` → adapter equivalents (verify they exist; add if missing)
   - Query keys include `adapter.kind` + `adapter.ref` so caches don't collide

3. **Replace hardcoded `kind: "client"` server-fn calls** (lines 454, 468, 481, 654, 1040, 1103):
   - `startWorkoutSrv`, `saveDraftSrv`, `completeWorkoutSrv`, `useWorkoutHeartbeat` → use `adapter.kind` (or move these into adapter methods if cleaner)

4. **Inject navigation paths as props** to remove the four `/portal/…` hardcodes (lines 772, 784, 1148, 1186, 1206, 1239):
   - Add `navigation: { backTo, listPath, messagesPath }` to props
   - Portal passes `/portal/workouts` + `/portal/messages`; member passes `/m/workouts` + `/m/messages`

5. **Gate admin-only UI via capabilities, not raw hook**:
   - `isImpersonating` status-override card (848–910) → `adapter.capabilities.canSeeCoachIntel`
   - `WorkoutCompleteSheet` suppression (1070) → `!adapter.capabilities.canSeeCoachIntel`

6. **Push adapter into `ExerciseBlock` and `SetRow`** so `applyToRemaining` (1369–1373) and `SetRow`'s direct `pl_row_results` writes (~1650–1950) go through `adapter.upsertRowResult` / `adapter.deleteRowResult`. Sub-components stop needing `clientId`.

7. **Update the lone call site** `src/routes/_authenticated/portal/workouts.$dayId.tsx` to construct a `client-adapter` and pass it + portal navigation paths.

8. **Replace the member route** `src/routes/_authenticated/m/workouts.$enrollmentId.$week.$day.tsx` to render `<WorkoutDayView adapter={memberAdapter} navigation={memberNav} />` instead of its monolithic copy. Delete the duplicate UI code.

9. **Smoke test** via Playwright on portal + member workout pages — load a day, log a set, mark complete; verify both flows.

### Technical notes

- Branch off the existing `WorkoutContextAdapter` interface in `src/lib/workout-context/types.ts` — extend only if step 2 finds missing methods (unit prefs/history).
- Query keys must include `[adapter.kind, adapter.ref.ownerId, adapter.ref.enrollmentId ?? null]` to avoid cross-pollination between portal and member caches.
- Keep the same `WorkoutDayViewSearch` shape — no URL changes.
- No DB migrations.

### Out of scope

- No new features, no styling changes, no schema changes
- Member route's surrounding navigation (week picker, etc.) stays put — only the day-view body gets swapped
- The 92 security warnings (separate cleanup phase)

### Risk

Medium — touches a ~2000-line file, but the adapter interface is already proven by `member-adapter.ts` running the parallel member tracker. Biggest risk is missed `kind: "client"` strings in deep sub-components; ripgrep sweep at the end catches those.
