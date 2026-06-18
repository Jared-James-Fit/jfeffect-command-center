## 4c.2b — Replace member workout monolith with `WorkoutDayView` shim

**✅ DONE.** Member route is now a 70-line shim mounting `<WorkoutDayView adapter={memberAdapter} navigation={{ backTo: "/m/my-plans/$enrollmentId", listPath: "/m/my-plans/$enrollmentId", messagesPath: "/m/support" }} />`. The 657-line monolith (DTO queries, custom heartbeat with `m-hb-*` keys, `m_log_set`/`m_complete_workout`/`m_uncomplete_workout` offline handlers) is deleted. WorkoutDayView's heartbeat block now derives ping shape from `adapter.kind` + `adapter.ref.enrollmentId` so members send `{ kind: "member", enrollmentId, weekIndex, dayIndex }` while portal stays on `{ kind: "client", dayId }`. Note on `messagesPath`: members have no dedicated inbox, so coach-contact CTAs route to `/m/support`. Follow-ups for 4c.2c: (1) one-time bridge replaying old `m_*` offline queue items through the adapter, (2) acceptable one-time loss of in-flight active-duration accrued under the old `m-hb-*` keys, (3) Playwright smoke (load → log → complete → refresh) under a real member account.

### What changes

Replace the 657-line `src/routes/_authenticated/m/workouts.$enrollmentId.$week.$day.tsx` with an ~80-line route shim that:

1. Builds the member adapter (`buildWorkoutAdapter({ kind: "member", userId, ownerId: userId, enrollmentId })`).
2. Encodes `dayId = ${week}:${day}` (the shape `decodeDayId` in `member-adapter.ts` expects).
3. Mounts `<WorkoutDayView dayId search adapter navigation />` with `/m/workouts` / `/m/messages` paths.
4. Validates `search` the same way the portal route does (`readonly`, `edit`, `review` flags).

### Prerequisite change in `WorkoutDayView.tsx`

The heartbeat ping currently always passes `{ kind: "client", dayId }`. The plan's `useWorkoutHeartbeat` already accepts a `{ kind: "member", enrollmentId, weekIndex, dayIndex }` shape, so:

- Derive the ping from `adapter.kind` + `adapter.ref.enrollmentId` + decoded `dayId`. When `adapter?.kind === "member"`, send the member ping; otherwise send the existing client ping.

### Files

- **Rewrite** `src/routes/_authenticated/m/workouts.$enrollmentId.$week.$day.tsx` (657 → ~80 lines). The new shim mirrors `src/routes/_authenticated/portal/workouts.$dayId.tsx`.
- **Edit** `src/components/workout-day/WorkoutDayView.tsx` heartbeat block (~lines 564-569) to switch ping shape by adapter kind.
- **Update** `.lovable/plan.md` — mark 4c.2b ✅ DONE; note that 4c offline-queue compat (the old `m_log_set` / `m_complete_workout` / `m_uncomplete_workout` queue handlers) needs a follow-up replayer for already-enqueued items from prior deploys.

### Risk / what's deliberately left for follow-up

- **Stale offline queue payloads.** Members who left the old route with queued `m_log_set` items will lose them after this deploy because the new shim doesn't register `m_log_set` handlers — the `portal_table_upsert` handler in `WorkoutDayView` takes over for new writes. Mitigation: add a one-time bridge in 4c.2c that registers all three `m_*` handlers and re-dispatches them via the adapter, even from the shim route. Listed as a follow-up.
- **Heartbeat localStorage key change.** Old keys were `m-hb-start:*` / `m-hb-list:*`; `useWorkoutHeartbeat` uses its own keys. Any in-flight workout active-duration loses its accrued time on cutover. Acceptable one-time loss (workouts that aren't completed yet) — call it out in plan notes.

### Verification

- Run Playwright against the live preview: navigate to `/m/workouts/<enrollmentId>/<week>/<day>`, log a set, complete the workout, refresh, confirm completion persists.
- Confirm portal route still loads (`/portal/workouts/<dayId>`) — only WorkoutDayView's heartbeat block changed, behavior is unchanged for client adapter.

