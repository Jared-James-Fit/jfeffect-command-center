import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  clock,
  entryTime,
  flightIndex,
  readSchedule,
  timelineInputFrom,
  toMinutes,
  type TimelineInput,
} from "@/lib/competition/event-timeline";
import {
  buildChecklist,
  dueReminders,
  nextAction,
  readinessOf,
  readChecklistStates,
  type PrepFacts,
} from "@/lib/competition/prep-checklist";
import {
  infoChanges,
  mergeInfo,
  readAthleteInfo,
  splitEventPatch,
  stepsFor,
  toKg,
  travelFollowUps,
} from "@/lib/competition/athlete-info";
import {
  checkGameplan,
  diffGameplans,
  draftGameplan,
  planWarmupTimes,
  readGameplan,
} from "@/lib/competition/gameplan";
import { IPF_RULES } from "@/lib/competition/rules";
import {
  accessWindow,
  handlingStatus,
  handlingTerms,
  inviteAccess,
  inviteState,
  matchesFilter,
  paymentFromSale,
} from "@/lib/competition/handling";
import { handlingOpportunities, referrerAsk } from "@/lib/competition/opportunities";
import { meetDayView } from "@/lib/competition/meet-day-mode";
import { buildRecap } from "@/lib/competition/handling-recap";

const base = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  meetDate: "2026-12-05",
  weighInHours: 2,
  liftingStart: { value: "09:00", confirmed: true },
  weighIn: { value: null, confirmed: false },
  flight: { value: 1, confirmed: true },
  flights: { value: 2, confirmed: true },
  lifters: { value: 10, confirmed: true },
  travelMinutes: { value: 25, confirmed: true },
  ...over,
});

