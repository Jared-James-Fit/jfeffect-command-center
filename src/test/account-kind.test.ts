import { describe, it, expect } from "vitest";
import { isCoachingClientRow } from "@/lib/account-kind";

describe("isCoachingClientRow", () => {
  it("treats a member athlete row as not a coaching client", () => {
    expect(isCoachingClientRow([{ athlete_kind: "member" }])).toBe(false);
  });
  it("finds a coaching row", () => {
    expect(isCoachingClientRow([{ athlete_kind: "coaching" }])).toBe(true);
    expect(isCoachingClientRow([{ athlete_kind: "member" }, { athlete_kind: "coaching" }])).toBe(true);
  });
  it("counts rows from a database without the column as coaching", () => {
    expect(isCoachingClientRow([{}])).toBe(true);
  });
  it("is false with no rows", () => {
    expect(isCoachingClientRow([])).toBe(false);
    expect(isCoachingClientRow(null)).toBe(false);
  });
});
