import { describe, expect, it } from "vitest";
import { loadCatalog } from "@/lib/cleo-tools.server";

/** A login's client: cleo_data_catalog answers admins with the tables and anyone else with nothing. */
const db = (answer: unknown) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    rpc: async () => {
      calls++;
      return { data: answer, error: null };
    },
  };
};

describe("Cleo's list of tables is never shared between people", () => {
  it("doesn't hand a coach the list an admin loaded a moment before", async () => {
    const admin = db([{ t: "discount_codes", c: [["code", "text"]] }]);
    await expect(loadCatalog(admin, "admin-1")).resolves.toHaveLength(1);

    const coach = db(null);
    await expect(loadCatalog(coach, "coach-1")).rejects.toThrow(/admins only/);
    expect(coach.calls).toBe(1);
  });

  it("still saves a round trip for the same person", async () => {
    const admin = db([{ t: "recipes", c: [["title", "text"]] }]);
    await loadCatalog(admin, "admin-2");
    await loadCatalog(admin, "admin-2");
    expect(admin.calls).toBe(1);
  });
});
