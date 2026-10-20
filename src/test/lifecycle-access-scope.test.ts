import { describe, it, expect, vi, beforeEach } from "vitest";

// The lifecycle fires gated SMS triggers through dynamic imports; keep them inert.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/sms-trigger.server", () => ({ fireAutomationTrigger: vi.fn(async () => {}) }));

import { applyJfLifecycle, enforceGraceIfExpired } from "@/lib/jf-lifecycle.server";

type Update = { table: string; patch: any; filters: Array<[string, string, any]> };
let updates: Update[] = [];

// Minimal supabase-js stand-in that records every update and its filters.
function fakeAdmin(defaults: Record<string, string[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      let patch: any = null;
      const q: any = {
        select: () => q,
        insert: async () => ({ data: null, error: null }),
        update: (p: any) => { patch = p; updates.push({ table, patch, filters }); return q; },
        eq: (c: string, v: any) => { filters.push(["eq", c, v]); return q; },
        is: (c: string, v: any) => { filters.push(["is", c, v]); return q; },
        neq: (c: string, v: any) => { filters.push(["neq", c, v]); return q; },
        in: (c: string, v: any) => { filters.push(["in", c, v]); return q; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: any) => {
          if (table === "member_access_defaults" && !patch) {
            const type = filters.find(([, c]) => c === "account_type")?.[2];
            return resolve({ data: (defaults[type] ?? []).map((k) => ({ access_level_key: k })), error: null });
          }
          return resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
}

const MEMBERSHIP_KEYS = ["jf_membership", "app_membership", "program_library", "community"];
const member = { id: "m1", account_type: "jf_member", subscription_status: "Active" };

function accessUpdate() {
  const u = updates.filter((x) => x.table === "member_access");
  expect(u).toHaveLength(1);
  return u[0];
}

beforeEach(() => { updates = []; });

describe("membership lapse only revokes what the membership granted", () => {
  it("scopes the cancel to the membership's default keys without an offer", async () => {
    const sb = fakeAdmin({ jf_member: MEMBERSHIP_KEYS });
    await applyJfLifecycle({ supabaseAdmin: sb, member, sub: { id: "sub_1", status: "canceled", items: { data: [] } }, holdPriceId: null });
    const u = accessUpdate();
    expect(u.patch).toEqual({ active: false });
    expect(u.filters).toEqual([
      ["eq", "member_id", "m1"],
      ["is", "offer_id", null],
      ["neq", "source", "one_time"],
      ["in", "access_level_key", MEMBERSHIP_KEYS],
    ]);
  });

  it("uses the same scope when access is restored", async () => {
    const sb = fakeAdmin({ jf_member: MEMBERSHIP_KEYS });
    await applyJfLifecycle({ supabaseAdmin: sb, member, sub: { id: "sub_1", status: "active", items: { data: [] } }, holdPriceId: null });
    const u = accessUpdate();
    expect(u.patch).toEqual({ active: true });
    expect(u.filters).toContainEqual(["is", "offer_id", null]);
  });

  it("scopes the lazy grace-expiry restriction too", async () => {
    const sb = fakeAdmin({ jf_member: MEMBERSHIP_KEYS });
    await enforceGraceIfExpired(sb, { ...member, grace_period_ends_at: "2000-01-01T00:00:00Z" });
    const u = accessUpdate();
    expect(u.patch).toEqual({ active: false });
    expect(u.filters).toContainEqual(["in", "access_level_key", MEMBERSHIP_KEYS]);
  });

  it("touches nothing when the account type has no default keys", async () => {
    const sb = fakeAdmin({});
    await applyJfLifecycle({ supabaseAdmin: sb, member, sub: { id: "sub_1", status: "canceled", items: { data: [] } }, holdPriceId: null });
    expect(updates.filter((x) => x.table === "member_access")).toHaveLength(0);
  });
});
