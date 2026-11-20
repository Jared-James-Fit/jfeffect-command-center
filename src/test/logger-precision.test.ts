import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestionPicks, type LoadSuggestion } from "@/lib/load-suggestion";
import { selectPreviousLifts, type PreviousLiftLog } from "@/lib/workout-previous-lift";
import { focusNames, isBackoffRow } from "@/lib/workouts/focus-names";
import { noteLead } from "@/lib/workouts/note-lead";

const read = (p: string) => readFileSync(p, "utf8");

describe("suggested: a weight to choose from only where the lifter chooses by feel", () => {
  type Model = Parameters<typeof suggestionPicks>[0]["model"];
  const cold: Model = { source: "history", early: false, carried: false, warmup: null, today: [] };
  const hint = (target: number, unit: "kg" | "lb", low = target * 0.94, high = target * 1.06): LoadSuggestion => ({
    target, unit, low: Math.round(low / 2.5) * 2.5, high: Math.round(high / 2.5) * 2.5,
  });
  const picks = (h: LoadSuggestion, over: Partial<Model> = {}, mainLift = true, effortPrescribed = true) =>
    suggestionPicks({ hint: h, model: { ...cold, ...over }, mainLift, effortPrescribed });

  it("a squat top set before anything today: the target and one audible either side, a plate apart", () => {
    expect(picks(hint(420, "lb"))).toEqual({ low: 410, high: 430, loads: [410, 415, 420, 425, 430] });
    expect(picks(hint(190, "kg"))).toEqual({ low: 185, high: 195, loads: [185, 187.5, 190, 192.5, 195] });
    expect(picks(hint(60, "kg"))?.loads).toEqual([57.5, 60, 62.5]);
  });
  it("a heavy pull never becomes a long row: wider steps, the target always one of them", () => {
    const p = picks(hint(800, "lb"))!;
    expect(p.loads).toEqual([780, 790, 800, 810, 820]);
    expect(picks(hint(600, "lb"))!.loads.length).toBeLessThanOrEqual(7);
  });
  it("never wider than the model's own calibrated range", () => {
    expect(picks({ target: 420, low: 400, high: 425, unit: "lb" })).toEqual({ low: 410, high: 425, loads: [410, 415, 420, 425] });
    expect(picks({ target: 420, low: 420, high: 420, unit: "lb" })).toBeNull();
  });
  it("one number everywhere else: today's sets, a logged warm-up, a back-off, an early estimate, accessories, no RPE / RIR", () => {
    const h = hint(420, "lb");
    expect(picks(h, { today: [{} as any] })).toBeNull();
    expect(picks(h, { source: "blend" })).toBeNull();
    expect(picks(h, { warmup: { e1rm: 500, normalE1rm: 500, load: 365, reps: 2, rpe: 7, trust: 0, spread: 0.105, reliability: 1, count: 1 } })).toBeNull();
    expect(picks(h, { source: "history_warmup" })).toBeNull();
    expect(picks(h, { carried: true })).toBeNull();
    expect(picks(h, { early: true })).toBeNull();
    expect(picks(h, {}, false)).toBeNull();
    expect(picks(h, {}, true, false)).toBeNull();
  });
  it("one tap fills the open sets as drafts (a range fills its middle, no weight buttons), and a coach's load never reaches it", () => {
    const card = read("src/components/workout-day/load-suggestion-card.tsx");
    // one tap logs the open sets (a range opens set 1's weight box); never a row of weight buttons
    expect(card).toContain('data-testid="load-apply"');
    expect(card).not.toContain('data-testid="load-pick"');
    expect(card).toContain("Pick within");
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("picks={loadPicks} showPlan={!rxSaysPlan} onApply={!readonly && clientId && openSetCount > 0 ? logOpenSetsAt : null}");
    expect(wdv).toContain("mainLift: rangeLift(family, name, exercise?.equipment), effortPrescribed: rpeTarget != null || rirTarget != null");
    expect(wdv).toContain("firstOfLift: firstHeavySet, loggedHere: workedToday,");
    // the chip logs through the first open set's own number; a range opens its weight box instead
    const chip = wdv.slice(wdv.indexOf("const logOpenSetsAt"), wdv.indexOf("const logOpenSetsAt") + 600);
    expect(chip).toContain("if (!ex?.completed_at) { first = i; break; }");
    expect(chip).toContain("if (loadPicks) { h.editWeight(); return 0; }");
    expect(chip).toContain("return h.logAt(load);");
    // the engine (and so the range) only runs when the coach doesn't own the load
    expect(wdv).toContain("if (!loadHistory || hideWeight || coachOwnsLoad || rowLoadType !== \"external\" || !loadPlan) return null;");
  });
  it("no warm-up weight is ever suggested: a warm-up is only what they log with + Warm-up", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).not.toContain("suggestFinalWarmup(");
    expect(wdv).toContain("const warmupTunes = !!(warmupPromptable && loadModel && !workedToday);");
  });
});

