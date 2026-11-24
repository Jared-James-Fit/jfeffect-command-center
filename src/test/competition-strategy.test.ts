import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrief, type BriefContext } from "@/lib/competition/brief";
import type { LiftEvidence } from "@/lib/competition/forecast";
import { IPF_RULES } from "@/lib/competition/rules";
import { meetsFromOplCsv } from "@/lib/competition/opl";
import { readCompetitor } from "@/lib/competition/competitor";
import { observationWeight, trainingSignal } from "@/lib/competition/competitor-training";
import { buildEvidence } from "@/lib/competition/evidence";
import {
  applyProposals,
  checkProposals,
  confirmedPlan,
  readProposals,
  strategyOf,
} from "@/lib/competition/proposals";
import {
  adjacentIpfClasses,
  cleanMeetInfo,
  fetchableUrl,
  htmlToText,
  likelyField,
  oplFederation,
  oplIpfClass,
  parseRankings,
  rankingsPath,
} from "@/lib/competition/research";
import {
  allowedNumbers,
  athleteNumbers,
  athleteVersion,
  briefForModel,
  narrativeProblems,
  readNarrative,
} from "@/lib/competition/write.server";
import { DEFAULT_ROUTES, STRONG_MODELS, resolveRoute } from "@/lib/ai/routing";
import type { Observation } from "@/lib/competition/types";

const read = (p: string) => readFileSync(p, "utf8");

const ev = (
  lift: "squat" | "bench" | "deadlift",
  nowKg: number,
  extra: Partial<LiftEvidence> = {},
): LiftEvidence => ({
  lift,
  nowKg,
  state: "measured",
  basis: "test set",
  basisDay: "2026-11-20",
  hardSessions6w: 4,
  trendPerWeek: 0.002,
  direction: "flat",
  ...extra,
});

/** A competitor with a 650 kg total six months ago. */
const RIVAL_CSV = [
  "Name,Sex,Event,Equipment,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Best3DeadliftKg,TotalKg,Place,Federation,Date,MeetName",
  "Rival Lifter,M,SBD,Raw,Open,82.6,83,225,235,240,240,145,150,-155,150,240,255,260,260,650,1,CPU,2026-05-24,Provincials",
  "Rival Lifter,M,SBD,Raw,Open,82.4,83,220,230,-237.5,230,142.5,147.5,150,150,240,250,-262.5,250,630,2,CPU,2025-11-10,Westerns",
  "Rival Lifter,M,SBD,Raw,Open,82.8,83,215,225,232.5,232.5,140,145,147.5,147.5,235,245,252.5,252.5,632.5,1,CPU,2025-06-01,Provincials",
].join("\n");

const obs = (
  date: string,
  lift: "squat" | "bench" | "deadlift",
  loadKg: number,
  reps: number,
  extra: Partial<Observation> = {},
): Observation => ({
  date,
  lift,
  exercise: lift,
  loadKg,
  reps,
  rpe: null,
  standard: "competition",
  equipment: null,
  source: "video",
  url: null,
  confidence: "high",
  note: null,
  ...extra,
});

