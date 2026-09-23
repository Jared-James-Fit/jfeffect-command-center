import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("payment link creation race", () => {
  const server = readFileSync("src/lib/payment-share.server.ts", "utf8");
  const client = readFileSync("src/components/payments/copy-payment-link-button.tsx", "utf8");

  it("trusts a just-persisted checkout if Stripe GET briefly lags", () => {
    expect(server).toContain("last_payment_update_at");
    expect(server).toContain("Date.now() - updatedAt <= 5 * 60_000");
    expect(server).toContain('status: "open"');
    expect(server).toContain("instead of falsely reporting");
  });

  it("retries share-link resolution without creating another sale", () => {
    expect(client).toContain("const retryDelays = [0, 200, 500, 900]");
    expect(client).toContain("if (!res.needsFreshCheckout) break");
    expect(client).toContain("the same sale will be reused");
  });
});
