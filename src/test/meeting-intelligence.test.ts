import { describe, expect, it } from "vitest";
import {
  agendaChanges,
  applyAgendaOp,
  buildSessionPrep,
  mergeAgenda,
  normalizeAgenda,
  planAgenda,
  type SessionPrepInput,
} from "@/lib/coaching-sessions/prepare";
import { athleteView, draftGamePlan } from "@/lib/coaching-sessions/presentation";
import { ambiguousLoads, unitCheckLine } from "@/lib/coaching-sessions/units";
import { organizeOutcome, recStatus, workSummary } from "@/lib/coaching-sessions/outcomes";
import { coverageRead } from "@/lib/coaching-sessions/coverage";
import {
  appointmentState,
  canJoin,
  confirmationDue,
  meetingReadiness,
  soonWords,
} from "@/lib/coaching-sessions/lifecycle";
import { sameIdea } from "@/lib/coaching-sessions/analysis";

const TODAY = "2026-11-25";

/** A made-up 66 kg lifter, a meet on Dec 9, with a full record. */
const complete: SessionPrepInput = {
  today: TODAY,
  topics: null,
  bookingNote: null,
  workouts: { planned: 12, done: 12, missed: 0, lastDone: "2026-11-24", avgRating: 4.4 },
  bodyweight: {
    unit: "kg",
    latestKg: 67.1,
    latestDate: "2026-11-24",
    avg7Kg: 67.3,
    weeklyChangeKg: -0.4,
    goalKg: 66,
    goalDate: "2026-12-08",
    stale: false,
  },
  checkins: {
    count: 4,
    latest: "2026-11-22",
    adherence: 4.5,
    poorSleep: 0,
    lowEnergy: 0,
    stress: 0,
  },
  nutrition: { phase: "Fat loss", kcalLow: 2100, kcalHigh: 2300, since: "2026-11-01" },
  pain: [],
  weightRead: null,
  previous: null,
  calls: null,
  event: null,
  competition: null,
  commitments: [],
  intelligence: [],
  coachNotes: null,
  coachPriorities: [],
  answers: {},
  firstName: "Sam",
  unit: "kg",
} as SessionPrepInput;

const allText = (p: ReturnType<typeof buildSessionPrep>) =>
  [
    p.connect,
    p.goingWell,
    p.observations,
    p.improve,
    p.recommendations,
    p.athleteNeeds,
    p.coachNeeds,
    p.clientActions,
    p.coachActions,
    p.clarify,
    p.missing,
  ]
    .flat()
    .map((i) => `${i.text} ${i.say ?? ""} ${i.detail ?? ""}`)
    .join(" | ");

describe("preparation never depends on what the client sends", () => {
  it("complete records: wins, a direction and an objective with no answers at all", () => {
    const p = buildSessionPrep(complete);
    expect(p.goingWell.length).toBeGreaterThan(0);
    expect(p.recommendations.length).toBeGreaterThan(0);
    expect(p.objective.length).toBeGreaterThan(5);
    const a = planAgenda(p, { firstName: "Sam" });
    // a full meeting: something to recognize, something to coach, a close
    expect(a.sections.map((s) => s.key)).toEqual(
      expect.arrayContaining(["connect", "recognize", "coach", "align"]),
    );
  });

  it("partial records: unlogged training is never called missed, and it's asked once", () => {
    const p = buildSessionPrep({
      ...complete,
      workouts: { planned: 12, done: 6, missed: 6, lastDone: "2026-11-18", avgRating: 3.9 },
    });
    // never a claim that sessions were missed (the plan can say unlogged isn't missed)
    expect(allText(p)).not.toMatch(
      /\bmissed (\d|workouts?|sessions?)|\d+ (planned )?(workouts|sessions) (were )?missed/i,
    );
    expect(allText(p)).toMatch(/no log|nothing logged/i);
    expect(p.clarify.some((c) => /unlogged|logged/i.test(c.text))).toBe(true);
    expect(p.clientActions.some((c) => /log/i.test(c.text))).toBe(true);
  });

  it("nothing on file: still a complete plan, with what's missing named and nothing invented", () => {
    const p = buildSessionPrep({
      ...complete,
      workouts: null,
      bodyweight: null,
      checkins: null,
      nutrition: null,
    } as any);
    expect(p.missing.length).toBeGreaterThan(0);
    const a = planAgenda(p, { firstName: "Sam" });
    expect(a.sections.length).toBeGreaterThanOrEqual(3);
    expect(a.objective.length).toBeGreaterThan(5);
    // no numbers that weren't in the input
    expect(allText(p)).not.toMatch(/\b\d+ of \d+ planned/);
  });

  it("outdated data: an old weigh-in is a thing to clarify, never a trend", () => {
    const p = buildSessionPrep({
      ...complete,
      bodyweight: { ...complete.bodyweight!, latestDate: "2026-10-20", stale: true },
    });
    expect(p.clarify.some((c) => /weigh-in is old/i.test(c.text))).toBe(true);
    expect(allText(p)).not.toMatch(/on pace|ahead of pace|behind pace/i);
  });

  it("contradictory records: a meet date that disagrees is to confirm, not a guess", () => {
    const event = {
      key: "c1",
      kind: "competition",
      title: "Westerns",
      date: "2026-12-09",
      daysOut: 14,
      phase: "Peak",
      weightClass: "66",
      source: "Competition",
      conflicts: ["The meet prep says Dec 9, the competition says Dec 10"],
      competitionId: "c1",
      prepId: "p1",
    } as any;
    const p = buildSessionPrep({ ...complete, event });
    expect(p.clarify.some((c) => /Dec 9.*Dec 10/.test(c.text))).toBe(true);
  });

  it("the client's own words lead what they need; the coach's priority stays private", () => {
    const p = buildSessionPrep({
      ...complete,
      topics: "Nervous about the deadlift opener",
      coachPriorities: ["Talk about the cut stalling"],
    });
    expect(p.athleteNeeds[0]).toMatchObject({ source: "athlete" });
    const a = planAgenda(p, { firstName: "Sam" });
    if (a.objectivePrivate) expect(JSON.stringify(athleteView(a))).not.toContain("cut stalling");
  });
});