describe("competitor training is evidence, weighed", () => {
  const meets = meetsFromOplCsv(RIVAL_CSV);
  const today = "2026-11-24";
  const meetDate = "2027-02-08";
  const base = readCompetitor({ meets, today, meetDate });

  it("an isolated social media PR barely moves the expected but widens the high end", () => {
    const one = readCompetitor({
      meets,
      today,
      meetDate,
      observations: [obs("2026-11-10", "squat", 262.5, 1, { source: "instagram", confidence: "medium" })],
    });
    const s = one.training.squat!;
    expect(s.exposures).toBe(1);
    expect(s.weight).toBeLessThanOrEqual(0.12);
    expect(one.projection!.lifts.squat!.expected - base.projection!.lifts.squat!.expected).toBeLessThanOrEqual(2.5);
    expect(one.projection!.high).toBeGreaterThan(base.projection!.high);
  });

  it("a consistent pattern of heavier competition training moves the expected materially (650 → about 690)", () => {
    const pattern = readCompetitor({
      meets,
      today,
      meetDate,
      observations: [
        obs("2026-09-28", "squat", 250, 3, { rpe: 8.5 }),
        obs("2026-10-19", "squat", 257.5, 2, { rpe: 9 }),
        obs("2026-11-09", "squat", 262.5, 1, { rpe: 9 }),
        obs("2026-09-30", "bench", 157.5, 3, { rpe: 9 }),
        obs("2026-10-21", "bench", 160, 2, { rpe: 9 }),
        obs("2026-11-11", "bench", 162.5, 1, { rpe: 9.5 }),
        obs("2026-10-02", "deadlift", 270, 2, { rpe: 9 }),
        obs("2026-10-23", "deadlift", 275, 1, { rpe: 9 }),
        obs("2026-11-13", "deadlift", 280, 1, { rpe: 9.5 }),
      ],
    });
    for (const l of ["squat", "bench", "deadlift"] as const) {
      expect(pattern.training[l]!.exposures).toBe(3);
      expect(pattern.training[l]!.weight).toBeGreaterThanOrEqual(0.4);
    }
    expect(pattern.projection!.expected - base.projection!.expected).toBeGreaterThanOrEqual(25);
    expect(pattern.projection!.expected).toBeLessThan(720);
    expect(pattern.basis.join(" ")).toMatch(/training points to/);
  });

  it("works in both directions: consistently lighter training pulls the expected down", () => {
    const down = readCompetitor({
      meets,
      today,
      meetDate,
      observations: [
        obs("2026-10-01", "squat", 215, 1, { rpe: 9.5 }),
        obs("2026-10-22", "squat", 212.5, 1, { rpe: 10 }),
        obs("2026-11-12", "squat", 217.5, 1, { rpe: 9.5 }),
      ],
    });
    expect(down.projection!.lifts.squat!.expected).toBeLessThan(base.projection!.lifts.squat!.expected);
    expect(down.projection!.lifts.squat!.conservative).toBeLessThanOrEqual(
      down.projection!.lifts.squat!.expected,
    );
  });

  it("variations, high reps and stale posts don't set a level; a questionable rep counts half", () => {
    expect(observationWeight(obs("2026-11-10", "deadlift", 300, 1, { standard: "variation" }), today)).toBeNull();
    expect(observationWeight(obs("2026-11-10", "squat", 180, 12), today)).toBeNull();
    expect(observationWeight(obs("2026-04-01", "squat", 260, 1), today)).toBeNull();
    const clean = observationWeight(obs("2026-11-10", "squat", 260, 1), today)!.w;
    const q = observationWeight(obs("2026-11-10", "squat", 260, 1, { technique: "questionable" }), today)!.w;
    expect(q).toBeCloseTo(clean / 2, 5);
  });

  it("bar speed stands in for an RPE on a heavy single", () => {
    const fast = trainingSignal({
      lift: "bench",
      observations: [obs("2026-11-18", "bench", 150, 1, { velocity: 0.45 })],
      today,
    })!;
    const slow = trainingSignal({
      lift: "bench",
      observations: [obs("2026-11-18", "bench", 150, 1, { velocity: 0.18 })],
      today,
    })!;
    expect(fast.estimateKg).toBeGreaterThan(slow.estimateKg);
  });

  it("cutting a class costs strength; wraps on record take the classic squat down", () => {
    const cut = readCompetitor({ meets, today, meetDate, meetClassLimitKg: 74 });
    expect(cut.projection!.expected).toBeLessThan(base.projection!.expected);
    expect(cut.basis.join(" ")).toMatch(/costs strength/);
    const wrapsMeets = meets.map((m) => ({ ...m, equipment: "Wraps" }));
    const wraps = readCompetitor({ meets: wrapsMeets, today, meetDate, classic: true });
    expect(wraps.projection!.lifts.squat!.expected).toBeLessThan(base.projection!.lifts.squat!.expected);
  });
});