describe("last time: the same card's last time, working sets only", () => {
  const log = (id: string, session: string, at: string, kg: number, reps: number, role: string | null, extra: Partial<PreviousLiftLog> = {}): PreviousLiftLog => ({
    id, exerciseId: "squat", exerciseName: "Competition Squat", sessionKey: session, occurredAt: at, reps, rpe: 7, rir: null,
    enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046226218, isWorkingSet: null, purposeLabel: role, ...extra,
  });
  const identity = (role: string | null) => ({ rowId: "r", exerciseId: "squat", exerciseName: "Competition Squat", purposeLabel: role });

  it("a back-off card reads its own last back-offs even when the lift's latest day had none", () => {
    const logs = [
      log("a1", "A", "2026-11-02T18:00:00Z", 192.5, 4, "Primary Squat"),
      log("a2", "A", "2026-11-02T18:10:00Z", 177.5, 4, "Primary Squat Backoff"),
      log("b1", "B", "2026-11-06T18:00:00Z", 205, 1, "Heavy Single"),
    ];
    const got = selectPreviousLifts([identity("Primary Squat Backoff")], logs, "today").get("r")!;
    expect(got.id).toBe("a2");
    // a card with no history in its role reads the lift's latest session
    expect(selectPreviousLifts([identity("Tempo Squat")], logs, "today").get("r")!.id).toBe("b1");
    // the top set reads its own top set
    expect(selectPreviousLifts([identity("Primary Squat")], logs, "today").get("r")!.id).toBe("a1");
  });
  it("a set flagged not working is never last time, even if it's all that session had", () => {
    const logs = [
      log("a1", "A", "2026-11-02T18:00:00Z", 190, 4, null),
      log("b1", "B", "2026-11-06T18:00:00Z", 140, 3, null, { isWorkingSet: false }),
    ];
    expect(selectPreviousLifts([identity(null)], logs, "today").get("r")!.id).toBe("a1");
  });
});

describe("Focus names: the next card says which one it is when the exercise repeats", () => {
  it("top set and back-off from the program's own labels", () => {
    expect(focusNames([
      { name: "Competition Squat", purposeLabel: "Primary Squat" },
      { name: "Competition Squat", purposeLabel: "Primary Squat Backoff" },
      { name: "High Bar Squat", purposeLabel: "Secondary Squat" },
    ])).toEqual(["Competition Squat · Top set", "Competition Squat · Backoff", "High Bar Squat"]);
  });
  it("a back-off said in the notes counts, and with no label the prescription tells them apart", () => {
    expect(isBackoffRow({ notes: "Back-offs: 92.5% of today's top set" })).toBe(true);
    expect(focusNames([
      { name: "Bench", sets: 1, reps: "3" },
      { name: "bench ", sets: 3, reps: "5" },
    ])).toEqual(["Bench · 1 × 3", "bench  · 3 × 5"]);
    expect(focusNames([
      { name: "Bench", purposeLabel: "Primary", sets: 1, reps: "3" },
      { name: "Bench", purposeLabel: "Volume", sets: 3, reps: "5" },
    ])).toEqual(["Bench · Primary", "Bench · Volume"]);
  });
  it("an exercise that's on one card stays just its name, and Focus reads the names from here", () => {
    expect(focusNames([{ name: "Leg Press", purposeLabel: "Quads" }])).toEqual(["Leg Press"]);
    expect(read("src/components/workout-day/WorkoutDayView.tsx")).toContain("names={focusNames(");
  });
});

describe("a quieter card", () => {
  it("coach notes are one line that opens in place", () => {
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain('open ? "whitespace-pre-wrap break-words" : "line-clamp-1 break-words"');
    expect(wdv).not.toContain("Read notes");
  });
  it("a note too long for the line shows its first sentence, never \"….\" after a period", () => {
    expect(noteLead("Top set — log weight, reps, RPE (velocity optional). Load is RPE-driven: no fixed kg. Rest 5–7 min."))
      .toBe("Top set — log weight, reps, RPE (velocity optional)");
    expect(noteLead("Brace hard: big breath\nRest 3 min")).toBe("Brace hard: big breath");
    expect(noteLead("Did it move? Go up 5 lb next week.")).toBe("Did it move?");
    // a single sentence has no lead: the line cuts it
    expect(noteLead("Heavy but clean. ")).toBeNull();
    expect(noteLead("Use 2.5 kg jumps, e.g. pause on the chest for one count and press")).toBeNull();
    const wdv = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(wdv).toContain("const lead = clipped && !open ? noteLead(notes) : null;");
    expect(wdv).toContain("{lead ?? notes}");
  });
  it("warm-ups are quiet and monochrome: a flame in the set column, never an orange W or a tinted row", () => {
    const w = read("src/components/workout-day/final-warmup-input.tsx");
    expect(w).not.toMatch(/orange-|blue-/);
    expect(w).not.toContain(">W<");
    expect(w).toContain("<Flame");
    expect(w).toContain('title="Warm-up: not counted as a working set"');
  });
});
