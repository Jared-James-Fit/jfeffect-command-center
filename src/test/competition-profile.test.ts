import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ageClassKey,
  allowedAgeKeys,
  canonicalClass,
  profileFromAnswers,
  profileSummary,
  weightClassesFor,
  weightClassLabel,
} from "@/lib/competition-profile";
import { COMPETITION_SOURCE, prefillDetail, prefillNote, startingAnswer } from "@/lib/form-prefill";
import { choiceLayout, requiredMark } from "@/lib/form-quick";

const AGE = ["SUB-JUNIOR (14–18)", "JUNIOR (19–23)", "OPEN (19–59)", "MASTER 1 (40–49)", "MASTER 2 (50–59)", "MASTER 3 (60–69)", "MASTER 4 (70+)"];
const WC = ["Men's 53 kg (sub-junior & junior only)", "Men's 59 kg", "Men's 66 kg", "Men's 74 kg", "Men's 83 kg", "Men's 93 kg", "Men's 105 kg", "Men's 120 kg", "Men's 120 kg+", "Women's 43 kg (sub-junior & junior only)", "Women's 47 kg", "Women's 52 kg", "Women's 57 kg", "Women's 63 kg", "Women's 69 kg", "Women's 76 kg", "Women's 84 kg", "Women's 84 kg+"];
const read = (p: string) => readFileSync(p, "utf8");

describe("classes are stored one way", () => {
  it("whatever a form or a meet prep calls them", () => {
    expect(canonicalClass("Men's 83 kg")).toBe("83");
    expect(canonicalClass("Men's 120 kg+")).toBe("120+");
    expect(canonicalClass("-84kg")).toBe("84");
    expect(canonicalClass("84+")).toBe("84+");
    expect(canonicalClass("Men's 53 kg (sub-junior & junior only)")).toBe("53");
    expect(canonicalClass("Not sure")).toBeNull();
    expect(canonicalClass(null)).toBeNull();
  });

  it("and read back by sex from the number itself", () => {
    expect(weightClassLabel("83")).toBe("Men's 83 kg");
    expect(weightClassLabel("120+")).toBe("Men's 120 kg+");
    expect(weightClassLabel("84+")).toBe("Women's 84 kg+");
    expect(weightClassLabel("63")).toBe("Women's 63 kg");
    expect(weightClassLabel("100")).toBe("100 kg");
  });

  it("age classes by their name, whatever the form's wording", () => {
    expect(AGE.map(ageClassKey)).toEqual(["sub-junior", "junior", "open", "master 1", "master 2", "master 3", "master 4"]);
    expect(ageClassKey("Junior")).toBe("junior");
    expect(ageClassKey("Sub junior")).toBe("sub-junior");
    expect(ageClassKey("Everyone")).toBeNull();
  });

  it("offers a junior's lightest class only while they're one", () => {
    expect(weightClassesFor("male", false)).toEqual(["59", "66", "74", "83", "93", "105", "120", "120+"]);
    expect(weightClassesFor("female", true)[0]).toBe("43");
    expect(allowedAgeKeys("2004-01-02", 2027)).toEqual(["junior", "open"]);
  });

  it("sums up for a row", () => {
    expect(profileSummary({ weightClass: "83", ageClasses: ["junior", "open"] })).toBe("Men's 83 kg · Junior, Open");
    expect(profileSummary({ weightClass: null, ageClasses: [] })).toBeNull();
    expect(profileSummary(null)).toBeNull();
  });
});

describe("a sent form writes back only what it asked", () => {
  const qs = [
    { id: "age", question_type: "multi_choice", validation: { prefill: "age_class" } },
    { id: "wc", question_type: "single_choice", validation: { prefill: "weight_class" } },
    { id: "goal", question_type: "single_choice", validation: { prefill: "goal" } },
  ];
  it("reads the competition form", () => {
    const answers = [
      { question_id: "age", value_json: ["OPEN (19–59)", "JUNIOR (19–23)"] },
      { question_id: "wc", value_text: "Men's 93 kg" },
      { question_id: "goal", value_text: "Fat Loss" },
    ];
    expect(profileFromAnswers(qs, answers)).toEqual({ ageClasses: ["junior", "open"], weightClass: "93" });
  });

  it("leaves what it didn't answer alone, and reads the meet checklist's class", () => {
    expect(profileFromAnswers(qs, [{ question_id: "wc", value_text: "Men's 83 kg" }])).toEqual({ weightClass: "83" });
    expect(profileFromAnswers([{ id: "m", validation: { prefill: "meet_weight_class" } }], [{ question_id: "m", value_text: "Women's 63 kg" }])).toEqual({ weightClass: "63" });
    expect(profileFromAnswers(qs, [])).toEqual({});
  });
});