/* ------------------------------------------------------------------ */

const JARED_CSV = [
  "Name,Sex,Event,Equipment,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Best3DeadliftKg,TotalKg,Place,Federation,Date,MeetName",
  "Our Athlete,M,SBD,Raw,Open,65.4,66,227.5,232.5,235,235,145,147.5,150,150,247.5,270,-280,270,655,1,CommonwealthPF,2026-09-18,Commonwealth Championships",
  "Our Athlete,M,SBD,Raw,Open,65.7,66,225,232.5,242.5,242.5,142.5,150,152.5,152.5,237.5,255,265,265,660,1,NAPF,2026-08-03,Regional Championships",
  "Our Athlete,M,SBD,Raw,Open,65.47,66,227.5,235,240,240,142.5,145,150,150,250,265,272.5,272.5,662.5,2,CANPL,2026-03-14,Nationals",
].join("\n");

function ctx(over: Partial<BriefContext> = {}): BriefContext {
  return {
    today: "2026-11-24",
    milestone: "game_plan",
    competition: {
      id: "c1",
      name: "Nationals",
      meetDate: "2027-02-08",
      meetEndDate: null,
      federation: "CanPL",
      division: "Open",
      weightClass: "66",
      level: "national",
      objective: "win",
      targetTotal: null,
      targetPlace: 1,
      qualificationTotal: null,
      recordsNote: null,
      registration: "registered",
      liftingStart: "09:00",
      weighInAt: null,
      flight: "A",
      location: null,
      rules: { ...IPF_RULES, confirmed: true },
      athleteGoalTotal: null,
    },
    athlete: {
      name: "Our Athlete",
      firstName: "Our",
      sex: "M",
      bodyweightAvg: 66.8,
      bodyweightTrendPerWeek: -0.2,
      classLimit: 66,
    },
    lifts: { squat: ev("squat", 240), bench: ev("bench", 152.5), deadlift: ev("deadlift", 272.5) },
    meets: meetsFromOplCsv(JARED_CSV),
    conversion: [
      { lift: "squat", meetDate: "2026-09-18", meetKg: 235, trainingKg: 229 },
      { lift: "squat", meetDate: "2026-03-14", meetKg: 240, trainingKg: 232 },
    ],
    warmups: { squat: { sessions: 6, medianSets: 5, lastPct: 0.9 } },
    topSingles: { squat: 230, bench: 145, deadlift: 260 },
    competitors: [
      { id: "r1", name: "Rival Lifter", meets: meetsFromOplCsv(RIVAL_CSV), observations: [], identity: "matched", status: "suggested" },
    ],
    watch: {
      programEndsOn: "2027-02-08",
      programRead: true,
      peakCovered: true,
      pain: [],
      recoveryFlags: 0,
      adherence: 0.92,
      cardioMinutesPerWeek: null,
    },
    call: { lastCallDaysAgo: null, upcomingCallOn: null, includedCallsLeft: null, packageName: null },
    previous: null,
    checks: [],
    cues: {},
    sessions: {
      squat: [
        { day: "2026-11-16", kg: 206.5, reps: 1, rpe: 6, e1rm: 232, confidence: "medium", heaviestKg: 206.5, velocity: 0.52 },
        { day: "2026-11-09", kg: 192.5, reps: 4, rpe: 6, e1rm: 229, confidence: "medium", heaviestKg: 192.5, velocity: null },
      ],
      deadlift: [
        { day: "2026-11-13", kg: 224.5, reps: 4, rpe: 10, e1rm: 254, confidence: "high", heaviestKg: 224.5, velocity: null },
      ],
    },
    ...over,
  } as BriefContext;
}

