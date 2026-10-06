import { readFileSync } from "node:fs";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import { opensOnContinue, readAuthLinkSearch, supabasePreconnectLinks } from "@/lib/auth-link-page";
import { PASSWORD_RULES, passwordIsValid } from "@/lib/account-recovery.constants";
import { InviteEmail } from "@/lib/email-templates/invite";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { template as setupReminder } from "@/lib/email-templates/setup-reminder";

const read = (path: string) => readFileSync(path, "utf8");

describe("setup and reset links open fast", () => {
  it("reads the token from the link the same way on the server and the client", () => {
    expect(readAuthLinkSearch({ token_hash: "abc", type: "recovery" })).toEqual({ token_hash: "abc", type: "recovery", rt: undefined });
    // The router parses an all-digit value as a number; it's still the token.
    expect(readAuthLinkSearch({ token_hash: 12345 }).token_hash).toBe("12345");
    expect(readAuthLinkSearch({}).token_hash).toBeUndefined();
  });

  it("opens straight on Continue when the link carries its token", () => {
    expect(opensOnContinue({ token_hash: "abc" })).toBe(true);
    expect(opensOnContinue({})).toBe(false);
    // An SMS reset token is checked by the server first.
    expect(opensOnContinue({ token_hash: "abc", rt: "x" })).toBe(false);
  });

  it("connects to Supabase early", () => {
    const [link] = supabasePreconnectLinks();
    expect(link.rel).toBe("preconnect");
    expect(link.href).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });

  it.each(["src/routes/setup.tsx", "src/routes/reset-password.tsx"])(
    "%s renders Continue from the server and holds the button until the app is ready",
    (file) => {
      const src = read(file);
      expect(src).toContain("validateSearch: readAuthLinkSearch");
      expect(src).toContain("links: supabasePreconnectLinks()");
      expect(src).toContain('>(opensOnContinue(search) ? "confirm" : "loading");');
      expect(src).toContain("disabled={verifying || !hydrated}");
      expect(src).toContain('{!hydrated ? "Loading…"');
      // The Continue screen no longer waits on a sign-out first.
      expect(src).toContain('void supabase.auth.signOut({ scope: "local" })');
    },
  );
});

describe("one simple password rule", () => {
  it("is at least 8 characters and nothing else", () => {
    expect(PASSWORD_RULES.minLength).toBe(8);
    expect(passwordIsValid("simple12")).toBe(true);
    expect(passwordIsValid("password")).toBe(true);
    expect(passwordIsValid("short")).toBe(false);
  });

  it("is what every password screen and server check uses", () => {
    expect(read("src/routes/reset-password.tsx")).not.toMatch(/uppercase letter|special character|10 characters/);
    expect(read("src/routes/setup.tsx")).toContain("passwordIsValid(password)");
    expect(read("src/routes/member-setup.tsx")).toContain("passwordIsValid(password)");
    expect(read("src/lib/account-recovery.functions.ts")).toContain("newPassword: z.string().min(PASSWORD_RULES.minLength)");
    expect(read("src/lib/members.functions.ts")).toContain("password: z.string().min(PASSWORD_RULES.minLength");
  });
});

describe("setup emails warn the page can take a moment", () => {
  const HEADS_UP = "The page can take a few seconds to open, so give it a moment.";
  const url = "https://jfeffect.com/setup?token_hash=abc&type=invite";

  it.each([
    ["client setup", InviteEmail, { siteName: "JF Effect", siteUrl: "https://jfeffect.com", confirmationUrl: url }],
    ["password", RecoveryEmail, { siteName: "JF Effect", confirmationUrl: url }],
    ["member setup", setupReminder.component, { first_name: "Bob", setup_url: "https://jfeffect.com/member-setup?token=abc" }],
  ])("%s email", async (_name, Template: any, props: any) => {
    const html = await render(React.createElement(Template, props));
    expect(html).toContain(HEADS_UP);
  });
});
