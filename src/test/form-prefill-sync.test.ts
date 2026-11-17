import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  goalOption,
  ipfClassFor,
  matchClassOption,
  optionHours,
  prefillDetail,
  prefillNote,
  sameAnswer,
  seasonYear,
  startingAnswer,
  suggestPrefill,
  trainingTimeOption,
  workoutStartHours,
} from "@/lib/form-prefill";
import { parseFormDraft } from "@/lib/form-draft";

// the live forms' own options (Nov 17 2026)
const TIME = ["Early morning (before 8am)", "Morning (8–11am)", "Midday (11am–2pm)", "Afternoon (2–5pm)", "Evening (5–8pm)", "Night (after 8pm)", "It varies"];
const GOAL = ["Fat Loss", "Muscle Gain", "Recomp (lose fat + build muscle)", "Maintenance", "Performance / strength", "Reverse Diet", "Lifestyle Reset (build better habits)"];
const AGE = ["SUB-JUNIOR (14–18)", "JUNIOR (19–23)", "OPEN (19–59)", "MASTER 1 (40–49)", "MASTER 2 (50–59)", "MASTER 3 (60–69)", "MASTER 4 (70+)"];
const WC = [
  "Men's 53 kg (sub-junior & junior only)", "Men's 59 kg", "Men's 66 kg", "Men's 74 kg", "Men's 83 kg", "Men's 93 kg", "Men's 105 kg", "Men's 120 kg", "Men's 120 kg+",
  "Women's 43 kg (sub-junior & junior only)", "Women's 47 kg", "Women's 52 kg", "Women's 57 kg", "Women's 63 kg", "Women's 69 kg", "Women's 76 kg", "Women's 84 kg", "Women's 84 kg+",
];

const q = (prefill: string, type: string, options: string[] = [], extra: Record<string, unknown> = {}) => ({
  question_type: type,
  options,
  label: "",
  validation: { prefill, ...extra },
});

describe("when they usually train, from their workouts", () => {
  it("reads the form's own time windows", () => {
    expect(TIME.map(optionHours)).toEqual([[0, 8], [8, 11], [11, 14], [14, 17], [17, 20], [20, 24], null]);
    expect(optionHours("Late (11–2pm)")).toEqual([11, 14]);
  });

  it("picks the window most workouts started in, only when it's clear", () => {
    expect(trainingTimeOption(TIME, [6.5, 7, 7.25, 6.9, 7.5, 18])).toBe("Early morning (before 8am)");
    expect(trainingTimeOption(TIME, [17.5, 18, 19, 18.2, 7, 12])).toBe("Evening (5–8pm)"); // 4 of 6
  });

  it("needs five workouts and 60% in one window", () => {
    expect(trainingTimeOption(TIME, [7, 7, 7, 7])).toBeNull();
    expect(trainingTimeOption(TIME, [7, 9, 12, 15, 18])).toBeNull();
    expect(trainingTimeOption(TIME, [17.5, 18, 19, 18.2, 7, 12, 13])).toBeNull();
    expect(trainingTimeOption(["Morning", "Evening"], [7, 7, 7, 7, 7])).toBeNull();
  });

  it("reads each start in their own time zone", () => {
    // 13:30 UTC is 8:30 in Winnipeg (UTC-5 from Nov 2026) and 22:30 in Tokyo
    const rows = [{ training_started_at: "2026-11-16T13:30:00Z" }, { started_at: "2026-11-16T13:30:00Z" }, { started_at: null }];
    expect(workoutStartHours(rows, "America/Winnipeg")).toEqual([8.5, 8.5]);
    expect(workoutStartHours(rows, "Asia/Tokyo")).toEqual([22.5, 22.5]);
  });
});

