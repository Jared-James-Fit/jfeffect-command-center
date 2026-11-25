/**
 * Competition Intelligence screenshots: the fixtures, built by the real
 * engines (brief, evidence, Cleo's checked calls) for a made-up athlete and a
 * made-up field, never a client's data. Writes one JSON the screenshot run
 * (competition.cjs) answers the Competition tab's server functions with.
 *
 *   npx tsx scripts/coaching-screenshots/competition-fixture.ts /tmp/competition-fixture.json
 *
 * Cleo's words here are written for the made-up athlete in the shape and
 * voice of the production assessment (see the PR's validation notes); every
 * number in them comes from the engines below.
 */
import { writeFileSync } from "node:fs";
import { buildBrief, type BriefContext } from "../../src/lib/competition/brief";
import { buildEvidence } from "../../src/lib/competition/evidence";
import { readProposals, strategyOf } from "../../src/lib/competition/proposals";
import { meetsFromOplCsv } from "../../src/lib/competition/opl";
import { IPF_RULES } from "../../src/lib/competition/rules";
import { athleteVersion, readNarrative } from "../../src/lib/competition/write.server";
import type { LiftEvidence } from "../../src/lib/competition/forecast";

const out = process.argv[2] ?? "/tmp/competition-fixture.json";
const TODAY = "2027-01-25";
const MEET = "2027-02-08";
const CLIENT_ID = "c1111111-2222-4333-8444-555555555555";
const COMP_ID = "d1111111-2222-4333-8444-555555555555";

const HEAD =
  "Name,Sex,Event,Equipment,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Best3DeadliftKg,TotalKg,Place,Federation,Date,MeetName";
const csv = (name: string, rows: string[]) =>
  [HEAD, ...rows.map((r) => `${name},M,SBD,Raw,Open,${r}`)].join("\n");

const ALEX = csv("Alex Rivera", [
  "73.6,74,240,250,-257.5,250,160,167.5,170,170,272.5,287.5,295,295,715,2,CPU,2026-09-12,Western Canadian Championships",
  "73.4,74,235,245,252.5,252.5,155,162.5,-167.5,162.5,265,280,-292.5,280,695,3,CANPL,2026-03-14,Nationals",
  "73.8,74,230,240,247.5,247.5,152.5,160,165,165,260,275,285,285,697.5,1,CPU,2025-10-18,Provincials",
]);
const FIELD = [
  {
    id: "f1111111-2222-4333-8444-555555555551",
    name: "Sam Okafor",
    csv: csv("Sam Okafor", [
      "73.9,74,255,265,-272.5,265,165,172.5,-177.5,172.5,280,295,302.5,302.5,740,1,CANPL,2026-03-14,Nationals",
      "73.7,74,250,260,267.5,267.5,162.5,170,175,175,275,290,-300,290,732.5,1,CPU,2025-09-20,Westerns",
    ]),
    obs: [
      ["2026-12-14", "squat", 270, 2, 9],
      ["2027-01-04", "squat", 275, 1, 9],
      ["2027-01-18", "squat", 277.5, 1, 9.5],
    ],
  },
  {
    id: "f1111111-2222-4333-8444-555555555552",
    name: "Liam Tremblay",
    csv: csv("Liam Tremblay", [
      "73.2,74,245,255,262.5,262.5,170,-177.5,177.5,177.5,270,282.5,-290,282.5,722.5,2,CANPL,2026-03-14,Nationals",
      "73.5,74,240,250,-257.5,250,167.5,175,-180,175,265,277.5,285,285,710,2,CPU,2025-11-08,Easterns",
    ]),
    obs: [],
  },
  {
    id: "f1111111-2222-4333-8444-555555555553",
    name: "Noah Fischer",
    csv: csv("Noah Fischer", [
      "73.8,74,232.5,242.5,250,250,150,157.5,-162.5,157.5,262.5,275,282.5,282.5,690,4,CANPL,2026-03-14,Nationals",
    ]),
    obs: [],
  },
];

