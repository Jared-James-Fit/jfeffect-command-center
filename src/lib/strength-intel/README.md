# Strength Intelligence

One deterministic read of an athlete's squat, bench and deadlift, shared by every
screen and every AI that touches a load: the logger and its planned weights, the
coach's quick view, both program builders, Missing program data, the Strength
tab, Program Intelligence and Generate Next Program, Adjust program, Cleo, the
competition forecast and goals. No model decides a number here.

## The numbers, kept apart

| Metric | What it is | Who reads it |
| --- | --- | --- |
| `competitionPR` | The most they've lifted on a platform (raw, as lifted) | "% of Competition PR" |
| `trainingPR` | The heaviest they've lifted in training, with its reps | Analytics |
| `peakE1rm` | The highest a hard training set has ever implied | Analytics |
| `current` | What they can probably lift on a normal training day **now**, with a confidence and what it rests on | "% of Est. 1RM" |
| reference | The coach's 1RM / TM / pinned e1RM, profile-wide or locked to a block (`pl_client_maxes`) | "% of 1RM", "% of TM", and a stored e1RM wins over `current` |
| daily | What today's sets say against yesterday's estimate | The ⓘ only; never moves today's plan |

A variation (paused deadlift, high-bar squat) has its own read. A learned ratio
to its competition lift is used only after 3+ comparisons and is labelled
inferred; there is never a universal ratio.

## How evidence becomes an estimate

1. **A set** (`evidence.ts`): the RTS RPE chart (`percentOf1RM`, `analytics/e1rm.ts`).
   RPE 7+ at 10 reps or fewer can show a max; RPE 5–6.5 or 11–12 reps is a lower
   bound (at most 2 reps in reserve credited); unrated is read to failure, a
   lower bound worth half. Under RPE 5 or over 12 reps says nothing.
2. **A session**: one piece of evidence per day. The top set leads; back-offs
   never pull it down. Reliability multiplies reps, effort, a secondary exposure,
   coming after another lift, and a reliable velocity read when there is one.
   Outliers (a unit slip) are kept out.
3. **The line** (`estimate.ts`): hard evidence above the estimate moves it by its
   reliability; agreeing evidence nudges it; a lower bound above it moves it half
   way. It falls only on two comparable lower sessions (or a sustained month of
   other-band ones), at most 2% a week, and not at all from one bad day. In a
   fatigue phase (accumulation, after a meet, a cut, illness, injury) it needs one
   more session and falls half as fast. A meet is read as training-day strength
   (the meet over their platform premium). Time off fades it slowly after four
   weeks; no hard set for 16 weeks eases it down; nothing for six months starts it
   again. Confidence decays with staleness.
4. **Calibration** (`calibrate.ts`): their platform premium, rep strength, RPE
   consistency and back-off fatigue, each shrunk toward neutral until their own
   data says otherwise.
5. **Planning** (`planning.ts`): a program reads `current` only with two sessions
   or meets behind it and enough confidence; a lower bound is plannable and said
   to be "at least". A deadlift reads only the athlete's current stance (sumo and
   conventional are never mixed).

Every threshold is in `rules.ts` with its source. Change one only with a replay of
real logs (`scripts/strength-intel/replay.ts`) showing it behaves better.

## The coach's controls

`max-history.ts` and the maxes panel (`components/strength-intel/strength-reference.tsx`):

- **Pin**: store today's estimate as the lift's Est. 1RM; a % of Est. 1RM holds
  still until it's unpinned.
- **Lock for a block**: copy today's 1RM, TM and estimate onto a row for that
  block only, so nothing changes mid-block. Unlock removes it.
- **History**: every add, change and removal of a max is kept by a trigger
  (`pl_client_max_history`), with Restore.

A workout's planned % is read from the references as they stood the day before
its date (`strengthRefsAsOf`); a finished workout keeps the reference it was
planned from. Nothing here rewrites a future session.

## Tests

`src/test/strength-intel.test.ts` (scenarios), `planning-e1rm.test.ts`,
`analytics-redesign.test.ts`, `load-reference.test.ts`.
