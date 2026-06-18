## Path B — Adapter as data-source switch

Goal: `WorkoutDayView` keeps consuming raw `pl_*`-shaped rows, but gets them through `adapter.*` instead of `sb.from("pl_*")` directly. Member adapter reshapes `member_*` into the same row shape. Once reads + writes route through the adapter, we can mount `WorkoutDayView` under the member route and delete the 657-line monolith.

Split into 4 turns so each lands in a working state with a clear verification step.

---

### Turn 1 — Adapter contract: add raw read surface ✅ DONE

- In `src/lib/workout-context/types.ts`, add three new methods alongside the DTO ones (do NOT remove the DTO methods — keep them as future-cleanup):
  - `listRowsRaw(dayId): Promise<PlRowRaw[]>`
  - `listRowResultsRaw(dayId): Promise<PlRowResultRaw[]>`
  - `getDayRaw(dayId): Promise<PlDayRaw>`
- Define `PlRowRaw` / `PlRowResultRaw` / `PlDayRaw` as the exact select shape `WorkoutDayView` already consumes (mirroring the current `sb.from("pl_exercise_rows").select(...)` projection — `exercises(name, video_url, …)`, `warmup_protocol_id`, `actual_reps`, `normalized_lb`, etc.).
- Implement on `client-adapter.ts`: direct `sb.from("pl_*").select(...).eq("day_id", dayId)` passthroughs — byte-identical to what `WorkoutDayView` does today.
- Stub on `member-adapter.ts`: throw `NotImplemented` (turn 3 fills these in).
- No `WorkoutDayView` changes yet → portal behavior unchanged, build green.

### Turn 2 — Swap WorkoutDayView reads to `adapter.*Raw` ✅ DONE

- Swapped day/rows/results reads to `adapter.getDayRaw` / `listRowsRaw` / `listRowResultsRaw` when an adapter is provided; sb.* fallback retained for safety.
- Cache keys append `adapter.kind` + `adapter.ref.ownerId` as a suffix so existing `invalidateQueries({queryKey: ["pl-day-results", dayId]})` prefix-matches still work while client and member POVs stay isolated.
- Writes still on `sb.*` for this turn (deferred to turn 4).
- Portal behavior identical (client adapter is byte-for-byte passthrough).

### Turn 3 — Member adapter raw-shape implementation ✅ DONE

- Implemented `getDayRaw` / `listRowsRaw` / `listRowResultsRaw` on `member-adapter.ts`. Pure reshape helpers (`memberDayToPlDay`, `memberRowToPlRow`, `memberLogToPlRowResult`) are exported and unit-tested so future schema drift is caught quickly.
- Member rows always take the manual-load path (`manual_override=true`, `percentage_basis="none"`) since membership programs prescribe absolute loads only. `week_id` is null so WorkoutDayView's pl_weeks/pl_blocks follow-ups degrade silently (no block concept for members).
- 16 unit tests pass (`src/test/member-adapter.test.ts`), covering capabilities, dayId encoding, reschedule fan-out, and all three raw reshapes (lb/kg variants, exercise-id fallback, log shape).

### Turn 4 — split into 4a / 4b / 4c