describe("their goal, from Goals & Setup", () => {
  it("maps what they picked to the form's words", () => {
    expect(goalOption(GOAL, { nutrition: "Lose body fat" })).toBe("Fat Loss");
    expect(goalOption(GOAL, { nutrition: "Build muscle" })).toBe("Muscle Gain");
    expect(goalOption(GOAL, { nutrition: "Maintain weight" })).toBe("Maintenance");
    expect(goalOption(GOAL, { nutrition: "Improve performance" })).toBe("Performance / strength");
    expect(goalOption(GOAL, { nutrition: null, main: "Body recomposition" })).toBe("Recomp (lose fat + build muscle)");
    expect(goalOption(GOAL, { main: "Powerlifting" })).toBe("Performance / strength");
    expect(goalOption(GOAL, { main: "Improve general fitness" })).toBeNull();
    expect(goalOption(GOAL, null)).toBeNull();
  });

  it("is a starting point: their last answer wins", () => {
    const goal = q("goal", "dropdown", GOAL);
    const profile = { goals: { nutrition: "Lose body fat" } };
    expect(prefillDetail(goal, profile)).toMatchObject({ value: "Fat Loss", strong: false, source: "From your Goals & Setup" });
    expect(startingAnswer(goal, profile, "Muscle Gain")).toEqual({ value: "Muscle Gain", from: "last" });
    expect(startingAnswer(goal, profile, undefined)).toEqual({ value: "Fat Loss", from: "profile" });
  });
});