describe("the plan refreshes without losing the coach's work", () => {
  const now = "2026-11-25T10:00:00Z";
  const later = "2026-11-25T18:00:00Z";
  it("edits, skips and the coach's own points survive a refresh; new points are marked", () => {
    let mine = mergeAgenda(null, planAgenda(buildSessionPrep(complete), { firstName: "Sam" }), now);
    const first = mine.sections.find((s) => s.key === "recognize")!.items[0]!;
    mine = applyAgendaOp(
      mine,
      { op: "edit", id: first.id, say: "Twelve for twelve. That's the standard." },
      now,
    );
    mine = applyAgendaOp(
      mine,
      {
        op: "add",
        section: "coach",
        id: "custom:openers",
        text: "Talk openers",
        kind: "statement",
      } as any,
      now,
    );
    const fresh = planAgenda(
      buildSessionPrep({ ...complete, topics: "Can we talk about my squat depth?" }),
      { firstName: "Sam" },
    );
    const merged = mergeAgenda(mine, fresh, later);
    const all = merged.sections.flatMap((s) => s.items);
    expect(all.find((i) => i.id === first.id)?.say).toBe("Twelve for twelve. That's the standard.");
    expect(all.some((i) => i.id === "custom:openers")).toBe(true);
    const added = all.filter((i) => i.addedAt === later);
    expect(added.some((i) => /squat depth/i.test(i.text))).toBe(true);
    expect(agendaChanges(mine, merged).length).toBeGreaterThan(0);
  });

  it("an unchanged record changes nothing", () => {
    const a = mergeAgenda(null, planAgenda(buildSessionPrep(complete), { firstName: "Sam" }), now);
    const again = mergeAgenda(
      a,
      planAgenda(buildSessionPrep(complete), { firstName: "Sam" }),
      later,
    );
    expect(agendaChanges(a, again)).toEqual([]);
  });

  it("moving, re-sectioning and hiding a point from the shared screen", () => {
    let a = mergeAgenda(null, planAgenda(buildSessionPrep(complete), { firstName: "Sam" }), now);
    const coach = a.sections.find((s) => s.key === "coach")!;
    const p = coach.items[0]!;
    a = applyAgendaOp(a, { op: "share", id: p.id, share: false }, now);
    expect(JSON.stringify(athleteView(a))).not.toContain(p.text);
    a = applyAgendaOp(a, { op: "section", id: p.id, to: "execute" }, now);
    expect(a.sections.find((s) => s.key === "execute")?.items.some((i) => i.id === p.id)).toBe(
      true,
    );
    a = applyAgendaOp(a, { op: "objective", text: "Leave with the openers set" }, now);
    expect(a.objective).toBe("Leave with the openers set");
    expect(normalizeAgenda(a)?.version).toBe(2);
  });

  it("the recap is drafted from what was decided and who does what", () => {
    const a = planAgenda(buildSessionPrep(complete), { firstName: "Sam" });
    const plan = draftGamePlan(
      a,
      ["Openers: 150 / 100 / 200"],
      [{ owner: "athlete", text: "Send the third squat on video", status: "open" } as any],
    );
    expect(JSON.stringify(plan)).toContain("Openers: 150 / 100 / 200");
    expect(JSON.stringify(plan)).toContain("Send the third squat on video");
  });
});

