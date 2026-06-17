# Shared Workout Completion & Review — Plan

This is a multi-phase consolidation, not a single edit. I'll audit first, then refactor onto one shared completion/review pipeline used by both coaching clients and membership users.

## Phase 0 — Audit (read-only, no code changes)
Goal: produce a written map of what exists today before touching anything.

- **Client workout flow:** find the active workout page, Finish action, completion writer, review submit/edit, duration tracking, logging-quality calc, analytics writer, notifications.
- **Member workout flow:** find the equivalents. Identify whether members use `member_workout_completions`, `member_set_logs`, `member_plan_*` (separate pipeline) or already share `pl_*` tables.
- **Tables in scope (from schema):** `pl_days`, `pl_exercise_rows`, `pl_row_results`, `pl_day_completions`, `pl_workout_feedback`, `pl_assignment_operations`, `member_plans`, `member_plan_enrollments`, `member_plan_day_schedule`, `member_set_logs`, `member_workout_completions`, `pl_block_set_rows`, `logged_set_edit_audit`.
- **Output:** short audit note in chat listing: shared vs forked code paths, shared vs forked tables, fields already present vs missing for the spec (started_at, completed_at, elapsed/active duration, logging_percentage, logging_quality, completed_with_missing_logs, review edit metadata), and any duplicate-write risks.

## Phase 1 — Data model (single migration)
Only add what's missing. No destructive changes. No backfill that rewrites history.

- Add to the completion record (whichever table is the single source of truth after audit — likely `pl_day_completions`, mirrored on `member_workout_completions` only if the audit shows members are not yet on `pl_day_completions`):
  - `started_at`, `completed_at`, `last_activity_at`
  - `elapsed_duration_seconds`, `active_duration_seconds` (nullable)
  - `logging_percentage` (numeric), `logging_quality` (enum: fully/mostly/partially/no_log)
  - `required_sets_count`, `logged_sets_count`, `skipped_exercises_count`
  - `completed_with_missing_logs` (bool), `completion_source` (text)
- Review record (`pl_workout_feedback` if it's the existing review table, otherwise a new `workout_reviews`):
  - `review_submitted_at`, `review_last_edited_at`, `review_edit_count`, `review_updated_by`
  - **Unique constraint:** one current review per (user_id, workout_instance_id).
- Idempotency: unique constraint on (user_id, workout_instance_id) for completion record.
- GRANTs + RLS policies for any new tables; existing tables keep their policies.

## Phase 2 — Shared backend (server functions)
One module, used by both roles. Role differences are permission checks only.

- `src/lib/workout-completion.functions.ts`
  - `finishWorkout({ instanceId })` — idempotent UPSERT on completion, computes logging_percentage / logging_quality from `pl_row_results` against `pl_exercise_rows` prescription rules (load+reps / bodyweight / timed / distance / RPE only when required), writes duration, sets `completed_with_missing_logs`.
  - `updateWorkoutLog({ instanceId, sets })` — writes set logs, then recomputes completeness on the existing completion row (no new completion, no new notification).
  - `submitOrEditReview({ instanceId, rating, notes, ... })` — UPSERT on review by (user_id, instance_id); first write sets `review_submitted_at`, subsequent sets `review_last_edited_at`, increments `review_edit_count`. Never re-completes the workout.
  - All three protected by `requireSupabaseAuth` and a permission helper that checks: (a) user owns the instance (client or member), (b) or coach/admin has access via existing role checks.
- `src/lib/workout-duration.ts` — pure helpers for elapsed vs active duration, overnight clamp, format ("42 min", "1 hr 8 min").
- `src/lib/workout-completeness.ts` — pure helpers for per-exercise "is this set logged" rules + aggregate %.

## Phase 3 — Shared UI components
Replace both role-specific completion UIs with these.

- `<FinishWorkoutBar />` — sticky bottom action with states (idle / completing / completed / error+retry), single button, disabled while in-flight.
- `<CompletionSummarySheet />` — mobile sheet showing duration, sets logged / expected, %, optional rating + notes, primary "Complete Workout", secondary "Keep Logging". Handles missing-sets warning + "Complete Anyway".
- `<LoggingQualityBadge />` — compact badge/ring for Fully / Mostly / Partially / No Log.
- `<WorkoutReviewEditor />` — used both for first submission and edits; pre-fills, "Save Review Changes", optimistic save, preserves typed content on failure.
- `<CompletedWorkoutActions />` — "View / Edit Log", "View / Edit Review" on every completed workout.
- Wording adapts: if no assigned coach, neutral copy ("Anything you want to note about this workout?"); if coach assigned, "Your coach can see this".

## Phase 4 — Wire-in (replace, don't fork)
- Point the client active-workout page at the shared components/functions.
- Point the member active-workout page at the same shared components/functions.
- Delete the duplicate member completion/review code paths (keep the tables/data — only remove the duplicate code).
- Calendar View, Block View, client dashboard, member dashboard, coach client view, admin client/member view all read from the same completion + review rows; invalidate the relevant React Query keys on save.

## Phase 5 — Verify with Playwright
Run the spec's required tests against the live preview as: client, member, admin, coach-viewing-client. Capture screenshots for each state (Fully / Mostly / Partially / No Log, review submit, review edit, duration after refresh, rapid-tap idempotency, slow-network retry). Report results.

## Out of scope (won't touch this round)
- Redesign of unrelated pages.
- New analytics dashboards (existing analytics keep their inputs; we only stop double-counting).
- Bulk historical data migration (audit-only — no destructive rewrites of existing member history).
- Video/upload pipeline changes.
- Notification system rewrite (only dedupe within the completion/review path).

## Suggested execution order for this turn
Given the size, I'd like to do **Phase 0 (audit) only this turn** and report back with the concrete map + a tightened Phase 1 migration proposal. Then build Phases 1–3 next turn, Phase 4 the turn after, Phase 5 to verify. Trying to do all five in one turn will produce broken intermediate state.
