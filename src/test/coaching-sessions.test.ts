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

  it("two decisions ten days out earn a call now, well before meet week", () => {
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