describe("loads are confirmed in kg or lb before they're used", () => {
  it("a bare number near a lift or an attempt is flagged; a percentage, reps or a class never", () => {
    const t = "Let's open at 150 on squat. Last week was 3x5 at 80% and she's in the 66 kg class.";
    const c = ambiguousLoads(t, "kg");
    expect(c.map((x) => x.value)).toEqual([150]);
    expect(unitCheckLine(c[0]!, "kg")).toMatch(/kg or lb\?/);
  });
  it("a load said in the other unit is flagged; in their own unit it's fine", () => {
    expect(ambiguousLoads("He hit 405 lbs on deadlift", "kg")[0]).toMatchObject({
      issue: "other",
      said: "lb",
    });
    expect(ambiguousLoads("He hit 182.5 kg on deadlift", "kg")).toEqual([]);
  });
  it("meet-only reads only flag attempts", () => {
    expect(ambiguousLoads("Squat went 140 for a double today", "kg", { meetOnly: true })).toEqual(
      [],
    );
    expect(ambiguousLoads("Second attempt 145 on squat", "kg", { meetOnly: true })).toHaveLength(1);
  });
});

describe("after the meeting: outcome and honest statuses", () => {
  it("approval is never reported as applied", () => {
    expect(recStatus({ status: "proposed" })).toBe("suggested");
    expect(recStatus({ status: "proposed", flags: ["Confirm kg or lb"] })).toBe("needs_review");
    expect(recStatus({ status: "approved" })).toBe("approved");
    expect(recStatus({ status: "edited", applied_at: "2026-11-25T12:00:00Z" })).toBe("applied");
    expect(recStatus({ status: "kept" })).toBe("kept");
    expect(recStatus({ status: "deferred" })).toBe("later");
    expect(recStatus({ status: "rejected" })).toBe("dismissed");
  });
  it("the outcome keeps floated ideas apart from decisions, and loads to confirm as open", () => {
    const o = organizeOutcome({
      analysis: {
        summary: "x",
        items: [
          {
            kind: "agreement",
            text: "Openers at 150 / 100 / 200",
            quote: "let's go 150",
            basis: "confirmed",
          },
          {
            kind: "tentative",
            text: "Maybe drop to 63",
            quote: "maybe 63 next year",
            basis: "tentative",
          },
          {
            kind: "feedback",
            text: "Squat depth looked good",
            quote: "depth was great",
            basis: "confirmed",
          },
        ],
        recommendations: [],
        intelligence: [],
        unitChecks: ["150 was said with no unit"],
      } as any,
      decisions: ["Openers at 150 / 100 / 200"],
      commitments: [{ owner: "athlete", text: "Send the video", status: "open", confirmed: true }],
    });
    expect(o.decisions).toHaveLength(1);
    expect(o.floated.map((f) => f.text)).toEqual(["Maybe drop to 63"]);
    expect(o.concerns.map((c) => c.text)).toContain("150 was said with no unit");
    expect(o.clientDoes.map((c) => c.text)).toEqual(["Send the video"]);
  });
  it("the work summary says what Cleo did and only what's left for the coach", () => {
    const w = workSummary({
      analysisReady: true,
      source: "recording",
      recs: [
        { status: "proposed" },
        { status: "approved" },
        { status: "approved", applied_at: "x" },
      ],
      memories: [{ status: "confirmed", auto_kept: true }, { status: "proposed" }],
      commitmentsProposed: 1,
      recapSent: false,
      unitChecks: 1,
      speakersToConfirm: 1,
    });
    expect(w.did.join(" ")).toMatch(/Read the recording/);
    expect(w.needs.join(" ")).toMatch(/1 recommendation to decide/);
    expect(w.needs.join(" ")).toMatch(/approved, not applied|to apply/i);
  });
  it("a repeated recommendation is the same idea", () => {
    expect(
      sameIdea("Add a fourth training day on Saturdays", "add a 4th training day saturday"),
    ).toBe(true);
    expect(sameIdea("Add a fourth training day", "Lower calories by 150")).toBe(false);
  });
});

