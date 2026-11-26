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
- `planAgenda` — coach-led, 15–30 minutes: Connect, Recognize, Evaluate,
  Coach, Execute, Align (stages with nothing in them drop out). Every talking
  point has an id, what it rests on (`basis`: verified record, client
  reported, coach observed, Cleo's interpretation, unknown), whether it goes
  on the shared screen (`share`), its status (open / addressed / skipped) and
  how it's said (`say`, the coach's edit first, then Cleo's checked
  refinement `cleoSay`). Clarifications are kept apart (`agenda.clarify`) and
  asked only where they're evaluated. Plans from before (v1) read through
  `normalizeAgenda`.
- `mergeAgenda` / `agendaChanges` / `applyAgendaOp` — a refresh never loses the
  coach's work: edited, skipped, moved and custom points stay; new points
  carry `addedAt` so the command centre can say what's new since the coach
  last looked (`coach_reviewed_at`); points the records no longer support are
  dropped only if the coach never touched them. Edits are ops applied on the
  server to the plan on file.
- `recommendIntervention` — the lowest effective intervention: nothing, a
  message, an information request, a resource, a 5–10 minute touch-base or a
  15–30 minute call, with why; meaningful decisions earn a call, the final week
  before a meet avoids one, an existing booking is respected, and an included
  call is said apart from a General Call.
- `questionnaireFor` — at most three targeted questions (open pain, unlogged
  workouts, registration, a stale check-in or weigh-in, how they feel about a
  meet), personalized labels in `settings.ask_labels`, plus an optional note
  only alongside them; nothing when the records cover it. Under 2 minutes.
  Sent with the day-before confirmation, or by the coach's tap. The plan never
  depends on the answers.
- `meetingReadiness` (lifecycle.ts) — confirmation, the client's prep, the
  coach's prep, what's left to clarify, how to join; ready means the plan
  exists, never that the client answered.
- `ambiguousLoads` (units.ts) — a load said with no unit, or in the unit they
  don't train in, is flagged on recommendations and in the outcome before it
  feeds attempts or loads.
- `reviewCandidate` / `memoryBoard` (memory.ts) — a memory from a meeting is a
  duplicate (merged), a conflict (shown beside the line it contradicts), kept
  by itself only when it's a low-risk goal, preference or achievement said
  plainly by the client with the speaker confirmed and auto-keep allowed, else
  waits for the coach. Temporary and event lines go outdated by date.
- `coverageRead` (coverage.ts) — while a consented recording is transcribed,
  points that sound covered and important ones not heard yet (suggested,
  never marked).
- `checkBrief` — Cleo's pre-call brief only organizes the prep: focus points
  cite prep lines that exist; nothing carries a number the prep doesn't.
- `checkAnalysis` — every extracted item must quote the transcript
  (`quoteFound`); a hedged agreement is only floated; a recommendation needs
  the conversation behind it and no invented numbers (five at most);
  intelligence the coach already confirmed isn't proposed again; what's
  dropped is listed for the coach.

## The meeting command centre

`/admin/meetings/$sessionId` (command-centre.tsx), reached from the client's
profile strip (`MeetingStrip`), the strip at the top of their coach chat,
Home's Meetings card (`MeetingsDashboardCard`, `meetingsBoard`), the Meetings
tab and the coach's 15-minute push (`/admin/meetings/by-booking/$ptSessionId`,
which prepares the meeting if it isn't yet). Three stages:

- Prepare: readiness strip, what's new since last look, the objective and
  outcome, clarifications, the plan (`PlanEditor`: edit, skip, reorder, move,
  add, hide from the screen), client prep, Cleo's brief, private notes. Start
  meeting.
- Connect: Join (15 minutes before to the end), Present and Script windows
  (one `presentChannel`; the script reports its slide so the plan highlights
  the stage), the timer, the recorder, the plan in meeting mode (mark
  addressed, what sounds covered), notes, decisions, commitments. End meeting.
