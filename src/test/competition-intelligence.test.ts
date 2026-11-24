import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrief, headline, urgency, type BriefContext } from "@/lib/competition/brief";
import type { LiftEvidence } from "@/lib/competition/forecast";
import { IPF_RULES } from "@/lib/competition/rules";
import { meetsFromOplCsv } from "@/lib/competition/opl";
import { competitionOverview } from "@/lib/competition/overview";
import {
  athleteState,
  autoReleases,
  coachActions,
  coachState,
  currentPlanId,
  needsAcknowledgment,
  type AssessmentRow,
} from "@/lib/competition/lifecycle";
import { cleanRoster, cleanTraining } from "@/lib/competition/extract";
import { readDebrief, resultsFromLog } from "@/lib/competition/debrief";
import { readNarrative, narrativeProblems, briefForModel } from "@/lib/competition/write.server";
import { numbersIn } from "@/lib/competition/grounding";
import { nextFromPlan } from "@/components/competition/meet-day";
import { DEFAULT_ROUTES, resolveRoute } from "@/lib/ai/routing";
import { APP_EVENTS } from "@/lib/push/app-events.server";
import { CLIENT_WORKSPACE_PRIMARY_TABS } from "@/components/clients/client-workspace-tab-model";
import { TAB_VALUES } from "@/components/clients/client-tab-values";

const read = (p: string) => readFileSync(p, "utf8");

const ev = (
  lift: "squat" | "bench" | "deadlift",
  nowKg: number | null,
  extra: Partial<LiftEvidence> = {},
): LiftEvidence => ({
  lift,
  nowKg,
  state: nowKg ? "measured" : null,
  basis: nowKg ? "test set" : null,
  basisDay: nowKg ? "2026-11-20" : null,
  hardSessions6w: nowKg ? 4 : 0,
  trendPerWeek: 0.002,
  direction: "flat",
  ...extra,
});

function ctx(
  over: Partial<BriefContext> = {},
  comp: Partial<BriefContext["competition"]> = {},
): BriefContext {
  return {
    today: "2026-11-24",
    milestone: "game_plan",
    competition: {
      id: "c1",
      name: "Westerns",
      meetDate: "2026-12-08",
      meetEndDate: null,
      federation: "CPU",
      division: "Open",
      weightClass: "83",
      level: "regional",
      objective: "podium",
      targetTotal: 700,
      targetPlace: 2,
      qualificationTotal: null,
      recordsNote: null,
      registration: "registered",
      liftingStart: "09:00",
      weighInAt: null,
      flight: "A",
      location: "Winnipeg",
      rules: { ...IPF_RULES, confirmed: true },
      athleteGoalTotal: null,
      ...comp,
    },
    athlete: {
      name: "Test Athlete",
      firstName: "Test",
      sex: "M",
      bodyweightAvg: 82.4,
      bodyweightTrendPerWeek: -0.2,
      classLimit: 83,
    },
    lifts: { squat: ev("squat", 250), bench: ev("bench", 165), deadlift: ev("deadlift", 290) },
    meets: [],
    conversion: [],
    warmups: {},
    topSingles: { squat: 235, bench: 155, deadlift: 270 },
    competitors: [],
    watch: {
      programEndsOn: "2026-12-08",
      peakCovered: true,
      pain: [],
      recoveryFlags: 0,
      adherence: 0.92,
      cardioMinutesPerWeek: 60,
    },
    call: {
      lastCallDaysAgo: null,
      upcomingCallOn: null,
      includedCallsLeft: null,
      packageName: "Complete Online Coaching",
    },
    previous: null,
    checks: [],
    cues: {},
    ...over,
  };
}

const ELITE_CSV = [
  "Name,Sex,Event,Equipment,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Best3DeadliftKg,TotalKg,Place,Federation,Date,MeetName",
  "Rival Lifter,M,SBD,Raw,Open,82.7,83,240,250,257.5,257.5,160,167.5,-172.5,167.5,280,295,-305,295,720,1,CPU,2026-06-01,Nationals",
  "Rival Lifter,M,SBD,Raw,Open,82.5,83,235,245,-252.5,245,157.5,165,167.5,167.5,275,290,300,300,712.5,2,CPU,2025-11-10,Westerns",
  "Rival Lifter,M,SBD,Raw,Open,82.9,83,230,240,247.5,247.5,155,162.5,-167.5,162.5,270,285,295,295,705,1,CPU,2025-06-01,Provincials",
].join("\n");

