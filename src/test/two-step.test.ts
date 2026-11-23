/**
 * Two-step sign-in by text, passkey and trusted device (two-step.ts): the
 * rules, the words, and that every piece is wired where it must be.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  codeFromRandom,
  deviceName,
  emailBackupFrom,
  emailBackupLine,
  emailBackupSwitchOn,
  kindsInOrder,
  leavesOnlyPasskeys,
  maskEmail,
  maskPhone,
  needsFasterWay,
  newSmsCode,
  normalizeSmsCode,
  orderMethods,
  passkeyLabel,
  passkeyWord,
  sendRefusalText,
  checkRefusalText,
  smsCodeHash,
  smsCodeText,
  twoStepPhone,
  waitWords,
  type TwoStepMethod,
} from "@/lib/two-step";
import { MFA_EXEMPT_FNS } from "@/lib/mfa-rules";
import { smsSegments } from "@/lib/sms-identity";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

describe("texted codes", () => {
  it("are 6 digits, from the random word, and skip words past the last full million (no lean)", () => {
    expect(codeFromRandom([123])).toBe("000123");
    expect(codeFromRandom([4_294_967_295, 7_000_042])).toBe("000042");
    expect(codeFromRandom([4_294_967_295])).toBeNull();
    for (let i = 0; i < 200; i++) expect(newSmsCode()).toMatch(/^\d{6}$/);
  });

  it("read what someone typed or pasted", () => {
    expect(normalizeSmsCode(" 123 456 ")).toBe("123456");
    expect(normalizeSmsCode("123-456")).toBe("123456");
    expect(normalizeSmsCode("12345")).toBeNull();
    expect(normalizeSmsCode(null)).toBeNull();
  });

  it("hash per login and per session, so a code is only good for the sign-in it was sent for", async () => {
    const a = await smsCodeHash("u1", "s1", "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await smsCodeHash("u1", "s1", "123456")).toBe(a);
    expect(await smsCodeHash("u1", "s2", "123456")).not.toBe(a);
    expect(await smsCodeHash("u2", "s1", "123456")).not.toBe(a);
  });

  it("go in one text segment, code first, bound to jfeffect.com for autofill", () => {
    for (const p of ["sign_in", "add_phone"] as const) {
      const t = smsCodeText("482913", p);
      expect(t.startsWith("482913 ")).toBe(true);
      expect(t.endsWith("\n\n@jfeffect.com #482913")).toBe(true);
      expect(t).toMatch(/Never share it/);
      expect(smsSegments(t)).toBe(1);
    }
  });
});

describe("phones", () => {
  it("only a Canadian or US number, as E.164", () => {
    expect(twoStepPhone("(204) 555-0123")).toBe("+12045550123");
    expect(twoStepPhone("1 204 555 0123")).toBe("+12045550123");
    expect(twoStepPhone("+44 7700 900123")).toBeNull();
    expect(twoStepPhone("555-0123")).toBeNull();
    expect(twoStepPhone("")).toBeNull();
  });

  it("are shown masked, never in full", () => {
    expect(maskPhone("+12045550123")).toBe("(•••) •••-0123");
    expect(maskPhone(null)).toBe("your phone");
  });
});

describe("devices and passkeys", () => {
  it("are named the way people call them", () => {
    expect(deviceName(IPHONE)).toBe("iPhone");
    expect(deviceName(MAC)).toBe("Mac");
    expect(deviceName(MAC, { touch: true })).toBe("iPad");
    expect(deviceName(PIXEL)).toBe("Android phone");
    expect(deviceName(WIN)).toBe("Windows PC");
    expect(passkeyWord(IPHONE)).toBe("Face ID");
    expect(passkeyWord(MAC)).toBe("Touch ID");
    expect(passkeyWord(WIN)).toBe("Windows Hello");
    expect(passkeyLabel(IPHONE)).toBe("Face ID · iPhone");
    expect(passkeyLabel(PIXEL)).toBe("Passkey · Android phone");
  });
});

describe("which way first", () => {
  const m = (
    kind: TwoStepMethod["kind"],
    id: string,
    lastUsedAt: string | null = null,
  ): TwoStepMethod => ({ id, kind, label: id, createdAt: null, lastUsedAt });
  const all = [m("totp", "app"), m("sms", "phone"), m("passkey", "face")];

  it("is the one they chose, then Face ID, then a text, then the app", () => {
    expect(kindsInOrder(orderMethods(all, null, true))).toEqual(["passkey", "sms", "totp"]);
    expect(kindsInOrder(orderMethods(all, "totp", true))).toEqual(["totp", "passkey", "sms"]);
    expect(kindsInOrder(orderMethods(all, "sms", true))).toEqual(["sms", "passkey", "totp"]);
  });

  it("leaves Face ID out where this device can't use a passkey (the iPhone app)", () => {
    expect(kindsInOrder(orderMethods(all, "passkey", false))).toEqual(["sms", "totp"]);
  });

  it("picks the phone used last when there are two", () => {
    const two = [m("sms", "old", "2026-11-01T00:00:00Z"), m("sms", "new", "2026-11-20T00:00:00Z")];
    expect(orderMethods(two, "sms", true)[0].id).toBe("new");
  });
});

describe("words", () => {
  it("say how long to wait in plain words", () => {
    expect(waitWords(12)).toBe("12 seconds");
    expect(waitWords(61)).toBe("2 minutes");
    expect(waitWords(60)).toBe("a minute");
    expect(waitWords(3600)).toBe("an hour");
    expect(waitWords(7200)).toBe("2 hours");
  });

  it("explain every refusal with what to do next", () => {
    expect(sendRefusalText("cooldown", 20)).toMatch(/20 seconds/);
    expect(sendRefusalText("security_daily_cap")).toMatch(/another way/);
    expect(sendRefusalText("security_texts_off")).toMatch(/can't be sent/);
    expect(sendRefusalText("country_not_allowed")).toMatch(/Canadian or US/);
    expect(checkRefusalText("wrong", 3)).toMatch(/3 more tries/);
    expect(checkRefusalText("wrong", 1)).toMatch(/One more try/);
    expect(checkRefusalText("used_up")).toMatch(/new one/);
    expect(checkRefusalText("expired")).toMatch(/ran out/);
  });
});

describe("wired in", () => {
  const fns = readFileSync("src/lib/two-step.functions.ts", "utf8");

  it("every function the guard lets through before confirming exists, once, in the app", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !p.includes(`${path.sep}test${path.sep}`)) files.push(p);
      }
    };
    walk("src");
    for (const name of MFA_EXEMPT_FNS) {
      const exporters = files.filter((f) =>
        new RegExp(`export const ${name}\\b`).test(readFileSync(f, "utf8")),
      );
      expect(exporters, name).toHaveLength(1);
    }
  });

  it("texts only team logins, only through the one sender, as an account-security text", () => {
    const send = fns.slice(
      fns.indexOf("export const sendTwoStepCode"),
      fns.indexOf("export type ConfirmResult"),
    );
    expect(send).toContain("await s.requireTeam(db, uid)");
    expect(send).toContain('category: "security"');
    expect(send).toContain("sendSms(db");
    expect(send).not.toMatch(/twilioFetch|api\.twilio/);
    // a new phone on a login that has a way already needs a confirmed session
    expect(send).toContain(
      "if (hasAny && !(await s.sessionConfirmed(db, uid, context.claims as any)))",
    );
    // never the code in the log
    expect(send).toContain("code hidden");
  });

  it("adds a way to an unconfirmed session only as its first, everywhere a way is added", () => {
    const verify = fns.slice(
      fns.indexOf("export const verifyTwoStepCode"),
      fns.indexOf("export const startTwoStepPasskey"),
    );
    expect(verify).toContain(
      "if (!first && !(await s.sessionConfirmed(db, uid, context.claims as any)))",
    );
    const startPk = fns.slice(
      fns.indexOf("export const startTwoStepPasskey"),
      fns.indexOf("const credentialInput"),
    );
    expect(startPk).toContain(
      "if (hasAny && !(await s.sessionConfirmed(db, uid, context.claims as any)))",
    );
    const finish = fns.slice(
      fns.indexOf("export const finishTwoStepPasskey"),
      fns.indexOf("export const confirmWithTrustedDevice"),
    );
    expect(finish).toContain(
      "if (!first && !(await s.sessionConfirmed(db, uid, context.claims as any)))",
    );
  });

  it("spends a passkey challenge before checking it, for this login, session and purpose only", () => {
    const finish = fns.slice(
      fns.indexOf("export const finishTwoStepPasskey"),
      fns.indexOf("export const confirmWithTrustedDevice"),
    );
    for (const part of [
      '.eq("user_id", uid)',
      '.eq("session_id", sid)',
      '.eq("purpose", data.purpose)',
      '.is("used_at", null)',
      '.gt("expires_at"',
    ]) {
      expect(finish).toContain(part);
    }
    expect(finish.indexOf(".update({ used_at")).toBeLessThan(finish.indexOf("verifyRegistration("));
    expect(finish.indexOf(".update({ used_at")).toBeLessThan(finish.indexOf("verifyAssertion("));
  });

  it("never lets the last way go while the login needs two-step", () => {
    const remove = fns.slice(
      fns.indexOf("export const removeTwoStepMethod"),
      fns.indexOf("export const setTwoStepPreferred"),
    );
    expect(remove).toContain("if (required && methods.length <= 1)");
    expect(remove).toContain("requireConfirmed(context)");
  });

  it("puts Account's two-step card on the admin account page", () => {
    expect(readFileSync("src/routes/_authenticated/admin/account.tsx", "utf8")).toContain(
      "<TwoStepCard />",
    );
  });
});

describe("the faster-way offer", () => {
  const m = (kind: TwoStepMethod["kind"], id = kind): TwoStepMethod => ({
    id,
    kind,
    label: kind,
    createdAt: null,
    lastUsedAt: null,
  });

  it("offers Face ID or a text to a login with only the authenticator app", () => {
    expect(needsFasterWay([m("totp")], true)).toBe(true);
    expect(needsFasterWay([m("totp")], false)).toBe(true);
  });

  it("never asks a login that already has a faster way here, or none at all", () => {
    expect(needsFasterWay([m("totp"), m("sms")], true)).toBe(false);
    expect(needsFasterWay([m("totp"), m("passkey")], true)).toBe(false);
    expect(needsFasterWay([], true)).toBe(false);
  });

  it("offers a text where this device can't use the passkey they have (the app)", () => {
    expect(needsFasterWay([m("passkey")], false)).toBe(true);
  });

  it("warns before removing the last way the iPhone and Android apps can use", () => {
    const all = [m("passkey"), m("totp")];
    expect(leavesOnlyPasskeys(all, all[1])).toBe(true);
    expect(leavesOnlyPasskeys(all, all[0])).toBe(false);
    expect(leavesOnlyPasskeys([m("passkey"), m("sms"), m("totp")], m("totp"))).toBe(false);
    expect(leavesOnlyPasskeys([m("totp")], m("totp"))).toBe(false);
  });

  it("the gate offers it right after confirming, and Not now is remembered", () => {
    const gate = readFileSync("src/components/two-step/staff-mfa-gate.tsx", "utf8");
    expect(gate).toContain("needsFasterWay(methods, passkeysPossibleHere())");
    expect(gate).toContain("<FasterWayScreen");
    expect(gate).toContain("snoozeFasterOffer(uid)");
  });
});

describe("the email backup", () => {
  const day = (iso: string) => iso.slice(0, 10);
  const migration = readFileSync(
    "supabase/migrations/20270515090000_two_step_email_backup.sql",
    "utf8",
  );
  const fns = readFileSync("src/lib/two-step.functions.ts", "utf8");

  it("masks the address: enough to know which inbox", () => {
    expect(maskEmail("jaredjamesfit@gmail.com")).toBe("j•••@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
    expect(maskEmail("nope")).toBe("your email");
    expect(maskEmail(null)).toBe("your email");
  });

  it("reads the database's state, never showing the address in full", () => {
    const b = emailBackupFrom({
      on: true,
      chosen: true,
      email: "owner@example.com",
      ready: true,
      why: null,
      held_until: null,
    })!;
    expect(b).toEqual({
      on: true,
      to: "o•••@example.com",
      ready: true,
      why: null,
      heldUntil: null,
    });
    expect(emailBackupFrom({ on: false, email: null, ready: false, why: null })!.to).toBeNull();
    expect(emailBackupFrom(null)).toBeNull();
  });

  it("says why it's paused, and the switch stays on unless the email it was for is gone", () => {
    const held = emailBackupFrom({
      on: true,
      email: "o@x.com",
      ready: false,
      why: "reset",
      held_until: "2026-11-26T10:00:00+00:00",
    });
    expect(emailBackupLine(held, day)).toBe(
      "Paused until 2026-11-26: a password reset was sent to this email.",
    );
    expect(emailBackupSwitchOn(held)).toBe(true);
    const changed = emailBackupFrom({ on: true, email: "o@x.com", ready: false, why: "changed" });
    expect(emailBackupLine(changed, day)).toMatch(/changed/);
    expect(emailBackupSwitchOn(changed)).toBe(false);
    expect(emailBackupLine(emailBackupFrom({ on: false }), day)).toMatch(/^Off/);
    expect(emailBackupLine(null, day)).toMatch(/^Off/);
  });

  it("refusals say to use another way", () => {
    for (const r of [
      "email_off",
      "email_changed",
      "email_reset",
      "email_email_change",
      "email_suppressed",
      "email_failed",
    ]) {
      expect(sendRefusalText(r)).toMatch(/another way/);
    }
  });

  it("is never a way on its own and never chooses its own address", () => {
    // the enforced list and the login's ways are untouched
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.two_step_login_has/);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.mfa_enforced_logins/);
    // the address comes from the database's own state, never the request
    expect(migration).toContain("addr := backup ->> 'email'");
    const email = fns.slice(
      fns.indexOf("async function emailCode"),
      fns.indexOf("export type ConfirmResult"),
    );
    expect(email).toContain('_channel: "email"');
    expect(email).toContain("to: String(issued.email)");
    expect(email).toContain("sensitive: true");
    expect(email).toContain('if (purpose !== "sign_in")');
  });

  it("holds after a reset or an email change, and only goes to the email it was turned on for", () => {
    expect(migration).toContain("recovery_sent_at > now() - interval '3 days'");
    expect(migration).toContain("email_change_sent_at > now() - interval '3 days'");
    expect(migration).toContain("w.login_email IS DISTINCT FROM w.email_backup THEN 'changed'");
  });

  it("is turned on by default only from a confirmed session, and only for a login that never chose", () => {
    const server = readFileSync("src/lib/two-step.server.ts", "utf8");
    expect(server).toContain("emailBackupOf(db, userId, { ensure: verified })");
    expect(server).toContain("_only_if_unset: true");
    const set = fns.slice(fns.indexOf("export const setTwoStepEmailBackup"));
    expect(set).toContain("requireConfirmed(context)");
    expect(MFA_EXEMPT_FNS.has("setTwoStepEmailBackup")).toBe(false);
  });

  it("an emailed code marks the session as such and tells the person", () => {
    const verify = fns.slice(
      fns.indexOf("export const verifyTwoStepCode"),
      fns.indexOf("export const startTwoStepPasskey"),
    );
    expect(verify).toContain('byEmail ? "email" : "sms"');
    expect(verify).toContain("You signed in with an emailed code");
  });

  it("the gate offers it last, and first only when nothing else works here", () => {
    const gate = readFileSync("src/components/two-step/staff-mfa-gate.tsx", "utf8");
    expect(gate).toContain(
      '[...kindsInOrder(ordered), ...(emailBackup ? (["email"] as const) : [])]',
    );
    expect(gate).toContain('channel="email"');
    const card = readFileSync("src/components/two-step/two-step-card.tsx", "utf8");
    expect(card).toContain("<EmailBackupRow");
  });

  it("the email template is registered", async () => {
    const reg = readFileSync("src/lib/email-templates/registry.ts", "utf8");
    expect(reg).toContain("'two-step-code': twoStepCodeTemplate");
  });
});
