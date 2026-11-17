import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMPETITION_FORM_ID,
  competitionPlanFromAnswers,
  planBriefText,
  planChanges,
  planGoal,
  planSummaryLines,
} from "@/lib/competition-plan";

const Q = (id: string, plan_key: string) => ({ id, validation: { plan_key } });
const questions = [
  Q("name", "name"),
  Q("age", "age_classes"),
  Q("wc", "weight_class"),
  Q("bw", "bodyweight_plan"),
  Q("meets", "meets"),
  Q("rank", "ranking"),
  Q("primary", "primary"),
  Q("goal", "goal"),
  Q("peaks", "full_peaks"),
  Q("nonpeak", "non_peak"),
  Q("notes", "notes"),
];
const meets = [
  { id: "a", level: "Provincial Championships", name: "MPA Provincials", date: "2027-04-10", location: "Winnipeg", registered: true },
  { id: "b", level: "National Championships", name: "CPF Nationals", date: "2027-06-20", location: "Calgary", qualified: false },
  { id: "c", level: "Local Meet" },
];
const answers = [
  { question_id: "name", value_text: "Vicky Tshibasu" },
  { question_id: "age", value_json: ["OPEN (19–59)"] },
  { question_id: "wc", value_text: "Women's 63 kg" },
  { question_id: "bw", value_text: "Stay where I am" },
  { question_id: "meets", value_json: meets },
  { question_id: "rank", value_json: [{ key: "b", label: "x" }, { key: "a", label: "y" }, { key: "c", label: "z" }] },
  { question_id: "primary", value_text: "CPF Nationals · Jun 20, 2027 · Calgary" },
  { question_id: "goal", value_text: "Qualify for a bigger meet" },
  { question_id: "peaks", value_text: "2" },
  { question_id: "nonpeak", value_text: "Yes" },
  { question_id: "notes", value_text: "Work trip in May" },
];

