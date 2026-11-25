import { describe, expect, it } from "vitest";
import { assessClient, assessmentForReply, stepMinutesDelta, type AssessInput } from "@/lib/autopilot/assess";
import { DEFAULT_SETTINGS, resolveSettings, routeAssessment, withinRange, type Settings, type SettingsRow } from "@/lib/autopilot/autonomy";
import { applyCardioStep } from "@/lib/autopilot/cardio-step";
import { publishWindow, systemCard, systemCardBody, workoutInProgress, wordCount } from "@/lib/autopilot/publish";
import { fitReply, replyKindFor, replyProblems, REPLY_WORDS } from "@/lib/autopilot/reply";
import { judgeOutcome } from "@/lib/autopilot/outcome";
import { costTable, estimateCost, addUsage } from "@/lib/autopilot/cost";
import type { Recommendation } from "@/lib/weight-management/decision";
import { newSession, type CardioPlan } from "@/lib/cardio/plan";

const TODAY = "2026-11-25";

function wm(over: Partial<Recommendation> = {}): Recommendation {
  return {
    verdict: "maintain",
    limiting: "none",
    headline: "Hold the plan",
    reasons: ["Losing 0.5 kg a week, on pace for the goal."],
    evidence: "moderate",
    actions: [],
    expected: null,
    reviewInDays: 7,
    material: false,
    ...over,
  };
}

function input(over: Partial<AssessInput> = {}): AssessInput {
  return {
    today: TODAY,
    trigger: "checkin",
    checkinId: "c1",
    direction: "lose",
    wm: wm(),
    rec: null,
    performance: "steady",
    training: { activeProgram: true, planned: 8, completed: 8, rating: 4, block: { name: "Strength", week: 2, weeks: 4, endsInDays: 16 }, nextBlockReady: false, daysSinceChange: 20 },
    pain: { level: "none", text: null },
    meetDaysOut: null,
    hasNutritionPlan: true,
    coachDrafts: {},
    ...over,
  };
}

const food = (kcal: number) =>
  wm({ verdict: "adjust", limiting: "energy" as any, headline: "Loss has stalled", reasons: ["Flat for 3 weeks."], actions: [{ kind: "nutrition", kcalPerDay: kcal, from: "carbs_and_fats", instruction: `Change calories by ${kcal} a day` }], expected: "About 0.3 kg a week", reviewInDays: 14, material: true });

const cardioUp = () =>
  wm({
    verdict: "adjust",
    limiting: "energy" as any,
    headline: "Add a little cardio",
    reasons: ["Hunger is high and loss has slowed."],
    actions: [
      {
        kind: "cardio",
        direction: "up",
        step: { variable: "minutes", session: "restDay", from: 30, to: 35, weeklyNetKcal: -60, why: "Days-off walks 30 → 35 min." },
        plan: { trainingDay: null, restDay: { minutes: 35, speedMph: 3, inclinePct: 6, perWeek: 3, weekdays: ["Tuesday", "Thursday", "Saturday"] } },
      },
    ],
    material: true,
  });

