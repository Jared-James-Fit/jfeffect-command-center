import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_CONTENT,
  AGREEMENT_CONTENT_JSON,
  AGREEMENT_VERSION,
  COACH,
  PUBLISHED_CONTENT_HASHES,
  RESIGN_REQUIRED_BELOW_VERSION,
  compareVersions,
  parseInline,
  resolveRefs,
  sectionNumber,
} from "@/lib/coaching-agreement/content";
import { personalizeAgreement } from "@/lib/coaching-agreement/coach";
import { sha256HexAsync } from "@/lib/coaching-agreement/hash";
import { resolveAgreementState } from "@/lib/coaching-agreement/rules";

const allText = () =>
  [
    ...AGREEMENT_CONTENT.intro.map((c) => c.text),
    ...AGREEMENT_CONTENT.keyTerms.map((k) => `${k.title} ${k.text}`),
    ...AGREEMENT_CONTENT.sections.flatMap((s) =>
      s.clauses.map((c) => `${c.label ?? ""} ${c.text}`),
    ),
    ...AGREEMENT_CONTENT.acknowledgements.map((a) => a.text),
  ].join("\n");

describe("agreement content integrity", () => {
  it("has unique, sequential sections", () => {
    const ids = AGREEMENT_CONTENT.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    AGREEMENT_CONTENT.sections.forEach((s, i) => expect(s.number).toBe(i + 1));
  });

  it("resolves every cross-reference and leaves no tokens behind", () => {
    // The only token left in the published text is the coach's name, filled in per client.
    expect(AGREEMENT_CONTENT_JSON.replaceAll("{{coach}}", "")).not.toContain("{{");
    expect(JSON.stringify(personalizeAgreement(AGREEMENT_CONTENT, "Jared McIntyre"))).not.toContain("{{");
    expect(() => resolveRefs("see {{n:does-not-exist}}")).toThrow(/Unknown agreement section/);
    expect(resolveRefs("Section {{n:refunds}}")).toBe(`Section ${sectionNumber("refunds")}`);
  });

  it("cross-references point at the sections they claim to", () => {
    const risk = AGREEMENT_CONTENT.acknowledgements.find((a) => a.id === "risk")!;
    expect(risk.text).toContain(
      `Sections ${sectionNumber("risk")} and ${sectionNumber("release")}`,
    );
    const refunds = AGREEMENT_CONTENT.sections.find((s) => s.id === "refunds")!;
    expect(refunds.clauses[0].text).toContain(`Section ${sectionNumber("conduct")}`);
  });

  it("has balanced bold markers in every clause", () => {
    for (const section of AGREEMENT_CONTENT.sections) {
      for (const clause of section.clauses) {
        expect((clause.text.match(/\*\*/g) ?? []).length % 2).toBe(0);
      }
    }
  });

  it("requires every acknowledgement to be answerable (non-empty, unique ids)", () => {
    const ids = AGREEMENT_CONTENT.acknowledgements.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AGREEMENT_CONTENT.acknowledgements) {
      expect(a.text.length).toBeGreaterThan(40);
      expect(a.short.length).toBeGreaterThan(5);
    }
  });

  it("keeps the optional media permissions aligned with the existing consent keys", () => {
    expect(AGREEMENT_CONTENT.optionalConsents.map((c) => c.key).sort()).toEqual([
      "social_publication",
      "testimonial_use",
    ]);
  });
});

