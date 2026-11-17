import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cardioAdherence, heavyLowerWeekdays, lowerLiftPerformance, pastCutPhases, prepSport, treadmillHistory, waistCm, type LiftSet } from "@/lib/weight-management/records";
import { availableWeeks, changeText, pickComparison, waistAround, weightAround } from "@/lib/progress-compare";
import { addDays } from "@/lib/weight-management/units";
import { needsCoach, storedAssessment } from "@/lib/weight-management/reviews.server";
import { buildAssessment } from "@/lib/weight-management/assessment";

const TODAY = "2026-11-17";

/** A top set every 4 days: squat at RPE 8, e1RM moving by `pctPerSession` each time. */
function squats(n: number, startKg: number, pctPerSession: number, end = TODAY): LiftSet[] {
  const out: LiftSet[] = [];
  for (let i = n - 1; i >= 0; i--) out.push({ lift: "squat", date: addDays(end, -i * 4), kg: startKg * (1 + (pctPerSession / 100) * (n - 1 - i)), reps: 3, rpe: 8, rir: null });
  return out;
}

describe("records → engine inputs", () => {
  it("reads the lower lifts from comparable sets only", () => {
    expect(lowerLiftPerformance(squats(10, 180, -1), TODAY).lower).toBe("down");
    expect(lowerLiftPerformance(squats(10, 180, 0.6), TODAY).lower).toBe("up");
    // light, unrated sets never read as strength lost
    const light: LiftSet[] = squats(10, 120, -2).map((s) => ({ ...s, rpe: null }));
    expect(lowerLiftPerformance(light, TODAY)).toEqual({ lower: null, detail: null });
  });

  it("learns what strength did during earlier cuts", () => {
    const bw: Array<{ date: string; kg: number }> = [];
    // a cut from Mar to May, then flat
    for (let i = 0; i < 70; i += 2) bw.push({ date: addDays("2026-03-01", i), kg: 90 - i * 0.1 });
    for (let i = 0; i < 60; i += 2) bw.push({ date: addDays("2026-05-15", i), kg: 83 });
    const sets: LiftSet[] = [
      ...squats(6, 200, 0, "2026-03-05"),
      ...squats(6, 190, 0, "2026-05-10"),
    ];
    const phases = pastCutPhases(bw, sets, TODAY);
    const cut = phases.find((p) => p.phase === "cutting");
    expect(cut).toBeTruthy();
    expect(cut!.strengthChangePct).toBeLessThan(-3);
  });

  it("heavy squat and deadlift days are the ones with a main lift up front", () => {
    expect(
      heavyLowerWeekdays([
        { date: "2026-11-16", rows: [{ order: 0, lift: "squat" }, { order: 1, lift: null }] },
        { date: "2026-11-17", rows: [{ order: 0, lift: "bench" }, { order: 1, lift: null }, { order: 2, lift: null }, { order: 5, lift: "squat" }] },
        { date: "2026-11-19", rows: [{ order: 1, lift: null }, { order: 0, lift: "deadlift" }] },
      ]),
    ).toEqual(["Monday", "Thursday"]);
  });

  it("treadmill history needs 3 sessions of each reading; other cardio is left out", () => {
    const d = (date: string, o: Partial<{ type: string | null; speed: number | null; incline: number | null; rpe: number | null }>) => ({ date, type: "Incline Treadmill Walk", completed: true, skipped: false, speed: 3.2, incline: 6, rpe: 4, minutes: 25, ...o });
    const h = treadmillHistory([d("2026-11-10", {}), d("2026-11-12", {}), d("2026-11-14", { incline: null }), d("2026-11-15", { type: "Bike", speed: 15 })], TODAY);
    expect(h).toMatchObject({ speedMph: 3.2, inclinePct: null, sessions: 3 });
    expect(cardioAdherence([d("2026-11-10", {}), d("2026-11-12", {})], 2, TODAY)).toEqual({ done: 2, planned: 8 });
    expect(cardioAdherence([], 0, TODAY)).toBeNull();
  });

  it("waist in cm, a meet's sport", () => {
    expect(waistCm({ waist: 34 }, "in")).toBe(86.4);
    expect(waistCm({ waist: 86 }, "cm")).toBe(86);
    expect(waistCm({ chest: 100 }, "cm")).toBeNull();
    expect(prepSport("Powerlifting Competition", "83")).toBe("powerlifting");
    expect(prepSport("Bodybuilding / Hypertrophy Phase", null)).toBe("bodybuilding");
    expect(prepSport("Photoshoot", null)).toBe("bodybuilding");
    expect(prepSport("Wedding / Event", null)).toBe("other");
  });
});

