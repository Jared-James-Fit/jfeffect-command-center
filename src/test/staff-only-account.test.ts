import { describe, it, expect } from "vitest";
import {
  assertEmailFreeForStaffInvite, assertNoPersonalAccount, assertNotStaffAccount, finalizeStaffOnlyUser,
} from "@/lib/setup-link-guard.server";

type Row = Record<string, any>;

// In-memory stand-in for the service-role client: enough of supabase-js for
// select/eq/neq/in/ilike/limit, upsert and delete on a few tables.
function fakeAdmin(seed: { users?: Row[]; tables?: Record<string, Row[]> }) {
  const users = seed.users ?? [];
  const tables: Record<string, Row[]> = { user_roles: [], clients: [], app_members: [], ...(seed.tables ?? {}) };
  const match = (row: Row, f: Array<[string, string, any]>) =>
    f.every(([op, c, v]) =>
      op === "eq" ? row[c] === v
      : op === "neq" ? row[c] !== v
      : op === "in" ? (v as any[]).includes(row[c])
      : op === "ilike" ? String(row[c] ?? "").toLowerCase() === String(v).toLowerCase()
      : true);
  return {
    tables,
    auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      let mode: "select" | "delete" = "select";
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { filters.push(["eq", c, v]); return q; },
        neq: (c: string, v: any) => { filters.push(["neq", c, v]); return q; },
        in: (c: string, v: any) => { filters.push(["in", c, v]); return q; },
        ilike: (c: string, v: any) => { filters.push(["ilike", c, v]); return q; },
        limit: () => q,
        delete: () => { mode = "delete"; return q; },
        upsert: async (row: Row) => {
          const rows = tables[table];
          if (!rows.some((r) => r.user_id === row.user_id && r.role === row.role)) rows.push(row);
          return { data: null, error: null };
        },
        then: (resolve: any) => {
          const rows = tables[table];
          if (mode === "delete") {
            tables[table] = rows.filter((r) => !match(r, filters));
            return resolve({ data: null, error: null });
          }
          return resolve({ data: rows.filter((r) => match(r, filters)), error: null });
        },
      };
      return q;
    },
  };
}

describe("assertEmailFreeForStaffInvite", () => {
  it("allows an email nobody uses", async () => {
    await expect(assertEmailFreeForStaffInvite(fakeAdmin({}), "books@example.com")).resolves.toBeUndefined();
  });

  it("refuses an email that already has any login (e.g. the bookkeeper's own client account)", async () => {
    const sb = fakeAdmin({ users: [{ id: "u1", email: "Fionna@example.com" }] });
    await expect(assertEmailFreeForStaffInvite(sb, "fionna@example.com")).rejects.toThrow(/already has a JF Effect login/);
  });

  it("refuses an email on a client or member record without a login", async () => {
    const asClient = fakeAdmin({ tables: { clients: [{ id: "c1", email: "a@example.com" }] } });
    await expect(assertEmailFreeForStaffInvite(asClient, "A@example.com")).rejects.toThrow(/staff-only email/);
    const asMember = fakeAdmin({ tables: { app_members: [{ id: "m1", email: "b@example.com" }] } });
    await expect(assertEmailFreeForStaffInvite(asMember, "b@example.com")).rejects.toThrow(/staff-only email/);
  });
});

describe("assertNoPersonalAccount (staff side)", () => {
  it("refuses a login linked to a client or member row", async () => {
    const sb = fakeAdmin({ tables: { clients: [{ id: "c1", user_id: "u1", email: "x@example.com" }] } });
    await expect(assertNoPersonalAccount(sb, { userId: "u1" })).rejects.toThrow(/staff-only email/);
  });

  it("allows an existing staff-only login (one person's staff roles share one account)", async () => {
    const sb = fakeAdmin({ users: [{ id: "owner", email: "owner@example.com" }], tables: { user_roles: [{ user_id: "owner", role: "admin" }] } });
    await expect(assertNoPersonalAccount(sb, { email: "owner@example.com", userId: "owner" })).resolves.toBeUndefined();
  });
});

describe("assertNotStaffAccount (personal side)", () => {
  it("refuses a client or member on any staff role's email", async () => {
    for (const role of ["admin", "coach", "media_manager", "finance"]) {
      const sb = fakeAdmin({ users: [{ id: "s1", email: "staff@example.com" }], tables: { user_roles: [{ user_id: "s1", role }] } });
      await expect(assertNotStaffAccount(sb, { email: "STAFF@example.com" })).rejects.toThrow(/staff account/);
    }
  });

  it("allows a personal email", async () => {
    const sb = fakeAdmin({ users: [{ id: "p1", email: "me@example.com" }], tables: { user_roles: [{ user_id: "p1", role: "client" }] } });
    await expect(assertNotStaffAccount(sb, { email: "me@example.com" })).resolves.toBeUndefined();
  });
});

describe("finalizeStaffOnlyUser", () => {
  it("leaves the account holding only its staff role", async () => {
    // As if handle_new_user (before 20261018100200) had added the client role.
    const sb = fakeAdmin({ tables: { user_roles: [{ user_id: "u1", role: "client" }] } });
    await finalizeStaffOnlyUser(sb, "u1", "finance");
    expect(sb.tables.user_roles).toEqual([{ user_id: "u1", role: "finance" }]);
  });

  it("refuses to finish if the account got linked to a client row", async () => {
    const sb = fakeAdmin({ tables: { clients: [{ id: "c1", user_id: "u1" }] } });
    await expect(finalizeStaffOnlyUser(sb, "u1", "finance")).rejects.toThrow(/clients row/);
  });
});
