# Member history → `pl_*`: dry run and open decisions

Nothing here moves data. `member-history-dry-run.sql` is read-only (one
`READ ONLY` transaction that ends in `ROLLBACK`). Run it against production,
look at the numbers, then decide.

## What would move where

| Member plan engine (`member_*`)             | Lands in (`pl_*`)                        |
| ------------------------------------------- | ---------------------------------------- |
| one enrollment with history                 | one archived `pl_block` on the member's athlete row |
| (week, day) with a completion or set logs   | `pl_weeks` / `pl_days`                   |
| (week, day, exercise) with set logs         | `pl_exercise_rows`                       |
| `member_set_logs`                           | `pl_row_results`                         |
| `member_workout_completions`                | `pl_day_completions`                     |
| `member_exercise_notes`                     | `pl_exercise_notes`                      |
| `member_workout_reviews`                    | `pl_workout_feedback`                    |

The athlete row is the `clients` row with `athlete_kind = 'member'` from
`ensure_member_athlete()`.

## Reading the results

1. **Per member**: history size and a `move_status`:
   - `ready: athlete row exists` / `ready: athlete row would be created`: can move.
   - `decide: login is also a coaching client`: moving would put member
     history into the coaching profile (coach-visible, counted in coaching
     stats). Probably leave in place, or move into a separate member block
     the coach can't see. That's your call.
   - `decide: lapsed member, no athlete row`: `ensure_member_athlete()`
     refuses without an active membership, so the move would need to create
     the row directly.
   - `decide: no login linked`: no `user_id`, so there's nothing to attach
     to yet.
   - `skip: no history`.
2. **Totals** by status: the size of the move.
3. **Per enrollment**: how many `pl_*` rows of each kind it would create.
4. **Exercise mapping**: resolved the way the member app resolves it
   (logged `exercise_id` → the member's swap → published plan row → name via
   `resolve_exercise_id`, the same resolver `pl_exercise_rows_autolink`
   uses). No new exercises are created. Anything `unmapped` would land with
   only the name.
5. **Mapping summary**.
6. **Edge cases**: empty sets, logged days never marked complete, plans with
   no published weeks, and how many inserts would fire the XP triggers.

## Recommendation: don't move yet

Coach-published member plans still run on `member_*`. Members enroll and
log there today, and the member app reads that history fine. If we move the
history now, a member's training ends up split between two places, and new
logs keep landing in `member_*` anyway.

The clean order is:

1. Run member plans on `pl_*` too: enrolling copies the plan into the
   member's athlete row as a block, the way coaching clients get blocks.
2. Then move the history once, using this dry run as the checklist.
3. Then retire the `member_*` workout tables.

Until then, member-built workouts (`member_workouts_v1`) are on `pl_*` and
plan history stays where it is. The data export (#332) already includes both.

## Decisions the real move needs

- **XP.** Each moved completion fires `trg_award_workout_xp` (and reviews
  fire `trg_xp_workout_feedback`). The keys are per day, so it's idempotent.
  Per AGENTS.md, triggers are the only way to award points, so the choices
  are to let them fire (members get Logging Level credit for past work) or
  to skip XP for moved rows. Members aren't in the league
  (`athlete_kind = 'coaching'` filter), so standings don't change either way.
- **Coaching clients who also have member history**: leave it, merge it, or
  put it in a block hidden from the coach.
- **Lapsed members**: move their history too, or only for active members.
- **Unmapped exercises**: keep them as name-only rows, or add aliases first
  (Exercise Library → make alias) so they resolve.
