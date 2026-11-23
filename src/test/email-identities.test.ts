import { readFileSync } from "node:fs";
import * as React from "react";
import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import { CONTACT, EMAIL_IDENTITIES, emailEnvelope, emailFrom } from "@/lib/email-identity";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { BRAND_LOGO_URL } from "@/lib/email-templates/brand";

/*
 * Every app email comes from a JF Effect department on the verified sender, with a Reply-To
 * on a real business inbox, and never shows a personal Gmail address or the project's
 * internal name to a client.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("sender identities", () => {
  it("keeps the verified From address and sender domain for every department", () => {
    for (const key of Object.keys(EMAIL_IDENTITIES) as (keyof typeof EMAIL_IDENTITIES)[]) {
      const env = emailEnvelope(key);
      expect(env.from).toMatch(/<noreply@jfeffect\.com>$/);
      expect(env.sender_domain).toBe("notify.jfeffect.com");
      expect(env.reply_to).toMatch(/@jfeffect\.com$/);
    }
  });

  it("sends replies to the right inbox", () => {
    expect(emailEnvelope("coaching").reply_to).toBe(CONTACT.coaching);
    expect(emailEnvelope("billing").reply_to).toBe(CONTACT.billing);
    expect(emailEnvelope("support").reply_to).toBe(CONTACT.support);
    expect(emailEnvelope("account").reply_to).toBe(CONTACT.support);
    expect(emailFrom("billing")).toBe("JF Effect Billing <noreply@jfeffect.com>");
  });

  it("passes Reply-To through the queue dispatcher", () => {
    expect(read("src/routes/lovable/email/queue/process.ts")).toMatch(
      /reply_to:\s*payload\.reply_to/,
    );
  });

  it("uses the shared envelope at every place an email is queued", () => {
    for (const p of [
      "src/lib/transactional-email.server.ts",
      "src/lib/membership-onboarding-email.server.ts",
      "src/lib/setup-reminder.server.ts",
      "src/lib/coaching-agreement.server.ts",
      "src/routes/lovable/email/transactional/send.ts",
      "src/routes/lovable/email/auth/webhook.ts",
    ]) {
      const src = read(p);
      expect(src, p).toContain("emailEnvelope(");
      expect(src, p).not.toContain("jfeffect-command-center");
      expect(src, p).not.toMatch(/from:\s*`\$\{SITE_NAME\}/);
    }
  });
});

describe("client emails", () => {
  it("every template names its department", () => {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      expect(t.identity, name).toBeDefined();
    }
    expect(TEMPLATES["application-received"].identity).toBe("coaching");
    expect(TEMPLATES["payment-link"].identity).toBe("billing");
    expect(TEMPLATES["agreement-signed"].identity).toBe("coaching");
  });

  it("render with the JF Effect header and never show a personal Gmail", async () => {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      const html = await render(React.createElement(t.component, t.previewData ?? {}));
      expect(html, name).toContain(BRAND_LOGO_URL);
      expect(html, name).not.toMatch(/@gmail\.com/i);
      expect(html, name).not.toContain("jfeffect-command-center");
    }
  });

  it("no longer sends the applicant confirmation or payment link from Gmail", () => {
    const notify = read("src/lib/coaching-app-notify.server.ts");
    const applicant = notify.slice(
      notify.indexOf("export async function sendApplicantConfirmationEmail"),
    );
    expect(applicant.slice(0, applicant.indexOf("\n}\n"))).toContain(
      'template: "application-received"',
    );
    const payments = read("src/lib/payments.functions.ts");
    const link = payments.slice(
      payments.indexOf("export const sendPaymentLinkEmail"),
      payments.indexOf("const CreateLink"),
    );
    expect(link).toContain('template: "payment-link"');
    expect(link).not.toContain("google_mail");
  });
});
