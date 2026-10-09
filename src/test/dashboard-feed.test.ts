import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSnapshot, waitingOnMe, groupWins, winLine, formatLoad, revenueDelta, formatMoney,
  type InboxRow, type OverviewWin,
} from "@/lib/dashboard-feed";

const inbox = (client_id: string, extra: Partial<InboxRow> = {}): InboxRow => ({
  client_id, archived: false, unread: false, workflow_status: "waiting_on_client",
  last_inbound_at: "2026-10-08T10:00:00Z", last_inbound_kind: "message", ...extra,
});
const win = (client_id: string, extra: Partial<OverviewWin> = {}): OverviewWin => ({
  client_id, name: `Client ${client_id}`, avatar: null, exercise: "Squat", reps: 5, load_kg: 100, unit: "lb",
  tier: "block", at: "2026-10-07T10:00:00Z", ...extra,
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
    expect(src).toMatch(/WinsCard/);
    // money is admin-only: rendered only when the RPC returns it
    expect(src).toMatch(/overview\?\.money && <BusinessCard/);
    // numbers refresh silently: no "Updating" spinner floating over the tiles
    expect(src).not.toMatch(/DashboardRefreshIndicator/);
  });

  it("coaches never get money or leads from the RPC", () => {
    const sql = readFileSync("supabase/migrations/20261010100000_admin_dashboard_overview.sql", "utf8");
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/case when v_admin/i);
  });
});

describe("wins this week", () => {
  it("shows load in the client's unit", () => {
    expect(formatLoad(176.9, "lb")).toBe("390 lb");
    expect(formatLoad(102.3, "kg")).toBe("102.5 kg");
    expect(formatLoad(0, "lb")).toBeNull();
    expect(winLine(win("a", { exercise: "Leg Press", load_kg: 176.9, reps: 15 }))).toBe("Leg Press 390 lb × 15");
    expect(winLine(win("a", { exercise: "Plank", load_kg: null }))).toBe("Plank");
  });

  it("one row per client, best record first, most recent client on top", () => {
    const g = groupWins([
      win("a", { tier: "block", exercise: "Bench", at: "2026-10-05T10:00:00Z" }),
      win("b", { tier: "program", at: "2026-10-06T10:00:00Z" }),
      win("a", { tier: "atpr", exercise: "Deadlift", at: "2026-10-04T10:00:00Z" }),
      win("a", { tier: "block", exercise: "Row", at: "2026-10-07T12:00:00Z" }),
    ]);
    expect(g.map((x) => x.client_id)).toEqual(["a", "b"]);
    expect(g[0].best).toBe("atpr");
    expect(g[0].lifts[0].exercise).toBe("Deadlift");
    expect(g[0].lifts).toHaveLength(3);
  });
});

describe("business", () => {
  it("compares against the same point last month", () => {
    expect(revenueDelta({ currency: "CAD", this_month: 682.5, last_month_to_date: 315, last_month: 735, payments: 6 })).toEqual({ pct: 117, up: true });
    expect(revenueDelta({ currency: "CAD", this_month: 100, last_month_to_date: 200, last_month: 400, payments: 1 })).toEqual({ pct: 50, up: false });
    expect(revenueDelta({ currency: "CAD", this_month: 100, last_month_to_date: 0, last_month: 0, payments: 1 })).toBeNull();
    expect(formatMoney(682.5, "CAD")).toMatch(/682\.50/);
    expect(formatMoney(735, "CAD")).toMatch(/735$/);
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
