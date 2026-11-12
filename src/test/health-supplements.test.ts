import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adviseSupplements, planSupplementsFrom, readPlanSupplements, supplementsForAi, type SupplementInput } from "@/lib/nutrition-targets/supplements";
import { supplementInput, checkinFlags } from "@/lib/nutrition-targets/supplement-input";
import { buildHealthProfile, classifyHealthText, clientVisible, healthProfileForAi, healthSummary, type HealthItem } from "@/lib/health/health-profile";
import { buildFoodHistory, splitHealthParts } from "@/lib/nutrition-targets/food-history";
import { healthProfileFromRecords } from "@/lib/health/health-load";

const read = (p: string) => readFileSync(p, "utf8");

const base = (x: Partial<SupplementInput> = {}): SupplementInput => ({
  sex: "male",
  age: 30,
  weightKg: 85,
  lifts: true,
  competes: false,
  drugTested: null,
  diets: [],
  allergies: [],
  health: "",
  medications: "",
  takes: "",
  foods: "150 g chicken breast, 200 g white rice, 100 g broccoli, 3 whole eggs, Greek yogurt",
  planGiven: true,
  kcal: 2600,
  budget: "essentials",
  ...x,
});
const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);
const allText = (a: ReturnType<typeof adviseSupplements>) =>
  JSON.stringify([a.picks, a.extras, a.skipped, a.notes]);

