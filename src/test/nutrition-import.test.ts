import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readAiAnswer, readPlanText, tidyDayLabel, UnreadableAnswer } from "@/lib/nutrition-import/read";
import { indexSource, numbersIn, planGroundingFlags, stem } from "@/lib/nutrition-import/ground";
import { seedFromPlan, seedSummary, useOnFor } from "@/lib/nutrition-import/seed";
import {
  ageOn,
  cleanAnswers,
  createQAs,
  createSafety,
  createTargetsText,
  missingAnswers,
  phaseForGoal,
  restrictionsOf,
  usableTargets,
  type CreateAnswers,
} from "@/lib/nutrition-import/create";
import { draftFlags, importFlags } from "@/lib/nutrition-import/checks";
import { MEAL_IMPORT_RIGHTS_TEXT, MEAL_IMPORT_RIGHTS_TEXT_STAFF, rightsTextFor } from "@/lib/nutrition-import/rights";
import { parseAiTargets } from "@/lib/nutrition-targets/nutrition-intel";
import { answerFor } from "@/lib/nutrition-request";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import { DEFAULT_ROUTES } from "@/lib/ai/routing";

// A plan in the app's paste format, as a coach or ChatGPT writes it.
const PASTE = `PHASE: Fat Loss

TRAINING-DAY MENU

Meal 1
200 g Greek yogurt
40 g oats

Approximate macros:
30 g protein
40 g carbohydrates
6 g fat

Meal 2 (Post-Workout)
150 g cooked chicken breast
200 g cooked white rice

Approximate macros:
50 g protein
58 g carbohydrates
6 g fat

Daily Total
Approximately 80 g protein, 98 g carbohydrates, 12 g fat

NON-TRAINING-DAY MENU

Meal 1
200 g Greek yogurt
40 g oats

Approximate macros:
30 g protein
40 g carbohydrates
6 g fat

Daily Total
Approximately 30 g protein, 40 g carbohydrates, 6 g fat

FOOD-WEIGHING RULES
Weigh rice cooked.`;

// The same kind of plan someone types with no day headers.
const ONE_DAY = `Meal 1: Breakfast
3 eggs
2 slices toast

Meal 2: Lunch
150 g chicken breast
1 cup rice`;

describe("the free path: the app's own reader, no AI", () => {
  it("reads the paste format into days with meals", () => {
    const r = readPlanText(PASTE)!;
    expect(r.wrapped).toBe(false);
    expect(r.days.map((d) => d.day_label)).toEqual(["Training Day", "Non-Training Day"]);
    expect(r.days[0].protein).toBe(80);
  });

  it("reads a plan with no day headers as one day, every day", () => {
    const r = readPlanText(ONE_DAY)!;
    expect(r.wrapped).toBe(true);
    expect(r.days).toHaveLength(1);
    expect(r.days[0].day_label).toBe("Every day");
    expect(r.text.startsWith("DAILY MENU")).toBe(true);
  });

  it("keeps a PHASE line above the added header", () => {
    const r = readPlanText(`PHASE: Muscle Gain\n${ONE_DAY}`)!;
    expect(r.text.startsWith("PHASE: Muscle Gain\n\nDAILY MENU")).toBe(true);
  });

  it("needs foods with amounts: sentences or a bare list go to a full read", () => {
    expect(readPlanText("Breakfast: eggs and toast\nLunch: chicken and rice")).toBeNull();
    expect(readPlanText("chicken, rice, broccoli")).toBeNull();
    expect(readPlanText("")).toBeNull();
    // a menu with no meals in it doesn't count
    expect(readPlanText("TRAINING DAY MENU\nEat well.")).toBeNull();
  });

  it("names days the way a person writes them", () => {
    expect(tidyDayLabel("DAILY")).toBe("Every day");
    expect(tidyDayLabel("Every-Day")).toBe("Every day");
    expect(tidyDayLabel("MONDAY")).toBe("Monday");
    expect(tidyDayLabel("Non-Training Day")).toBe("Non-Training Day");
  });
});

