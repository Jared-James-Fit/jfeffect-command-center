import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  digestLines,
  isNudgeable,
  nutritionSendsToday,
  planCheckin,
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

  it("a powerlifter making weight gets the weight-making question, plus photos and the tape every 4 weeks", () => {
    const p = planCheckin(base({ meet: { date: "2027-01-10", weightClass: "83", name: "Provincials" } }));
    expect(keys(p)).toEqual(["weight_making", "photos", "measurements"]);
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

  it("a Nutrition Update waiting is pointed at from the check-in, not reminded again", () => {
    const p = planCheckin(base({ nutritionPendingSince: "2026-11-16" }));
    expect(keys(p)).toEqual(["nutrition_update"]);
    expect(p.extras[0].reason).toMatch(/no separate reminder/);
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
      "photos_added",
      "measurements_added",
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

describe("the monthly Nutrition Update goes with the weekly check-in", () => {
  it("in the month's last 7 days, the morning that week's card goes out; never the week before", () => {
    expect(nutritionSendsToday({ today: "2026-11-27", weeklyCardToday: true, weeklyCardDueThisWindow: true, lastMonday: "2026-11-30" })).toBe(true);
    expect(nutritionSendsToday({ today: "2026-11-23", weeklyCardToday: false, weeklyCardDueThisWindow: true, lastMonday: "2026-11-23" })).toBe(false);
    expect(nutritionSendsToday({ today: "2026-11-20", weeklyCardToday: true, weeklyCardDueThisWindow: false, lastMonday: "2026-11-30" })).toBe(false);
  });

  it("no weekly check-in in the window: the last Monday, as before", () => {
    expect(nutritionSendsToday({ today: "2026-11-30", weeklyCardToday: false, weeklyCardDueThisWindow: false, lastMonday: "2026-11-30" })).toBe(true);
    expect(nutritionSendsToday({ today: "2026-11-26", weeklyCardToday: false, weeklyCardDueThisWindow: false, lastMonday: "2026-11-30" })).toBe(false);
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
