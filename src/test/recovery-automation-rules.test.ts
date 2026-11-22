import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autoMessageProblems,
  classifyRecovery,
  effectiveMode,
  followUpStillRelevant,
  localToInstant,
  modeAllowed,
  planFollowUp,
  routeItem,
} from "@/lib/recovery-automation/rules";
import { CAPABILITY_FEATURES, capabilityLevel, grantable, levelOfFeature, readCapabilities } from "@/lib/cleo-capabilities";
import type { PainArea, PainEntry } from "@/lib/pain/history";
import type { RedFlag } from "@/lib/pain/safety";

const entry = (p: Partial<PainEntry>): PainEntry => ({
  id: "r1", stored: true, date: "2026-11-22", at: "2026-11-22T18:00:00Z", source: "review", feedbackId: "f1", dayId: null,
  region: "knee", side: "L", site: null, severity: "mild", score: 3, timing: ["during"], trigger: "training", exerciseName: null,
  feel: ["sore"], impact: null, sameIssue: null, change: null, continuesId: null, note: null, inferred: false, ...p,
});
const area = (region: string, reasons: PainArea["reasons"]): PainArea => ({ region, reasons } as PainArea);
const flag = (urgent: boolean): RedFlag => ({ key: "x", area: "Low back", date: "2026-11-22", text: "…", urgent });

describe("risk", () => {
  it("a mild, one-off report is routine", () => {
    expect(classifyRecovery([entry({})], [], [])).toEqual({ risk: "routine", reasons: [] });
    expect(classifyRecovery([entry({ score: 5, severity: "moderate" })], [area("knee", [])], [])).toEqual({ risk: "routine", reasons: [] });
  });

  it("anything that could be an injury needs the coach", () => {
    expect(classifyRecovery([entry({ score: 6, severity: "moderate" })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({ impact: "stopped" })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({ change: "worse", sameIssue: true })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({ feel: ["pop"] })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({ feel: ["swollen"] })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({ region: "other", side: null })], [], []).risk).toBe("review");
    expect(classifyRecovery([entry({})], [area("knee", ["persistent"])], []).reasons).toContain("persistent");
    expect(classifyRecovery([entry({})], [], [flag(false)]).risk).toBe("review");
  });

  it("history for another region doesn't count", () => {
    expect(classifyRecovery([entry({})], [area("shoulder", ["persistent"])], []).risk).toBe("routine");
  });

  it("an urgent warning sign is urgent", () => {
    expect(classifyRecovery([entry({ region: "low_back", feel: ["numb"] })], [], [flag(true)]).risk).toBe("urgent");
  });

  it("only routine ever goes out by itself", () => {
    expect(routeItem("automatic", "routine")).toBe("send");
    expect(routeItem("automatic", "review")).toBe("awaiting_approval");
    expect(routeItem("automatic", "urgent")).toBe("awaiting_approval");
    expect(routeItem("approval", "routine")).toBe("awaiting_approval");
    expect(routeItem("manual", "routine")).toBe("draft");
    expect(routeItem("manual", "urgent")).toBe("awaiting_approval");
    expect(routeItem("off", "routine")).toBe("off");
  });
});

describe("modes follow the capability", () => {
  const owner = CAPABILITY_FEATURES.map((f) => f.key);
  const assist = ["assist.recovery_analysis", "assist.message_drafts", "assist.program_suggestions"];
  const queueOnly = [...assist, "automation.approval_queue"];

  it("assist allows nothing automated", () => {
    expect(modeAllowed(assist, "recovery_reply", "manual")).toBe(false);
    expect(modeAllowed(assist, "recovery_reply", "off")).toBe(true);
  });

  it("automatic needs auto-send; follow-ups need follow-ups", () => {
    expect(modeAllowed(queueOnly, "recovery_reply", "approval")).toBe(true);
    expect(modeAllowed(queueOnly, "recovery_reply", "automatic")).toBe(false);
    expect(modeAllowed(queueOnly, "recovery_follow_up", "approval")).toBe(false);
    expect(modeAllowed(owner, "recovery_follow_up", "automatic")).toBe(true);
  });

  it("the default is approval, a client's rule beats the setting, pause stops it, a lapsed level steps down", () => {
    expect(effectiveMode({ features: owner, category: "recovery_reply", paused: false, setting: null, clientRule: null })).toBe("approval");
    expect(effectiveMode({ features: owner, category: "recovery_reply", paused: false, setting: "automatic", clientRule: "off" })).toBe("off");
    expect(effectiveMode({ features: owner, category: "recovery_reply", paused: true, setting: "automatic", clientRule: null })).toBe("off");
    expect(effectiveMode({ features: queueOnly, category: "recovery_reply", paused: false, setting: "automatic", clientRule: null })).toBe("approval");
    expect(effectiveMode({ features: assist, category: "recovery_reply", paused: false, setting: "automatic", clientRule: null })).toBe("off");
  });
});