describe("an AI read, read back", () => {
  it("takes the plan, what it wasn't sure of and the transcript", () => {
    const a = readAiAnswer(
      `<<<TRANSCRIPT\nBreakfast 3 eggs\nPHOTO TEXT\nTRANSCRIPT>>>\n<<<PLAN\nDAILY MENU\n\nMeal 1: Breakfast\n3 eggs\nPLAN>>>\n<<<UNSURE\n- Meal 1: the egg count is blurry\n- none\nUNSURE>>>`,
    );
    expect(a.read.days[0].day_label).toBe("Every day");
    expect(a.unsure).toEqual(["Meal 1: the egg count is blurry"]);
    expect(a.transcript).toBe("Breakfast 3 eggs\nPHOTO TEXT");
  });

  it("reads an answer cut off mid-section, and one with no markers", () => {
    expect(readAiAnswer("<<<PLAN\nDAILY MENU\n\nMeal 1\n3 eggs\n").read.days).toHaveLength(1);
    expect(readAiAnswer("```\nDAILY MENU\n\nMeal 1\n**3 eggs**\n```").read.days).toHaveLength(1);
  });

  it("refuses an answer with no meals", () => {
    expect(() => readAiAnswer("<<<PLAN\nSorry, I can't read this.\nPLAN>>>")).toThrow(UnreadableAnswer);
  });
});

describe("grounding: every number and food word must be in the source", () => {
  it("reads numbers every way they're written", () => {
    expect(numbersIn("½ bagel")).toEqual([0.5]);
    expect(numbersIn("1 1/2 cups")).toEqual([1.5]);
    expect(numbersIn("1,200 kcal")).toEqual([1200]);
    expect(numbersIn("1,5 kg")).toEqual([1.5]);
    // the source is read generously: a fraction's parts, words, both readings of a comma
    expect(numbersIn("half a bagel and two eggs", true)).toEqual(expect.arrayContaining([0.5, 1, 2]));
    expect(numbersIn("1,200", true)).toEqual(expect.arrayContaining([1200, 1.2]));
  });

  it("folds plurals so eggs is egg", () => {
    expect(stem("eggs")).toBe("egg");
    expect(stem("berries")).toBe("berry");
    expect(stem("potatoes")).toBe("potato");
    expect(indexSource("3 Eggs").words.has("egg")).toBe(true);
  });

  it("passes a plan copied from its source", () => {
    const plan = readPlanText(ONE_DAY)!.text;
    expect(planGroundingFlags(plan, ONE_DAY)).toEqual([]);
  });

  it("flags a number and a food word the source doesn't have", () => {
    const plan = `DAILY MENU\n\nMeal 1: Breakfast\n4 eggs\n2 slices toast\n\nMeal 2: Lunch\n150 g cooked chicken breast\n1 cup rice\n\nDaily Total\nApproximately 90 g protein, 60 g carbohydrates, 20 g fat`;
    const flags = planGroundingFlags(plan, ONE_DAY);
    const texts = flags.map((f) => f.text);
    expect(texts.some((t) => t.includes("4 in \"4 eggs\""))).toBe(true);
    expect(texts.some((t) => t.includes('"cooked" in "150 g cooked chicken breast"'))).toBe(true);
    // a total the plan never gave
    expect(texts.some((t) => t.includes("90"))).toBe(true);
    expect(flags.every((f) => f.level === "check")).toBe(true);
  });

  it("never checks the format's own meal numbers or headers", () => {
    const plan = `DAILY MENU\n\nMeal 1: Breakfast\n3 eggs\n\nMeal 2: Lunch\n1 cup rice\n\nMeal 3: Dinner\n2 slices toast`;
    expect(planGroundingFlags(plan, "Breakfast 3 eggs\nLunch 1 cup rice\nDinner 2 slices toast")).toEqual([]);
  });

  it("a fraction written another way still matches", () => {
    const plan = `DAILY MENU\n\nMeal 1\n½ bagel`;
    expect(planGroundingFlags(plan, "Meal 1 1/2 bagel")).toEqual([]);
  });

  it("says when there was nothing to check against", () => {
    expect(planGroundingFlags(ONE_DAY, null)[0].code).toBe("unchecked");
  });
});

