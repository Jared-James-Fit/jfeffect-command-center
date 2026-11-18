import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cleanGeneratedNote, dayNoteView, exerciseNoteForAthlete, isGeneratedNote, isGenericProgression } from "@/lib/workouts/coach-notes";
import { athleteNotes } from "@/lib/program-intel/program-view";
import { DayCoachNotes } from "@/components/workout-day/logger-top";

const read = (p: string) => readFileSync(p, "utf8");

// Every note below is copied from a live program on Nov 18 2026.
describe("a generated exercise note keeps only what the athlete can use today", () => {
  it("drops a progression line with nothing to act on, keeps one with its numbers", () => {
    expect(isGenericProgression("Double progression.")).toBe(true);
    expect(isGenericProgression("Add load if RPE < target.")).toBe(true);
    expect(isGenericProgression("Add reps.")).toBe(true);
    expect(isGenericProgression("Double progression (add weight).")).toBe(true);
    // an instruction without a number is still an instruction
    expect(isGenericProgression("Hold load until top set moves up.")).toBe(false);
    expect(isGenericProgression("Hold a plate if reps are easy.")).toBe(false);
    expect(isGenericProgression("Add 5lb weekly if RPE ≤ target.")).toBe(false);
    expect(isGenericProgression("Double progression. Add weight when 12 reps are hit at RPE 8.")).toBe(false);
    expect(isGenericProgression("Add weight once every set hits the top of the range.")).toBe(false);
    expect(
      exerciseNoteForAthlete("Focus on full retraction of shoulder blades. · Progress: Double progression. · Swap if needed: Chest Supported Row", 2),
    ).toBe("Focus on full retraction of shoulder blades. · Swap if needed: Chest Supported Row");
    expect(exerciseNoteForAthlete("Station 1. Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.", 2)).toBe(
      "Station 1. Focus on bracing to protect low back. · Progress: W1: 8 reps @7, W2: 6 reps @8, W3: 5 reps @9. Add 5lb if RPE is met.",
    );
  });

  it("keeps the instruction when a method's name comes with one", () => {
    expect(exerciseNoteForAthlete("Neutral grip. · Progress: Double progression. Focus on controlled eccentric.", 2)).toBe("Neutral grip. · Progress: Focus on controlled eccentric.");
    expect(exerciseNoteForAthlete("Station 2. · Progress: Double progression. Replaces Incline to reduce low back arching.", 2)).toBe("Station 2.");
    expect(exerciseNoteForAthlete("Push-ups. · Progress: Hold a plate if reps are easy.", 2)).toBe("Push-ups. · Progress: Hold a plate if reps are easy.");
  });

  it("says a week's own line only in that week (Devin's top set in week 2 read 'Week 1: …')", () => {
    const note = "Top set. Week 1: Find a weight you could do for 3 more reps (RPE 7). · Progress: Add load if RPE < target.";
    expect(exerciseNoteForAthlete(note, 1)).toBe("Top set. Week 1: Find a weight you could do for 3 more reps (RPE 7).");
    expect(exerciseNoteForAthlete(note, 2)).toBe("Top set.");
  });

  it("never shows the model explaining its programming to the coach", () => {
    expect(
      exerciseNoteForAthlete("Station 1: Rack. Replacing DB Bench to overcome plateau. Start conservative to find new baseline. · Progress: Add 2.5-5lb when all sets hit 8 reps at target RPE. · Swap if needed: Competition Bench", 1),
    ).toBe("Station 1: Rack. Start conservative to find new baseline. · Progress: Add 2.5-5lb when all sets hit 8 reps at target RPE. · Swap if needed: Competition Bench");
    expect(exerciseNoteForAthlete("Station 2: Dumbbells. New addition for 3D shoulder look. · Progress: Double progression. · Swap if needed: Lying Rear Delt Fly - Dumbbell", 1)).toBe(
      "Station 2: Dumbbells. · Swap if needed: Lying Rear Delt Fly - Dumbbell",
    );
  });

  it("hides the note entirely when nothing is left", () => {
    expect(exerciseNoteForAthlete("Progress: Double progression.", 3)).toBeNull();
    expect(exerciseNoteForAthlete("   ", 1)).toBeNull();
    expect(exerciseNoteForAthlete(null, 1)).toBeNull();
  });

  it("leaves a coach's own words exactly as written", () => {
    expect(isGeneratedNote("Week 1: build to a heavy single, then back off.")).toBe(false);
    expect(exerciseNoteForAthlete("Week 1: build to a heavy single, then back off.", 3)).toBe("Week 1: build to a heavy single, then back off.");
    expect(exerciseNoteForAthlete("Replacing lunges this block because of your knee. Stop if it pinches.", 1)).toBe(
      "Replacing lunges this block because of your knee. Stop if it pinches.",
    );
  });

  it("takes the app's own stale line out of a cardio cue (Devin's plan has its nutrition plan now)", () => {
    expect(
      exerciseNoteForAthlete("Incline 5% · 2–3 mph · Zone 2. After lifting, at a pace you can talk but not sing. Your nutrition plan will adjust this when it's made.", 1),
    ).toBe("Incline 5% · 2–3 mph · Zone 2. After lifting, at a pace you can talk but not sing.");
    expect(read("src/lib/program-intel/cardio.ts")).not.toContain("Your nutrition plan will adjust this");
  });

  it("never breaks a number apart", () => {
    expect(cleanGeneratedNote("Use 2.5 kg jumps. · Progress: Add 2.5 kg at RPE 7.5 or less.", 1)).toBe("Use 2.5 kg jumps. · Progress: Add 2.5 kg at RPE 7.5 or less.");
  });
});

