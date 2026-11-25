import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AI_CONSENT_VERSION } from "@/lib/ai-consent/consent";

let role: string = "client";
let impersonating = false;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" }, role }) }));
vi.mock("@/lib/client-impersonation", () => ({ useClientImpersonation: () => ({ isImpersonating: impersonating }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) } }));

const mod = await import("@/components/ai-consent/ai-consent");
const { AiConsentChoice, AiConsentPanel, AiConsentInline } = mod;
// children passed positionally to createElement
const AiConsentGate = mod.AiConsentGate as any;

function render(el: any, row: unknown) {
  const qc = new QueryClient();
  qc.setQueryData(["ai-consent", "u1"], row);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el));
}

const action = createElement("button", { "data-action": "" }, "Estimate");
const granted = { granted: true, text_version: AI_CONSENT_VERSION };
const declined = { granted: false, text_version: AI_CONSENT_VERSION };

describe("AI consent asked in place", () => {
  it("a gate shows the action once allowed, the inline request until then", () => {
    role = "client";
    impersonating = false;
    expect(render(createElement(AiConsentGate, { use: "estimates the meal you describe" }, action), granted)).toContain("data-action");
    const asked = render(createElement(AiConsentGate, { use: "estimates the meal you describe" }, action), null);
    expect(asked).not.toContain("data-action");
    expect(asked).toContain("data-ai-consent-inline");
    expect(asked).toContain("This estimates the meal you describe using OpenAI.");
    // a no still needs a yes for this feature, asked in place only when they're here
    expect(render(createElement(AiConsentGate, {}, action), declined)).toContain("data-ai-consent-inline");
  });

  it("staff and View as client are never asked", () => {
    role = "admin";
    expect(render(createElement(AiConsentGate, {}, action), null)).toContain("data-action");
    expect(render(createElement(AiConsentChoice), null)).toBe("");
    role = "client";
    impersonating = true;
    expect(render(createElement(AiConsentGate, {}, action), null)).toContain("data-action");
    expect(render(createElement(AiConsentChoice), null)).toBe("");
    impersonating = false;
  });

  it("onboarding asks only while unanswered, with nothing picked", () => {
    role = "member";
    const html = render(createElement(AiConsentChoice), null);
    expect(html).toContain("data-ai-consent-choice");
    expect(html).not.toContain('aria-checked="true"');
    expect(render(createElement(AiConsentChoice), granted)).toBe("");
    expect(render(createElement(AiConsentChoice), declined)).toBe("");
    // a wording change asks again
    expect(render(createElement(AiConsentChoice), { granted: true, text_version: AI_CONSENT_VERSION - 1 })).toContain("data-ai-consent-choice");
  });

  it("the inline request keeps the full disclosure one tap away and can be dismissed", () => {
    role = "client";
    const html = render(createElement(AiConsentInline, { use: "reads your program", onDismiss: () => {} }), null);
    expect(html).toContain("data-ai-consent-more");
    expect(html).toContain("data-ai-consent-dismiss");
    expect(html).toContain("data-ai-consent-allow");
  });

  it("Account shows every provider and the right controls", () => {
    role = "client";
    const off = render(createElement(AiConsentPanel), null);
    expect(off).toContain("OpenAI");
    expect(off).toContain("Google (Gemini)");
    expect(off).toContain("data-ai-consent-allow");
    const on = render(createElement(AiConsentPanel), granted);
    expect(on).toContain("data-ai-consent-withdraw");
    expect(on).not.toContain("data-ai-consent-allow");
  });
});