describe("competition plan from the form", () => {
  it("reads the answers by plan key, in the athlete's order, with the primary meet found by its label", () => {
    const p = competitionPlanFromAnswers(questions, answers);
    expect(p.competing).toBe(true);
    expect(p.meets.map((m) => [m.id, m.rank])).toEqual([["b", 1], ["a", 2], ["c", 3]]);
    expect(p.primary?.id).toBe("b");
    expect(p.fullPeaks).toBe("2");
    expect(p.weightClass).toBe("Women's 63 kg");
    expect(p.ageClasses).toEqual(["OPEN (19–59)"]);
    const lines = planSummaryLines(p);
    expect(lines[0]).toEqual({ label: "Primary meet", value: "CPF Nationals (National Championships) · Jun 20, 2027 · Calgary · not qualified yet" });
    expect(lines.find((l) => l.label === "Then, in order")?.value.split("\n")).toHaveLength(2);
  });

  it("not competing drops everything that only applies to meets", () => {
    const p = competitionPlanFromAnswers(questions, [
      { question_id: "meets", value_json: [{ id: "z", level: "None — I don't plan on competing", none: true }] },
      { question_id: "peaks", value_text: "1" },
      { question_id: "wc", value_text: "Men's 93 kg" },
    ]);
    expect(p.competing).toBe(false);
    expect(p.fullPeaks).toBeNull();
    expect(p.primary).toBeNull();
    expect(planSummaryLines(p)[0]).toEqual({ label: "Competing", value: "Not planning to compete" });
    expect(planGoal(p)).toBeNull();
  });

  it("says what changed since the last plan", () => {
    const before = competitionPlanFromAnswers(questions, answers);
    const after = competitionPlanFromAnswers(questions, [
      ...answers.filter((a) => !["meets", "rank", "primary", "peaks"].includes(a.question_id)),
      { question_id: "meets", value_json: [...meets.slice(0, 2), { id: "d", level: "World Championships (IPF)", name: "Worlds", date: "2027-09-01" }] },
      { question_id: "primary", value_text: "Worlds · Sep 1, 2027" },
      { question_id: "peaks", value_text: "3+" },
    ]);
    expect(planChanges(before, after)).toEqual([
      "Primary meet: CPF Nationals → Worlds",
      "Added: Worlds",
      "Dropped: Local Meet",
      "Full peaks: 2 → 3+",
    ]);
    expect(planChanges(null, after)).toEqual([]);
  });

  it("the primary meet becomes the program goal only when it has a date", () => {
    const p = competitionPlanFromAnswers(questions, answers);
    expect(planGoal(p)).toEqual({ text: "Peak for CPF Nationals (National Championships): qualify for a bigger meet", date: "2027-06-20" });
  });

  it("the AI reads it as context with weeks out, never as a reason to rewrite a running program", () => {
    const text = planBriefText(competitionPlanFromAnswers(questions, answers), "2026-11-17", "2026-11-17");
    expect(text).toMatch(/approved by the coach 2026-11-17/);
    expect(text).toMatch(/never a reason to rewrite a running program/);
    expect(text).toMatch(/Primary meet \(peak for this one\): CPF Nationals .*\(31 weeks out\)/);
    expect(text).toMatch(/Full peaks they'll do this year: 2/);
  });
});

describe("the seeded template and the wiring", () => {
  const sql = readFileSync("supabase/migrations/20270330091000_competition_strategy_form.sql", "utf8");
  it("has every plan key the plan reads, follow-ups on the meets question, and stays out of auto-archive", () => {
    for (const key of ["name", "age_classes", "weight_class", "bodyweight_plan", "meets", "ranking", "primary", "goal", "full_peaks", "non_peak", "notes"]) {
      expect(sql, key).toContain(`"plan_key": "${key}"`);
    }
    expect(sql).toContain(COMPETITION_FORM_ID);
    expect(sql).toContain(`"options_from": "c0a1e7e0-5a7e-4c0d-9f00-000000000106"`);
    expect(sql).toContain(`"op": "not_contains", "value": "None"`);
    expect(sql).toContain(`and f.id <> 'c0a1e7e0-5a7e-4c0d-9f00-000000000c01'::uuid`);
    // Every original option kept (World Championships / World Games named apart).
    for (const o of ["Local Meet", "Provincial Championships", "Western Championships", "Eastern Championships", "Central Championships", "National Championships", "World Championships (IPF)", "Commonwealth Championships (CPF)", "North American Championships (NAPF)", "World Games (IWGA)", "Other", "None — I don't plan on competing"]) {
      expect(sql).toContain(o.replace(/'/g, "''"));
    }
    for (const o of ["SUB-JUNIOR (14–18)", "MASTER 4 (70+)", "Women''s 43 kg (sub-junior & junior only)", "Men''s 120 kg+", "Women''s 84 kg+"]) expect(sql).toContain(o);
  });

  it("only an approved plan reaches the program AI; the raw answers never do", () => {
    const load = readFileSync("src/lib/program-intel/load.ts", "utf8");
    expect(load).toContain('form_type === "competition_strategy"');
    expect(load).toContain("subs.filter((x) => !competitionForms.has(x.form_id))");
    const ctx = readFileSync("src/lib/program-intel/context.ts", "utf8");
    expect(ctx).toContain("planBriefText(rec.competitionPlan.plan");
    const brief = readFileSync("src/lib/program-intel/brief.ts", "utf8");
    expect(brief).toContain("if (ctx.competition.plan) lines.push(ctx.competition.plan);");
    // Submitting records it on the server; nothing writes a program.
    const events = readFileSync("src/lib/push/app-events.functions.ts", "utf8");
    expect(events).toContain("recordCompetitionPlan(db, data.id)");
    const server = readFileSync("src/lib/competition-plan.server.ts", "utf8");
    expect(server).not.toMatch(/pl_blocks|pl_days|pl_exercise_rows/);
  });
});