const ev = (lift: "squat" | "bench" | "deadlift", nowKg: number, extra: Partial<LiftEvidence> = {}): LiftEvidence => ({
  lift,
  nowKg,
  state: "measured",
  basis: null,
  basisDay: "2027-01-19",
  hardSessions6w: 5,
  trendPerWeek: 0.003,
  direction: "up",
  ...extra,
});

const ctx: BriefContext = {
  today: TODAY,
  milestone: "game_plan",
  competition: {
    id: COMP_ID,
    name: "2027 Canadian Nationals",
    meetDate: MEET,
    meetEndDate: null,
    federation: "CanPL",
    division: "Open",
    weightClass: "74",
    level: "national",
    objective: "podium",
    targetTotal: 725,
    targetPlace: 2,
    qualificationTotal: null,
    recordsNote: null,
    registration: "registered",
    liftingStart: "09:00",
    weighInAt: "07:00",
    flight: "B",
    location: "Calgary",
    rules: { ...IPF_RULES, confirmed: true },
    athleteGoalTotal: 730,
  },
  athlete: {
    name: "Alex Rivera",
    firstName: "Alex",
    sex: "M",
    bodyweightAvg: 74.6,
    bodyweightTrendPerWeek: -0.35,
    classLimit: 74,
  },
  lifts: {
    squat: ev("squat", 252.5, { basis: "235 kg × 3 @ 8 on Jan 19 → 252.5 kg estimate" }),
    bench: ev("bench", 168, { basis: "157.5 kg × 3 @ 8.5 on Jan 21 → 168 kg estimate" }),
    deadlift: ev("deadlift", 292.5, { basis: "272.5 kg × 2 @ 8.5 on Jan 16 → 292.5 kg estimate" }),
  },
  meets: meetsFromOplCsv(ALEX),
  conversion: [
    { lift: "squat", meetDate: "2026-09-12", meetKg: 250, trainingKg: 246 },
    { lift: "squat", meetDate: "2026-03-14", meetKg: 252.5, trainingKg: 248 },
    { lift: "bench", meetDate: "2026-09-12", meetKg: 170, trainingKg: 166 },
    { lift: "deadlift", meetDate: "2026-09-12", meetKg: 295, trainingKg: 290 },
  ],
  warmups: {
    squat: { sessions: 8, medianSets: 5, lastPct: 0.89 },
    bench: { sessions: 7, medianSets: 6, lastPct: 0.91 },
    deadlift: { sessions: 6, medianSets: 4, lastPct: 0.88 },
  },
  topSingles: { squat: 240, bench: 160, deadlift: 275 },
  competitors: FIELD.map((f) => ({
    id: f.id,
    name: f.name,
    meets: meetsFromOplCsv(f.csv),
    identity: "matched",
    status: f.name === "Noah Fischer" ? "suggested" : "registered",
    observations: f.obs.map(([date, lift, kg, reps, rpe]) => ({
      date: date as string,
      lift: lift as "squat",
      exercise: "Competition squat",
      loadKg: kg as number,
      reps: reps as number,
      rpe: rpe as number,
      standard: "competition" as const,
      equipment: "sleeves",
      source: "video" as const,
      url: null,
      confidence: "high" as const,
      note: null,
    })),
  })),
  watch: {
    programEndsOn: MEET,
    programRead: true,
    peakCovered: true,
    pain: [],
    recoveryFlags: 1,
    adherence: 0.94,
    cardioMinutesPerWeek: 60,
  },
  call: { lastCallDaysAgo: 41, upcomingCallOn: null, includedCallsLeft: 1, packageName: "Coaching Plus" },
  previous: { expectedTotal: 712.5 },
  checks: [],
  cues: { squat: ["Big air, brace, sit between the heels"], bench: ["Pull the bar in, leg drive on press"], deadlift: ["Push the floor, hips through"] },
  sessions: {
    squat: [
      { day: "2027-01-19", kg: 235, reps: 3, rpe: 8, e1rm: 252.5, confidence: "high", heaviestKg: 235, velocity: 0.38 },
      { day: "2027-01-12", kg: 240, reps: 1, rpe: 8, e1rm: 252, confidence: "high", heaviestKg: 240, velocity: 0.34 },
      { day: "2027-01-05", kg: 230, reps: 3, rpe: 8, e1rm: 247, confidence: "high", heaviestKg: 230, velocity: 0.37 },
    ],
    bench: [
      { day: "2027-01-21", kg: 157.5, reps: 3, rpe: 8.5, e1rm: 168, confidence: "high", heaviestKg: 157.5, velocity: 0.29 },
      { day: "2027-01-14", kg: 160, reps: 1, rpe: 8, e1rm: 167.5, confidence: "high", heaviestKg: 160, velocity: 0.27 },
    ],
    deadlift: [
      { day: "2027-01-16", kg: 272.5, reps: 2, rpe: 8.5, e1rm: 292.5, confidence: "high", heaviestKg: 272.5, velocity: 0.31 },
      { day: "2027-01-09", kg: 265, reps: 3, rpe: 8.5, e1rm: 289, confidence: "high", heaviestKg: 265, velocity: null },
    ],
  },
};