describe("the parse → Studio seed mapping", () => {
  it("keeps each day's text and its own numbers for an import", () => {
    const seed = seedFromPlan(PASTE)!;
    expect(seed.phase).toBe("Fat Loss");
    expect(seed.weighing).toBe("Weigh rice cooked.");
    expect(seed.days.map((d) => [d.day_label, d.use_on])).toEqual([
      ["Training Day", "training"],
      ["Non-Training Day", "rest"],
    ]);
    expect(seed.days[0]).toMatchObject({ protein: 80, carbs: 98, fats: 12, calories: 80 * 4 + 98 * 4 + 12 * 9, weekdays: null });
    expect(seed.days[0].notes).toContain("150 g cooked chicken breast");
    expect(seed.days[0].notes).not.toContain("TRAINING-DAY MENU");
  });

  it("one day is every day", () => {
    const seed = seedFromPlan(ONE_DAY)!;
    expect(seed.days).toHaveLength(1);
    expect(seed.days[0]).toMatchObject({ day_label: "Every day", use_on: "every_day", calories: null });
    expect(seed.phase).toBeNull();
  });

  it("a Cleo draft carries the member's own targets on every day", () => {
    const t = { calories: 2200, protein_g: 160, carbs_g: 230, fat_g: 70 };
    const seed = seedFromPlan(PASTE, { targets: t })!;
    expect(seed.days.every((d) => d.calories === 2200 && d.protein === 160 && d.carbs === 230 && d.fats === 70)).toBe(true);
  });

  it("says how many meals each day has", () => {
    expect(seedSummary(seedFromPlan(PASTE)!).map((d) => d.meals)).toEqual([2, 1]);
  });

  it("reads when a day is used from its name", () => {
    expect(useOnFor("High Day")).toBe("high");
    expect(useOnFor("Rest day")).toBe("rest");
    expect(useOnFor("Monday")).toBeNull();
    expect(seedFromPlan("nothing here")).toBeNull();
  });
});

