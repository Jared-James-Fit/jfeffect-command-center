## Where we are

Phase 1 (data + server functions + cron) already shipped:
- `coach_task_definitions`, `client_task_overrides`, `client_task_occurrences` tables
- `src/lib/action-centre.functions.ts` (list / complete / next / setTimeZone)
- `/api/public/hooks/action-centre-tick` for status transitions

Phases 2, 3, 4 are still open. Rather than mash them into one turn (high risk of breakage across portal + admin + rename sweep), I'll ship them as three focused follow-ups. Reply **"go"** and I start Phase 2.

---

## Phase 2 — Client Action Centre UX (next)

Files:
- `src/components/portal/action-centre.tsx` — consume `listActionCentre`, render server-provided chip + tone, priority-sorted, optimistic remove on complete, "You're all caught up" empty state.
- `src/components/portal/action-task-sheet.tsx` (new) — premium bottom sheet router by `task_type`:
  - `weekly_checkin` / `nutrition_review` / `custom_form` → embed existing form flow (deep-link into `nf_forms` runner).
  - `progress_photos` → existing uploader component.
  - `bodyweight` → inline number entry reusing `MemberBodyweightCard` mutation.
  - `technique_review` (Coach Feedback) → video + notes + reply + mark viewed.
- `src/routes/_authenticated/portal/index.tsx` — swap ad-hoc props for `listActionCentre` query, call `setClientTimeZone` quietly on mount when device tz differs.
- On success: call `completeTaskOccurrence`, remove row optimistically, refetch.

## Phase 3 — Admin scheduling UI

Files:
- `src/routes/_authenticated/admin/coaching/schedules.tsx` (new) — grid of task types with dummy-proof form (Auto toggle, Frequency, Due Day, Due Time, TZ mode, Reminder Timing checkboxes). Writes `coach_task_definitions`.
- New tab in `src/routes/_authenticated/admin/clients.$id.tsx` — "Task Schedule": effective schedule per task type, per-task Override toggle, Reset-to-default button. Writes `client_task_overrides`.
- Server fns added to `action-centre.functions.ts`: `upsertTaskDefinition`, `upsertTaskOverride`, `resetTaskOverride`, `listAllEffectiveSchedules`.
- Coach view-mode toggle (`viewTz: client|coach`) persisted in `admin_dashboard_prefs`; admin due-date formatter reads it.

## Phase 4 — Coach Feedback rename & polish

- Rename client-facing "Lift Review(s)" strings → "Coach Feedback" (labels only, DB unchanged). Grep sweep across portal/member surfaces.
- Coach Feedback sheet: title like "Coach reviewed your squat", video, exercise chip, notes, reply box, "Mark as viewed", swipe between unseen items.
- QA pass: safe-area, 44px targets, aria-label on chips, iPhone SE / Pro Max / iPad.

---

## Technical notes

- No new deps — existing Intl-based tz helpers cover all date math.
- All new tables already have RLS + GRANTs from Phase 1.
- Optimistic UI uses TanStack Query `setQueryData` on the `["action-centre", clientId]` cache.
- Rename in Phase 4 touches labels/JSX only — no route, table, or column renames.

Reply **"go"** to start Phase 2, or tell me to reshape scope.