const brief = buildBrief(ctx);
const evidence = buildEvidence(brief);
const sq = brief.attempts.lifts.squat!;
const dl = brief.attempts.lifts.deadlift!;
const sam = brief.competitors.find((c) => c.name === "Sam Okafor")!;
const proposals = readProposals([
  {
    type: "forecast",
    lift: "squat",
    scenario: "expected",
    kg: brief.forecast.lifts.squat!.range.expected + 2.5,
    text: "Squat expected a step higher",
    reason:
      "Alex has squatted 4 kg over the training line at both meets on record, and the last two heavy squat days moved at 0.34–0.38 m/s at RPE 8.",
    evidence: ["CV-SQ", "T-SQ1", "T-SQ2", "M1"],
    confidence: "medium",
  },
  {
    type: "attempt",
    lift: "deadlift",
    attempt: 3,
    kg: dl.pathways.conservative[2],
    text: "Plan the third deadlift for the podium, not the PR",
    reason:
      "Thirds missed at two of the last three meets were on the deadlift; podium comes down to the deadlift against Liam, and a made third beats a missed PR.",
    evidence: ["M1", "M2", "AH"],
    confidence: "high",
  },
  {
    type: "last_warmup",
    lift: "squat",
    kg: Math.floor((sq.opener * 0.87) / 2.5) * 2.5,
    text: "Last squat warm-up at his own 87%, a step under the ramp",
    reason: "Across eight logged sessions his last squat warm-up sits at a median 87% of the first working set.",
    evidence: ["W-SQ"],
    confidence: "high",
  },
  {
    type: "competitor",
    competitor: "Sam Okafor",
    kg: (sam.read.projection?.expected ?? 740) + 7.5,
    text: "Sam is squatting above his meet level",
    reason: "Three competition squats on video over five weeks, each heavier than the last, at RPE 9.",
    evidence: ["C1", "C1-O1", "C1-O2", "C1-O3"],
    confidence: "medium",
  },
  {
    type: "risk",
    severity: "concern",
    text: "Bodyweight is 0.6 kg over with two weeks to go",
    reason: "Losing 0.35 kg a week, so the class is made at the current rate; any faster costs the bench first.",
    evidence: ["BW"],
    confidence: "high",
  },
]);
const { checks, adjusted } = strategyOf(brief, evidence, proposals);

