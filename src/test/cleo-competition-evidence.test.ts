import { describe, expect, it } from "vitest";
import { containsCompetitionName, competitionQuoteIsGrounded, matchingCompetitionExcerpts } from "@/lib/cleo-competition-evidence.server";
import { CLEO_ACTION_PARAMS } from "@/lib/cleo-actions";
const client_id = "00000000-0000-4000-8000-000000000001";
const source_id = "00000000-0000-4000-8000-000000000002";

describe("Cleo stored competition evidence", () => {
  it("matches only a supported full name and accepts roster surname-first format", () => {
    expect(containsCompetitionName("Flight A | Alex Morgan | 66 kg", "Alex", "Morgan")).toBe(true);
    expect(containsCompetitionName("Morgan, Alex | Flight A", "Alex", "Morgan")).toBe(true);
    expect(containsCompetitionName("Alex Morganfield", "Alex", "Morgan")).toBe(false);
    expect(containsCompetitionName("Alex | Jamie Morgan", "Alex", "Morgan")).toBe(false);
  });
  it("requires the excerpt to appear in the actual stored text or source quote", () => {
    const evidence = ["Alex Morgan | 66 kg", "Flight A"];
    expect(competitionQuoteIsGrounded(evidence, "Alex Morgan")).toBe(true);
    expect(competitionQuoteIsGrounded(evidence, "Alex Monroe")).toBe(false);
    expect(matchingCompetitionExcerpts(["Alex Morgan | 66 kg\nJamie Smith | 74 kg"], ["Alex"])).toEqual(["Alex Morgan | 66 kg"]);
  });
  it("requires an evidence pair for saved files while allowing staff-given names", () => {
    const p = { client_id, first_name: "Alex", last_name: "Morgan" };
    expect(CLEO_ACTION_PARAMS.update_client_identity.safeParse(p).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.update_client_identity.safeParse({ ...p, source_id }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.update_client_identity.safeParse({ ...p, source_id, source_quote: "Alex Morgan" }).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.update_client_identity.safeParse({ client_id, preferred_name: "Al", source_id, source_quote: "Al Morgan" }).success).toBe(false);
  });
});
