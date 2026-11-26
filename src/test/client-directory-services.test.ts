import { describe, expect, it } from "vitest";
import { organizeDirectoryServices, nutritionDirectoryRow, rowDirectoryFlags } from "@/lib/clients-directory-services";
import type { DirectoryRow } from "@/lib/clients-directory.functions";

const row = (id: string, extra: Partial<DirectoryRow> = {}) => ({
  id, full_name: id, account_status: "Active", last_login_at: "2026-11-20",
  payment_state: "ok", f_missing_program: true, f_program_ending: true,
  f_missed_workouts: true, f_missing_cardio: true, f_inactive: true,
  f_missing_nutrition: true, priority: 6, f_needs_setup: true,
  next_action: { kind: "assign", label: "Assign program" },
  ...extra,
} as DirectoryRow);
const opts = { flags: [], match: "any" as const, sort: "name", page: 1, size: 15 };

describe("nutrition service directory", () => {
  it("retains real nutrition, payment and review alerts and removes irrelevant training flags", () => {
    const n = nutritionDirectoryRow(row("n", { f_needs_review: true, payment_state: "pending" }));
    expect(rowDirectoryFlags(n)).toEqual(["no_nutrition", "payment_pending", "needs_review"]);
    expect(n.next_action.kind).toBe("review");
    expect(n.service_kind).toBe("nutrition");
  });
  it("paginates all services together without duplicate accounts and keeps counts consistent", () => {
    const result = organizeDirectoryServices([row("a"), row("n"), row("z")], new Set(["n"]), { ...opts, size: 1 });
    expect(result.rows.map(r => r.id)).toEqual(["a"]);
    expect(result.total).toBe(3);
    const second = organizeDirectoryServices([row("a"), row("n"), row("z")], new Set(["n"]), { ...opts, size: 1, page: 2 });
    expect(second.rows.map(r => r.id)).toEqual(["n"]);
    expect(result.counts.all).toBe(3);
    expect(result.counts.no_program).toBe(2);
    expect(result.counts.no_nutrition).toBe(3);
  });
  it("respects the existing any/all filters and starred mode's whole-list reading", () => {
    const rows = [row("a"), row("n")];
    const ids = new Set(["n"]);
    const filtered = organizeDirectoryServices(rows, ids, { ...opts, flags: ["no_program"] });
    expect(filtered.total).toBe(1);
    const whole = organizeDirectoryServices(rows, ids, opts);
    expect(whole.rows.map(r => r.id)).toEqual(["a", "n"]);
    expect(whole.total).toBe(2);
  });
});