describe("forms start from the competition profile", () => {
  const age = { question_type: "multi_choice", options: AGE, validation: { prefill: "age_class" } };
  const wc = { question_type: "single_choice", options: WC, validation: { prefill: "weight_class" } };
  const junior = { sex: "male", date_of_birth: "2004-01-02", season_year: 2027 };

  it("the classes they enter, over last time's answer, while their birth year allows them", () => {
    const p = { ...junior, competition: { weightClass: "83", ageClasses: ["junior"] } };
    expect(prefillDetail(age, p)).toMatchObject({ value: ["JUNIOR (19–23)"], source: COMPETITION_SOURCE, strong: true });
    expect(startingAnswer(age, p, ["OPEN (19–59)"])).toEqual({ value: ["JUNIOR (19–23)"], from: "profile" });
    // aged out of junior: their birth year's classes again
    const aged = { ...p, date_of_birth: "2003-01-02" };
    expect(prefillDetail(age, aged)?.value).toEqual(["OPEN (19–59)"]);
    // they changed it on the form: the line says what they can lift
    expect(prefillNote(age, p, ["JUNIOR (19–23)", "OPEN (19–59)"])).toBe("From your birth year: you can lift Junior and Open in 2027");
  });

  it("the class they compete in after the coach's meet prep, before weigh-ins", () => {
    const p = { sex: "male", competition: { weightClass: "93", ageClasses: [] }, recent_bodyweight: { value: 180, unit: "lb" as const, count: 4 } };
    expect(prefillDetail(wc, p)).toMatchObject({ value: "Men's 93 kg", source: COMPETITION_SOURCE, strong: true });
    expect(startingAnswer(wc, p, "Men's 83 kg")).toEqual({ value: "Men's 93 kg", from: "profile" });
    expect(prefillDetail(wc, { ...p, prep_weight_class: "105" })?.value).toBe("Men's 105 kg");
    const meet = { question_type: "single_choice", options: WC, validation: { prefill: "meet_weight_class" } };
    expect(prefillDetail(meet, p)?.value).toBe("Men's 93 kg");
    expect(prefillDetail(meet, { ...p, meet: { name: "Nationals", date: null, weightClass: "105", source: "sent" } })?.value).toBe("Men's 105 kg");
  });
});

describe("the form reads like a questionnaire", () => {
  it("marks the fewer kind of question, never both", () => {
    expect(requiredMark([{ required: true }, { required: true }, { required: false }])).toBe("optional");
    expect(requiredMark([{ required: true }, { required: false }, { required: false }])).toBe("required");
    expect(requiredMark([{ required: true }, { required: false }])).toBe("required");
  });

  it("wraps five or more short choices as chips", () => {
    expect(choiceLayout(AGE)).toBe("chips");
    expect(choiceLayout(["Under 10%", "10–14%", "15–19%", "20–24%", "25–29%", "30–34%", "35%+"])).toBe("chips");
    expect(choiceLayout(["Early morning (before 8am)", "Morning (8–11am)", "Midday (11am–2pm)", "Afternoon (2–5pm)", "Evening (5–8pm)"])).toBe("list");
    expect(choiceLayout(["Yes", "No", "I'm not competing"])).toBe("list");
  });

  it("has nothing fixed over the questions: progress at the top, Submit at the end", () => {
    const form = read("src/components/forms/client-form-renderer.tsx");
    expect(form).toContain("data-form-progress");
    expect(form).toContain("data-form-finish");
    expect(form).toContain("data-form-missing");
    expect(form).toContain('`${done} of ${total} required`');
    expect(form).toContain('data-form-save={save}');
    expect(form).not.toContain("backdrop-blur");
    // an answer that's still the app's folds to one line with Change
    expect(form).toContain("data-form-compact");
    expect(form).toContain("sameAnswer(app.value, local[q.id])");
  });
});

describe("wiring", () => {
  it("a sent form writes its classes back on the server", () => {
    expect(read("src/lib/push/app-events.functions.ts")).toContain("await syncCompetitionProfile(db, data.id);");
    expect(read("src/lib/competition-profile.server.ts")).toContain('const SYNCED = new Set(["age_class", "weight_class", "meet_weight_class"]);');
  });

  it("the form reads the profile, and the athlete and coach edit it", () => {
    expect(read("src/components/forms/client-form-renderer.tsx")).toContain('db.from("athlete_competition_profiles").select("weight_class, age_classes")');
    expect(read("src/routes/_authenticated/portal/account.tsx")).toContain('<CompetitionProfileEditor clientId={client.id} as="client" preview={isImpersonating} />');
    expect(read("src/components/clients/client-training-tab.tsx")).toContain('<CompetitionProfileEditor clientId={clientId} as="coach" />');
  });

  it("the table: the athlete's own row, their coach's, an admin's; each says who changed it", () => {
    const sql = read("supabase/migrations/20270405090000_athlete_competition_profiles.sql");
    expect(sql).toContain("client_id IN (SELECT public.coached_client_ids())");
    expect(sql).toContain("WITH CHECK (source = 'client' AND client_id IN (SELECT c.id FROM public.clients c WHERE c.user_id = (SELECT auth.uid())))");
    expect(sql).toContain("REVOKE ALL ON public.athlete_competition_profiles FROM anon;");
    expect(sql).toContain("SELECT public.rls_evaluate_once('athlete_competition_profiles');");
    expect(sql).toMatch(/age_classes <@ ARRAY\['sub-junior', 'junior', 'open', 'master 1', 'master 2', 'master 3', 'master 4'\]/);
  });
});