describe("assessClient", () => {
  it("holds when everything is on track (Maintain)", () => {
    const a = assessClient(input());
    expect(a.category).toBe("maintain");
    expect(Object.values(a.domains).every((d) => d.change === "hold")).toBe(true);
    expect(a.reassessOn).toBe("2026-12-02");
  });

  it("a calorie cut toward a loss goal is Accelerate, reassessed after 14+ days", () => {
    const a = assessClient(input({ wm: food(-150) }));
    expect(a.category).toBe("accelerate");
    expect(a.domains.nutrition.change).toBe("propose");
    expect(a.domains.nutrition.kcalPerDay).toBe(-150);
    expect(a.reassessOn >= "2026-12-09").toBe(true);
  });

  it("food back while losing is Optimize", () => {
    expect(assessClient(input({ wm: food(100) })).category).toBe("optimize");
  });

  it("pain protects training and makes it Intervene", () => {
    const a = assessClient(input({ pain: { level: "flag", text: "Left knee 6/10 on squats, getting worse" } }));
    expect(a.category).toBe("intervene");
    expect(a.protections.some((p) => p.reason === "injury" && p.domain === "training")).toBe(true);
    expect(a.domains.training.change).toBe("review");
  });

  it("a medical flag from weight management is protected", () => {
    const a = assessClient(input({ wm: wm({ verdict: "investigate", limiting: "safety", headline: "Digestion needs a doctor's look first", actions: [{ kind: "medical", text: "Blood in stool: doctor first." }] }) }));
    expect(a.category).toBe("intervene");
    expect(a.protections.some((p) => p.reason === "medical")).toBe(true);
  });

  it("no check-in and no weigh-ins is Investigate with missing information", () => {
    const a = assessClient(input({ checkinId: null, trigger: "scheduled", wm: wm({ verdict: "need_data", limiting: "data", headline: "No recent weigh-ins", actions: [{ kind: "ask", text: "Ask for weigh-ins" }] }) }));
    expect(a.category).toBe("investigate");
    expect(a.missing).toContain("No weekly check-in this week");
  });

  it("a block ending with nothing next while progressing is Extend, protected as a restructure", () => {
    const a = assessClient(input({ training: { ...input().training, block: { name: "Strength", week: 4, weeks: 4, endsInDays: 3 }, nextBlockReady: false } }));
    expect(a.category).toBe("extend");
    expect(a.protections.some((p) => p.reason === "restructure")).toBe(true);
  });

  it("lifts down with poor recovery proposes a lighter week as an Edit with AI instruction", () => {
    const a = assessClient(input({ performance: "down", training: { ...input().training, rating: 2 } }));
    expect(a.domains.training.change).toBe("propose");
    expect(a.domains.training.instruction).toMatch(/not yet trained or started/);
    expect(a.category).toBe("optimize");
  });

  it("never changes training within a week of the last change", () => {
    const a = assessClient(input({ performance: "down", training: { ...input().training, rating: 2, daysSinceChange: 3 } }));
    expect(a.domains.training.change).toBe("hold");
  });

  it("low adherence asks before touching the program", () => {
    const a = assessClient(input({ training: { ...input().training, planned: 8, completed: 3 } }));
    expect(a.domains.training.change).toBe("review");
    expect(a.domains.training.instruction).toBeNull();
  });

  it("a competition within 14 days protects every proposed change", () => {
    const a = assessClient(input({ wm: food(-100), meetDaysOut: 10 }));
    expect(a.protections.some((p) => p.reason === "competition" && p.domain === "nutrition")).toBe(true);
    const { routes } = routeAssessment(a, { ...DEFAULT_SETTINGS, modes: { training: "smart", nutrition: "smart", cardio: "smart" }, shadow: false });
    expect(routes.nutrition.action).toBe("draft");
    expect(routes.nutrition.bucket).toBe("requires_attention");
  });

  it("never writes over the coach's own draft", () => {
    const a = assessClient(input({ wm: food(-100), coachDrafts: { nutrition: true } }));
    expect(a.domains.nutrition.change).toBe("review");
    expect(a.protections.some((p) => p.reason === "coach_draft")).toBe(true);
  });

  it("cardio from the engine carries its step and weekly minutes", () => {
    const a = assessClient(input({ wm: cardioUp() }));
    expect(a.domains.cardio.change).toBe("propose");
    expect(a.domains.cardio.cardioMinutesDelta).toBe(15);
    expect(a.category).toBe("accelerate");
  });

  it("the reply text says a change is with the coach, never already made", () => {
    const t = assessmentForReply(assessClient(input({ wm: food(-150) })));
    expect(t).toMatch(/coach is looking at it/);
  });

  it("stepMinutesDelta reads each kind of step", () => {
    const plan = { trainingDay: { minutes: 15, speedMph: 3, inclinePct: 3, perWeek: 4, weekdays: [] }, restDay: { minutes: 30, speedMph: 3, inclinePct: 6, perWeek: 3, weekdays: [] } };
    expect(stepMinutesDelta({ variable: "frequency", session: "restDay", from: 2, to: 3, weeklyNetKcal: null, why: "" }, plan)).toBe(30);
    expect(stepMinutesDelta({ variable: "incline", session: "restDay", from: 5, to: 6, weeklyNetKcal: null, why: "" }, plan)).toBe(0);
    expect(stepMinutesDelta({ variable: "removed", session: "trainingDay", from: 15, to: 0, weeklyNetKcal: null, why: "" }, plan)).toBe(-60);
  });
});

