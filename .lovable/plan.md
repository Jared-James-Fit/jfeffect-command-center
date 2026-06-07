# Program Builder + Program Library (Phase 1 MVP)

This is a huge system. I'll build it in **phases** so you get something usable fast, then layer advanced features on top. Below is **Phase 1** — the minimum that feels clean, fast, and useful for both powerlifting and bodybuilding clients.

Reply **"go"** to approve and I'll start. Reply **"slim"** if you want me to cut templates/library from Phase 1 and ship only the per-client builder first.

---

## Phase 1 scope (build now)

### Data model (new tables, `pl_` prefix, with RLS + grants)

- `pl_preps` — prep/phase: title, goal_type, event_name, event_date, event_location, federation, weight_class, division, start_date, end_date, total_weeks, current_focus, status (Planned/Active/Completed/Archived), coach_notes, client_visible, client_id
- `pl_blocks` — prep_id (nullable), client_id, name, week_start_index, weeks, training_focus, goal, status, coach_notes, client_visible
- `pl_weeks` — block_id, week_index, notes
- `pl_days` — week_id, day_index, title, focus, notes, duration_estimate_min (auto), duration_override_min (manual), duration_source
- `pl_exercise_rows` — day_id, sort_order, exercise_id (FK exercises, nullable), exercise_name_override, sets, reps_text (supports "8", "8-12", "AMRAP"), rpe, rir, percentage, percentage_basis (1rm/training_max/est_1rm/top_set/prev_set/prev_week/manual), basis_row_id, load_kg, load_lb, rest_seconds, tempo, time_profile, intensity_techniques[], progression_method, notes, estimated_seconds (auto), estimated_seconds_override
- `pl_row_results` — row_id, client_id, set_index, actual_load, actual_reps, actual_rpe, actual_rir, notes, video_url, completed_at
- `pl_day_completions` — day_id, client_id, completed_at, actual_duration_min, client_notes
- `pl_client_maxes` — client_id, lift, one_rm, training_max, estimated_1rm, unit, updated_at
- `pl_templates` — name, template_type (full_prep/block/week/day/exercise_row), training_style (powerlifting/bodybuilding/strength/lifestyle/hybrid/rehab/conditioning/custom), training_focus, tags[], status (Draft/Active/Archived), weeks, days_per_week, est_duration_min, goal, notes, payload jsonb (snapshot of structure), created_by

RLS: admin full · coaches via `is_assigned_coach(client_id)` · clients read own where `client_visible=true` · clients insert own `pl_row_results` / `pl_day_completions`.

### Core lib — `src/lib/pl-programs.ts`

- **Duration estimator**: warm-up buffer (10 min general + 10/main lift) + working set time (45–60s/set) + rest from row or default-by-profile (main 240 / secondary 180 / compound 120 / isolation 60) + 3 min transitions. Returns range (±10%), rounded to nearest 5 min.
- **Percentage resolver**: 1RM / training_max / est_1rm (from `pl_client_maxes`) · top_set / prev_set via `basis_row_id` · prev_week via same row index in week N-1 · rounding to 2.5kg / 5lb based on client `preferred_weight_unit`.
- **Template snapshot/apply**: serialize a prep/block/week/day subtree to `pl_templates.payload`; apply payload to create a deep-copied subtree at chosen placement.

### Admin / Coach UI

- `/admin/program-library` — list, search, filter (template_type / training_style / focus / tag / status), CRUD, duplicate, archive, "Add to Client" flow (pick client → placement: new/existing prep → block → week → day → confirm).
- `/admin/program-library/$id` — template editor (same grid component as client block editor; persists to `pl_templates.payload`).
- Add a **Training Program** tab to `/admin/clients/$id`:
  - Current Prep card with countdown ("8 weeks out" / event name).
  - Blocks list — programmed + "Not programmed yet" placeholders.
  - Buttons: New Prep · New Block · Add From Library · Save As Template.
- `/admin/clients/$id/program/preps/$prepId` — full prep view (all blocks, which weeks are programmed, gaps).
- `/admin/clients/$id/program/blocks/$blockId` — **Google-Sheets-style grid editor**:
  - Week tabs across top; day cards/rows below.
  - Per row: Exercise (autocomplete from Exercise Library) · Sets · Reps/Range · RPE/RIR · %/Load · Rest · Tempo · Est.Time · Notes.
  - Top-set ↔ backoff linking via `basis_row_id`.
  - Auto-recalc load from client maxes / linked row on edit.
  - Per-day duration auto-calculated; manual override with **Recalculate** + **Clear Override** buttons.
  - Buttons: Duplicate Week · Duplicate Day · Save Day/Week/Block As Template · Add From Library.

### Client UI

- `/portal/program` (existing) — add **Current Prep/Phase** card with countdown if event_date set.
- `/portal/workouts` (new) — list of today + upcoming days with estimated duration.
- `/portal/workouts/$dayId` — clean mobile workout view:
  - Demo video link per exercise (from Exercise Library).
  - Per-set inputs: actual load / reps / RPE / RIR / notes.
  - "Mark Workout Complete" with optional actual duration.

### Out of scope for Phase 1

- **Phase 2**: progress graphs · training history archive UI · PR detection · exercise-library time-profile editor · completed-prep summaries · muscle-group weekly volume tracker · template folders.
- **Phase 3**: estimated-vs-actual analytics · AI block summaries · notification fan-out · advanced template-sync · drag-and-drop column customization · intensity-technique structured logging.

---

## Effort estimate

- 1 large migration (~11 tables, RLS, grants, indexes)
- 1 core lib file (`pl-programs.ts`)
- ~6 admin routes/components
- ~3 client routes
- Shared grid editor component (~400 lines)
- **~15–18 files total**

Several hours of generation. Once approved I'll batch the migration first, then build admin → client in order.

Reply **go** to start, or tell me what to trim.
