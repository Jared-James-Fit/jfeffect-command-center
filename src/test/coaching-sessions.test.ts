import { describe, expect, it } from "vitest";
import { detectEvents, generalEvent, meetPhase } from "@/lib/coaching-sessions/events";
import {
  ATHLETE_SHARE,
  buildSessionPrep,
  planAgenda,
  recommendIntervention,
  type SessionPrepInput,
} from "@/lib/coaching-sessions/prepare";

const TODAY = "2026-11-25";

/** A made-up 57 kg lifter modelled on a real prep: a meet on Dec 5, ten days out. */
const base: SessionPrepInput = {
  today: TODAY,
  topics: null,
  bookingNote: null,
  workouts: { planned: 12, done: 11, missed: 1, lastDone: "2026-11-24", avgRating: 4.2 },
  bodyweight: {
    unit: "kg",
    latestKg: 58.4,
    latestDate: "2026-11-24",
    avg7Kg: 58.6,
    weeklyChangeKg: -0.3,
    goalKg: null,
    goalDate: null,
    stale: false,
  },
  checkins: { count: 4, latest: "2026-11-22", adherence: 4.3, poorSleep: 0, lowEnergy: 1, stress: 0 },
  nutrition: { phase: "Fat loss", kcalLow: 1850, kcalHigh: 2100, since: "2026-11-01" },
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
};

describe("events are read from the records, once", () => {
  it("a meet prep with no competition record is an event, with its phase", () => {
    const ev = detectEvents({
      today: TODAY,
      competitions: [],
      preps: [{ id: "p1", event_name: "Total Fortification", event_date: "2026-12-05", weight_class: "57 kg", status: "Active" }],
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "competition", title: "Total Fortification", daysOut: 10, phase: "Final preparation", source: "Meet prep" });
  });

  it("the prep and its competition are one event, and a date that differs is a conflict to confirm", () => {
    const ev = detectEvents({
      today: TODAY,
      competitions: [{ id: "c1", name: "Total Fortification 2026", meet_date: "2026-12-06", prep_id: null, weight_class: "57" }],
      preps: [{ id: "p1", event_name: "Total Fortification", event_date: "2026-12-05", weight_class: "57 kg", status: "Active" }],
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].competitionId).toBe("c1");
    expect(ev[0].prepId).toBe("p1");
    expect(ev[0].conflicts.join(" ")).toMatch(/Dec 5.*Dec 6/);
  });

  it("internal test competitions stay out unless asked for; a dated goal is its own event", () => {
    const ev = detectEvents({
      today: TODAY,
      competitions: [{ id: "t", name: "Validation", meet_date: "2026-12-09", internal_test: true }],
      preps: [],
      longTermGoal: { label: "First 400 kg total", date: "2027-06-01" },
    });
    expect(ev.map((e) => e.kind)).toEqual(["goal"]);
  });

  it("a general meeting has no date or countdown", () => {
    expect(generalEvent("Progress review")).toMatchObject({ kind: "general", date: null, daysOut: null });
    expect(meetPhase(3)).toBe("Meet week");
  });
});

describe("preparation keeps every line's source", () => {
  it("what's going well is measured, and the athlete's own words lead their corner", () => {
    const p = buildSessionPrep({ ...base, topics: "Nervous about the deadlift opener" });
    expect(p.goingWell.map((i) => i.text).join(" ")).toMatch(/11 of 12 planned workouts/);
    expect(p.athleteNeeds[0]).toMatchObject({ source: "athlete", text: "Nervous about the deadlift opener" });
  });

  it("missing information is named, never guessed", () => {
    const p = buildSessionPrep({ ...base, bodyweight: null, checkins: null });
    expect(p.missing.map((m) => m.text)).toEqual(expect.arrayContaining(["Recent weigh-ins", "A recent weekly check-in"]));
  });

  it("open commitments carry over to the side that's waiting on them", () => {
    const p = buildSessionPrep({
      ...base,
      commitments: [
        { id: "a", owner: "athlete", text: "Send a video of the second squat", dueOn: null, status: "open", sessionDate: "2026-11-11" },
        { id: "b", owner: "coach", text: "Confirm the flight time", dueOn: null, status: "done", sessionDate: "2026-11-11" },
      ],
    });
    expect(p.carriedOver).toHaveLength(1);
    expect(p.coachNeeds.map((i) => i.text).join(" ")).toMatch(/Send a video of the second squat/);
  });
});

