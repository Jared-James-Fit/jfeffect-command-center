import { readFileSync } from "node:fs";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import { InviteEmail } from "@/lib/email-templates/invite";
import { RecoveryEmail } from "@/lib/email-templates/recovery";

const read = (path: string) => readFileSync(path, "utf8");
const LINK = "https://jfeffect.com/setup?token_hash=abc123&type=invite";
const props = { siteName: "JF Effect", siteUrl: "https://jfeffect.com", confirmationUrl: LINK };

describe("onboarding emails", () => {
  it.each([
    ["setup (new client)", InviteEmail],
    ["password (existing account)", RecoveryEmail],
  ])("%s email shows the link as text as well as on the button", async (_name, Template: any) => {
    const html = await render(React.createElement(Template, props));
    const href = `href="${LINK.replace(/&/g, "&amp;")}"`;
    // Button and text link both go to the setup page, so a disabled button isn't a dead end.
    expect(html.split(href).length - 1).toBe(2);
    expect(html).toContain("Button not working? Copy this link into your browser:");
    expect(html).not.toContain("jfeffect-command-center");

    const text = await render(React.createElement(Template, props), { plainText: true });
    expect(text).toContain(LINK);
  });

  it("comes from JF Effect, never the internal project name", () => {
    for (const file of [
      "src/routes/lovable/email/auth/webhook.ts",
      "src/routes/lovable/email/auth/preview.ts",
      "src/routes/lovable/email/transactional/send.ts",
      "src/lib/membership-onboarding-email.server.ts",
      "src/lib/setup-reminder.server.ts",
      "src/lib/coaching-agreement.server.ts",
    ]) {
      expect(read(file), file).toMatch(/const SITE_NAME = ["']JF Effect["']/);
    }
  });

  it("gives the account emails specific subjects", () => {
    const hook = read("src/routes/lovable/email/auth/webhook.ts");
    expect(hook).toContain("invite: 'Set up your JF Effect account'");
    expect(hook).toContain("recovery: 'Set your JF Effect password'");
    expect(hook).not.toContain("You've been invited");
  });
});