describe("Create with Cleo: decided in code before any model", () => {
  const base: CreateAnswers = cleanAnswers({
    mealsPerDay: 4,
    trainingDays: 4,
    trainingTime: "Evening (5–8 PM)",
    likes: ["Chicken", "Rice", "Not a chip"],
    likesText: "  salmon  ",
    avoid: ["Shellfish"],
    avoidText: "",
    diet: "No restrictions",
    cooking: "meal_prep",
    budget: "tight",
    health: ["none"],
  });

  it("keeps only the choices offered", () => {
    expect(base.likes).toEqual(["Chicken", "Rice"]);
    expect(base.likesText).toBe("salmon");
    expect(cleanAnswers({ mealsPerDay: 12, trainingDays: -2, trainingTime: "Noon" })).toMatchObject({ mealsPerDay: 6, trainingDays: 0, trainingTime: null });
    expect(cleanAnswers({ health: ["none", "pregnant"] }).health).toEqual(["pregnant"]);
    expect(missingAnswers({ mealsPerDay: 4, trainingDays: 3, health: [] })).toEqual(["time", "health"]);
  });

  it("writes no draft for anyone under 18, pregnant, with an eating disorder or a medical condition", () => {
    expect(createSafety(base, { age: 30, healthTexts: [] })).toEqual({ ok: true });
    expect(createSafety({ ...base, health: ["under_18"] }, { age: null, healthTexts: [] })).toMatchObject({ ok: false, reason: "minor" });
    expect(createSafety(base, { age: 16, healthTexts: [] })).toMatchObject({ ok: false, reason: "minor" });
    expect(createSafety({ ...base, health: ["pregnant"] }, { age: 30, healthTexts: [] })).toMatchObject({ ok: false, reason: "pregnancy" });
    expect(createSafety({ ...base, health: ["medical"] }, { age: 30, healthTexts: [] })).toMatchObject({ ok: false, reason: "medical" });
    // named on file or in their own words
    expect(createSafety(base, { age: 30, healthTexts: ["Type 2 diabetes, metformin"] })).toMatchObject({ ok: false, reason: "medical" });
    expect(createSafety({ ...base, avoidText: "I'm on Ozempic" }, { age: 30, healthTexts: [] })).toMatchObject({ ok: false, reason: "medical" });
    // an eating disorder first, whatever else is said, and its message never points at counting food
    const ed = createSafety({ ...base, health: ["eating_disorder", "medical"] }, { age: 30, healthTexts: [] });
    expect(ed).toMatchObject({ ok: false, reason: "eating_disorder" });
    expect((ed as any).message).not.toMatch(/import|build|count/i);
    // "None" answers never count
    expect(createSafety({ ...base, avoidText: "none" }, { age: 30, healthTexts: ["none"] })).toEqual({ ok: true });
  });

  it("works out age from a birth date", () => {
    expect(ageOn("2010-06-01", new Date("2026-11-22"))).toBe(16);
    expect(ageOn("2008-11-23", new Date("2026-11-22"))).toBe(17);
    expect(ageOn("2008-11-22", new Date("2026-11-22"))).toBe(18);
    expect(ageOn(null)).toBeNull();
  });

  it("knows what the plan must never hold: chips, words and the diet's rules", () => {
    const r = restrictionsOf({ avoid: ["Shellfish", "Pork"], avoidText: "allergic to peanuts", diet: "Vegetarian" });
    expect(r.categories).toEqual(expect.arrayContaining(["Shellfish", "Pork", "Peanuts", "Meat", "Fish"]));
    expect(r.label).toContain("diet: Vegetarian");
    expect(restrictionsOf({ avoid: [], avoidText: "", diet: "No restrictions" })).toEqual({ categories: [], label: null });
  });

  it("puts their answers where the meal-plan writer's questions read them", () => {
    const qas = createQAs(base);
    expect(answerFor(qas, "how many meals") || answerFor(qas, "meals per day")).toBe("4");
    expect(answerFor(qas, "training days")).toBe("4");
    expect(answerFor(qas, "time", "train")).toBe("Evening (5–8 PM)");
    expect(answerFor(qas, "allerg")).toBe("Shellfish");
    expect(answerFor(qas, "foods you love")).toBe("Chicken, Rice, salmon");
    expect(answerFor(createQAs({ ...base, trainingDays: 0, trainingTime: null }), "time", "train")).toBe("They don't train");
  });

  it("writes their own targets in the targets block, which reads back exactly", () => {
    const text = createTargetsText({ calories: 2200, protein_g: 160, carbs_g: 230, fat_g: 70 });
    expect(parseAiTargets(text)).toEqual([{ label: "Every Day", kcal: 2200, protein: 160, carbs: 230, fat: 70 }]);
    expect(phaseForGoal("lose")).toBe("Fat Loss");
    expect(phaseForGoal("gain")).toBe("Muscle Gain");
    expect(phaseForGoal(null)).toBe("Maintenance");
    expect(usableTargets({ calories: 2200, protein_g: 160, carbs_g: 230, fat_g: 70 })).not.toBeNull();
    expect(usableTargets({ calories: 600, protein_g: 60, carbs_g: 50, fat_g: 20 })).toBeNull();
    expect(usableTargets(null)).toBeNull();
  });
});