describe("estimated event timeline", () => {
  it("works the day out from the start time, flights and pacing", () => {
    const t = buildTimeline(base());
    const get = (k: string) => t.entries.find((e) => e.key === k)!;
    // flight A squats at the start: confirmed
    expect(get("squat_flight").at).toBe(toMinutes("09:00"));
    expect(get("squat_flight").status).toBe("confirmed");
    // opener window: 10 lifters × 70 s
    expect(get("squat_1").from).toBe(540);
    expect(get("squat_1").to).toBe(Math.round(540 + 9 * (70 / 60)));
    expect(get("squat_1").status).toBe("estimated");
    // bench starts after both flights squat and the break
    const flightDur = 3 * 10 * (70 / 60) + 3;
    expect(get("bench_flight").at).toBe(Math.round(540 + 2 * flightDur + 15));
    // a 2-hour weigh-in from a rule not confirmed for the meet stays unconfirmed
    expect(get("weigh_in").at).toBe(420);
    expect(get("weigh_in").status).toBe("unconfirmed");
    expect(get("arrive").at).toBe(400);
    expect(get("depart").at).toBe(375);
    expect(get("wake").at).toBe(300);
    expect(get("finish").at).toBe(Math.round(540 + 6 * flightDur + 30));
    expect(get("awards").status).toBe("unconfirmed");
    // entries in time order
    const times = t.entries.filter((e) => e.at != null).map((e) => e.at!);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("never invents a clock time without a start time", () => {
    const t = buildTimeline(base({ liftingStart: { value: null, confirmed: false } }));
    expect(t.entries.find((e) => e.key === "weigh_in")!.at).toBeNull();
    expect(t.entries.find((e) => e.key === "weigh_in")!.relative).toMatch(/2 hours before/);
    expect(t.entries.some((e) => e.kind === "attempt")).toBe(false);
    expect(t.missing[0]).toMatch(/start time/);
  });

  it("puts a 24-hour weigh-in on the day before", () => {
    const t = buildTimeline(base({ weighInHours: 24, weighIn: { value: "18:00", confirmed: true } }));
    const w = t.entries.find((e) => e.key === "weigh_in")!;
    expect(w.date).toBe("2026-12-04");
    expect(w.status).toBe("confirmed");
    expect(t.entries[0].key).toBe("weigh_in");
  });

  it("times each warm-up set from the opener", () => {
    const t = buildTimeline(
      base({ warmups: { squat: [{ kg: 20, reps: 5, minutesBefore: 30 }, { kg: 100, reps: 1, minutesBefore: 8 }] } }),
    );
    const op = t.entries.find((e) => e.key === "squat_1")!;
    expect(t.entries.find((e) => e.key === "squat_wu_2")!.at).toBe(op.at! - 8);
    expect(t.entries.find((e) => e.key === "squat_warmup")!.at).toBe(op.at! - 30);
    expect(t.entries.find((e) => e.key === "general_warmup")!.at).toBe(op.at! - 50);
  });

  it("keeps a confirmed time and shows a new estimate beside it", () => {
    const t = buildTimeline(base({ confirmed: { bench_flight: { at: "10:00" } } }));
    const b = t.entries.find((e) => e.key === "bench_flight")!;
    expect(b.at).toBe(600);
    expect(b.status).toBe("confirmed");
    expect(b.conflict?.estimated).toBeGreaterThan(600);
  });

  it("moves later estimates by what actually happened on the day", () => {
    const plain = buildTimeline(base());
    const late = buildTimeline(base({ progress: [{ anchor: "session", at: "09:20" }] }));
    const p = (tl: typeof plain, k: string) => tl.entries.find((e) => e.key === k)!;
    expect(late.shift).toBe(20);
    expect(p(late, "bench_flight").at).toBe(p(plain, "bench_flight").at! + 20);
    expect(p(late, "bench_flight").live).toBe(true);
    // earlier entries stay
    expect(p(late, "weigh_in").at).toBe(p(plain, "weigh_in").at);
  });

  it("reads flights, schedules and clock words", () => {
    expect(flightIndex("B")).toBe(2);
    expect(flightIndex("Flight C")).toBe(3);
    expect(flightIndex("2")).toBe(2);
    expect(flightIndex("morning")).toBeNull();
    expect(clock(13 * 60 + 5)).toBe("1:05 PM");
    expect(entryTime({ at: 540, from: 540, to: 560, relative: undefined })).toBe("9:00 – 9:20 AM");
    expect(readSchedule({ confirmed: { x: { at: "9:5" } }, progress: [{ anchor: "nope", at: "09:00" }] })).toMatchObject({ confirmed: {}, progress: [] });
    const input = timelineInputFrom({ meet_date: "2026-12-05", lifting_start: "09:00", flight: "A", schedule: { verified: { lifting_start: true } } });
    expect(input.liftingStart.confirmed).toBe(true);
    expect(input.flight).toEqual({ value: 1, confirmed: false });
  });

  it("gives another sport a start time and its logistics, no lifts", () => {
    const t = buildTimeline(base({ sport: "other", weighInHours: null }));
    expect(t.entries.some((e) => e.kind === "attempt")).toBe(false);
    expect(t.entries.find((e) => e.key === "event_start")!.at).toBe(540);
  });
});

const facts = (over: Partial<PrepFacts> = {}): PrepFacts => ({
  today: "2026-11-26",
  meetDate: "2026-12-05",
  sport: "powerlifting",
  registration: "registered",
  federation: "CPU",
  weightClass: "57",
  classLimitKg: 57,
  bodyweightKg: 56.4,
  scheduleKnown: false,
  weighInKnown: false,
  travel: "local",
  travelMinutesKnown: false,
  rackHeights: { squat: false, bench: false },
  openersSet: false,
  gameplanApproved: false,
  athleteConfirmed: false,
  warmupsConfirmed: false,
  nutritionPlanned: false,
  handled: true,
  intakeComplete: false,
  termsAccepted: false,
  payment: null,
  states: {},
  ...over,
});

describe("preparation checklist and readiness", () => {
  it("only lists what applies", () => {
    const keys = buildChecklist(facts()).map((i) => i.key);
    expect(keys).toContain("terms");
    expect(keys).not.toContain("travel"); // local
    expect(keys).not.toContain("payment"); // no price
    expect(buildChecklist(facts({ travel: "fly" })).find((i) => i.key === "travel")!.priority).toBe("critical");
    expect(buildChecklist(facts({ handled: false })).map((i) => i.key)).not.toContain("terms");
    expect(buildChecklist(facts({ sport: "other" })).map((i) => i.key)).not.toContain("openers");
  });

  it("marks what the records already show as done", () => {
    const items = buildChecklist(facts({ openersSet: true, rackHeights: { squat: true, bench: true } }));
    expect(items.find((i) => i.key === "registered")).toMatchObject({ state: "done", auto: true });
    expect(items.find((i) => i.key === "rack_heights")!.state).toBe("done");
    expect(items.find((i) => i.key === "bodyweight")!.state).toBe("done");
    const ticked = buildChecklist(facts({ states: readChecklistStates({ kit: { state: "done" }, rules: "na", bad: "x" }) }));
    expect(ticked.find((i) => i.key === "kit")!.state).toBe("done");
    expect(ticked.find((i) => i.key === "rules")!.state).toBe("na");
  });

  it("weighs readiness by importance and timing, never a percentage", () => {
    // 9 days out: membership (critical) was due Nov 21
    const r1 = readinessOf(buildChecklist(facts()), "2026-11-26");
    expect(r1.verdict).toBe("at_risk");
    expect(r1.outstanding[0].key).toBe("membership");
    // an important item late, nothing critical: needs attention
    const r0 = readinessOf(buildChecklist(facts({ states: { membership: "done" }, termsAccepted: true })), "2026-11-26");
    expect(r0.verdict).toBe("needs_attention");
    const r2 = readinessOf(buildChecklist(facts({ states: { membership: "done", kit: "done" }, intakeComplete: true })), "2026-11-20");
    expect(r2.verdict).toBe("on_track");
    // a critical item past its day: at risk, first in line
    const r3 = readinessOf(buildChecklist(facts()), "2026-12-03");
    expect(r3.verdict).toBe("at_risk");
    expect(r3.outstanding[0].priority).toBe("critical");
    const done = Object.fromEntries(buildChecklist(facts()).map((i) => [i.key, "done" as const]));
    expect(readinessOf(buildChecklist(facts({ states: done })), "2026-12-04").verdict).toBe("ready");
  });

  it("sends one reminder a day per person, only for what's open", () => {
    const items = buildChecklist(facts());
    const at9 = dueReminders({ competitionId: "c1", meetName: "Total Fortification", meetDate: "2026-12-05", items, now: { date: "2026-12-03", minutes: 9 * 60 + 5 }, athleteFirst: "Ari" });
    const athlete = at9.filter((r) => r.audience === "athlete");
    expect(athlete).toHaveLength(1);
    expect(athlete[0].key).toBe("c1:prep:2:athlete".replace("c1", "comp:c1"));
    expect(athlete[0].title).toBe("Total Fortification in 2 days");
    expect(dueReminders({ competitionId: "c1", meetName: "X", meetDate: "2026-12-05", items, now: { date: "2026-12-03", minutes: 7 * 60 } })).toHaveLength(0);
    const allDone = items.map((i) => ({ ...i, state: "done" as const }));
    expect(dueReminders({ competitionId: "c1", meetName: "X", meetDate: "2026-12-05", items: allDone, now: { date: "2026-12-03", minutes: 600 } })).toHaveLength(0);
  });

  it("reminds on the day at the timeline's times", () => {
    const tl = buildTimeline(base());
    const depart = tl.entries.find((e) => e.key === "depart")!.at!;
    const r = dueReminders({ competitionId: "c1", meetName: "X", meetDate: "2026-12-05", items: [], now: { date: "2026-12-05", minutes: depart - 20 }, timeline: tl });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ urgent: true, key: "comp:c1:md:depart:2026-12-05" });
    const na = nextAction({ readiness: readinessOf([], "2026-12-05"), today: "2026-12-05", meetDate: "2026-12-05", now: { date: "2026-12-05", minutes: depart - 20 }, timeline: tl });
    expect(na?.label).toBe("Leave for the venue");
  });
});

