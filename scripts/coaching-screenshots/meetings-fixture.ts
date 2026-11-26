/**
 * Coaching Sessions (Meetings) screenshots: the fixtures, built by the real
 * engines (the prep, the agenda, the intervention, the athlete-safe shared
 * screen) for a made-up athlete, never a client's data. Writes one JSON the
 * screenshot run (meetings.cjs) answers the Meetings tab's server functions with.
 *
 *   npx tsx scripts/coaching-screenshots/meetings-fixture.ts /tmp/meetings-fixture.json
 *
 * Cleo's brief and reading here are the ones production wrote on Nov 25 2026
 * for the made-up meet call in the lifecycle test (a 57 kg lifter ten days out,
 * transcript in the PR's validation notes), with the test account's name
 * swapped for the made-up athlete's.
 */
import { writeFileSync } from "node:fs";
import { buildSessionPrep, planAgenda, recommendIntervention, type SessionPrepInput } from "../../src/lib/coaching-sessions/prepare";
import { athleteView, SECTION_PROMPTS } from "../../src/lib/coaching-sessions/presentation";
import type { SessionEvent } from "../../src/lib/coaching-sessions/events";
import { meetingReadiness } from "../../src/lib/coaching-sessions/lifecycle";

const out = process.argv[2] ?? "/tmp/meetings-fixture.json";
const TODAY = "2026-11-25";
const CLIENT_ID = "c1111111-2222-4333-8444-555555555555";
const SESSION_ID = "a1111111-2222-4333-8444-555555555555";
const COMP_ID = "d1111111-2222-4333-8444-555555555555";
const NOW = "2026-11-25T19:06:00Z";

const meet: SessionEvent = {
  key: `competition:${COMP_ID}`,
  kind: "competition",
  title: "Fall Classic",
  date: "2026-12-05",
  location: "Winnipeg, MB",
  source: "Competition Intelligence",
  competitionId: COMP_ID,
  prepId: null,
  weightClass: "57",
  daysOut: 10,
  phase: "Final preparation",
  conflicts: [],
};
const nationals: SessionEvent = {
  ...meet,
  key: "competition:nationals",
  title: "2027 Nationals",
  date: "2027-02-27",
  daysOut: 94,
  phase: "Build",
  competitionId: null,
};

const input: SessionPrepInput = {
  today: TODAY,
  topics: "Bench opener and whether I need to cut water",
  bookingNote: null,
  workouts: { planned: 12, done: 11, missed: 1, lastDone: "2026-11-24", avgRating: 4.2 },
  bodyweight: { unit: "kg", latestKg: 58.1, latestDate: "2026-11-25", avg7Kg: 58.3, weeklyChangeKg: -0.3, goalKg: 57, goalDate: "2026-12-05", stale: false },
  checkins: { count: 4, latest: "2026-11-22", adherence: 4.3, poorSleep: 0, lowEnergy: 1, stress: 2 },
  nutrition: { phase: "Fat loss", kcalLow: 1850, kcalHigh: 2100, since: "2026-11-01" },
  pain: [],
  weightRead: "Hold the plan: on pace for 57 kg",
  weightVerdict: "maintain",
  records: {
    top: [
      { exercise: "Competition Squat", reps: 1, loadKg: 110, date: "2026-11-21" },
      { exercise: "Competition Deadlift", reps: 2, loadKg: 125, date: "2026-11-11" },
    ],
    total: 3,
  },
  previous: null,
  calls: null,
  event: meet,
  competition: {
    expectedTotal: 292.5,
    range: { conservative: 280, high: 302.5 },
    place: 2,
    gamePlanReleased: false,
    headline: "Bench is the open question; squat and deadlift openers are well supported.",
    openDecisions: ["Bench opener: 60 or 62.5 kg"],
    classGapKg: 1.1,
  },
  commitments: [],
  intelligence: ["Opens light on bench by choice"],
  coachNotes: "Wants the plan locked early; nervous about the bench opener.",
  coachPriorities: ["Lock squat and deadlift openers", "No water cut: make 57 with the food plan"],
  answers: {
    training_feel: "Good",
    recovery: "Mostly fine",
    pain: "Something minor",
    pain_details: "Left knee achy after high-bar days",
    life: "Exams Monday and Wednesday",
    meet_registered: "Yes",
    meet_confidence: "Nervous",
    meet_success: "Go 9 for 9 and make weight without a water cut",
  },
};

