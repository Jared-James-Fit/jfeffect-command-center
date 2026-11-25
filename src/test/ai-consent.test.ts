import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_CONSENT_MARKER,
  AI_CONSENT_VERSION,
  AI_PROVIDERS,
  aiConsentAllows,
  aiConsentNeedsAsking,
  aiConsentState,
  coachConsentMessage,
  consentErrorWords,
  isAiConsentError,
  selfConsentMessage,
} from "@/lib/ai-consent/consent";

const src = (p: string) => readFileSync(p, "utf8");

describe("AI consent rules (App Store 5.1.2(i))", () => {
  it("only an explicit yes to the current wording allows sharing", () => {
    expect(aiConsentAllows(null)).toBe(false);
    expect(aiConsentAllows(undefined)).toBe(false);
    expect(aiConsentAllows({ granted: false, text_version: AI_CONSENT_VERSION })).toBe(false);
    expect(aiConsentAllows({ granted: true, text_version: AI_CONSENT_VERSION - 1 })).toBe(false);
    expect(aiConsentAllows({ granted: true, text_version: AI_CONSENT_VERSION })).toBe(true);
  });

  it("asks again when unanswered or the wording changed, never after a no", () => {
    expect(aiConsentState(null)).toBe("unasked");
    expect(aiConsentNeedsAsking(null)).toBe(true);
    expect(aiConsentState({ granted: true, text_version: 0 })).toBe("outdated");
    expect(aiConsentNeedsAsking({ granted: true, text_version: 0 })).toBe(true);
    expect(aiConsentState({ granted: false, text_version: AI_CONSENT_VERSION })).toBe("declined");
    expect(aiConsentNeedsAsking({ granted: false, text_version: AI_CONSENT_VERSION })).toBe(false);
  });

  it("names every provider the data goes to", () => {
    const names = AI_PROVIDERS.map((p) => p.name);
    expect(names).toContain("OpenAI");
    expect(names.some((n) => n.startsWith("Google"))).toBe(true);
    expect(coachConsentMessage("Sam")).toContain("OpenAI");
    expect(coachConsentMessage(null)).toMatch(/^This client/);
  });

  it("tells a refusal the person can fix apart from one a coach reads", () => {
    const self = new Error(selfConsentMessage());
    expect(isAiConsentError(self)).toBe(true);
    expect(consentErrorWords(self)).not.toContain(AI_CONSENT_MARKER);
    expect(consentErrorWords(self)).toContain("Privacy & data");
    expect(isAiConsentError(new Error(coachConsentMessage("Sam")))).toBe(false);
    expect(isAiConsentError("network down")).toBe(false);
    expect(isAiConsentError(null)).toBe(false);
  });
});

