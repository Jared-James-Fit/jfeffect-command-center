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
const { AiConsentCheckbox, AiConsentPanel, AiConsentInline } = mod;
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
  it("a gate shows the action once allowed, the one request until answered, then a quiet off line", () => {
    role = "client";
    impersonating = false;
    expect(render(createElement(AiConsentGate, { use: "estimates the meal you describe" }, action), granted)).toContain("data-action");
    const asked = render(createElement(AiConsentGate, { use: "estimates the meal you describe" }, action), null);
    expect(asked).not.toContain("data-action");
    expect(asked).toContain("data-ai-consent-inline");
    expect(asked).toContain("This estimates the meal you describe using OpenAI.");
    // Allow / Don't allow, both saved, so it's asked once
    expect(asked).toContain("data-ai-consent-allow");
    expect(asked).toContain("data-ai-consent-decline");
    // after a no: a state with Turn on, never the request again
    const off = render(createElement(AiConsentGate, {}, action), declined);
    expect(off).toContain("data-ai-consent-off");
    expect(off).toContain("data-ai-consent-turn-on");
    expect(off).not.toContain("data-ai-consent-decline");
    // a wording change asks again
    expect(render(createElement(AiConsentGate, {}, action), { granted: true, text_version: AI_CONSENT_VERSION - 1 })).toContain("data-ai-consent-inline");
  });

  it("staff and View as client are never asked", () => {
    role = "admin";
    expect(render(createElement(AiConsentGate, {}, action), null)).toContain("data-action");
    role = "client";
    impersonating = true;
    expect(render(createElement(AiConsentGate, {}, action), null)).toContain("data-action");
    impersonating = false;
  });

  it("the agreement box starts unticked, names the providers and says it's optional", () => {
    const html = render(createElement(AiConsentCheckbox, { checked: false, onChange: () => {} }), null);
    expect(html).toContain("data-ai-consent-checkbox");
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("(optional)");
    expect(html).toContain("OpenAI and Google");
    expect(html).toContain("outside Canada");
    expect(html).toContain("Privacy &amp; data");
  });

  it("the in-place request keeps the full disclosure one tap away", () => {
    role = "client";
    const html = render(createElement(AiConsentInline, { use: "reads your program", onNo: () => {} }), null);
    expect(html).toContain("data-ai-consent-more");
    expect(html).toContain("outside Canada");
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