describe("an automatic message never claims more than happened", () => {
  it("never says the coach looked at it or changed the program", () => {
    expect(autoMessageProblems("hey man just saw your shoulder was bothering you")).toContain("just saw");
    expect(autoMessageProblems("I looked at your report")).not.toEqual([]);
    expect(autoMessageProblems("I've adjusted your bench for next week")).not.toEqual([]);
    expect(autoMessageProblems("I'll change the pressing")).not.toEqual([]);
    expect(autoMessageProblems("your program has been updated")).not.toEqual([]);
  });

  it("keeps the pain-draft rules (no diagnosis, no medication)", () => {
    expect(autoMessageProblems("sounds like tendinitis, take some ibuprofen")).toEqual(expect.arrayContaining(["tendinitis", "ibuprofen"]));
  });

  it("a plain, honest check-in is fine", () => {
    expect(autoMessageProblems("thanks for flagging the shoulder. where in the bench does it pinch, the bottom or the lockout? we'll go from there")).toEqual([]);
  });
});

describe("follow-ups", () => {
  const sessions = [
    { date: "2026-11-24", title: "Lower A", loads: false, exercises: ["Competition Squat"] },
    { date: "2026-11-25", title: "Upper A", loads: true, exercises: ["Competition Bench Press"] },
    { date: "2026-11-27", title: "Upper B", loads: true, exercises: ["Overhead Press"] },
  ];

  it("training-aware: the evening before the next session that loads it, in their time (Manitoba UTC-5)", () => {
    const f = planFollowUp({ after: new Date("2026-11-22T19:00:00Z"), today: "2026-11-22", tz: "America/Winnipeg", trainingAware: true, sessions })!;
    expect(f.dueAt.toISOString()).toBe("2026-11-24T23:00:00.000Z");
    expect(f.session?.title).toBe("Upper A");
  });

  it("training-aware: none when the next loading session is tomorrow (the reply covers it) or nothing loads it soon", () => {
    expect(planFollowUp({ after: new Date("2026-11-22T19:00:00Z"), today: "2026-11-22", tz: "America/Winnipeg", trainingAware: true, sessions: [{ date: "2026-11-23", title: "Upper", loads: true, exercises: [] }] })).toBeNull();
    expect(planFollowUp({ after: new Date("2026-11-22T19:00:00Z"), today: "2026-11-22", tz: "America/Winnipeg", trainingAware: true, sessions: [{ date: "2026-12-10", title: "Upper", loads: true, exercises: [] }] })).toBeNull();
  });

  it("fixed (a paid plan without the owner's timing): three days later at 10:00", () => {
    const f = planFollowUp({ after: new Date("2026-11-22T19:00:00Z"), today: "2026-11-22", tz: "America/Toronto", trainingAware: false, sessions })!;
    expect(f.dueAt.toISOString()).toBe("2026-11-25T15:00:00.000Z");
    expect(f.session).toBeNull();
  });

  it("local times honour a zone's clock change", () => {
    expect(localToInstant("2026-07-01", 18 * 60, "America/Toronto").toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(localToInstant("2026-12-01", 18 * 60, "America/Toronto").toISOString()).toBe("2026-12-01T23:00:00.000Z");
    expect(localToInstant("2026-12-01", 18 * 60, "America/Regina").toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });

  it("stops once they report that area again, asks first once the coach has written himself", () => {
    const base = { regions: ["shoulder"], replyAt: "2026-11-22T20:00:00Z", laterReports: [], coachWroteSince: false, clientActive: true };
    expect(followUpStillRelevant(base)).toBe("send");
    expect(followUpStillRelevant({ ...base, laterReports: [{ region: "shoulder", at: "2026-11-23T20:00:00Z" }] })).toBe("cancel");
    expect(followUpStillRelevant({ ...base, laterReports: [{ region: "knee", at: "2026-11-23T20:00:00Z" }] })).toBe("send");
    expect(followUpStillRelevant({ ...base, coachWroteSince: true })).toBe("ask");
    expect(followUpStillRelevant({ ...base, clientActive: false })).toBe("cancel");
  });
});

describe("capability levels", () => {
  it("mirror the migration's catalog exactly", () => {
    const sql = readFileSync("supabase/migrations/20270509100000_cleo_capabilities_recovery_automation.sql", "utf8");
    const seeded = [...sql.matchAll(/\('((?:assist|automation|owner)\.[a-z_]+)', '(assist|automation|owner)'/g)].map((m) => [m[1], m[2]]);
    expect(seeded).toEqual(CAPABILITY_FEATURES.map((f) => [f.key, f.level]));
  });

  it("an owner capability is never grantable", () => {
    for (const f of CAPABILITY_FEATURES) expect(grantable(f.key)).toBe(f.level !== "owner");
    expect(levelOfFeature("owner.voice")).toBe("owner");
    expect(grantable("made.up")).toBe(false);
  });

  it("every paid capability together is still below the owner", () => {
    const paid = CAPABILITY_FEATURES.filter((f) => grantable(f.key)).map((f) => f.key);
    expect(capabilityLevel(paid)).toBe("automation");
    expect(capabilityLevel(CAPABILITY_FEATURES.map((f) => f.key))).toBe("owner");
    expect(capabilityLevel([])).toBe("none");
    expect(readCapabilities({ level: "owner", features: ["assist.message_drafts"] }).level).toBe("assist");
  });
});
