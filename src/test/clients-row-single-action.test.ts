import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Clients list row: one consistent primary action", () => {
  const row = fs.readFileSync("src/components/clients/client-row.tsx", "utf8");

  it("always shows View Profile; payment/review shortcuts live in the status badges", () => {
    expect(row).toContain("View Profile");
    expect(row).not.toContain("Open Client");
    expect(row).not.toContain("Set Up Payment");
    expect(row).not.toContain('"payment"');
    expect(row).not.toContain("primaryActionTarget");
  });
});