- **4a ✅ DONE** — Adapter contract already covered all 12 WorkoutDayView write sites (`upsertRowResult` / `deleteRowResult` / `upsertExerciseNote` / `updateDayCompletion`). Only gap was a `listUnitPrefs(exerciseIds)` read for `client_exercise_unit_prefs`. Added to `types.ts`, implemented as passthrough on `client-adapter.ts`, member adapter returns `[]` (memberships don't persist per-exercise unit prefs).
- **4b ✅ DONE** — Added raw passthrough write surface (`upsertPlRowResultRaw` / `upsertPlExerciseNoteRaw` / `upsertPlDayCompletionRaw`) on the adapter contract, mirroring the raw-read approach. Client adapter passes payloads through byte-identically; member adapter throws `NotImplemented` (4c fills them). Introduced `WorkoutAdapterContext` so deeply-nested inner components (ExerciseBlock, ExerciseNotesSheet, SetRow) can branch on adapter via `useOptionalAdapter()`. All 12 write sites in `WorkoutDayView.tsx` now route through `adapter.upsertPl*Raw` when an adapter is mounted; sb fallback retained. Only remaining `sb.*` write is the `portal_table_upsert` offline-queue replay handler (intentional — deferred to 4c so the queue grows membership awareness alongside member writes). Portal route ships unchanged because the client adapter is byte-identical passthrough.
- **4c (partial) ✅ DONE — member writes + queue routing.** Implemented `upsertPlRowResultRaw` / `upsertPlDayCompletionRaw` on `member-adapter.ts` against `member_set_logs` and `member_workout_completions` (upsert on the existing natural-key unique constraints; `entered_value`+`entered_unit` is canonical, `load_lb` / `load_kg` mirrored for downstream reads). `upsertPlExerciseNoteRaw` is an intentional no-op — member plans have no per-exercise notes table; notes ride along on the set log. WorkoutDayView's `portal_table_upsert` queue handler now routes through the active adapter when one is mounted (so a queued `pl_row_results` payload replays against `member_set_logs` under a member adapter), falling back to `sb.from()` only when no adapter is present. Member adapter tests still green (16/16). Portal route unchanged (client adapter is byte-identical passthrough). No `NotImplemented` throws remain on the member adapter's write surface.
- **4c (remaining)** — Replace the 657-line `m/workouts.$enrollmentId.$week.$day.tsx` route with a ~80-line shim mounting `<WorkoutDayView adapter={memberAdapter} navigation={memberNav} />`. Open questions to resolve before cutting over: (a) WorkoutDayView reads `clients` by `user_id` for the active trainee — members have no `clients` row, so the inner `useQuery({ queryKey: ["my-client", …] })` needs an adapter-aware shim that returns `{ id: enrollmentId, full_name, preferred_weight_unit }` for members. (b) Heartbeat / active-duration logic currently lives in the member route's `m-hb-*` localStorage keys; it should move into a shared `useWorkoutHeartbeat` hook keyed by the adapter so both routes share one source of truth. (c) Capability-gate the impersonation status bar (`canSeeAdminNotes` / `canLeaveCoachFeedback`) so members never see the "Set workout status" admin card. (d) Playwright smoke covering: load day, log a set, complete workout, refresh — all under a member account.

 - **4c.2a ✅ DONE** — Prep complete. (a) `getActiveSubject()` on the adapter contract already returns a synthetic `{id, full_name, preferred_weight_unit}` row (turn 2 added this), and WorkoutDayView already reads via `adapter.getActiveSubject()` when an adapter is mounted — no extra shim needed. (b) `useWorkoutHeartbeat` already exists in `src/hooks/use-workout-heartbeat.ts` with both `{ kind: "client", dayId }` and `{ kind: "member", enrollmentId, weekIndex, dayIndex }` ping shapes; WorkoutDayView consumes it with the client shape, member route shim will pass the member shape. (c) Added a defensive guard on the admin "Set workout status" card so it's hidden whenever a member adapter is mounted, even if `isImpersonating` somehow flipped true under a member context. WorkoutCompleteSheet gate at line 1166 (`!isImpersonating`) already does the right thing for members (isImpersonating is naturally false for members, so the sheet opens). No behaviour change on the portal route. Ready for 4c.2b — replace the member monolith with a thin shim.

---

### Why this split is safe

- Turn 1 is additive only — zero call-site changes, build green, portal unchanged.
- Turn 2 is a mechanical read swap behind a passthrough — verifiable by loading any portal workout day.
- Turn 3 isolates member-shape risk to one file.
- Turn 4 is the high-leverage cut — the member monolith disappears.

### Out of scope for now

- DTO normalization on adapter (we keep `listRows` / `listRowResults` DTO methods unused for now; delete in a later cleanup if no third consumer appears).
- Schema migrations on `member_*` / `pl_*`.

If you approve, I'll do Turn 1 immediately.
