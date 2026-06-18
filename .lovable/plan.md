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
- **4b** — Mechanical swap of the 12 `sb.*` write sites in `WorkoutDayView.tsx` to `adapter.*`, gated on `adapter` (sb fallback retained). Portal byte-identical because client adapter is passthrough.
- **4c** — Implement member-side writes against `member_set_logs` / `member_workout_completions` / `member_exercise_notes`. Replace the 657-line member route with a ~80-line shim that wires auth/heartbeat/offline queue around `<WorkoutDayView adapter={memberAdapter} navigation={memberNav} />`. Capability-gate impersonation UI. Playwright smoke.

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
