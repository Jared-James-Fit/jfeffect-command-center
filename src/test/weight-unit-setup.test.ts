import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("lb or kg is asked until answered", () => {
  const migration = read("supabase/migrations/20261116090000_weight_unit_confirmed.sql");
  const prompt = read("src/components/portal/weight-unit-prompt.tsx");
  const layout = read("src/routes/_authenticated/portal/route.tsx");
  const pref = read("src/lib/weight-unit-pref.ts");
  const leagueUnit = read("src/lib/use-weight-unit.ts");

  it("an answer is recorded separately from the lb default, and kg lifters already chose", () => {
    expect(migration).toContain("add column if not exists weight_unit_confirmed_at timestamptz");
    expect(migration).toContain("where preferred_weight_unit = 'kg'");
  });

  it("only the client themselves is asked, once per app open, and only while unanswered", () => {
    expect(prompt).toContain('role === "client" && !isImpersonating');
    expect(prompt).toContain("!row.weight_unit_confirmed_at");
    expect(prompt).toContain("sessionStorage.setItem(SESSION_KEY(userId)");
    expect(prompt).toContain("Ask me later (using lb for now)");
    // mounted with the other portal popups, which a coach in "View as client" never gets
    expect(layout).toMatch(/!isImpersonating && \([\s\S]*<WeightUnitPrompt \/>/);
  });

  it("every place that saves the unit stamps the choice", () => {
    expect(pref).toContain("weight_unit_confirmed_at: new Date().toISOString()");
    expect(prompt).toContain("saveWeightUnitChoice({ clientId: row.id }, unit)");
    expect(leagueUnit).toContain("saveWeightUnitChoice({ userId: portalUserId }, next)");
  });

  it("bodyweight follows the answer only when it has no unit of its own yet", () => {
    expect(prompt).toContain('{ onConflict: "user_id", ignoreDuplicates: true }');
  });
});
