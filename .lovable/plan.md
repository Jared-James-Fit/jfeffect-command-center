## Reps / Time toggle for the workout builder

Add a per-exercise (and per-set) measurement mode so any exercise can be programmed as **Reps** or **Time (duration in seconds)**, end‑to‑end across the builder, client logger, history and progression views.

### 1. Data model (migration)

Add columns and backfill safely. No data loss when toggling.

`public.pl_exercise_rows`
- `measurement_type text not null default 'reps'` — check in `('reps','time')`
- `duration_seconds integer` — prescribed default (used when no per-set override)
- `reps_text_backup text` — preserved snapshot when switching reps → time
- `duration_seconds_backup integer` — preserved snapshot when switching time → reps

`public.pl_block_set_rows` (per‑set rows)
- `duration_seconds integer` — per‑set override when row is in time mode

`public.exercises` (library defaults)
- `default_measurement_type text not null default 'reps'` check `('reps','time')`

`public.pl_row_results` and `public.member_set_logs` (client logging)
- `completed_duration_seconds integer` — actual completed time
- (keep existing reps fields untouched)

Backfill: every existing row → `measurement_type = 'reps'`. No other data touched.

### 2. Shared utilities (`src/lib/duration.ts` — new)

- `parseDurationInput(raw: string): number | null` — accepts `30`, `90`, `2:00`, `1m 30s`, `2 min`, `1:05`, rejects negatives/zero/garbage.
- `formatDuration(seconds: number): string` — `45 sec`, `1 min`, `2 min`, `1 min 30 sec`, `5 min 15 sec`.
- `formatDurationShort` for compact cells.
- Unit tests in `src/lib/duration.test.ts`.

### 3. Validation (`src/lib/pl-template-validation.ts`)

- In `time` mode the row passes the "reps" requirement when `duration_seconds > 0` (or every per-set row has a duration).
- Intensity requirement unchanged.
- Update `ROW_LABEL` so the missing field reads "Duration" in time mode.

### 4. Builder UI (`src/routes/_authenticated/admin/program-library_.$templateId.tsx`)

- Compact segmented toggle `[Reps | Time]` next to the reps field, per row. Labels visible (not icon‑only).
- Reps mode = current behaviour, unchanged.
- Time mode = replace reps input with a `Duration` input using `parseDurationInput` on blur / commit, formatted via `formatDuration`. Stored as `duration_seconds`.
- Toggle behaviour:
  - reps → time: snapshot `reps_text` into `reps_text_backup`, clear `reps_text`, seed `duration_seconds` from `duration_seconds_backup` if present.
  - time → reps: snapshot `duration_seconds` into `duration_seconds_backup`, restore `reps_text` from `reps_text_backup` if present.
- Per‑set rows: when the row is time mode, the per‑set "reps" column becomes a duration input bound to `pl_block_set_rows.duration_seconds`. Bulk "apply to all sets" works the same way.
- `meetsMinimum` for auto‑collapse uses duration in time mode.
- `exercise_id` change pre‑fills `measurement_type` from `exercises.default_measurement_type` only on first attach.

### 5. Exercise library (`src/routes/_authenticated/admin/blocks.$blockId.tsx` + exercise editor)

- Add a `Default measurement` select (`Reps` / `Time`) on the exercise edit form. Saved to `exercises.default_measurement_type`. Overridable per workout (does not mutate the library record).

### 6. Client logger (`src/routes/_authenticated/portal/workouts.$dayId.tsx`, `src/components/client-block-view.tsx`)

- Prescription header renders `3 × 45 sec @ RPE 7` in time mode.
- Logged input is `Completed duration` (parsed via `parseDurationInput`) instead of completed reps. Reps input hidden. Weight, RPE, RIR, notes, tempo, rest stay.
- Set completion validation requires `completed_duration_seconds` in time mode (not reps).
- Clear labels `Duration` vs `Rest` — no shared styling that could confuse them.
- Optional **Start timer** button next to the duration: counts down from `duration_seconds`, supports pause/resume/restart/finish, marks completed on finish, independent from rest timer, never auto‑starts.

### 7. Duplication / assignment paths

Audit and patch any "copy row" logic in `src/lib/pl-programs.ts`, `src/lib/pl-bulk.functions.ts`, `src/lib/exercise-blocks.functions.ts`, and program‑library duplication helpers so they carry `measurement_type`, `duration_seconds`, per‑set `duration_seconds`, and backups through:
- Workout duplication
- Week duplication
- Exercise duplication
- Program duplication
- Assignment to client

### 8. History / progress views

Anywhere a prescription or completed value is rendered (history list, coach review, progress metrics) show `formatDuration(...)` when `measurement_type === 'time'`, otherwise current reps display. No numeric aggregation across modes.

### 9. Regression guardrails

Existing rep rows render and save identically (measurement_type defaults to `reps`). Weight units, RPE/RIR, rest timer, supersets, autosave, week nav, colours unaffected.

### 10. Acceptance checks before handoff

- Existing rep workout opens unchanged.
- Toggling one exercise to Time does not change siblings.
- `90` → `1 min 30 sec`; `120` → `2 min`; `45` → `45 sec`.
- Per‑set durations editable independently.
- Duplicating and assigning preserve mode + durations.
- Client can complete a set with duration only, no reps.
- Switching back to Reps restores prior reps text.
- Mobile layout wraps without horizontal overflow.

---

### Confirmation needed

This touches ~12 files and a multi-table migration. Confirm to proceed and I'll ship it in this order: migration → utilities/validation → builder UI → duplication paths → exercise library default → client logger → optional timer.