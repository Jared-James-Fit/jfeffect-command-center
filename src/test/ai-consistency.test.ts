/**
 * The Nov 18 2026 AI pass: every AI that writes for the coach runs on the routing table (the
 * OpenAI key, never Lovable credits by default), and the features that touch the same client read
 * the same rules and the same computed context (one calorie step, one cardio cap, one e1RM rule,
 * the nutrition phase in the training brief, the weight-management read in Cleo's nutrition look-up).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROUTES, resolveRoute } from "@/lib/ai/routing";
import { nutritionNowLine } from "@/lib/program-intel/context";
import { TARGETS_PROMPT } from "@/lib/nutrition-ai-prompts";
import { MAX_STEP_KCAL } from "@/lib/weight-management/decision";
import { TRAIN_MINUTES_MAX, TRAIN_MINUTES_MAX_PL } from "@/lib/weight-management/treadmill";

const calls: string[] = [];
vi.mock("@/lib/ai/model-client.server", () => ({
  callModelNow: vi.fn(async (model: string) => {
    calls.push(model);
    if (model === "openai:gpt-5-mini") throw new Error("busy");
    return { text: '{"ok":true}', model, ms: 1, usage: null };
  }),
}));

describe("routing", () => {
  it("every default route is on the OpenAI key; coach-side writing has its own route with a fallback", () => {
    for (const [task, r] of Object.entries(DEFAULT_ROUTES)) for (const m of r.models) expect(m, task).toMatch(/^openai:/);
    expect(DEFAULT_ROUTES.coach_write).toMatchObject({ models: ["openai:gpt-5-mini", "openai:gpt-5.5"], strongOnly: false });
    // an admin override still wins
    expect(resolveRoute("coach_write", { coach_write: ["gateway:google/gemini-3-flash-preview"] }).models).toEqual(["gateway:google/gemini-3-flash-preview"]);
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("askRoute tries the next model when one fails, and says which one answered", async () => {
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const r = await askRoute("coach_write", { system: "s", prompt: "p" }, { override: null });
    expect(calls).toEqual(["openai:gpt-5-mini", "openai:gpt-5.5"]);
    expect(r.model).toBe("openai:gpt-5.5");
  });

  it("the check-in recap, AI drafts, lead texts, inbox Brief and My Voice no longer spend Lovable credits", () => {
    for (const f of ["src/lib/messenger-checkins.functions.ts", "src/lib/submission-reviews.functions.ts", "src/lib/coaching-leads.server.ts", "src/lib/client-brief.functions.ts", "src/lib/coach-voice.functions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain('askRoute("coach_write"');
      expect(src, f).not.toContain("createLovableAiGateway");
    }
    // the picture jobs never fall back to Lovable credits by themselves
    expect(readFileSync("src/lib/post-pictures.server.ts", "utf8").match(/generatePicture\([^)]*\), \{ lovable: false \}\)/g)).toHaveLength(2);
    expect(readFileSync("src/lib/lesson-art.functions.ts", "utf8")).toContain("{ lovable: false }");
  });
});

describe("one set of rules", () => {
  it("the nutrition AI sizes a calorie change and a training-day walk by the weight-management engine's own limits", () => {
    expect(MAX_STEP_KCAL).toBe(250);
    expect(TARGETS_PROMPT).toContain(`a change over ${MAX_STEP_KCAL} kcal a day (the weight-management read's largest single step)`);
    expect(TARGETS_PROMPT).toContain(`keep it 10–${TRAIN_MINUTES_MAX} min easy (${TRAIN_MINUTES_MAX_PL} at most for a powerlifter`);
    expect(TARGETS_PROMPT).not.toContain("10–25 min");
  });

  it("Cleo programs loads and session flow the way the generator does, and reads the weight-management read before changing calories", () => {
    const ctx = readFileSync("src/lib/summer-context.ts", "utf8");
    expect(ctx).toContain("a % only on a competition lift or its barbell variation and only of a max they have on file");
    expect(ctx).toContain("accessories grouped by station");
    expect(ctx).toContain("calories must equal the macros at 4/4/9");
    expect(readFileSync("src/lib/cleo-tools.server.ts", "utf8")).toContain("loadWeightText(db, client_id)");
    expect(readFileSync("src/lib/cleo-program.server.ts", "utf8")).toContain("Check before publishing: ${checks.join(\"; \")}");
  });

  it("check-in replies read one hard session as one session, like the training engine", () => {
    const pc = readFileSync("src/lib/program-context.ts", "utf8");
    expect(pc).toContain("One top set 1+ RPE over plan is one session's read");
    expect(pc).toContain("RPE 7+, 10 reps or fewer");
  });
});

describe("the training AI sees the nutrition plan", () => {
  const days = [
    { label: "Training Day", calories: 2400, protein: 180, carbs: 260, fats: 70 },
    { label: "Rest Day", calories: 2100, protein: 180, carbs: 190, fats: 70 },
  ];
  it("a cut says recovery is the limit; a gain can carry more; maintenance says so; no plan says nothing", () => {
    const cut = nutritionNowLine({ phase: "Fat Loss", goal: "Lose bodyweight", startDate: "2026-11-02", endDate: "2026-11-30", days })!;
    expect(cut).toBe("Nutrition now: Fat Loss since 2026-11-02 (next update due 2026-11-30) · Training Day 2,400 kcal, protein 180 g · Rest Day 2,100 kcal, protein 180 g. In a deficit: recovery is the limit, so hold volume steady rather than add, keep the main lifts heavy enough to keep strength, and read harder RPEs as the cut before the program.");
    expect(nutritionNowLine({ phase: "Muscle Gain", goal: null, startDate: null, endDate: null, days })).toContain("In a surplus");
    expect(nutritionNowLine({ phase: "Maintenance", goal: "Maintain bodyweight", startDate: null, endDate: null, days })).toContain("At maintenance");
    expect(nutritionNowLine(null)).toBeNull();
    expect(nutritionNowLine({ phase: "Fat Loss", goal: null, startDate: null, endDate: null, days: [] })).toBeNull();
  });
});