- Execute (session-after.tsx): what Cleo did and what's still the coach's,
  the outcome (feedback, to improve, decided, their part, your part,
  objectives, wins, still open, floated), recommendations whose status never
  claims more than happened (Suggested · Needs review · Approved, not applied
  yet · Applied · Kept as is · Later · Dismissed; Mark applied only after
  applying it in the tab's own editor), commitments, memories, the optional
  recap, speakers to name, the transcript (edit a line), deletion.

## Appointments

A booked call (a non-training `pt_session`) has one state both sides see
(`appointmentState`): scheduled, awaiting confirmation, confirmed (they
confirmed, booked it themselves, or asked for the time it moved to),
change requested, cancelled, completed, no-show. The day before (24h, until
3h before; never for a late booking, a call they chose, or a client without
the app) `runMeetingAutomation` sends one message in their coach chat: the
`session_confirm` card (Confirm through `pt_session_confirm`, Change time /
Can't make it through `ClientSessionSheet`, the session staying booked until
the coach answers) and, when they'd help, the pre-meeting questions as a form
card. That message is the client's day-before reminder; both sides get a push
15 minutes before (the client's opens Join, the coach's the meeting). A move
clears both stamps (`tg_pt_session_confirmation`), so a moved call is
confirmed afresh and its reminders follow the new time.

## Recording

`MeetingRecorder` (recorder.tsx) on the one recorder library
(`startMeetingCapture`, meeting-capture.ts): the device's microphone (in the
room, or a call on speaker) or, on desktop Chrome and Edge, a call in another
tab with its audio (getDisplayMedia, mixed with the mic). A web page can't
capture another app's audio, so a Zoom or Meet app call, or one on a phone, is
added afterwards as a transcript (Otter or any file). Consent is ticked first
and names the participants; retention is chosen (30 / 90 / 365 days or until
deleted). It records in 5-minute parts, each kept on the device
(IndexedDB) until the server has it, uploaded to the private
`coaching-recordings` bucket through a signed URL, and transcribed by the
tick with OpenAI's diarizing model (`gpt-4o-transcribe-diarize`, voice
samples from the first part so labels hold across parts; whisper-1 without
speakers as the fallback), so the transcript builds near-live. Speakers stay
"Speaker A/B" until the coach names them; nothing uncertain is attributed and
no emotion is inferred. True word-by-word live captions are not built.

## Background work

`coaching-sessions-tick` (pg_cron every minute, only while
`coaching_sessions_due()`): `runSessionWork` claims a row by its `updated_at`,
writes Cleo's brief (route `session_brief`) or reads the meeting (route
`session_analysis`) through `stagedCall` on the OpenAI key only, parks while a
model is still thinking, and waits without using an attempt while OpenAI is
down; keeps booked calls prepared (`keepMeetingsReady`: a meeting for every
booked coaching call in the next 14 days, plans refreshed when the records
change, at most every 3 hours); transcribes recording parts
(`transcribeDueParts`); then removes raw transcripts and audio past their
retention date. The 5-minute `appointment-reminders` tick runs
`runMeetingAutomation` before the reminders.

## Reliability (Nov 26 2026)

- **No lost edits.** Every write that depends on what's on a meeting (the plan, live notes, the outcome, the recording record, the questions' send) is `writeFresh` (fresh-write.server.ts): the patch is worked out from the row as read and written only while `updated_at` is unchanged, else the row is read again (5 tries, then "being changed somewhere else"). The command centre sends plan edits one at a time and doesn't let a refetch replace the plan on screen until they've all landed.
- **Refreshes keep the coach's work.** An objective the coach wrote stays (`objectiveEdited`); a clarification they settled or reworded stays, even once it's no longer on file.
- **Said once.** A plan never says the same signal twice (`onceEach` when built; an untouched repeat in a stored plan is dropped as it's read). An outcome line the coach noted and the same idea Cleo read are one line, with Cleo's quote and date.
- **Recordings finish.** A part waiting on the client's AI permission is re-checked every 10 minutes (no model call); a part cut off on its last try is failed; audio that never became a transcript goes when its retention runs out (`coaching_audio_due()`), and the Execute stage offers the transcript upload instead.
- **Small guards.** A reading whose transcript is deleted keeps nothing; the questions' send is claimed before it goes (no double send) and carries this send's wording; Undo of a memory only touches that client's rows; a meeting links only to its own client's booking; the background queries filter training sessions before their limit; the day-before message uses the client's own clock.

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
