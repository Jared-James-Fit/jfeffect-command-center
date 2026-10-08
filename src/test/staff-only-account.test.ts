import { describe, it, expect } from "vitest";
import { isStaffOnlyRole, assertEmailFreeForStaffOnly, finalizeStaffOnlyUser } from "@/lib/setup-link-guard.server";

type Row = Record<string, any>;

// In-memory stand-in for the service-role client: enough of supabase-js for
// select/eq/neq/ilike/limit, upsert and delete on a few tables.
function fakeAdmin(seed: { users?: Row[]; tables?: Record<string, Row[]> }) {
  const users = seed.users ?? [];
  const tables: Record<string, Row[]> = { user_roles: [], clients: [], app_members: [], ...(seed.tables ?? {}) };
  const match = (row: Row, f: Array<[string, string, any]>) =>
    f.every(([op, c, v]) =>
      op === "eq" ? row[c] === v
      : op === "neq" ? row[c] !== v
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

describe("staff-only roles", () => {
  it("treats finance as staff-only and media_manager as not", () => {
    expect(isStaffOnlyRole("finance")).toBe(true);
    expect(isStaffOnlyRole("media_manager")).toBe(false);
    expect(isStaffOnlyRole("admin")).toBe(false);
    expect(isStaffOnlyRole(null)).toBe(false);
  });
});

describe("assertEmailFreeForStaffOnly", () => {
  it("allows an email nobody uses", async () => {
    await expect(assertEmailFreeForStaffOnly(fakeAdmin({}), "books@example.com")).resolves.toBeUndefined();
  });

  it("refuses an email that already has a login (e.g. the bookkeeper's own client account)", async () => {
    const sb = fakeAdmin({ users: [{ id: "u1", email: "Fionna@example.com" }] });
    await expect(assertEmailFreeForStaffOnly(sb, "fionna@example.com")).rejects.toThrow(/its own email/);
  });

  it("refuses an email on a client or member record without a login", async () => {
    const asClient = fakeAdmin({ tables: { clients: [{ id: "c1", email: "a@example.com" }] } });
    await expect(assertEmailFreeForStaffOnly(asClient, "A@example.com")).rejects.toThrow(/its own email/);
    const asMember = fakeAdmin({ tables: { app_members: [{ id: "m1", email: "b@example.com" }] } });
    await expect(assertEmailFreeForStaffOnly(asMember, "b@example.com")).rejects.toThrow(/its own email/);
  });
});

describe("finalizeStaffOnlyUser", () => {
  it("leaves the account holding only its staff role", async () => {
    // As if handle_new_user (pre-20261015090200) had added the client role.
    const sb = fakeAdmin({ tables: { user_roles: [{ user_id: "u1", role: "client" }] } });
    await finalizeStaffOnlyUser(sb, "u1", "finance");
    expect(sb.tables.user_roles).toEqual([{ user_id: "u1", role: "finance" }]);
  });

  it("refuses to finish if the account got linked to a client row", async () => {
    const sb = fakeAdmin({ tables: { clients: [{ id: "c1", user_id: "u1" }] } });
    await expect(finalizeStaffOnlyUser(sb, "u1", "finance")).rejects.toThrow(/clients row/);
  });
});