describe("the athlete's meet information", () => {
  it("asks only what applies", () => {
    expect(stepsFor({ sport: "powerlifting", handled: true })).toEqual(["event", "body", "lifts", "coach", "warmups", "travel", "day", "confirm"]);
    expect(stepsFor({ sport: "other", handled: false })).toEqual(["event", "coach", "travel", "day"]);
    expect(travelFollowUps({ travel: { mode: "local" } })).toEqual([]);
    expect(travelFollowUps({ travel: { mode: "fly" } })).toContain("flightDetails");
  });

  it("cleans answers and drops what doesn't read", () => {
    const i = readAthleteInfo({ bodyweightKg: "57,4", bests: { squat: 220, bench: "abc" }, attempts: { squat: [200, null, 225] }, warmupStyle: "lots", racks: { squat: { height: " 9 " } }, gear: ["Belt", "Belt", ""] });
    expect(i.bodyweightKg).toBe(57.4);
    expect(i.bests).toEqual({ squat: 220 });
    expect(i.attempts?.squat).toEqual([200, null, 225]);
    expect(i.warmupStyle).toBeUndefined();
    expect(i.racks?.squat?.height).toBe("9");
    expect(i.gear).toEqual(["Belt"]);
    expect(toKg(500, "lb")).toBeCloseTo(226.8, 1);
    expect(mergeInfo({ racks: { squat: { height: "9" } } }, { racks: { bench: { height: "5" } } }).racks).toMatchObject({ squat: { height: "9" }, bench: { height: "5" } });
  });

  it("flags changes the coach should see, not small edits", () => {
    const prev = readAthleteInfo({ bodyweightKg: 57.4, attempts: { squat: [200, 212.5, 222.5] }, nutrition: { snacks: "gummies" } });
    expect(infoChanges(prev, readAthleteInfo({ ...prev, nutrition: { snacks: "candy" } }))).toEqual([]);
    const ch = infoChanges(prev, readAthleteInfo({ ...prev, bodyweightKg: 58.1, attempts: { squat: [202.5, 212.5, 225] } }));
    expect(ch.map((c) => c.key)).toEqual(["bodyweight", "attempts_squat"]);
  });

  it("never overwrites a time the coach confirmed", () => {
    const r = splitEventPatch(
      { weigh_in_at: "07:30", location: "Winnipeg" },
      { weigh_in_at: "07:00", location: null },
      { weigh_in_at: true },
    );
    expect(r.write).toEqual({ location: "Winnipeg" });
    expect(r.proposed[0].text).toMatch(/they say 07:30, you confirmed 07:00/);
  });
});

