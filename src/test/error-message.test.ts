import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/error-message";

describe("errorMessage", () => {
  it("reads Error instances", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("reads Supabase/PostgREST errors, which are plain objects, not Errors", () => {
    const pg = { code: "42703", message: "column exercises_1.movement_family does not exist", details: null, hint: null };
    expect(pg instanceof Error).toBe(false);
    expect(errorMessage(pg)).toBe("column exercises_1.movement_family does not exist");
  });
  it("reads plain strings and trims", () => {
    expect(errorMessage("  nope ")).toBe("nope");
  });
  it("returns null when there is nothing useful to show", () => {
    for (const v of [null, undefined, 42, {}, { message: 5 }, { message: "   " }, ""]) expect(errorMessage(v)).toBeNull();
  });
});
