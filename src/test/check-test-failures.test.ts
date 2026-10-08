import { describe, it, expect } from "vitest";
// @ts-expect-error -- plain .mjs script without type declarations
import { failedTestIds, compareFailures } from "../../scripts/check-test-failures.mjs";

const report = {
  testResults: [
    { name: "/repo/src/test/a.test.ts", status: "failed", assertionResults: [
      { status: "passed", fullName: "a ok" },
      { status: "failed", fullName: "a broken" },
    ] },
    { name: "/repo/src/test/b.test.ts", status: "failed", assertionResults: [] },
    { name: "/repo/src/test/c.test.ts", status: "passed", assertionResults: [{ status: "passed", fullName: "c ok" }] },
  ],
};

describe("check-test-failures", () => {
  it("lists failed tests and files that failed to load", () => {
    const ids: string[] = failedTestIds(report);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/a\.test\.ts > a broken$/);
    expect(ids[1]).toMatch(/b\.test\.ts > \(file failed to run\)$/);
  });

  it("flags only failures that aren't known, and reports known ones now passing", () => {
    const r = compareFailures(["x > 1", "y > 2"], ["x > 1", "z > 3"]);
    expect(r.unexpected).toEqual(["y > 2"]);
    expect(r.nowPassing).toEqual(["z > 3"]);
  });
});
