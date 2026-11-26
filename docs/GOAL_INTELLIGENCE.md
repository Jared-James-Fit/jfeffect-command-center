# Goal & Performance Intelligence

Nov 26 2026. One ledger for every client goal, read the same way by every
screen and every Cleo workflow, scored from the athlete's own records, and
told to the client only after the coach approves it.

## The ledger (`client_goals`)

One row per goal, one open row per identity (`dedupe_key`, unique while
`proposed` or `active`). A goal keeps three numbers apart:

| What | Columns | Who sets it |
| --- | --- | --- |
| The client's own target | `client_value` / `_max` / `_unit` / `_unit_source` (`stated` or `inferred`) / `_kg` / `_text` | what they said (meeting, check-in, message, their profile) |
| Cleo's projection | `feasibility` (jsonb) | the deterministic engine, every 6 hours or on new data |
| The approved target | `approved_value` / `_unit` / `_kg` / `_text` / `_approach` / `_at` / `_by`, `approved_read` | the coach only |

Kinds: `lift`, `total`, `bodyweight`, `physique`, `performance`, `event`,
`preference`. Every goal keeps where it came from (`source_kind`, `source_id`,
`source_quote`, `source_context`, `speaker`, `source_at`, `tentative`) and
never gains a number, unit or date nobody said: a unit read from the
athlete's own training numbers is marked `inferred` until the coach confirms
it. Status: `proposed` (waiting on the coach) → `active` (approved) →
`achieved` / `missed` / `archived`, or `dismissed`.

History is `client_goal_events` (append-only; deleted only with the client in
an account purge). Sources already read are `client_goal_sources`, so nothing
is scanned twice. Staff read their own clients' rows; every write is the
server's, after `assertStaffReachesClient`; clients read nothing (they get
messages).

### One source of truth, both ways

The ledger mirrors itself into the fields the rest of the app already reads,
and those fields come back into it (SECURITY DEFINER triggers, `jf.goal_sync`
stops an echo):

- an approved total at a competition ↔ `competitions.target_total_kg` and the
  client's own total ↔ `athlete_goal_total_kg`; the meet's date and name
  follow; a cancelled meet archives its goals;
- an approved bodyweight goal ↔ `clients.bodyweight_goal_*` (a client editing
  their own profile is their target, never an approval; a coach editing it is
  the approved target);
- the dated event goal ↔ `program_intel_profiles.long_term_goal`
  (`dedupe_key = 'event:long_term'`, tied by `goalId`).

So Competition Intelligence, Generate Next Program, weight management and the
nutrition roadmap keep reading their own fields and always see the approved
target. Dismissing a goal clears what it wrote.

Rules the sync keeps (20270602130000_goal_intelligence_fixes.sql):

- the mirror writes only when what the goal says changed (status, the approved
  or the client's number, the date, the meet, the direction), never on a read;
- one bodyweight goal is active at a time (approving another archives the
  old one), and the profile's own type and maintain range are kept on the goal
  (`profile_type`, `approved_value_max`), so a maintain goal stays a maintain
  goal;
- the bodyweight back-sync is for coaching clients only (a member's goal stays
  theirs); a write with nobody signed in is never an approval; a profile goal
  with no unit is read in the client's own unit;
- a target cleared on a competition un-approves the goal (their own number
  stays, as a proposal) and never comes back; a cancelled meet closes its
  goals and clears what they wrote, and putting it back on reopens them;
- the athlete's own total on a competition is written only from what the
  athlete (or the competition) said, never a coach's note;
- an account purge deletes the goal history (`jf.allow_history_delete`).

## Feasibility (`src/lib/goal-intel/feasibility.ts`, pure)

Never a probability and never a model's guess. The projection reuses engines
that already exist so the numbers agree with the rest of the app:

- a goal at a meet: Competition Intelligence's forecast (conservative /
  expected / high);
- a lift by a date: the analytics' strength line and its trend, the rate
  checked against their training age (`EXPECTED_MONTHLY_PCT`), long horizons
  damped, shrunk or stretched by how their past approved targets actually went
  (`calibrationFrom`, resolved goals only);
- bodyweight by a date: the weight-management trajectory and `target.ts`'s
  rates for the sport and goal.