const prep = buildSessionPrep(input);
const agenda = planAgenda(prep);
const intervention = recommendIntervention({
  today: TODAY,
  event: meet,
  prep,
  bookedCallOn: null,
  lastCallOn: "2026-10-28",
  includedCallsLeft: 2,
  athleteAsked: true,
  seriousConcern: false,
});

const brief = {
  at: "2026-11-25T19:13:12Z",
  model: "openai:gpt-5.5",
  summary:
    "This call is mainly about locking the meet plan 10 days out while keeping Alex calm and bought in. A good outcome is clear openers, a simple weight approach with no water cut, and a plan for handling exams, stress, and the minor knee issue without overcomplicating the final week.",
  focus: [
    { refs: ["P3"], text: "Settle the bench opener concern and lock squat and deadlift openers so the meet plan feels clear early." },
    { refs: ["P8"], text: "Align on making weight without a water cut, since that is part of Alex's definition of a successful meet." },
    { refs: ["P4", "P5"], text: "Check how exams, stress, sleep, and the achy left knee may affect the final week." },
  ],
  questions: [
    { section: "athletes_corner", text: "What would make you feel confident about the bench opener?", why: "Clarifies what's driving the nerves and what would settle them." },
    { section: "game_plan", text: "How are you thinking about making weight without a water cut right now?", why: "Checks their expectations around the agreed weight approach." },
    { section: "athletes_corner", text: "What have you noticed about the left knee after high-bar days?", why: "Gathers their description without diagnosing or overreacting." },
  ],
  listenFor: [
    "Whether the bench opener concern is about strength, confidence, commands, or meet-day strategy.",
    "Any mismatch between 'training feels good' and the left knee being achy after high-bar days.",
  ],
  avoid: ["Rebuilding the whole peak plan unless Alex raises a clear issue."],
  dropped: [],
};

// Cleo's reading of the meet call, as production wrote it (name swapped)
const analysis = {
  at: "2026-11-25T19:17:39Z",
  model: "openai:gpt-5.5",
  source: "transcript",
  clipped: false,
  summary:
    "Alex is 10 days out from the Fall Classic at 57 kg and reported feeling mostly excited with some nerves. Squat and deadlift openers were locked at 105 kg and 125 kg, while the bench opener stays open until after Thursday's session. The coach and Alex agreed there will be no water cut, and Alex will aim to make 57 kg through the food plan while sending daily morning weights. Alex reported a left knee ache after high-bar squats, upcoming exams that may reduce sleep, and uncertainty about the meet flight until it is posted Monday.",
  contradictions: [],
  dropped: [],
  items: [
    { basis: "confirmed", kind: "win", speaker: "athlete", text: "Squat readiness looked strong, with the 110 single moving fast.", quote: "Squats felt really solid on Saturday, that 110 single moved fast.", due: null },
    { basis: "confirmed", kind: "agreement", speaker: "athlete", text: "Squat opener is locked at 105 kg.", quote: "Yes, 105 for the squat opener is perfect, I'm good with that.", due: "2026-12-05" },
    { basis: "tentative", kind: "tentative", speaker: "coach", text: "Bench opener may be 60 kg instead of 62.5 kg, but it will be decided after Thursday.", quote: "maybe we open at 60 instead of 62.5, but let's see how Thursday's session goes before we lock it.", due: "2026-11-26" },
    { basis: "confirmed", kind: "agreement", speaker: "athlete", text: "Deadlift opener is locked at 125 kg.", quote: "Yep, 125 on deadlift works for me, let's lock it in.", due: "2026-12-05" },
    { basis: "confirmed", kind: "agreement", speaker: "coach", text: "No water cut; Alex will make 57 kg with the food plan and a normal week.", quote: "No, we don't do water cuts. You're 1.1 over with ten days to go, that comes off with the food plan and a normal week.", due: "2026-12-05" },
    { basis: "confirmed", kind: "concern", speaker: "athlete", text: "Left knee gets achy after high-bar squats, but not comp squats.", quote: "My left knee gets a bit achy after the high-bar squats. Not on the comp squat, just the high-bar days.", due: null },
    { basis: "tentative", kind: "tentative", speaker: "coach", text: "If the knee is still achy after Tuesday, high-bar will be swapped for comp squats.", quote: "If it's still achy after Tuesday, tell me and we'll swap it for comp squats.", due: "2026-12-01" },
    { basis: "confirmed", kind: "open_question", speaker: "athlete", text: "Flight assignment isn't posted yet; Alex will say once it is.", quote: "Not yet, they post it Monday. I'll tell you as soon as it's up.", due: "2026-11-30" },
  ],
  recommendations: [],
  intelligence: [],
  feedback: {
    strengths: [
      "You gave clear decisions on squat and deadlift while leaving bench open only where the evidence was still unclear.",
      "You reduced anxiety around weight with a simple no-water-cut plan and daily morning weights.",
    ],
    consider: ["When you send the Sunday plan, include the knee and exam-day contingencies in writing so the locked plan still feels predictable."],
  },
  followUp: { level: "message", when: "After Thursday's bench session", why: "Decide and lock the bench opener, then include it in the written warm-up and attempt plan due Sunday." },
};

