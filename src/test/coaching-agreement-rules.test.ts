import { describe, expect, it } from "vitest";
import {
  POPUP_RESUME_AFTER_MS,
  ageOnDate,
  compareRosterStatus,
  isMinor,
  isPopupDismissed,
  namesMatch,
  normalizeName,
  resolveAgreementState,
  rosterStatusOf,
  type SignatureSummary,
} from "@/lib/coaching-agreement/rules";
import { buildRoster, summarizeRoster } from "@/lib/coaching-agreement/roster";

const sig = (over: Partial<SignatureSummary> = {}): SignatureSummary => ({
  id: "s1",
  version: "2.0",
  signedAt: "2026-10-06T15:00:00.000Z",
  typedName: "Jane Doe",
  method: "drawn",
  hasGuardian: false,
  ...over,
});

const base = { latestSignature: null, exempt: null, resignRequestedAt: null, resignNote: null };

describe("resolveAgreementState", () => {
  it("asks a client who has never signed", () => {
    const s = resolveAgreementState(base);
    expect(s).toMatchObject({ state: "needs_signature", reason: "never_signed", previous: null });
  });

  it("treats a current signature as signed", () => {
    expect(resolveAgreementState({ ...base, latestSignature: sig() }).state).toBe("signed");
  });

  it("asks again when the signed version is below the re-sign threshold", () => {
    const s = resolveAgreementState({ ...base, latestSignature: sig({ version: "1.0" }) });
    expect(s).toMatchObject({ state: "needs_signature", reason: "new_version" });
  });

  it("asks again when an admin sent another one after the last signature", () => {
    const s = resolveAgreementState({
      ...base,
      latestSignature: sig({ signedAt: "2026-10-06T15:00:00.000Z" }),
      resignRequestedAt: "2026-10-07T09:00:00.000Z",
      resignNote: "Added in-person training",
    });
    expect(s).toMatchObject({
      state: "needs_signature",
      reason: "admin_request",
      requestNote: "Added in-person training",
    });
  });

  it("is satisfied once the client signs after the request", () => {
    const s = resolveAgreementState({
      ...base,
      latestSignature: sig({ signedAt: "2026-10-08T10:00:00.000Z" }),
      resignRequestedAt: "2026-10-07T09:00:00.000Z",
    });
    expect(s.state).toBe("signed");
  });

  it("lets an admin exemption win over everything else", () => {
    const s = resolveAgreementState({
      ...base,
      exempt: { kind: "offline_signed", note: "Paper copy at gym", setAt: "2026-10-06T00:00:00Z" },
      resignRequestedAt: "2026-10-07T09:00:00.000Z",
    });
    expect(s).toMatchObject({ state: "exempt", kind: "offline_signed" });
  });
});

describe("minors", () => {
  const on = new Date("2026-10-06T12:00:00Z");
  it("computes age on the day of the birthday, not before", () => {
    expect(ageOnDate("2008-10-06", on)).toBe(18);
    expect(ageOnDate("2008-10-07", on)).toBe(17);
    expect(ageOnDate("2008-10-05", on)).toBe(18);
  });
  it("handles leap-day birthdays", () => {
    expect(ageOnDate("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe(17);
    expect(ageOnDate("2008-02-29", new Date("2026-03-01T12:00:00Z"))).toBe(18);
  });
  it("flags under 18 only", () => {
    expect(isMinor("2010-01-01", on)).toBe(true);
    expect(isMinor("2008-10-06", on)).toBe(false);
    expect(isMinor("1990-05-05", on)).toBe(false);
  });
  it("does not treat a missing or malformed date of birth as a minor", () => {
    expect(isMinor(null, on)).toBe(false);
    expect(isMinor("not-a-date", on)).toBe(false);
    expect(isMinor("2026-02-31", on)).toBe(false);
    expect(ageOnDate("2026-13-01", on)).toBeNull();
  });
});

describe("name matching", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(normalizeName("  José   O'Brien-Smith ")).toBe("jose obrien smith");
    expect(namesMatch("Jose OBrien", "josé  o'brien")).toBe(true);
    expect(namesMatch("Jane Doe", "Jane Roe")).toBe(false);
    expect(namesMatch("", "")).toBe(false);
  });
});

describe("launch popup dismissal", () => {
  const t0 = 1_000_000;
  it("shows when never dismissed", () => {
    expect(isPopupDismissed({ dismissedAt: null, hiddenSince: null, now: t0 })).toBe(false);
  });
  it("stays dismissed for the rest of the session", () => {
    expect(isPopupDismissed({ dismissedAt: t0, hiddenSince: null, now: t0 + 60 * 60_000 })).toBe(
      true,
    );
  });
  it("stays dismissed after a short trip to another app", () => {
    expect(
      isPopupDismissed({ dismissedAt: t0, hiddenSince: t0 + 1000, now: t0 + 1000 + 60_000 }),
    ).toBe(true);
  });
  it("comes back after the app sat in the background (counts as reopening)", () => {
    expect(
      isPopupDismissed({
        dismissedAt: t0,
        hiddenSince: t0 + 1000,
        now: t0 + 1000 + POPUP_RESUME_AFTER_MS,
      }),
    ).toBe(false);
  });
});

