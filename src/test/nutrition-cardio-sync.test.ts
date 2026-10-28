import { describe, expect, it } from "vitest";
import { cardioDraftsFor, cardioLine, currentCardioText, dayKey, parseAiCardio, planCardioSync } from "@/lib/nutrition-cardio-sync";

const NEW = `CALORIE TARGETS
Training Day: 2230

DAILY STEPS TARGETS:
Training Day: 10,000
Non Training Day: 12,000
High Day: 8,000

CARDIO SESSIONS:
Training Day: 20 min incline walk · ~120 kcal
Non Training Day: 30 min incline walk · ~180 kcal
High Day: none

CHANGES FROM LAST PLAN
Training Day: 2300 → 2230 kcal (-70)
Cardio: +5 min on non-training days`;

// Real old-format outputs (Jennifer: steps only; David: steps + cardio calories).
const OLD_STEPS_ONLY = `CARDIO STEPS TARGETS:\nTraining Day: 10,000\nNon Training Day: 12,000\nHigh Day: 10,000\n\nCARDIO CALORIE TARGETS:\nTraining Day: 0 kcal (Steps only)\nNon Training Day: 0 kcal (Steps only)\nHigh Day: 0 kcal (Steps only)`;
const OLD_WITH_KCAL = `CARDIO STEPS TARGETS:\nTraining Day: 6,000 steps\nNon Training Day: 8,000 steps\nHigh Day: 6,000 steps\n\nCARDIO CALORIE TARGETS:\nTraining Day: 200 kcal\nNon Training Day: 300 kcal\nHigh Day: 200 kcal`;

const rows = [
  { id: "t", day_type: "Training Day", status: "Active", enabled: true, cardio_type: "Incline Walking", duration_minutes: 25, frequency_per_week: 4, calorie_target_min: 150, calorie_target_max: 200, calorie_target_mode: "custom", updated_at: "2026-08-16" },
  { id: "r", day_type: "Rest Day", status: "Active", enabled: true, cardio_type: "Incline Treadmill Walk", duration_minutes: 25, frequency_per_week: 2, calorie_target_min: null, calorie_target_mode: "auto", updated_at: "2026-08-16" },
  { id: "old", day_type: "High Day", status: "Archived", enabled: true, cardio_type: "Bike", duration_minutes: 40, frequency_per_week: 1, updated_at: "2026-01-01" },
] as any[];

describe("parse the AI's steps + cardio", () => {
  it("day names line up whatever the spelling", () => {
    expect(dayKey("Non Training Day")).toBe(dayKey("NON-TRAINING-DAY MENU"));
    expect(dayKey("Rest Day")).toBe(dayKey("Non-Training Day"));
    expect(dayKey("High Day")).not.toBe(dayKey("Training Day"));
  });

  it("new format: daily steps and cardio sessions (or none)", () => {
    const a = parseAiCardio(NEW);
    expect(a.get(dayKey("Training Day"))).toMatchObject({ steps: 10000, minutes: 20, kcal: 120, none: false });
    expect(a.get(dayKey("Non-Training Day"))).toMatchObject({ steps: 12000, minutes: 30, kcal: 180 });
    expect(a.get(dayKey("High Day"))).toMatchObject({ steps: 8000, none: true, minutes: null });
    // CHANGES FROM LAST PLAN lines don't leak in
    expect(a.get(dayKey("Training Day"))!.kcal).toBe(120);
  });

  it("old format: steps, cardio calories, and 0 kcal meant steps only", () => {
    expect(parseAiCardio(OLD_STEPS_ONLY).get(dayKey("Training Day"))).toMatchObject({ steps: 10000, none: true });
    expect(parseAiCardio(OLD_WITH_KCAL).get(dayKey("Non-Training Day"))).toMatchObject({ steps: 8000, kcal: 300, none: false });
  });
});

