import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STALE_RUN_MS, planBusy, planQueued } from "@/lib/nutrition-ai-plans.server";

describe("Nutrition Update AI plans are written in the background", () => {
  it("a plan queued in the last 3 minutes isn't queued again", () => {
    const now = Date.parse("2026-10-27T23:40:00Z");
    expect(planQueued({ status: "pending", updated_at: "2026-10-27T23:38:30Z" }, now)).toBe(true);
    expect(planQueued({ status: "pending", updated_at: "2026-10-27T23:30:00Z" }, now)).toBe(false);
    expect(planQueued({ status: "generating", updated_at: "2026-10-27T23:39:00Z" }, now)).toBe(
      false,
    );
    expect(planBusy({ status: "generating", updated_at: "2026-10-27T23:39:00Z" }, now)).toBe(true);
    expect(STALE_RUN_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("nothing writes a plan inside the caller's request any more", () => {
    const fns = readFileSync("src/lib/nutrition-ai-plans.functions.ts", "utf8");
    const server = readFileSync("src/lib/nutrition-ai-plans.server.ts", "utf8");
    expect(fns).toContain("queueNutritionPlan(sb, data.submissionId");
    expect(fns).not.toMatch(/return runPlan\(/);
    const start = server.slice(server.indexOf("export async function startNutritionPlan"));
    expect(start).toContain("queueNutritionPlan(sb, submissionId)");
    expect(start).not.toContain("runPlan(");
  });

  it("the hook, the queue trigger and the 5-minute job are wired up", () => {
    const hook = readFileSync("src/routes/api/public/hooks/nutrition-plans-tick.ts", "utf8");
    expect(hook).toContain("authorizeHookRequest");
    expect(hook).toContain("runQueuedPlan(");
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain(
      "/api/public/hooks/nutrition-plans-tick",
    );
    const sql = readFileSync(
      "supabase/migrations/20270102100000_nutrition_plans_background.sql",
      "utf8",
    );
    expect(sql).toContain("create trigger nutrition_ai_plans_queue_run");
    expect(sql).toContain("'nutrition-plans-tick'");
    expect(sql).toContain("/api/public/hooks/nutrition-plans-tick");
  });
});