describe("Cleo's calls are checked by code and the plan rebuilt from them", () => {
  const b = buildBrief(ctx());
  const evidence = buildEvidence(b);
  const ids = new Set(evidence.map((e) => e.id));
  const sq = b.forecast.lifts.squat!.range;

  it("the evidence is numbered and covers training, meets, conversion, warm-ups, bodyweight and the field", () => {
    for (const id of ["T-SQ1", "T-SQ2", "T-DL1", "L-SQ", "CV-SQ", "W-SQ", "M1", "M3", "BW", "PRG", "C1", "C1-M1"])
      expect(ids.has(id)).toBe(true);
    expect(evidence.find((e) => e.id === "T-SQ1")!.text).toMatch(/0\.52 m\/s/);
    expect(evidence.find((e) => e.id === "M1")!.text).toMatch(/280x/);
    expect(b.competitors[0].status).toBe("suggested");
  });

  it("a well-evidenced forecast call stands and the attempts and warm-ups follow it", () => {
    const raw = readProposals([
      {
        type: "forecast",
        lift: "squat",
        scenario: "expected",
        kg: sq.expected + 5,
        text: "Squat expected up a step",
        reason: "Their squat converts above training at every recent meet and the RPE 6 single moved fast",
        evidence: ["CV-SQ", "T-SQ1", "M1"],
      },
    ]);
    const { checks, adjusted } = strategyOf(b, evidence, raw);
    expect(checks[0].ok).toBe(true);
    expect(adjusted.lifts.squat!.expected).toBe(sq.expected + 5);
    expect(adjusted.total!.expected).toBe(b.forecast.total!.expected + 5);
    expect(adjusted.changes.some((c) => c.area === "forecast")).toBe(true);
    // the balanced third follows the new expected
    expect(adjusted.attempts.lifts.squat!.pathways.balanced[2]).toBeGreaterThanOrEqual(
      b.attempts.lifts.squat!.pathways.balanced[2],
    );
  });

  it("a call citing nothing real, or moving too far, or a big move on one item, is set aside with why", () => {
    const raw = readProposals([
      { type: "forecast", lift: "squat", kg: sq.expected + 2.5, text: "Up", reason: "Because I feel it should be", evidence: ["T-ZZ9"] },
      { type: "forecast", lift: "bench", kg: Math.round(b.forecast.lifts.bench!.range.expected * 1.2 / 2.5) * 2.5, text: "Bench way up", reason: "A strong recent bench single", evidence: ["M1", "AH"] },
      { type: "forecast", lift: "deadlift", kg: b.forecast.lifts.deadlift!.range.expected + 12.5, text: "Deadlift up", reason: "One heavy set of four at RPE 10", evidence: ["T-DL1"] },
    ]);
    const checks = checkProposals(b, evidence, raw);
    expect(checks.every((c) => !c.ok)).toBe(true);
    expect(checks[0].reasons.join(" ")).toMatch(/isn't in the evidence/);
    expect(checks[1].reasons.join(" ")).toMatch(/most a call can move it/);
    expect(checks[2].reasons.join(" ")).toMatch(/two pieces of evidence/);
  });

  it("attempts: on the increment, rising, opener within the conservative day, jumps capped", () => {
    const a = b.attempts.lifts.squat!;
    const good = readProposals([
      { type: "attempt", lift: "squat", attempt: 1, kg: a.opener + 2.5, text: "Open a step higher", reason: "They open at 95% of what they make and made every opener", evidence: ["AH", "M1"] },
    ]);
    const c1 = checkProposals(b, evidence, good);
    expect(c1[0].ok).toBe(a.opener + 2.5 <= sq.conservative);
    const bad = readProposals([
      { type: "attempt", lift: "squat", attempt: 1, kg: sq.conservative + 5, text: "Open heavy", reason: "Confidence in the squat", evidence: ["M1"] },
      { type: "attempt", lift: "squat", attempt: 3, kg: 241.3, text: "Odd third", reason: "Odd plates", evidence: ["M1"] },
      { type: "attempt", lift: "squat", attempt: 3, kg: sq.high + 10, text: "Huge third", reason: "Going for it all", evidence: ["M1"] },
    ]);
    const c2 = checkProposals(b, evidence, bad);
    expect(c2[0].ok).toBe(false);
    expect(c2[0].reasons.join(" ")).toMatch(/conservative day/);
    expect(c2[1].reasons.join(" ")).toMatch(/multiples of 2.5/);
    expect(c2[2].ok).toBe(false);
  });

  it("an individual last warm-up stands within 82–97% of the opener and the ladder is rebuilt to it", () => {
    const opener = b.attempts.lifts.squat!.opener;
    const last = Math.floor((opener * 0.9) / 2.5) * 2.5;
    const raw = readProposals([
      { type: "last_warmup", lift: "squat", kg: last, text: "Last warm-up a little lighter", reason: "Their last warm-up in training runs about 90% of the first working set", evidence: ["W-SQ"] },
      { type: "last_warmup", lift: "bench", kg: b.attempts.lifts.bench!.opener, text: "Warm up to the opener", reason: "Wants to feel it", evidence: ["M1"] },
    ]);
    const { checks, adjusted } = strategyOf(b, evidence, raw);
    expect(checks[0].ok).toBe(true);
    expect(checks[1].ok).toBe(false);
    expect(adjusted.warmups.squat!.last.kg).toBe(last);
    expect(adjusted.warmups.squat!.sets.every((s, i, xs) => i === 0 || s.kg > xs[i - 1].kg)).toBe(true);
  });

  it("a competitor call needs their own record and moves the field", () => {
    const exp = b.competitors[0].read.projection!.expected;
    const raw = readProposals([
      { type: "competitor", competitor: "Rival Lifter", kg: exp + 15, text: "Rival is better than their last meet", reason: "Their record climbs every meet", evidence: ["C1", "C1-M1", "C1-M2"] },
      { type: "competitor", competitor: "Rival Lifter", kg: exp + 15, text: "Rival up", reason: "Our athlete trains hard", evidence: ["T-SQ1", "M1"] },
    ]);
    const checks = checkProposals(b, evidence, raw);
    expect(checks[0].ok).toBe(true);
    expect(checks[1].ok).toBe(false);
    expect(checks[1].reasons.join(" ")).toMatch(/own record/);
    const adjusted = applyProposals(b, [raw[0]]);
    expect(adjusted.landscape.ranked[0].expected).toBe(exp + 15);
  });

  it("the athlete's plan uses the adjusted attempts; the coach can put a call back; debriefs read the kept plan", () => {
    const a = b.attempts.lifts.deadlift!;
    const second = a.pathways.balanced[1] + 2.5;
    const raw = readProposals([
      { type: "attempt", lift: "deadlift", attempt: 2, kg: second, text: "A bigger second", reason: "Their deadlift seconds move fast and thirds are where they miss", evidence: ["M1", "M2"] },
    ]);
    const { checks, adjusted } = strategyOf(b, evidence, raw);
    expect(checks[0].ok).toBe(true);
    const n = readNarrative(
      JSON.stringify({
        coach_summary: "Good prep. The plan holds with one change to the deadlift second.",
        athlete: { title: "Game plan", summary: "Here's the plan.", focus: ["Sleep"], expectations: [], message: "Plan's ready." },
      }),
    )!;
    const athlete = athleteVersion(b, n, "game_plan", adjusted);
    expect((athlete.plan!.attempts as any).deadlift.second).toEqual(adjusted.attempts.lifts.deadlift!.second);
    expect(adjusted.attempts.lifts.deadlift!.pathways.balanced[1]).toBe(second);
    const back = strategyOf(b, evidence, raw, ["P1"]);
    expect(back.adjusted.attempts.lifts.deadlift!.pathways.balanced[1]).toBe(a.pathways.balanced[1]);
    const plan = confirmedPlan({ engine: b, strategy: { adjusted } });
    expect(plan!.attempts.lifts.deadlift!.pathways.balanced[1]).toBe(second);
  });

  it("grounding: the athlete's words carry no weights; numbers come from the brief, the evidence or a passing call", () => {
    expect(athleteNumbers("Open at 232.5 and go 240")).toEqual([232.5, 240]);
    expect(athleteNumbers("Eight weeks out, 3 sessions a week, in 2027")).toEqual([]);
    const forModel = briefForModel(b, { athleteName: "Our Athlete", instructions: null, previousHeadline: null });
    const adjusted = applyProposals(b, []);
    const allowed = allowedNumbers(forModel, evidence, adjusted);
    const n = readNarrative(
      JSON.stringify({
        coach_summary: `Squat expected ${sq.expected} kg; a 7.5 kg jump is fine; the invented 777 isn't.`,
        athlete: { title: "Plan", summary: "Open at 232.5.", focus: [], expectations: [], message: "Ready." },
      }),
    )!;
    const p = narrativeProblems(n, allowed).join(" ");
    expect(p).toMatch(/777/);
    expect(p).not.toMatch(/7\.5,/);
    expect(p).toMatch(/athlete's words have weights/);
  });

  it("an adjacent class's field is evidence when the athlete is over the limit", () => {
    const withAlt = buildBrief(
      ctx({
        classOptions: [
          { weightClass: "74", lifters: [{ name: "Big Lifter", total: 770, date: "2026-06-13" }], ourPlace: 2, reason: "14.7% over the 66 kg limit" },
        ],
      }),
    );
    const e = buildEvidence(withAlt);
    expect(e.find((x) => x.id === "ALT-74")!.text).toMatch(/Big Lifter 770 kg/);
  });
});

describe("the strongest model, OpenAI only", () => {
  it("competition reasoning: GPT-6.2 Astra, then GPT-6 Astra, then GPT-5.5, high effort, never a gateway model", () => {
    expect(DEFAULT_ROUTES.competition.models).toEqual([
      "openai:gpt-6.2-astra",
      "openai:gpt-6-astra",
      "openai:gpt-5.5",
    ]);
    expect(DEFAULT_ROUTES.competition.effort).toBe("high");
    for (const m of DEFAULT_ROUTES.competition.models) expect(STRONG_MODELS).toContain(m);
    const r = resolveRoute("competition", { competition: ["gateway:openai/gpt-5.5"] } as any, {
      openaiOnly: true,
    });
    expect(r.models.every((m) => m.startsWith("openai:"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("automatic research", () => {
  const rankings = {
    total_length: 3,
    rows: [
      [0, 1, "Carlos Castillo", "carloscastillo", null, null, "Canada", null, "IPF", "2026-06-13", "Lithuania", null, "ipf/2603", "M", "Raw", "25~", "Open", "65.6", "66", "227.5", "155", "290", "672.5", "529.31"],
      [1, 2, "Our Athlete", "ourathlete", null, null, "Canada", "Canada-MB", "CANPL", "2026-03-14", "Canada", "NL", "canpl/2026-03-14", "M", "Raw", "27", "Open", "65.4", "66", "240", "150", "272.5", "662.5", "522.21"],
      [2, 3, "Malhar Patil", "malharpatil", "mallyproduceslift", null, "Canada", "Canada-AB", "CANPL", "2026-03-14", "Canada", "NL", "canpl/2026-03-14", "M", "Raw", "30~", "Open", "65.7", "66", "242.5", "150", "270", "662.5", "520.37"],
      [3, 4, "Far Away", "faraway", null, null, "USA", null, "IPF", "2026-06-13", "Lithuania", null, "ipf/2603", "M", "Raw", "25", "Open", "65.9", "66", "240", "160", "280", "680", "530"],
      [4, 5, "Weak Lifter", "weaklifter", null, null, "Canada", null, "CANPL", "2026-03-14", "Canada", null, "canpl/2026-03-14", "M", "Raw", "25", "Open", "65", "66", "150", "100", "180", "430", "330"],
      ["bad row"],
    ],
  };

  it("reads OpenPowerlifting's rankings, finds the likely field and leaves the athlete out", () => {
    const rows = parseRankings(rankings);
    expect(rows).toHaveLength(5);
    expect(rows[2].instagram).toBe("mallyproduceslift");
    const field = likelyField([rows], { excludeSlugs: ["ourathlete"], country: "Canada" });
    expect(field.map((r) => r.slug)).toEqual(["carloscastillo", "malharpatil"]);
  });

  it("names the federation, class and path the way OpenPowerlifting does", () => {
    expect(oplFederation("CPU", "2027-02-08")).toBe("canpl");
    expect(oplFederation("CPU", "2024-02-08")).toBe("cpu");
    expect(oplFederation("CanPL", "2027-02-08")).toBe("canpl");
    expect(oplIpfClass("M", "66")).toBe("ipf66");
    expect(oplIpfClass("F", "84+")).toBe("ipf84+");
    expect(oplIpfClass("M", "82.5")).toBeNull();
    expect(adjacentIpfClasses("M", "66")).toEqual({ up: "74", down: "59" });
    expect(rankingsPath({ federation: "canpl", ipfClass: "ipf66", sex: "M", year: 2026 })).toBe(
      "/api/rankings/raw/ipf66/men/canpl/2026?start=0&end=39&lang=en&units=kg",
    );
  });

  it("only fetches public https links; Google Sheets and Docs come as their exports", () => {
    expect(fetchableUrl("http://example.com")).toBeNull();
    expect(fetchableUrl("https://localhost/x")).toBeNull();
    expect(fetchableUrl("https://10.0.0.1/x")).toBeNull();
    expect(
      fetchableUrl("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42")!.url,
    ).toBe("https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=42");
    expect(fetchableUrl("https://docs.google.com/document/d/xyz/edit")!.url).toBe(
      "https://docs.google.com/document/d/xyz/export?format=txt",
    );
    expect(fetchableUrl("https://powerlifting.ca/nominations")!.kind).toBe("page");
    expect(htmlToText("<table><tr><td>Jane</td><td>66</td></tr></table><script>x()</script>")).toBe(
      "Jane | 66 |",
    );
  });

  it("meet details are copied, never guessed: a total or time not in the source is dropped", () => {
    const src = "Nationals Feb 8 2027. Weigh-in 7:00, lifting 9:00. Qualifying totals: 66 kg men 600.";
    const info = cleanMeetInfo(
      {
        date: "2027-02-08",
        weigh_in: "07:00",
        lifting_start: "09:30",
        qualifying_totals: [
          { weight_class: "66", sex: "M", total_kg: 600 },
          { weight_class: "74", sex: "M", total_kg: 650 },
        ],
        notes: ["Three attempts per lift"],
      },
      src,
    );
    expect(info.weighIn).toBe("07:00");
    expect(info.liftingStart).toBeNull();
    expect(info.qualifyingTotals).toEqual([{ weightClass: "66", sex: "M", totalKg: 600 }]);
  });
});

describe("wiring", () => {
  it("the worker researches new competitions, reads the class question and stores Cleo's calls", () => {
    const w = read("src/lib/competition/worker.server.ts");
    expect(w).toMatch(/discoverField/);
    expect(w).toMatch(/classOptions/);
    expect(w).toMatch(/strategy: \{\s*checks: strategy.checks/);
    expect(w).toMatch(/athleteVersion\(brief, narrative, kind, strategy.adjusted\)/);
  });
  it("an internal test competition only releases to a staff member's own athlete account", () => {
    const r = read("src/lib/competition/release.server.ts");
    expect(r).toMatch(/internal_test/);
    expect(r).toMatch(/same_person_as/);
    const m = read("supabase/migrations/20270527090000_competition_intelligence.sql");
    expect(m).toMatch(/internal_test boolean NOT NULL DEFAULT false/);
    expect(m).toMatch(/field_status text NOT NULL DEFAULT 'confirmed'/);
    expect(m).toMatch(/research jsonb NOT NULL DEFAULT/);
  });
  it("the self-check hook needs the hook secret and an internal test competition", () => {
    const h = read("src/routes/api/public/hooks/competition-selfcheck.ts");
    expect(h).toMatch(/authorizeHookRequest/);
    expect(h).toMatch(/internal_test/);
  });
});