describe("the owner's commercial terms are preserved", () => {
  const text = allText();
  it.each([
    ["no-refund policy", /All sales are final\. \*\*No refunds\.\*\*/],
    ["$25 late / failed payment fee", /\$25/],
    ["50% buyout of the remaining unpaid balance", /50% of the remaining unpaid balance/],
    ["7 day buyout payment window", /\*\*7 days\*\*/],
    ["30 day maximum freeze", /\*\*30 days\*\*/],
    ["6 month in-person session expiry", /\*\*6 months\*\*/],
    ["24 hours' notice to reschedule", /\*\*24 hours.{1,3}notice\*\*/],
    ["12 month limit on claims", /\*\*12 months\*\*/],
    [
      "cancelling in the app or by email, never by DM",
      /cancel a monthly plan yourself in the app \(Account → Your plan\), or by written notice by email[\s\S]*Social media messages and Instagram DMs do not count as notice/,
    ],
    [
      "early termination keeps the balance owed",
      /no refunds and the remaining balance is still owed/,
    ],
    [
      "chargebacks end services",
      /file a chargeback or dispute for any reason, the Coach may end your Services immediately/,
    ],
    ["installments are not cancel-anytime", /do not create a cancel-anytime agreement/],
    [
      "one signature covers every future purchase",
      /every purchase you make now or later is automatically covered/,
    ],
    ["release includes negligence", /claims related to negligence/],
    ["Manitoba governing law", /laws of the Province of Manitoba/],
  ])("keeps %s", (_name, pattern) => {
    expect(text).toMatch(pattern);
  });

  it("names the coach, location and official email", () => {
    expect(COACH.email).toBe("coaching@jfeffect.com");
    expect(COACH.location).toContain("Winnipeg");
    expect(text).toContain("coaching@jfeffect.com");
    // 2.4: notices go to the business inbox, never a personal Gmail.
    expect(text).not.toMatch(/@gmail\.com/i);
    expect(text).toContain("Winnipeg");
  });

  it("covers clients outside Manitoba and Canada", () => {
    const international = AGREEMENT_CONTENT.sections.find((s) => s.id === "international")!;
    const joined = international.clauses.map((c) => c.text).join(" ");
    expect(joined).toMatch(/Canadian dollars/);
    expect(joined).toMatch(/cannot lawfully be waived/);
    expect(joined).toMatch(/local emergency number/);
  });

  it("lets a client who is ended without fault recover unused prepaid time", () => {
    const conduct = AGREEMENT_CONTENT.sections.find((s) => s.id === "conduct")!;
    expect(conduct.clauses.map((c) => c.text).join(" ")).toMatch(/pro-rated basis/);
  });

  it("makes public use of client content opt-in", () => {
    const content = AGREEMENT_CONTENT.sections.find((s) => s.id === "content")!;
    expect(content.clauses.map((c) => c.text).join(" ")).toMatch(/only if you give permission/);
    expect(text).not.toMatch(/no expectation of privacy/i);
  });
});

describe("2.3: messages are kept as coaching records", () => {
  it("says edited and deleted messages are kept, admin-only, and why", () => {
    const joined = AGREEMENT_CONTENT.sections.flatMap((s) => s.clauses.map((c) => c.text)).join(" ");
    expect(joined).toMatch(/if you edit or delete a message, it changes in the chat for both of you, but the Coach keeps the original, which only JF Effect’s administrators can see/);
    expect(joined).toMatch(/payment, tax, agreement and message records/);
  });
  it("keeps 2.3 exactly as signed in the archive", () => {
    expect(createHash("sha256").update(readFileSync("supabase/agreement-archive/2.3.json", "utf8")).digest("hex")).toBe(PUBLISHED_CONTENT_HASHES["2.3"]);
  });
  it("keeps 2.2 exactly as signed in the archive", () => {
    expect(createHash("sha256").update(readFileSync("supabase/agreement-archive/2.2.json", "utf8")).digest("hex")).toBe(PUBLISHED_CONTENT_HASHES["2.2"]);
  });
});

describe("3.0: plans in the app", () => {
  const billing = () => AGREEMENT_CONTENT.sections.find((s) => s.id === "billing")!.clauses.map((c) => c.text).join(" ");
  it("says how upgrades, downgrades and cancellations work, and that coaching is by approval", () => {
    expect(billing()).toMatch(/Moving to a plan that costs more takes effect right away: you’re charged the difference for the rest of your current billing period \(prorated\)/);
    expect(billing()).toMatch(/Moving to a plan that costs less, or to the free app, takes effect at the end of the billing period you’ve already paid for/);
    expect(billing()).toMatch(/A coaching package can be purchased only after the Coach approves it/);
    expect(billing()).toMatch(/The Coach will not raise it or move you to another plan without your consent/);
    expect(billing()).toMatch(/Plan changes are made in the app, not in Stripe’s billing page/);
  });
  it("keeps fixed terms owed in full even when billing is cancelled in the app", () => {
    expect(billing()).toMatch(/cancelling billing does not end your payment obligations/);
  });
  it("keeps 2.4 exactly as signed in the archive", () => {
    expect(createHash("sha256").update(readFileSync("supabase/agreement-archive/2.4.json", "utf8")).digest("hex")).toBe(PUBLISHED_CONTENT_HASHES["2.4"]);
  });
});