describe("whole briefs for the athletes the system has to handle", () => {
  it("a first-time competitor: no meets, a conservative read, a call worth it at the game plan", () => {
    const b = buildBrief(ctx({}, { level: "local", objective: "first_meet" }));
    expect(b.forecast.limitations.join(" ")).toMatch(/conversion assumed/);
    expect(b.attempts.lifts.squat!.why.join(" ")).toMatch(/clean meet|Opener at/);
    expect(b.call.reasons.join(" ")).toMatch(/First meet/);
    expect(b.profile.patterns).toHaveLength(0);
    expect(b.gameDay[0].title).toMatch(/Wake up/);
  });

  it("an elite national-level athlete against a close rival: threat named, overlap, a call recommended", () => {
    const rival = {
      id: "r1",
      name: "Rival Lifter",
      meets: meetsFromOplCsv(ELITE_CSV),
      observations: [],
      identity: "matched",
    };
    const b = buildBrief(
      ctx(
        {
          competitors: [rival],
          lifts: {
            squat: ev("squat", 262.5),
            bench: ev("bench", 172.5),
            deadlift: ev("deadlift", 305),
          },
        },
        { level: "national", objective: "win" },
      ),
    );
    expect(b.landscape.biggest?.name).toBe("Rival Lifter");
    expect(b.landscape.biggest?.overlaps).toBe(true);
    expect(b.landscape.toWin).toBeGreaterThan(700);
    expect(b.call.recommend).toBe(true);
    expect(b.landscape.subtotal?.theirs).not.toBeNull();
  });

  it("an international meet with no competitors on file says placing can't be read and asks for the field", () => {
    const b = buildBrief(ctx({}, { level: "international", objective: "win" }));
    expect(b.landscape.place).toBeNull();
    expect(b.missing.essential.join(" ")).toMatch(/Competitors/);
    expect(b.landscape.answers.map((a) => a.a).join(" ")).toMatch(/No competitors on file/);
  });

  it("limited training history: a lift read from an old meet, low confidence, said plainly", () => {
    const meets = [
      {
        date: "2026-05-01",
        name: "Spring Open",
        federation: "CPU",
        equipment: "Raw",
        event: "SBD",
        division: "Open",
        weightClass: "83",
        bodyweight: 82,
        squat: 230,
        bench: 150,
        deadlift: 270,
        total: 650,
        place: "2",
        attempts: null,
      },
    ];
    const b = buildBrief(
      ctx({
        meets,
        lifts: {
          squat: ev("squat", null),
          bench: ev("bench", 160, { hardSessions6w: 1, basisDay: "2026-10-20" }),
          deadlift: ev("deadlift", null),
        },
      }),
    );
    expect(b.forecast.lifts.squat?.source).toBe("meet");
    expect(b.forecast.confidence).toBe("low");
    expect(b.forecast.limitations.join(" ")).toMatch(/old meet/);
  });

  it("concerns make it urgent: pain getting worse on a lift the meet loads and a class not being made", () => {
    const b = buildBrief(
      ctx({
        athlete: {
          name: "A",
          firstName: "A",
          sex: "M",
          bodyweightAvg: 86,
          bodyweightTrendPerWeek: 0.1,
          classLimit: 83,
        },
        watch: {
          programEndsOn: "2026-12-08",
          peakCovered: true,
          pain: [{ place: "Left shoulder", lift: "bench", worse: true, score: 7 }],
          recoveryFlags: 0,
          adherence: 0.9,
          cardioMinutesPerWeek: 60,
        },
      }),
    );
    expect(urgency(b)).toBe("urgent");
    expect(headline(b)).toMatch(/kg over|shoulder/);
    expect(b.forecast.lifts.bench!.basis.join(" ")).toMatch(/Conservative lowered/);
    expect(JSON.stringify(b)).not.toMatch(/dehydrat|water load|sauna/i);
  });

  it("an athlete with no included calls: the call is a General Call, never promised free", () => {
    const b = buildBrief(ctx({}, { level: "national", objective: "win" }));
    expect(b.call.coverage.kind).toBe("not_included");
    expect(b.call.coverage.text).toMatch(/General Call/);
  });

  it("a call already discussed or booked is never recommended again", () => {
    const b = buildBrief(
      ctx(
        {
          call: {
            lastCallDaysAgo: null,
            upcomingCallOn: "2026-11-30",
            includedCallsLeft: 1,
            packageName: "Coaching Plus",
          },
        },
        { level: "international", objective: "win" },
      ),
    );
    expect(b.call.recommend).toBe(false);
    expect(b.call.skipReason).toMatch(/already booked/);
  });
});