describe("the generator writes notes the same way", () => {
  const ex = (o: Record<string, unknown>) =>
    ({ exercise_id: "x", exercise_name: "Cable Seated Row", role: "Accessory", sets: 3, reps: "8-12", rpe: "7", rir: null, percentage: null, rest_seconds: 90, tempo: null, progression: "Double progression.", substitutions: [], notes: null, weeks: [], ...o }) as any;
  it("no method-only progression line, no week 1 line in week 2", () => {
    expect(athleteNotes(ex({}), 1)).toBeNull();
    expect(athleteNotes(ex({ notes: "Week 1: find a weight you could do 3 more times." }), 1)).toBe("Week 1: find a weight you could do 3 more times.");
    expect(athleteNotes(ex({ notes: "Week 1: find a weight you could do 3 more times." }), 2)).toBeNull();
    expect(athleteNotes(ex({ progression: "When all sets reach 12 reps at RPE 8 or less, add 5 lb." }), 2)).toBe("Progress: When all sets reach 12 reps at RPE 8 or less, add 5 lb.");
  });
  it("every AI that writes a note is told the same rule: only when it changes how they do it", () => {
    const prompts = read("src/lib/program-intel/generator-prompts.ts");
    expect(prompts).toContain("export const ATHLETE_NOTE_RULES");
    expect(prompts).toContain("${ATHLETE_NOTE_RULES}");
    expect(prompts).toContain("Most exercises need none: use null unless it changes how they do the exercise today.");
    expect(read("src/lib/program-ai/prompts.ts")).toContain("A new one only when it changes how they do the exercise");
    expect(read("src/lib/cleo-program.ts")).toContain("only when it changes how they do it");
  });
});

describe("a day's notes against the same workout last week", () => {
  // Jared McIntyre's Block 1 — Nationals Base, Monday, weeks 1, 2 and 4
  const w1 = "Target 75–90 min. % loads are planned weights; the RPE cap always wins. Over 90 min? Cut the last accessory before any squat or bench work. Calibration week: the single and the back-offs help confirm your squat Training Max.";
  const w2 = "Target 75–90 min. % loads are planned weights; the RPE cap always wins. Over 90 min? Cut the last accessory before any squat or bench work.";
  const w4 = "Target 75–90 min. % loads are planned weights; the RPE cap always wins. Over 90 min? Cut the last accessory before any squat or bench work. Fatigue reduction: no belt squat unless you feel exceptionally recovered.";

  it("shows the note as before with nothing to compare (week 1, or last week had none)", () => {
    expect(dayNoteView(w1, null)).toEqual({ lead: w1, detail: null, repeat: null });
    expect(dayNoteView("Station order first.\n\nHow to progress: add 5 lb.", undefined)).toEqual({ lead: "Station order first.", detail: "How to progress: add 5 lb.", repeat: null });
  });
  it("word for word last week's folds to one line, the whole note a tap away", () => {
    expect(dayNoteView(w2, w2)).toEqual({ lead: "", detail: w2, repeat: "same" });
    // a sentence dropped since last week is still nothing new to read
    expect(dayNoteView(w2, w1)?.repeat).toBe("same");
  });
  it("leads with what's new this week", () => {
    expect(dayNoteView(w4, w2)).toEqual({ lead: "Fatigue reduction: no belt squat unless you feel exceptionally recovered.", detail: w4, repeat: "new" });
  });
  it("a note that's entirely new reads as a normal note", () => {
    expect(dayNoteView("Meet day. Total first.", "Bench touch. Nothing else.")?.repeat).toBeNull();
  });
  it("renders one quiet line for a repeat, and nothing for a private or empty note", () => {
    const same = renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: w2, notes_client_visible: true }, previous: w2 }));
    expect(same).toContain("Same as last week");
    expect(same).toContain('data-coach-notes-repeat="same"');
    expect(same).not.toContain("data-coach-notes-lead");
    const fresh = renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: w4, notes_client_visible: true }, previous: w2 }));
    expect(fresh).toContain("New this week");
    expect(fresh).toContain("Fatigue reduction: no belt squat");
    expect(renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: w2, notes_client_visible: false }, previous: w2 }))).toBe("");
    expect(renderToStaticMarkup(createElement(DayCoachNotes, { day: { notes: "  ", notes_client_visible: true }, previous: null }))).toBe("");
  });
  it("the logger reads last week's notes only when there is a note and a last week", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain('queryKey: ["pl-day-notes-last-week", blockId, lastWeekIndex, day?.day_index ?? null]');
    expect(day).toContain("lastWeekIndex >= 1 && day?.day_index != null && day?.notes_client_visible === true");
    expect(day).toContain("<DayCoachNotes day={day} previous={lastWeekDayNotes} />");
    expect(day).toContain("{athleteNote && <ExerciseNotesBlock notes={athleteNote} />}");
  });
});
