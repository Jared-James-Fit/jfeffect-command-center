import { describe, expect, it } from "vitest";
import { rowMetaLine, rowStatusSummary, rowStatuses } from "@/components/clients/row-status";

/** A client with nothing waiting on the coach: signed in, paid up, signed, on a program. */
const row = (over: Record<string, unknown> = {}): any => ({
  account_status: "Account Created",
  block_id: "b1", next_block_id: null, f_missing_program: false, f_program_ending: false,
  f_needs_setup: false, f_needs_review: false, f_payment_issue: false, f_new_client: false,
  f_missed_workouts: false, missed_workouts_count: 0, f_inactive: false, payment_state: "ok",
  coaching_agreement_status: "signed", f_no_contract: false,
  last_active_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), last_login_at: null, days_inactive: 0,
  coaching_type: "In-Person Training", coach_name: "Cole Crew",
  ...over,
});
const ids = (over: Record<string, unknown>) => rowStatuses(row(over)).map((s) => s.id);
const primary = (over: Record<string, unknown>) => rowStatusSummary(row(over)).primary?.id ?? null;

describe("a Clients row shows one status: the most important thing waiting on the coach", () => {
  it("shows nothing at all when nothing needs the coach (no 'Active' or 'Contract signed' chips)", () => {
    expect(rowStatuses(row())).toEqual([]);
    expect(rowStatusSummary(row())).toEqual({ primary: null, more: [] });
    expect(ids({ f_new_client: true })).toEqual([]);
  });

  it("orders them: failing payment, program, missed workouts, payment set up, account setup", () => {
    const everything = row({
      f_payment_issue: true, payment_state: "past_due",
      block_id: null, f_missing_program: true,
      f_missed_workouts: true, missed_workouts_count: 3,
      f_needs_review: true,
      coaching_agreement_status: "no_account", f_no_contract: true,
      f_inactive: true, last_active_at: null,
    });
    expect(rowStatuses(everything).map((s) => s.id)).toEqual([
      "payment_issue", "no_program", "missed", "review_due", "inactive", "no_account",
    ]);
  });

  it("program first, then missed workouts, then no payment, then account setup", () => {
    const marc = { block_id: null, f_missing_program: true, payment_state: "not_set_up", coaching_agreement_status: "no_account", f_no_contract: true, last_active_at: null };
    expect(ids(marc)).toEqual(["no_program", "no_payment", "no_account"]);
    expect(primary(marc)).toBe("no_program");
    expect(rowStatusSummary(row(marc)).more.map((s) => s.id)).toEqual(["no_payment", "no_account"]);

    expect(primary({ f_missed_workouts: true, missed_workouts_count: 4, payment_state: "not_set_up" })).toBe("missed");
    expect(primary({ payment_state: "not_set_up", f_needs_setup: true, account_status: "Invite Sent" })).toBe("no_payment");
    expect(primary({ f_needs_setup: true, account_status: "Invite Sent" })).toBe("needs_setup");
  });

  it("tells no program from a program that ended or is ending (one of them, never two)", () => {
    expect(ids({ block_id: null, f_missing_program: true })).toEqual(["no_program"]);
    expect(ids({ f_missing_program: true })).toEqual(["program_ended"]);
    expect(ids({ f_program_ending: true })).toEqual(["program_ending"]);
    // A block queued with nothing running yet isn't missing a program.
    expect(ids({ block_id: null, next_block_id: "b2" })).toEqual([]);
  });

  it("is red only for something failing or overdue, amber for everything else", () => {
    const tone = (over: Record<string, unknown>) => rowStatuses(row(over))[0]!.tone;
    expect(tone({ f_payment_issue: true })).toBe("danger");
    expect(tone({ f_missing_program: true })).toBe("danger"); // ended, nothing queued: no workouts
    for (const over of [
      { block_id: null, f_missing_program: true },
      { f_program_ending: true },
      { f_missed_workouts: true, missed_workouts_count: 2 },
      { payment_state: "not_set_up" },
      { payment_state: "pending" },
      { coaching_agreement_status: "never_signed", f_no_contract: true },
      { f_needs_setup: true, account_status: "Invite Sent" },
    ]) expect(tone(over), JSON.stringify(over)).toBe("warn");
  });

  it("gives one payment status at most, and one account status at most", () => {
    expect(ids({ f_payment_issue: true, payment_state: "not_set_up" })).toEqual(["payment_issue"]);
    expect(ids({ payment_state: "pending" })).toEqual(["awaiting_payment"]);
    expect(ids({ payment_state: "exempt" })).toEqual([]);
    // no app account, needs setup and never signed in all say "they can't get in yet"
    expect(ids({ coaching_agreement_status: "no_account", f_no_contract: true, f_needs_setup: true, account_status: "Invite Sent", last_active_at: null })).toEqual(["no_account"]);
    expect(ids({ f_needs_setup: true, account_status: "Invite Sent", last_active_at: null })).toEqual(["needs_setup"]);
    expect(ids({ last_active_at: null, last_login_at: null })).toEqual(["never_signed_in"]);
    // a missing training-days field alone (needs_setup on an activated account) is not a status
    expect(ids({ f_needs_setup: true, account_status: "Active" })).toEqual([]);
  });

  it("says when the agreement still needs signing, and nothing once it's signed or exempt", () => {
    expect(ids({ coaching_agreement_status: "never_signed", f_no_contract: true })).toEqual(["contract"]);
    expect(rowStatuses(row({ coaching_agreement_status: "new_version", f_no_contract: true }))[0]!.label).toBe("Needs new version");
    expect(ids({ coaching_agreement_status: "exempt", coaching_agreement_exempt_kind: "offline_signed" })).toEqual([]);
    expect(ids({ coaching_agreement_status: null })).toEqual([]);
  });

  it("explains each one and offers the fix where there is one", () => {
    const all = [
      ...rowStatuses(row({ f_payment_issue: true })),
      ...rowStatuses(row({ block_id: null, f_missing_program: true })),
      ...rowStatuses(row({ f_missing_program: true })),
      ...rowStatuses(row({ f_needs_review: true, payment_state: "not_set_up", coaching_agreement_status: "never_signed", f_no_contract: true })),
    ];
    for (const s of all) {
      expect(s.hint.length, s.id).toBeGreaterThan(20);
      expect(s.actions?.length, s.id).toBeGreaterThan(0);
      expect(s.label, s.id).toMatch(/^[A-Z0-9][^A-Z]*$/); // sentence case
      expect(s.hint, s.id).not.toContain("—");
    }
    expect(all.find((s) => s.id === "no_program")!.actions).toEqual(["assign_program"]);
    expect(all.find((s) => s.id === "review_due")!.actions).toEqual(["reviews", "mark_reviewed"]);
    expect(all.find((s) => s.id === "contract")!.actions).toEqual(["remind", "agreement"]);
  });
});

describe("the plain line of facts under the name", () => {
  it("is the coaching type and when they were last seen, the coach only when there are several", () => {
    expect(rowMetaLine(row())).toBe("In-Person Training · Last seen 2 hours ago");
    expect(rowMetaLine(row(), { showCoach: true })).toBe("In-Person Training · Coach Cole · Last seen 2 hours ago");
    expect(rowMetaLine(row({ coaching_type: null, last_active_at: new Date().toISOString() }))).toBe("Last seen just now");
  });

  it("says never signed in once: in the line, unless it's already the row's chip", () => {
    const never = row({ last_active_at: null, last_login_at: null, block_id: null, f_missing_program: true });
    expect(rowMetaLine(never, { primary: rowStatusSummary(never).primary })).toBe("In-Person Training · Never signed in");
    const onlyNever = row({ last_active_at: null, last_login_at: null });
    expect(rowMetaLine(onlyNever, { primary: rowStatusSummary(onlyNever).primary })).toBe("In-Person Training");
  });
});
