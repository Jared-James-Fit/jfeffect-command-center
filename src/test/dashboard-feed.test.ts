import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSnapshot, waitingOnMe, trainingSummary, type InboxRow } from "@/lib/dashboard-feed";

const inbox = (client_id: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  client_id, archived: false, unread: false, workflow_status: "waiting_on_client",
  last_inbound_at: "2026-10-08T10:00:00Z", last_inbound_kind: "message", ...extra,
});

describe("dashboard replies count", () => {
  it("matches the Messages badge: needs_response or unread, never archived", () => {
    const rows = [inbox("a", { workflow_status: "needs_response" }), inbox("b"), inbox("c", { unread: true }), inbox("d", { archived: true, unread: true })];
    expect(waitingOnMe(rows).map((r) => r.client_id)).toEqual(["a", "c"]);
  });
});

describe("dashboard is an overview, not another inbox", () => {
  it("no longer renders the Needs you list (Clients + Messages already organise that)", () => {
    const src = readFileSync("src/routes/_authenticated/admin/index.tsx", "utf8");
    expect(src).not.toMatch(/Needs you/);
    expect(src).not.toMatch(/buildNeedsYou/);
    expect(src).toMatch(/admin_dashboard_overview/);
    expect(src).toMatch(/TrainingTodayCard/);
    // records are Crew's (props, Wednesday Wins) and adherence Training Intel's: not repeated here
    expect(src).not.toMatch(/WinsCard/);
    expect(src).not.toMatch(/Training to check/);
    expect(src).not.toMatch(/getCoachIntel/);
    // the Business (money) card was removed from the dashboard
    expect(src).not.toMatch(/BusinessCard/);
    // numbers refresh silently: no "Updating" spinner floating over the tiles
    expect(src).not.toMatch(/DashboardRefreshIndicator/);
  });

  it("coaches never get money or leads from the RPC", () => {
    const sql = readFileSync("supabase/migrations/20261010100000_admin_dashboard_overview.sql", "utf8");
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/case when v_admin/i);
  });
});

describe("training today", () => {
  it("is one line: done of scheduled, who's training now, who trained unscheduled", () => {
    const st = (status: "done" | "training" | "pending") => ({ status });
    expect(trainingSummary([st("done"), st("done"), st("training"), st("pending")], 1)).toEqual({
      total: 5, line: "2 of 4 done · 1 training now · 1 more trained",
    });
    expect(trainingSummary([], 2)).toEqual({ total: 2, line: "2 trained" });
    expect(trainingSummary([], 0).total).toBe(0);
  });

  it("folds into one row that opens its list, and isn't there when nobody trains today", () => {
    const src = readFileSync("src/routes/_authenticated/admin/index.tsx", "utf8");
    expect(src).toContain("if (sum.total === 0) return null;");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("{open && (");
  });

  it("the overview only builds today's training (no rep-history walk on every refresh)", () => {
    // the code, not the comment explaining what was taken out
    const sql = readFileSync("supabase/migrations/20270122090000_dashboard_overview_training_only.sql", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toContain("client_rep_records");
    expect(sql).not.toContain("admin_transactions_v1");
    expect(sql).not.toContain("coaching_applications");
    expect(sql).toContain("and c.service_tier = 'coaching'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_dashboard_overview() FROM public, anon;");
  });
});

describe("dashboard snapshot", () => {
  it("uses the Clients page counts and opens the matching filter", () => {
    const tiles = buildSnapshot({
      waitingReplies: 3,
      counts: { needs_review: 1, payment_issues: 0, no_payment: 6, payment_pending: 5, no_contract: 13, program_ending: 2, missed_workouts: 3 },
    });
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(by.replies.value).toBe(3);
    expect(by.payments.value).toBe(11);
    expect(by.payments.flag).toBe("no_payment");
    expect(by.payments.hint).toBe("6 not set up · 5 awaiting");
    expect(by.agreements).toMatchObject({ value: 13, flag: "no_contract", label: "Unsigned agreements" });
  });
});