describe("autonomy", () => {
  const g: SettingsRow = { scope: "global", client_id: null, mode_training: "draft", mode_nutrition: "draft", mode_cardio: "draft", locked_domains: [], ranges: {}, paused: false, paused_until: null, shadow: true };

  it("defaults to Draft Only and shadow for everyone", () => {
    const s = resolveSettings(null, null, TODAY);
    expect(s.modes).toEqual({ training: "draft", nutrition: "draft", cardio: "draft" });
    expect(s.shadow).toBe(true);
    const { routes, bucket } = routeAssessment(assessClient(input({ wm: food(-100) })), s);
    expect(routes.nutrition.action).toBe("draft");
    expect(bucket).toBe("awaiting_approval");
  });

  it("client overrides global; locks add up; pause until a date", () => {
    const c: SettingsRow = { ...g, scope: "client", client_id: "x", mode_nutrition: "smart", mode_training: null, locked_domains: ["cardio"], shadow: false, paused_until: "2026-11-30" };
    const s = resolveSettings({ ...g, locked_domains: ["training"] }, c, TODAY);
    expect(s.modes.nutrition).toBe("smart");
    expect(s.modes.training).toBe("draft");
    expect(s.locked.sort()).toEqual(["cardio", "training"]);
    expect(s.paused).toBe(true);
    expect(s.pausedBy).toBe("client");
    expect(resolveSettings(g, c, "2026-12-01").paused).toBe(false);
  });

  const smart = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, modes: { training: "smart", nutrition: "smart", cardio: "smart" }, shadow: false, ...over });

  it("Smart publishes a small change inside the range only with shadow off", () => {
    const a = assessClient(input({ wm: food(-100) }));
    expect(routeAssessment(a, smart()).routes.nutrition.action).toBe("publish");
    expect(routeAssessment(a, smart()).bucket).toBe("auto_updated");
    const shadow = routeAssessment(a, smart({ shadow: true }));
    expect(shadow.routes.nutrition.action).toBe("draft");
    expect(shadow.routes.nutrition.shadowWouldPublish).toBe(true);
  });

  it("Smart keeps a change over its range as a draft; Advanced allows up to the engine's step", () => {
    const a = assessClient(input({ wm: food(-200) }));
    expect(routeAssessment(a, smart()).routes.nutrition.action).toBe("draft");
    expect(routeAssessment(a, smart({ modes: { training: "draft", nutrition: "advanced", cardio: "draft" } })).routes.nutrition.action).toBe("publish");
    // the coach's own narrower range wins even on Advanced
    expect(routeAssessment(a, smart({ modes: { training: "draft", nutrition: "advanced", cardio: "draft" }, ranges: { nutritionKcal: 50, cardioMinutes: null } })).routes.nutrition.action).toBe("draft");
  });

  it("training never publishes by itself", () => {
    const a = assessClient(input({ performance: "down", training: { ...input().training, rating: 2 } }));
    expect(withinRange(a.domains.training, "advanced", { nutritionKcal: null, cardioMinutes: null })).toBe(false);
    expect(routeAssessment(a, smart({ modes: { training: "advanced", nutrition: "advanced", cardio: "advanced" } })).routes.training.action).toBe("draft");
  });

  it("a cardio change without the engine's step (a model draft) never publishes", () => {
    const a = assessClient(input({ rec: { headline: "x", hold: false, items: [{ domain: "cardio", title: "Move the walk away from lifting", observation: "Legs flat", recommendation: "", reason: "r", confidence: "moderate", action: { kind: "cardio_draft", ask: "Move it" } }] } }));
    expect(a.domains.cardio.change).toBe("propose");
    expect(routeAssessment(a, smart()).routes.cardio.action).toBe("draft");
  });

  it("paused and locked never draft", () => {
    const a = assessClient(input({ wm: food(-100) }));
    expect(routeAssessment(a, smart({ paused: true, pausedBy: "global" })).routes.nutrition.action).toBe("none");
    expect(routeAssessment(a, smart({ locked: ["nutrition"] })).routes.nutrition.bucket).toBe("requires_attention");
  });

  it("a protected decision is always the coach's", () => {
    const a = assessClient(input({ wm: food(-100), pain: { level: "severe", text: "Sharp back pain" } }));
    const r = routeAssessment(a, smart());
    expect(r.bucket).toBe("requires_attention");
  });
});

