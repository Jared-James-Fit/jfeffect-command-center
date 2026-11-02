import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aiPlanDays,
  copyPlanDays,
  nextPlanDates,
  planDate,
  planPeriod,
  planUpdatedAt,
  replacedEndDate,
  reusePlanPayload,
  splitPlans,
} from "@/lib/nutrition-targets/plan-history";

describe("nutrition plan history", () => {
  it("a replaced plan ends the day before the new one starts (never before its own start, never later than it ended)", () => {
    expect(replacedEndDate("2026-10-27", "2026-11-27", "2026-11-02")).toBe("2026-11-01");
    expect(replacedEndDate("2026-08-16", null, "2026-11-02")).toBe("2026-11-01");
    expect(replacedEndDate("2026-11-02", "2026-12-02", "2026-11-02")).toBe("2026-11-02");
    expect(replacedEndDate("2026-06-01", "2026-07-01", "2026-11-02")).toBe("2026-07-01");
  });

  it("current plans first, then earlier ones most recently ended first", () => {
    const { current, previous } = splitPlans([
      { id: "a", status: "Archived", start_date: "2026-06-01", end_date: "2026-07-01" },
      { id: "b", status: "Active", start_date: "2026-11-02", end_date: "2026-12-02" },
      { id: "c", status: "Archived", start_date: "2026-07-02", end_date: "2026-11-01" },
    ]);
    expect(current.map((t) => t.id)).toEqual(["b"]);
    expect(previous.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("dates read plainly: the period, and when it was last updated", () => {
    expect(planPeriod({ start_date: "2026-10-27", end_date: "2026-11-27" })).toBe("Oct 27 – Nov 27, 2026");
    expect(planPeriod({ start_date: "2025-12-15", end_date: "2026-01-15" })).toBe("Dec 15, 2025 – Jan 15, 2026");
    expect(planPeriod({ start_date: "2026-08-16", end_date: null })).toBe("Aug 16, 2026 – ongoing");
    expect(planDate("2026-12-02", "2026-11-02")).toBe("Dec 2");
    expect(planDate("2027-01-02", "2026-11-02")).toBe("Jan 2, 2027");
    expect(planUpdatedAt({ last_updated_at: "2026-10-28T10:00:00Z", updated_at: "2026-10-31T00:00:00Z" })).toBe("2026-10-28T10:00:00Z");
    expect(nextPlanDates("2026-11-02")).toEqual({ start_date: "2026-11-02", end_date: "2026-12-02" });
  });

  it("Use again copies the plan under new dates and shares no ids with the old one", () => {
    const old = {
      id: "old", status: "Archived", start_date: "2026-08-16", end_date: "2026-11-01", created_at: "x", updated_at: "y",
      phase: "Fat Loss", water: "3.5 L", client_id: "c1",
      nutrition_target_days: [{ id: "d2", target_id: "old", day_label: "Rest", sort_order: 1 }, { id: "d1", target_id: "old", day_label: "Training", sort_order: 0 }],
    };
    const p = reusePlanPayload(old, { start_date: "2026-11-02", end_date: "2026-12-02" }, "now");
    expect(p).toMatchObject({ status: "Active", start_date: "2026-11-02", end_date: "2026-12-02", phase: "Fat Loss", water: "3.5 L", last_updated_at: "now" });
    expect("id" in p || "created_at" in p || "nutrition_target_days" in p).toBe(false);
    const days = copyPlanDays(old.nutrition_target_days);
    expect(days.map((d) => [d.day_label, d.sort_order, "id" in d, "target_id" in d])).toEqual([["Training", 0, false, false], ["Rest", 1, false, false]]);
  });

  it("the AI plan's days bring their steps and keep when each day is used", () => {
    const days = aiPlanDays(
      [{ day_label: "Training Day", calories: 2040, notes: "Meal 1" }, { day_label: "High Day", calories: 2165 }],
      "DAILY STEPS TARGETS:\nTraining Day: 8,000\nNon Training Day: 8,000\nHigh Day: 9,000\n\nCARDIO SESSIONS:\nTraining Day: none",
      [{ day_label: "training day", use_on: "training", weekdays: ["fri"] }],
    );
    expect(days[0]).toMatchObject({ day_label: "Training Day", calories: 2040, steps: 8000, use_on: "training", weekdays: ["fri"], sort_order: 0 });
    expect(days[1]).toMatchObject({ day_label: "High Day", steps: 9000, sort_order: 1 });
  });
});

describe("publishing a plan never loses the one before it", () => {
  const dialog = readFileSync("src/components/nutrition-target-dialog.tsx", "utf8");
  const panel = readFileSync("src/components/nutrition/NutritionRequestPanel.tsx", "utf8");
  const publish = readFileSync("src/lib/nutrition-targets/plan-publish.ts", "utf8");
  it("the editor, the AI's Update plan and Use again all archive through one helper", () => {
    expect(dialog).toContain('if (form.status === "Active" && (!form.id || initial?.status === "Archived")) {');
    expect(dialog).toContain("archiveReplacedPlans(form.client_id, targetId, form.start_date)");
    expect(publish).toContain("const archived = await archiveReplacedPlans(input.clientId, targetId, dates.start_date);");
    expect(publish).toContain("const archived = await archiveReplacedPlans(clientId, targetId, dates.start_date);");
    expect(publish).not.toMatch(/from\("nutrition_targets"\)\s*\.delete\(\)\s*\.eq\("client_id"/);
  });
  it("Update plan is the default, the editor is the second choice", () => {
    expect(panel).toContain("onClick={() => setPublishOpen(true)}");
    expect(panel).toContain("Review & edit first");
    expect(panel).not.toContain('.update({ status: "Archived" })');
  });
});
