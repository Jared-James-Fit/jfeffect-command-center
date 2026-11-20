import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  digestLines,
  isNudgeable,
  nutritionReviewDue,
  nutritionUpdateDecision,
  planCheckin,
  progressDefault,
  reviewWeeks,
  requestWarnings,
  scheduleDays,
  weighInDue,
  type PlanInput,
} from "@/lib/checkin-coordination/plan";
import { addPlanSteps } from "@/lib/checkin-coordination/steps";
import { prefillAnswer } from "@/lib/form-prefill";

const DUE = "2026-11-22"; // a Sunday check-in, sent Friday Nov 20

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  due: DUE,
  lastWeighIn: "2026-11-21",
  weighInsLast7: 6,
  meet: null,
  goal: null,
  lastPhotos: null,
  lastMeasurements: null,
  schedules: [],
  nutritionPendingSince: null,
  ...o,
});
const keys = (p: ReturnType<typeof planCheckin>) => p.extras.map((e) => e.key);

describe("one weekly check-in, only what this client needs", () => {
  it("a general client logging daily: the standard check-in, bodyweight read, nothing added", () => {
    const p = planCheckin(base());
    expect(p.extras).toEqual([]);
    expect(p.skipped).toEqual([{ key: "bodyweight", reason: "Read from their log (6 weigh-ins this week), not asked" }]);
  });

  it("no weigh-in this week: one quick entry, never a bodyweight question", () => {
    expect(keys(planCheckin(base({ lastWeighIn: "2026-11-10", weighInsLast7: 0 })))).toEqual(["bodyweight"]);
    expect(keys(planCheckin(base({ lastWeighIn: null, weighInsLast7: 0 })))).toEqual(["bodyweight"]);
  });

  it("a powerlifter making weight gets the weight-making question, and no photos or tape (a class is made on the scale)", () => {
    const p = planCheckin(base({ meet: { date: "2027-01-10", weightClass: "83", name: "Provincials" }, phase: "Fat Loss" }));
    expect(keys(p)).toEqual(["weight_making"]);
    expect(p.extras[0].reason).toBe("Provincials in 7 weeks, 83 class");
  });

  it("a meet without a class or far away adds no weight-making question", () => {
    expect(keys(planCheckin(base({ meet: { date: "2027-01-10", weightClass: null, name: "Open" } })))).not.toContain("weight_making");
    expect(keys(planCheckin(base({ meet: { date: "2027-09-10", weightClass: "83", name: "Worlds" } })))).not.toContain("weight_making");
  });

  it("photos and measurements already on file are never asked for again", () => {
    const p = planCheckin(base({ goal: { type: "lose", date: null }, lastPhotos: "2026-11-10", lastMeasurements: "2026-11-15" }));
    expect(keys(p)).toEqual([]);
    expect(p.skipped.map((s) => s.key)).toEqual(["bodyweight", "photos", "measurements"]);
    expect(p.skipped[1].reason).toMatch(/on file from Nov 10; next due about Dec 8/);
  });

  it("a fat-loss client is asked for photos once 4 weeks have passed", () => {
    expect(keys(planCheckin(base({ goal: { type: "lose", date: null }, lastPhotos: "2026-10-20", lastMeasurements: "2026-10-20" })))).toEqual(["photos", "measurements"]);
  });

  it("the coach's own schedule wins (and a client with no goal and no schedule is never asked)", () => {
    const sched = { kind: "photos" as const, enabled: true, frequency: "biweekly" as const, customDays: null };
    expect(keys(planCheckin(base({ schedules: [sched], lastPhotos: "2026-11-06" })))).toEqual(["photos"]);
    expect(keys(planCheckin(base({ schedules: [sched], lastPhotos: "2026-11-15" })))).toEqual([]);
    expect(keys(planCheckin(base({ schedules: [{ ...sched, enabled: false }] })))).toEqual([]);
    expect(scheduleDays({ frequency: "custom", customDays: 10 })).toBe(10);
    expect(scheduleDays({ frequency: "none", customDays: null })).toBeNull();
  });

  it("a first Nutrition Update waiting is pointed at from the check-in (the full form), never reminded again", () => {
    const p = planCheckin(base({ nutritionPendingSince: "2026-11-16" }));
    expect(keys(p)).toEqual(["nutrition_update"]);
    expect(p.extras[0].inline).toBe(false);
    expect(p.extras[0].reason).toMatch(/their first one, so it's the full form/);
  });

  it("a client who's sent one before answers this month's inside the check-in", () => {
    const p = planCheckin(base({ nutritionPendingSince: "2026-11-20", nutritionLastAnswered: "2026-10-26", nutritionOptions: { goal: ["Fat Loss"], freeMeal: ["Yes"] } }));
    expect(p.extras[0]).toMatchObject({ key: "nutrition_update", inline: true, since: "2026-10-26", options: { goal: ["Fat Loss"], freeMeal: ["Yes"] } });
    expect(p.extras[0].reason).toMatch(/answered in this check-in, only what changed since Oct 26/);
    // answered after it was asked: nothing waiting
    expect(keys(planCheckin(base({ nutritionPendingSince: null, nutritionLastAnswered: "2026-11-21" })))).toEqual([]);
  });

  it("the steps go where they belong, and only those", () => {
    const weekly = ["week_rating", "training_rating", "nutrition_rating", "recovery_flags", "pain_details", "win", "help", "next_week_goal"].map((key) => ({ key }));
    const plan = planCheckin(base({ lastWeighIn: null, weighInsLast7: 0, meet: { date: "2027-01-10", weightClass: "83", name: "Provincials" } }));
    const steps = addPlanSteps(weekly, plan).map((s) => s.key);
    expect(steps).toEqual([
      "week_rating",
      "training_rating",
      "nutrition_rating",
      "weight_making",
      "recovery_flags",
      "pain_details",
      "bodyweight_logged",
      "win",
      "help",
      "next_week_goal",
    ]);
    expect(addPlanSteps(weekly, planCheckin(base())).map((s) => s.key)).toEqual(weekly.map((w) => w.key));
    expect(addPlanSteps(weekly, null)).toBe(weekly);
  });
});

describe("never asked twice", () => {
  it("the Nutrition Update's bodyweight fills from a weigh-in logged today or yesterday, in the unit it asks", () => {
    const q = { label: "Current fasted bodyweight? (lbs)", validation: { prefill: "bodyweight", unit: "lb", min: 70, max: 700 } };
    expect(prefillAnswer(q, { bodyweight: { value: 82, unit: "kg", date: "2026-11-17", fresh: true } })).toBe("180.8");
    expect(prefillAnswer(q, { bodyweight: { value: 181.2, unit: "lb", date: "2026-11-17", fresh: true } })).toBe("181.2");
    // an older weigh-in isn't "current": they answer it
    expect(prefillAnswer(q, { bodyweight: { value: 181.2, unit: "lb", date: "2026-11-01", fresh: false } })).toBeNull();
    expect(readFileSync("supabase/migrations/20270402091000_checkin_coordination.sql", "utf8")).toMatch(/label ILIKE 'Current fasted bodyweight%'/);
  });
});

describe("one reminder per outstanding thing", () => {
  it("automated request cards are left to the morning digest; a coach's own words still get the nudge", () => {
    expect(isNudgeable({ is_automated: true, message_type: "Check-In" })).toBe(false);
    expect(isNudgeable({ is_automated: true, message_type: "Form" })).toBe(false);
    expect(isNudgeable({ is_automated: true, message_type: "Scheduling" })).toBe(false);
    expect(isNudgeable({ is_automated: false, message_type: "Check-In" })).toBe(true);
    expect(isNudgeable({ is_automated: null, message_type: null })).toBe(true);
  });

  it("the digest groups what's waiting into one line", () => {
    expect(digestLines({ workout: "Today: Lower A", checkinPending: true, nutritionPending: true, weighInDue: false })).toEqual(["Today: Lower A", "your check-in and your nutrition update are waiting", null]);
    expect(digestLines({ workout: null, checkinPending: false, nutritionPending: true, weighInDue: true })).toEqual([null, "your nutrition update is waiting", "log this morning's weight"]);
    expect(digestLines({ workout: null, checkinPending: false, nutritionPending: false, weighInDue: false })).toEqual([null, null, null]);
  });

  it("meet week asks for a weigh-in only when nothing's been logged for 2 days", () => {
    expect(weighInDue({ today: "2026-11-17", meetDate: "2026-11-24", weightClass: "83", lastWeighIn: "2026-11-14" })).toBe(true);
    expect(weighInDue({ today: "2026-11-17", meetDate: "2026-11-24", weightClass: "83", lastWeighIn: "2026-11-16" })).toBe(false);
    expect(weighInDue({ today: "2026-11-17", meetDate: "2026-12-24", weightClass: "83", lastWeighIn: null })).toBe(false);
    expect(weighInDue({ today: "2026-11-17", meetDate: "2026-11-24", weightClass: null, lastWeighIn: null })).toBe(false);
  });
});

describe("the Nutrition Update follows the plan's review, through the weekly check-in", () => {
  it("the review is the coach's own Next update due, else the goal's rhythm from the later of the start and the last update", () => {
    expect(nutritionReviewDue({ endDate: "2026-12-10", startDate: "2026-11-10", lastAnswered: "2026-11-08", phase: "Fat Loss" })).toBe("2026-12-10");
    expect(nutritionReviewDue({ endDate: null, startDate: "2026-06-05", lastAnswered: null, phase: "Fat Loss" })).toBe("2026-07-03");
    expect(nutritionReviewDue({ endDate: null, startDate: "2026-06-08", lastAnswered: "2026-10-01", phase: "Maintenance" })).toBe("2026-11-26");
    expect(nutritionReviewDue({ endDate: null, startDate: null, lastAnswered: null, phase: null })).toBeNull();
    expect([reviewWeeks("Fat Loss"), reviewWeeks("Recomp"), reviewWeeks("Muscle Gain"), reviewWeeks("Maintenance"), reviewWeeks(null)]).toEqual([4, 6, 6, 8, 4]);
  });

  const at = (o: Partial<Parameters<typeof nutritionUpdateDecision>[0]> = {}) =>
    nutritionUpdateDecision({ today: "2026-11-20", hour: 7, reviewDue: "2026-11-27", lastAnswered: "2026-10-26", lastAsked: "2026-10-25", weeklyCard: "open", weeklyCardComing: false, hasPrior: true, ...o });

  it("in the week it's due, a client who's sent one before answers it inside the open check-in", () => {
    expect(at()).toBe("fold");
  });
  it("a first one is the form itself, the same morning as the check-in card", () => {
    expect(at({ hasPrior: false, lastAnswered: null })).toBe("standalone");
  });
  it("not before the review week, never within 3 weeks of the last update, never two requests within 25 days", () => {
    expect(at({ reviewDue: "2026-12-10" })).toBe("wait");
    expect(at({ lastAnswered: "2026-11-08" })).toBe("skip");
    expect(at({ lastAsked: "2026-11-01" })).toBe("skip");
    expect(at({ reviewDue: null })).toBe("skip");
    expect(at({ hour: 6 })).toBe("wait");
  });
  it("Nov 10–12 plans with a 4-week review aren't asked again on Nov 27 (the month-end rule would have)", () => {
    expect(at({ today: "2026-11-27", reviewDue: "2026-12-10", lastAnswered: "2026-11-08" })).toBe("wait");
  });
  it("the check-in already answered this week: the next card carries it, else the form", () => {
    expect(at({ weeklyCard: "answered", weeklyCardComing: true })).toBe("wait");
    expect(at({ weeklyCard: "answered", weeklyCardComing: false })).toBe("standalone");
    expect(at({ weeklyCard: "answered", hasPrior: false, lastAnswered: null })).toBe("standalone");
  });
  it("no check-ins at all: the form on the day it's due, from 9am", () => {
    expect(at({ weeklyCard: null, weeklyCardComing: true })).toBe("wait");
    expect(at({ weeklyCard: null, today: "2026-11-24" })).toBe("wait");
    expect(at({ weeklyCard: null, today: "2026-11-27", hour: 8 })).toBe("wait");
    expect(at({ weeklyCard: null, today: "2026-11-27", hour: 9 })).toBe("standalone");
  });
});

describe("photos and measurements: the coach's schedule, else the goal, never required", () => {
  it("goal defaults", () => {
    expect(progressDefault("photos", { phase: "Fat Loss", goalType: null, classMeet: false }).days).toBe(28);
    expect(progressDefault("measurements", { phase: "Fat Loss", goalType: null, classMeet: false }).days).toBe(14);
    expect(progressDefault("measurements", { phase: "Recomp", goalType: null, classMeet: false }).days).toBe(14);
    expect(progressDefault("photos", { phase: "Muscle Gain", goalType: null, classMeet: false }).days).toBe(28);
    expect(progressDefault("measurements", { phase: "Muscle Gain", goalType: null, classMeet: false }).days).toBe(28);
    expect(progressDefault("photos", { phase: "Maintenance", goalType: null, classMeet: false }).days).toBeNull();
    expect(progressDefault("photos", { phase: null, goalType: null, classMeet: false }).days).toBeNull();
    expect(progressDefault("photos", { phase: null, goalType: "lose", classMeet: false }).days).toBe(28);
    expect(progressDefault("photos", { phase: "Fat Loss", goalType: null, classMeet: true }).days).toBeNull();
  });
  it("a maintenance client is never asked; a fat loss one is, optionally, until they're on file", () => {
    expect(keys(planCheckin(base({ phase: "Maintenance" })))).toEqual([]);
    expect(keys(planCheckin(base({ phase: "Fat Loss" })))).toEqual(["photos", "measurements"]);
  });
  it("the coach's schedule wins both ways: switched on is theirs, No reminder is never", () => {
    expect(keys(planCheckin(base({ phase: "Maintenance", schedules: [{ kind: "photos", enabled: true, frequency: "weekly", customDays: null }] })))).toEqual(["photos"]);
    expect(keys(planCheckin(base({ phase: "Fat Loss", schedules: [{ kind: "photos", enabled: false, frequency: "none", customDays: null }] })))).toEqual(["measurements"]);
    // switched off with a frequency still picked (July's rows): follows the goal
    expect(keys(planCheckin(base({ phase: "Fat Loss", schedules: [{ kind: "photos", enabled: false, frequency: "weekly", customDays: null }] })))).toEqual(["photos", "measurements"]);
  });
});

describe("a coach sending by hand is warned, never blocked", () => {
  it("names the open check-in, the automated one it replaces and a waiting Nutrition Update", () => {
    const status = { weekly: { pendingSince: "2026-11-14", nextAutomated: "2026-11-20" }, nutrition: { pendingSince: "2026-11-16" } };
    expect(requestWarnings("weekly_checkin", status, "2026-11-18")).toEqual([
      "The check-in sent Nov 14 is still open: this one replaces it.",
      "Their weekly check-in goes out on its own Nov 20. Sending now counts as this week's, so that one won't go out.",
    ]);
    expect(requestWarnings("nutrition_update", status, "2026-11-18")[0]).toMatch(/Nov 16 hasn't been answered yet/);
    expect(requestWarnings("weekly_checkin", { weekly: { pendingSince: null, nextAutomated: "2026-11-27" }, nutrition: { pendingSince: null } }, "2026-11-18")).toEqual([]);
  });
});

describe("delivery, wired", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const sql = read("supabase/migrations/20270402091000_checkin_coordination.sql");

  it("the senders take a lock, skip archived / deactivated / non-coaching clients, and land the card at 7am", () => {
    expect(sql).toContain("pg_try_advisory_xact_lock(hashtext('enqueue_due_messenger_checkins'))");
    expect(sql).toContain("pg_try_advisory_xact_lock(hashtext('enqueue_monthly_nutrition_updates'))");
    expect(sql).toMatch(/coalesce\(c\.archived, false\) = false\s+and c\.service_tier = 'coaching'\s+and coalesce\(c\.status, ''\) not in \('Deactivated', 'Deleted'\)/);
    expect(sql).toContain("if local_now::time < '07:00'::time then continue; end if;");
    expect(sql).not.toMatch(/at time zone coalesce\(nullif\(o\.client_tz/);
  });

  it("any weekly check-in counts toward the 4-day guard, a coach's by hand included", () => {
    const guard = sql.slice(sql.indexOf("Never a second request"), sql.indexOf("new_checkin_id := null"));
    expect(guard).toMatch(/occ\.task_type = 'weekly_checkin'\s+and coalesce\(mc\.status, ''\) <> 'superseded'/);
    expect(guard).not.toMatch(/weekly_checkin'\s+and mc\.occurrence_id is not null/);
  });

  it("the Nutrition Update rides with the weekly card, honours 'not needed', every 15 minutes", () => {
    expect(sql).toContain("coalesce(t.tracking_status, '') <> 'not_needed'");
    expect(sql).toContain("'7,22,37,52 * * * *'");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS plan jsonb");
  });

  it("a check-in sent by hand completes the week; resends stay what they were; pushes dedupe", () => {
    expect(read("src/lib/messenger-checkins.functions.ts")).toContain("A check-in sent by hand counts as this week's");
    const resend = read("src/lib/form-requests.functions.ts");
    expect(resend).toContain("is_automated: !!old.is_automated");
    expect(resend).not.toContain("`${it.formId}:${Date.now()}`");
    expect(read("src/lib/nutrition-ai-plans.functions.ts")).not.toContain("`${formId}:${Date.now()}`");
    expect(read("src/lib/sms-unread-reminders.server.ts")).toContain(".filter(isNudgeable)");
    expect(read("src/lib/meet-checklist-reminders.server.ts")).toContain("const today = dayIn(a.client?.timezone);");
    expect(read("src/lib/push/scheduled-pushes.server.ts")).toContain("digestLines({ workout: workoutLine");
  });
});

describe("the monthly Nutrition Update inside the check-in", () => {
  it("sits just before the open questions: meals, a swap only when swapping, what changed, each change's one follow-up", async () => {
    const { nutritionSteps } = await import("@/lib/checkin-coordination/steps");
    const weekly = ["week_rating", "nutrition_rating", "recovery_flags", "win", "help"].map((key) => ({ key }));
    const plan = planCheckin(base({ nutritionPendingSince: "2026-11-20", nutritionLastAnswered: "2026-10-26" }));
    const steps = addPlanSteps(weekly, plan) as Array<{ key: string; showWhen?: (a: Record<string, any>) => boolean }>;
    expect(steps.map((s) => s.key)).toEqual([
      "week_rating", "nutrition_rating", "recovery_flags",
      "nu_meals", "nu_swap", "nu_changed", "nu_goal", "nu_goal_detail", "nu_allergies", "nu_health", "nu_supplements", "nu_activity", "nu_free_meal",
      "win", "help",
    ]);
    const shown = (a: Record<string, any>) => steps.filter((s) => !s.showWhen || s.showWhen(a)).map((s) => s.key).filter((k) => k.startsWith("nu_"));
    // nothing changed and keeping the meals: 2 screens
    expect(shown({ nu_meals: "Keep my meals (just update the numbers)", nu_changed: ["Nothing else changed"] })).toEqual(["nu_meals", "nu_changed"]);
    expect(shown({ nu_meals: "Swap some foods or meals", nu_changed: ["Health, injuries or meds"] })).toEqual(["nu_meals", "nu_swap", "nu_changed", "nu_health"]);
    expect(nutritionSteps({ since: "2026-10-26" }).find((s) => s.key === "nu_changed")?.prompt).toBe("Anything changed since your last update (Oct 26)?");
    // a first one is the form, not inline steps
    const first = planCheckin(base({ nutritionPendingSince: "2026-11-20" }));
    expect(addPlanSteps(weekly, first).map((s) => s.key).some((k) => k.startsWith("nu_"))).toBe(false);
  });

  it("is an ordinary Nutrition Update: last month's answers carried, records refreshed, only what changed rewritten", async () => {
    const { foldNutritionAnswers, roleOf, withChange } = await import("@/lib/checkin-coordination/nutrition-fold");
    // the production form's own labels
    const labels: Record<string, string> = {
      sex: "Sex", bw: "Current fasted bodyweight? (lbs)", height: "Height (ft)", goal: "Goal", bf: "Which body fat % range do you look closest to?",
      detail: "Explain your goal with more details: is there a target bodyweight? timeframe? an event?", allergies: "Any allergies? list all and explain",
      health: "Any health conditions, injuries or medications? List them, or write none.", supps: "What supplements do you take now? Name and dose, or write none.",
      meals: "What should happen with the meals in your current plan?", swap: "Which foods or meals do you want changed, and what would you rather have?",
      free: "Do you want a free meal on your High Day?", pick: "What's your go-to free meal?", days: "Training days per week", missed: "Anything i missed or need to know?",
      agree: "I understand this plan uses exact measurements (grams/oz) for best results. I will weigh my food.",
    };
    const types: Record<string, string> = { sex: "dropdown", bw: "number", days: "number", goal: "dropdown", free: "single_choice", pick: "single_choice", meals: "single_choice", agree: "dropdown" };
    const validation: Record<string, Record<string, unknown>> = { sex: { prefill: "sex" }, bw: { prefill: "bodyweight", unit: "lb" }, height: { prefill: "height" }, meals: { prefill: "nutrition_plan" } };
    const questions = Object.entries(labels).map(([id, label]) => ({ id, label, question_type: types[id] ?? "long_text", options: id === "sex" ? ["Male", "Female", "Prefer not to say"] : null, validation: validation[id] ?? {} }));
    expect(questions.map((q) => roleOf(q.label))).toEqual([null, null, null, "goal", "bodyFat", "goalDetail", "allergies", "health", "supplements", "meals", "swap", "freeMeal", "freeMealPick", "trainingDays", "missed", null]);
    const t = (question_id: string, value_text: string) => ({ question_id, value_text, value_number: null, value_json: null });
    const last = [
      t("sex", "Male"), { question_id: "bw", value_text: null, value_number: 182, value_json: null }, t("height", "5 ft 10"), t("goal", "Fat Loss"), t("bf", "20–24%"),
      t("detail", "185 by Christmas"), t("allergies", "None"), t("health", "Sore shoulder"), t("supps", "Creatine 5g"), t("meals", "Keep my meals (just update the numbers)"),
      t("free", "Yes, give me a free meal on my High Day"), t("pick", "Pizza"), { question_id: "days", value_text: null, value_number: 3, value_json: null }, t("missed", "Busy month"), t("agree", "Yes, I understand and agree"),
    ];
    const fold = (checkin: Record<string, unknown>, fresh = true) =>
      Object.fromEntries(
        foldNutritionAnswers({
          questions,
          last,
          profile: { sex: "male", height_cm: 178, preferred_height_unit: "imperial", has_nutrition_plan: true, bodyweight: fresh ? { value: 179.4, unit: "lb", date: "2026-11-20", fresh: true } : null },
          trainingDays: 4,
          checkin,
          day: "2026-11-20",
        }).map((r) => [r.question_id, r.value_text ?? r.value_number]),
      );
    const nothing = fold({ nu_meals: "Keep my meals (just update the numbers)", nu_changed: ["Nothing else changed"], help: "" });
    expect(nothing).toMatchObject({ sex: "Male", bw: 179.4, goal: "Fat Loss", detail: "185 by Christmas", allergies: "None", health: "Sore shoulder", supps: "Creatine 5g", pick: "Pizza", days: 4, missed: "That's everything", agree: "Yes, I understand and agree" });
    expect(nothing.swap).toBeUndefined();
    const changed = fold({
      nu_meals: "Swap some foods or meals", nu_swap: "No more tuna",
      nu_changed: ["Goal or target", "Allergies or diet", "Health, injuries or meds", "Free meal"],
      nu_goal: "Maintenance", nu_goal_detail: "Hold through the holidays", nu_allergies: "Lactose intolerant", nu_health: "Shoulder's fine now", nu_free_meal: "No free meal, just a planned High Day",
      help: "Travelling Dec 20",
    });
    expect(changed).toMatchObject({ meals: "Swap some foods or meals", swap: "No more tuna", goal: "Maintenance", detail: "Hold through the holidays", allergies: "Lactose intolerant", health: "Sore shoulder\nUpdate Nov 20: Shoulder's fine now", free: "No free meal, just a planned High Day", missed: "Travelling Dec 20" });
    expect(changed.pick).toBeUndefined();
    // a follow-up typed and then unticked never lands
    expect(fold({ nu_meals: "Keep my meals (just update the numbers)", nu_changed: ["Nothing else changed"], nu_goal: "Muscle Gain" }).goal).toBe("Fat Loss");
    // last month's weight is never this month's
    expect(fold({ nu_meals: "Keep my meals (just update the numbers)", nu_changed: ["Nothing else changed"] }, false).bw).toBeUndefined();
    expect(withChange("None", "Peanuts", "Nov 20")).toBe("Peanuts");
  });

  it("stores answers the way the form does (the same JSON types)", async () => {
    const { toRow } = await import("@/lib/checkin-coordination/nutrition-fold");
    const { NF_JSON_TYPES } = await import("@/lib/native-forms");
    expect([...NF_JSON_TYPES].sort()).toEqual(["checklist", "competitions", "multi_choice", "ranking"]);
    expect(toRow({ id: "q", label: "x", question_type: "multi_choice" }, ["a"])).toMatchObject({ value_json: ["a"] });
    expect(toRow({ id: "q", label: "x", question_type: "number" }, "182.5")).toMatchObject({ value_number: 182.5 });
    expect(toRow({ id: "q", label: "x", question_type: "number" }, { value: "82.5", unit: "kg" })).toMatchObject({ value_number: 82.5, value_json: { unit: "kg" } });
    expect(toRow({ id: "q", label: "x", question_type: "long_text" }, "")).toBeNull();
  });
});

describe("the Nutrition Update sender in SQL mirrors the decision", () => {
  const sql = readFileSync("supabase/migrations/20270403090000_nutrition_update_in_checkin.sql", "utf8");
  it("review weeks and guards match plan.ts", () => {
    expect(sql).toMatch(/'\(loss\|cut\)' THEN 4/);
    expect(sql).toMatch(/'recomp' THEN 6/);
    expect(sql).toMatch(/'\(gain\|bulk\|reverse\)' THEN 6/);
    expect(sql).toMatch(/'\(maint\|perform\)' THEN 8/);
    expect(sql).toMatch(/last_answered > local_date - 21/);
    expect(sql).toMatch(/interval '25 days'/);
    expect(sql).toMatch(/review_due > local_date \+ 7/);
    // the retired cadence column is only ever mentioned in a comment, never read
    expect(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/update_cadence/);
  });
});

describe("carrying only when the last update can carry it", () => {
  it("a required question never answered: the free meal is asked inline, anything else means the full form", async () => {
    const { foldGaps } = await import("@/lib/checkin-coordination/nutrition-fold");
    const q = (id: string, label: string, required = true, validation: Record<string, unknown> = {}) => ({ id, label, question_type: "single_choice", required, validation });
    const qs = [
      q("goal", "Goal"), q("free", "Do you want a free meal on your High Day?"), q("meals", "What should happen with the meals in your current plan?"),
      q("bw", "Current fasted bodyweight? (lbs)", true, { prefill: "bodyweight" }), q("health", "Any health conditions, injuries or medications? List them, or write none.", false),
      q("foods", "List all of your foods + preferences"),
    ];
    expect(foldGaps(qs, ["goal", "free", "foods"])).toEqual({ foldable: true, askFreeMeal: false });
    // the free meal came to the form later: asked inline (a real client's Oct 25 update)
    expect(foldGaps(qs, ["goal", "foods"])).toEqual({ foldable: true, askFreeMeal: true });
    // their foods never answered: the full form, which opens on what they did say
    expect(foldGaps(qs, ["goal", "free"]).foldable).toBe(false);
    const { nutritionSteps } = await import("@/lib/checkin-coordination/steps");
    const free = nutritionSteps({ askFreeMeal: true }).find((s) => s.key === "nu_free_meal")!;
    expect(free.showWhen!({ nu_changed: ["Nothing else changed"] })).toBe(true);
    expect(nutritionSteps({}).find((s) => s.key === "nu_free_meal")!.showWhen!({ nu_changed: ["Nothing else changed"] })).toBe(false);
  });

  it("the chat's copy of the form id is the prompts' one", async () => {
    const { NUTRITION_REQUEST_FORM_ID } = await import("@/lib/nutrition-request");
    expect(readFileSync("src/components/messages/messenger-checkin-card.tsx", "utf8")).toContain(`const NUTRITION_FORM_ID = "${NUTRITION_REQUEST_FORM_ID}"`);
  });
});
