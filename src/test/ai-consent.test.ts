import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_CONSENT_MARKER,
  AI_CONSENT_ONCE_KEY,
  AI_CONSENT_VERSION,
  AI_PROVIDERS,
  aiConsentAllows,
  aiConsentNeedsAsking,
  aiConsentState,
  checkboxDecision,
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
    expect(ui).not.toMatch(/AiConsentPrompt|AiConsentHost|AiConsentSheet|requestAiConsent|\bAiConsentChoice\b/);
    expect(ui).not.toMatch(/from "@\/components\/ui\/(sheet|dialog|alert-dialog)"/);
    expect(ui).not.toContain("sessionStorage");
    expect(src("src/routes/_authenticated/portal/route.tsx")).not.toContain("AiConsent");
    expect(src("src/routes/_authenticated/route.tsx")).not.toContain("AiConsent");
  });

  it("only a tick or a tap on Allow saves a yes; nothing is pre-ticked", () => {
    expect(ui).toContain("onClick={() => void answer(true)}");
    expect(ui).not.toMatch(/useEffect\([\s\S]{0,300}(answer|set|saveAiConsent)\(true/);
    for (const p of ["src/components/join/activate-page.tsx", "src/components/coaching-agreement/agreement-sign-flow.tsx"]) {
      expect(src(p), p).toContain("const [aiAllowed, setAiAllowed] = useState(false);");
    }
  });

  it("is never asked of staff or in View as client", () => {
    expect(ui).toMatch(/askable = !!userId && \(role === "client" \|\| role === "member"\) && !isImpersonating/);
    expect(ui).toMatch(/needsYes: askable &&/);
  });

  it("sits in the Terms / agreement flows as its own unticked, optional box", () => {
    const activate = src("src/components/join/activate-page.tsx");
    expect(activate).toContain("<AiConsentCheckbox");
    // agreeing to the Terms never waits on it
    expect(activate).toContain("if (!agreed) return setError(SIGNUP_ACK_MISSING);");
    expect(activate).not.toMatch(/if \(!aiAllowed\)/);
    expect(activate).toContain("if (!signErr) await recordAiConsentChoice(aiAllowed);");
    const sign = src("src/components/coaching-agreement/agreement-sign-flow.tsx");
    expect(sign).toContain("<AiConsentCheckbox");
    expect(sign).toContain("recordAiConsentChoice(aiAllowed, aiConsent.row)");
    // the old onboarding cards are gone (one place to ask, not four)
    for (const p of ["src/components/member/member-setup-wizard.tsx", "src/components/client-goals/GoalsSetupFlow.tsx", "src/components/portal/setup-checklist-banner.tsx"]) {
      expect(src(p), p).not.toContain("AiConsent");
    }
  });

  it("an unticked box records a no only where there was no answer, never over one", () => {
    expect(checkboxDecision(true, null)).toBe(true);
    expect(checkboxDecision(false, null)).toBe(false);
    expect(checkboxDecision(true, { granted: true, text_version: AI_CONSENT_VERSION })).toBeNull();
    expect(checkboxDecision(false, { granted: true, text_version: AI_CONSENT_VERSION })).toBeNull();
    expect(checkboxDecision(false, { granted: false, text_version: AI_CONSENT_VERSION })).toBeNull();
    expect(checkboxDecision(true, { granted: false, text_version: AI_CONSENT_VERSION })).toBe(true);
    expect(checkboxDecision(false, { granted: true, text_version: AI_CONSENT_VERSION - 1 })).toBe(false);
  });

  it("features that send data ask once, beside their action", () => {
    expect(src("src/components/nutrition/DailyNutritionPanel.tsx")).toContain("<AiConsentGate");
    for (const p of [
      "src/components/program-import/import-start.tsx",
      "src/components/program-import/import-review.tsx",
      "src/components/nutrition-studio/plan-source-picker.tsx",
      "src/components/nutrition-studio/studio-start.tsx",
    ]) {
      expect(src(p), p).toContain("useAiConsentInline(");
    }
    // the pain report's mic asks in one line, at the tap, before anything records
    const pain = src("src/components/pain/pain-reporter.tsx");
    expect(pain).toContain("if (consent.needsYes) {");
    expect(pain).toContain("data-pain-voice-consent");
    // the weekly check-in asks once ever (server-side seen), never blocking Send
    expect(src("src/components/messages/messenger-checkin-card.tsx")).toContain("<AiConsentOnce");
    expect(AI_CONSENT_ONCE_KEY).toContain(`v${AI_CONSENT_VERSION}`);
    expect(ui).toContain("markFeatureSeen(userId, AI_CONSENT_ONCE_KEY)");
  });

  it("keeps the full disclosure in Account → Privacy & data", () => {
    const panel = ui.slice(ui.indexOf("export function AiConsentPanel"));
    expect(panel).toContain("<AiConsentDetails />");
    expect(ui).toContain("AI_PROVIDERS.map");
  });
});

describe("the documents say the same thing", () => {
  it("Terms and Privacy Policy drafts describe the optional, separate permission", () => {
    const sql = src("supabase/migrations/20270530100000_ai_consent_terms_privacy.sql");
    expect(sql).toContain("10.1 Optional AI features");
    expect(sql).toContain("Agreeing to these Terms is not that permission");
    expect(sql).toContain("it is never a condition of using JF Effect");
    expect(sql).toContain("the app asks you on a screen of its own"); // the wording it replaces
    // drafts for the owner to publish, and nobody is asked to accept again
    expect(sql.match(/'draft'/g)?.length).toBe(2);
    expect(sql).toMatch(/false, v_base\.reacceptance_audience/);
    expect(sql).not.toMatch(/status\s*=\s*'published'\s*,/);
  });

  it("the Coaching Agreement no longer makes AI tools part of signing", async () => {
    const { AGREEMENT_CONTENT_JSON, AGREEMENT_VERSION } = await import("@/lib/coaching-agreement/content");
    expect(AGREEMENT_VERSION).toBe("3.1");
    const content = JSON.parse(AGREEMENT_CONTENT_JSON);
    const health = content.acknowledgements.find((a: any) => a.id === "health").text as string;
    expect(health).toContain("Sending it to AI tools is a separate, optional choice.");
    expect(health).not.toMatch(/including by service providers and AI tools/);
    expect(AGREEMENT_CONTENT_JSON).toContain("AI tools (optional).");
  });
});
