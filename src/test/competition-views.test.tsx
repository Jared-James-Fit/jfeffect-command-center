import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBrief, type BriefContext } from "@/lib/competition/brief";
import { IPF_RULES } from "@/lib/competition/rules";
import {
  AttemptsView,
  ForecastTable,
  GameDayView,
  WarmupsView,
} from "@/components/competition/plan-views";

const ev = (lift: "squat" | "bench" | "deadlift", nowKg: number) => ({
  lift,
  nowKg,
  state: "measured" as const,
  basis: "200 kg × 3 @ 8 on Nov 18 → 220 kg estimate",
  basisDay: "2026-11-18",
  hardSessions6w: 4,
  trendPerWeek: 0.003,
  direction: "up" as const,
});
const ctx: BriefContext = {
  today: "2026-11-24",
  milestone: "game_plan",
  competition: {
    id: "c",
    name: "Westerns",
    meetDate: "2026-12-08",
    meetEndDate: null,
    federation: "CPU",
    division: null,
    weightClass: "83",
    level: "regional",
    objective: "pb_total",
    targetTotal: null,
    targetPlace: null,
    qualificationTotal: null,
    recordsNote: null,
    registration: "registered",
    liftingStart: "09:00",
    weighInAt: null,
    flight: null,
    location: null,
    rules: IPF_RULES,
    athleteGoalTotal: null,
  },
  athlete: {
    name: "A",
    firstName: "A",
    sex: "F",
    bodyweightAvg: null,
    bodyweightTrendPerWeek: null,
    classLimit: null,
  },
  lifts: { squat: ev("squat", 160), bench: ev("bench", 90), deadlift: ev("deadlift", 190) },
  meets: [],
  conversion: [],
  warmups: {},
  topSingles: {},
  competitors: [],
  watch: {
    programEndsOn: "2026-12-08",
    peakCovered: true,
    pain: [],
    recoveryFlags: 0,
    adherence: null,
    cardioMinutesPerWeek: null,
  },
  call: { lastCallDaysAgo: null, upcomingCallOn: null, includedCallsLeft: null, packageName: null },
  previous: null,
  checks: [],
  cues: {},
};

describe("the plan renders the engines' numbers for coach, athlete and meet day", () => {
  const b = buildBrief(ctx);
  it("forecast, attempts, warm-ups and the day render with kg and lb, no crash on a full brief", () => {
    const html = renderToStaticMarkup(
      <div>
        <ForecastTable forecast={b.forecast} showBasis />
        <AttemptsView attempts={b.attempts.lifts} />
        <WarmupsView warmups={b.warmups} />
        <GameDayView steps={b.gameDay} />
      </div>,
    );
    expect(html).toContain(String(b.forecast.total!.expected));
    expect(html).toContain(String(b.attempts.lifts.squat!.opener));
    expect(html).toMatch(/lb/);
    expect(html).toContain("Weigh in and hand in openers");
    expect(html).toContain("never a probability");
  });
  it("says so when there's nothing yet instead of rendering an empty table", () => {
    const html = renderToStaticMarkup(
      <div>
        <ForecastTable forecast={null} />
        <AttemptsView attempts={null} />
        <GameDayView steps={[]} />
      </div>,
    );
    expect(html).toMatch(/No forecast yet/);
    expect(html).toMatch(/No attempts yet/);
    expect(html).toMatch(/No day plan yet/);
  });
});