describe("admin roster", () => {
  const clients = [
    {
      id: "c1",
      full_name: "Zed Signed",
      email: "z@x.com",
      user_id: "u1",
      assigned_coach_id: null,
      agreement_signed: true,
      agreement_signed_date: "2026-10-06",
      agreement_version: "v2.0",
      last_signed_in_at: null,
    },
    {
      id: "c2",
      full_name: "Amy Never",
      email: "a@x.com",
      user_id: "u2",
      assigned_coach_id: null,
      agreement_signed: false,
      agreement_signed_date: null,
      agreement_version: null,
      last_signed_in_at: null,
    },
    {
      id: "c3",
      full_name: "Bob Legacy",
      email: "b@x.com",
      user_id: "u3",
      assigned_coach_id: null,
      agreement_signed: true,
      agreement_signed_date: "2025-01-01",
      agreement_version: "v3 - 2026",
      last_signed_in_at: null,
    },
    {
      id: "c4",
      full_name: "Cat Paper",
      email: "c@x.com",
      user_id: "u4",
      assigned_coach_id: null,
      agreement_signed: false,
      agreement_signed_date: null,
      agreement_version: null,
      last_signed_in_at: null,
    },
    {
      id: "c5",
      full_name: "Dan Requested",
      email: "d@x.com",
      user_id: "u5",
      assigned_coach_id: null,
      agreement_signed: true,
      agreement_signed_date: "2026-10-01",
      agreement_version: "v2.0",
      last_signed_in_at: null,
    },
  ];
  const signatures = [
    {
      id: "sA",
      client_id: "c1",
      signed_at: "2026-10-06T15:00:00Z",
      typed_name: "Zed Signed",
      signature_method: "drawn" as const,
      has_guardian: false,
      version: "2.0",
    },
    {
      id: "sB",
      client_id: "c5",
      signed_at: "2026-10-01T15:00:00Z",
      typed_name: "Dan R",
      signature_method: "typed" as const,
      has_guardian: false,
      version: "2.0",
    },
    {
      id: "sC",
      client_id: "c5",
      signed_at: "2026-09-01T15:00:00Z",
      typed_name: "Dan R",
      signature_method: "typed" as const,
      has_guardian: false,
      version: "2.0",
    },
  ];
  const states = [
    {
      client_id: "c4",
      resign_requested_at: null,
      resign_note: null,
      exempt_kind: "offline_signed" as const,
      exempt_note: "Paper",
      exempt_set_at: "2026-10-02T00:00:00Z",
      last_reminded_at: null,
      reminder_count: 0,
    },
    {
      client_id: "c5",
      resign_requested_at: "2026-10-05T00:00:00Z",
      resign_note: "New package",
      exempt_kind: null,
      exempt_note: null,
      exempt_set_at: null,
      last_reminded_at: "2026-10-05T01:00:00Z",
      reminder_count: 2,
    },
  ];

  const rows = buildRoster(clients, signatures, states);
  const byName = (n: string) => rows.find((r) => r.name === n)!;

  it("classifies each client", () => {
    expect(byName("Zed Signed").status).toBe("signed");
    expect(byName("Amy Never").status).toBe("never_signed");
    expect(byName("Bob Legacy").status).toBe("never_signed");
    expect(byName("Cat Paper").status).toBe("exempt");
    expect(byName("Dan Requested").status).toBe("admin_request");
  });

  it("uses only the latest signature and counts them all", () => {
    expect(byName("Dan Requested").latestSignature?.id).toBe("sB");
    expect(byName("Dan Requested").signatureCount).toBe(2);
  });

  it("keeps the legacy record visible without counting it as signed", () => {
    expect(byName("Bob Legacy").legacy).toEqual({
      signed: true,
      version: "v3 - 2026",
      date: "2025-01-01",
    });
    expect(byName("Bob Legacy").state.state).toBe("needs_signature");
  });

  it("puts the most urgent clients first, then sorts by name", () => {
    expect(rows.map((r) => r.status)).toEqual([
      "never_signed",
      "never_signed",
      "admin_request",
      "signed",
      "exempt",
    ]);
    expect(rows.slice(0, 2).map((r) => r.name)).toEqual(["Amy Never", "Bob Legacy"]);
  });

  it("summarises counts", () => {
    const counts = summarizeRoster(rows);
    expect(counts).toMatchObject({
      total: 5,
      signed: 1,
      exempt: 1,
      never_signed: 2,
      admin_request: 1,
      outstanding: 3,
    });
  });

  it("reports clients without an app account separately", () => {
    const state = resolveAgreementState({
      latestSignature: null,
      exempt: null,
      resignRequestedAt: null,
      resignNote: null,
    });
    expect(rosterStatusOf(state, false)).toBe("no_account");
    expect(compareRosterStatus("never_signed", "signed")).toBeLessThan(0);
  });
});
