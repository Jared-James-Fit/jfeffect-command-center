# Unified Workout Experience — Implementation Plan

## Strategy

- **One UI, two data backends.** The coaching workout components (workout day page, exercise card, logging row, rest timer, RPE/RIR inputs, schedule shells) are refactored to read/write through a **workout context adapter**. Members and clients render the same components; the adapter dispatches to `pl_*` (clients) or `member_*` (members) under the hood.
- **No data migration.** Existing `member_set_logs`, `member_workout_completions`, `member_plan_enrollments`, and `pl_row_results` / `pl_day_completions` rows stay exactly where they are. Zero risk of touching completed logs.
- **Feature flag `unified_workouts.enabled`** stored in `app_settings`. Default off. Admin toggle in `/admin`. Pilot list of user IDs (`unified_workouts.pilot_user_ids`) so we can flip Jared + one member first.

## Phase 1 — Adapter + flag (foundation, no UI change visible to users)

1. Add `app_settings` row `unified_workouts` with `{ enabled: false, pilot_user_ids: [] }`.
2. Create `src/lib/workout-context/`:
   - `types.ts` — `WorkoutContext` interface: `kind: 'client' | 'member'`, `enrollmentId | clientId`, plus the function signatures every shared component needs (`listDays`, `getDay`, `logSet`, `completeDay`, `listCompletions`, `reschedule`, `getBlocks`, `getWeeks`, etc.).
   - `client-adapter.ts` — wraps existing `pl_*` reads/writes (no behavior change).
   - `member-adapter.ts` — wraps existing `member_*` reads/writes.
   - `useWorkoutContext(userIdOrEnrollment)` — returns the right adapter.
3. Add `useUnifiedWorkoutsFlag()` hook reading the flag + pilot list.
4. Admin UI: small card in `/admin` to toggle the flag and edit pilot list.

No user-facing change yet. Phase 1 ships safely on its own.

## Phase 2 — Refactor coaching components to use the adapter (no UX change for clients)

Convert these to take a `WorkoutContext` prop instead of querying `pl_*` directly:
- `ScheduleManagerShell`
- Workout day route view (`/portal/schedule` day drilldown + the workout logging page)
- Exercise card / set row / rest timer / RPE+RIR inputs / notes / warm-up / review
- Block/week navigation
- Completed-workout history list

Coaching clients continue using the client adapter — behavior identical. Verified by running existing client flows end-to-end against Jared's account.

## Phase 3 — Mount shared components on the membership side (behind flag)

In `/m/my-plans/$enrollmentId` and `/m/workouts/$enrollmentId/$week/$day`:
- When `unified_workouts.enabled` is true for this user → mount the shared components with the member adapter.
- When false → keep current member workout pages exactly as they are.

Pilot Jared (coaching, regression baseline) + one membership account. Verify:
- Existing member completions render in history with correct dates
- New sets log to `member_set_logs` (not `pl_row_results`)
- No member can hit any coaching-admin write (template edits etc.) — adapter gates writes by `kind`

## Phase 4 — Workout Schedule section on profiles

New component `<WorkoutScheduleSection contextRef={…} variant="simple" | "full">`:
- **Simple weekly picker** (mock you described): Mon–Sun rows with current workout name and large tap targets. Edit modal shows confirmation: `this workout only / this week only / all future weeks / entire schedule going forward`. Writes through the adapter's `reschedule` — same backend the calendar uses, so changes appear everywhere immediately.
- **Full editor** (`ScheduleManagerShell`) reachable from a "Advanced editor →" link inside the section.

Mounted on:
- Coaching client profile (admin view + client's own `/portal/account`)
- Membership profile (admin view + member's own `/m/account` and onboarding wizard step)

## Phase 5 — Cutover and cleanup (only after pilot confirms green)

- Flip flag to `enabled: true` globally (still per-user override possible).
- Remove the legacy `<MemberBlockWeekColumns>` workout-launch path and the standalone member workout page; redirect them to the shared route.
- Keep `member_*` tables and the member adapter — they are now the storage layer, not a separate UI.

## Safety guardrails (apply in every phase)

- No write that targets `member_workout_completions`, `member_set_logs`, `pl_row_results`, or `pl_day_completions` rows with `completed_at IS NOT NULL` may be issued except by the user who logged them.
- Rescheduling with "all future weeks" only moves days whose `scheduled_date >= today AND completion row IS NULL`.
- Master program templates (`pl_templates`, `member_plans`) are read-only from the workout UI for both roles — only `/admin/programs` can edit them.
- All adapter writes go through existing audit triggers (`pl_schedule_audit`, `logged_set_edit_audit`, `member_plan_audit`) — no new audit gap.

## Acceptance checks (mapped to your list)

- Member + client Workouts page identical → satisfied by Phase 2+3 (same components).
- Schedule section on both profiles → Phase 4.
- One-workout vs week vs future-weeks confirmation → Phase 4 modal.
- One source of truth across calendar/dashboard/profile → adapter, Phase 1+2.
- Completed data preserved → no migration; adapter guard above.
- Refresh/sign-out persistence → data lives in DB as today.
- Phased rollout → flag + pilot list, Phase 1.
- Mobile/tablet first → shared coaching components are already mobile-tuned.

## Technical scope summary

```text
NEW
  src/lib/workout-context/{types,client-adapter,member-adapter,index}.ts
  src/hooks/use-unified-workouts-flag.ts
  src/components/workout-schedule/{section,weekly-picker,confirm-scope-modal}.tsx
  src/components/admin/unified-workouts-flag-card.tsx
  migration: insert app_settings row 'unified_workouts'

REFACTORED (behavior-preserving for clients)
  ScheduleManagerShell + day drilldown
  Exercise card / set row / rest timer / RPE+RIR / notes / warm-up / review
  Block+week navigation
  Completed-workout history

MOUNTED ON MEMBER SIDE (behind flag)
  /m/my-plans/$enrollmentId
  /m/workouts/$enrollmentId/$week/$day

UNTOUCHED
  All *_logs, *_completions, *_results rows
  Master templates (pl_templates, member_plans)
  Auth, billing, messaging, nutrition, media
```

## What I recommend shipping this turn

**Phase 1 only.** It is safe (no user-visible change), unblocks every later phase, and lets us add the admin toggle so you can flip pilot users yourself. Phases 2–5 each get their own turn with verification against Jared's account between every step.
