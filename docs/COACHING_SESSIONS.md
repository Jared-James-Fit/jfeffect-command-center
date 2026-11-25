# Coaching Session Intelligence

One session engine for every client conversation (a Coaching Plus call, a General
Call, a meet strategy call, a progress review, a 5-minute touch-base, a meeting
added afterwards). Cleo prepares, organizes and remembers; the coach decides.

## What it reuses (never a second copy)

| Need | Existing system |
| --- | --- |
| Facts before a call | `buildCallPrep` (coaching-packages/call-prep.ts): workouts, bodyweight, check-ins, pain, nutrition, the weight-management read, last call's action items |
| What every Cleo specialty knows | `clientIntelText` (client-intel/brief.server.ts) — sessions add confirmed coaching intelligence to it |
| Meets | Competition Intelligence: `competitions`, its released / approved assessments (forecast, field, attempts, warm-ups, game day) |
| Events and goals | `pl_preps` (meet preps), `program_intel_profiles.long_term_goal`, `clients.bodyweight_goal_*`, `athlete_competition_plans` |
| Questionnaires | the native forms engine (`nf_forms`, `sendNativeFormFn`, prefill, the chat's form card) |
| Plan changes | Adjust program (`askProgramAiFn` → `program_ai_edits`), Adjust plan (`nutrition_plan_edits`), the cardio draft (`cardio_cleo_proposals`): every change is still reviewed and applied there, with their versions, staleness checks and Undo |
| Scheduling | booking types and `ScheduleSheet` / the coach's booking dialog; included calls (`coaching_call_usage`) |
| Messages | the coach chat (`messages`); nothing is sent without the coach's tap |
| Files | `documents` for an uploaded transcript file |
| AI | the routing table (`src/lib/ai/routing.ts`), OpenAI key only, background `stagedCall` work driven by a tick hook; `ai_call_log` |

## Data (one migration, staff-only RLS through `coached_client_ids()`)

- `coaching_sessions` — one conversation: client, coach, optional `pt_session_id`
  (a booked call) and `competition_id`, the event it's about (`event` jsonb:
  kind, title, date, location, phase, source, conflicts), `format` (call /
  touch_base / retrospective), `status` (preparing / ready / live / done /
  cancelled), when and how long, the coach's private notes and priorities,
  `prep` (the deterministic read + Cleo's write-up), `agenda`, `live` (notes,
  decisions, tasks taken in the call), the transcript (private bucket path,
  consent, retain-until), `analysis`, the shared game plan and whether it was
  sent (`shared_message_id`). Clients never read it.
- `coaching_session_commitments` — coach or athlete, the commitment, due date,
  open / done / dropped, the session it came from and the one it's carried to.
- `coaching_session_recommendations` — area, current, proposed, reason,
  evidence, benefit, trade-offs, what it affects, and the coach's decision
  (approved / edited / kept / rejected / deferred / clarify), and where an
  approval went (the Adjust program / Adjust plan / cardio draft row).
- `client_intelligence` — lasting coaching knowledge: kind, text, permanent or
  temporary (with `expires_on`), proposed / confirmed / archived, visibility,
  the session and quote it came from. Only confirmed, unexpired rows reach
  Cleo, through `clientIntelText`.
- `coaching_session_events` — append-only record of every step.

## Engines (pure, tested)

- `detectEvents` — upcoming events from meet preps, competitions, the dated
  goal and the approved competition plan; one per date, conflicts named (two
  dates for one meet), phase and countdown from the date.
- `buildSessionPrep` — from `buildCallPrep`'s facts plus the event: what's going
  well, where to improve, what the coach needs from the athlete, what the
  athlete needs from the coach, what's missing, decisions to make, milestones.
- `planAgenda` — 15–30 minutes in five sections (going well, improve,
  athlete's corner, game plan, alignment); the athlete's corner and their
  topics get 25–35% of the time.
- `recommendIntervention` — the lowest effective intervention: nothing, a
  message, an information request, a resource, a 5–10 minute touch-base or a
  15–30 minute call, with why; meaningful decisions earn a call, the final week
  before a meet avoids one, an existing booking is respected, and an included
  call is said apart from a General Call.
- `questionnaireFor` — only what's missing or stale (a fresh check-in covers
  how they feel, a fresh weigh-in their weight, a meet adds how they feel
  about it), sent as the "Before our call" form with `settings.ask_keys`;
  1–3 minutes.
- `checkBrief` — Cleo's pre-call brief only organizes the prep: focus points
  cite prep lines that exist; nothing carries a number the prep doesn't.
- `checkAnalysis` — every extracted item must quote the transcript
  (`quoteFound`); a hedged agreement is only floated; a recommendation needs
  the conversation behind it and no invented numbers (five at most);
  intelligence the coach already confirmed isn't proposed again; what's
  dropped is listed for the coach.

## Background work

`coaching-sessions-tick` (pg_cron every minute, only while
`coaching_sessions_due()`): `runSessionWork` claims a row by its `updated_at`,
writes Cleo's brief (route `session_brief`) or reads the meeting (route
`session_analysis`) through `stagedCall` on the OpenAI key only, parks while a
model is still thinking, and waits without using an attempt while OpenAI is
down; then removes raw transcripts past their retention date.

## Where an approved change goes

Training, nutrition and cardio: words in that tab's own Cleo dock
(`handOffToCleo` → `useCleoHandoff`), where Adjust program, Adjust plan or the
cardio draft shows exactly what changes before anything is applied.
Communication: the client's chat box. Anything else: a coach commitment.

## Phases

1. Data, engines, the Sessions tab (prepare, agenda, intervention read,
   previous meetings and open commitments).
2. Presentation mode (athlete-safe, full screen, opened in its own window for
   screen sharing) with the private coach workspace; questionnaire via forms.
3. After the call: notes or Otter transcript import (consent, retention),
   background analysis, commitments, intelligence review, recommendations
   routed to the existing editors, the shared game plan sent only on a tap.
4. Lifecycle test on isolated data (a 57 kg meet 10 days out modelled on a real
   prep, a general meeting, a retrospective import), regressions, deploy.
