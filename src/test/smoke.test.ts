import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("blocks real network fetch", async () => {
    await expect(fetch("https://example.com")).rejects.toThrow(/Network fetch attempted/);
  });
});