import { describe, expect, it } from "vitest";
import { scannerSafeAuthLink } from "@/lib/scanner-safe-auth-link";

const SITE = "https://jfeffect.com";
const verify = (type: string, redirect: string) =>
  `https://abc.supabase.co/auth/v1/verify?token=hash123&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

describe("scannerSafeAuthLink", () => {
  it("routes invites to /setup with the token hash (no one-time verify URL)", () => {
    const out = scannerSafeAuthLink({ url: verify("invite", "https://jfeffect.com/setup"), siteUrl: SITE })!;
    expect(out).toBe("https://jfeffect.com/setup?token_hash=hash123&type=invite");
    expect(out).not.toContain("/auth/v1/verify");
  });
  it("routes recovery to /reset-password", () => {
    expect(scannerSafeAuthLink({ url: verify("recovery", "https://jfeffect.com/reset-password"), siteUrl: SITE }))
      .toBe("https://jfeffect.com/reset-password?token_hash=hash123&type=recovery");
  });
  it("keeps recovery sent to /setup on /setup (existing-account setup)", () => {
    expect(scannerSafeAuthLink({ url: verify("recovery", "https://jfeffect.com/setup"), siteUrl: SITE }))
      .toBe("https://jfeffect.com/setup?token_hash=hash123&type=recovery");
  });
  it("prefers an explicit token hash and redirect", () => {
    expect(scannerSafeAuthLink({ url: verify("invite", "https://x.lovable.app/setup"), tokenHash: "h2", siteUrl: SITE }))
      .toBe("https://x.lovable.app/setup?token_hash=h2&type=invite");
  });
  it("leaves other destinations and foreign hosts alone", () => {
    expect(scannerSafeAuthLink({ url: verify("invite", "https://jfeffect.com/member-setup"), siteUrl: SITE })).toBeNull();
    expect(scannerSafeAuthLink({ url: verify("invite", "https://evil.com/setup"), siteUrl: SITE })).toBeNull();
    expect(scannerSafeAuthLink({ url: verify("email_change", "https://jfeffect.com/setup"), siteUrl: SITE })).toBeNull();
  });
  it("leaves PKCE links alone", () => {
    expect(scannerSafeAuthLink({ url: verify("invite", "https://jfeffect.com/setup"), tokenHash: "pkce_abc", siteUrl: SITE })).toBeNull();
  });
  it("maps a bare site-root redirect to the right page", () => {
    expect(scannerSafeAuthLink({ url: verify("invite", "https://jfeffect.com"), siteUrl: SITE }))
      .toBe("https://jfeffect.com/setup?token_hash=hash123&type=invite");
  });
});