describe("several athletes competing on the same day, the coach's overview", () => {
  const today = "2026-11-24";
  const comps = [
    {
      id: "a",
      client_id: "ca",
      athlete: "Ana",
      name: "Provincials",
      meet_date: "2026-11-25",
      status: "upcoming",
      live: null,
      watch: [],
    },
    {
      id: "b",
      client_id: "cb",
      athlete: "Ben",
      name: "Provincials",
      meet_date: "2026-11-25",
      status: "upcoming",
      live: { call: { minutes: 30, reasons: ["National meet"] } },
      watch: [{ severity: "serious", text: "Programming ends 20 days before the meet" }],
    },
    {
      id: "c",
      client_id: "cc",
      athlete: "Cal",
      name: "Nationals",
      meet_date: "2027-02-08",
      status: "upcoming",
      live: null,
      watch: [],
    },
  ];
  const base = {
    version: 1,
    coach_message: null,
    released_at: null,
    athlete_acknowledged_at: null,
    superseded_at: null,
    coach_opened_at: null,
  };
  const assessments = [
    {
      ...base,
      id: "x1",
      competition_id: "a",
      client_id: "ca",
      kind: "confirm",
      status: "released",
      urgency: "routine" as const,
      needs_approval: true,
      headline: "Plan",
      created_at: "2026-11-18",
      released_at: "2026-11-18",
    },
    {
      ...base,
      id: "x2",
      competition_id: "c",
      client_id: "cc",
      kind: "recon",
      status: "ready",
      urgency: "routine" as const,
      needs_approval: false,
      headline: "Recon",
      created_at: "2026-11-23",
    },
    {
      ...base,
      id: "x3",
      competition_id: "b",
      client_id: "cb",
      kind: "confirm",
      status: "ready",
      urgency: "attention" as const,
      needs_approval: true,
      headline: "Confirm",
      created_at: "2026-11-23",
    },
  ];
  it("puts interventions and approvals first, lists both meets for tomorrow, and the unacknowledged plan", () => {
    const o = competitionOverview({ today, competitions: comps, assessments });
    expect(o.items[0].kind).toBe("intervene");
    expect(o.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["approve", "review", "unacknowledged", "call", "meet_day"]),
    );
    expect(o.items.filter((i) => i.kind === "meet_day")).toHaveLength(2);
    expect(o.byPhase.map((c) => c.athlete)).toEqual(["Ana", "Ben", "Cal"]);
    expect(o.unread).toBeGreaterThanOrEqual(2);
  });
});

describe("assessment lifecycle", () => {
  const row = (x: Partial<AssessmentRow> = {}): AssessmentRow => ({
    id: "a1",
    kind: "game_plan",
    version: 1,
    status: "ready",
    urgency: "routine",
    needs_approval: true,
    created_at: "2026-11-24",
    coach_opened_at: null,
    reviewed_at: null,
    approved_at: null,
    released_at: null,
    release_kind: null,
    athlete_opened_at: null,
    athlete_acknowledged_at: null,
    superseded_at: null,
    ...x,
  });
  it("opening is never approving, and an approval-gated plan can't be released without approval", () => {
    expect(coachState(row())).toBe("unread");
    expect(coachState(row({ coach_opened_at: "2026-11-24T10:00Z" }))).toBe("opened");
    expect(coachActions(row())).toContain("approve");
    expect(coachActions(row())).not.toContain("release");
    expect(coachActions(row({ status: "approved", approved_at: "x" }))).toContain("release");
  });
  it("acknowledgment belongs to a version: a newer released one asks again", () => {
    expect(athleteState(row({ released_at: "x" }), false)).toBe("unread");
    expect(athleteState(row({ released_at: "x", athlete_acknowledged_at: "y" }), false)).toBe(
      "acknowledged",
    );
    expect(athleteState(row({ released_at: "x", athlete_acknowledged_at: "y" }), true)).toBe(
      "updated",
    );
    expect(needsAcknowledgment("confirm")).toBe(true);
    expect(needsAcknowledgment("intel")).toBe(false);
    expect(
      currentPlanId([
        { id: "g", kind: "game_plan", released_at: "a", version: 2 },
        { id: "c", kind: "confirm", released_at: "b", version: 1 },
      ]),
    ).toBe("c");
  });
  it("only routine, non-plan updates release by themselves, and only when the coach turned it on", () => {
    expect(
      autoReleases({
        kind: "intel",
        urgency: "routine",
        needsApproval: false,
        policy: "auto_routine",
      }),
    ).toBe(true);
    expect(
      autoReleases({
        kind: "intel",
        urgency: "routine",
        needsApproval: false,
        policy: "approve_all",
      }),
    ).toBe(false);
    expect(
      autoReleases({
        kind: "intel",
        urgency: "attention",
        needsApproval: false,
        policy: "auto_routine",
      }),
    ).toBe(false);
    expect(
      autoReleases({
        kind: "game_plan",
        urgency: "routine",
        needsApproval: false,
        policy: "auto_routine",
      }),
    ).toBe(false);
  });
});