describe("applyCardioStep", () => {
  const ctx = { trainingDays: ["Monday", "Wednesday", "Friday"] as any, highDays: [] };
  const plan = (): CardioPlan => {
    const rest = newSession("treadmill_incline", "non_training", ctx);
    rest.minutes = 30;
    const train = newSession("treadmill_incline", "training", ctx);
    train.minutes = 15;
    return { sessions: [rest, train] };
  };

  it("changes only the one variable on the matching session", () => {
    const p = plan();
    const out = applyCardioStep(p, { variable: "minutes", session: "restDay", from: 30, to: 35, weeklyNetKcal: null, why: "" }, null, ctx)!;
    expect(out.sessions[0].minutes).toBe(35);
    expect(out.sessions[1].minutes).toBe(15);
    expect(p.sessions[0].minutes).toBe(30);
  });

  it("takes the training-day walk off when the step removes it", () => {
    const out = applyCardioStep(plan(), { variable: "removed", session: "trainingDay", from: 15, to: 0, weeklyNetKcal: null, why: "" }, null, ctx)!;
    expect(out.sessions[1].enabled).toBe(false);
  });

  it("adds a days-off walk when there's none", () => {
    const p = { sessions: [plan().sessions[1]] };
    const out = applyCardioStep(p, { variable: "added", session: "restDay", from: 0, to: 1, weeklyNetKcal: null, why: "" }, { trainingDay: null, restDay: { minutes: 20, speedMph: 3, inclinePct: 5, perWeek: 1, weekdays: ["Tuesday"] } }, ctx)!;
    expect(out.sessions).toHaveLength(2);
    expect(out.sessions[1].weekdays).toEqual(["Tuesday"]);
  });

  it("returns null when it can't tell which session the step means", () => {
    const p = plan();
    p.sessions[0].modality = "bike";
    expect(applyCardioStep(p, { variable: "minutes", session: "restDay", from: 30, to: 35, weeklyNetKcal: null, why: "" }, null, ctx)).toBeNull();
  });
});

describe("publishing", () => {
  const now = Date.parse("2026-11-25T18:00:00Z");
  it("never publishes during an active workout", () => {
    const w = [{ startedAt: "2026-11-25T17:10:00Z", lastActivityAt: "2026-11-25T17:40:00Z", completedAt: null }];
    expect(workoutInProgress(w, now)).toBe(true);
    expect(publishWindow({ now, readySince: now - 10 * 3600_000, workouts: w, lastSeenAt: null }).ok).toBe(false);
  });
  it("a finished or long-abandoned workout doesn't block", () => {
    expect(workoutInProgress([{ startedAt: "2026-11-25T17:00:00Z", lastActivityAt: null, completedAt: "2026-11-25T17:50:00Z" }], now)).toBe(false);
    expect(workoutInProgress([{ startedAt: "2026-11-25T10:00:00Z", lastActivityAt: "2026-11-25T11:00:00Z", completedAt: null }], now)).toBe(false);
  });
  it("waits while they're in the app, but not forever", () => {
    expect(publishWindow({ now, readySince: now - 60_000, workouts: [], lastSeenAt: "2026-11-25T17:58:00Z" }).ok).toBe(false);
    expect(publishWindow({ now, readySince: now - 7 * 3600_000, workouts: [], lastSeenAt: "2026-11-25T17:58:00Z" }).ok).toBe(true);
  });
  it("one card, deterministic, 5–20 words, never for nothing", () => {
    expect(systemCardBody(["nutrition"])).toBe("Your nutrition targets have been updated.");
    expect(systemCardBody(["cardio", "nutrition"])).toBe("Your nutrition and cardio plans have been updated.");
    const c = systemCard("d1", [{ domain: "nutrition", before: "2,100 kcal", after: "1,950 kcal" }, { domain: "cardio", before: "30 min", after: "30 min" }], "2026-11-26")!;
    expect(c.attachment.changes).toHaveLength(1);
    expect(c.attachment.open.url).toBe("/portal/nutrition-targets");
    const n = wordCount(c.body);
    expect(n >= 5 && n <= 20).toBe(true);
    expect(systemCard("d1", [{ domain: "cardio", before: "x", after: null }], "2026-11-26")).toBeNull();
  });
});

