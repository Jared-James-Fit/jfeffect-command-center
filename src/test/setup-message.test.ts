import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { greetingName, setupMessageText, smsComposeHref, smsNotSentReason } from "@/lib/setup-message";
import { copyTextToClipboard } from "@/lib/copy-text";

const read = (path: string) => readFileSync(path, "utf8");
const URL = "https://jfeffect.com/setup?token_hash=abc&type=magiclink";

describe("setup message", () => {
  it("greets the client, carries the link and says what to tap", () => {
    const msg = setupMessageText({ firstName: "Bob", url: URL });
    expect(msg.startsWith("Hi Bob!")).toBe(true);
    expect(msg).toContain(`\n${URL}\n`);
    expect(msg).toContain("press Continue, then create your password");
    expect(msg).not.toContain("—");
  });

  it("words a reset as a new password, and still reads well without a name", () => {
    const msg = setupMessageText({ firstName: "  ", url: URL, kind: "reset" });
    expect(msg.startsWith("Hi there!")).toBe(true);
    expect(msg).toContain("set a new password");
    expect(msg).toContain("choose your password");
  });

  it("uses the first name, else the first word of the full name", () => {
    expect(greetingName({ first_name: "Robert", full_name: "Bob Smith" })).toBe("Robert");
    expect(greetingName({ first_name: null, full_name: "Bob Smith" })).toBe("Bob");
    expect(greetingName(null)).toBeNull();
  });

  it("skips the Continue step for member links, which open on the password form", () => {
    const msg = setupMessageText({ firstName: "Bob", url: URL, continueStep: false });
    expect(msg).toContain("Tap it, then create your password.");
    expect(msg).not.toContain("Continue");
  });

  it("explains in plain English why a setup text didn't go out", () => {
    expect(smsNotSentReason("no_phone")).toBe("no mobile number on file");
    expect(smsNotSentReason("not_on_allowlist")).toContain("allowlist");
    expect(smsNotSentReason("Twilio error (400)")).toBe("Twilio error (400)");
    expect(smsNotSentReason(undefined)).toBe("unknown error");
  });

  it("opens the coach's Messages app with the whole message", () => {
    const href = smsComposeHref("+12045550123", "Hi Bob!\nhttps://x.y/?a=1&b=2");
    expect(href.startsWith("sms:+12045550123?&body=")).toBe(true);
    expect(decodeURIComponent(href.split("body=")[1])).toBe("Hi Bob!\nhttps://x.y/?a=1&b=2");
  });
});

describe("copyTextToClipboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands the clipboard a promise, so iPhone Safari keeps the tap", async () => {
    let item: any = null;
    vi.stubGlobal("ClipboardItem", class { constructor(public items: Record<string, Promise<Blob>>) { item = this; } });
    const write = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    await copyTextToClipboard(Promise.resolve("hello"));
    expect(write).toHaveBeenCalledOnce();
    expect(await (await item.items["text/plain"]).text()).toBe("hello");
  });

  it("falls back to plain text where ClipboardItem is missing", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyTextToClipboard(Promise.resolve("hello"));
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("reports the server's error when the link can't be made", async () => {
    vi.stubGlobal("ClipboardItem", class { constructor(public items: any) {} });
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn(async (items: any[]) => { await items[0].items["text/plain"]; }), writeText: vi.fn() } });
    await expect(copyTextToClipboard(Promise.reject(new Error("Client has no email address")))).rejects.toThrow("Client has no email address");
  });
});

describe("new client onboarding wiring", () => {
  const dialog = read("src/components/clients/add-client-dialog.tsx");

  it("needs a real email and mobile number to create the client", () => {
    expect(dialog).toContain("normalizePhoneToE164(phone)");
    expect(dialog).toContain('toast.error("Enter a valid mobile number")');
    expect(dialog).toContain("phone: cleanPhone,");
  });

  it("emails first (it creates the login), then texts, and copies the texted link", () => {
    expect(dialog.indexOf("await inviteFn(")).toBeLessThan(dialog.indexOf("await textFn("));
    expect(dialog).toMatch(/url = \(await textFn\(/);
    // Only mint a fresh link when nothing was texted, so copying never cancels the text.
    expect(dialog).toMatch(/if \(!url\) \{\s*try \{ url = \(await linkFn\(/);
  });

  it("keeps a client in Needs Setup until they actually sign in", () => {
    for (const file of ["src/lib/clients.functions.ts", "src/lib/sms-links.functions.ts"]) {
      const src = read(file);
      expect(src, file).not.toContain('client.user_id ? "Account Created" : "Invite Sent"');
      expect(src, file).toContain('if (!client.last_signed_in_at) patch.account_status = "Invite Sent";');
    }
  });

  it("never texts a sign-in link for a staff account", () => {
    const sms = read("src/lib/sms-links.functions.ts");
    const fn = sms.slice(sms.indexOf("export const sendAuthLinkBySms"), sms.indexOf("const url = await generateAuthLink("));
    expect(fn).toContain("await assertNotPrivilegedTarget(");
  });
});

describe("members onboard the same way as coaching clients", () => {
  const page = read("src/routes/_authenticated/admin/members.new.tsx");
  const server = read("src/lib/members.functions.ts");
  const create = server.slice(server.indexOf("export const createAppMember"), server.indexOf("const UpdateMemberInput"));

  it("needs a real mobile number and shows the same setup step", () => {
    expect(page).toContain("normalizePhoneToE164(phone)");
    expect(page).toContain("phone: cleanPhone,");
    expect(page).toContain("<SetupSentPanel");
    expect(page).toContain("continueStep={false}");
    expect(read("src/components/clients/add-client-dialog.tsx")).toContain("<SetupSentPanel");
  });

  it("stores the phone, then emails and texts the setup link and reports both", () => {
    expect(create).toContain("        phone,\n");
    expect(create).toContain("sendSetupReminderEmail(");
    expect(create).toContain("{ force: true, setupUrl }");
    expect(create).toContain('trigger: "account_created"');
    expect(create).toContain("vars: { setup_link: setupUrl }");
    expect(create).toContain("return { member: row, setupUrl, emailed, texted };");
  });
});