describe("training days, from their schedule", () => {
  const days = ["Monday", "Tuesday", "Thursday", "Saturday"];
  it("is the number of days they've committed to, over last month's answer", () => {
    const n = q("training_days", "number");
    expect(prefillDetail(n, { training_days: days })).toEqual({ value: "4", strong: true, source: "From your training schedule" });
    expect(startingAnswer(n, { training_days: days }, 3)).toEqual({ value: "4", from: "profile" });
    expect(startingAnswer(n, { training_days: [] }, 3)).toEqual({ value: 3, from: "last" });
  });

  it("ticks the days themselves on a which-days question", () => {
    const m = q("training_days", "multi_choice", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(prefillDetail(m, { training_days: days })?.value).toEqual(["Mon", "Tue", "Thu", "Sat"]);
    expect(prefillDetail(q("training_days", "multi_choice", ["Weekdays", "Weekends"]), { training_days: days })).toBeNull();
  });
});

describe("age classes, from their birth year", () => {
  const age = q("age_class", "multi_choice", AGE);
  it("ticks every class the season allows", () => {
    expect(prefillDetail(age, { date_of_birth: "1998-05-05", season_year: 2027 })).toEqual({
      value: ["OPEN (19–59)"],
      strong: true,
      source: "From your birth year: you can lift Open in 2027",
    });
    expect(prefillDetail(age, { date_of_birth: "2004-01-02", season_year: 2027 })?.value).toEqual(["JUNIOR (19–23)", "OPEN (19–59)"]);
    expect(prefillDetail(age, { date_of_birth: "2004-01-02", season_year: 2027 })?.source).toBe("From your birth year: you can lift Junior and Open in 2027");
    expect(prefillDetail(age, { date_of_birth: null, season_year: 2027 })).toBeNull();
  });

  it("keeps the ones they picked last time that they can still lift", () => {
    const junior = { date_of_birth: "2004-01-02", season_year: 2027 };
    expect(startingAnswer(age, junior, ["JUNIOR (19–23)"])).toEqual({ value: ["JUNIOR (19–23)"], from: "last" });
    // aged out of junior: Open is all that's left, and it's theirs
    const aged = { date_of_birth: "2003-01-02", season_year: 2027 };
    expect(startingAnswer(age, aged, ["JUNIOR (19–23)"])).toEqual({ value: ["OPEN (19–59)"], from: "profile" });
    expect(startingAnswer(age, aged, ["JUNIOR (19–23)", "OPEN (19–59)"])).toEqual({ value: ["OPEN (19–59)"], from: "last" });
  });

  it("says what their birth year allows whatever they picked", () => {
    expect(prefillNote(age, { date_of_birth: "2004-01-02", season_year: 2027 }, ["JUNIOR (19–23)"])).toBe("From your birth year: you can lift Junior and Open in 2027");
  });

  it("starts the season in October", () => {
    expect(seasonYear(new Date(2026, 10, 17))).toBe(2027);
    expect(seasonYear(new Date(2026, 8, 30))).toBe(2026);
  });
});

describe("weight class", () => {
  const wc = q("weight_class", "single_choice", WC, { group_prefixes: ["Men's", "Women's"] });
  it("is the IPF class a bodyweight falls in", () => {
    expect(ipfClassFor(82.9, "male", false)).toBe("83");
    expect(ipfClassFor(83.1, "male", false)).toBe("93");
    expect(ipfClassFor(125, "male", false)).toBe("120+");
    expect(ipfClassFor(52, "male", false)).toBe("59");
    expect(ipfClassFor(52, "male", true)).toBe("53");
    expect(ipfClassFor(62, "female", false)).toBe("63");
    expect(ipfClassFor(90, "female", false)).toBe("84+");
    expect(ipfClassFor(80, null, false)).toBeNull();
  });

  it("matches a class to the form's option", () => {
    expect(matchClassOption(WC, "83", "male")).toBe("Men's 83 kg");
    expect(matchClassOption(WC, "120+", "male")).toBe("Men's 120 kg+");
    expect(matchClassOption(WC, "120", "male")).toBe("Men's 120 kg");
    expect(matchClassOption(WC, "53", "male")).toBe("Men's 53 kg (sub-junior & junior only)");
    expect(matchClassOption(WC, "84", "female")).toBe("Women's 84 kg");
    expect(matchClassOption(WC, "Men's 93 kg", "female")).toBe("Men's 93 kg");
    expect(matchClassOption(WC, "83", null)).toBe("Men's 83 kg");
    expect(matchClassOption(WC, "84", null)).toBe("Women's 84 kg");
  });

  it("is the coach's meet prep class first, a fact", () => {
    const p = { sex: "male", prep_weight_class: "93", recent_bodyweight: { value: 180, unit: "lb" as const, count: 5 } };
    expect(prefillDetail(wc, p)).toEqual({ value: "Men's 93 kg", strong: true, source: "From your meet prep" });
    expect(startingAnswer(wc, p, "Men's 83 kg")).toEqual({ value: "Men's 93 kg", from: "profile" });
  });

  it("else the class their weigh-ins put them in, which their last answer beats", () => {
    const p = { sex: "male", recent_bodyweight: { value: 180.4, unit: "lb" as const, count: 5 } };
    expect(prefillDetail(wc, p)).toEqual({ value: "Men's 83 kg", strong: false, source: "From your weigh-ins (180.4 lb average)" });
    expect(startingAnswer(wc, p, "Men's 74 kg")).toEqual({ value: "Men's 74 kg", from: "last" });
    expect(startingAnswer(wc, p, null)).toEqual({ value: "Men's 83 kg", from: "profile" });
    // a junior's 53 kg class is only theirs to be put in while they're a junior
    expect(prefillDetail(wc, { sex: "male", date_of_birth: "2005-01-01", season_year: 2027, recent_bodyweight: { value: 52, unit: "kg", count: 1 } })?.value).toBe("Men's 53 kg (sub-junior & junior only)");
    expect(prefillDetail(wc, { sex: "male", date_of_birth: "1990-01-01", season_year: 2027, recent_bodyweight: { value: 52, unit: "kg", count: 1 } })?.value).toBe("Men's 59 kg");
    expect(prefillDetail(wc, { sex: null, recent_bodyweight: { value: 80, unit: "kg", count: 3 } })).toBeNull();
  });
});

describe("precedence and the note", () => {
  it("a fact the app keeps beats the last answer; nothing on file keeps it", () => {
    const sex = q("sex", "dropdown", ["Male", "Female", "Prefer not to say"]);
    expect(startingAnswer(sex, { sex: "female" }, "Male")).toEqual({ value: "Female", from: "profile" });
    expect(startingAnswer(sex, { sex: null }, "Male")).toEqual({ value: "Male", from: "last" });
    expect(startingAnswer(sex, null, "")).toBeNull();
    expect(startingAnswer({ validation: { remember: true }, question_type: "long_text" }, null, "Pizza")).toEqual({ value: "Pizza", from: "last" });
  });

  it("shows where an answer came from only while it's still that", () => {
    const n = q("training_days", "number");
    const p = { training_days: ["Monday", "Wednesday", "Friday"] };
    expect(prefillNote(n, p, 3)).toBe("From your training schedule");
    expect(prefillNote(n, p, "3")).toBe("From your training schedule");
    expect(prefillNote(n, p, 5)).toBeNull();
    expect(prefillNote(n, p, "")).toBeNull();
    // the name and the meet speak for themselves
    expect(prefillNote(q("full_name", "short_text"), { full_name: "Ashley" }, "Ashley")).toBeNull();
  });

  it("compares answers by meaning", () => {
    expect(sameAnswer(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameAnswer(["a"], ["a", "b"])).toBe(false);
    expect(sameAnswer({ value: "180", unit: "lb" }, { value: "180.0", unit: "lb" })).toBe(true);
    expect(sameAnswer("", "")).toBe(false);
  });
});

describe("the builder and AI drafts suggest the sync from the question's words", () => {
  it("knows the live forms' questions", () => {
    expect(suggestPrefill({ label: "Training days per week", question_type: "number" })).toBe("training_days");
    expect(suggestPrefill({ label: "What time do you usually train?", question_type: "dropdown", options: TIME })).toBe("training_time");
    expect(suggestPrefill({ label: "Goal", question_type: "dropdown", options: GOAL })).toBe("goal");
    expect(suggestPrefill({ label: "Age class", question_type: "multi_choice", options: AGE })).toBe("age_class");
    expect(suggestPrefill({ label: "Weight class", question_type: "single_choice", options: WC })).toBe("weight_class");
    expect(suggestPrefill({ label: "Morning bodyweight", question_type: "number" })).toBe("bodyweight");
    expect(suggestPrefill({ label: "First and last name", question_type: "short_text" })).toBe("full_name");
    expect(suggestPrefill({ label: "Your name", question_type: "short_text" })).toBe("full_name");
    expect(suggestPrefill({ label: "Sex", question_type: "dropdown", options: ["Male", "Female"] })).toBe("sex");
  });

  it("never guesses at a question the profile can't answer", () => {
    expect(suggestPrefill({ label: "Handler's name", question_type: "short_text" })).toBeNull();
    expect(suggestPrefill({ label: "Your main goal at that meet", question_type: "single_choice", options: ["Qualify for a bigger meet", "Hit a total or a PR"] })).toBeNull();
    expect(suggestPrefill({ label: "What time is weigh-ins?", question_type: "short_text" })).toBeNull();
    expect(suggestPrefill({ label: "Anything else?", question_type: "long_text" })).toBeNull();
  });

  it("an AI-drafted form starts its questions from the profile", () => {
    const draft = parseFormDraft(
      JSON.stringify({ title: "Intake", questions: [{ type: "number", label: "Training days per week" }, { type: "short_text", label: "Your name" }, { type: "long_text", label: "Injuries?" }] }),
    );
    expect(draft?.questions.map((x) => x.validation.prefill ?? null)).toEqual(["training_days", "full_name", null]);
  });
});

describe("wiring", () => {
  const renderer = readFileSync("src/components/forms/client-form-renderer.tsx", "utf8");
  it("the form seeds every answer through one rule, after both reads", () => {
    expect(renderer).toContain("startingAnswer(q, prefillProfile ?? null");
    expect(renderer).toContain("if (prefillQs.length && !prefillFetched) return;");
    expect(renderer).toContain("if (rememberQs.length && !lastFetched) return;");
    expect(renderer).toContain("data-form-prefilled");
    expect(renderer).not.toContain("AgeClassHint");
  });

  it("the weekly check-in's Nutrition Update follows the same rule", () => {
    expect(readFileSync("src/lib/checkin-coordination/nutrition-fold.ts", "utf8")).toContain("startingAnswer(q, x.profile, raw)");
    expect(readFileSync("src/lib/checkin-coordination/nutrition-fold.server.ts", "utf8")).toContain("training_starts: workoutStartHours(starts ?? [], client.timezone)");
  });

  it("the live Nutrition Update syncs training days, training time and its goal", () => {
    const sql = readFileSync("supabase/migrations/20270404090000_form_questions_sync_profile.sql", "utf8");
    for (const [key, label] of [["training_days", "Training days per week"], ["training_time", "What time do you usually train?"], ["goal", "Goal"]]) {
      expect(sql).toContain(`'{"prefill":"${key}"}'::jsonb`);
      expect(sql).toContain(`label = '${label}'`);
    }
    expect(sql.match(/coalesce\(validation ->> 'prefill', ''\) = ''/g)?.length).toBe(3);
  });
});