describe("published wording can never change silently", () => {
  it("matches the recorded fingerprint for the current version", () => {
    const fingerprint = createHash("sha256").update(AGREEMENT_CONTENT_JSON).digest("hex");
    expect(
      PUBLISHED_CONTENT_HASHES[AGREEMENT_VERSION],
      `The agreement wording changed. If this is intentional, bump AGREEMENT_VERSION (and RESIGN_REQUIRED_BELOW_VERSION if clients must re-sign) and record ${fingerprint} for the new version in PUBLISHED_CONTENT_HASHES.`,
    ).toBe(fingerprint);
  });

  it("never lets the re-sign threshold run ahead of the published version", () => {
    expect(compareVersions(RESIGN_REQUIRED_BELOW_VERSION, AGREEMENT_VERSION)).toBeLessThanOrEqual(
      0,
    );
  });

  it("hashes identically in the browser (WebCrypto) and on the server (node:crypto)", async () => {
    const server = createHash("sha256").update(AGREEMENT_CONTENT_JSON).digest("hex");
    expect(await sha256HexAsync(AGREEMENT_CONTENT_JSON)).toBe(server);
  });
});

describe("helpers", () => {
  it("parses bold markup and tolerates unbalanced markers", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
    expect(parseInline("broken **bold")).toEqual([{ text: "broken bold", bold: false }]);
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("2.0", "2.0")).toBe(0);
    expect(compareVersions("2.1", "2.0")).toBe(1);
    expect(compareVersions("2.0", "10.0")).toBe(-1);
    expect(compareVersions("2", "2.0.0")).toBe(0);
  });
});

describe("naming the Coach (version 2.1)", () => {
  const json = JSON.stringify(AGREEMENT_CONTENT);
  const text = allText();

  it("names the individual who carries on the business, not the old trade name", () => {
    expect(json).not.toMatch(/jared james fit/i);
    // From 2.4 notices go to coaching@jfeffect.com, so no "jaredjamesfit" is left at all.
    expect(json).not.toMatch(/jaredjamesfit/i);
    expect(text).toContain(
      "Jared McIntyre (also known as Jared James McIntyre), an individual carrying on business as JF Effect in Winnipeg, Manitoba, Canada",
    );
    expect(COACH.operator).toBe("Jared McIntyre");
    expect(COACH.business).toBe("JF Effect");
  });

  it("still releases and indemnifies the Coach personally, not just the business", () => {
    expect(text).toContain("the Coach (including Jared McIntyre personally)");
  });
});

describe("people who signed an earlier version are left exactly as they are", () => {
  const sig = (version: string) => ({
    id: "s", version, signedAt: "2026-10-03T12:00:00Z", typedName: "A Client", method: "typed" as const, hasGuardian: false,
  });
  const state = (version: string) =>
    resolveAgreementState({ latestSignature: sig(version), exempt: null, resignRequestedAt: null, resignNote: null }).state;

  it("does not ask anyone who signed 2.0 to sign again", () => {
    expect(AGREEMENT_VERSION).toBe("3.2");
    expect(RESIGN_REQUIRED_BELOW_VERSION).toBe("2.0");
    expect(state("2.0")).toBe("signed");
    expect(state("2.1")).toBe("signed");
    expect(state("2.2")).toBe("signed");
    expect(state("2.3")).toBe("signed");
    expect(state("2.4")).toBe("signed");
    expect(state("3.0")).toBe("signed");
    expect(state("3.1")).toBe("signed");
    expect(state("1.0")).toBe("needs_signature");
  });

  it("keeps the exact text of every earlier version, matching what was published", () => {
    const earlier = Object.keys(PUBLISHED_CONTENT_HASHES).filter((v) => v !== AGREEMENT_VERSION);
    expect(earlier).toContain("2.0");
    for (const version of earlier) {
      const file = `supabase/agreement-archive/${version}.json`;
      expect(existsSync(file), `${file} is missing: archive the exact text before revising it`).toBe(true);
      const archived = readFileSync(file, "utf8");
      expect(createHash("sha256").update(archived).digest("hex"), version).toBe(PUBLISHED_CONTENT_HASHES[version]);
      // It parses as the agreement people signed.
      expect(JSON.parse(archived).version).toBe(version);
    }
  });

  it("archived 2.0 is the wording people signed, old name and all", () => {
    const v20 = readFileSync("supabase/agreement-archive/2.0.json", "utf8");
    expect(v20).toContain("operated by Jared James McIntyre");
    expect(v20).toContain("Jared James McIntyre personally");
  });
});
