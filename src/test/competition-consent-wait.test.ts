/**
 * Nov 25 2026: a competition milestone the athlete's AI consent refuses must not use up its tries. In
 * production the rehearsal's confirmation failed on consent at 19:19 and the cron would have retried it every
 * 10 minutes, three times, then never again, so allowing AI afterwards would have changed nothing.
 */
import { describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/ai-consent/consent.server", () => {
  class AiConsentError extends Error {
    readonly aiConsent = true;
  }
  return {
    AiConsentError,
    requireClientAiConsent: async () => {
      throw new AiConsentError("Jared hasn't allowed their data to be sent to AI services (OpenAI and Google (Gemini)), so this can't be drafted for them.");
    },
    clientAllowsAi: async () => ({ ok: false, name: "Jared" }),
  };
});
vi.mock("@/lib/ai/ai-health.server", () => ({
  assertProviderUp: async () => {
    asked.n++;
  },
}));

import { processMilestone } from "@/lib/competition/worker.server";

function recorder() {
  const updates: Array<Record<string, unknown>> = [];
  const sb: any = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { sb, updates };
}

describe("a consent refusal waits for the athlete, using no try", () => {
  it("gives the claimed attempt back, says why, and asks no model", async () => {
    const { sb, updates } = recorder();
    const r = await processMilestone(sb, { id: "m1", competition_id: "c1", client_id: "x", kind: "confirm", attempts: 1, progress: null });
    expect(r.status).toBe("no_consent");
    expect(asked.n).toBe(0);
    const last = updates[updates.length - 1]!;
    expect(last.attempts).toBe(0);
    expect(last.status).toBe("failed");
    expect(String(last.last_error)).toMatch(/hasn't allowed their data/);
  });
});