describe("the agenda leaves the athlete a real share of the call", () => {
  it("15 to 30 minutes, the five sections, the athlete's corner 25–35%", () => {
    for (const topics of [null, "a", "b"]) {
      const prep = buildSessionPrep({ ...base, topics, coachPriorities: ["Settle the attempts"] });
      const a = planAgenda(prep);
      expect(a.minutes).toBeGreaterThanOrEqual(15);
      expect(a.minutes).toBeLessThanOrEqual(30);
      expect(a.sections.map((s) => s.key)).toEqual(["going_well", "improve", "athletes_corner", "game_plan", "alignment"]);
      expect(a.sections.reduce((s, x) => s + x.minutes, 0)).toBe(a.minutes);
      expect(a.athleteShare).toBeGreaterThanOrEqual(ATHLETE_SHARE.min);
      expect(a.athleteShare).toBeLessThanOrEqual(ATHLETE_SHARE.max + 0.05);
    }
  });
});

describe("the lowest effective intervention", () => {
  const ev = detectEvents({
    today: TODAY,
    competitions: [],
    preps: [{ id: "p1", event_name: "Total Fortification", event_date: "2026-12-05", status: "Active" }],
  })[0];
  const input = (over: Partial<Parameters<typeof recommendIntervention>[0]> = {}) => ({
    today: TODAY,
    event: ev,
    prep: buildSessionPrep({ ...base, event: ev }),
    bookedCallOn: null,
    lastCallOn: null,
    includedCallsLeft: null,
    athleteAsked: false,
    seriousConcern: false,
    ...over,
  });

  it("on track with nothing to decide: nothing, or a message", () => {
    expect(["none", "message"]).toContain(recommendIntervention(input()).level);
  });

  it("two decisions ten days out earn a call now, before meet week", () => {
    const prep = buildSessionPrep({ ...base, event: ev, coachPriorities: ["Settle the openers", "Agree the taper"] });
    const r = recommendIntervention(input({ prep }));
    expect(r.level).toBe("call");
    expect(r.reasons.join(" ")).toMatch(/2 decisions/);
  });

  it("meet week is for executing: a message, unless something serious or they asked", () => {
    const week = { ...ev, daysOut: 4, phase: "Meet week" };
    const prep = buildSessionPrep({ ...base, event: week, coachPriorities: ["Openers", "Taper"] });
    expect(recommendIntervention(input({ event: week, prep })).level).toBe("message");
    expect(recommendIntervention(input({ event: week, prep, athleteAsked: true })).level).toBe("touch_base");
  });

  it("a call already booked is the call: no second one", () => {
    const r = recommendIntervention(input({ bookedCallOn: "2026-11-28", athleteAsked: true }));
    expect(r.level).toBe("none");
    expect(r.reasons[0]).toMatch(/already booked/);
  });

  it("only missing information is a request for it, not a call", () => {
    const prep = buildSessionPrep({ ...base, event: null, bodyweight: null });
    expect(recommendIntervention(input({ event: null, prep })).level).toBe("info_request");
  });

  it("an included call is said apart from a General Call", () => {
    const prep = buildSessionPrep({ ...base, event: ev, coachPriorities: ["A", "B"] });
    expect(recommendIntervention(input({ prep, includedCallsLeft: 1 })).coverage).toMatch(/1 included call left/);
    expect(recommendIntervention(input({ prep, includedCallsLeft: 0 })).coverage).toMatch(/General Call/);
  });
});

describe("the shared screen never shows the coach's private side", () => {
  it("only the athlete's own records and words reach it", async () => {
    const { athleteView, draftGamePlan, gamePlanMessage } = await import("@/lib/coaching-sessions/presentation");
    const prep = buildSessionPrep({
      ...base,
      topics: "Want to talk about my bench",
      coachNotes: "PRIVATE: worried she's undereating",
      coachPriorities: ["PRIVATE: push the class decision"],
      weightRead: "PRIVATE READ: losing too fast",
      competition: {
        expectedTotal: 300,
        range: { conservative: 290, high: 310 },
        place: 2,
        gamePlanReleased: false,
        headline: "PRIVATE: rival X is the threat",
        openDecisions: ["PRIVATE: drop the third deadlift"],
        classGapKg: null,
      },
      commitments: [{ id: "c", owner: "athlete", text: "PRIVATE history line", dueOn: null, status: "open", sessionDate: "2026-11-11" }],
    });
    const view = athleteView(planAgenda(prep));
    const shown = view.flatMap((s) => s.points).join(" | ");
    expect(shown).toMatch(/Want to talk about my bench/);
    expect(shown).toMatch(/11 of 12 planned workouts/);
    expect(shown).not.toMatch(/PRIVATE/);
    // the draft game plan starts from the same shareable lines
    const plan = draftGamePlan(planAgenda(prep), ["Open the squat at 102.5"], [{ owner: "athlete", text: "Film the second squat", status: "open" }]);
    const msg = gamePlanMessage("Sam", plan);
    expect(msg).toMatch(/Open the squat at 102.5/);
    expect(msg).toMatch(/Your part\n• Film the second squat/);
    expect(msg).not.toMatch(/PRIVATE/);
  });
});

