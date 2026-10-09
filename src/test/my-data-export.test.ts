import { describe, it, expect } from "vitest";
import { buildMyDataExport, fetchAllRows } from "@/lib/my-data.functions";

type Call = { table: string; filters: Array<[string, string, any]>; range?: [number, number] };

// Records every query and its filters. pl_row_results has 2,500 rows to page through.
function fakeSupabase(opts: { failTable?: string; member?: boolean } = {}) {
  const calls: Call[] = [];
  const sb: any = {
    calls,
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const q: any = {
        select: () => q,
        order: () => q,
        eq: (c: string, v: any) => { call.filters.push(["eq", c, v]); return q; },
        in: (c: string, v: any) => { call.filters.push(["in", c, v]); return q; },
        range: (a: number, b: number) => { call.range = [a, b]; return q; },
        maybeSingle: async () => ({ data: table === "app_members" && opts.member ? { id: "mem1" } : null, error: null }),
        then: (resolve: any) => {
          if (table === opts.failTable) return resolve({ data: null, error: { message: "boom" } });
          if (table === "clients") return resolve({ data: [{ id: "c1", user_id: "u1" }], error: null });
          if (table === "pl_row_results" && call.range) {
            const [a, b] = call.range;
            const total = 2500;
            const n = Math.max(0, Math.min(b, total - 1) - a + 1);
            return resolve({ data: Array.from({ length: n }, (_, i) => ({ id: a + i })), error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
    rpc: async () => ({ data: { records: [], tonnage: [] }, error: null }),
  };
  return sb;
}

describe("data export", () => {
  it("only ever asks for the caller's own rows", async () => {
    const sb = fakeSupabase({ member: true });
    await buildMyDataExport(sb, "u1");
    for (const c of sb.calls as Call[]) {
      const scoped = c.filters.some(([op, col, v]) =>
        (op === "eq" && col === "user_id" && v === "u1")
        || (op === "in" && col === "client_id" && JSON.stringify(v) === JSON.stringify(["c1"]))
        || (op === "eq" && col === "member_id" && v === "mem1")
        || (op === "eq" && col === "member_plan_enrollments.member_id" && v === "mem1"));
      expect({ table: c.table, scoped }).toEqual({ table: c.table, scoped: true });
    }
  });

  it("pages past PostgREST's 1,000-row cap", async () => {
    const out: any = await buildMyDataExport(fakeSupabase(), "u1");
    expect(out.workouts.sets).toHaveLength(2500);
  });

  it("notes a failing section instead of failing the export", async () => {
    const out: any = await buildMyDataExport(fakeSupabase({ failTable: "progress_submissions" }), "u1");
    expect(out.check_ins.submissions).toEqual({ error: "boom" });
    expect(out.workouts.sets).toHaveLength(2500);
  });

  it("fetchAllRows stops on a short page", async () => {
    let calls = 0;
    const rows = await fetchAllRows(async (a, b) => { calls++; return { data: a === 0 ? new Array(1000).fill(0) : [1, 2], error: null }; });
    expect(rows).toHaveLength(1002);
    expect(calls).toBe(2);
  });
});
