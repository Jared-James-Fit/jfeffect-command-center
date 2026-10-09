import { describe, expect, it } from "vitest";
import { extractLinks, isSafeInternalHref, speechFromReply, tokenizeInline } from "@/lib/summer-voice-text";
import { speechChunks } from "@/lib/summer-speaker";
import { buildAppContext, clientLabel, EMPTY_APP_SNAPSHOT, type AppSnapshot } from "@/lib/summer-app";
import { summerSystemPrompt } from "@/lib/summer-context";
import { audioFormat } from "@/lib/summer.server";

describe("Cleo's links", () => {
  it("only allows in-app admin paths or https", () => {
    expect(isSafeInternalHref("/admin/clients/7f0c2a52-3c2e-4f0e-9a51-1d2b3c4d5e6f?tab=purchases")).toBe(true);
    expect(isSafeInternalHref("/admin/communication?tab=messages&client=abc")).toBe(true);
    expect(isSafeInternalHref("/portal/home")).toBe(false);
    expect(isSafeInternalHref("//evil.com/admin")).toBe(false);
    expect(isSafeInternalHref("/admin/../portal")).toBe(false);
    expect(isSafeInternalHref("javascript:alert(1)")).toBe(false);
  });

  it("turns markdown links into link tokens and drops unsafe ones to text", () => {
    const t = tokenizeInline("Open **Marc** [here](/admin/clients/abc) or [bad](javascript:alert) or [site](https://jfeffect.com)");
    expect(t).toEqual([
      { type: "text", text: "Open " },
      { type: "bold", text: "Marc" },
      { type: "text", text: " " },
      { type: "link", label: "here", href: "/admin/clients/abc", internal: true },
      { type: "text", text: " or " },
      { type: "text", text: "bad" },
      { type: "text", text: " or " },
      { type: "link", label: "site", href: "https://jfeffect.com", internal: false },
    ]);
  });

  it("collects each link once, in order", () => {
    const links = extractLinks("[A](/admin/a)\n- [B](/admin/b) and [A again](/admin/a)");
    expect(links.map((l) => l.href)).toEqual(["/admin/a", "/admin/b"]);
  });
});

describe("speechFromReply", () => {
  it("reads like a person: no markdown, tables, emojis or URLs", () => {
    const reply = [
      "**About $1,104** to set aside 💅✨",
      "- GST owing: $445.22",
      "| Item | Amount |",
      "|---|---|",
      "| GST | $445.22 |",
      "[Open Taxes & Books](/admin/sales?tab=taxes)",
    ].join("\n");
    const said = speechFromReply(reply);
    expect(said).toBe("About $1,104 to set aside. GST owing: $445.22. Open Taxes & Books.");
  });

  it("stops at a sentence boundary when long", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const said = speechFromReply(long, 120);
    expect(said.length).toBeLessThanOrEqual(120);
    expect(said.endsWith(".")).toBe(true);
  });
});