describe("progress photo comparison", () => {
  const subs = ["2026-08-20", "2026-09-17", "2026-10-15", "2026-10-29", "2026-11-05", "2026-11-12"].map((date, i) => ({ id: `s${i}`, date }));

  it("the latest against the nearest check-in N weeks before", () => {
    expect(pickComparison(subs, 4)).toMatchObject({ before: { date: "2026-10-15" }, after: { date: "2026-11-12" } });
    expect(pickComparison(subs, 1)).toMatchObject({ before: { date: "2026-11-05" } });
    expect(pickComparison([subs[0]], 4)).toBeNull();
  });

  it("offers only the quick picks it can honour", () => {
    // 6 weeks back lands on the same check-in as 8, so only 8 is offered
    expect(availableWeeks(subs)).toEqual([1, 2, 4, 8, 12]);
    expect(availableWeeks(subs.slice(-2))).toEqual([1]);
  });

  it("the scale and the tape around each photo", () => {
    const rows = [
      { date: "2026-11-08", value: 180 },
      { date: "2026-11-10", value: 181 },
      { date: "2026-11-12", value: 179 },
      { date: "2026-10-01", value: 190 },
    ];
    expect(weightAround(rows, "2026-11-12")).toEqual({ value: 180, n: 3 });
    expect(weightAround(rows, "2026-12-30")).toBeNull();
    expect(waistAround([{ date: "2026-11-10", waist: 88, unit: "cm" }], "2026-11-12")).toMatchObject({ value: 88 });
    expect(waistAround([{ date: "2026-11-01", waist: 88, unit: "cm" }], "2026-11-12")).toBeNull();
    expect(changeText(185, 181.5, "lb")).toBe("−3.5 lb");
    expect(changeText(80, 80, "cm")).toBe("no change");
  });
});

describe("the audit trail", () => {
  const base = buildAssessment({
    today: TODAY,
    unit: "kg",
    speedUnit: "kmh",
    sex: "F",
    age: 34,
    heightCm: 165,
    level: "intermediate",
    weighIns: Array.from({ length: 30 }, (_, i) => ({ date: addDays(TODAY, -29 + i), kg: 70 - i * 0.02 })),
    goal: { type: "lose", kg: 64, kgMax: null, date: addDays(TODAY, 70) },
    meet: null,
    powerlifter: false,
    plan: { start: "2026-09-01", weeklyKcal: 1900, phase: "Fat Loss", starts: ["2026-09-01"] },
    checkins: [{ date: "2026-11-15", answers: { nutrition_rating: 5 } }],
    cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
    trainingDays: ["Monday", "Wednesday", "Friday"],
    heavyLowerDays: [],
    sessionMinutes: 60,
    dailySteps: null,
    water: { avgMl: null, targetMl: null, daysLogged: 0 },
    waist: [],
    performance: { lower: null, detail: null },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
  });

  it("a change waits on the coach; holding never pushes anyone", () => {
    expect(base.recommendation.material).toBe(true);
    expect(needsCoach(base)).toBe(true);
    const hold = { ...base, recommendation: { ...base.recommendation, verdict: "maintain" as const, material: false, actions: [] } };
    expect(needsCoach(hold)).toBe(false);
  });

  it("stores the read without the redrawn path", () => {
    expect(base.trajectory.path.length).toBeGreaterThan(0);
    expect(storedAssessment(base).trajectory.path).toEqual([]);
    expect(storedAssessment(base).hash).toBe(base.hash);
  });
});

describe("the migration", () => {
  const sql = readFileSync("supabase/migrations/20270402090000_weight_management.sql", "utf8");

  it("keeps both tables staff only, never anon, never the client", () => {
    for (const t of ["weight_management_profiles", "weight_management_reviews"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM anon`);
      expect(sql).toContain(`SELECT public.rls_evaluate_once('${t}')`);
    }
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    expect(policies.length).toBe(6);
    for (const p of policies) {
      expect(p).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'\)/);
      expect(p).toMatch(/client_id IN \(SELECT public\.coached_client_ids\(\)\)/);
      expect(p).not.toMatch(/user_id = auth\.uid\(\)/);
    }
    // the engine's record can't be rewritten, only decided on; and nothing deletes it
    expect(sql).toContain("weight_management_reviews_keep_record");
    expect(sql).not.toMatch(/FOR DELETE/);
    expect(sql).toMatch(/UNIQUE \(client_id, hash\)/);
  });

  it("adds the goal date and the training-day water", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS bodyweight_goal_date date");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS training_extra_ml integer");
  });
});

describe("wired into the app", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the weekly check-in asks follow-ups only for what was flagged", () => {
    const card = read("src/components/messages/messenger-checkin-card.tsx");
    for (const k of ["digestion_symptoms", "digestion_timing", "digestion_severity", "hunger_level", "cardio_issue", "water_issue"]) expect(card).toContain(`key: "${k}"`);
    expect(card).toMatch(/showWhen: flagged\("Digestion \/ bloating"\)/);
    expect(card).toContain('"Digestion / bloating": ["digestion_symptoms", "digestion_timing", "digestion_severity"]');
    expect(card).toContain('action: "photo"');
  });

  it("the check-in recap and the nutrition AI read the engine; nothing else writes plans", () => {
    const ci = read("src/lib/messenger-checkins.functions.ts");
    expect(ci).toContain("recordCheckinReview(sb, row.client_id, row.id)");
    const plans = read("src/lib/nutrition-ai-plans.server.ts");
    expect(plans).toContain("loadWeightText(sb, sub.client_id)");
    const prompts = read("src/lib/nutrition-ai-prompts.ts");
    expect(prompts).toMatch(/new cardio is a treadmill walk/);
    expect(prompts).toMatch(/never plan dehydration, water loading, sodium manipulation or a crash cut/);
    const reviews = read("src/lib/weight-management/reviews.server.ts");
    expect(reviews).not.toMatch(/from\("nutrition_targets"\)\s*\.(update|insert|upsert)/);
  });

  it("the coach sees it on the client's Nutrition tab, and the push opens it", () => {
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toContain("<WeightManagementCard clientId={id}");
    expect(read("src/lib/push/app-events.server.ts")).toContain("weight_review_ready");
  });
});
