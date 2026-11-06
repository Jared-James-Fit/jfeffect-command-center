import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RawCardioTarget } from "@/lib/program-intel/cardio";
import { bookedSessionLength } from "@/lib/program-intel/context";
import type { BuiltExercise } from "@/lib/program-intel/generator-schemas";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { athleteNotes, supersetNote } from "@/lib/program-intel/program-view";
import { findConflicts } from "@/lib/program-intel/recommend";
import { estimateDay, supersetGroup, supersetSeconds, type TimedExercise } from "@/lib/program-intel/session-time";
import type { RawPtSession } from "@/lib/program-intel/types";
import { homeGym, TODAY } from "./program-intel-scenarios";

// Colten and Marc train in booked 60-minute PT sessions; their generated programs
// were built to Goals & Setup's 90 / 75 minutes plus the walk after lifting.
const hour = (date: string, status = "Completed"): RawPtSession => ({ starts_at: `${date}T16:00:00Z`, ends_at: `${date}T17:00:00Z`, status });
const booked = ["2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29", "2026-11-03", "2026-11-05"].map((d) => hour(d));
const walk = (minutes: number): RawCardioTarget => ({
  id: "train",
  day_type: "Training Day",
  cardio_type: "Incline Treadmill Walk",
  duration_minutes: minutes,
  frequency_per_week: 3,
  scheduled_weekdays: ["Monday", "Wednesday", "Friday"],
  incline: 5,
  status: "Active",
  enabled: true,
  visible_to_client: true,
  program_name: null,
  start_date: "2026-06-19",
  end_date: null,
  source: null,
  updated_at: "2026-11-01T00:00:00Z",
});

