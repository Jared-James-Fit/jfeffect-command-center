import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asAthleteSex, sexFromAnswer, sexLabel, SEX_REASON } from "@/lib/athlete-sex";
import { prefillAnswer, questionPrefill } from "@/lib/form-prefill";
import {
  clientBasicsLines,
  nutritionSubmissionSummary,
  targetsUserPrompt,
} from "@/lib/nutrition-ai-prompts";

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("supabase/migrations/20261008130000_athlete_sex_profile.sql");

describe("athlete sex values", () => {
  it("round-trips between stored values and form answers", () => {
    expect(sexLabel("female")).toBe("Female");
    expect(sexLabel("unspecified")).toBe("Prefer not to say");
    expect(sexFromAnswer("Prefer not to say")).toBe("unspecified");
    expect(sexFromAnswer(" male ")).toBe("male");
    expect(sexFromAnswer("")).toBeNull();
    expect(asAthleteSex("M")).toBeNull();
  });

  it("asks in plain terms, never as a calorie question", () => {
    expect(SEX_REASON).toBe("Helps personalize your plan, analytics and strength standards.");
    expect(SEX_REASON.toLowerCase()).not.toContain("calori");
  });
});

describe("nutrition form prefill", () => {
  const sexQ = { validation: { prefill: "sex" }, options: ["Male", "Female", "Prefer not to say"] };
  const heightQ = { validation: { prefill: "height" }, options: [] };

  it("pre-fills sex from the profile, only with an option the question offers", () => {
    expect(questionPrefill(sexQ)).toBe("sex");
    expect(prefillAnswer(sexQ, { sex: "female" })).toBe("Female");
    expect(prefillAnswer(sexQ, { sex: null })).toBeNull();
    expect(prefillAnswer({ ...sexQ, options: ["M", "F"] }, { sex: "male" })).toBeNull();
  });

  it("pre-fills height in the athlete's unit", () => {
    expect(prefillAnswer(heightQ, { height_cm: 177.8, preferred_height_unit: "imperial" })).toBe(
      "5 ft 10 in",
    );
    expect(prefillAnswer(heightQ, { height_cm: 178, preferred_height_unit: "metric" })).toBe(
      "178 cm",
    );
    expect(prefillAnswer({ validation: {} }, { sex: "male" })).toBeNull();
  });
});

describe("nutrition AI + coach copy carry the client's basics", () => {
  const qas = [
    { label: "Current fasted bodyweight? (lbs)", value: "150" },
    { label: "Goal", value: "Fat Loss" },
  ];

  it("keeps the old prompt byte-for-byte when only a name is known", () => {
    expect(targetsUserPrompt("Jane Doe", qas, null)).toBe(
      "CLIENT DATA\nClient name: Jane Doe\n\nCurrent fasted bodyweight? (lbs): 150\nGoal: Fat Loss",
    );
  });

  it("adds sex, age and height from the profile", () => {
    const out = targetsUserPrompt(
      { name: "Jane Doe", sex: "Female", age: 29, height: "5 ft 6 in" },
      qas,
      "Fat Loss",
    );
    expect(out).toBe(
      "CLIENT DATA\nClient name: Jane Doe\nSex: Female\nAge: 29\nHeight: 5 ft 6 in\nCOACH-SELECTED PHASE: Fat Loss\n\n" +
        "Current fasted bodyweight? (lbs): 150\nGoal: Fat Loss",
    );
  });

  it("never repeats what the form already answered", () => {
    const answered = [
      { label: "Sex", value: "Female" },
      { label: "Height (ft)", value: "5'6" },
      ...qas,
    ];
    const lines = clientBasicsLines(
      { name: "Jane", sex: "Female", age: 29, height: "5 ft 6 in" },
      answered,
    );
    expect(lines).toEqual(["Client name: Jane", "Age: 29"]);
  });

  it("copies the whole submission as one paste-ready block", () => {
    const text = nutritionSubmissionSummary({
      client: { name: "Jane Doe", sex: "Female", age: 29 },
      qas,
      phase: "Fat Loss",
      submittedAt: "2026-10-07T15:00:00Z",
    });
    expect(text.split("\n")[0]).toBe("NUTRITION FORM — Jane Doe");
    expect(text).toContain(
      "Sex: Female\nAge: 29\nCoach phase: Fat Loss\n\nCurrent fasted bodyweight? (lbs): 150",
    );
  });
});

describe("one field, kept honest", () => {
  it("stores male / female / prefer-not-to-say on clients, NULL = never asked", () => {
    expect(migration).toContain("CHECK (sex IS NULL OR sex IN ('male', 'female', 'unspecified'))");
  });

  it("mirrors the macro calculator's member field both ways without ever blocking a save", () => {
    expect(migration).toContain("CREATE TRIGGER clients_sync_sex_to_member_trg");
    expect(migration).toContain("CREATE TRIGGER members_sync_sex_to_client_trg");
    expect(migration.match(/EXCEPTION WHEN OTHERS THEN/g)).toHaveLength(2);
  });

  it("adds a pre-filled Sex question to the nutrition form and flags height for prefill", () => {
    expect(migration).toContain(`'["Male","Female","Prefer not to say"]'::jsonb`);
    expect(migration).toContain(`'{"prefill":"sex"}'::jsonb`);
    expect(migration).toContain(`'{"prefill":"height"}'::jsonb`);
  });

  it("the form saves profile values as real answers and writes a changed sex back", () => {
    const r = read("src/components/forms/client-form-renderer.tsx");
    expect(r).toContain("if (answersMap[q.id] || seeded.current.has(q.id)) continue;");
    expect(r).toContain(".update({ sex: nextSex })");
  });

  it("asks once, only the athlete (never in coach view-as-client), and stops when answered", () => {
    expect(read("src/routes/_authenticated/portal/index.tsx")).toContain(
      '<SexPromptCard enabled={role === "client"} />',
    );
    expect(read("src/routes/_authenticated/m/index.tsx")).toContain(
      '<SexPromptCard enabled={role === "member"} />',
    );
    expect(read("src/components/athlete-sex.tsx")).toContain(
      'data.account === "none" || data.sex) return null;',
    );
  });

  it("no screen can erase an answer with a stale copy", () => {
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toContain(
      "sex: _sex, sex_updated_at: _sexAt, ...rest",
    );
    expect(read("src/components/portal/setup-step-sheet.tsx")).toContain(
      "if (form?.sex) patch.sex = form.sex;",
    );
    expect(read("src/routes/_authenticated/portal/account.tsx")).toContain(
      "if (current.sex) patch.sex = current.sex;",
    );
    expect(read("src/components/admin/client-profile/personal-info-cards.tsx")).toContain(
      "...(d.sex !== initial.sex ? { sex: d.sex } : {}),",
    );
  });

  it("readers use the profile: SBD card (no device-only toggle) and the macro calculator (no male default)", () => {
    const sbd = read("src/components/analytics/sbd-split-card.tsx");
    expect(sbd).not.toContain("localStorage");
    expect(sbd).toContain('supabase.from("clients").select("sex")');
    const calc = read("src/components/nutrition/MacroCalculatorDialog.tsx");
    expect(calc).toContain("useState<BiologicalSex | null>(null)");
    expect(read("src/lib/nutrition-targets/member-targets.functions.ts")).toContain(
      '.select("sex, date_of_birth, height_cm")',
    );
  });
});