const rec = (id: string, area: string, kind: string, title: string, current: string, proposed: string, reason: string, quotes: string[], benefit: string, tradeoffs: string, affects: string) => ({
  id,
  session_id: SESSION_ID,
  client_id: CLIENT_ID,
  area,
  title,
  current_text: current,
  proposed_text: proposed,
  reason,
  evidence: quotes.map((quote) => ({ quote })),
  benefit,
  tradeoffs,
  affects,
  kind,
  status: "proposed",
  decision_note: null,
  routed_kind: null,
  routed_id: null,
  decided_by: null,
  decided_at: null,
  created_at: "2026-11-25T19:17:40Z",
});
const recommendations = [
  rec("r1111111-2222-4333-8444-555555555551", "nutrition", "keep", "Keep the no-water-cut approach", "58.1 kg this morning, 57 kg at weigh-in.", "", "The coach said the difference comes off with the food plan and a normal week, and Alex was relieved not to water cut.", ["You're 1.1 over with ten days to go, that comes off with the food plan and a normal week.", "Okay. That's a relief honestly, I was dreading that."], "Keeps the final week calmer.", "Needs daily weigh-ins and the food plan followed.", "Nutrition, meet-week confidence"),
  rec("r1111111-2222-4333-8444-555555555552", "training", "change", "Use the high-bar knee contingency", "One more high-bar day; the left knee aches after high-bar, not comp squats.", "If the knee is still achy after Tuesday, swap high-bar squats for comp squats.", "The ache is specific to high-bar days and a clear conditional plan was agreed.", ["My left knee gets a bit achy after the high-bar squats. Not on the comp squat, just the high-bar days.", "If it's still achy after Tuesday, tell me and we'll swap it for comp squats."], "Less irritation, specificity kept close to the meet.", "Less variation if high-bar comes out.", "Squat programming, the final week"),
  rec("r1111111-2222-4333-8444-555555555553", "schedule", "change", "Lighter exam days", "Exams Monday and Wednesday may cut sleep short.", "On exam days, keep the main lifts and skip accessories.", "Agreed after Alex flagged the exams.", ["I have exams next Monday and Wednesday, so sleep might be a bit short those nights.", "On exam days just do the main lifts and skip the accessories, that's fine."], "Protects recovery and keeps the priority lifts.", "Less accessory work that week.", "Training schedule, recovery"),
];
const commitments = [
  { id: "m1111111-2222-4333-8444-555555555551", client_id: CLIENT_ID, session_id: SESSION_ID, owner: "athlete", text: "Send morning weight every day this week.", due_on: "2026-11-29", status: "open", confirmed: false, source_quote: "Yes, I'll send you my morning weight every day this week.", created_at: NOW },
  { id: "m1111111-2222-4333-8444-555555555552", client_id: CLIENT_ID, session_id: SESSION_ID, owner: "coach", text: "Send the full warm-up plan and attempts in writing by Sunday.", due_on: "2026-11-29", status: "open", confirmed: false, source_quote: "I'll send you the full warm-up plan and your attempts in writing by Sunday.", created_at: NOW },
];
const intelligence = [
  { id: "i1111111-2222-4333-8444-555555555551", client_id: CLIENT_ID, kind: "preference", text: "Does better when the plan is known days ahead; last-minute changes throw them off.", permanence: "lasting", expires_on: null, status: "proposed", visibility: "coach", source_session_id: SESSION_ID, source_quote: "I always do better when I know the plan days ahead. Last-minute changes really throw me off.", created_at: NOW, updated_at: NOW },
  { id: "i1111111-2222-4333-8444-555555555552", client_id: CLIENT_ID, kind: "constraint", text: "Exams next Monday and Wednesday may cut sleep short.", permanence: "temporary", expires_on: "2026-12-02", status: "proposed", visibility: "coach", source_session_id: SESSION_ID, source_quote: "I have exams next Monday and Wednesday, so sleep might be a bit short those nights.", created_at: NOW, updated_at: NOW },
];

