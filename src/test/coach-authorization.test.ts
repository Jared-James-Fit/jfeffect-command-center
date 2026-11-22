/**
 * A coach reaches only their own clients, and never writes money
 * (20270507094000_coach_money_read_only.sql, 20270507094500_coach_client_data_scoped.sql,
 * staff-client-access.server.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staffCanReachClient, staffUnreachableClients } from "@/lib/staff-client-access.server";

const read = (p: string) => readFileSync(p, "utf8");

/** A caller's own Supabase client: their roles, and the clients RLS lets them see. */
function caller(roles: string[], visible: string[]) {
  return {
    rpc: async (_fn: string, args: { _role: string }) => ({ data: roles.includes(args._role), error: null }),
    from: (_t: string) => {
      let ids: string[] = [];
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { ids = [v]; return q; },
        in: (_c: string, vs: string[]) => { ids = vs; return Promise.resolve({ data: ids.filter((i) => visible.includes(i)).map((id) => ({ id })), error: null }); },
        maybeSingle: async () => ({ data: visible.includes(ids[0]) ? { id: ids[0] } : null, error: null }),
      };
      return q;
    },
  };
}

describe("staff reach a client only through their own login", () => {
  it("the client's own coach, never another coach's client", async () => {
    const ana = caller(["coach"], ["marc"]);
    expect(await staffCanReachClient(ana, "ana", "marc")).toBe(true);
    expect(await staffCanReachClient(ana, "ana", "nico")).toBe(false);
    expect(await staffCanReachClient(ana, "ana", null)).toBe(false);
  });

  it("a client seeing their own record is not staff", async () => {
    expect(await staffCanReachClient(caller(["client"], ["mia"]), "mia-user", "mia")).toBe(false);
  });

  it("names the clients a coach can't reach in a batch", async () => {
    expect(await staffUnreachableClients(caller(["coach"], ["marc"]), "ana", ["marc", "nico", "marc"])).toEqual(["nico"]);
    expect(await staffUnreachableClients(caller(["admin"], ["marc", "nico"]), "owner", ["marc", "nico"])).toEqual([]);
    expect(await staffUnreachableClients(caller([], ["marc"]), "x", ["marc"])).toEqual(["marc"]);
  });
});

describe("server functions that act as the server check the client first", () => {
  it("nutrition AI plans: every client-keyed function asks staffForClient", () => {
    const src = read("src/lib/nutrition-ai-plans.functions.ts");
    for (const fn of ["sendNutritionRequestFn", "reviseNutritionPlanFn", "undoNutritionRevisionFn", "listNutritionRequestsFn", "getClientTrainingPatternFn", "markNutritionPlanAppliedFn", "setAiPlanSupplementsFn"]) {
      const at = src.indexOf(`export const ${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("export const", at + 10) === -1 ? undefined : src.indexOf("export const", at + 10));
      expect(body, fn).toContain("staffForClient(");
    }
    // Regenerate and the phase pick are staff powers only on their own client.
    expect(src).toContain("const staff = await staffForClient(context.supabase, context.userId, (sub as any).client_id);");
  });

  it("a coach never records membership money or changes a sale", () => {
    const ledger = read("src/lib/member-payment-ledger.functions.ts");
    expect(ledger.match(/await assertAdmin\(context\);/g)?.length).toBe(2);
    const archive = read("src/lib/purchase-archive.functions.ts");
    expect(archive).not.toContain('roles.includes("coach")');
    expect(archive).toContain('throw new Error("Only an admin can change a sale.");');
  });

  it("recipes, check-in occurrences and plan messages only for a client the caller reaches", () => {
    expect(read("src/lib/chat-requests.functions.ts")).toContain("staffUnreachableClients(supabase, userId, ids)");
    expect(read("src/lib/action-centre.functions.ts")).toContain('if (!visible) throw new Error("Client not found");');
    expect(read("src/lib/push/app-events.functions.ts")).toContain("staffCanReachClient(supabase, userId, data.id)");
  });
});

describe("the migrations", () => {
  const money = read("supabase/migrations/20270507094000_coach_money_read_only.sql");
  const scoped = read("supabase/migrations/20270507094500_coach_client_data_scoped.sql");
  const cleo = read("supabase/migrations/20270507093000_cleo_actions_run_as_requester.sql");

  it("start with a lock timeout and are idempotent", () => {
    for (const sql of [money, scoped, cleo]) {
      expect(sql).toMatch(/^(--[^\n]*\n|\n)*SET lock_timeout = '5s';/);
      const creates = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON ([a-z_.]+)/g)];
      for (const [, name, table] of creates) expect(sql, name).toContain(`DROP POLICY IF EXISTS "${name}" ON ${table}`);
      expect(sql).not.toMatch(/CREATE FUNCTION /);
    }
  });

  it("leave no coach write on money tables", () => {
    expect(money).toContain('DROP POLICY IF EXISTS "Coach manage assigned purchase_records"');
    expect(money).not.toMatch(/CREATE POLICY "Coach[^"]*" ON public\.purchase_records\s+FOR (ALL|INSERT|UPDATE|DELETE)/);
    expect(money).toMatch(/CREATE POLICY "Coach read assigned purchase_records" ON public\.purchase_records\s+FOR SELECT/);
  });

  it("check the signed-in user once per query", () => {
    for (const sql of [money, scoped]) {
      // every auth.uid() is inside a (SELECT …)
      expect(sql.replace(/\(SELECT auth\.uid\(\)\)/g, "")).not.toMatch(/auth\.uid\(\)/);
      expect(sql).not.toMatch(/is_assigned_coach\(/);
    }
  });
});
