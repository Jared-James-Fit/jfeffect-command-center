import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINK_HEADS_UP, smsSegments, withLinkHeadsUp } from "@/lib/sms-identity";
import { recoverySmsBody } from "@/lib/account-recovery.constants";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("texts with an app link say it can take a minute to open", () => {
  it("goes before Reply STOP, so the opt-out stays last", () => {
    expect(withLinkHeadsUp("Hi Alex, tap to finish setup: https://jfeffect.com/setup?t=abc\n\nReply STOP to opt out.")).toBe(
      `Hi Alex, tap to finish setup: https://jfeffect.com/setup?t=abc ${LINK_HEADS_UP} Reply STOP to opt out.`,
    );
  });

  it("goes on the end when there's no opt-out line (the password reset text)", () => {
    const body = withLinkHeadsUp(recoverySmsBody("https://jfeffect.com/reset-password?rt=x"));
    expect(body.endsWith(`ignore this message. ${LINK_HEADS_UP}`)).toBe(true);
  });

  it("only once, and only for links into the app", () => {
    const once = withLinkHeadsUp("Open https://jfeffect.com/portal");
    expect(withLinkHeadsUp(once)).toBe(once);
    expect(withLinkHeadsUp("See https://jfeffect-command-center.lovable.app/book/x")).toContain(LINK_HEADS_UP);
    for (const plain of [
      "Join: https://meet.google.com/abc-defg-hij",
      "Watch https://youtu.be/xyz",
      "You have an unread message from me in the app. Reply STOP to opt out.",
    ]) expect(withLinkHeadsUp(plain)).toBe(plain);
  });

  it("is plain GSM text, so it never turns a text into 70-character unicode parts", () => {
    expect(smsSegments(LINK_HEADS_UP)).toBe(1);
    expect(/^[\x20-\x7E]+$/.test(LINK_HEADS_UP)).toBe(true);
  });

  it("every sender that texts clients (or invitees) a link adds it; staff alerts don't", () => {
    for (const f of [
      "src/lib/sms.functions.ts", // manual, bulk, automations, session reminders, payment reminders
      "src/lib/sms-trigger.server.ts",
      "src/lib/sms-links.functions.ts",
      "src/lib/onboarding-admin.functions.ts",
      "src/lib/account-recovery.functions.ts",
      "src/lib/staff-invites.server.ts",
      "src/routes/api/public/hooks/appointment-reminders.ts",
    ]) expect(read(f), f).toContain("Body: withLinkHeadsUp(body)");
    for (const f of ["src/lib/support-alerts.functions.ts", "src/lib/coaching-app-notify.server.ts", "src/lib/missing-maxes.functions.ts"])
      expect(read(f), f).not.toContain("withLinkHeadsUp");
  });

  it("the SMS editor's preview shows it, so the segment count is what's really sent", () => {
    expect(read("src/components/sms-template-field.tsx")).toContain("const preview = withLinkHeadsUp(renderSmsTemplate(");
  });
});

describe("emails with a button say it too", () => {
  it("every email template with a button has the heads-up under it", () => {
    const dir = "src/lib/email-templates";
    const withButton = readdirSync(dir).filter((f) => f.endsWith(".tsx") && read(`${dir}/${f}`).includes("<Button"));
    expect(withButton.length).toBeGreaterThanOrEqual(9);
    for (const f of withButton) expect(read(`${dir}/${f}`), f).toMatch(/<\/Button>\s*<LinkHeadsUp \/>/);
    expect(read(`${dir}/link-heads-up.tsx`)).toContain("{LINK_HEADS_UP}");
  });
});

describe("loading screens explain a slow open", () => {
  const css = read("src/styles.css");
  it("fades in by CSS after a few seconds, so it shows before the JavaScript arrives", () => {
    expect(css).toContain("animation: slow-load-hint-in 400ms ease-out 4s both;");
  });
  it("is on the app splash (Retry only after 30s) and on the pages links open", () => {
    const splash = read("src/components/dashboard-splash.tsx");
    expect(splash).toContain("<SlowLoadHint ");
    expect(splash).toContain("setVerySlow(true), 30000)");
    for (const f of [
      "src/routes/reset-password.tsx",
      "src/routes/setup.tsx",
      "src/routes/sign.$token.tsx",
      "src/routes/staff-setup.tsx",
      "src/routes/m.welcome.tsx",
      "src/components/booking/booking-page.tsx",
    ]) expect(read(f), f).toContain("<SlowLoadHint />");
  });
});
