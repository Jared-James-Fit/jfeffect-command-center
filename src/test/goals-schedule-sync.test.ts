import { describe, expect, it } from "vitest";
import {
  availabilityWith,
  codesToDays,
  daysToCodes,
  goalsForSchedule,
  pickTrainingDays,
  sameDays,
  scheduleForGoalsSave,
} from "@/lib/client-goals/schedule-sync";
import { fitTrainingDays, longestRun } from "@/lib/plan-days-fit";

describe("Goals & Setup days are the program schedule", () => {
  it("converts between Goals' codes and the schedule's names, in week order", () => {
    expect(codesToDays(["fri", "mon", "x", "mon"])).toEqual(["Monday", "Friday"]);
    expect(daysToCodes(["Sunday", "Tuesday", "Nope"])).toEqual(["tue", "sun"]);
    expect(sameDays(["Friday", "Monday"], ["Monday", "Friday"])).toBe(true);
    expect(sameDays(["Monday"], ["Monday", "Friday"])).toBe(false);
  });

  it("Goals says what the schedule is: Marc trains Mon/Tue/Wed/Fri, his Goals said 3 days Mon/Wed/Fri", () => {
    expect(
      goalsForSchedule(["Monday", "Tuesday", "Wednesday", "Friday"], ["mon", "wed", "fri"]),
    ).toEqual({
      training_days_per_week: 4,
      available_weekdays: ["mon", "tue", "wed", "fri"],
    });
  });

  it("extra available days are kept; no schedule means Goals is left as answered", () => {
    expect(availabilityWith(["sat", "sun"], ["Monday", "Thursday"])).toEqual([
      "mon",
      "thu",
      "sat",
      "sun",
    ]);
    expect(goalsForSchedule([], ["mon"])).toBeNull();
  });
});

describe("picking the best training days", () => {
  it("keeps the days they train when the number doesn't change", () => {
    expect(
      pickTrainingDays({ current: ["Monday", "Tuesday", "Thursday", "Friday"], perWeek: 4 }),
    ).toEqual(["Monday", "Tuesday", "Thursday", "Friday"]);
  });

  it("going from 4 to 3 drops the day that leaves the best rest between sessions", () => {
    expect(
      pickTrainingDays({ current: ["Monday", "Tuesday", "Wednesday", "Friday"], perWeek: 3 }),
    ).toEqual(["Monday", "Wednesday", "Friday"]);
  });

  it("adding a day picks from the days they're available first", () => {
    // Available Mon–Sat; Saturday is the spread-out pick, Sunday isn't on offer.
    expect(
      pickTrainingDays({
        current: ["Monday", "Tuesday", "Thursday", "Friday"],
        perWeek: 5,
        available: ["mon", "tue", "wed", "thu", "fri", "sat"],
      }),
    ).toEqual(["Monday", "Tuesday", "Thursday", "Friday", "Saturday"]);
    // Only weekends free on top of their days: never a weekday they didn't offer.
    expect(
      pickTrainingDays({
        current: ["Monday", "Wednesday", "Friday"],
        perWeek: 4,
        available: ["mon", "wed", "fri", "sun"],
      }),
    ).toEqual(["Monday", "Wednesday", "Friday", "Sunday"]);
  });

  it("a day they're no longer available on moves to one they are", () => {
    expect(
      pickTrainingDays({
        current: ["Monday", "Tuesday", "Thursday"],
        perWeek: 3,
        available: ["mon", "wed", "thu", "fri", "sat"],
      }),
    ).toEqual(["Monday", "Thursday", "Saturday"]);
  });

  it("not enough available days: all of them, then the best of the rest", () => {
    const days = pickTrainingDays({ current: [], perWeek: 4, available: ["sat", "sun"] });
    expect(days).toHaveLength(4);
    expect(days).toEqual(expect.arrayContaining(["Saturday", "Sunday"]));
  });

  it("no schedule yet: a spread-out week from their available days", () => {
    expect(
      pickTrainingDays({ current: [], perWeek: 3, available: ["mon", "tue", "wed", "thu", "fri"] }),
    ).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(pickTrainingDays({ current: [], perWeek: 2, available: ["fri", "sat", "sun"] })).toEqual(
      ["Friday", "Sunday"],
    );
  });

  it("fitTrainingDays without availability behaves as before (starting a plan)", () => {
    expect(fitTrainingDays(["Monday", "Tuesday", "Thursday", "Friday"], 5)).toEqual({
      days: ["Monday", "Tuesday", "Thursday", "Friday", "Saturday"],
      added: ["Saturday"],
      dropped: [],
    });
    const withAllowed = fitTrainingDays(["Monday", "Tuesday", "Thursday"], 3, {
      allowed: ["Monday", "Wednesday", "Thursday", "Friday", "Saturday"],
    });
    expect(withAllowed.dropped).toEqual(["Tuesday"]);
    expect(withAllowed.added).toEqual(["Saturday"]);
  });

  it("longestRun reads back-to-back days, Sunday into Monday", () => {
    expect(longestRun(["Monday", "Tuesday", "Wednesday", "Friday"])).toBe(3);
    expect(longestRun(["Monday", "Wednesday", "Friday"])).toBe(1);
    expect(longestRun(["Saturday", "Sunday", "Monday"])).toBe(3);
    expect(longestRun([])).toBe(0);
  });
});

describe("what a Goals & Setup save does to the schedule", () => {
  const live = ["Monday", "Tuesday", "Wednesday", "Friday"];
  const stored = { training_days_per_week: 4, available_weekdays: ["mon", "tue", "wed", "fri"] };

  it("the exact days picked win", () => {
    expect(
      scheduleForGoalsSave({
        live,
        stored,
        patch: {},
        trainingDays: ["Monday", "Wednesday", "Friday"],
      }),
    ).toEqual(["Monday", "Wednesday", "Friday"]);
  });

  it("picked days equal to the schedule change nothing", () => {
    expect(
      scheduleForGoalsSave({
        live,
        stored,
        patch: {},
        trainingDays: ["Friday", "Monday", "Tuesday", "Wednesday"],
      }),
    ).toBeNull();
  });

  it("an untouched step never moves the schedule", () => {
    expect(scheduleForGoalsSave({ live, stored, patch: { ...stored } })).toBeNull();
    expect(scheduleForGoalsSave({ live, stored, patch: {} })).toBeNull();
  });

  it("an older app that only sends a new number still moves the schedule, keeping their days", () => {
    expect(scheduleForGoalsSave({ live, stored, patch: { training_days_per_week: 3 } })).toEqual([
      "Monday",
      "Wednesday",
      "Friday",
    ]);
  });

  it("an older app that takes a training day off their availability moves it", () => {
    expect(
      scheduleForGoalsSave({
        live,
        stored,
        patch: { training_days_per_week: 4, available_weekdays: ["mon", "wed", "thu", "fri"] },
      }),
    ).toEqual(["Monday", "Wednesday", "Thursday", "Friday"]);
  });

  it("first answers with no schedule yet set one up from their available days", () => {
    expect(
      scheduleForGoalsSave({
        live: [],
        stored: null,
        patch: {
          training_days_per_week: 3,
          available_weekdays: ["mon", "tue", "wed", "thu", "fri"],
        },
      }),
    ).toEqual(["Monday", "Wednesday", "Friday"]);
  });

  it("first answers that match the schedule they already have change nothing", () => {
    expect(
      scheduleForGoalsSave({
        live,
        stored: null,
        patch: {
          training_days_per_week: 4,
          available_weekdays: ["mon", "tue", "wed", "fri", "sat"],
        },
      }),
    ).toBeNull();
  });
});
