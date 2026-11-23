import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Clients list row: one consistent primary action", () => {
  const row = fs.readFileSync("src/components/clients/client-row.tsx", "utf8");

  it("always shows Open client and a labelled Client view; payment/review shortcuts live in the status badges", () => {
    expect(row).toContain("Open client");
    expect(row).toContain("Client view");
    expect(row).not.toContain("View Profile");
    expect(row).not.toContain("Set Up Payment");
    expect(row).not.toContain('"payment"');
    expect(row).not.toContain("primaryActionTarget");
  });
});
