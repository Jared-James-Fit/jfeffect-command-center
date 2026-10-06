import { createHash } from "node:crypto";
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
import { sha256HexAsync } from "@/lib/coaching-agreement/hash";

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
    expect(AGREEMENT_CONTENT_JSON).not.toContain("{{");
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
      "email-only written cancellation",
      /Social media messages and Instagram DMs do not count as written notice/,
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
    expect(COACH.email).toBe("jaredjamesfit@gmail.com");
    expect(COACH.location).toContain("Winnipeg");
    expect(text).toContain("jaredjamesfit@gmail.com");
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
