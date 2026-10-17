import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_CONTENT,
  AGREEMENT_CONTENT_JSON,
  type AgreementContent,
} from "@/lib/coaching-agreement/content";
import {
  COACH_TOKEN,
  GENERIC_COACH_NAME,
  isOwnerCoach,
  legalNameOfCoach,
  personalizeAgreement,
  resolveAgreementCoach,
} from "@/lib/coaching-agreement/coach";

/**
 * Version 2.2 names each client's coach. The published text keeps a {{coach}} token (one text, one
 * hash, for everyone); the name is filled in when it is shown and saved with the signature.
 */
const read = (path: string) => readFileSync(path, "utf8");
const owner = {
  id: "c-owner",
  user_id: "u-owner",
  full_name: "Jared James Fit",
  email: "jaredjamesfit@gmail.com",
};
const staff = {
  id: "c-2",
  user_id: "u-2",
  first_name: "Sam",
  last_name: "Lee",
  full_name: "Coach Sam",
  email: "sam@example.com",
};

describe("the name a coach goes by in the agreement", () => {
  it("always names the owner as Jared McIntyre, whatever his coach profile is called", () => {
    expect(isOwnerCoach(owner)).toBe(true);
    expect(legalNameOfCoach(owner)).toBe("Jared McIntyre");
    expect(legalNameOfCoach({ ...owner, email: " JaredJamesFit@Gmail.com " })).toBe(
      "Jared McIntyre",
    );
    expect(
      legalNameOfCoach({
        id: "x",
        first_name: "Jared",
        last_name: "James",
        email: "jaredjamesfit@gmail.com",
      }),
    ).toBe("Jared McIntyre");
  });

  it("uses first and last name for anyone else, then the full name", () => {
    expect(legalNameOfCoach(staff)).toBe("Sam Lee");
    expect(legalNameOfCoach({ id: "x", full_name: "  Alex   Rivera " })).toBe("Alex Rivera");
    expect(legalNameOfCoach({ id: "x", first_name: "Alex", full_name: "" })).toBeNull();
  });
});

describe("which coach the agreement names", () => {
  it("names the client's assigned coach first", () => {
    expect(resolveAgreementCoach({ assigned: staff, sender: owner })).toMatchObject({
      name: "Sam Lee",
      source: "assigned",
      coachId: "c-2",
    });
  });

  it("falls back to the coach who sent it, then to the owner", () => {
    expect(resolveAgreementCoach({ assigned: null, sender: staff })).toMatchObject({
      name: "Sam Lee",
      source: "sender",
    });
    expect(resolveAgreementCoach({})).toMatchObject({
      name: "Jared McIntyre",
      source: "owner",
      coachId: null,
    });
  });

  it("skips an archived or nameless coach profile", () => {
    expect(resolveAgreementCoach({ assigned: { ...staff, archived: true } }).source).toBe("owner");
    expect(
      resolveAgreementCoach({ assigned: { ...staff, status: "Inactive" }, sender: owner }),
    ).toMatchObject({ source: "sender", name: "Jared McIntyre" });
    expect(resolveAgreementCoach({ assigned: { id: "x" } }).source).toBe("owner");
  });
});

describe("filling the coach into the text", () => {
  it("keeps the token in the published text, so every client signs the same words", () => {
    expect(AGREEMENT_CONTENT_JSON).toContain(COACH_TOKEN);
    const parties = AGREEMENT_CONTENT.sections.find((s) => s.id === "parties")!;
    expect(parties.clauses.find((c) => c.label === "Your coach.")!.text).toContain("**{{coach}}**");
    expect(AGREEMENT_CONTENT.intro[1].text).toContain(
      "The coach working with you is **{{coach}}**",
    );
  });

  it("fills in every place the coach appears", () => {
    const out = personalizeAgreement(AGREEMENT_CONTENT, "Sam Lee");
    const json = JSON.stringify(out);
    expect(json).not.toContain(COACH_TOKEN);
    expect(json).toContain("The coach working with you is **Sam Lee**");
    expect(out.keyTerms.find((k) => k.title === "Your coach")!.text).toContain("Sam Lee");
    // Only the per-client parts change; the rest is untouched.
    expect(out.version).toBe(AGREEMENT_CONTENT.version);
    expect(out.sections.map((s) => s.id)).toEqual(AGREEMENT_CONTENT.sections.map((s) => s.id));
  });

  it("reads naturally when no coach is known (the public page, a missing record)", () => {
    const out = JSON.stringify(personalizeAgreement(AGREEMENT_CONTENT, null));
    expect(out).toContain(`The coach working with you is **${GENERIC_COACH_NAME}**`);
    expect(JSON.stringify(personalizeAgreement(AGREEMENT_CONTENT, "   "))).toContain(
      GENERIC_COACH_NAME,
    );
  });

  it("leaves the signed 2.0 and 2.1 texts exactly as they were", () => {
    for (const v of ["2.0", "2.1"]) {
      const stored = read(`supabase/agreement-archive/${v}.json`);
      const content = JSON.parse(stored) as AgreementContent;
      expect(JSON.stringify(personalizeAgreement(content, "Sam Lee"))).toBe(stored);
    }
  });
});

