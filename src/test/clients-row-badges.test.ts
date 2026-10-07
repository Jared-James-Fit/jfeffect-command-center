import { describe, expect, it } from "vitest";
import { contractBadge, lastSeenChip, rowBadges, rowStatusChips, STATUS_META } from "@/components/clients/clients-status";

const row = (over: Record<string, unknown> = {}): any => ({
  account_status: "Account Created",
  f_needs_setup: false, f_needs_review: false, f_program_ending: false, f_payment_issue: false, f_new_client: false,
  f_missed_workouts: false, missed_workouts_count: 0, f_inactive: false, payment_state: "ok",
  ...over,
});
const labels = (r: any) => rowBadges(r).map((b) => b.label);

describe("client row badges", () => {
  it("does not say Needs Setup for an account that has already been created", () => {
    expect(labels(row({ f_needs_setup: true, account_status: "Account Created" }))).not.toContain("Needs Setup");
    expect(labels(row({ f_needs_setup: true, account_status: "Invite Sent" }))).toContain("Needs Setup");
  });

  it("shows payment states: missed, none set up, awaiting; nothing for ok or exempt", () => {
    expect(labels(row({ f_payment_issue: true, payment_state: "past_due" }))).toContain("Payment Issue");
    expect(labels(row({ payment_state: "not_set_up" }))).toContain("No Payment Set Up");
    expect(labels(row({ payment_state: "pending" }))).toContain("Awaiting Payment");
    expect(labels(row({ payment_state: "ok" }))).toEqual(["Active"]);
    expect(labels(row({ payment_state: "exempt" }))).toEqual(["Active"]);
  });

  it("every badge has a plain-English hint, and every status card does too", () => {
    const all = rowBadges(row({
      f_payment_issue: true, payment_state: "not_set_up", f_needs_review: true,
      f_missed_workouts: true, missed_workouts_count: 3, f_inactive: true, f_program_ending: true,
    }));
    expect(all.length).toBe(4);
    for (const b of all) expect(b.hint.length).toBeGreaterThan(20);
    for (const m of Object.values(STATUS_META)) if (m.label !== "All Clients") expect(m.hint).toBeTruthy();
    expect(STATUS_META.no_payment.label).toBe("No Payment");
  });
});