const narrative = readNarrative(
  JSON.stringify({
    coach_summary:
      "Alex is on track for the podium. Training supports the engine's squat and bench, and his squat runs above training on the platform, so I'd raise the squat a step. Sam is the favourite: his recent squats on video sit above his last meet. The podium is decided on the deadlift against Liam, and Alex's misses have been thirds on the deadlift, so the third deadlift is planned to make the total, with the PR attempt only if the second moves fast.",
    key_finding: "Podium is decided on the deadlift: plan the third to make it, not to set a PR",
    engine_review: [
      { area: "forecast", verdict: "challenge", note: "Squat runs above training on the platform at both meets on record (CV-SQ), so the engine's expected is a step light." },
      { area: "attempts", verdict: "challenge", note: "His third-deadlift misses (M1, M2) argue for the conservative third; openers hold." },
      { area: "warmups", verdict: "challenge", note: "His own last squat warm-up runs lighter than the standard ramp (W-SQ)." },
      { area: "field", verdict: "challenge", note: "Sam's three recent competition squats move his expected up (C1-O1 to C1-O3)." },
      { area: "bodyweight", verdict: "agree", note: "0.6 kg over, losing at a pace that makes the class without a cut." },
      { area: "taper", verdict: "agree", note: "The peak block covers the final three weeks (PRG)." },
    ],
    proposals: [],
    concerns: ["Bodyweight 0.6 kg over the limit two weeks out"],
    challenges: ["A 730 total needs every third: the podium needs fewer risks"],
    recommendations: [
      { text: "Keep the last heavy squat single 10 days out, then openers only", area: "taper", needs_approval: true },
      { text: "Decide the third deadlift live from the standings", area: "attempts", needs_approval: true },
    ],
    sections: {},
    call_note: "Worth a 15-minute call to walk through the deadlift decision before the meet.",
    athlete: {
      title: "Your game plan for Nationals",
      summary: "We're ready. Openers are weights you own on your worst day, and the plan below has every attempt and warm-up. The podium is decided on the deadlift, so we'll make smart calls there together.",
      focus: ["Sleep and food the same as training weeks", "Hit every opener the way you hit them in training"],
      expectations: ["Tap Got it once you've read the plan", "Send me how the last heavy single feels"],
      message: "Your game plan for Nationals is ready. Have a read and tap Got it.",
    },
    coach_notification: "Game plan ready for Alex: the third deadlift decides the podium",
  }),
)!;

const now = "2027-01-25T15:05:00Z";
const assessment = {
  id: "a2222222-2222-4333-8444-555555555555",
  competition_id: COMP_ID,
  client_id: CLIENT_ID,
  kind: "game_plan",
  version: 1,
  status: "ready",
  urgency: "attention",
  needs_approval: true,
  headline: narrative.key_finding,
  internal: {
    engine: brief,
    narrative,
    strategy: { checks, adjusted, evidence, declined: [] },
    debrief: null,
    instructions: null,
  },
  athlete: athleteVersion(brief, narrative, "game_plan", adjusted),
  coach_message: narrative.coach_notification,
  call: brief.call,
  model: "openai:gpt-6.2-astra",
  created_at: now,
  coach_opened_at: now,
  reviewed_at: null,
  approved_at: null,
  released_at: null,
  release_kind: null,
  athlete_opened_at: null,
  athlete_acknowledged_at: null,
  athlete_delivered_at: null,
  superseded_at: null,
  changes_note: null,
};

const competitors = FIELD.map((f, i) => ({
  id: f.id,
  name: f.name,
  sex: "M",
  weight_class: "74",
  federation: "CANPL",
  country: "Canada",
  opl_slug: f.name.toLowerCase().replace(/[^a-z]/g, ""),
  instagram: null,
  identity: "matched",
  contenders: [],
  meets: meetsFromOplCsv(f.csv),
  meets_fetched_at: now,
  fetch_error: null,
  observations: ctx.competitors[i].observations,
  notes: null,
  bodyweight_kg: 73.8,
  source: i === 2 ? "opl" : "roster",
  field_status: i === 2 ? "suggested" : "registered",
}));