describe("AI consent is enforced on the server before data reaches a model", () => {
  it("the metered features (meal estimates) check it before taking a credit", () => {
    const s = src("src/lib/ai-credits/meter.server.ts");
    expect(s.indexOf("requireOwnAiConsent(userId)")).toBeGreaterThan(-1);
    // every credit is taken by spendAiCredits (option B's native check, native-purchases.ts)
    expect(s.indexOf("requireOwnAiConsent(userId)")).toBeLessThan(s.indexOf("await spendAiCredits(userId, feature, ref, allowed)"));
  });

  it("imports check it before every credit they take", () => {
    for (const p of ["src/lib/program-import/import.functions.ts", "src/lib/nutrition-import/import.functions.ts"]) {
      const s = src(p);
      const uses = s.split(".spendAiCredits(").length - 1;
      expect(uses).toBeGreaterThan(0);
      expect(s.split("requireOwnAiConsent(").length - 1).toBe(uses);
    }
  });

  it("coach-side drafting from a client's records checks the client's", () => {
    const gated: [string, string][] = [
      ["src/lib/program-intel/intel.functions.ts", "requireClientAiConsent(data.clientId)"],
      ["src/lib/program-intel/intel.functions.ts", "requireClientAiConsent(job.client_id)"],
      ["src/lib/program-ai/program-ai.functions.ts", "requireClientAiConsent(aboutClient)"],
      ["src/lib/nutrition-ai-plans.functions.ts", "requireClientAiConsent(clientId)"],
      ["src/lib/nutrition-ai-plans.functions.ts", "requireClientAiConsent(data.clientId)"],
      ["src/lib/nutrition-ai-plans.server.ts", "clientAllowsAi(subRow.client_id)"],
      ["src/lib/cardio/cardio.functions.ts", "requireClientAiConsent(data.clientId)"],
      ["src/lib/client-brief.functions.ts", "requireClientAiConsent(data.clientId)"],
      ["src/lib/submission-reviews.functions.ts", "requireClientAiConsent(row.client_id)"],
      ["src/lib/messenger-checkins.functions.ts", "clientAllowsAi(row.client_id)"],
      ["src/lib/recovery-automation/reply-draft.server.ts", "requireClientAiConsent(input.clientId)"],
      ["src/lib/cleo-turns.server.ts", "clientAllowsAi(chat.client_id)"],
      ["src/lib/voice-transcribe.functions.ts", "clientAllowsAi((msg as any).client_id)"],
      ["src/lib/pain/describe.functions.ts", "userAllowsAi(userId)"],
    ];
    for (const [p, needle] of gated) expect(src(p), `${p} → ${needle}`).toContain(needle);
  });

  it("fails closed and is written only by the person", () => {
    const server = src("src/lib/ai-consent/consent.server.ts");
    expect(server).toMatch(/if \(error\) \{[\s\S]*?return false;/);
    const sql = src("supabase/migrations/20270527107000_ai_data_consent.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("user_id = (SELECT auth.uid())");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ai_consent_ok\(uuid, integer\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("can be withdrawn in Account → Privacy & data", () => {
    expect(src("src/routes/_authenticated/portal/account.tsx")).toContain("<AiConsentPanel />");
    expect(src("src/components/ai-consent/ai-consent.tsx")).toContain("data-ai-consent-withdraw");
  });
});

describe("AI consent is asked in place, never by a popup (Nov 25 2026)", () => {
  const ui = src("src/components/ai-consent/ai-consent.tsx");

  it("has no automatic prompt, host sheet or dialog left", () => {
    expect(ui).not.toMatch(/AiConsentPrompt|AiConsentHost|AiConsentSheet|requestAiConsent/);
    expect(ui).not.toMatch(/from "@\/components\/ui\/(sheet|dialog|alert-dialog)"/);
    expect(ui).not.toContain("sessionStorage");
    expect(src("src/routes/_authenticated/portal/route.tsx")).not.toContain("AiConsent");
    expect(src("src/routes/_authenticated/route.tsx")).not.toContain("AiConsent");
  });

  it("only a tap on Allow saves a yes; nothing is pre-ticked", () => {
    // every write goes through set(granted) from a tap; the only literal true is the Allow answer
    expect(ui.match(/set\(true\)/g) ?? []).toHaveLength(0);
    expect(ui).toContain("onClick={() => void answer(true)}");
    expect(ui).not.toMatch(/useEffect\([^)]*answer\(/);
    expect(ui).not.toMatch(/useEffect\([\s\S]{0,200}set\(true/);
  });

  it("is never asked of staff or in View as client", () => {
    expect(ui).toMatch(/askable = !!userId && \(role === "client" \|\| role === "member"\) && !isImpersonating/);
    expect(ui).toMatch(/needsYes: askable &&/);
  });

  it("sits inside onboarding, compact", () => {
    expect(src("src/components/member/member-setup-wizard.tsx")).toContain("<AiConsentChoice />");
    expect(src("src/components/client-goals/GoalsSetupFlow.tsx")).toContain("<AiConsentChoice />");
    const banner = src("src/components/portal/setup-checklist-banner.tsx");
    expect(banner).toContain("AiConsentChoice");
    // optional: never counts toward progress or brings the checklist back
    expect(banner).toMatch(/key: "ai",[\s\S]*?optional: true/);
  });

  it("features that send data ask beside their action", () => {
    expect(src("src/components/nutrition/DailyNutritionPanel.tsx")).toContain("<AiConsentGate");
    for (const p of [
      "src/components/program-import/import-start.tsx",
      "src/components/program-import/import-review.tsx",
      "src/components/nutrition-studio/plan-source-picker.tsx",
      "src/components/nutrition-studio/studio-start.tsx",
    ]) {
      expect(src(p), p).toContain("useAiConsentInline(");
    }
    expect(src("src/components/pain/pain-map.tsx")).toContain("<AiConsentInline");
  });

  it("keeps the full disclosure in Account → Privacy & data", () => {
    const panel = ui.slice(ui.indexOf("export function AiConsentPanel"));
    expect(panel).toContain("<AiConsentDetails />");
    expect(ui).toContain("AI_PROVIDERS.map");
  });
});
