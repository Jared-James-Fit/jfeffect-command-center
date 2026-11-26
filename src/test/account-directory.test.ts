import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  accountKey,
  filterCounts,
  inFilter,
  listMembers,
  memberAccounts,
  needsAttention,
  statusChip,
  syncSummary,
  type AccountRow,
} from "@/lib/accounts/account-directory";

const row = (p: Partial<AccountRow>): AccountRow => ({
  user_id: "u",
  client_id: "c",
  member_id: "m",
  name: "Someone",
  email: null,
  phone: null,
  avatar_url: null,
  username: null,
  created_at: "2026-11-01T00:00:00Z",
  last_sign_in_at: null,
  last_seen_at: null,
  last_workout_at: null,
  workouts_30d: 0,
  kind: "member",
  plan_key: "free",
  plan_label: "Free",
  badge: "free",
  account_class: "real",
  lifecycle: "active",
  subscription_status: "Free",
  billing_issue: false,
  confirmed: true,
  starred: false,
  issues: [],
  ...p,
});

// The production shape on Nov 26 2026 (names made up): coaching clients, an old self-serve test
// login with an archived membership row, a confirmed login with no record, three unconfirmed demo
// logins, and a virtual account.
const prod: AccountRow[] = [
  row({ user_id: "c1", kind: "coaching", plan_key: "complete", plan_label: "Complete Online Coaching", badge: "coaching" }),
  row({ user_id: "c2", kind: "coaching", lifecycle: "archived", badge: "free" }),
  row({ user_id: "t1", name: "Old Test", issues: ["member_row_archived"] }),
  row({ user_id: "p1", client_id: null, member_id: null, name: "No Record", kind: "pending", plan_key: "none", plan_label: "No plan yet", issues: ["no_record"] }),
  row({ user_id: "d1", client_id: null, member_id: null, kind: "pending", lifecycle: "unconfirmed", confirmed: false, issues: ["unconfirmed"] }),
  row({ user_id: "v1", client_id: null, member_id: null, account_class: "virtual", name: "Maya Okafor" }),
  row({ user_id: "pr", plan_key: "premium", plan_label: "Premium", badge: "premium", last_seen_at: "2026-11-25T00:00:00Z" }),
  row({ user_id: "pm", plan_key: "member", plan_label: "Member", badge: "member", billing_issue: true }),
  row({ user_id: "sb", account_class: "sandbox" }),
];

