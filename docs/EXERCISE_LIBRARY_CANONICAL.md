# Exercise library: canonical names, aliases, families

Migration: `supabase/migrations/20261005230000_exercise_movement_family_canonical_names.sql`

## Rules

1. **One exercise per distinct movement.** If the execution materially changes
   (pause, tempo, grip, bar, stance, range of motion) it is its own exercise.
   If it is only another name for the same movement it is an **alias**.
2. **Prescription detail never creates an exercise.** "2-Count Pause Squat",
   "3-Second Tempo Squat", `Spoto Press 1"` are all the base exercise
   (`Pause Squat`, `Tempo Squat`, `Spoto Press`). The pause length / tempo
   belongs in the row's notes or `tempo` field.
3. **Standardized name wins.** A linked program row always displays
   `exercises.name`; `exercise_name_override` is only the fallback for a row with
   no library link (`displayExerciseName()`).

## Families and colours (`exercises.movement_family`)

| Family    | Colour | What belongs                                                        |
|-----------|--------|---------------------------------------------------------------------|
| squat     | yellow | Bilateral squat movements: comp, pause, tempo, high bar, safety bar, belt, box, pin, hack, pendulum, front, goblet… |
| bench     | blue   | Bench-press movements: comp, pause, tempo, TNG, Larsen, Spoto, close grip, incline, floor press, DB bench… |
| deadlift  | green  | Conventional / sumo / trap bar / pause / tempo / deficit / RDL / stiff leg / rack + block pulls |
| accessory | red    | Everything else (leg curl, row, pulldown, lunges, split squats, single-leg RDL, curls, push-ups…) |

The colour is the **movement**, not the muscles it trains. A leg curl is
accessory even though it helps the deadlift.

* Derived once by `exercise_movement_family_for(name, competition_lift_type)` and
  filled on every insert by a trigger. Coaches can change it in
  **Exercise Library → exercise → Movement (card colour)** or when creating an exercise.
* One colour source in the app: `src/lib/exercise-family.ts`
  (`resolveMovementFamily`, `movementFamilyStyle`). The legacy per-row
  `card_color` (set on 0 of 10,769 rows) is ignored and its picker was removed.
* `pl_exercise_rows.movement_family` is a separate **analytics** override
  (`squat/bench/deadlift/upper/lower/other`). It is untouched, and is only used
  for colour when a row has no library link.

## Order numbers

The number on each card is `index + 1` of the current exercise order. It is not
stored. Reorder or delete and every card renumbers. Component:
`ExerciseOrderBadge` (logger, builder, preview, inline editor).

## What the migration did (from the live-library audit)

Audit snapshot: 2,041 active exercises, 35 archived, 40 aliases, only 3 exercises
had a lift type (so every variation rendered red), 221 program rows had no
`exercise_id`.

Merged (references remapped, duplicate archived, old name kept as alias, best demo video kept):

| Canonical (final name)          | Merged in |
|---------------------------------|-----------|
| Competition Squat               | Barbell Low Bar Squat |
| Pause Squat                     | 2-Count Pause Squat, 2-Count Paused Squat, Paused Squat |
| Tempo Squat (was `3-0-0 Tempo Squat`) | 3-Second Tempo Squat |
| Safety Bar Squat (was `Safety Squat Bar Squat`) | - (rename) |
| Box Squat                       | Barbell Box Squat (video kept) |
| Hack Squat                      | Hack Squat Machine Squat |
| Competition Bench Press (was `Competition Bench`) | - (rename) |
| Pause Bench Press (was `Paused Bench Press`) | 2-Count Pause Bench Press, 3-Count Pause Bench Press |
| Spoto Press                     | Spoto Press, `Spoto Press 1"`, `Spotto Press 1"`, Barbell Spoto Press (video kept) |
| Touch and Go Bench Press        | TNG Bench Press |
| Larsen Press                    | Barbell Larsen Bench Press |
| Close Grip Bench Press          | Close Grip Barbell Bench Press |
| Incline Bench Press             | Barbell Inclined Bench Press (+ rename of Barbell Incline Bench Press) |
| Incline Dumbbell Press          | Incline Bench Press - Dumbbell (video kept) |
| Competition Deadlift            | - (aliases only) |
| Pause Deadlift                  | Paused Deadlift, Two-Count Paused Deadlift, 2-Count Paused Deadlift |
| Romanian Deadlift               | Barbell Romanian Deadlift |
| Leg Press                       | Leg Press Machine (video kept) |
| Band Pull-Apart                 | Resistance Band Pull Apart (video kept) |
| 5 unused wording-only pairs     | good morning, KB sumo high pull, 2 stretches, heel touch |