describe("speechChunks", () => {
  it("joins short sentences so the device voice doesn't pause after each one", () => {
    expect(speechChunks("You owe $445. It's due April 30. Want the breakdown?")).toEqual([
      "You owe $445. It's due April 30. Want the breakdown?",
    ]);
  });

  it("splits at sentence boundaries when a chunk would get too long", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is right here.`).join(" ");
    const chunks = speechChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100 && c.endsWith("."))).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });
});

describe("Cleo's app context", () => {
  const snap: AppSnapshot = {
    ...EMPTY_APP_SNAPSHOT,
    clients: [
      { id: "11111111-1111-1111-1111-111111111111", name: "Marc Asugui", email: "marc@example.com", phone: "204-555-0101", status: "Active", plan: "Personal Training", startDate: "2026-08-20", renewalDate: null, paymentStatus: "Paid", lastActiveAt: "2026-10-07T15:00:00Z", needsHelp: true, compliance: "Behind", archived: false, instagram: null },
      { id: "22222222-2222-2222-2222-222222222222", name: "Old Client", email: null, phone: null, status: "Archived", plan: null, startDate: null, renewalDate: null, paymentStatus: null, lastActiveAt: null, needsHelp: false, compliance: "On Track", archived: true, instagram: null },
    ],
    appointments: [{ startsAt: "2026-10-09T15:00:00Z", endsAt: null, title: "PT session", type: "pt", who: null, clientId: "11111111-1111-1111-1111-111111111111", location: "Gym", meetLink: null, status: "scheduled" }],
    unread: [{ clientId: "11111111-1111-1111-1111-111111111111", count: 2, lastAt: "2026-10-08T12:00:00Z" }],
    alerts: { open: 1, latest: [{ type: "scheduled_jobs_failing", message: "3 of 10 failed", at: "2026-10-08T12:00:00Z" }] },
  };

  it("lists clients with ids, flags, calendar, unread and links", () => {
    const ctx = buildAppContext(snap, [{ label: "Calendar", to: "/admin/calendar" }, { label: "Tasks", to: "/admin/tasks" }], { tz: "America/Winnipeg", route: "/admin/clients/11111111-1111-1111-1111-111111111111?tab=summary" });
    expect(ctx).toContain("client profile of Marc Asugui");
    expect(ctx).toContain("Marc Asugui | 11111111-1111-1111-1111-111111111111 | Active");
    expect(ctx).toContain("needs admin help");
    expect(ctx).toContain("compliance: Behind");
    expect(ctx).not.toContain("compliance: On Track");
    expect(ctx).toContain("CLIENTS (1 current, 1 archived)");
    expect(ctx).toContain("PT session | Marc Asugui");
    expect(ctx).toContain("2 unread");
    expect(ctx).toContain("/admin/communication?tab=messages&client=<client id>");
    expect(ctx).toContain("- Tasks: /admin/tasks");
    // registry entries that duplicate the built-ins are listed once
    expect(ctx.match(/- Calendar: \/admin\/calendar/g)?.length).toBe(1);
  });

  it("names clients sensibly", () => {
    expect(clientLabel({ full_name: " Vicky T " })).toBe("Vicky T");
    expect(clientLabel({ first_name: "Reece", last_name: "R" })).toBe("Reece R");
    expect(clientLabel({ email: "x@y.com" })).toBe("x@y.com");
  });
});

describe("Cleo's prompt", () => {
  it("knows she can link and look things up, and never invents ids", () => {
    const p = summerSystemPrompt();
    expect(p).toMatch(/rest of the app/);
    expect(p).toMatch(/Never invent an id or a path/);
    expect(p).not.toMatch(/VOICE:/);
  });

  it("switches to short spoken answers in voice mode", () => {
    expect(summerSystemPrompt({ voice: true })).toMatch(/VOICE: .*1 to 3 short/);
  });
});

describe("Cleo for a team admin", () => {
  it("keeps the owner's books private and says whose they are", () => {
    const p = summerSystemPrompt({ owner: false, userName: "Fionna", ownerName: "Jared" });
    expect(p).toContain("You are talking with Fionna, an admin on Jared's team (not the owner)");
    expect(p).toMatch(/PRIVATE: .*private to Jared/);
    expect(p).not.toMatch(/the business owner\. You know their books/);
  });

  it("greets the owner by name", () => {
    expect(summerSystemPrompt({ owner: true, userName: "Jared" })).toContain("You are talking with Jared, the business owner");
  });

  it("lists unpaid sales for the team", async () => {
    const { buildOpenSalesContext } = await import("@/lib/summer-app");
    expect(buildOpenSalesContext([{ client: "Reece", offer: "Hybrid", status: "Unpaid", outstandingMinor: 40000, createdOn: "2026-10-01" }])).toBe(
      "- Reece | Hybrid | Unpaid | outstanding $400.00 | since 2026-10-01",
    );
    expect(buildOpenSalesContext([])).toBe("- none");
  });
});

describe("Owner-only menu items", () => {
  it("drops Taxes & Books from nested nav for other admins", async () => {
    const { withoutOwnerOnly } = await import("@/lib/business-owner");
    const nav = [
      { to: "/admin/transactions", label: "Transactions" },
      { to: "/admin/sales?tab=taxes", label: "Taxes & Books" },
      { to: "/admin/payments", label: "Payments", children: [{ to: "/admin/sales?tab=taxes", label: "Taxes" }, { to: "/admin/payment-links", label: "Products" }] },
    ];
    expect(withoutOwnerOnly(nav as any)).toEqual([
      { to: "/admin/transactions", label: "Transactions" },
      { to: "/admin/payments", label: "Payments", children: [{ to: "/admin/payment-links", label: "Products" }] },
    ]);
  });
});

describe("audioFormat", () => {
  it("maps recorder types to what the transcriber expects", () => {
    expect(audioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(audioFormat("audio/mp4")).toBe("mp4");
    expect(audioFormat("audio/aac")).toBe("mp4");
    expect(audioFormat("audio/wav")).toBe("wav");
  });
});