describe("Member Management lists every account that isn't a coaching client", () => {
  it("coaching clients and the admin sandbox are Client Management's, everyone else is here", () => {
    const ids = memberAccounts(prod).map((r) => r.user_id);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("c2");
    expect(ids).not.toContain("sb");
    expect(ids).toEqual(expect.arrayContaining(["t1", "p1", "d1", "v1", "pr", "pm"]));
  });

  it("a login with no athlete record is listed (it used to be in neither list)", () => {
    const shown = listMembers(prod, { filter: "pending", query: "", sort: "name" });
    expect(shown.map((r) => r.user_id)).toEqual(expect.arrayContaining(["p1", "d1"]));
    expect(statusChip(prod[3])).toEqual({ label: "No athlete record", tone: "warn" });
  });

  it("virtual, test and demo accounts never count as real members", () => {
    const real = listMembers(prod, { filter: "active", query: "", sort: "name" }).map((r) => r.user_id);
    expect(real).not.toContain("v1");
    expect(inFilter(prod[5], "virtual")).toBe(true);
    expect(inFilter(row({ account_class: "demo" }), "test")).toBe(true);
    expect(inFilter(row({ account_class: "demo" }), "active")).toBe(false);
  });

  it("filters by plan read the plan, not the badge (a hidden badge still files under its plan)", () => {
    expect(inFilter(row({ plan_key: "member", badge: null }), "member")).toBe(true);
    expect(inFilter(row({ plan_key: "premium" }), "premium")).toBe(true);
    expect(inFilter(row({ plan_key: "program_only" }), "program_only")).toBe(true);
    expect(inFilter(row({ plan_key: "free" }), "member")).toBe(false);
  });

  it("archived and deactivated accounts sit under their own filters, never Active", () => {
    expect(inFilter(row({ lifecycle: "archived" }), "active")).toBe(false);
    expect(inFilter(row({ lifecycle: "archived" }), "archived")).toBe(true);
    expect(inFilter(row({ lifecycle: "deactivated" }), "deactivated")).toBe(true);
    expect(inFilter(row({ lifecycle: "pending_deletion" }), "archived")).toBe(true);
  });

  it("needs attention: billing failing or an issue that needs a decision (an unconfirmed email alone doesn't)", () => {
    expect(needsAttention(row({ issues: ["unconfirmed"] }))).toBe(false);
    expect(needsAttention(row({ issues: ["no_member_row"] }))).toBe(true);
    const counts = filterCounts(memberAccounts(prod));
    expect(counts.attention).toBe(3); // the test login's archived row, the login with no record, the failing payment
    expect(statusChip(prod[7])).toEqual({ label: "Payment failing", tone: "danger" });
  });

  it("search reads name, email, phone and @username, accents and case folded", () => {
    const rows = [row({ user_id: "a", name: "Diego Marín", username: "diego.pulls" })];
    expect(listMembers(rows, { filter: "active", query: "marin", sort: "name" })).toHaveLength(1);
    expect(listMembers(rows, { filter: "active", query: "@DIEGO", sort: "name" })).toHaveLength(1);
    expect(listMembers(rows, { filter: "active", query: "nobody", sort: "name" })).toHaveLength(0);
  });

  it("starred first keeps the sort inside each group", () => {
    const rows = [row({ user_id: "a", name: "Ann" }), row({ user_id: "b", name: "Bea", starred: true }), row({ user_id: "c", name: "Cal" })];
    expect(listMembers(rows, { filter: "active", query: "", sort: "name", starred: "first" }).map((r) => r.name)).toEqual(["Bea", "Ann", "Cal"]);
    expect(listMembers(rows, { filter: "active", query: "", sort: "name", starred: "only" }).map((r) => r.name)).toEqual(["Bea"]);
  });

  it("every row has a stable key, with or without a login", () => {
    expect(accountKey({ user_id: null, client_id: "x", member_id: null })).toBe("c:x");
    expect(accountKey({ user_id: null, client_id: null, member_id: "y" })).toBe("m:y");
  });

  it("the sync summary counts real accounts only and tells safe fixes from decisions", () => {
    const s = syncSummary([
      { user_id: "1", client_id: "c", member_id: null, name: "A", account_class: "real", kind: "member", issues: ["no_member_row"] },
      { user_id: "2", client_id: null, member_id: null, name: "B", account_class: "real", kind: "pending", issues: ["no_record"] },
      { user_id: "3", client_id: null, member_id: null, name: "C", account_class: "demo", kind: "pending", issues: ["no_record"] },
      { user_id: "4", client_id: null, member_id: null, name: "D", account_class: "real", kind: "pending", issues: ["unconfirmed"] },
    ]);
    expect(s).toEqual({ state: "attention", decisions: 1, fixable: 1 });
    expect(syncSummary([]).state).toBe("ok");
  });
});

describe("the directory is the database's, never app_members alone", () => {
  const sql = readFileSync("supabase/migrations/20270601090000_accounts_directory_badges_pov_virtual.sql", "utf8");
  it("reads every login and every record, and checks the caller", () => {
    expect(sql).toContain("FROM auth.users u");
    expect(sql).toContain("WHERE u.deleted_at IS NULL AND u.id NOT IN (SELECT id FROM staff)");
    expect(sql).toContain("RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';");
    expect(sql).toContain("public.has_role(v_uid, 'admin')");
  });
  it("reconcile only makes the safe fixes, and only for real accounts; nothing is deleted", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_account_reconcile"), sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_account_make_free_member"));
    expect(fn).toContain("IF coalesce(_apply, false) AND r.account_class IN ('real') THEN");
    expect(fn).not.toMatch(/\bDELETE\b/);
    expect(fn).toContain("INSERT INTO public.account_sync_runs");
  });
});