describe("reply rules", () => {
  it("lengths by kind", () => {
    expect(replyKindFor({ taskType: "weekly_checkin", redFlags: 0, protectedDecision: false, helpAsked: false })).toBe("weekly");
    expect(replyKindFor({ taskType: "weekly_checkin", redFlags: 1, protectedDecision: false, helpAsked: false })).toBe("complex");
    expect(replyKindFor({ taskType: "nutrition_update", redFlags: 0, protectedDecision: false, helpAsked: false })).toBe("quick");
    expect(REPLY_WORDS.weekly).toEqual({ min: 40, max: 80 });
    expect(REPLY_WORDS.complex.max).toBe(120);
  });
  it("drops a generic opener and anything claiming the coach typed it", () => {
    const t = fitReply("Thanks for checking in! Squats moved well at 140 for 3. I personally wrote this. Keep the walks going this week.", "weekly");
    expect(t.startsWith("Squats")).toBe(true);
    expect(t).not.toMatch(/personally wrote/);
    expect(replyProblems("Based on the data, you did fine and that is it for now okay then.", "weekly")).toContain("generic_opener");
  });
  it("cuts a long reply back at a sentence end", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} has six words.`).join(" ");
    const t = fitReply(long, "weekly");
    expect(wordCount(t)).toBeLessThanOrEqual(80);
    expect(t.endsWith(".")).toBe(true);
  });
});

describe("outcome", () => {
  const snap = (over: any = {}) => ({ date: "2026-11-25", kgPerWeek: -0.1, requiredKgPerWeek: -0.5, status: "behind", performance: "steady" as const, adherence: 0.9, ...over });
  it("too early before a week", () => {
    expect(judgeOutcome({ category: "accelerate", changed: ["nutrition"], baseline: snap(), now: snap({ date: "2026-11-28" }) }).verdict).toBe("too_early");
  });
  it("worked when on pace with the lifts holding", () => {
    expect(judgeOutcome({ category: "accelerate", changed: ["nutrition"], baseline: snap(), now: snap({ date: "2026-12-09", kgPerWeek: -0.5, status: "on_track" }) }).verdict).toBe("worked");
  });
  it("didn't when still off pace", () => {
    expect(judgeOutcome({ category: "accelerate", changed: ["nutrition"], baseline: snap(), now: snap({ date: "2026-12-09", kgPerWeek: -0.1 }) }).verdict).toBe("did_not");
  });
  it("a training change judged on the lifts", () => {
    expect(judgeOutcome({ category: "optimize", changed: ["training"], baseline: snap({ performance: "down" }), now: snap({ date: "2026-12-09", performance: "steady" }) }).verdict).toBe("worked");
  });
});

describe("cost", () => {
  it("scales linearly with clients and prices from the sourced table", () => {
    const t = costTable();
    expect(t.map((r) => r.clients)).toEqual([25, 50, 100, 250, 500]);
    expect(estimateCost(500).usdPerWeek).toBeCloseTo(estimateCost(25).usdPerWeek * 20, 1);
    expect(t[0].usdPerWeek).toBeGreaterThan(0);
  });
  it("adds a call's usage", () => {
    const u = addUsage(null, { model: "openai:gpt-5-mini", input: 1000, output: 500 });
    expect(u.calls).toBe(1);
    expect(u.usd).toBeCloseTo((1000 * 0.25 + 500 * 2) / 1e6, 6);
  });
});

describe("cost table in docs/CLEO_AUTOPILOT.md", () => {
  it("matches the estimate the doc prints", () => {
    const t = costTable();
    expect(t.map((r) => r.usdPerWeek)).toEqual([5.29, 10.58, 21.16, 52.9, 105.8]);
    expect(t.map((r) => r.callsPerWeek)).toEqual([55, 110, 220, 550, 1100]);
  });
});
