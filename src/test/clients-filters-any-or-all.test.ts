import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DIRECTORY_FILTER_KEYS, matchFromSearch } from "@/lib/clients-directory-filters";
import { FILTER_GROUPS, blockEnd, quickFilterKeys, rowBadges } from "@/components/clients/clients-status";

const read = (f: string) => readFileSync(f, "utf8");

describe("several filters: any (default) or all", () => {
  it("the URL says all only when asked; anything else is any", () => {
    expect(matchFromSearch(undefined)).toBe("any");
    expect(matchFromSearch("any")).toBe("any");
    expect(matchFromSearch("all")).toBe("all");
    expect(matchFromSearch("nope")).toBe("any");
  });

  it("the page reads it, the server sends it, and the database decides", () => {
    const page = read("src/routes/_authenticated/admin/clients.index.tsx");
    expect(page).toContain("const match = matchFromSearch(search.match);");
    expect(page).toContain("          flags,\n          match,\n");
    const server = read("src/lib/clients-directory.functions.ts");
    expect(server).toContain('match: z.enum(["any", "all"]).optional().default("any"),');
    expect(server).toContain("p_match: data.match,");
    const sql = read("supabase/migrations/20270110090000_clients_filters_any_or_all.sql");
    expect(sql).toContain("or (v_match_all and cs.flags @> v_flags)");
    expect(sql).toContain("or (not v_match_all and cs.flags && v_flags)");
    // an older build that sends no p_match keeps its old "all" behaviour
    expect(sql).toContain("p_match text DEFAULT ''all''::text");
    // same access as before, and never a second overload
    expect(sql).toContain("DROP FUNCTION public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[]);");
    expect(sql).toContain("FROM public, anon;");
    expect(sql).toContain("TO authenticated, service_role;");
  });

  it("dropping to one filter forgets all; another tab starts fresh", () => {
    const toolbar = read("src/components/clients/client-toolbar.tsx");
    expect(toolbar).toContain("...(next.length < 2 ? { match: undefined } : {})");
    expect(toolbar).toContain('const setMatch = (m: FilterMatch) => set({ match: m === "all" ? "all" : undefined });');
  });
});

describe("the quick row is only what needs you", () => {
  it("most urgent first, every filter once", () => {
    expect(FILTER_GROUPS[0]!.key).toBe("attention");
    expect(FILTER_GROUPS[0]!.keys.slice(0, 2)).toEqual(["payment_issues", "needs_review"]);
    expect(FILTER_GROUPS.flatMap((g) => g.keys).sort()).toEqual([...DIRECTORY_FILTER_KEYS].sort());
  });

  it("hides filters with nobody in them, but never one that's picked", () => {
    const counts = { needs_review: 3, missed_workouts: 2, no_program: 4, no_contract: 0, inactive: 0 } as any;
    const keys = quickFilterKeys(counts, ["inactive"]).flatMap((g) => g.keys);
    expect(keys).toEqual(["needs_review", "missed_workouts", "inactive", "no_program"]);
    expect(quickFilterKeys({} as any, [])).toEqual([]);
  });
});

describe("where the block stands", () => {
  const now = new Date(2026, 10, 2, 15, 0); // Nov 2, 3pm
  it("counts calendar days, so tomorrow is 1d and never 0d", () => {
    expect(blockEnd("2026-11-03", null, now)).toMatchObject({ state: "soon", days: 1, label: "Ends in 1d", needsNext: true });
    expect(blockEnd("2026-11-02", null, now)).toMatchObject({ state: "today", label: "Ends today", needsNext: true });
    expect(blockEnd("2026-11-01", null, now)).toMatchObject({ state: "ended", label: "Ended Nov 1", needsNext: true });
    expect(blockEnd("2026-12-20", null, now)).toMatchObject({ state: "later", label: "48d left", needsNext: false });
  });

  it("nothing to do once the next block is queued", () => {
    expect(blockEnd("2026-11-03", "next-id", now)?.needsNext).toBe(false);
    expect(blockEnd(null, null, now)).toBeNull();
    expect(blockEnd("not a date", null, now)).toBeNull();
  });

  it("a finished block with nothing after it is never 'Active'", () => {
    const base = { account_status: "Account Created", payment_state: "ok", f_missing_program: false, block_id: "b1" } as any;
    expect(rowBadges(base).map((b) => b.id)).toEqual(["active"]);
    expect(rowBadges({ ...base, f_missing_program: true }).map((b) => b.id)).toEqual(["program_ended"]);
    // no block at all is the program column's "Assign Program", not a status
    expect(rowBadges({ ...base, block_id: null, f_missing_program: true }).map((b) => b.id)).toEqual(["active"]);
  });
});

describe("the row: one clear way in", () => {
  const row = read("src/components/clients/client-row.tsx");
  it("View Profile and ⋯ only: no quick actions, no arrow", () => {
    expect(row).toContain(">View Profile</ClientNameLink>");
    expect(row).not.toContain("QuickActionsMenu");
    expect(row).not.toContain("ChevronRight");
    expect(read("src/components/clients/quick-actions.tsx")).not.toContain("export function QuickActionsMenu");
  });

  it("says a block is ending where its dates are, with the fix one tap away", () => {
    expect(row).toContain("const end = hasProgram ? blockEnd(r.block_end, r.next_block_id) : null;");
    expect(row).toContain("{end.label} · Next block");
    expect(row).not.toContain("Program ends in");
  });
});