describe("the checks that ride along", () => {
  it("an import whose Daily Total isn't its meals, or with no macros, says so", () => {
    const off = PASTE.replace("Approximately 80 g protein", "Approximately 120 g protein");
    expect(importFlags(off).some((f) => f.code === "totals")).toBe(true);
    expect(importFlags(PASTE).filter((f) => f.code === "totals")).toEqual([]);
    expect(importFlags(readPlanText(ONE_DAY)!.text).map((f) => f.code)).toEqual(["no_macros"]);
  });

  it("a draft with a food they avoid, a hard-to-find food or meals short of their targets says so", () => {
    const plan = `EVERY-DAY MENU\n\nMeal 1\n150 g cooked shrimp\n200 g cooked cassava\n\nApproximate macros:\n30 g protein\n60 g carbohydrates\n3 g fat\n\nDaily Total\nApproximately 30 g protein, 60 g carbohydrates, 3 g fat`;
    const flags = draftFlags(plan, { answers: [], avoid: ["Shellfish"], targets: { calories: 2200, protein_g: 160, carbs_g: 230, fat_g: 70 }, mealPrep: true });
    expect(flags.map((f) => f.code)).toEqual(expect.arrayContaining(["allergen", "hard_to_find", "coverage"]));
  });
});

describe("rights, credits and the route", () => {
  it("asks the member and the coach in their own words", () => {
    expect(rightsTextFor("member")).toBe(MEAL_IMPORT_RIGHTS_TEXT);
    expect(rightsTextFor("staff")).toBe(MEAL_IMPORT_RIGHTS_TEXT_STAFF);
    for (const t of [MEAL_IMPORT_RIGHTS_TEXT, MEAL_IMPORT_RIGHTS_TEXT_STAFF]) expect(t.length).toBeGreaterThanOrEqual(20);
  });

  it("costs the same in the app and the database", () => {
    const sql = readFileSync("supabase/migrations/20270508091000_nutrition_imports.sql", "utf8");
    expect(sql).toContain(`WHEN 'nutrition_import' THEN ${FEATURE_COSTS.nutrition_import}`);
    expect(sql).toContain(`WHEN 'nutrition_create' THEN ${FEATURE_COSTS.nutrition_create}`);
  });

  it("reads a plan on the OpenAI key: GPT-5.5, then GPT-6 Astra", () => {
    expect(DEFAULT_ROUTES.nutrition_import.models).toEqual(["openai:gpt-5.5", "openai:gpt-6-astra"]);
  });
});

describe("the prompts (server only)", () => {
  const a = cleanAnswers({
    mealsPerDay: 5,
    trainingDays: 0,
    likes: ["Chicken"],
    avoid: ["Dairy"],
    diet: "Vegetarian",
    cooking: "simple",
    budget: "tight",
    health: ["none"],
  });
  const t = { calories: 2400, protein_g: 170, carbs_g: 260, fat_g: 75, goal: "gain" };

  it("a draft is written to the member's own targets, one menu, their answers as the client details", async () => {
    const { createUserPrompt, CREATE_SYSTEM } = await import("@/lib/nutrition-import/create-prompt.server");
    const { MEAL_PLAN_PROMPT } = await import("@/lib/nutrition-ai-prompts.server");
    const p = createUserPrompt(a, t);
    expect(CREATE_SYSTEM).toBe(MEAL_PLAN_PROMPT);
    expect(p).toContain("Every Day: 2400");
    expect(p).toContain("Protein: 170 g");
    expect(p).toContain("Phase / goal: Muscle Gain");
    expect(p).toContain("- Meals per day: 5");
    expect(p).toContain("on file: Vegetarian");
    expect(p).toContain("EVERY-DAY MENU");
    // they don't train: no workout meals
    expect(p).toContain("COACH WORKOUT MEALS: Do NOT tag");
    expect(p).toContain("cheapest staples");
    expect(p).toContain("nothing that needs a batch cook");
    // trains: the meals around training are placed, one menu still
    const p2 = createUserPrompt({ ...a, trainingDays: 4, trainingTime: "Evening (5–8 PM)", cooking: "meal_prep" }, t);
    expect(p2).toContain("Trains in the evening");
    expect(p2).not.toContain("COACH WORKOUT MEALS");
  });

  it("an import is only copied: a text one sends its text, a PDF asks for the transcript", async () => {
    const { MEAL_IMPORT_SYSTEM, mealImportPrompt } = await import("@/lib/nutrition-import/ai-prompt.server");
    expect(MEAL_IMPORT_SYSTEM).toContain("You only copy");
    expect(MEAL_IMPORT_SYSTEM).toContain('Never add a word like "cooked"');
    const text = mealImportPrompt({ fileName: "plan.docx", text: "Meal 1 3 eggs", kind: "docx" });
    expect(text).toContain("Meal 1 3 eggs");
    expect(text).toContain("no TRANSCRIPT");
    expect(mealImportPrompt({ fileName: "plan.pdf", text: null, kind: "pdf" })).toContain("TRANSCRIPT first");
  });
});