describe("what sounds covered while it's recorded", () => {
  it("a point is covered once most of its words were said; important ones not heard are flagged after their stage", () => {
    const a = planAgenda(
      buildSessionPrep({
        ...complete,
        workouts: { planned: 12, done: 6, missed: 6, lastDone: "2026-11-18", avgRating: 3.9 },
      }),
      { firstName: "Sam" },
    );
    const win = a.sections.find((s) => s.key === "recognize" || s.key === "evaluate")!.items[0]!;
    const r = coverageRead(a, `Coach: ${win.text}`, 2);
    expect(r.covered).toContain(win.id);
    const late = coverageRead(a, "Coach: hello there", a.minutes + 1);
    expect(late.overlooked.length).toBeGreaterThan(0);
    expect(late.overlooked.length).toBeLessThanOrEqual(3);
  });
});

describe("one appointment lifecycle", () => {
  const start = "2026-11-26T21:00:00Z";
  it("reads each state, a change request over a confirmation", () => {
    expect(appointmentState({ status: "Scheduled", startsAt: start })).toBe("scheduled");
    expect(
      appointmentState({ status: "Scheduled", startsAt: start, confirmationRequestedAt: "x" }),
    ).toBe("awaiting_confirmation");
    expect(appointmentState({ status: "Scheduled", startsAt: start, clientConfirmedAt: "x" })).toBe(
      "confirmed",
    );
    expect(appointmentState({ status: "Scheduled", startsAt: start, bookedByClient: true })).toBe(
      "confirmed",
    );
    expect(
      appointmentState({
        status: "Scheduled",
        startsAt: start,
        clientConfirmedAt: "x",
        pendingChange: "move",
      }),
    ).toBe("reschedule_requested");
    expect(appointmentState({ status: "Rescheduled", startsAt: start })).toBe("cancelled");
    expect(appointmentState({ status: "Completed", startsAt: start })).toBe("completed");
    expect(appointmentState({ status: "Missed", startsAt: start })).toBe("no_show");
  });
  it("the confirmation request goes a day out, once, never for a late booking or one they chose", () => {
    const base = {
      status: "Scheduled",
      startsAt: start,
      createdAt: "2026-11-20T15:00:00Z",
      timeSetAt: null,
      clientConfirmedAt: null,
      confirmationRequestedAt: null,
      bookedByClient: false,
      hasApp: true,
      visibleToClient: true,
    };
    const at = (h: number) => new Date(Date.parse(start) - h * 3_600_000);
    expect(confirmationDue(base, at(25))).toBe(false);
    expect(confirmationDue(base, at(24))).toBe(true);
    expect(confirmationDue(base, at(2))).toBe(false);
    expect(confirmationDue({ ...base, confirmationRequestedAt: "x" }, at(20))).toBe(false);
    expect(confirmationDue({ ...base, bookedByClient: true }, at(20))).toBe(false);
    expect(confirmationDue({ ...base, createdAt: at(10).toISOString() }, at(9))).toBe(false);
    expect(confirmationDue({ ...base, hasApp: false }, at(20))).toBe(false);
  });
  it("Join from 15 minutes before to the end, and how soon in words", () => {
    const end = "2026-11-26T21:30:00Z";
    expect(canJoin(start, end, new Date(Date.parse(start) - 20 * 60_000), "https://meet")).toBe(
      false,
    );
    expect(canJoin(start, end, new Date(Date.parse(start) - 10 * 60_000), "https://meet")).toBe(
      true,
    );
    expect(canJoin(start, end, new Date(Date.parse(end) + 1), "https://meet")).toBe(false);
    expect(canJoin(start, end, new Date(Date.parse(start)), null)).toBe(false);
    const fmt = { clock: () => "3:00 PM", day: () => "Tomorrow" };
    expect(soonWords(start, new Date(Date.parse(start) - 12 * 60_000), fmt)).toBe(
      "Starts in 12 min",
    );
    expect(soonWords(start, new Date(Date.parse(start) + 60_000), fmt, end)).toBe("Live now");
  });
  it("readiness never depends on the client: a plan is ready with nothing sent", () => {
    const r = meetingReadiness({
      state: "awaiting_confirmation",
      planReady: true,
      coachReviewed: false,
      changesSinceReview: 0,
      questions: "sent",
      clarify: 1,
      access: { kind: "video", label: "Video link" },
    });
    expect(r.ready).toBe(true);
    expect(r.items.find((i) => i.key === "client")?.value).toBe("Sent, no answers yet");
    expect(r.headline).toMatch(/Ready/);
    const none = meetingReadiness({
      state: null,
      planReady: true,
      coachReviewed: true,
      changesSinceReview: 2,
      questions: "not_needed",
      clarify: 0,
      access: { kind: "none", label: null },
    });
    expect(none.items.find((i) => i.key === "coach")?.value).toBe("2 new since you looked");
    expect(none.items.find((i) => i.key === "access")?.tone).toBe("attention");
  });
});