const milestones = [
  ["foundation", "2026-11-16", "ready"],
  ["intel", "2026-12-14", "ready"],
  ["forecast", "2027-01-11", "ready"],
  ["game_plan", "2027-01-25", "ready"],
  ["confirm", "2027-02-01", "scheduled"],
  ["debrief", "2027-02-10", "scheduled"],
].map(([kind, due, status], i) => ({
  id: `b${i}111111-2222-4333-8444-555555555555`,
  kind,
  seq: 0,
  due_on: due,
  status,
  attempts: status === "ready" ? 1 : 0,
  last_error: null,
  why: null,
  assessment_id: kind === "game_plan" ? assessment.id : null,
  done_at: status === "ready" ? `${due}T13:00:00Z` : null,
}));

const competition = {
  id: COMP_ID,
  client_id: CLIENT_ID,
  name: ctx.competition.name,
  meet_date: MEET,
  meet_end_date: null,
  federation: "CanPL",
  division: "Open",
  weight_class: "74",
  location: "Calgary",
  level: "national",
  objective: "podium",
  objective_note: null,
  target_total_kg: 725,
  target_place: 2,
  qualification_total_kg: null,
  records_note: null,
  athlete_goal_total_kg: 730,
  registration: "registered",
  lifting_start: "09:00",
  weigh_in_at: "07:00",
  flight: "B",
  weigh_in_kg: null,
  is_primary: true,
  status: "upcoming",
  rules: { ...IPF_RULES, confirmed: true },
  defaultRules: IPF_RULES,
  release_policy: "approve_all",
  results: null,
  watch: brief.watch,
  live: null,
  research: {
    field: {
      fetched_at: "2027-01-22T13:41:00Z",
      federation: "canpl",
      ipf_class: "ipf74",
      sources: [
        "https://www.openpowerlifting.org/rankings/raw/ipf74/men/canpl/2027",
        "https://www.openpowerlifting.org/rankings/raw/ipf74/men/canpl/2026",
      ],
      considered: 64,
      added: 1,
    },
  },
  internal_test: false,
  prep_id: null,
};

const workspace = {
  today: TODAY,
  competitions: [
    { id: COMP_ID, name: competition.name, meet_date: MEET, meet_end_date: null, status: "upcoming", is_primary: true, level: "national", federation: "CanPL", weight_class: "74", live: null, prep_id: null },
  ],
  suggestions: [],
  selected: {
    competition,
    brief,
    briefError: null,
    milestones,
    assessments: [
      {
        ...assessment,
        internal: undefined,
        athlete: undefined,
      },
      { id: "a3333333-2222-4333-8444-555555555555", kind: "forecast", version: 1, status: "released", urgency: "routine", needs_approval: false, headline: "Projected total up to the low 720s; squat and bench on track", coach_message: null, call: null, created_at: "2027-01-11T14:00:00Z", coach_opened_at: "2027-01-11T15:00:00Z", reviewed_at: "2027-01-11T15:10:00Z", approved_at: "2027-01-11T15:10:00Z", released_at: "2027-01-11T15:11:00Z", release_kind: "approved", athlete_opened_at: "2027-01-11T18:00:00Z", athlete_acknowledged_at: null, athlete_delivered_at: "2027-01-11T15:11:00Z", superseded_at: null, changes_note: null, model: "openai:gpt-6.2-astra" },
    ],
    competitors,
    resources: [],
    events: [],
    meetLog: [],
    debrief: null,
  },
};

writeFileSync(
  out,
  JSON.stringify({ workspace, assessment, checks: checks.map((c) => ({ ok: c.ok, text: c.proposal.text, reasons: c.reasons })) }, null, 0),
);
console.log(
  `wrote ${out}: total ${brief.forecast.total?.expected} → ${adjusted.total?.expected}, place ${brief.landscape.place?.expected}, calls ${checks.filter((c) => c.ok).length}/${checks.length} stood`,
);
for (const c of checks) if (!c.ok) console.log("  set aside:", c.proposal.text, c.reasons.join("; "));