describe("filing a saved import's original", () => {
  it("each page gets a stable link, the first the import's own id", async () => {
    const { pageLinkId, originalTitle } = await import("@/lib/nutrition-import/import.server");
    const id = "6f1c3b0e-6f1c-4b0e-8f1c-3b0e6f1c3b0e";
    expect(await pageLinkId(id, 0)).toBe(id);
    const p1 = await pageLinkId(id, 1);
    expect(p1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await pageLinkId(id, 1)).toBe(p1);
    expect(await pageLinkId(id, 2)).not.toBe(p1);
    expect(originalTitle({ file_name: "Coach plan.pdf", source_kind: "pdf" }, 0, 1)).toBe("Coach plan");
    expect(originalTitle({ file_name: "3 photos", source_kind: "image" }, 1, 3)).toBe("3 photos (2 of 3)");
    expect(originalTitle({ file_name: null, source_kind: "image" }, 0, 2)).toBe("Meal plan photos (1 of 2)");
  });

  it("files each photo, a paste as text, and nothing for a draft, with the rights it was imported under", async () => {
    vi.resetModules();
    const calls: any[] = [];
    vi.doMock("@/lib/documents/documents.server", () => ({
      recordDocument: async (_admin: unknown, input: any) => {
        calls.push(input);
        return { ok: true, document: { id: `doc-${calls.length}` }, existing: false };
      },
    }));
    const { fileImportOriginals } = await import("@/lib/nutrition-import/import.server");
    const base = {
      id: "6f1c3b0e-6f1c-4b0e-8f1c-3b0e6f1c3b0e",
      kind: "import" as const,
      file_name: "3 photos",
      source_text: null,
      rights_text: MEAL_IMPORT_RIGHTS_TEXT,
      rights_confirmed_at: "2026-11-22T19:00:00Z",
      files_deleted_at: null,
    };
    const photos = await fileImportOriginals(
      {} as any,
      { ...base, source_kind: "image", file_paths: ["u/f/1.jpg", "u/f/2.jpg", "u/f/3.jpg"] },
      { userId: "00000000-0000-0000-0000-0000000000e1", clientId: "00000000-0000-0000-0000-0000000c1e01" },
    );
    expect(photos).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(calls[0]).toMatchObject({
      category: "nutrition_plan",
      visibility: "private",
      source: "import",
      linkedKind: "nutrition_import",
      linkedId: base.id,
      title: "3 photos (1 of 3)",
      rights: { text: MEAL_IMPORT_RIGHTS_TEXT, confirmedAt: "2026-11-22T19:00:00Z" },
      file: { bucket: "nutrition-imports", path: "u/f/1.jpg" },
    });
    expect(new Set(calls.map((c) => c.linkedId)).size).toBe(3);
    calls.length = 0;
    await fileImportOriginals({} as any, { ...base, file_name: null, source_kind: "text", file_paths: [], source_text: "Meal 1\n3 eggs" }, { userId: "u", clientId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ title: "Pasted meal plan", file: { name: "pasted-meal-plan.txt", mime: "text/plain" } });
    calls.length = 0;
    expect(await fileImportOriginals({} as any, { ...base, kind: "create", source_kind: "answers", file_paths: [] }, { userId: "u", clientId: null })).toEqual([]);
    expect(calls).toHaveLength(0);
    vi.doUnmock("@/lib/documents/documents.server");
  });

  it("the original is filed once the plan is saved, never before", () => {
    const start = readFileSync("src/components/nutrition-studio/studio-start.tsx", "utf8");
    expect(start).toContain("<MemberPlanStudio");
    expect(start).toContain("markSaved({ data: { id: editing.importId, targetId: planId } })");
    const studio = readFileSync("src/components/nutrition-studio/member-plan-studio.tsx", "utf8");
    expect(studio).toContain("if (onSaved) await Promise.resolve(onSaved(id!)).catch(() => undefined);");
    const fns = readFileSync("src/lib/nutrition-import/import.functions.ts", "utf8");
    // filed first, its files deleted after
    expect(fns.indexOf("fileImportOriginals(sb, imp")).toBeLessThan(fns.indexOf("deleteMealImportFiles(sb, imp.id, imp.file_paths ?? []);\n    return { ok: true, documents"));
    const server = readFileSync("src/lib/nutrition-import/import.server.ts", "utf8");
    expect(server).toContain('category: "nutrition_plan"');
    expect(server).toContain('visibility: "private"');
    expect(server).toContain('linkedKind: "nutrition_import"');
  });
});

