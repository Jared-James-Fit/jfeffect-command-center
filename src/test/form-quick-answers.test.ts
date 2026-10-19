import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { choiceLayout, formProgress, numberIssue, numberRange, quickAnswers, quickExclusive, quickNumberLabel, quickPicked, toggleQuick } from "@/lib/form-quick";

const read = (f: string) => readFileSync(f, "utf8");
const q = (validation: Record<string, unknown>) => ({ validation });

describe("quick answers: tap, and still type your own", () => {
  const allergies = q({ quick: ["None", "Dairy", "Gluten", "Nuts", " ", 3], quick_exclusive: ["None"] });

  it("reads the coach's quick answers (trimmed, no blanks or repeats)", () => {
    expect(quickAnswers(allergies)).toEqual(["None", "Dairy", "Gluten", "Nuts", "3"]);
    expect(quickExclusive(allergies)).toEqual(["None"]);
    expect(quickAnswers(q({}))).toEqual([]);
  });

  it("a tap adds it, a second tap takes it out, and what they typed stays", () => {
    expect(toggleQuick("", "Dairy", ["None"])).toBe("Dairy");
    expect(toggleQuick("Dairy", "Nuts", ["None"])).toBe("Dairy, Nuts");
    expect(toggleQuick("Dairy, Nuts", "dairy", ["None"])).toBe("Nuts");
    expect(toggleQuick("strawberries make me itchy", "Nuts", ["None"])).toBe("strawberries make me itchy, Nuts");
    expect(quickPicked("Dairy, Nuts", "nuts")).toBe(true);
    expect(quickPicked("Peanut butter", "Nuts")).toBe(false);
  });

  it("a stand-alone answer (None) replaces the rest, and any other takes it out", () => {
    expect(toggleQuick("Dairy, Nuts", "None", ["None"])).toBe("None");
    expect(toggleQuick("None", "Gluten", ["None"])).toBe("Gluten");
  });
});

describe("numbers: a tap or the keypad, and a check before it's sent", () => {
  const weight = q({ min: 70, max: 700, unit: "lb" });

  it("catches a bodyweight like 2010 lb before it goes to the coach and the AI", () => {
    expect(numberRange(weight)).toEqual({ min: 70, max: 700, unit: "lb" });
    expect(numberIssue(weight, "2010")).toBe("That looks high. It should be 700 lb or less");
    expect(numberIssue(weight, "40")).toBe("That looks low. It should be at least 70 lb");
    expect(numberIssue(weight, "201.5")).toBeNull();
    expect(numberIssue(weight, "")).toBeNull();
    expect(numberIssue(q({}), "99999")).toBeNull();
  });

  it("labels big quick numbers the way they're read", () => {
    expect(quickNumberLabel("10000")).toBe((10000).toLocaleString());
    expect(quickNumberLabel("5")).toBe("5");
  });
});

describe("choices are buttons a thumb can't miss", () => {
  it("one 'I agree' is a tick, short ones share a row, the rest are full-width rows", () => {
    expect(choiceLayout(["Yes, I understand and agree"])).toBe("agree");
    expect(choiceLayout(["3", "4", "5", "6"])).toBe("row");
    expect(choiceLayout(["Male", "Female", "Prefer not to say"])).toBe("list");
    expect(choiceLayout(["Fat Loss", "Muscle Gain", "Recomp (lose fat + build muscle)", "Maintenance"])).toBe("list");
  });

  it("counts what's answered for the progress bar", () => {
    expect(formProgress([{ answered: true }, { answered: false }, { answered: true }])).toEqual({ done: 2, total: 3 });
  });

  it("the form uses them: no dropdowns or tiny radios, 16px boxes, a full-width Submit above the tab bar", () => {
    const form = read("src/components/forms/client-form-renderer.tsx");
    expect(form).not.toContain("<SelectTrigger");
    expect(form).not.toContain("<RadioGroupItem");
    expect(form).toContain("<ChoiceButtons");
    expect(form).toContain("<QuickChips");
    expect(form).toContain('const field = "h-12 rounded-xl px-3.5 text-[16px]";');
    expect(form).toContain('inputMode="decimal"');
    expect(form).toContain('className="h-14 w-full rounded-2xl bg-gradient-primary text-[16px] font-black"');
    expect(form).toContain('bottom: embedded ? 0 : "calc(var(--bottom-nav-clearance, 0px) + env(safe-area-inset-bottom))"');
    // Submit takes them to what's missing (and a number that's off)
    expect(form).toContain('document.getElementById(`q-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });');
  });

  it("typed answers save a beat later, one write at a time per question, all saved before Submit", () => {
    const form = read("src/components/forms/client-form-renderer.tsx");
    expect(form).toContain("const next = (saveChains.current.get(q.id) ?? Promise.resolve())");
    expect(form).toContain("onChange={(v, typed) => saveAnswer(q, v, { defer: typed })}");
    expect(form).toContain("await flushSaves();\n    await submitSubmission(submission.id);");
    // follow-up questions follow what's on screen
    expect(form).toContain("const shownQuestions = questions.filter((q) => shouldShowQuestion(q, liveAnswers));");
  });

  it("the coach sets quick answers and a number's range in the form builder", () => {
    const builder = read("src/route-pages/_authenticated/admin/native-forms.tsx");
    expect(builder).toContain("data-quick-answers-input");
    expect(builder).toContain("saveValidation({ quick: list, quick_exclusive: quickExclusive(q).filter((x) => list.includes(x)) });");
    const sql = read("supabase/migrations/20261219090000_nutrition_form_quick_answers.sql");
    expect(sql).toContain("AND NOT (coalesce(validation, '{}'::jsonb) ? 'quick');");
    expect(sql).toContain(`('current fasted bodyweight%', NULL::jsonb, NULL::jsonb, '{"min": 70, "max": 700, "unit": "lb"}'::jsonb)`);
  });
});