describe("drafts and sync", () => {
  const labels = ["Training Day", "Non-Training Day", "High Day"];

  it("drafts start from current cardio (archived ignored), AI on top", () => {
    const plain = cardioDraftsFor({ labels, rows, trainingDays: 4 });
    expect(plain["Training Day"]).toMatchObject({ enabled: true, rowId: "t", duration_minutes: 25, kcal: 150, fromAi: false });
    expect(plain["Non-Training Day"]).toMatchObject({ rowId: "r", enabled: true }); // matched the "Rest Day" row
    expect(plain["High Day"]).toMatchObject({ rowId: null, enabled: false, frequency_per_week: 1 });
    const ai = cardioDraftsFor({ labels, rows, ai: parseAiCardio(NEW), trainingDays: 4 });
    expect(ai["Training Day"]).toMatchObject({ enabled: true, duration_minutes: 20, kcal: 120, fromAi: true, rowId: "t" });
    expect(ai["High Day"]).toMatchObject({ enabled: false, fromAi: true });
  });

  it("a cardio program's day is left alone", () => {
    const d = cardioDraftsFor({ labels, rows: [...rows, { id: "p", day_type: "High Day", status: "Active", program_name: "8-wk walk", updated_at: "2026-10-01" }], ai: parseAiCardio(NEW) });
    expect(d["High Day"]).toMatchObject({ program: "8-wk walk", fromAi: false });
    expect(planCardioSync({ clientId: "c", days: [{ label: "High Day", draft: d["High Day"] }], rows, today: "2026-10-28" })).toEqual({ updates: [], inserts: [] });
  });

  it("publishing: updates only what changed, renames Rest → Non-Training, adds a missing day, skips 'none' with no row", () => {
    const drafts = cardioDraftsFor({ labels, rows, ai: parseAiCardio(NEW), trainingDays: 4 });
    drafts["High Day"] = { ...drafts["High Day"], enabled: true, duration_minutes: 15, kcal: null };
    const { updates, inserts } = planCardioSync({
      clientId: "c",
      days: labels.map((label) => ({ label, draft: drafts[label] })),
      rows,
      today: "2026-10-28",
      trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
      highDay: "Saturday",
    });
    const t = updates.find((u) => u.id === "t")!.patch;
    expect(t).toMatchObject({ duration_minutes: 20, calorie_target_min: 120, calorie_target_max: 120 });
    expect(t).not.toHaveProperty("calorie_target_mode"); // already custom: only changes are written
    expect(t).not.toHaveProperty("frequency_per_week");
    const r = updates.find((u) => u.id === "r")!.patch;
    expect(r).toMatchObject({ day_type: "Non-Training Day", duration_minutes: 30, calorie_target_min: 180 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ client_id: "c", day_type: "High Day", duration_minutes: 15, calorie_target_mode: "auto", scheduled_weekdays: ["Saturday"], status: "Active", enabled: true });
    const none = cardioDraftsFor({ labels: ["High Day"], rows: [], ai: parseAiCardio(NEW) });
    expect(planCardioSync({ clientId: "c", days: [{ label: "High Day", draft: none["High Day"] }], rows: [], today: "2026-10-28" }).inserts).toEqual([]);
  });

  it("saving an unchanged plan writes nothing (a 150–200 kcal range stays a range)", () => {
    const drafts = cardioDraftsFor({ labels: ["Training Day", "Rest Day"], rows });
    const res = planCardioSync({ clientId: "c", days: ["Training Day", "Rest Day"].map((label) => ({ label, draft: drafts[label] })), rows, today: "2026-10-28" });
    expect(res).toEqual({ updates: [], inserts: [] });
  });

  it("turning cardio off disables the row instead of deleting it", () => {
    const drafts = cardioDraftsFor({ labels: ["Training Day"], rows });
    const res = planCardioSync({ clientId: "c", days: [{ label: "Training Day", draft: { ...drafts["Training Day"], enabled: false } }], rows, today: "2026-10-28" });
    expect(res.updates[0].patch).toMatchObject({ enabled: false });
    expect(res.updates[0].patch).not.toHaveProperty("calorie_target_min");
  });

  it("current cardio for the AI, and the review line", () => {
    expect(currentCardioText(rows)).toBe("CURRENT CARDIO\n- Training Day: 25 min incline walking · 4x/week · ~150 kcal\n- Rest Day: 25 min incline treadmill walk · 2x/week");
    expect(currentCardioText([])).toBe("");
    const d = cardioDraftsFor({ labels: ["Training Day"], rows })["Training Day"];
    expect(cardioLine(10000, d)).toBe("10,000 steps · 25 min incline walking · ~150 kcal · 4x/wk");
  });
});