describe("the hook points", () => {
  it("the coach's plan editor imports a file into the same days the paste box fills, Save still its only red button", () => {
    const dialog = readFileSync("src/components/nutrition-target-dialog.tsx", "utf8");
    expect(dialog).toContain("<PlanFileImport clientId={form.client_id || clientId || null}");
    expect(dialog).toMatch(/<MealPlanBulkPaste\s+clientId=/);
    const coach = readFileSync("src/components/nutrition-studio/plan-file-import.tsx", "utf8");
    expect(coach).toContain('audience="staff"');
    // every button there is outline or ghost
    expect(coach.match(/<Button\b/g)?.length).toBe(coach.match(/<Button\b[^>]*variant="(outline|ghost)"/g)?.length);
    const picker = readFileSync("src/components/nutrition-studio/plan-source-picker.tsx", "utf8");
    expect(picker).toContain('variant={member ? "default" : "outline"}');
  });

  it("a coach's import is never charged; a member's is", () => {
    const fns = readFileSync("src/lib/nutrition-import/import.functions.ts", "utf8");
    expect(fns).toContain('if (data.audience === "member") {');
    expect(fns).toContain('_feature: "nutrition_import"');
    expect(fns).toContain('_feature: "nutrition_create"');
  });

  it("no AI icon, and Cleo says what it is where the member meets it", () => {
    for (const f of ["cleo-questions.tsx", "studio-start.tsx", "plan-source-picker.tsx", "plan-preview.tsx", "plan-file-import.tsx"]) {
      const src = readFileSync(`src/components/nutrition-studio/${f}`, "utf8");
      expect(src, f).not.toMatch(/\b(Sparkles?|Wand2?|WandSparkles|Bot|Brain|BrainCircuit)\b/);
    }
    const q = readFileSync("src/components/nutrition-studio/cleo-questions.tsx", "utf8");
    expect(q).toContain("<CleoAvatar />");
    expect(q).toContain("{CLEO_ROLE_LINE}");
  });

  it("AGENTS.md records the one member-facing Cleo", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    expect(agents).toContain("Create with Cleo is the one place a member meets Cleo");
  });
});
