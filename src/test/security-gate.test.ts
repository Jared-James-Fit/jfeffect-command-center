import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM script, no types
import { runSecurityGate, formatReport } from "../../scripts/security-gate.mjs";

describe("security publish gate", () => {
  it("blocks publish when a critical RLS finding has no valid waiver", () => {
    const result = runSecurityGate();
    if (!result.ok) {
      // Surface the exact reason in the failure message so CI logs are actionable.
      throw new Error(formatReport(result));
    }
    expect(result.ok).toBe(true);
  });
});