describe("a client who trains in booked PT sessions: the whole workout fits the hour", () => {
  it("the hour they book is the median booked length, once 4+ are booked; cancelled and moved ones don't count", () => {
    expect(bookedSessionLength(booked)).toEqual({ minutes: 60, booked: 6 });
    expect(bookedSessionLength([...booked, { starts_at: "2026-11-06T16:00:00Z", ends_at: "2026-11-06T17:30:00Z", status: "Cancelled" }])).toEqual({ minutes: 60, booked: 6 });
    expect(bookedSessionLength(booked.slice(0, 3)).minutes).toBeNull();
    expect(bookedSessionLength(undefined)).toEqual({ minutes: null, booked: 0 });
  });

  it("the session maximum is the PT hour, not Goals & Setup's 75, and lifting leaves room for the walk after it", () => {
    const rec = homeGym();
    rec.ptSessions = booked;
    rec.cardioTargets = [walk(10)];
    const intel = buildGeneratorIntel(rec);
    const s = intel.recommendation.setup;
    expect(intel.ctx.session.ptMinutes).toBe(60);
    expect(s.maxSessionMinutes).toBe(60);
    expect(s.sessionMinutes).toBeLessThanOrEqual(50);
    expect(intel.recommendation.why.maxSessionMinutes?.source).toBe("Booked PT sessions");
    expect(intel.recommendation.why.maxSessionMinutes?.reason).toMatch(/60-min PT sessions .*cardio after it all fit inside, though Goals & Setup says 75/);
  });

  it("without booked sessions nothing changes: Goals & Setup's limit stands", () => {
    const intel = buildGeneratorIntel(homeGym());
    expect(intel.ctx.session.ptMinutes ?? null).toBeNull();
    expect(intel.recommendation.setup.maxSessionMinutes).toBe(75);
    expect(intel.recommendation.why.maxSessionMinutes?.source).toBe("Goals & Setup");
  });

  it("a 25-min walk after lifting in a 60-min session is named, with the fix that keeps the week's cardio", () => {
    const rec = homeGym();
    rec.ptSessions = booked;
    rec.cardioTargets = [walk(25)];
    const intel = buildGeneratorIntel(rec);
    const conflicts = findConflicts(intel.recommendation.setup, intel.ctx, intel.recommendation.baseline, () => null);
    const c = conflicts.find((x) => x.id === "pt-cardio");
    expect(c?.title).toBe("The 25-min cardio after lifting takes 42% of their 60-min PT session");
    expect(c?.detail).toMatch(/Cut the after-workout cardio to 10 min .* the week's cardio stays the same/);
    rec.cardioTargets = [walk(10)];
    const fine = buildGeneratorIntel(rec);
    expect(findConflicts(fine.recommendation.setup, fine.ctx, fine.recommendation.baseline, () => null).some((x) => x.id === "pt-cardio")).toBe(false);
    expect(TODAY).toBe("2026-11-02");
  });

  it("the brief tells the program writer about the hour", () => {
    const brief = readFileSync("src/lib/program-intel/brief.ts", "utf8");
    expect(brief).toContain("trains in booked ${ctx.session.ptMinutes}-min PT sessions with the coach");
    expect(readFileSync("src/lib/program-intel/load.ts", "utf8")).toContain('.from("pt_sessions")');
  });
});

describe("supersets the generator writes save time, and the athlete sees who's paired", () => {
  const press: TimedExercise = { name: "Dumbbell Bench Press", equipment: "Dumbbell", sets: 3, reps: "8-12", restSeconds: 60, superset: "A1" };
  const row: TimedExercise = { name: "Cable Close-Grip Row", equipment: "Cable", sets: 3, reps: "8-12", restSeconds: 75, superset: "A2" };

  it("a pair is timed with each one's own rest after each set, less the very last rest", () => {
    // work: 3 × (10 reps × 4 s + 15 s) = 165 s each; rest: 3 × 60 + 3 × 75 − 75 = 330 s
    expect(supersetSeconds([press, row])).toBe(165 + 165 + 330);
    expect(supersetGroup("A1")).toBe("A");
    expect(supersetGroup("b2")).toBe("B");
    expect(supersetGroup("Station 1")).toBeNull();
  });

  it("paired, the same two exercises take less time than done one after the other", () => {
    const apart = estimateDay([{ ...press, superset: null, restSeconds: 90 }, { ...row, superset: null }]).minutes;
    const paired = estimateDay([press, row]).minutes;
    expect(paired).toBeLessThan(apart);
    // two exercises with the same letter that aren't next to each other aren't a pair
    expect(estimateDay([press, { name: "Leg Curl", sets: 3, reps: "12", restSeconds: 60 }, row]).minutes).toBeGreaterThan(paired);
  });

  it("the saved notes name the partner; an exercise on its own reads as before", () => {
    const ex = (name: string, superset: string | null, notes: string | null = null): BuiltExercise =>
      ({ exercise_id: null, exercise_name: name, role: "Accessory", station: null, superset, sets: 3, reps: "10", rpe: "8", rir: null, rest_seconds: 60, tempo: null, percentage: null, progression: null, substitutions: [], notes, weeks: [] }) as unknown as BuiltExercise;
    const day = [ex("Squat", null, "Brace."), ex("Dumbbell Bench Press", "A1"), ex("Cable Close-Grip Row", "A2", "Squeeze."), ex("Lateral Raise", "B1")];
    expect(supersetNote(day[1], day)).toBe("Superset with Cable Close-Grip Row: one set of each, then rest.");
    expect(athleteNotes(day[2], 1, day)).toBe("Superset with Dumbbell Bench Press: one set of each, then rest. · Squeeze.");
    expect(athleteNotes(day[0], 1, day)).toBe("Brace.");
    expect(supersetNote(day[3], day)).toBeNull();
    expect(athleteNotes(day[2], 1)).toBe("Squeeze.");
    expect(readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8")).toContain("exerciseRow(ex, w, i, d.exercises)");
  });

  it("the program writer is told when and how to pair, and never the main lift", () => {
    const prompts = readFileSync("src/lib/program-intel/generator-prompts.ts", "utf8");
    expect(prompts).toContain("Supersets save time without cutting work");
    expect(prompts).toContain("Never pair the day's main lift");
    expect(prompts).toContain("never two cable exercises on one column, two exercises needing the bench at different angles");
  });
});