Six approaches (Easy, Conservative, Moderate, High, Very aggressive,
Extremely aggressive) are targets placed across that range. The score out of
100 is where the client's (or approved) target sits among them; confidence
(low / moderate / high) is said separately and comes from how much data there
is. One recommended approach (`recommendApproach`: a client's stated
preference for the top end is honoured only close to the meet with no
concerns) and one action (`decideAction`): approve, maintain the plan, adjust
the programming, adjust the target, raise it, protect (pain / recovery), or
collect data. Lines are short ("82/100 feasibility: Current training supports
this target."); details open on request.

## Where goals come from (`extract.ts`, `goals.server.ts`)

Deterministic, no model call. The worker reads:

- meeting analyses (coaching sessions with `analysis_status = 'ready'`, the
  last 180 days, so existing meetings are read once when this ships): goal and
  objective items, intelligence lines, the coach's live notes; a target said
  for a meet's attempts is linked to that competition;
- weekly check-ins (next week's goal, what they want help with);
- clients' own coach-chat messages (every 30 minutes, from a watermark).

Everything lands `proposed`. A number needs a lift (or total / bodyweight)
next to it, before or after it ("squat 220-225", "a 405 squat", "500 total,
180 squat"); a number belongs to one lift only. Reps, sets, RPE, percentages,
food, days and dates are never targets, and neither are where they are now
("currently 170", "520 last meet", "I weigh 185 right now"), a result ("hit
405 for a double", "new PR"), a working set ("3x5 at 405") or a change ("up 20
lbs"). A range stays a range; a goal in words stays in words; how they want to
get there ("top end over nine for nine") is a `preference`. A unit counts as
said only when the person's own words said it (an analysis's paraphrase
doesn't), and a number their words don't contain is tentative.

A meeting is read again only when its goal words change (its analysis's goal
lines and the coach's goal notes, `client_goal_sources.content_hash`), so
opening it never proposes anything again; a goal the coach dismissed or closed
is never proposed again from the same source or from anything said before it
was closed; something said earlier never replaces something said later; a
coach's call notes count only under goal or attempt words ("Thirds:") and
never rewrite the client's own number. Messages the app made for them (a
workout note, a pain card) aren't read. A goal in words read from a meeting
is kept for the coach but isn't sent to the client (`client_facing` off).

## Background work

`goal-intel-tick` hook, pg_cron `3-59/5 * * * *`, called only while
`goal_intel_due()`; 2-minute timeout. Each run: send updates whose window is
up, read new meetings / check-ins / messages, then re-read open goals due a
read (new, or 6 hours old). A read changes the stored recommendation only on
a meaningful change (`meaningfulChange`), and a decided recommendation is
never asked again for the same data.

## Where it shows

`GoalSummary` (`src/components/goals/goal-summary.tsx`): the client's Summary,
the Training tab (compact), a competition in the Competition tab, and a
meeting's command centre. A goal row: client target · projection · approved
target, the feasibility bar with its one line and confidence, time left, and
the action (Approve their target, Use the recommended approach, Edit,
Dismiss; Keep plan / Adjust when there's advice). Details folds the six
approaches, the pace, the basis, what's missing, the source quote and the
history. "Adjust the programming" hands the words to the Training tab's Cleo
(`handOffToCleo`): nothing here writes a program.

## Cleo

`goalsText` / `GOAL_RULES` / `COACHING_ANALYSIS_RULES` (`rules.ts`) go into
every AI context that plans or talks about a client: Cleo's client
conversations and docks (`clientIntelText`), Generate Next Program and Adjust
program (the Program Intelligence brief), Competition Intelligence's brief and
meeting prep. Cleo's `goals` lookup returns the ledger with the approaches.
The analysis rules describe how an elite strength and physique coach reasons
from the athlete's own data and name no coach.

## Client updates (`client_update_outbox`, `outbox.ts`)

When the coach approves (or reopens) a client-facing change, one short
message is prepared from the approved targets only (never a score,
projection, quote or note) and waits out the review window (`app_settings.goal_updates`: 30 minutes by
default, 5 minutes to 24 hours). The coach can preview, edit, hold, cancel or
send now. A related change joins the waiting message and restarts the window;
one arriving after the coach edited it holds it for the coach. Right before
sending, every rule is checked again (`sendDecision`): each change still
approved and current, automatic sending on, outside their quiet hours, and
the client offline (no app heartbeat in 4 minutes). Presence nobody can read
waits, then holds for the coach after a day. One waiting update per client
(pending or held); a held update stays held when a newer change joins it.
A change goes stale only when its approved target does (the client's own
number moving, a read or a new version never cancels it), and a moved meet's
date is said as it is now. Delivery is claimed from the row exactly as it was
read (a Hold, an edit or a newer change in between always wins) and deduped by
`outbox_id` on the message, so it never goes twice; a send cut off part way is
picked up after 10 minutes (marked sent if its message went, else back to
waiting); waits never count as failures, and three failed sends hand it to the
coach (held, `send_failed`). It goes in their coach chat as `message_type`
Goals, `is_automated` (a prepared update never closes their check-ins or
forms; the attachment says whether the coach tapped Send), with the usual push
(their notification settings apply). Approvals carry what the card showed
(the goal's version, an approach's number, the recommendation's key): a goal
that changed under an open card is checked again, never approved blind.

## Rollback

`docs/rollback/2026-11-26-goal-intelligence-rollback.sql`: drops the ledger,
history, outbox, triggers and schedule; what the sync already wrote to the
app's own fields stays and keeps working.

## Tests

- `src/test/goal-intel.test.ts`: feasibility, approaches, actions, extraction,
  outbox rules and the message.
- `src/test/goal-intel-worker.test.ts`: the worker end to end on an in-memory
  database (extraction, approval, the outbox, delivery, dedupe).
- `supabase/tests/goal-intelligence/run.sh`: the migration and its fixes twice
  on Postgres 16, backfill, both-way sync, identity, version, append-only
  history, RLS, `goal_intel_due()`, purge and rollback; `fixes.sql` holds each
  case the Nov 26 review found.