const questionnaire = {
  sent_at: "2026-11-25T15:11:49Z",
  submitted_at: "2026-11-25T16:02:44Z",
  keys: ["topics", "training_feel", "recovery", "pain", "pain_details", "life", "meet_registered", "meet_confidence", "meet_success"],
  minutes: 2,
  reasons: ["Their last check-in is over a week old", "A meet is coming: how they feel about it, in their words"],
  answers: Object.fromEntries(Object.entries(input.answers).map(([k, v]) => [k, { label: k, text: v }])),
};

const session = (over: Record<string, unknown>) => ({
  id: SESSION_ID,
  client_id: CLIENT_ID,
  coach_user_id: "u0000000-0000-4000-8000-000000000001",
  pt_session_id: null,
  competition_id: COMP_ID,
  event: meet,
  format: "call",
  status: "ready",
  scheduled_at: "2026-11-26T00:00:00Z",
  minutes: agenda.minutes,
  coach_notes: input.coachNotes,
  coach_priorities: input.coachPriorities,
  prep,
  agenda,
  live: {},
  game_plan: null,
  write_up: brief,
  write_up_status: "ready",
  questionnaire,
  questionnaire_submission_id: "s1111111-2222-4333-8444-555555555555",
  analysis: null,
  analysis_status: "none",
  analysis_error: null,
  transcript_path: null,
  transcript_source: null,
  transcript_consent_at: null,
  transcript_retain_until: null,
  transcript_deleted_at: null,
  shared_at: null,
  shared_message_id: null,
  held_at: null,
  attempts: 0,
  locked_at: null,
  progress: null,
  created_at: "2026-11-25T15:06:00Z",
  updated_at: NOW,
  ...over,
});

const before = {
  session: session({}),
  firstName: "Alex",
  clientName: "Alex Rivera",
  hasApp: true,
  cleo: true,
  questions: null,
  commitments: [],
  recommendations: [],
  intelligence: [],
};
const after = {
  ...before,
  session: session({
    status: "done",
    held_at: "2026-11-26T00:05:00Z",
    live: { decisions: ["Squat opener 105 kg", "Deadlift opener 125 kg", "No water cut: make 57 with the food plan"] },
    analysis,
    analysis_status: "ready",
    transcript_path: `${CLIENT_ID}/${SESSION_ID}.txt`,
    transcript_source: "otter",
    transcript_consent_at: "2026-11-26T00:40:00Z",
    transcript_retain_until: "2026-12-26",
  }),
  commitments,
  recommendations,
  intelligence,
};

const home = {
  today: TODAY,
  firstName: "Alex",
  events: [meet, nationals],
  nextEvent: meet,
  intervention,
  missing: prep.missing,
  decisions: prep.decisions,
  sessions: [
    { id: SESSION_ID, event: meet, format: "call", status: "ready", scheduled_at: "2026-11-26T00:00:00Z", minutes: agenda.minutes, created_at: "2026-11-25T15:06:00Z", analysis_status: "none", shared_at: null, write_up_status: "ready" },
    { id: "a1111111-2222-4333-8444-555555555556", event: { ...nationals, key: "general:off-season", kind: "general", title: "Off-season check-in", date: null, daysOut: null, phase: null }, format: "retrospective", status: "done", scheduled_at: "2026-10-28T23:00:00Z", minutes: 20, created_at: "2026-10-29T01:00:00Z", analysis_status: "ready", shared_at: "2026-10-29T01:20:00Z", write_up_status: "none" },
  ],
  commitments: [
    { id: "m1111111-2222-4333-8444-555555555559", sessionId: "a1111111-2222-4333-8444-555555555556", owner: "coach", text: "Map out next year's meets around a nationals qualifier.", dueOn: "2026-11-04", status: "open", sessionDate: "2026-10-28" },
  ],
  intelligence: [
    { id: "i1111111-2222-4333-8444-555555555559", kind: "preference", text: "Opens light on bench by choice.", status: "confirmed", permanence: "lasting", expires_on: null },
    { id: "i1111111-2222-4333-8444-555555555558", kind: "goal", text: "Wants to qualify for nationals next year.", status: "confirmed", permanence: "lasting", expires_on: null },
  ],
  bookedCallOn: null,
  lastCallOn: "2026-10-28",
};

const presentation = {
  firstName: "Alex",
  event: { title: meet.title, date: meet.date, daysOut: meet.daysOut, phase: meet.phase, kind: "competition" },
  minutes: agenda.minutes,
  sections: athleteView(agenda).map((s) => ({ ...s, prompt: SECTION_PROMPTS[s.key] })),
  agreed: [],
};