describe("contract status on every client", () => {
  const signed = (over: Record<string, unknown> = {}) =>
    row({ coaching_agreement_status: "signed", f_no_contract: false, ...over });
  const owes = (status: string, over: Record<string, unknown> = {}) =>
    row({ coaching_agreement_status: status, f_no_contract: true, ...over });

  it("says signed (with the version and date) for a client who has", () => {
    const chip = contractBadge(
      signed({ coaching_agreement_signed_at: "2026-10-03T15:00:00Z", coaching_agreement_version: "2.0" }),
    )!;
    expect(chip.label).toBe("Contract Signed");
    expect(chip.tone).toBe("ok");
    expect(chip.hint).toContain("version 2.0");
    expect(chip.hint).toMatch(/Oct 3, 2026|Oct 2, 2026/); // the coach's timezone decides the day
    expect(chip.actions).toEqual(["agreement"]);
  });

  it("says not signed, in red, and offers a reminder", () => {
    const chip = contractBadge(owes("never_signed"))!;
    expect(chip.label).toBe("Contract Not Signed");
    expect(chip.tone).toBe("danger");
    expect(chip.actions).toEqual(["remind", "agreement"]);
    expect(chip.hint).toMatch(/popup each time they open the app/);
  });

  it("mentions when they were last reminded, so nobody is nagged twice", () => {
    const chip = contractBadge(
      owes("never_signed", { coaching_agreement_reminded_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
    )!;
    expect(chip.hint).toMatch(/Last reminded 2 days ago/);
  });

  it("tells a re-sign request from a newer version", () => {
    expect(contractBadge(owes("admin_request"))!.label).toBe("Re-Sign Requested");
    const old = contractBadge(owes("new_version", { coaching_agreement_version: "1.0" }))!;
    expect(old.label).toBe("Needs New Version");
    expect(old.hint).toContain("version 1.0");
    expect(old.tone).toBe("warn");
  });

  it("treats paper and not-required as handled, in a quiet colour", () => {
    const paper = contractBadge(signed({ coaching_agreement_status: "exempt", coaching_agreement_exempt_kind: "offline_signed" }))!;
    const notRequired = contractBadge(signed({ coaching_agreement_status: "exempt", coaching_agreement_exempt_kind: "not_required" }))!;
    expect(paper.label).toBe("Signed On Paper");
    expect(notRequired.label).toBe("Contract Not Required");
    expect(paper.tone).toBe("muted");
    expect(notRequired.tone).toBe("muted");
  });

  it("explains a client with no app account instead of offering a reminder they can't receive", () => {
    const chip = contractBadge(owes("no_account"))!;
    expect(chip.label).toBe("No App Account");
    expect(chip.actions).toEqual(["profile"]);
  });

  it("shows nothing when the row has no agreement information (a database that predates it)", () => {
    expect(contractBadge(row())).toBeNull();
    expect(rowStatusChips(row())).toEqual(rowBadges(row()));
  });

  it("always shows it, after the priority badges, even when those are full", () => {
    const full = owes("never_signed", {
      f_payment_issue: true, payment_state: "not_set_up", f_needs_review: true,
      f_missed_workouts: true, missed_workouts_count: 3, f_inactive: true, f_program_ending: true,
    });
    const labels = rowStatusChips(full).map((b) => b.label);
    expect(labels).toHaveLength(5);
    expect(labels.at(-1)).toBe("Contract Not Signed");
  });

  it("never says 'Active, all good' next to an agreement that still needs signing", () => {
    expect(labels(signed())).toEqual(["Active"]);
    expect(labels(owes("never_signed"))).toEqual([]);
    expect(rowStatusChips(owes("never_signed")).map((b) => b.label)).toEqual(["Contract Not Signed"]);
    expect(rowStatusChips(signed()).map((b) => b.label)).toEqual(["Active", "Contract Signed"]);
  });
});

describe("every status explains itself", () => {
  // One flag at a time, so the four-badge cap can't hide any of them.
  const single = (over: Record<string, unknown>) => rowBadges(row(over));
  const statuses = [
    ...single({ f_payment_issue: true, payment_state: "past_due" }),
    ...single({ f_needs_setup: true, account_status: "Invite Sent" }),
    ...single({ payment_state: "not_set_up" }),
    ...single({ payment_state: "pending" }),
    ...single({ f_needs_review: true }),
    ...single({ f_missed_workouts: true, missed_workouts_count: 4 }),
    ...single({ f_inactive: true }),
    ...single({ f_program_ending: true }),
    ...single({ f_new_client: true }),
    ...single({}),
    ...[
      { coaching_agreement_status: "signed", f_no_contract: false },
      { coaching_agreement_status: "never_signed", f_no_contract: true },
      { coaching_agreement_status: "admin_request", f_no_contract: true },
      { coaching_agreement_status: "new_version", f_no_contract: true },
      { coaching_agreement_status: "exempt", coaching_agreement_exempt_kind: "offline_signed", f_no_contract: false },
      { coaching_agreement_status: "exempt", coaching_agreement_exempt_kind: "not_required", f_no_contract: false },
      { coaching_agreement_status: "no_account", f_no_contract: true },
    ].map((over) => contractBadge(row(over))!),
  ];

  it("covers every status a row can show", () => {
    expect(statuses.map((s) => s.label)).toEqual([
      "Payment Issue", "Needs Setup", "No Payment Set Up", "Awaiting Payment", "Review Due", "4 Missed",
      "Inactive", "Program Ending", "New", "Active",
      "Contract Signed", "Contract Not Signed", "Re-Sign Requested", "Needs New Version",
      "Signed On Paper", "Contract Not Required", "No App Account",
    ]);
  });

  it("has a plain sentence for each one", () => {
    for (const chip of statuses) expect(chip.hint.length, chip.label).toBeGreaterThan(20);
  });

  it("uses no em dashes in what coaches read", () => {
    for (const chip of statuses) {
      expect(chip.hint, chip.label).not.toContain("\u2014");
      expect(chip.next ?? "", chip.label).not.toContain("\u2014");
    }
  });

  it("offers a way forward wherever there is something to do", () => {
    const byLabel = new Map(statuses.map((c) => [c.label, c]));
    for (const label of ["Payment Issue", "No Payment Set Up", "Awaiting Payment", "Review Due", "Program Ending", "Needs Setup"]) {
      const chip = byLabel.get(label)!;
      expect(chip.next, label).toBeTruthy();
      expect(chip.actions?.length, label).toBeGreaterThan(0);
    }
  });
});

describe("one last-seen indicator", () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("says when they were last seen, and stays quiet for a recent visit", () => {
    const chip = lastSeenChip(row({ last_active_at: ago(2), days_inactive: 2 }));
    expect(chip.label).toBe("Last seen 2 days ago");
    expect(chip.title).toBe("Last seen");
    expect(chip.tone).toBe("muted");
    expect(chip.body).toMatch(/Last used the app .*Turns amber after 7 days and red after 14/);
  });

  it("turns amber after a week and red after two", () => {
    expect(lastSeenChip(row({ last_active_at: ago(6), days_inactive: 6 })).tone).toBe("muted");
    expect(lastSeenChip(row({ last_active_at: ago(7), days_inactive: 7 })).tone).toBe("warn");
    expect(lastSeenChip(row({ last_active_at: ago(13), days_inactive: 13 })).tone).toBe("warn");
    expect(lastSeenChip(row({ last_active_at: ago(14), days_inactive: 14 })).tone).toBe("danger");
  });

  it("falls back to the last sign-in, then to never signed in", () => {
    const signedIn = lastSeenChip(row({ last_active_at: null, last_login_at: ago(3) }));
    expect(signedIn.label).toBe("Signed in 3 days ago");
    expect(signedIn.title).toBe("Last signed in");
    const never = lastSeenChip(row({ last_active_at: null, last_login_at: null }));
    expect(never.label).toBe("Never signed in");
    expect(never.body).toMatch(/haven't opened the app/);
  });

  it("does not crash on an unreadable date", () => {
    expect(lastSeenChip(row({ last_active_at: "not a date" })).label).toBe("Last seen a while ago");
  });
});

describe("status ids, so the card never matches on label text", () => {
  it("names each status", () => {
    const id = (over: Record<string, unknown>) => rowBadges(row(over))[0].id;
    expect(id({ f_payment_issue: true, payment_state: "past_due" })).toBe("payment_issue");
    expect(id({ f_needs_setup: true, account_status: "Invite Sent" })).toBe("needs_setup");
    expect(id({ payment_state: "not_set_up" })).toBe("no_payment");
    expect(id({ payment_state: "pending" })).toBe("awaiting_payment");
    expect(id({ f_needs_review: true })).toBe("review_due");
    expect(id({ f_missed_workouts: true, missed_workouts_count: 2 })).toBe("missed");
    expect(id({ f_inactive: true })).toBe("inactive");
    expect(id({ f_program_ending: true })).toBe("program_ending");
    expect(id({ f_new_client: true })).toBe("new");
    expect(id({})).toBe("active");
    expect(contractBadge(row({ coaching_agreement_status: "signed" }))!.id).toBe("contract");
  });

  it("shows missed workouts in the status row, so the tag by the name can step aside", () => {
    const normal = rowStatusChips(row({ f_missed_workouts: true, missed_workouts_count: 3 }));
    expect(normal.some((b) => b.id === "missed")).toBe(true);
  });

  it("only leaves the tag by the name in when the status row is already full", () => {
    const crowded = rowStatusChips(
      row({
        f_payment_issue: true, payment_state: "not_set_up", f_needs_setup: true, account_status: "Invite Sent",
        f_needs_review: true, f_missed_workouts: true, missed_workouts_count: 3,
      }),
    );
    expect(crowded.some((b) => b.id === "missed")).toBe(false);
  });
});
