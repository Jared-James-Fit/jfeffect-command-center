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

### Turn 3 — Member adapter raw-shape implementation

- Implement `listRowsRaw` / `listRowResultsRaw` / `getDayRaw` on `member-adapter.ts` by reading `member_*` tables and reshaping into the `PlRowRaw` shape WorkoutDayView expects (column-name + nested-relation alignment).
- Unit test coverage in `src/test/member-adapter.test.ts` for at least the row mapping.

### Turn 4 — Mount WorkoutDayView under the member route + writes via adapter

- Steps 3 + 5 + 6 from the original plan: route writes (`startWorkout` / `saveDraft` / `completeWorkout` / `upsertRowResult` / `deleteRowResult`) through the adapter.
- Replace `m/workouts.$enrollmentId.$week.$day.tsx` (657 lines) with `<WorkoutDayView adapter={memberAdapter} navigation={memberNav} />`.
- Capability-gate admin-only UI (`isImpersonating` card, coach intel).
- Playwright smoke after this turn.

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