// The meeting's command centre (/admin/meetings/$id): the same session with what
// getSession adds: the booked call it's for, readiness, what changed since the
// coach last looked, the recording's parts and the client's memories.
const PT_ID = "p1111111-2222-4333-8444-555555555555";
const appointment = {
  ptSessionId: PT_ID,
  title: "Coaching Plus Call",
  startsAt: "2026-11-26T00:00:00Z",
  endsAt: "2026-11-26T00:30:00Z",
  timezone: "America/Winnipeg",
  location: "Video call",
  meetLink: "https://meet.google.com/abc-defg-hij",
  status: "Scheduled",
  sessionType: "Coaching Plus Call",
  state: "confirmed",
  confirmedAt: "2026-11-25T16:10:00Z",
  confirmationRequestedAt: "2026-11-25T15:11:49Z",
  pendingChange: null,
  bookedByClient: false,
};
const changesSinceReview = [
  { at: "2026-11-25T16:03:00Z", text: "New in Evaluate: Left knee achy after high-bar days (their answer)" },
  { at: "2026-11-25T16:03:00Z", text: "New in Execute: Exams Monday and Wednesday may cut sleep short" },
];
const readinessFor = (over: Partial<Parameters<typeof meetingReadiness>[0]> = {}) =>
  meetingReadiness({
    state: "confirmed",
    planReady: true,
    briefStatus: "ready",
    coachReviewed: true,
    changesSinceReview: changesSinceReview.length,
    questions: "answered",
    clarify: (agenda.clarify ?? []).length,
    access: { kind: "video", label: "Video link" },
    format: "call",
    ...over,
  });
const centreBase = {
  unit: "kg",
  reviewedBefore: "2026-11-25T15:30:00Z",
  appointment,
  audio: [] as unknown[],
  memories: [
    ...home.intelligence.map((i) => ({ ...i, client_id: CLIENT_ID, visibility: "coach", source_session_id: "a1111111-2222-4333-8444-555555555556", source_quote: null, created_at: "2026-10-29T01:00:00Z", updated_at: "2026-10-29T01:00:00Z" })),
  ],
};
const centre = {
  before: { ...before, ...centreBase, session: { ...before.session, pt_session_id: PT_ID, coach_reviewed_at: "2026-11-25T15:30:00Z", changes: changesSinceReview }, changesSinceReview, readiness: readinessFor() },
  // a client who sent nothing: the plan is still whole
  bare: {
    ...before,
    ...centreBase,
    appointment: { ...appointment, state: "awaiting_confirmation", confirmedAt: null },
    session: { ...before.session, pt_session_id: PT_ID, questionnaire: null, questionnaire_submission_id: null, coach_reviewed_at: null, changes: [] },
    changesSinceReview: [],
    reviewedBefore: null,
    readiness: readinessFor({ state: "awaiting_confirmation", questions: "not_needed", coachReviewed: false, changesSinceReview: 0 }),
  },
  live: {
    ...before,
    ...centreBase,
    session: { ...before.session, pt_session_id: PT_ID, status: "live", live: { started_at: "2026-11-25T18:52:00Z", notes: "Bench opener: wants 60. Knee fine on comp days." } },
    changesSinceReview: [],
    readiness: readinessFor({ changesSinceReview: 0 }),
    audio: [
      { id: "au1", seq: 0, status: "done", offset_ms: 0, duration_ms: 300000, transcript: { segments: [{ start: 2, end: 9, speaker: "A", text: "So ten days out, how are you feeling about the bench opener?" }, { start: 10, end: 18, speaker: "B", text: "Honestly a bit nervous. I think 60 would feel better than 62.5." }] }, model: "gpt-4o-transcribe-diarize", error: null, created_at: "2026-11-25T18:57:00Z" },
      { id: "au2", seq: 1, status: "transcribing", offset_ms: 300000, duration_ms: 300000, transcript: null, model: null, error: null, created_at: "2026-11-25T19:02:00Z" },
    ],
  },
  after: { ...after, ...centreBase, session: { ...after.session, pt_session_id: PT_ID, outcome: {} }, changesSinceReview: [], readiness: readinessFor({ changesSinceReview: 0 }) },
};

writeFileSync(out, JSON.stringify({ CLIENT_ID, SESSION_ID, home, before, after, presentation, centre }, null, 2));
console.log(`wrote ${out}: ${agenda.minutes} min, athlete's share ${agenda.athleteShare}, ${intervention.level}`);
