import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { isMemberAccessActive } from "@/lib/memberAccess";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe("membership access (Phase 0)", () => {
  const base = { status: "Active", manual_access_override: false, manual_access_disabled: false, in_grace: false, access_end_date: null };

  it("keeps a member who cancelled in until the month they paid for ends", () => {
    expect(isMemberAccessActive({ ...base, subscription_status: "Active (Cancels at period end)", cancel_at: day(10) })).toBe(true);
    expect(isMemberAccessActive({ ...base, subscription_status: "Active (Cancels at period end)", current_period_end: day(3) })).toBe(true);
    expect(isMemberAccessActive({ ...base, subscription_status: "Active (Cancels at period end)", cancel_at: day(-1), current_period_end: day(-1) })).toBe(false);
  });

  it("lets comped members in, keeps Hold Plan / Paused / Cancelled locked", () => {
    expect(isMemberAccessActive({ ...base, subscription_status: "Complimentary" })).toBe(true);
    expect(isMemberAccessActive({ ...base, subscription_status: "Active" })).toBe(true);
    expect(isMemberAccessActive({ ...base, subscription_status: "Trialing" })).toBe(true);
    expect(isMemberAccessActive({ ...base, subscription_status: "Hold Plan" })).toBe(false);
    expect(isMemberAccessActive({ ...base, subscription_status: "Paused" })).toBe(false);
    expect(isMemberAccessActive({ ...base, status: "Cancelled", subscription_status: "Cancelled" })).toBe(false);
  });

  it("the kill switch still wins, and the database checks say the same", () => {
    expect(isMemberAccessActive({ ...base, manual_access_disabled: true, subscription_status: "Complimentary" })).toBe(false);
    const sql = readFileSync("supabase/migrations/20261123091000_member_access_period_end.sql", "utf8");
    expect(sql).toContain("'active', 'trialing', 'admin_granted', 'complimentary'");
    expect(sql).toContain("'active (cancels at period end)'");
    expect(sql).toContain("subscription_status IN ('Trialing', 'Active', 'Complimentary')");
  });
});

describe("logged training is never deleted by editing a program", () => {
  const sql = readFileSync("supabase/migrations/20261123090000_pl_history_guard.sql", "utf8");
  const programs = readFileSync("src/lib/pl-programs.ts", "utf8");
  const editor = readFileSync("src/routes/_authenticated/admin/blocks.$blockId.tsx", "utf8");
  const inline = readFileSync("src/components/workout/shared/inline-workout-editor.tsx", "utf8");

  it("the database refuses a direct delete of a logged row, day, week or program (a client delete still cascades)", () => {
    for (const t of ["pl_exercise_rows", "pl_days", "pl_weeks", "pl_blocks"]) {
      expect(sql).toContain(`CREATE TRIGGER pl_guard_history_delete BEFORE DELETE ON public.${t}`);
    }
    expect(sql).toContain("IF pg_trigger_depth() > 1 OR coalesce(current_setting('jf.allow_history_delete', true), '') = 'on' THEN");
    expect(sql).toContain("c.completed_at IS NOT NULL");
    expect(sql).toContain("SECURITY INVOKER");
  });

  it("a program with logged workouts is archived instead of deleted", () => {
    expect(programs).toMatch(/export async function deleteBlock\(blockId: string\): Promise<"deleted" \| "archived">/);
    expect(programs).toMatch(/if \(\(await loggedIds\("block", \[blockId\]\)\)\.has\(blockId\)\) \{\s*await archiveBlock\(blockId\);/);
  });

  it("copy week / copy day / clear future weeks leave trained days alone", () => {
    expect(programs).toContain("if (keptSlots.has(d.day_index)) continue;");
    expect(programs).toContain('if (existing && (await loggedIds("day", [existing.id])).has(existing.id)) return;');
    expect(programs).toContain("if (d.is_custom || logged.has(d.id)) continue;");
  });

  it("the editors put logged parts back instead of failing the save", () => {
    expect(editor).toContain("const restored = await restoreLoggedParts(origWeeks, curWeeks);");
    expect(editor).toContain("if (restored) setPayload((p: any) => (p ? { ...p } : p));");
    expect(inline).toContain('if (!keepIds.has(or.id) && !logged.has(or.id)) await deleteRow(or.id);');
  });
});