describe("supplement advice: food first, only what's worth it", () => {
  it("a healthy lifter on the essentials gets creatine and vitamin D, the rest as extras", () => {
    const a = adviseSupplements(base());
    expect(keys(a.picks)).toEqual(["creatine", "vitamin_d"]);
    expect(a.picks[0]).toMatchObject({ tier: "core", dose: "5 g a day", cost: "$" });
    expect(a.picks[1].dose).toBe("1,000–2,000 IU (25–50 mcg) a day");
    expect(keys(a.extras)).toEqual(["omega3", "protein", "caffeine"]);
    expect(keys(a.picks)).not.toContain("magnesium");
  });

  it("a smaller lifter gets 3–5 g of creatine; 'open' puts every extra on the list", () => {
    const a = adviseSupplements(base({ weightKg: 58, budget: "open" }));
    expect(a.picks.find((p) => p.key === "creatine")!.dose).toBe("3–5 g a day");
    expect(a.extras).toEqual([]);
    expect(keys(a.picks)).toEqual(expect.arrayContaining(["omega3", "protein", "caffeine"]));
  });

  it("fatty fish or whey already in the plan: no omega-3 or protein powder", () => {
    const a = adviseSupplements(base({ foods: "150 g salmon, 200 g rice, 1 scoop whey protein" }));
    expect(keys([...a.picks, ...a.extras])).not.toContain("omega3");
    expect(keys([...a.picks, ...a.extras])).not.toContain("protein");
    expect(a.skipped.map((s) => s.name)).toEqual(expect.arrayContaining(["Omega-3", "Protein powder"]));
  });

  it("a vegan woman: B12 core, algae oil, iron only after a blood test, calcium, plant protein", () => {
    const a = adviseSupplements(base({ sex: "female", weightKg: 62, diets: ["Vegan"], foods: "tofu, rice, lentils, oat milk" }));
    expect(a.picks.find((p) => p.key === "b12")).toMatchObject({ tier: "core" });
    expect(a.picks.find((p) => p.key === "iron")).toMatchObject({ tier: "check", name: "Iron (only after a blood test)" });
    expect(keys(a.picks)).toContain("calcium");
    expect(keys(a.picks)).toContain("multivitamin");
    expect([...a.picks, ...a.extras].find((p) => p.key === "omega3")!.name).toBe("Algae oil (omega-3)");
    expect(a.extras.find((p) => p.key === "protein")!.name).toBe("Plant protein powder (pea and rice)");
  });

  it("calcium only when dairy is really out: a diet, an allergy, or a meal plan without it", () => {
    expect(keys(adviseSupplements(base({ foods: "I eat anything", planGiven: false })).picks)).not.toContain("calcium");
    expect(keys(adviseSupplements(base({ foods: "Meal 1: 150 g chicken, 200 g rice. Meal 2: 150 g beef, 300 g potatoes", planGiven: true })).picks)).toContain("calcium");
    expect(keys(adviseSupplements(base({ foods: "chicken, rice, Greek yogourt", planGiven: true })).picks)).not.toContain("calcium");
    expect(keys(adviseSupplements(base({ foods: "I eat anything", planGiven: false, diets: ["Dairy-free"] })).picks)).toContain("calcium");
  });

  it("AIP or paleo: a protein powder that fits (beef isolate, not pea and rice or whey)", () => {
    const a = adviseSupplements(base({ sex: "female", diets: ["AIP"], allergies: [], budget: "open" }));
    expect(a.picks.find((p) => p.key === "protein")!.name).toBe("Beef protein isolate");
    expect(keys(a.picks)).toEqual(expect.arrayContaining(["calcium", "multivitamin", "magnesium"]));
  });

  it("men never get iron unless anemia is on file", () => {
    expect(keys(adviseSupplements(base({ diets: ["Vegetarian"] })).picks)).not.toContain("iron");
    expect(adviseSupplements(base({ health: "iron deficiency anemia" })).picks.find((p) => p.key === "iron")?.tier).toBe("check");
  });

  it("a kidney condition rules out creatine and magnesium", () => {
    const a = adviseSupplements(base({ health: "chronic kidney disease, constipation" }));
    expect(keys(a.picks)).not.toContain("creatine");
    expect(keys([...a.picks, ...a.extras])).not.toContain("magnesium");
    expect(a.skipped.map((s) => s.name)).toEqual(expect.arrayContaining(["Creatine", "Magnesium"]));
    expect(a.notes.some((n) => n.for === "coach" && /doctor/.test(n.text))).toBe(true);
  });

  it("pregnancy switches to doctor-first: a prenatal, DHA to ask about, no creatine", () => {
    const a = adviseSupplements(base({ sex: "female", health: "Pregnant, 14 weeks" }));
    expect(keys(a.picks)).toEqual(["prenatal", "omega3"]);
    expect(a.picks[1].tier).toBe("check");
    expect(a.skipped.map((s) => s.name)).toContain("Creatine");
    expect(a.notes.map((n) => n.text).join(" ")).toMatch(/300 mg a day or less/);
  });

  it("under 18: vitamin D only", () => {
    const a = adviseSupplements(base({ age: 16 }));
    expect(keys(a.picks)).toEqual(["vitamin_d"]);
    expect(a.extras).toEqual([]);
  });

  it("drug-tested: certified products, a TUE check for an ADHD stimulant, no caffeine with it", () => {
    const a = adviseSupplements(base({ drugTested: true, medications: "Vyvanse 30 mg" }));
    expect(a.tested).toBe(true);
    // said once, under the list, not on every item
    expect(a.notes.filter((n) => /NSF Certified for Sport or Informed Sport/.test(n.text))).toHaveLength(1);
    expect(a.picks.find((p) => p.key === "creatine")!.note).not.toMatch(/NSF/);
    const client = a.notes.filter((n) => n.for === "client").map((n) => n.text).join(" ");
    expect(client).toMatch(/strict|contaminated/);
    expect(client).toMatch(/Global DRO/);
    expect(client).toMatch(/an ADHD stimulant/);
    expect(client).toMatch(/nothing guarantees a clean test/);
    expect(keys([...a.picks, ...a.extras])).not.toContain("caffeine");
  });

  it("someone who competes with testing not set gets a note for the coach", () => {
    const a = adviseSupplements(base({ competes: true }));
    expect(a.notes.find((n) => n.for === "coach")?.text).toMatch(/drug-tested/);
  });

  it("a blood thinner puts omega-3 behind their doctor", () => {
    const a = adviseSupplements(base({ medications: "apixaban (Eliquis)" }));
    const o = [...a.picks, ...a.extras].find((p) => p.key === "omega3")!;
    expect(o.tier).toBe("check");
    expect(o.note).toMatch(/blood thinner/);
    expect(keys(a.picks)).toContain("omega3");
  });

  it("several medications that may need a TUE are named together", () => {
    const a = adviseSupplements(base({ drugTested: true, medications: "insulin, lasix" }));
    expect(a.notes.map((n) => n.text).join(" ")).toMatch(/check insulin and a diuretic \(water pill\) on Global DRO \(globaldro\.com\): each may need/);
  });

  it("what they take that isn't worth it is named, and stopped while tested", () => {
    const a = adviseSupplements(base({ drugTested: true, takes: "BCAAs, a fat burner, creatine 5 g" }));
    const bcaa = a.skipped.find((s) => s.name.startsWith("BCAAs"))!;
    const burner = a.skipped.find((s) => s.name.startsWith("Fat burners"))!;
    expect(bcaa.reason).not.toMatch(/Stop it/);
    expect(burner.reason).toMatch(/Stop it while drug-tested/);
    expect(a.picks.find((p) => p.key === "creatine")!.already).toBe(true);
  });

  it("thyroid medication: minerals 4 hours away", () => {
    const a = adviseSupplements(base({ sex: "female", diets: ["Dairy-free"], medications: "levothyroxine 100 mcg" }));
    expect(keys(a.picks)).toContain("calcium");
    expect(a.notes.map((n) => n.text).join(" ")).toMatch(/4 hours away from your thyroid medication/);
  });

  it("a weigh-in within 6 weeks: start creatine after the meet", () => {
    const a = adviseSupplements(base({ competes: true, meetInDays: 30, weightClass: true }));
    const c = [...a.picks, ...a.extras].find((p) => p.key === "creatine")!;
    expect(c.tier).toBe("consider");
    expect(c.timing).toMatch(/Start after your meet/);
    // already taking it: keep it steady
    expect(adviseSupplements(base({ meetInDays: 30, weightClass: true, takes: "creatine" })).picks.find((p) => p.key === "creatine")!.tier).toBe("core");
  });

  it("sleep flagged most weeks: magnesium as an extra on the essentials, on the list with some budget", () => {
    const checkins = { total: 8, sleep: 4, digestion: 0, energy: 0 };
    expect(keys(adviseSupplements(base({ checkins })).extras)).toContain("magnesium");
    expect(keys(adviseSupplements(base({ checkins, budget: "some" })).picks)).toContain("magnesium");
    // one bad week isn't a pattern
    expect(keys([...adviseSupplements(base({ checkins: { total: 8, sleep: 1, digestion: 0, energy: 0 } })).extras])).not.toContain("magnesium");
  });

  it("a GLP-1: fibre, a multivitamin and electrolytes, and the GLP-1 note", () => {
    const a = adviseSupplements(base({ medications: "Ozempic 0.5 mg weekly" }));
    expect(keys(a.picks)).toEqual(expect.arrayContaining(["fibre", "multivitamin"]));
    expect(keys([...a.picks, ...a.extras])).toContain("electrolytes");
    expect(a.notes.map((n) => n.text).join(" ")).toMatch(/On a GLP-1/);
  });

  it("IBS or digestion flagged: psyllium and the gut-health note", () => {
    const a = adviseSupplements(base({ health: "IBS" }));
    expect(a.picks.find((p) => p.key === "fibre")!.why).toMatch(/gentle on IBS/);
    expect(a.notes.map((n) => n.text).join(" ")).toMatch(/Gut health first/);
  });

  it("caffeine dose follows bodyweight and is skipped with a heart condition", () => {
    expect(adviseSupplements(base({ weightKg: 120, budget: "open" })).picks.find((p) => p.key === "caffeine")!.dose).toBe("About 250–300 mg (a coffee has about 100 mg)");
    expect(adviseSupplements(base({ weightKg: 50, budget: "open" })).picks.find((p) => p.key === "caffeine")!.dose).toBe("About 100–150 mg (a coffee has about 100 mg)");
    expect(keys([...adviseSupplements(base({ health: "high blood pressure" })).extras])).not.toContain("caffeine");
  });

  it("never an em dash, a megadose or a guarantee", () => {
    const cases = [
      base(),
      base({ sex: "female", diets: ["Vegan"], budget: "open" }),
      base({ drugTested: true, medications: "insulin, lasix", takes: "pre-workout, test booster" }),
      base({ health: "pregnant" }),
      base({ medications: "ozempic, omeprazole, metformin", health: "IBS, osteoporosis" }),
    ];
    for (const c of cases) {
      const t = allText(adviseSupplements(c));
      expect(t).not.toMatch(/—/);
      // only ever "nothing guarantees a clean test"
      expect(t).not.toMatch(/(?<!nothing )guarantee(s|d)? (a )?(clean|safe)/i);
      expect(t).not.toMatch(/10,000 IU|5,000 IU/);
    }
  });

  it("the published list and the AI's read", () => {
    const a = adviseSupplements(base({ drugTested: true }));
    const pub = planSupplementsFrom(a);
    expect(pub.items.map((i) => i.name)).toEqual(["Creatine monohydrate", "Vitamin D3"]);
    expect(pub.notes.length).toBeGreaterThan(0);
    // only the client's lines are published
    expect(pub.notes.join(" ")).not.toMatch(/set whether they're drug-tested/);
    expect(readPlanSupplements(JSON.parse(JSON.stringify(pub)))).toEqual(pub);
    expect(readPlanSupplements(null)).toEqual({ items: [], notes: [] });
    const ai = supplementsForAi(a);
    expect(ai).toMatch(/^SUPPLEMENTS/);
    expect(ai).toMatch(/Creatine monohydrate: 5 g a day \[core/);
    expect(ai).toMatch(/If budget allows: /);
  });
});

const item = (x: Partial<HealthItem>): HealthItem => ({
  id: x.id ?? "i1",
  client_id: "c1",
  kind: "injury",
  label: "Knee",
  details: null,
  body_area: null,
  status: "active",
  since: null,
  resolved_on: null,
  source: "coach",
  coach_only: false,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...x,
});

const update = (at: string, answers: Record<string, string>) => ({
  at: `${at}T18:00:00Z`,
  answers: [
    { label: "Any allergies? list all and explain", value: answers.allergy ?? "" },
    { label: "Any health conditions, injuries or medications? List them, or write none.", value: answers.health ?? "" },
    { label: "What supplements do you take now? Name and dose, or write none.", value: answers.takes ?? "" },
    { label: "How much do you want to spend on supplements?", value: answers.budget ?? "" },
    { label: "Anything i missed or need to know?", value: answers.missed ?? "" },
  ],
});

describe("health profile: one read of their health", () => {
  const food = buildFoodHistory({
    updates: [
      update("2026-09-01", { health: "Torn ACL in 2019, hypothyroid (on levothyroxine 100 mcg), PCOS" }),
      update("2026-11-08", { health: "None", takes: "Creatine 5g, vitamin D", budget: "A few worthwhile extras" }),
    ],
    profileItems: [{ kind: "allergy", label: "Shellfish", at: "2026-11-02T00:00:00Z", source: "coach" }, { kind: "condition", label: "Celiac disease", at: "2026-11-02T00:00:00Z", source: "coach" }],
    today: "2026-11-12",
  });

  it("the health answer is split into what it names, and stays after a later 'None'", () => {
    expect(splitHealthParts("Torn ACL in 2019, hypothyroid (on levothyroxine 100 mcg), PCOS")).toEqual(["Torn ACL in 2019", "hypothyroid (on levothyroxine 100 mcg)", "PCOS"]);
    const labels = food.health.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Torn ACL in 2019", "Thyroid condition", "PCOS"]));
    expect(food.health.find((f) => f.label === "Thyroid condition")!.mentions[0].text).toBe("hypothyroid (on levothyroxine 100 mcg)");
  });

  it("an allergy added to the profile is on file for the food checks; celiac is gluten-free", () => {
    expect(food.allergies.map((f) => f.label)).toContain("Shellfish");
    expect(food.diets.map((f) => f.label)).toContain("Gluten-free");
  });

  const p = buildHealthProfile({
    items: [
      item({ id: "k", kind: "injury", label: "Left knee", body_area: "Knee", details: "Patellar tendinopathy, physio says no deep squats for now" }),
      item({ id: "m", kind: "medication", label: "Sertraline 50 mg", coach_only: true }),
      item({ id: "r", kind: "injury", label: "Wrist sprain", status: "resolved", resolved_on: "2026-10-01" }),
      item({ id: "p", kind: "condition", label: "PCOS", source: "client" }),
    ],
    settings: { drug_tested: true, federation: "CPU", supplement_budget: null },
    food,
    goals: { injuries_has: true, injuries_details: "Lower back tweak 2024", updated_at: "2026-08-01T00:00:00Z" },
    latest: update("2026-11-08", { takes: "Creatine 5g, vitamin D", budget: "A few worthwhile extras" }),
    pain: [
      { date: "2026-11-10", area: "Lower back", level: 6 },
      { date: "2026-11-03", area: "lower back", level: 4 },
      { date: "2026-08-01", area: "shoulder", level: 3 },
    ],
    today: "2026-11-12",
  });

  it("sorts what's on file into its kind, without saying anything twice", () => {
    expect(p.injuries.map((e) => e.label)).toEqual(expect.arrayContaining(["Left knee", "Torn ACL in 2019", "Lower back tweak 2024"]));
    expect(p.conditions.map((e) => e.label)).toEqual(["PCOS", "Thyroid condition"].sort((a, b) => (a === "PCOS" ? -1 : 1)));
    // the form's PCOS is covered by the item the client added
    expect(p.conditions.filter((e) => e.label === "PCOS")).toHaveLength(1);
    expect(p.medications.map((e) => e.label)).toEqual(["Sertraline 50 mg"]);
    expect(p.supplements.map((e) => e.label)).toEqual(["Creatine 5g", "vitamin D"]);
    expect(p.past.map((e) => e.label)).toEqual(["Wrist sprain"]);
  });

  it("pain from the last 6 weeks only, by area", () => {
    expect(p.pain).toEqual([{ area: "lower back", count: 2, last: "2026-11-10", worst: 6 }]);
  });

  it("budget from their last answer when the coach hasn't set one; drug testing from the coach", () => {
    expect(p.budget).toBe("some");
    expect(p.budgetFrom).toBe("form");
    expect(p.drugTested).toBe(true);
  });

  it("a coach-only item never reaches the client's view", () => {
    expect(clientVisible(p).medications).toEqual([]);
  });

  it("each AI reads what it needs", () => {
    const training = healthProfileForAi(p, "training")!;
    expect(training).toMatch(/^HEALTH PROFILE/);
    expect(training).toMatch(/Left knee \(Knee\)|Left knee: Patellar/);
    expect(training).toMatch(/lower back 2×/);
    expect(training).not.toMatch(/Supplements they take/);
    expect(training).toMatch(/Competes drug-tested \(CPU\)/);
    const nutrition = healthProfileForAi(p, "nutrition")!;
    expect(nutrition).toMatch(/Supplements they take now: Creatine 5g/);
    expect(nutrition).toMatch(/Drug-tested athlete: yes \(CPU\)/);
    expect(healthSummary(p)).toMatch(/^3 injuries · pain: lower back · 2 conditions · 1 medication/);
  });

  it("classifies what they wrote", () => {
    expect(classifyHealthText("rotator cuff tear")).toBe("injury");
    expect(classifyHealthText("Levothyroxine 100 mcg")).toBe("medication");
    expect(classifyHealthText("Vitamin D deficiency")).toBe("condition");
    expect(classifyHealthText("Asthma")).toBe("condition");
  });

  it("feeds the supplement advice", () => {
    const input = supplementInput({ health: p, history: food, sex: "Female", age: 29, weightKg: 70, lifts: true, meet: { isPowerlifter: true, meetInDays: null, weightClass: false }, foods: "chicken, rice", flags: checkinFlags([]) });
    expect(input).toMatchObject({ sex: "female", drugTested: true, budget: "some", competes: true });
    expect(input.allergies).toContain("Shellfish");
    expect(input.diets).toContain("Gluten-free");
    expect(input.takes).toMatch(/Creatine 5g/);
    const a = adviseSupplements(input);
    expect(a.picks.find((x) => x.key === "creatine")!.already).toBe(true);
  });

  it("reads straight from the records the loader returns", () => {
    const fromRec = healthProfileFromRecords(
      {
        items: [item({ id: "x", kind: "condition", label: "Asthma" })],
        settings: null,
        goals: null,
        clientInjuries: [null, "old ankle sprain"],
        pain: [],
        updates: [update("2026-11-08", { health: "migraines" })],
        dismissed: [],
      },
      "2026-11-12",
    );
    expect(fromRec.conditions.map((e) => e.label)).toEqual(expect.arrayContaining(["Asthma", "Migraines"]));
    expect(fromRec.injuries.map((e) => e.label)).toContain("old ankle sprain");
    expect(fromRec.budget).toBe("essentials");
    expect(fromRec.budgetFrom).toBe("default");
  });

  it("check-in flags count the last 8 weekly check-ins", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ submitted_at: `2026-0${(i % 9) + 1}-01`, answers: { recovery_flags: i < 3 ? ["Sleep", "Digestion / bloating"] : ["All good"] } }));
    const f = checkinFlags(rows);
    expect(f.total).toBe(8);
  });
});

