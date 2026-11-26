# Set-video velocity pipeline: implementation and verification

## Scope delivered

The existing scanner now has upload-triggered `set_velocity_jobs`, three bounded attempts, a two-minute database lease, a 100-second device compute budget, cooldowns, and recovery from authorized pending jobs while the app is visible. A dedicated Web Worker runs the same decoder and tracking algorithm. No paid processor was provisioned. Existing set, video, analysis and exercise identities remain authoritative.

New physical readings require an explicitly confirmed plate diameter. Unknown scale retains pixel paths and timestamps, not fabricated metres or speed. Calibrated full-rep estimates can populate the logger with their uncertainty and approximate label. Set 3's stored example is 0.422747 m/s as the arithmetic mean, not its 0.430384 fastest rep; its diameter is unconfirmed, so it is not automatically written back. No production reading was recalibrated on an assumption.

Controls in the existing analysis screen provide automatic-read enable/disable, retry, calibration/rerun, selected clip, corrected set speed with a reason, clip/set exclusions, and analysis revision restoration. `set_velocity_history` records previous/current raw analyses and set velocity changes, including existing baselines. Automatic job commits carry a lease and reject newer reviewed reads. Typed values are preserved. Analytics read the selected effective set rather than every clip or its fastest rep; excluded velocities are suppressed in exercise analytics and Program Intelligence.

## Database changes

- `drizzle/migrations/0014_velocity_jobs_history.sql`: jobs, upload trigger, lease/retry functions, private append-only history and bounded 60-video backfill.
- `drizzle/migrations/0015_velocity_calibration_and_controls.sql`: confirmed-scale writeback, canonical clip, safe commit and correction/restore functions.
- `drizzle/migrations/0016_velocity_worker_service_grants.sql`: trusted service execution grants, with actor/video checks still required.

These migrations were applied. They affect the shared database; frontend changes remain unpublished. The first combined migration attempt was rejected and rolled back before these split migrations succeeded.

## Verification observed

- `bunx vitest run src/test/lift-analysis`: **150 passed**, including tracking, variable timestamps, frame rates, angle/occlusion, no-plate, calibrated estimates, screenshot arithmetic, partial sets, recovery, pose rules and velocity model tests. Reference fixtures explicitly declare their known 450 mm diameter; no tolerance was widened.
- Encoded `squat-real-30` fixture: auto detection requested confirmation. With the proposed ring and confirmed diameter, the browser worker and foreground results were **byte-for-byte identical**, including all three reps and their uncertainty. One observed worker read took 8.617 s, foreground 8.608 s. This is a single sample, not a p50/p95 or a rest-period guarantee.
- Worker handling of an unreadable MP4 returned `unreadable` without page errors.
- Preview build telemetry reported `build OK` after edits. No manual production build/typecheck was invoked; the platform owns those checks.
- `supabase/tests/velocity-pipeline/scenario.sql` retains rollback-only tests for enqueue, claims, calibration, arithmetic writeback, canonical clip, correction, exclusion, history, restore, cooldown and unauthorized access. **Not passed:** the sandbox SQL execution role cannot invoke the authenticated functions or assume the authenticated role. Every failed attempt was rolled back. Run this test with an appropriate test-database role before deployment.

## Remaining verification and limitations

Do not deploy yet. Real authenticated upload → analysis → logger → analytics click-through, role-isolated database tests, full regression suite and real-device iPhone/Android performance are outstanding. Latest remote GitHub main cannot be fetched or synchronized by this environment; local main began at `579f42983`, one commit ahead of the locally known `origin/main` (`4bdea8d15`). This is not proof of latest GitHub synchronization.

Durable job state is server-side, but video decoding remains on a visible device; a closed/suspended PWA cannot process it. There is no server video decoder or approved external inference service. Olympic pull/turnover/catch/jerk phase detection is unvalidated and automatic logging stays off. Pose inference remains the existing on-device MediaPipe path; synthetic geometry tests do not validate real-video joint accuracy. No new reference-device squat/deadlift footage was available. Live camera setup feedback, complete quality/manual/equipment analytics filtering, weekly/block velocity-loss views, set-value revision restoration and pipeline p50/p95 instrumentation remain unfinished.

## Rollback

Keep the unpublished frontend off production. Existing historical reads and manual values are retained. For operational rollback, disable automatic claims by revoking authenticated execution on `velocity_job_claim`, and remove only `set_velocity_upload_enqueue`; retain job/history rows and grants for private reads. Restore `_apply_video_velocity`, `set_video_analysis_save` and `set_video_analysis_delete` from the versioned pre-change migration only after review: the old writeback assumes diameter from load, so restoring it would reinstate that limitation. Do not drop history or columns, and do not rewrite logged training.
## Nov 25 2026 update: every read reaches the logger (T19)

The "analysed but not on the set" bug had two causes: the phone read an unconfirmed plate in pixels only, and `_apply_video_velocity` demanded a confirmed diameter and an exact rep count. Now an unconfirmed plate is read as the standard 450 mm and the server logs the set's speed when the plate was confirmed, the load is 60 kg+, or every rep's range fits the movement at 450 mm (`plateCheck`); the logged reps may differ by one. Reads inside the strict limits are measurements, reads inside the tolerant limits (quality.ts `SPEED_RULES`) are estimates shown "≈". Olympic lifts, presses, rows and RDL variants are enqueued (Olympic lifts log mean peak speed). `20270527101300_velocity_always_on_the_set.sql` re-queues recent pixel-only and wrongly skipped jobs and re-applies stored accepted reads. Engine `bar-path/7`. Joint tracking stays on demand (Technique tab, ~24 MB model); it is not run in the background.

## Server reader (Nov 26 2026)

Set videos no longer depend on an open phone. `.github/workflows/velocity-worker.yml`
runs `scripts/velocity-worker/worker.ts` every 30 minutes (and on demand from the
Actions tab, "Run workflow"). It authenticates to `/api/public/hooks/velocity-worker`
with the job's GitHub OIDC token; the hook verifies GitHub's signature and the
repository, branch, workflow and runner claims (`src/lib/lift-analysis/worker-oidc.ts`).

To check it:

1. Settings → Bar speed from videos (`/admin/settings/velocity`): "Server reader · last
   seen" updates on every poll; each video shows waiting / reading (with its stage) /
   on the set / no speed (with why) / failed.
2. Re-run one with "Read again". It is never offered for a person's own read or a speed
   already on the set.
3. Locally, without touching production: `DRY_JOBS=jobs.json PAGE_BUNDLE_DIR=… npx tsx
   --tsconfig tsconfig.json scripts/velocity-worker/worker.ts` (jobs' `url` may be a local
   path; commits are printed, not sent).
4. Tests: `npx vitest run src/test/lift-analysis` (velocity-worker.test.ts covers the
   token checks and the logging rule; estimate-front.test.ts reads a synthetic front-on
   squat with a known answer).