describe("2.2 wording for the app and in-person training", () => {
  const all = JSON.stringify(AGREEMENT_CONTENT);
  const section = (id: string) => AGREEMENT_CONTENT.sections.find((s) => s.id === id)!;
  const text = (id: string) =>
    section(id)
      .clauses.map((c) => `${c.label ?? ""} ${c.text}`)
      .join("\n");

  it("still never uses the old trade name", () => {
    expect(all).not.toMatch(/Jared James Fit/i);
  });

  it("keeps Jared McIntyre as the only party, and covers the coach who works with you", () => {
    expect(text("parties")).toContain(
      "Only Jared McIntyre, carrying on business as JF Effect, is a party to this Agreement",
    );
    expect(text("parties")).toContain("you do not need to sign it again when your coach changes");
    expect(text("release")).toContain(
      "(including Jared McIntyre personally), your coach and every other coach, trainer, employee",
    );
    expect(text("release")).toContain("hands-on cues and spotting");
  });

  it("sets the in-person session rules", () => {
    const t = text("in-person");
    expect(t).toContain("**24 hours’ notice**");
    expect(t).toContain("**6 months** after purchase");
    expect(t).toContain("**15 minutes** late");
    expect(t).toContain("You can ask for no touch at any time");
    expect(t).toContain("Medical emergencies.");
    // A package's own terms win for its details.
    expect(text("records")).toContain("a session package lists its own number of sessions");
  });

  it("says plainly what the app shares and what the Community shows other clients", () => {
    const t = text("app");
    expect(t).toContain("“Share my workouts”");
    expect(t).toContain("first name and last initial, photo, points, workouts and records");
    expect(t).toContain("Apple Health, Health Connect");
    expect(text("privacy")).toContain("AI tools");
    expect(text("privacy")).toContain(`Section ${section("app").number}`);
  });

  it("asks for one tick that covers the session and app rules", () => {
    const ack = AGREEMENT_CONTENT.acknowledgements.find((a) => a.id === "sessions-app")!;
    expect(ack.text).toContain(
      `Sections ${section("in-person").number} and ${section("app").number}`,
    );
  });
});

describe("the coach is server-checked and saved with the signature", () => {
  const server = read("src/lib/coaching-agreement.functions.ts");
  const flow = read("src/components/coaching-agreement/agreement-sign-flow.tsx");
  const viewer = read("src/components/coaching-agreement/agreement-record-viewer.tsx");

  it("refuses a signature if the coach changed while the client was reading", () => {
    expect(server).toContain("if (data.coachName.trim() !== coach.name) {");
    expect(server).toContain('"coach_changed: ');
  });

  it("saves the name that filled the text, with who sent it", () => {
    expect(server).toMatch(/coach: \{\s+name: coach\.name,\s+source: coach\.source,/);
    expect(server).toContain("sent_by: sentBy ?");
    expect(server).toContain("personalized.acknowledgements.map");
  });

  it("shows the client the text with their coach, and sends back the name they saw", () => {
    expect(flow).toContain("personalizeAgreement(AGREEMENT_CONTENT, coachName)");
    expect(flow).toContain("coachName: ctx.coach.name,");
    // The stale-version fingerprint is still the published text's.
    expect(flow).toContain("sha256HexAsync(AGREEMENT_CONTENT_JSON)");
  });

  it("rebuilds the signed copy from the saved name", () => {
    expect(viewer).toContain("personalizeAgreement(stored, data.details?.coach?.name ?? null)");
  });

  it("lets the assigned coach send it to their own clients, but only an admin override an exemption", () => {
    const request = server.slice(
      server.indexOf("export const adminRequestAgreement"),
      server.indexOf("export const adminCancelAgreementRequest"),
    );
    expect(request).toContain("assertStaffForClient(supabase, userId, data.clientId)");
    expect(request).toContain("only an admin can override an exemption");
    expect(request).not.toContain("await assertAdmin(");
  });
});
