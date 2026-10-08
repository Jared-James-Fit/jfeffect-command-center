import { describe, it, expect } from "vitest";
import { findAuthUserByEmail, assertNotPrivilegedUser } from "@/lib/setup-link-guard.server";

function fakeAdmin(opts: { users?: Array<{ id: string; email: string }>; roles?: Record<string, string[]> }) {
  const users = opts.users ?? [];
  const roles = opts.roles ?? {};
  return {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
      },
    },
    from: () => {
      let userId = "";
      let allowed: string[] = [];
      const q: any = {
        select: () => q,
        eq: (_col: string, v: string) => { userId = v; return q; },
        in: async (_col: string, v: string[]) => {
          allowed = v;
          const data = (roles[userId] ?? []).filter((r) => allowed.includes(r)).map((role) => ({ role }));
          return { data, error: null };
        },
      };
      return q;
    },
  };
}

describe("findAuthUserByEmail", () => {
  it("finds a user past the first page of auth users", async () => {
    const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `user${i}@example.com` }));
    const found = await findAuthUserByEmail(fakeAdmin({ users }), "USER1234@example.com");
    expect(found).toEqual({ id: "u1234" });
  });

  it("returns null when nobody has that email", async () => {
    const found = await findAuthUserByEmail(fakeAdmin({ users: [{ id: "a", email: "a@example.com" }] }), "b@example.com");
    expect(found).toBeNull();
  });
});

describe("assertNotPrivilegedUser", () => {
  it("refuses admin and coach accounts", async () => {
    const admin = fakeAdmin({ roles: { owner: ["admin", "client"], coach1: ["coach"] } });
    await expect(assertNotPrivilegedUser(admin, "owner")).rejects.toThrow(/staff account/);
    await expect(assertNotPrivilegedUser(admin, "coach1")).rejects.toThrow(/staff account/);
  });

  it("allows client and member accounts", async () => {
    const admin = fakeAdmin({ roles: { member1: ["client"] } });
    await expect(assertNotPrivilegedUser(admin, "member1")).resolves.toBeUndefined();
  });
});