describe("the gameplan", () => {
  const athlete = { name: "Ari Example", phone: "204-555-0100" };
  it("keeps the athlete's or their coach's attempts, never replacing them", () => {
    const g = draftGameplan({
      rules: IPF_RULES,
      info: readAthleteInfo({ attemptsBy: "my_coach", attempts: { squat: [200, 212.5, 222.5] }, warmupStyle: "fewer" }),
      athlete,
    });
    expect(g.attempts.squat).toMatchObject({ opener: 200, third: 222.5, status: "confirmed", source: "existing_coach" });
    expect(g.attempts.bench).toMatchObject({ opener: null, status: "unconfirmed" });
    expect(g.warmups.squat!.rows.at(-1)!.kg).toBeLessThan(200);
    expect(g.warmups.squat!.status).toBe("recommended");
    expect(g.warmups.bench).toBeUndefined();
  });

  it("builds attempts from what they told us when there's no plan or record", () => {
    const g = draftGameplan({ rules: IPF_RULES, info: readAthleteInfo({ targets: { deadlift: 280 } }), athlete });
    const d = g.attempts.deadlift!;
    expect(d.status).toBe("recommended");
    expect(d.third).toBeLessThanOrEqual(285);
    expect(d.opener! % 2.5).toBe(0);
    expect(checkGameplan(g, IPF_RULES).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("uses their own warm-up ladder and catches mistakes", () => {
    const g = draftGameplan({
      rules: IPF_RULES,
      info: readAthleteInfo({ attemptsBy: "me", attempts: { bench: [100, 107.5, 106] }, ownWarmups: { bench: [{ kg: 20, reps: 10 }, { kg: 60, reps: 5 }, { kg: 102, reps: 1 }] } }),
      athlete,
    });
    expect(g.warmups.bench!.source).not.toBe("athlete"); // last row over the opener: not used
    const bad = { ...g, warmups: { bench: { rows: [{ kg: 60, reps: 5, minutesBefore: null }, { kg: 100, reps: 1, minutesBefore: null }], status: "confirmed" as const, source: "athlete" as const } } };
    const problems = checkGameplan(bad, IPF_RULES).map((p) => p.text);
    expect(problems.some((t) => /rise by at least/.test(t))).toBe(true);
    expect(problems.some((t) => /at or over the opener/.test(t))).toBe(true);
    expect(planWarmupTimes(bad).bench!.map((r) => r.minutesBefore)).toEqual([11, 8]);
  });

  it("says what changed between versions and reads stored plans safely", () => {
    const a = draftGameplan({ rules: IPF_RULES, info: readAthleteInfo({ targets: { squat: 220 } }), athlete });
    const b = readGameplan(JSON.parse(JSON.stringify(a)));
    b.attempts.squat = { ...b.attempts.squat!, third: 225 };
    b.equipment.racks.squat = { height: "9", safety: "6" };
    const d = diffGameplans(a, b).map((c) => c.text);
    expect(d.some((t) => /Squat attempts .* → .*225/.test(t))).toBe(true);
    expect(d).toContain("Squat rack Height 9 · safeties 6");
    expect(readGameplan({ attempts: { squat: { opener: "x" } }, contacts: [{ name: "" }] })).toMatchObject({ contacts: [] });
  });
});

describe("the handling service", () => {
  it("follows what happened", () => {
    const b = { infoStarted: false, infoComplete: false, termsAccepted: false, planApproved: false, athleteConfirmed: false, openCritical: 3 };
    expect(handlingStatus(b)).toBe("invited");
    expect(handlingStatus({ ...b, invite_opened_at: "x" })).toBe("onboarding");
    expect(handlingStatus({ ...b, infoStarted: true, infoComplete: true, termsAccepted: true })).toBe("preparing");
    expect(handlingStatus({ ...b, infoStarted: true, infoComplete: true, termsAccepted: true, planApproved: true, athleteConfirmed: true, openCritical: 0 })).toBe("ready");
    expect(handlingStatus({ ...b, competitionStatus: "completed" })).toBe("completed");
    expect(handlingStatus({ ...b, cancelled_at: "x", competitionStatus: "completed" })).toBe("cancelled");
    expect(matchesFilter("ready", "active")).toBe(true);
    expect(matchesFilter("completed", "active")).toBe(false);
  });

  it("reads payment from the sale", () => {
    expect(paymentFromSale("link", { amount_paid_cents: 15000, amount_outstanding_cents: 0 })).toBe("paid");
    expect(paymentFromSale("link", { amount_paid_cents: 0, amount_outstanding_cents: 15000 })).toBe("link");
    expect(paymentFromSale("waived", { amount_paid_cents: 0 })).toBe("waived");
    expect(paymentFromSale("paid", { amount_paid_cents: 15000, amount_refunded_cents: 15000 })).toBe("refunded");
  });

  it("gives the handler a temporary window and decides who the link is for", () => {
    expect(accessWindow("2026-12-05", "2026-11-26")).toEqual({ starts: "2026-11-21", ends: "2026-12-12" });
    expect(accessWindow("2026-12-05", "2026-11-01").starts).toBe("2026-11-01");
    const base2 = { viewerIsStaff: false, athleteClientId: "a", athleteHasLogin: false, placeholder: true };
    expect(inviteAccess({ ...base2, viewerClientId: "a" })).toBe("continue");
    expect(inviteAccess({ ...base2, viewerClientId: null })).toBe("set_up");
    expect(inviteAccess({ ...base2, viewerClientId: null, athleteHasLogin: true })).toBe("sign_in");
    expect(inviteAccess({ ...base2, viewerClientId: "b" })).toBe("other");
    expect(inviteAccess({ ...base2, viewerClientId: "b", placeholder: false })).toBe("not_yours");
    expect(inviteState({ invite_expires_at: "2000-01-01T00:00:00Z" })).toBe("expired");
    expect(inviteState({ invite_revoked_at: "x" })).toBe("revoked");
    expect(handlingTerms({ handler: "Jared", meetName: "Total Fortification", priceText: "$150" })).toMatch(/Your own coach keeps your training/);
  });
});

// The production meeting (Nov 25 2026), trimmed to what the detector reads.
const SHAINA = {
  summary:
    "Shaina and Jared reviewed final meet expectations for Total Fortification on Dec 5. Shaina asked Jared to handle Ari in the same flight, and Jared said he can do it if Shaina sends Ari’s full brief and numbers, with a possible second helper involved.",
  items: [
    { kind: "goal", text: "Shaina is thinking her squat third attempt will be around 220 to 225.", quote: "basically for squats, I think I'm gonna hit 222 25", speaker: "athlete" },
    { kind: "agreement", text: "Jared agreed he can handle Ari at the meet, though he wants the full information first.", quote: "no, it's not too much. I'm literally gonna be there anyways", speaker: "coach" },
    { kind: "athlete_commitment", text: "Shaina will send Jared Ari’s numbers and meet scenarios.", quote: "I have everything written down, though. I can send it to you", speaker: "athlete" },
    { kind: "coach_commitment", text: "Jared may bring another person to help with handling logistics if needed.", quote: "I could even get like someone to help", speaker: "coach" },
  ],
  followUp: { when: "After Shaina sends Ari's brief, and before 2026-12-05", why: "Confirm Ari handling logistics" },
};

describe("service opportunities in a meeting", () => {
  it("finds the handling Shaina asked for, and nothing it wasn't told", () => {
    const ops = handlingOpportunities({
      sessionId: "s1",
      referrer: { clientId: "shaina", name: "Shaina Sagar", first: "Shaina" },
      coachFirst: "Jared",
      analysis: SHAINA,
      event: { kind: "competition", title: "Total Fortification", date: "2026-12-05", competitionId: "c1" },
    });
    expect(ops).toHaveLength(1);
    const o = ops[0];
    expect(o.athleteName).toBe("Ari");
    expect(o.competition).toMatchObject({ name: "Total Fortification", date: "2026-12-05" });
    expect(o.waitingOn).toEqual(["Shaina will send Jared Ari’s numbers and meet scenarios."]);
    expect(o.existingCoachGuess).toBe("Shaina Sagar");
    expect(o.missing).toContain("Last name");
    expect(o.missing).toContain("Email or phone to send the link");
    expect(o.missing).not.toContain("Their numbers (recent lifts, targets)");
    // once invited, it isn't offered again
    expect(handlingOpportunities({ sessionId: "s1", referrer: { clientId: "shaina", name: "Shaina Sagar", first: "Shaina" }, analysis: SHAINA, alreadyInvited: ["ari"] })).toEqual([]);
    expect(referrerAsk({ referrerFirst: "Shaina", athleteFirst: "Ari", meetName: "Total Fortification" })).toMatch(/send me Ari's numbers/);
  });

  it("reads nothing into a meeting that didn't mention handling anyone", () => {
    expect(
      handlingOpportunities({ sessionId: "s2", referrer: { clientId: "x", name: "Nicole Yusi", first: "Nicole" }, analysis: { summary: "We talked about her squat.", items: [] } }),
    ).toEqual([]);
  });
});

describe("meet-day mode", () => {
  it("says the stage, the lift, what's next and the next warm-up", () => {
    const plan = draftGameplan({
      rules: IPF_RULES,
      info: readAthleteInfo({ attemptsBy: "me", attempts: { squat: [200, 212.5, 222.5] }, racks: { squat: { height: "9", safety: "6" } } }),
      athlete: { name: "Ari" },
    });
    const tl = buildTimeline(base({ warmups: planWarmupTimes(plan), attempts: { squat: [200, 212.5, 222.5] } }));
    const v0 = meetDayView({ timeline: tl, plan, now: { date: "2026-12-05", minutes: 6 * 60 } });
    expect(v0.stage).toBe("before");
    expect(v0.next?.key).toBe("depart");
    const firstSet = tl.entries.find((e) => e.key === "squat_wu_1")!;
    const v1 = meetDayView({ timeline: tl, plan, now: { date: "2026-12-05", minutes: firstSet.at! - 1 } });
    expect(v1.nextWarmup).toMatchObject({ kg: plan.warmups.squat!.rows[0].kg, index: 1 });
    expect(v1.rack).toBe("Height 9 · safeties 6");
    const v2 = meetDayView({
      timeline: tl,
      plan,
      now: { date: "2026-12-05", minutes: 560 },
      logged: [{ lift: "squat", attempt: 1, kg: 200, result: "good" }],
    });
    expect(v2.stage).toBe("squat");
    expect(v2.attempts.map((a) => a.result)).toEqual(["good", "planned", "planned"]);
    expect(v2.attempts[1].kg).toBe(212.5);
  });
});

describe("after the meet", () => {
  it("compares the results to the targets and offers, never enrolls", () => {
    const r = buildRecap({
      first: "Ari",
      meetName: "Total Fortification",
      results: { squat: 225, bench: 110, deadlift: 270, total: 605, place: "2", bodyweight: 56.9, source: "manual", attempts: { s: [200, 212.5, 225], b: [100, 107.5, -112.5], d: [250, 262.5, 270] } },
      info: readAthleteInfo({ targets: { squat: 222.5, bench: 115, deadlift: 280 } }),
      plan: null,
      account: { tier: "self_serve", hasLogin: true },
    });
    expect(r.madeAll).toBe(8);
    expect(r.takenAll).toBe(9);
    expect(r.highlights[0]).toMatch(/on or over the 222.5 kg target/);
    expect(r.highlights[1]).toMatch(/5 kg short/);
    expect(r.offers).toEqual(["coaching", "handling"]);
    expect(r.message).toMatch(/605 kg total, 8 for 9/);
  });
});
