## Scope

This request spans 8 major areas across the existing workout stack (`WorkoutDayView` 2,607 lines, `QuickSwapButton` 703 lines, client + member adapters ~1,500 lines, `WorkoutsExperience` 821 lines, plus scheduling/timezone logic). Doing it all in one pass is high-risk and expensive. I propose phased delivery, with QA pause after each phase as you requested.

I also want to flag: **items 4 (estimated time), 5 (actual duration), 6 (completion quality badge), and partial completion stats already exist** in the codebase (`workout-completeness.ts`, `member_workout_completions` columns like duration/sets/volume, `WorkoutRestTimer` component). They're built but not always surfaced in the UI. The fixes are mostly wiring, not new systems.

---

## Phase 1 — Reliability fixes (ship first, then QA pause)

**1. Swap persistence (the actual reported bug).**
- `quick-swap.functions.ts` only writes to `pl_exercise_rows`. For **members**, rows are synthetic `ex:<index>` ids backed by `member_plan_enrollments` JSON — `applySwap` silently no-ops (or 500s) and the UI never updates. Toast lies.
- Fix: branch `applySwap` / `getSwapImpact` by adapter kind. Add a member path that persists the swap into the enrollment's plan structure (new column or override map on `member_plan_enrollments`, applied at adapter read time).
- Invalidate the correct query keys for both contexts after success; verify the row re-renders with the new exercise name + media.
- Verify with Playwright on `/m/workouts/...`.

**2. Workout "not showing up" audit.**
- Audit `getEnrollmentSchedule` + `getClientWorkouts` + `workout-today.ts` for timezone handling (member tz vs UTC vs coach tz), week rollover, and day-of-week math. Produce a written diff of any drift bugs and fix them.
- Add a "Today" pinned card on `/m` and `/portal/workouts` that uses the same resolver everywhere.

**Pause for QA here.** You confirm 1 & 2 are clean before I touch the rest.

---

## Phase 2 — Visible timers + status bar

**3. Pinned Workout Status Bar** (persists across the workout page, sticky top):
   `Chest Day | 5/8 Exercises | 18/27 Sets | 43:21`
   - Workout timer starts on first "Start Set" tap (or explicit **Start Workout** if none logged yet) and is stored in `member_workout_completions.started_at` / `pl_day_completions.started_at` so refresh/reload preserves it.
   - Exercise/set counters derive from existing `workout-completeness.ts`.

**4. Auto rest timer after set log.**
   - `WorkoutRestTimer` already exists. After a set is logged, auto-mount it inline with a one-tap "Start 2:00 Rest" button using the assigned rest (`pl_exercise_rows.rest_seconds` → fallback to category midpoint). Presets: 30s/60s/90s/2m/3m/5m.
   - Visible without any menu dive.

---

## Phase 3 — Pre/post workout surfaces

**5. Estimated time pill** on the workout-open screen: `sets × (avg_set_seconds + rest_seconds)` using a single helper in `workout-completeness.ts`.

**6. Completion summary screen** (already-persisted data, just surface it):
   - Duration, sets logged X/Y, exercises X/Y, total volume.
   - Quality badge 🟢/🟡/🔴 driven by existing `categorizeLoggingQuality()`.
   - Block "Mark Complete" or require confirm when < 75% so members can't fake completions.

---

## Out of scope unless you confirm

- Coach-side "assign default rest per exercise" UI — column already exists (`pl_exercise_rows.rest_seconds`); the editor surface for it is a separate task.
- Redesigning the workout list page beyond adding the Today card.

---

## Technical notes

- Single source of truth: extend `WorkoutContextAdapter` with `applySwap`, `getStartedAt`, `setStartedAt` so both `client-adapter` and `member-adapter` implement the same contract. No parallel system, no duplicated components — `WorkoutDayView` stays the only workout UI.
- New DB column likely needed: `member_plan_enrollments.row_overrides jsonb` (or a small `member_exercise_swaps` table) to persist member swaps without forking the plan template. Migration will include `GRANT`s + RLS.
- All toast confirmations driven by mutation `onSuccess`, never optimistic-only, so "did it save?" is always truthful.

---

## Recommended next step

Approve Phase 1 only. I'll implement, run Playwright against `/m/workouts/...` for the swap repro and a date/timezone audit, then hand back for QA before starting Phase 2.