describe("wired in", () => {
  it("the nutrition AI reads the health profile and the supplements, and stores them on the plan", () => {
    const server = read("src/lib/nutrition-ai-plans.server.ts");
    expect(server).toMatch(/healthProfileForAi\(health, "nutrition"\)/);
    expect(server).toMatch(/supplements: supplementsForAi\(adviseSupplements\(supplementIn\)\)/);
    expect(server).toMatch(/supplements,\n/);
    // decided again with the written meal plan, which is what says they eat no dairy or fish
    expect(server).toMatch(/planGiven: !!mealPlanText\.trim\(\)/);
    const prompt = read("src/lib/nutrition-ai-prompts.ts");
    expect(prompt).toMatch(/GUT HEALTH \+ SUPPLEMENTS/);
    expect(prompt).toMatch(/never write supplements, doses or brands into your answer/);
  });

  it("the program AI reads it in its brief, and the privacy-safe copy drops it", () => {
    expect(read("src/lib/program-intel/load.ts")).toMatch(/loadHealthRecords\(sb, clientId, \{ forms: true, today \}\)/);
    expect(read("src/lib/program-intel/brief.ts")).toMatch(/Health conditions \(train around them/);
    expect(read("src/lib/program-intel/export.ts")).toMatch(/health: null,/);
  });

  it("publishing carries the supplements; the client reads them with their plan", () => {
    expect(read("src/lib/nutrition-targets/plan-publish.ts")).toMatch(/supplements: input\.supplements \?\? current\?\.supplements \?\? null/);
    expect(read("src/lib/nutrition-targets/member-targets.functions.ts")).toMatch(/pdf_url, pdf_name, supplements,/);
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).toMatch(/title="Supplements"/);
  });

  it("the migration keeps a client's own rows theirs and coach-only rows hidden", () => {
    const sql = read("supabase/migrations/20270306090000_health_profile.sql");
    expect(sql).toMatch(/CHECK \(NOT \(source = 'client' AND coach_only\)\)/);
    expect(sql).toMatch(/"Clients read own health items"[\s\S]*USING \(NOT coach_only AND client_id IN/);
    expect(sql).toMatch(/"Clients change own health items"[\s\S]*USING \(source = 'client'/);
    expect(sql).toMatch(/rls_evaluate_once\('client_health_items'\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS supplements jsonb/);
    expect(sql).toMatch(/Any health conditions, injuries or medications\?/);
  });

  it("the FAQ covers supplements, gut health, budget, men and women, and drug testing", () => {
    const faq = read("src/content/nutrition-help.ts");
    for (const q of ["Which supplements are actually worth it?", "Is creatine safe, and is it only for men?", "I'm drug-tested. Which supplements are safe?", "How do I improve my gut health and digestion?", "How can I eat well on a budget?", "Do men and women need different nutrition?"]) {
      expect(faq).toContain(q);
    }
    expect(faq).not.toMatch(/—/);
  });
});
