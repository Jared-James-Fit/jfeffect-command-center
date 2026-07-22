# Smarter Training Analytics

Goal: keep the current Training Analytics page looking almost identical while making it smarter. No new forms, no new dashboards, no schema changes for user input. Everything derives from data we already collect (set logs, RPE, planned vs completed, reviews, pain, cardio completions).

## Scope

All work stays inside:
- `src/components/analytics/*`
- `src/lib/analytics/*` (new helpers)
- Small additions to the workout-complete summary UI

No API/table changes. New helpers are pure functions over existing tables:
`pl_row_results`, `pl_exercise_rows`, `pl_day_completions`, `member_workout_reviews`, `member_workout_completions`, `cardio_completions`, `cardio_targets`.

## Changes

### 1. Exercise 1RM chart: Est.1RM | Weight | RPE toggle
In the existing per-exercise chart inside `client-analytics-dashboard.tsx`:
- Add a 3-way segmented toggle above the chart.
- Reuse the same series data (already includes load and rpe on each point via `pl_row_results`).
- Tap detail (in `graph-dot-detail.tsx`) shows: Top set (load × reps), Est.1RM, Top set RPE.

### 2. "View Notes" + "View Workout" on exercise view
On the exercise detail (already opened from PR / chart), add two buttons:
- **View Notes** → sheet listing existing notes for the workouts backing the chart:
  coach notes (`pl_exercise_rows.notes`), client notes (`pl_row_results.notes`),
  pain notes (`member_workout_reviews.pain_notes` / row-level pain), workout review
  comments (`member_workout_reviews.notes`).
- **View Workout** → links to `/portal/workouts/$dayId` (or admin equivalent) for the workout tied to the tapped point.
No new tables; pure read.

### 3. Estimated Recovery Score beside Workout Score
In the workout-complete summary component:
- Compute recovery 0–100 from:
  session RPE (`avg_rpe`), completion %, planned-vs-actual for that day,
  recent 7/14-day load trend, workout frequency, performance vs recent e1RM,
  existing review sliders (soreness/sleep/energy if present), pain flag.
- Show alongside Workout Score with same styling.
- Tap → small popover with the contributing factor lines (Performance / Completion / Session Difficulty / Recent Load).
Helper: `src/lib/analytics/recovery-score.ts`.

### 4. Recovery summary card in Analytics
One compact card in the dashboard:
- Current block avg, previous block avg, trend chip (Improving/Stable/Declining ≥5pt diff).
- Hidden when fewer than 3 scored workouts in current block.

### 5. Cardio summary card
Compact card using `cardio_completions` + `cardio_targets`:
Completed / Prescribed, Adherence %, Total Minutes. Hidden when no cardio target.

### 6. Recovery pattern detection
Helper `recovery-patterns.ts` runs only when ≥ 4 weeks of completed workouts exist.
Detect a small fixed set of patterns from existing data:
- Rest-day effect (recovery/perf by days-since-last-workout)
- High-volume week dip (recovery vs weekly volume quartile)
- RPE → next-session recovery correlation
- Lift performance vs recovery-above-average
Only display patterns with strong support (n ≥ 6 and effect ≥ threshold). Render as bullet list in a small "Patterns" card. Empty state → card hidden.

### 7. Predicted Best Performance Window
Helper `predicted-window.ts`. Uses current block's week-by-week e1RM/RPE/recovery trend plus prior blocks' peak-week distribution. Outputs `{ week, confidence }`. Confidence:
- High: ≥ 2 prior blocks agree AND current trend consistent
- Moderate: 1 prior block or current trend only
- Otherwise hide the card.

## Technical notes

- All new logic is pure TS in `src/lib/analytics/`; unit-testable.
- Reuse existing queries in `client-analytics-dashboard.tsx`; add memoized derivations.
- Segmented control: existing `ToggleGroup` from shadcn.
- Charts already use Recharts — same `<LineChart>`, swap `dataKey`.
- No new secrets, no migrations.

## Out of scope

- No new forms, no new questionnaires.
- No new tables/columns.
- No heart-rate zones, calories, distance for cardio.
- No AI predictions or complex forecasting graphs.
