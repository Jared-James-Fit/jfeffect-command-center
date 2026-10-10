import { describe, it, expect } from "vitest";
import { assertPermission } from "@/lib/permissions.server";

function ctx(opts: { aal?: string; allowed?: boolean; error?: string }) {
  const calls: any[] = [];
  return {
    calls,
    userId: "u1",
    claims: opts.aal ? { aal: opts.aal } : {},
    supabase: {
      rpc: async (fn: string, args: any) => {
        calls.push({ fn, args });
        return opts.error ? { data: null, error: { message: opts.error } } : { data: !!opts.allowed, error: null };
      },
    },
  };
}

describe("assertPermission", () => {
  it("passes when has_permission says yes, with a password sign-in alone (no second step)", async () => {
    const c = ctx({ aal: "aal1", allowed: true });
    await assertPermission(c, "finance.record");
    expect(c.calls).toEqual([{ fn: "has_permission", args: { _uid: "u1", _perm: "finance.record" } }]);
  });

  it("forbids when has_permission says no", async () => {
    await expect(assertPermission(ctx({ aal: "aal2", allowed: false }), "finance.read")).rejects.toThrow(/Forbidden: missing finance.read/);
  });

  it("fails closed when the check errors", async () => {
    await expect(assertPermission(ctx({ aal: "aal2", error: "boom" }), "finance.read")).rejects.toThrow(/Permission check failed/);
  });
});