describe("rosters and posts: copied, never invented (and no Instagram access assumed)", () => {
  it("drops a name that isn't in the roster", () => {
    const rows = cleanRoster(
      { lifters: [{ name: "Jane Doe", weight_class: "63" }, { name: "Made Up Person" }] },
      "Women 63 kg: Jane Doe (CPU), Amy Lee",
    );
    expect(rows.map((r) => r.name)).toEqual(["Jane Doe"]);
  });
  it("drops a lift whose load or reps aren't written, converts lb, keeps a variation marked", () => {
    const lifts = cleanTraining(
      {
        lifts: [
          {
            lift: "deadlift",
            exercise: "Deadlift",
            load: 500,
            unit: "lb",
            reps: 1,
            standard: "competition",
          },
          {
            lift: "bench",
            exercise: "Bench",
            load: 200,
            unit: "kg",
            reps: 1,
            standard: "competition",
          },
          {
            lift: "deadlift",
            exercise: "Block pull",
            load: 520,
            unit: "lb",
            reps: 2,
            standard: "variation",
          },
        ],
      },
      "500lb pull for a single, then 520 x2 off blocks",
      "2026-11-24",
    );
    expect(lifts.map((l) => l.exercise)).toEqual(["Deadlift", "Block pull"]);
    expect(lifts[0].loadKg).toBeCloseTo(226.8, 1);
    expect(lifts[1].standard).toBe("variation");
    expect(lifts[0].source).toBe("caption");
  });
  it("a screenshot (no text to check) comes back low confidence for the coach to read", () => {
    const lifts = cleanTraining(
      {
        lifts: [{ lift: "squat", exercise: "Squat", load: 250, reps: 1, standard: "competition" }],
      },
      null,
      "2026-11-24",
    );
    expect(lifts[0].confidence).toBe("low");
    expect(lifts[0].source).toBe("screenshot");
  });
  it("the app never claims to read Instagram itself", () => {
    const field = read("src/components/competition/competition-field.tsx");
    expect(field.replace(/\s+/g, " ")).toMatch(/Instagram isn't read by the app itself/);
    expect(read("src/lib/competition/opl.server.ts")).not.toMatch(/instagram\.com/);
  });
});

describe("meet day", () => {
  const plan = {
    attempts: {
      lifts: {
        deadlift: {
          opener: 270,
          pathways: {
            conservative: [270, 282.5, 290],
            balanced: [270, 285, 295],
            aggressive: [270, 287.5, 302.5],
          },
        },
      },
    },
  };
  it("the next attempt follows how the last one went; a miss repeats the weight", () => {
    expect(nextFromPlan(plan, "deadlift", [{ kg: null, result: null }], [null], 2.5).kg).toBe(270);
    expect(nextFromPlan(plan, "deadlift", [{ kg: 270, result: "good" }], [7], 2.5).kg).toBe(287.5);
    expect(nextFromPlan(plan, "deadlift", [{ kg: 270, result: "good" }], [9.5], 2.5).kg).toBe(
      282.5,
    );
    const miss = nextFromPlan(plan, "deadlift", [{ kg: 270, result: "no_lift" }], [null], 2.5);
    expect(miss.kg).toBe(270);
    expect(miss.why).toMatch(/can't go lower/);
  });
  it("results come from the log; the debrief compares the confirmed plan, not a rewritten one", () => {
    const res = resultsFromLog(
      [
        { entrant: "us", lift: "squat", attempt: 1, kg: 240, result: "good" },
        { entrant: "us", lift: "squat", attempt: 2, kg: 250, result: "no_lift" },
        { entrant: "us", lift: "bench", attempt: 1, kg: 160, result: "good" },
        { entrant: "us", lift: "deadlift", attempt: 1, kg: 285, result: "good" },
        { entrant: "r1", lift: "deadlift", attempt: 1, kg: 300, result: "good" },
      ],
      82.6,
    )!;
    expect(res.total).toBe(685);
    const d = readDebrief(
      {
        forecast: {
          lifts: {
            squat: { range: { conservative: 235, expected: 247.5, high: 255 } },
            bench: null,
            deadlift: null,
          },
          total: { conservative: 680, expected: 700, high: 715 },
        } as any,
        attempts: { lifts: { squat: { opener: 230 }, bench: null, deadlift: null } } as any,
      },
      res,
    );
    expect(d.total.withinRange).toBe(true);
    expect(d.findings.join(" ")).toMatch(/opened at 240 kg against the planned 230 kg/);
  });
});

describe("Cleo's write-up holds to the engines' numbers", () => {
  const b = buildBrief(ctx());
  const forModel = briefForModel(b, {
    athleteName: "Test Athlete",
    instructions: null,
    previousHeadline: null,
  });
  const allowed = numbersIn(forModel);
  const answer = (x: object) =>
    JSON.stringify({
      coach_summary: "Solid read.",
      key_finding: "On track.",
      athlete: {
        title: "Plan",
        summary: "Ready.",
        focus: [],
        expectations: [],
        message: "Here's your plan.",
      },
      coach_notification: "Plan ready",
      ...x,
    });
  it("accepts an answer that uses only the brief's numbers", () => {
    const n = readNarrative(
      answer({ coach_summary: `Expected total ${b.forecast.total!.expected} kg.` }),
    )!;
    expect(narrativeProblems(n, allowed)).toEqual([]);
  });
  it("rejects an invented number, a probability or a water cut", () => {
    const n = readNarrative(
      answer({
        coach_summary:
          "They'll total 812.5 kg with a 70% chance to win; a water cut fixes the class.",
      }),
    )!;
    const p = narrativeProblems(n, allowed);
    expect(p.join(" ")).toMatch(/812.5/);
    expect(p.join(" ")).toMatch(/probabilities/);
  });
  it("reads a non-JSON answer as nothing", () => {
    expect(readNarrative("I can't help with that")).toBeNull();
  });
});

describe("wiring", () => {
  it("the assessments run on the OpenAI key's strong tier only, whatever an override names", () => {
    expect(DEFAULT_ROUTES.competition.strongOnly).toBe(true);
    expect(
      [...DEFAULT_ROUTES.competition.models, ...DEFAULT_ROUTES.competition_extract.models].every(
        (m) => m.startsWith("openai:"),
      ),
    ).toBe(true);
    expect(
      resolveRoute(
        "competition",
        { competition: ["gateway:google/gemini-2.5-flash"] },
        { openaiOnly: true },
      ).models.every((m) => m.startsWith("openai:")),
    ).toBe(true);
    expect(read("src/lib/competition/write.server.ts")).toMatch(/openaiOnly: true/);
    expect(read("src/lib/competition/extract.server.ts")).toMatch(/openaiOnly: true/);
  });
  it("the Competition tab sits after Cardio and its pushes are content-free and open the exact assessment", () => {
    const order = CLIENT_WORKSPACE_PRIMARY_TABS.map((t) => t.value);
    expect(order.indexOf("competition")).toBe(order.indexOf("cardio") + 1);
    expect((TAB_VALUES as readonly string[]).includes("competition")).toBe(true);
    expect(APP_EVENTS.competition_assessment_ready.url("c1", "a1")).toBe(
      "/admin/clients/c1?tab=competition&assessment=a1",
    );
    expect(APP_EVENTS.competition_assessment_ready.body("X")).not.toMatch(/\d/);
    expect(APP_EVENTS.competition_plan_released.url("c1", "a1")).toBe(
      "/portal/competition?update=a1",
    );
  });
  it("the worker is scheduled with a timeout and the tables are staff-read, server-written", () => {
    const sql = read("supabase/migrations/20270525090000_competition_intelligence.sql");
    expect(sql).toMatch(/competition-intel-tick[\s\S]*timeout_milliseconds := 120000/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.%I FROM anon, authenticated/);
    expect(sql).toMatch(/coached_client_ids\(\)/);
    expect(sql).toMatch(/append-only/);
  });
  it("athletes read only released athlete versions; a preview never acknowledges", () => {
    const fns = read("src/lib/competition/competition.functions.ts");
    expect(fns).toMatch(/not\("released_at", "is", null\)/);
    expect(fns.slice(fns.indexOf("export const getMyCompetitionsFn"))).not.toMatch(/internal/);
    expect(read("src/components/competition/athlete-competition.tsx")).toMatch(
      /if \(previewing \|\| !toOpen\.length\) return/,
    );
  });
  it("the release message says 'automated' unless the coach approved it", () => {
    const rel = read("src/lib/competition/release.server.ts");
    expect(rel).toMatch(/Automated preparation update/);
    expect(rel).toMatch(/kind: "approved" \| "automated"/);
  });
});
