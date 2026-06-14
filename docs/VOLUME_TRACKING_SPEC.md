# Powerlifting Volume Tracking — Deferred Spec

**Status:** Queued. Build AFTER P0 launch blockers clear AND Program Library Phase 1 ships.
**Reason for deferral:** Sequencing agreed with user 2026-06-14. See chat history.

## Scope (verbatim from user request)

### 1. Exercise tagging fields (new columns on `exercises`)
- primary_movement_pattern, secondary_movement_pattern
- muscle_groups (array)
- lift_family
- is_competition_lift (bool)
- variation_type
- counts_toward_volume (bool, default true)
- volume_multiplier (numeric)

### Enums
- movement_pattern: squat, bench, deadlift, horizontal_push, vertical_push, horizontal_pull, vertical_pull, knee_extension, hip_hinge, hip_thrust, hamstring_curl, biceps, triceps, delts, calves, core, conditioning, rehab, other
- lift_family: squat, bench, deadlift, accessory, conditioning, rehab
- variation_type: competition, close_variation, secondary_compound, accessory, isolation, rehab, conditioning

### Default volume multipliers
- competition 1.0, close_variation 0.8, secondary_compound 0.7, accessory 0.5, isolation 0.4, rehab 0.25, conditioning 0

### 2. Planned weekly volume (from `pl_exercise_rows` × `pl_weeks`)
- raw sets = working sets count
- effective sets = raw × volume_multiplier
- volume load = sets × reps × weight
- by movement_pattern, by muscle_group, competition lift exposures
- intensity distribution by %1RM if percentage provided
- Exclude warm-ups unless explicitly working

### 3. Completed volume (from `pl_row_results` / `member_set_logs`)
- completed sets, completed effective sets, completed volume load
- completion % = completed working / planned working × 100
- missed sets / exercises / patterns / muscle groups

### 4. Coach Program Volume Dashboard
Per program AND per client profile. Weekly summary table with planned/completed sets, effective sets, target range, status (low/on_track/high/excessive).
Categories: squat/bench/deadlift patterns, quads, hamstrings, glutes, upper back, chest, shoulders, triceps, biceps, core.

### 5. Main Lift Exposure section
For SBD: weekly frequency, competition exposures, close-variation exposures, heaviest top set, avg RPE, volume load, est 1RM.

### 6. Client-facing Weekly Volume card (simplified)
Completion %, sets done vs planned, main missed area, top completed area, simple status message. NO advanced metrics.

### 7. Target ranges (per client OR per program)
New table `client_volume_targets` with defaults:
- squat 6-14, bench 10-22, deadlift 4-10 effective sets
- quads 8-16, hamstrings 6-12, glutes 6-14
- upper back 10-20, chest 8-16, shoulders 6-14
- triceps 6-14, biceps 4-12, core 4-10

### 8. Status badges
Low (<range), On Track (in range), High (≤20% over), Excessive (>20% over).

### 9. Filters
Week, block, exercise category, movement pattern, muscle group, competition-only, completed vs planned.

### 10. Backfill screen
Coach UI to bulk-tag existing exercises with pattern, muscle groups, lift family, variation, multiplier.

### 11. DB strategy
- New columns on `exercises`
- New table `weekly_volume_snapshots` (program_id, client_id, week_id, payload jsonb) for performance
- New table `client_volume_targets` (client_id or program_id, category, min, max)
- Calculate live; snapshot weekly

### 12. UI
Modern, minimal coaching dashboard. Cards/tables/progress bars/badges. NOT spreadsheet-style. Coach detailed, client simple.

## Integration notes (do these checks at build time)
- Reuse `pl_exercise_rows.sets`, `reps_text`, `percentage`, `normalized_kg`
- Reuse `pl_row_results.normalized_kg`, `actual_rpe_num`, working_set flag if exists
- Coordinate with Program Library versioning — volume snapshots must point at a published version, not the moving draft
- RLS: coaches see assigned clients only; clients see own data only
- Reuse `is_assigned_coach()` and `has_role()` security definers
