# Live Release Verification (read-only)

No changes were made. No SQL, no publish, no deploy.

## Results

**LIVE_HTTP:** 200 (https://jfeffect.com, cache-busted, `cache-control: no-cache`)

**LIVE_DEPLOYMENT_HASH:** `0abab316d28a9bcf1bb7b7e43e8dfb6464a0ea27e66e431c1b99681908315c4e` (`x-deployment-id`). This host does not expose the deployment UUID, so `194bc61e-3dc3-453b-ad96-eac72164f941` cannot be matched by id.

Live entry assets: `/assets/index-DdT097Ag.js`, `/assets/index-_1Zme7Hq.js`

**PR20_MARKERS_IN_LIVE_BUNDLE: YES** — all three requested markers found in the deployed chunks:

1. `mode === "self" || mode === "coach"` — in `/assets/workouts.index-Cm5TFiKE.js`:
   `ue=a==="self"||a==="coach"` (the `canReschedule` gate), matching `WorkoutsExperience.tsx:252`.
2. Coach ScheduleManager uses `useMoveWorkout(clientId)` — in `/assets/ScheduleManagerShell-B0THxXj7.js`:
   component signature `({clientId:e,mode:t})` then `a=Fs(e)`, where `Fs` is imported from
   `./ScheduleHistoryDrawer-GFRFJNS7.js` — the chunk that contains the hook's unique toast string
   `...put it back` plus its exact invalidation key set (`my-workouts`, `client-schedule`,
   `scheduled-workouts`, `week-sched-data`, `schedule-manager`, `today-dashboard`). The drop handler calls
   `a.mutate({target:{scheduledWorkoutId:y.instanceId,dayId:y.dayId,fromDate:...},newDate:he(_,"yyyy-MM-dd")})`,
   matching `ScheduleManagerShell.tsx:32,69-71`. No direct `moveScheduledWorkout(` call in the shell chunk.
3. Completed cards non-draggable — in the same chunk:
   `draggable:i&&!_.comp?.completed_at`, matching `ScheduleCalendar.tsx:437`
   (`draggable={canEdit && !chip.comp?.completed_at}`).

Source compared against: local clean tree, HEAD `3bec95b8` (PR #20-equivalent, restored tree).

**FINAL CONCLUSION: LIVE** — the production site is serving a bundle that contains the PR #20 coach-calendar
drag/drop code. Caveat: the deployment *UUID* `194bc61e-…` itself remains NOT VERIFIED (no deployment-status
API is reachable from here and the live host only returns a content hash), so the match is by code evidence,
not by deployment id.