Renamed only (single entry, prescription detail removed from the name):
`Pause Deadlift Below Knee`, `Pause Sumo Deadlift At Knee`,
`Tempo Sumo Deadlift To Knee`, `Deficit Deadlift`.

Pause lengths and tempos that existed only in a merged name were written onto the
affected rows so the programmed intent is unchanged: `2-count pause` /
`3-count pause` / `2-second pause` / `1" Spoto` / `3-second tempo` are appended to
the row's notes (never replacing existing notes), and `3-0-0` is set on blank
`tempo` fields.

Aliases seeded for the three competition lifts and each canonical above
(e.g. Comp Squat / Low Bar Squat / Competition Back Squat, Comp Bench /
Competition Barbell Bench Press, Comp Deadlift / Competition Conventional Deadlift, RDL).

Typed-name program rows were linked to a library exercise only where the coach's
own programs already link that exact name (>= 3 linked rows and >= 80% agreement):
Seated Leg Curl, Neutral-Grip Lat Pulldown, Cable Lateral Raise, Cable Crunch,
Hip Abduction, Cable Glute Kickback. Ambiguous ones were left alone.

## Deliberately NOT changed (needs a coach decision)

* **Conventional Deadlift** (43 uses) stays separate from Competition Deadlift:
  whether it is the competition pull depends on the athlete (Competition
  Deadlift rows are often sumo). Use *Make alias* per case.
* **Barbell Bench Press** (64 uses) stays separate: a plain barbell bench is not
  necessarily the paused competition standard.
* **Pause Deadlift Below Knee** is kept apart from **Pause Deadlift**: pause
  position is part of the movement.
* **Tempo Sumo Deadlift To Knee** and **Pause Sumo Deadlift At Knee**: sumo +
  position-specific, kept as their own exercises.
* Ambiguous typed names left unlinked: Leg Extension (76% agreement),
  Seated Cable Row (75%), Lat Pulldown (71%), Seated Hip Abduction, custom text.
* Implement-different accessories (Dumbbell vs Barbell vs Cable curls, etc.).
  The long tail is mostly distinct variations, not wording duplicates; use the
  library's *Possible duplicate* queue for the rest.
* Library has no Tempo Bench Press yet; it is created on demand and is
  auto-classified as bench.
* Several used exercises still have no demo video (Overhead Cable Triceps
  Extension 224 uses, Standing Calf Raise - Machine 222, Seated Calf Raise 120,
  Machine Shoulder Press 114, Preacher Curl 108, Cable Curl 105, Pause Bench
  Press 139 after merge, ...). Attach videos in the library.

## Behaviour changes to be aware of

* **Bench percentages.** Maxes are keyed by the lift text `Competition Bench Press`
  and looked up by the displayed exercise name. The library entry used to be
  named `Competition Bench`, so by the lookup code (`findMaxByLift` in
  `src/lib/pl-maxes.ts`, an exact case-insensitive name match; not observed in the
  UI) % loads on bench could not match a max. After the rename they match, so
  suggested bench loads will appear where the coach programmed `% of 1RM`.
  Spot-check a client's bench day after deploy.
* Display names: previews, summaries and takeaways now show the library name
  first (as the logger already did).

## Duplicate prevention

* DB trigger `prevent_duplicate_exercise_identity`: exact identity, alias, and
  word-order / plural / DB-BB equivalents (`exercise_dup_key`). Opposite
  directions ("high to low" / "low to high") are not folded.
* `resolve_exercise_id(name)`: exact -> alias -> equivalent. Used when a program
  row is created from a typed name.
* App: quick-create reuses an existing exercise (name, alias, word order) and,
  if the database still refuses, reuses the canonical id it names. Bulk import
  returns `reused` instead of creating a near-duplicate.
* Search (every picker) understands aliases via `setExerciseAliasIndex`, loaded
  once in the app shell, and returns the canonical exercise.