describe("the prep opens with real wins and keeps a hold out of improve", () => {
  it("names all-time PRs as going well, in the athlete's unit", () => {
    const prep = buildSessionPrep({
      ...base,
      records: {
        top: [
          { exercise: "Competition Squat", reps: 3, loadKg: 110, date: "2026-11-21" },
          { exercise: "Competition Bench", reps: 5, loadKg: 62.5, date: "2026-11-18" },
        ],
        total: 5,
      },
    });
    const going = prep.goingWell.map((i) => i.text);
    expect(going).toContain("All-time PR: Competition Squat 110 kg × 3 (Nov 21)");
    expect(going).toContain("All-time PR: Competition Bench 62.5 kg × 5 (Nov 18)");
    expect(going).toContain("3 more all-time records in the last 4 weeks");
    const lb = buildSessionPrep({ ...base, bodyweight: { ...base.bodyweight!, unit: "lb" }, records: { top: [{ exercise: "Competition Deadlift", reps: 4, loadKg: 224.53, date: "2026-11-13" }], total: 1 } });
    expect(lb.goingWell.map((i) => i.text)).toContain("All-time PR: Competition Deadlift 495 lb × 4 (Nov 13)");
  });

  it("a bodyweight hold goes in the game plan, a change in improve, too little data in missing", () => {
    const hold = buildSessionPrep({ ...base, weightRead: "Hold the plan: it's still settling in", weightVerdict: "maintain" });
    expect(hold.improve.some((i) => /Hold the plan/.test(i.text))).toBe(false);
    expect(hold.milestones.map((i) => i.text)).toContain("Bodyweight: Hold the plan: it's still settling in");
    const change = buildSessionPrep({ ...base, weightRead: "Take 150 kcal off rest days", weightVerdict: "adjust" });
    expect(change.improve.map((i) => i.text)).toContain("Take 150 kcal off rest days");
    const data = buildSessionPrep({ ...base, weightRead: "Not enough weigh-ins to read a trend", weightVerdict: "need_data" });
    expect(data.missing.map((i) => i.text)).toContain("Not enough weigh-ins to read a trend");
    // a hold never counts as a decision to make on a call
    expect(hold.decisions).toHaveLength(0);
  });
});

describe("pre-call answers land where they belong", () => {
  it("routine answers are never concerns; worries are theirs; not registered is the coach's", () => {
    const prep = buildSessionPrep({
      ...base,
      answers: {
        training_feel: "Good",
        recovery: "Mostly fine",
        pain: "Something minor",
        pain_details: "Left knee achy after high-bar days",
        life: "Exams Monday and Wednesday",
        meet_registered: "Not yet",
        meet_confidence: "Nervous",
        meet_success: "Go 9 for 9",
      },
    });
    const going = prep.goingWell.map((i) => i.text);
    const theirs = prep.athleteNeeds.map((i) => i.text);
    expect(going).toContain("Training feels good (their answer)");
    expect(theirs).toEqual([
      "Physically: something minor (Left knee achy after high-bar days)",
      "Coming up: Exams Monday and Wednesday",
      "Feeling about the meet: nervous",
      "A successful meet looks like: Go 9 for 9",
    ]);
    expect(theirs.some((t) => /recovery|Mostly fine/i.test(t))).toBe(false);
    expect(prep.coachNeeds.map((i) => i.text)).toContain("Registered for the meet: not yet (their answer)");
    // every line is the athlete's own, so the shared screen can show it
    expect(prep.athleteNeeds.every((i) => i.source === "athlete")).toBe(true);
  });

  it("nothing to report says nothing", () => {
    const prep = buildSessionPrep({ ...base, answers: { pain: "Nothing", life: "Nope", meet_registered: "Yes" } });
    expect(prep.athleteNeeds).toHaveLength(0);
    expect(prep.coachNeeds).toHaveLength(0);
  });
});
